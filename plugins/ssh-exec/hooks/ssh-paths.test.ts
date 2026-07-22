import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { mapPatchPaths, mapShellPaths, parseRemotePath, rewriteInput } from "./ssh-paths";

describe("ssh path syntax", () => {
	test("splits host and remote suffix", () => {
		expect(parseRemotePath("ssh/ileqm:project/a")).toEqual({ host: "ileqm", suffix: "project/a" });
		expect(parseRemotePath("ssh/judy:/etc/hosts")).toEqual({ host: "judy", suffix: "/etc/hosts" });
	});

	test("ignores local paths and malformed hosts", () => {
		expect(parseRemotePath("README.md")).toBeUndefined();
		expect(parseRemotePath("ssh/foo/bar:file")).toBeUndefined();
		expect(() => parseRemotePath("ssh/..:file")).toThrow("Invalid SSH host alias");
	});
});

test("rewrites only apply_patch headers", async () => {
	const patch = `*** Begin Patch
*** Update File: ssh/judy:file
@@
+*** Update File: ssh/judy:file
*** End Patch`;

	expect(await mapPatchPaths(patch, async (path) => `/mounted/${path}`)).toBe(`*** Begin Patch
*** Update File: /mounted/ssh/judy:file
@@
+*** Update File: ssh/judy:file
*** End Patch`);
});

test("rewrites Codex apply_patch command and legacy patch inputs", async () => {
	const command = "*** Update File: ssh/judy:file";
	const rewrite = async (path: string) => `/mounted/${path}`;

	expect(await rewriteInput("apply_patch", { command }, rewrite)).toEqual({
		command: "*** Update File: /mounted/ssh/judy:file",
	});
	expect(await rewriteInput("apply_patch", { patch: command }, rewrite)).toEqual({
		patch: "*** Update File: /mounted/ssh/judy:file",
	});
});

test("rewrites unified exec paths without changing ordinary text", async () => {
	const rewrite = async (path: string) => `/mounted/${path}`;
	const command = `sed -n '1,20p' ssh/judy:/etc/os-release && rg NAME "ssh/judy:project file" 'ssh/judy:other file'`;

	expect(await mapShellPaths(command, rewrite)).toBe(
		`sed -n '1,20p' /mounted/ssh/judy:/etc/os-release && rg NAME "/mounted/ssh/judy:project file" '/mounted/ssh/judy:other file'`,
	);
	expect(await mapShellPaths("echo prefix-ssh/judy:/etc/hosts", rewrite)).toBe("echo prefix-ssh/judy:/etc/hosts");
	await expect(mapShellPaths("cat ssh/judy:/tmp/$USER", rewrite)).rejects.toThrow("Dynamic SSH paths");
	expect(await mapShellPaths("cat 'ssh/judy:/tmp/$USER'", rewrite)).toBe("cat '/mounted/ssh/judy:/tmp/$USER'");
	expect(await rewriteInput("Bash", { command: "cat ssh/judy:/etc/hosts" }, rewrite)).toEqual({
		command: "cat /mounted/ssh/judy:/etc/hosts",
	});
});

test("ignores local unified exec and denies invalid remote paths", async () => {
	const local = await runHook({ tool_name: "Bash", tool_input: { command: "cat README.md" } });
	const invalid = await runHook({ tool_name: "Bash", tool_input: { command: "cat ssh/..:file" } });

	expect(local).toBe("");
	expect(JSON.parse(invalid).hookSpecificOutput.permissionDecision).toBe("deny");
});

test("injects virtual path guidance at session start", async () => {
	const output = JSON.parse(await runHook({ hook_event_name: "SessionStart" }));

	expect(output.hookSpecificOutput.hookEventName).toBe("SessionStart");
	expect(output.hookSpecificOutput.additionalContext).toContain("ssh/<host>:/path");
	expect(output.hookSpecificOutput.additionalContext).toContain("do not wrap these file reads in `ssh <host> '...'`");
	expect(output.hookSpecificOutput.additionalContext).toContain("Use `ssh <host> '...'` only for remote system/service commands");
	expect(output.hookSpecificOutput.additionalContext).not.toContain(".codex/plugins/ssh");
});

async function runHook(input: Record<string, unknown>): Promise<string> {
	const child = Bun.spawn(["bun", join(import.meta.dir, "ssh-paths.ts")], {
		stdio: ["pipe", "pipe", "inherit"],
	});
	child.stdin.write(JSON.stringify(input));
	child.stdin.end();
	const output = await new Response(child.stdout).text();
	await child.exited;
	return output;
}
