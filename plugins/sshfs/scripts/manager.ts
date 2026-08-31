import { spawn } from "node:child_process";
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

export interface HostExecInput {
	host: string;
	command: string;
	cwd?: string;
	timeoutMs?: number;
}

export interface HostExecResult {
	host: string;
	command: string;
	cwd?: string;
	exitCode: number;
	stdout: string;
	stderr: string;
	timedOut: false;
}

export interface SshfsManagerOptions {
	mountRoot?: string;
	platform?: NodeJS.Platform;
	runner?: ProcessRunner;
	environment?: NodeJS.ProcessEnv;
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
const DEFAULT_EXEC_CONNECT_TIMEOUT_SECONDS = 15;
const DEFAULT_MOUNT_CONNECT_TIMEOUT_SECONDS = 30;
const DEFAULT_SERVER_ALIVE_INTERVAL_SECONDS = 300;
const DEFAULT_EXEC_SERVER_ALIVE_COUNT_MAX = 1;
const DEFAULT_MOUNT_SERVER_ALIVE_COUNT_MAX = 3;
const DEFAULT_CONNECTION_ATTEMPTS = 1;
const DEFAULT_CONTROL_PERSIST = "60m";
const DEFAULT_STRICT_HOST_KEY_CHECKING = "accept-new";
const OPERATION_TIMEOUT_MS = 30_000;
const ROLLBACK_TIMEOUT_MS = 5_000;
const PROBE_TIMEOUT_MS = 5_000;
const CONNECTIVITY_QUERY_TIMEOUT_MS = 10_000;
const HEALTH_TIMEOUT_MS = 5_000;
const HEALTH_RETRY_MS = 100;
const OUTPUT_EDGE_BYTES = 5 * 1024;
const SSHFS_MOUNT_TYPE =
	/(?:^|[\s,(])(?:fuse\.)?sshfs(?:[\s,)]|$)|(?:^|[\s,(])(?:mac|osx)fuse(?:[\s,)]|$)/i;

export function validateHost(value: string): string {
	const host = value.trim();
	if (host === "") throw new Error("host must be a non-empty string");
	if (host.startsWith("-")) throw new Error("host must not start with '-'");
	if (/[\0\r\n\t ]/.test(host)) throw new Error("host must not contain whitespace");
	if (/[\/:]/.test(host)) throw new Error("host must not contain a path or port; use an OpenSSH alias");
	return host;
}

export class SshfsManager {
	readonly #mountRoot: string;
	readonly #platform: NodeJS.Platform;
	readonly #runner: ProcessRunner;
	readonly #settings: SshfsSettings;

	constructor(options: SshfsManagerOptions = {}) {
		this.#settings = readSettings(options.environment ?? process.env);
		this.#mountRoot = options.mountRoot ?? this.#settings.mountRoot;
		this.#platform = options.platform ?? process.platform;
		this.#runner = options.runner ?? runProcess;
	}

	async execOnHost(input: HostExecInput): Promise<HostExecResult> {
		const host = validateHost(input.host);
		if (typeof input.command !== "string" || input.command.length === 0 || input.command.includes("\0")) {
			throw new Error("command must be a non-empty string without NUL");
		}
		if (input.cwd !== undefined && (input.cwd.length === 0 || input.cwd.includes("\0") || /[\r\n]/.test(input.cwd))) {
			throw new Error("cwd must be a non-empty string without NUL, CR, or LF");
		}
		const timeoutMs = input.timeoutMs ?? 30_000;
		if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) {
			throw new Error("timeoutMs must be an integer between 1 and 300000");
		}
		const remoteCommand = input.cwd === undefined
			? input.command
			: `cd -- ${quoteShellWord(input.cwd)} && ${input.command}`;
		let response: ProcessResult;
		try {
			response = await this.runMuxSsh(host, remoteCommand, timeoutMs);
		} catch (error) {
			throw new Error(`Unable to start SSH for ${host}: ${error instanceof Error ? error.message : String(error)}`);
		}
		if (response.timedOut) throw new Error(`SSH command on ${host} timed out`);
		const stdout = truncateOutput(response.stdout);
		const stderr = truncateOutput(response.stderr);
		if (response.exitCode === null || response.exitCode === 127) {
			throw new Error(`Unable to start SSH for ${host}`);
		}
		if (response.exitCode === 255 && isSshDiagnostic(stderr)) {
			throw new Error(`SSH host ${host} is not reachable: ${stderr.trim() || "connection failed"}`);
		}
		return {
			host,
			command: input.command,
			...(input.cwd === undefined ? {} : { cwd: input.cwd }),
			exitCode: response.exitCode,
			stdout,
			stderr,
			timedOut: false,
		};
	}

	async ensureMounted(hostValue: string): Promise<SshfsResult> {
		if (this.#platform !== "linux" && this.#platform !== "darwin") {
			throw new Error(`sshfs is supported only on Linux and macOS; current platform is ${this.#platform}`);
		}

		const host = validateHost(hostValue);
		const source = `${host}:/`;
		const segment = encodeURIComponent(host);
		const localPath = join(
			this.#mountRoot,
			segment === "." || segment === ".." ? `_${segment}` : segment,
		);

		await ensureDirectory(this.#mountRoot);
		const realMountRoot = await realpath(this.#mountRoot);
		const remoteHome = await this.queryRemoteHome(host);
		const deadline = Date.now() + OPERATION_TIMEOUT_MS;
		await mkdir(localPath, { recursive: true, mode: 0o700 });
		await assertDirectChildDirectory(localPath, realMountRoot);

		const current = await this.probeMount(localPath, source, deadline);
		if (current.state === "conflict") {
			throw new Error(`sshfs mount path is occupied by another filesystem: ${localPath}`);
		}
		if (current.state === "matching" && current.healthy) {
			return this.result(host, localPath, remoteHome, "reused");
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
				"-o", `ServerAliveInterval=${this.#settings.serverAliveIntervalSeconds}`,
				"-o", `ServerAliveCountMax=${this.#settings.mountServerAliveCountMax}`,
				"-o", `ConnectTimeout=${this.#settings.mountConnectTimeoutSeconds}`,
				"-o", `ConnectionAttempts=${this.#settings.connectionAttempts}`,
				"-o", "BatchMode=yes",
				"-o", `StrictHostKeyChecking=${this.#settings.strictHostKeyChecking}`,
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

		return this.result(host, localPath, remoteHome, "mounted");
	}

	private result(
		host: string,
		localPath: string,
		remoteHome: string,
		status: SshfsResult["status"],
	): SshfsResult {
		const root = resolve(localPath);
		const remoteHomeLocalPath = resolve(root, remoteHome.slice(1));
		if (remoteHomeLocalPath !== root && !remoteHomeLocalPath.startsWith(`${root}/`)) {
			throw new Error(`Remote home escapes the SSHFS mount for ${host}`);
		}
		return { host, localPath, remoteHomeLocalPath, status };
	}

	private async queryRemoteHome(host: string): Promise<string> {
		const deadline = Date.now() + CONNECTIVITY_QUERY_TIMEOUT_MS;
		let lastResponse: ProcessResult | undefined;
		for (let attempt = 0; attempt < 2; attempt += 1) {
			if (Date.now() >= deadline) break;
			lastResponse = await this.runMuxSsh(host, "printf %s \"$HOME\"", CONNECTIVITY_QUERY_TIMEOUT_MS, deadline);
			if (lastResponse.exitCode === 0 && lastResponse.stdout.trim()) break;
			if (attempt === 0 && Date.now() + HEALTH_RETRY_MS < deadline) await delay(HEALTH_RETRY_MS);
		}
		if (!lastResponse || lastResponse.timedOut || Date.now() >= deadline) {
			throw new Error(`SSH host ${host} did not respond within ${CONNECTIVITY_QUERY_TIMEOUT_MS / 1000} seconds`);
		}
		if (lastResponse.exitCode !== 0 || !lastResponse.stdout.trim()) {
			const detail = lastResponse.stderr.trim() || lastResponse.stdout.trim();
			throw new Error(`SSH host ${host} is not reachable${detail ? `: ${detail}` : ""}`);
		}
		const remoteHome = posix.normalize(lastResponse.stdout.trim());
		if (!posix.isAbsolute(remoteHome)) throw new Error(`Invalid remote home for ${host}`);
		return remoteHome;
	}

	private async ensureExecControlDirectory(): Promise<string> {
		await ensureDirectory(this.#mountRoot);
		const controlRoot = join(this.#mountRoot, "control");
		await ensureDirectory(controlRoot);
		return resolve(controlRoot);
	}

	private async runMuxSsh(
		host: string,
		remoteCommand: string,
		timeoutMs: number,
		deadline?: number,
	): Promise<ProcessResult> {
		const invoke = async (args: string[]): Promise<ProcessResult> => deadline === undefined
			? await this.#runner("ssh", args, timeoutMs)
			: await this.run("ssh", args, timeoutMs, deadline);
		const commandArgs = async (): Promise<string[]> => {
			const controlPath = join(await this.ensureExecControlDirectory(), "%C");
			return [...sshArguments(controlPath, this.#settings), "--", host, remoteCommand];
		};

		const response = await invoke(await commandArgs());
		if (response.timedOut || response.exitCode !== 255 || !isMuxSocketFailure(response.stderr)) {
			return response;
		}

		const controlPath = join(await this.ensureExecControlDirectory(), "%C");
		await invoke([...sshArguments(controlPath, this.#settings), "-O", "exit", "--", host]).catch(() => undefined);
		return await invoke(await commandArgs());
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
			? [["fusermount3", "-u", localPath], ["fusermount", "-u", localPath], ["umount", localPath]]
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

interface SshfsSettings {
	mountRoot: string;
	execConnectTimeoutSeconds: number;
	mountConnectTimeoutSeconds: number;
	serverAliveIntervalSeconds: number;
	execServerAliveCountMax: number;
	mountServerAliveCountMax: number;
	connectionAttempts: number;
	controlPersist: string;
	strictHostKeyChecking: string;
}

function readSettings(environment: NodeJS.ProcessEnv): SshfsSettings {
	return {
		mountRoot: environment.SSHFS_MOUNT_ROOT?.trim() || DEFAULT_MOUNT_ROOT,
		execConnectTimeoutSeconds: readPositiveInteger(environment, "SSHFS_EXEC_CONNECT_TIMEOUT", DEFAULT_EXEC_CONNECT_TIMEOUT_SECONDS),
		mountConnectTimeoutSeconds: readPositiveInteger(environment, "SSHFS_MOUNT_CONNECT_TIMEOUT", DEFAULT_MOUNT_CONNECT_TIMEOUT_SECONDS),
		serverAliveIntervalSeconds: readPositiveInteger(environment, "SSHFS_SERVER_ALIVE_INTERVAL", DEFAULT_SERVER_ALIVE_INTERVAL_SECONDS),
		execServerAliveCountMax: readNonNegativeInteger(environment, "SSHFS_EXEC_SERVER_ALIVE_COUNT_MAX", DEFAULT_EXEC_SERVER_ALIVE_COUNT_MAX),
		mountServerAliveCountMax: readNonNegativeInteger(environment, "SSHFS_MOUNT_SERVER_ALIVE_COUNT_MAX", DEFAULT_MOUNT_SERVER_ALIVE_COUNT_MAX),
		connectionAttempts: readPositiveInteger(environment, "SSHFS_CONNECTION_ATTEMPTS", DEFAULT_CONNECTION_ATTEMPTS),
		controlPersist: readNonEmptyValue(environment, "SSHFS_CONTROL_PERSIST", DEFAULT_CONTROL_PERSIST),
		strictHostKeyChecking: readNonEmptyValue(environment, "SSHFS_STRICT_HOST_KEY_CHECKING", DEFAULT_STRICT_HOST_KEY_CHECKING),
	};
}

function readPositiveInteger(environment: NodeJS.ProcessEnv, name: string, defaultValue: number): number {
	const value = environment[name];
	if (value === undefined || value.trim() === "") return defaultValue;
	if (!/^\d+$/.test(value) || Number(value) < 1 || !Number.isSafeInteger(Number(value))) {
		throw new Error(`${name} must be a positive integer`);
	}
	return Number(value);
}

function readNonNegativeInteger(environment: NodeJS.ProcessEnv, name: string, defaultValue: number): number {
	const value = environment[name];
	if (value === undefined || value.trim() === "") return defaultValue;
	if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
		throw new Error(`${name} must be a non-negative integer`);
	}
	return Number(value);
}

function readNonEmptyValue(environment: NodeJS.ProcessEnv, name: string, defaultValue: string): string {
	const value = environment[name]?.trim();
	if (!value) return defaultValue;
	if (/[\0\r\n]/.test(value)) throw new Error(`${name} must not contain NUL, CR, or LF`);
	return value;
}

function sshArguments(controlPath: string, settings: SshfsSettings): string[] {
	return [
		"-n",
		"-o", `ServerAliveInterval=${settings.serverAliveIntervalSeconds}`,
		"-o", `ServerAliveCountMax=${settings.execServerAliveCountMax}`,
		"-o", `ConnectTimeout=${settings.execConnectTimeoutSeconds}`,
		"-o", `ConnectionAttempts=${settings.connectionAttempts}`,
		"-o", "BatchMode=yes",
		"-o", `StrictHostKeyChecking=${settings.strictHostKeyChecking}`,
		"-o", "ControlMaster=auto",
		"-o", `ControlPath=${controlPath}`,
		"-o", `ControlPersist=${settings.controlPersist}`,
	];
}

function quoteShellWord(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}

function isSshDiagnostic(stderr: string): boolean {
	return /(?:^|\n)ssh:|Could not resolve hostname|connect to host|Permission denied \(publickey|Host key verification failed/i.test(stderr);
}

function isMuxSocketFailure(stderr: string): boolean {
	return /Control socket connect failed|mux_client|ControlPath/i.test(stderr);
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
		const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
		const stdout = new BoundedOutput();
		const stderr = new BoundedOutput();
		let timedOut = false;
		let settled = false;
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill("SIGKILL");
		}, timeoutMs);
		const finish = (exitCode: number | null) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve({ exitCode, stdout: stdout.value(), stderr: stderr.value(), timedOut });
		};
		child.stdout.on("data", (chunk: Buffer | string) => stdout.append(chunk));
		child.stderr.on("data", (chunk: Buffer | string) => stderr.append(chunk));
		child.on("error", (error: NodeJS.ErrnoException) => finish(error.code === "ENOENT" ? 127 : null));
		child.on("close", (code) => finish(code));
	});
}

class BoundedOutput {
	#head = Buffer.alloc(0);
	#tail = Buffer.alloc(0);
	#full = Buffer.alloc(0);
	#total = 0;

	append(chunk: Buffer | string): void {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		this.#total += buffer.length;
		if (this.#full.length <= OUTPUT_EDGE_BYTES * 2) {
			this.#full = Buffer.concat([this.#full, buffer]).subarray(0, OUTPUT_EDGE_BYTES * 2);
		}
		if (this.#head.length < OUTPUT_EDGE_BYTES) {
			this.#head = Buffer.concat([this.#head, buffer]).subarray(0, OUTPUT_EDGE_BYTES);
		}
		this.#tail = Buffer.concat([this.#tail, buffer]);
		if (this.#tail.length > OUTPUT_EDGE_BYTES) this.#tail = this.#tail.subarray(-OUTPUT_EDGE_BYTES);
	}

	value(): string {
		if (this.#total <= OUTPUT_EDGE_BYTES * 2) return this.#full.toString("utf8");
		const omitted = this.#total - OUTPUT_EDGE_BYTES * 2;
		return `${this.#head.toString("utf8")}\n...[output truncated; omitted ${formatByteCount(omitted)}]...\n${this.#tail.toString("utf8")}`;
	}
}

function truncateOutput(value: string): string {
	const buffer = Buffer.from(value, "utf8");
	if (buffer.length <= OUTPUT_EDGE_BYTES * 2) return value;
	const omitted = buffer.length - OUTPUT_EDGE_BYTES * 2;
	return `${buffer.subarray(0, OUTPUT_EDGE_BYTES).toString("utf8")}\n...[output truncated; omitted ${formatByteCount(omitted)}]...\n${buffer.subarray(-OUTPUT_EDGE_BYTES).toString("utf8")}`;
}

function formatByteCount(bytes: number): string {
	const units = ["bytes", "KiB", "MiB", "GiB"];
	let value = bytes;
	let unitIndex = 0;
	while (value >= 1024 && unitIndex < units.length - 1) {
		value /= 1024;
		unitIndex += 1;
	}
	const formatted = Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
	return `${formatted} ${units[unitIndex]}`;
}
