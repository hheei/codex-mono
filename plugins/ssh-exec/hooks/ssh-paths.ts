import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, posix, resolve } from "node:path";

import { SshfsManager } from "../scripts/sshfs-manager";

const mountDir = join(homedir(), ".codex", "plugins", "ssh");
const HOOK_BUDGET_MS = 13_500;
let deadline: number | undefined;
const manager = new SshfsManager({ mountDir, deadline: () => deadline });
const remoteHome = new Map<string, string>();
const lockRoot = join(mountDir, ".locks");
const LOCK_STALE_MS = 120_000;
const PATH_CONTEXT = "Remote access rules: (1) For remote file contents and searches, use unified exec (Bash) with virtual paths such as `cat ssh/<host>:/etc/hosts`, `rg pattern ssh/<host>:project`, or `sed -n '1,80p' ssh/<host>:~/file`; do not wrap these file reads in `ssh <host> '...'`. (2) Use `apply_patch` for remote edits with headers such as `*** Update File: ssh/<host>:path`. (3) Use `ssh <host> '...'` only for remote system/service commands that need to run on the host, such as `systemctl`, `tailscale`, `docker`, `ss`, or `ip`. Path forms: `ssh/<host>:/path` is remote-root; `ssh/<host>:path` and `ssh/<host>:~/path` are remote-home. Never use or expose the local SSHFS mount directory.";

export function parseRemotePath(value: string): { host: string; suffix: string } | undefined {
	const match = /^ssh\/([^/:]+):(.*)$/.exec(value);
	if (!match) return undefined;
	if (match[1] === "." || match[1] === ".." || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(match[1])) {
		throw new Error(`Invalid SSH host alias: ${match[1]}`);
	}
	return { host: match[1], suffix: match[2] };
}

type HookInput = {
	hook_event_name?: string;
	tool_name?: string;
	toolName?: string;
	tool_input?: Record<string, unknown>;
	input?: Record<string, unknown>;
};

function remainingMs(): number {
	const remaining = (deadline ?? 0) - Date.now();
	if (remaining <= 0) throw new Error("SSHFS operation exceeded its 15 second timeout budget");
	return remaining;
}

async function withMountLock<T>(host: string, action: () => Promise<T>): Promise<T> {
	await mkdir(lockRoot, { recursive: true, mode: 0o700 });
	const lockPath = join(lockRoot, host);
	while (true) {
		try {
			await mkdir(lockPath, { mode: 0o700 });
			break;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			const age = Date.now() - (await stat(lockPath).then((value) => value.mtimeMs).catch(() => Date.now()));
			if (age > LOCK_STALE_MS) await rm(lockPath, { recursive: true, force: true });
			await new Promise((resolveWait) => setTimeout(resolveWait, Math.min(100, remainingMs())));
		}
	}
	try {
		return await action();
	} finally {
		await rm(lockPath, { recursive: true, force: true });
	}
}

async function home(host: string): Promise<string> {
	const cached = remoteHome.get(host);
	if (cached) return cached;
	const result = await manager.runSsh(host, "printf %s \"$HOME\"");
	if (result.exitCode !== 0 || !result.stdout.trim()) throw new Error(`Cannot resolve remote home for ${host}`);
	const value = posix.normalize(result.stdout.trim());
	if (!value.startsWith("/")) throw new Error(`Invalid remote home for ${host}`);
	remoteHome.set(host, value);
	return value;
}

async function rewritePath(value: string): Promise<string> {
	const parsed = parseRemotePath(value);
	if (!parsed) return value;
	const { host, suffix: rawSuffix } = parsed;
	const mounted = await withMountLock(host, () => manager.ensureMounted(host));
	if (rawSuffix === "/") return mounted;
	const suffix = rawSuffix.replace(/^\//, "");
	const base = rawSuffix === "~" || rawSuffix.startsWith("~/") || (!rawSuffix.startsWith("/"))
		? join(mounted, await home(host).then((path) => path.slice(1)))
		: mounted;
	const target = resolve(base, suffix === "~" ? "" : suffix.replace(/^~\//, ""));
	const root = resolve(base);
	if (target !== root && !target.startsWith(`${root}/`)) throw new Error(`Remote path escapes SSHFS mount: ${value}`);
	return target;
}

export async function rewriteInput(
	tool: string,
	input: Record<string, unknown>,
	rewrite: (path: string) => Promise<string> = rewritePath,
): Promise<Record<string, unknown> | undefined> {
	const output = { ...input };
	if (tool === "Bash" && typeof output.command === "string") {
		const rewritten = await mapShellPaths(output.command, rewrite);
		if (rewritten === output.command) return undefined;
		output.command = rewritten;
		return output;
	}
	if (tool === "apply_patch") {
		const key = typeof output.command === "string" ? "command" : typeof output.patch === "string" ? "patch" : undefined;
		if (!key) return undefined;
		const rewritten = await mapPatchPaths(output[key] as string, rewrite);
		if (rewritten === output[key]) return undefined;
		output[key] = rewritten;
		return output;
	}
	return undefined;
}

export async function mapShellPaths(command: string, rewrite: (path: string) => Promise<string>): Promise<string> {
	let quote: "'" | '"' | undefined;
	let quoteStart = -1;
	let cursor = 0;
	let output = "";
	for (let index = 0; index < command.length; index++) {
		const char = command[index];
		if (char === "\\" && quote !== "'") {
			index++;
			continue;
		}
		if (char === "'" || char === '"') {
			if (!quote) {
				quote = char;
				quoteStart = index;
			} else if (quote === char) {
				quote = undefined;
			}
			continue;
		}
		if (!command.startsWith("ssh/", index)) continue;
		const boundary = quote ? index === quoteStart + 1 : index === 0 || /[\s=|&;(<>{]/.test(command[index - 1]);
		if (!boundary || !/^ssh\/[^/:\s'"]+:/.test(command.slice(index))) continue;

		let end = index;
		while (end < command.length) {
			const next = command[end];
			if (quote ? next === quote : /[\s'"|&;<>()]/.test(next)) break;
			end++;
		}
		const path = command.slice(index, end);
		const dynamic = quote === "'" ? undefined : quote === '"' ? /[$`\\]/ : /[$`\\*?\[\]{}]/;
		if (dynamic?.test(path)) throw new Error(`Dynamic SSH paths are not supported: ${path}`);
		output += command.slice(cursor, index) + await rewrite(path);
		cursor = end;
		index = end - 1;
	}
	return output + command.slice(cursor);
}

export async function mapPatchPaths(patch: string, rewrite: (path: string) => Promise<string>): Promise<string> {
	const headers = [...patch.matchAll(/^(\*\*\* (?:Update File|Add File|Delete File|Move to): )([^\r\n]+)$/gm)];
	let cursor = 0;
	let output = "";
	for (const header of headers) {
		output += patch.slice(cursor, header.index) + header[1] + await rewrite(header[2]);
		cursor = header.index + header[0].length;
	}
	return output + patch.slice(cursor);
}

async function main(): Promise<void> {
	deadline = Date.now() + HOOK_BUDGET_MS;
	const raw = await readFile(0, "utf8");
	const event = JSON.parse(raw) as HookInput;
	if (event.hook_event_name === "SessionStart") {
		process.stdout.write(JSON.stringify({
			hookSpecificOutput: {
				hookEventName: "SessionStart",
				additionalContext: PATH_CONTEXT,
			},
		}));
		return;
	}
	const tool = event.tool_name ?? event.toolName ?? "";
	const input = event.tool_input ?? event.input;
	if (!input || !["Bash", "apply_patch"].includes(tool)) return;
	const updatedInput = await rewriteInput(tool, input);
	if (!updatedInput) return;
	process.stdout.write(JSON.stringify({
		hookSpecificOutput: {
			hookEventName: "PreToolUse",
			permissionDecision: "allow",
			permissionDecisionReason: "ssh path mapped to sshfs mount",
			updatedInput,
		},
	}));
}

if (import.meta.main) {
	main().catch((error) => {
		const reason = error instanceof Error ? error.message : String(error);
		process.stdout.write(JSON.stringify({
			hookSpecificOutput: {
				hookEventName: "PreToolUse",
				permissionDecision: "deny",
				permissionDecisionReason: `SSHFS unavailable: ${reason}`,
			},
		}));
	});
}
