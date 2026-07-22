import { execFile } from "node:child_process";
import { chmod, lstat, mkdir, readdir, realpath, rmdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, posix, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export interface ProcessResult {
	exitCode: number | null;
	stdout: string;
	stderr: string;
	timedOut?: boolean;
}

export type ProcessRunner = (
	command: string,
	args: string[],
	timeoutMs: number,
) => Promise<ProcessResult>;

export interface SshfsResult {
	host: string;
	localPath: string;
	remoteHomeLocalPath: string;
	status: "mounted" | "reused";
}

export interface SshfsManagerOptions {
	mountRoot?: string;
	platform?: NodeJS.Platform;
	runner?: ProcessRunner;
}

type MountProbe =
	| { state: "unmounted" }
	| { state: "matching"; healthy: boolean }
	| { state: "conflict"; source: string };

interface MountEntry {
	source: string;
	metadata: string;
}

const DEFAULT_MOUNT_ROOT = join(homedir(), ".cache", "sshfs-addon");
const OPERATION_TIMEOUT_MS = 30_000;
const ROLLBACK_TIMEOUT_MS = 5_000;
const PROBE_TIMEOUT_MS = 5_000;
const REMOTE_TIMEOUT_MS = 30_000;
const HEALTH_TIMEOUT_MS = 5_000;
const HEALTH_RETRY_MS = 100;
const MAX_OUTPUT_BYTES = 64 * 1024;
const SSHFS_MOUNT_TYPE =
	/(?:^|[\s,(])(?:fuse\.)?sshfs(?:[\s,)]|$)|(?:^|[\s,(])(?:mac|osx)fuse(?:[\s,)]|$)/i;

export function validateSshfsHost(value: string): string {
	const host = value.trim();
	if (host === "") throw new Error("sshfs.host must be a non-empty string");
	if (host.startsWith("-")) throw new Error("sshfs.host must not start with '-'");
	if (/[\0\r\n\t ]/.test(host)) throw new Error("sshfs.host must not contain whitespace");
	if (/[\/:]/.test(host)) throw new Error("sshfs.host must not contain a path or port; use an OpenSSH alias");
	return host;
}

export class SshfsManager {
	readonly #mountRoot: string;
	readonly #platform: NodeJS.Platform;
	readonly #runner: ProcessRunner;
	readonly #remoteHomes = new Map<string, string>();

	constructor(options: SshfsManagerOptions = {}) {
		this.#mountRoot = options.mountRoot ?? DEFAULT_MOUNT_ROOT;
		this.#platform = options.platform ?? process.platform;
		this.#runner = options.runner ?? runProcess;
	}

	async ensureMounted(hostValue: string): Promise<SshfsResult> {
		if (this.#platform !== "linux" && this.#platform !== "darwin") {
			throw new Error(`sshfs is supported only on Linux and macOS; current platform is ${this.#platform}`);
		}

		const deadline = Date.now() + OPERATION_TIMEOUT_MS;
		const host = validateSshfsHost(hostValue);
		const source = `${host}:/`;
		const segment = encodeURIComponent(host);
		const localPath = join(
			this.#mountRoot,
			segment === "." || segment === ".." ? `_${segment}` : segment,
		);

		await ensureDirectory(this.#mountRoot);
		const realMountRoot = await realpath(this.#mountRoot);
		await mkdir(localPath, { recursive: true, mode: 0o700 });
		await assertDirectChildDirectory(localPath, realMountRoot);

		const current = await this.probeMount(localPath, source, deadline);
		if (current.state === "conflict") {
			throw new Error(`sshfs mount path is occupied by another filesystem: ${localPath}`);
		}
		if (current.state === "matching" && current.healthy) {
			return await this.result(host, localPath, "reused", deadline);
		}
		if (current.state === "matching") {
			const afterUnmount = await this.unmount(localPath, source, deadline);
			if (!afterUnmount) throw new Error(`Unable to unmount unhealthy sshfs mount: ${localPath}`);
			if (afterUnmount.state === "conflict") {
				throw new Error(`sshfs mount path changed during unmount: ${localPath}`);
			}
		}

		await assertDirectChildDirectory(localPath, realMountRoot);
		await chmod(localPath, 0o700);
		if ((await readdir(localPath)).length > 0) {
			throw new Error(`sshfs mount path is not empty: ${localPath}`);
		}
		await assertDirectChildDirectory(localPath, realMountRoot);

		let mountAttempted = false;
		try {
			mountAttempted = true;
			const result = await this.run("sshfs", [
				"-o", "reconnect",
				"-o", "ServerAliveInterval=300",
				"-o", "ServerAliveCountMax=3",
				"-o", "ConnectTimeout=30",
				"-o", "BatchMode=yes",
				"-o", "StrictHostKeyChecking=accept-new",
				...(this.#platform === "darwin" ? ["-o", "local"] : []),
				source,
				localPath,
			], OPERATION_TIMEOUT_MS, deadline);
			if (result.exitCode === 127) throw new Error("sshfs binary not found");
			if (result.timedOut) throw new Error("sshfs mount timed out");
			if (result.exitCode !== 0) {
				const detail = result.stderr.trim() || result.stdout.trim();
				throw new Error(`Failed to mount ${host}: ${detail || `sshfs exited with code ${result.exitCode}`}`);
			}

			const mounted = await this.waitForHealthyMount(localPath, source, deadline);
			if (mounted.state !== "matching" || !mounted.healthy) {
				throw new Error(`sshfs mounted ${host}, but the local mount is not healthy: ${localPath}`);
			}
		} catch (error) {
			if (mountAttempted) await this.rollbackMount(localPath, source);
			throw error;
		}

		return await this.result(host, localPath, "mounted", deadline);
	}

	private async result(
		host: string,
		localPath: string,
		status: SshfsResult["status"],
		deadline: number,
	): Promise<SshfsResult> {
		let remoteHome = this.#remoteHomes.get(host);
		if (!remoteHome) {
			const response = await this.run("ssh", [
				"-n",
				"-o", "ServerAliveInterval=300",
				"-o", "ServerAliveCountMax=3",
				"-o", "ConnectTimeout=30",
				"-o", "BatchMode=yes",
				"-o", "StrictHostKeyChecking=accept-new",
				host,
				"printf %s \"$HOME\"",
			], REMOTE_TIMEOUT_MS, deadline);
			if (response.timedOut) throw new Error(`Timed out resolving the remote home for ${host}`);
			if (response.exitCode !== 0 || !response.stdout.trim()) {
				const detail = response.stderr.trim() || response.stdout.trim();
				throw new Error(`Unable to resolve the remote home for ${host}${detail ? `: ${detail}` : ""}`);
			}
			remoteHome = posix.normalize(response.stdout.trim());
			if (!posix.isAbsolute(remoteHome)) throw new Error(`Invalid remote home for ${host}`);
			this.#remoteHomes.set(host, remoteHome);
		}

		const root = resolve(localPath);
		const remoteHomeLocalPath = resolve(root, remoteHome.slice(1));
		if (remoteHomeLocalPath !== root && !remoteHomeLocalPath.startsWith(`${root}/`)) {
			throw new Error(`Remote home escapes the SSHFS mount for ${host}`);
		}
		return { host, localPath, remoteHomeLocalPath, status };
	}

	private async probeMount(localPath: string, source: string, deadline: number): Promise<MountProbe> {
		const mount = await this.run("mount", [], PROBE_TIMEOUT_MS, deadline);
		if (mount.timedOut) throw new Error("sshfs mount probe timed out");
		if (mount.exitCode !== 0) throw new Error(`Unable to inspect mounts: mount exited ${mount.exitCode}`);
		const entry = findMountEntry(mount.stdout, localPath);
		if (!entry) return { state: "unmounted" };

		const df = await this.run("df", ["-P", localPath], PROBE_TIMEOUT_MS, deadline);
		if (df.timedOut) throw new Error("sshfs filesystem probe timed out");
		if (df.exitCode !== 0) throw new Error(`Unable to inspect mount path: df exited ${df.exitCode}`);
		const actualSource = df.stdout.trim().split("\n").at(-1)?.trim().split(/\s+/, 1)[0];
		if (actualSource !== entry.source) return { state: "unmounted" };
		if (entry.source !== source || !SSHFS_MOUNT_TYPE.test(entry.metadata)) {
			return { state: "conflict", source: entry.source };
		}

		const health = await this.run("ls", ["-A", localPath], PROBE_TIMEOUT_MS, deadline);
		return { state: "matching", healthy: !health.timedOut && health.exitCode === 0 };
	}

	private async waitForHealthyMount(localPath: string, source: string, deadline: number): Promise<MountProbe> {
		const healthDeadline = Math.min(deadline, Date.now() + HEALTH_TIMEOUT_MS);
		let last: MountProbe = { state: "unmounted" };
		do {
			last = await this.probeMount(localPath, source, deadline);
			if (last.state === "matching" && last.healthy) return last;
			if (Date.now() >= healthDeadline) return last;
			await delay(HEALTH_RETRY_MS);
		} while (true);
	}

	private async unmount(localPath: string, source: string, deadline: number): Promise<MountProbe | undefined> {
		const strategies = this.#platform === "linux"
			? [["fusermount", "-u", localPath], ["umount", localPath]]
			: [["umount", localPath], ["diskutil", "unmount", localPath]];
		for (const [command, ...args] of strategies) {
			const result = await this.run(command, args, PROBE_TIMEOUT_MS, deadline).catch(() => undefined);
			if (result?.exitCode !== 0 || result.timedOut) continue;
			const current = await this.probeMount(localPath, source, deadline);
			if (current.state !== "matching") return current;
		}
		const current = await this.probeMount(localPath, source, deadline);
		return current.state === "matching" ? undefined : current;
	}

	private async rollbackMount(localPath: string, source: string): Promise<void> {
		const deadline = Date.now() + ROLLBACK_TIMEOUT_MS;
		try {
			const current = await this.probeMount(localPath, source, deadline);
			if (current.state === "matching") await this.unmount(localPath, source, deadline);
			const after = await this.probeMount(localPath, source, deadline);
			if (after.state === "unmounted") await rmdir(localPath).catch(() => undefined);
		} catch {
			// Best effort: never replace or unmount a conflicting filesystem during rollback.
		}
	}

	private async run(command: string, args: string[], timeoutMs: number, deadline: number): Promise<ProcessResult> {
		const remaining = deadline - Date.now();
		if (remaining <= 0) throw new Error("sshfs operation timed out");
		return await this.#runner(command, args, Math.max(1, Math.min(timeoutMs, remaining)));
	}
}

function findMountEntry(output: string, localPath: string): MountEntry | undefined {
	const escapedPath = localPath
		.replaceAll("\\", "\\134")
		.replaceAll(" ", "\\040")
		.replaceAll("\t", "\\011");
	for (const line of output.split("\n")) {
		for (const path of [localPath, escapedPath]) {
			const separator = ` on ${path} `;
			const index = line.indexOf(separator);
			if (index < 0) continue;
			return {
				source: line.slice(0, index).trim(),
				metadata: line.slice(index + separator.length),
			};
		}
	}
	return undefined;
}

async function ensureDirectory(path: string): Promise<void> {
	await mkdir(path, { recursive: true, mode: 0o700 });
	const info = await lstat(path);
	if (info.isSymbolicLink() || !info.isDirectory()) {
		throw new Error(`sshfs path must be a real directory: ${path}`);
	}
	await chmod(path, 0o700);
}

async function assertDirectChildDirectory(path: string, realParent: string): Promise<void> {
	const info = await lstat(path);
	if (info.isSymbolicLink() || !info.isDirectory()) {
		throw new Error(`sshfs mount path must be a real directory: ${path}`);
	}
	const resolved = await realpath(path);
	if (dirname(resolved) !== realParent) {
		throw new Error(`sshfs mount path escapes its root: ${path}`);
	}
}

async function runProcess(command: string, args: string[], timeoutMs: number): Promise<ProcessResult> {
	return await new Promise((resolve) => {
		execFile(command, args, {
			encoding: "utf8",
			killSignal: "SIGKILL",
			maxBuffer: MAX_OUTPUT_BYTES,
			timeout: timeoutMs,
		}, (error, stdout, stderr) => {
			const code = error && "code" in error ? error.code : 0;
			resolve({
				exitCode: code === "ENOENT" ? 127 : typeof code === "number" ? code : error ? null : 0,
				stdout: String(stdout ?? ""),
				stderr: String(stderr ?? ""),
				timedOut: Boolean(error && "killed" in error && error.killed),
			});
		});
	});
}
