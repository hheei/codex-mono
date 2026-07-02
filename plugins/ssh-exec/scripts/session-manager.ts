import { createHash } from "node:crypto";
import { chmod, mkdir, readdir, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type SessionStatus = "connected" | "reconnecting";

export interface Session {
	host: string;
	socketPath: string;
	lastUsed: number;
	status: SessionStatus;
}

export interface ProcessResult {
	exitCode: number | null;
	output?: string;
	stdout: string;
	stderr: string;
	stdoutTruncated?: boolean;
	stderrTruncated?: boolean;
	truncated?: boolean;
	totalBytes?: number;
	outputBytes?: number;
	totalLines?: number;
	outputLines?: number;
	notice?: string;
}

export type ProcessRunner = (args: string[], timeoutMs?: number) => Promise<ProcessResult>;

export interface MountProbeResult {
	mounted: boolean;
	healthy: boolean;
}

export type MountProbe = (mountPath: string) => Promise<MountProbeResult>;
export type MountUnmounter = (mountPath: string) => Promise<boolean>;
export type SshMountStatus = "mounted" | "reused" | "remounted";

export interface SshMountResult {
	host: string;
	localPath: string;
	status: SshMountStatus;
}

export interface SessionManagerOptions {
	sshBin?: string;
	sshfsBin?: string;
	controlDir?: string;
	mountDir?: string;
	platform?: NodeJS.Platform;
	controlPersist?: string;
	supportsControlMaster?: boolean;
	connectTimeoutSeconds?: number;
	connectionAttempts?: number;
	serverAliveIntervalSeconds?: number;
	serverAliveCountMax?: number;
	failureBackoffMs?: number;
	mountProbe?: MountProbe;
	unmountMount?: MountUnmounter;
}

interface HostFailureState {
	failures: number;
	blockedUntil: number;
}

interface MountState {
	host: string;
	mountPath: string;
	lastUsed: number;
}

const DEFAULT_PLUGIN_DIR = join(homedir(), ".codex", "plugins", "ssh-exec");
const DEFAULT_CONTROL_DIR = join(DEFAULT_PLUGIN_DIR, "control-master");
const DEFAULT_MOUNT_DIR = join(DEFAULT_PLUGIN_DIR, "mounts");

export class SessionManager {
	readonly sshBin: string;
	readonly sshfsBin: string;
	readonly controlDir: string;
	readonly mountDir: string;
	readonly platform: NodeJS.Platform;
	readonly controlPersist: string;
	readonly supportsControlMaster: boolean;
	readonly connectTimeoutSeconds: number;
	readonly connectionAttempts: number;
	readonly serverAliveIntervalSeconds: number;
	readonly serverAliveCountMax: number;
	readonly failureBackoffMs: number;

	readonly #sessions = new Map<string, Session>();
	readonly #pending = new Map<string, Promise<Session>>();
	readonly #failures = new Map<string, HostFailureState>();
	readonly #mounts = new Map<string, MountState>();
	readonly #mountProbe: MountProbe;
	readonly #unmountMount: MountUnmounter;

	constructor(options: SessionManagerOptions = {}) {
		this.sshBin = options.sshBin ?? process.env.SSH_EXEC_SSH_BIN ?? "ssh";
		this.sshfsBin = options.sshfsBin ?? process.env.SSH_EXEC_SSHFS_BIN ?? "sshfs";
		this.controlDir = options.controlDir ?? process.env.SSH_EXEC_CONTROL_DIR ?? DEFAULT_CONTROL_DIR;
		this.mountDir = options.mountDir ?? process.env.SSH_EXEC_MOUNT_DIR ?? DEFAULT_MOUNT_DIR;
		this.platform = options.platform ?? process.platform;
		this.controlPersist = options.controlPersist ?? "3600";
		this.supportsControlMaster = options.supportsControlMaster ?? this.platform !== "win32";
		this.connectTimeoutSeconds = clampPositiveInt(options.connectTimeoutSeconds, 5);
		this.connectionAttempts = clampPositiveInt(options.connectionAttempts, 1);
		this.serverAliveIntervalSeconds = clampPositiveInt(options.serverAliveIntervalSeconds, 5);
		this.serverAliveCountMax = clampPositiveInt(options.serverAliveCountMax, 1);
		this.failureBackoffMs = Math.max(0, options.failureBackoffMs ?? 15_000);
		this.#mountProbe = options.mountProbe ?? (async (mountPath) => await this.probeMount(mountPath));
		this.#unmountMount = options.unmountMount ?? (async (mountPath) => await this.unmountPath(mountPath));
	}

	get(host: string): Session {
		const existing = this.#sessions.get(host);
		if (existing) return existing;

		const session: Session = {
			host,
			socketPath: join(this.controlDir, `${sanitizeHostForSocket(host)}.sock`),
			lastUsed: 0,
			status: "reconnecting",
		};
		this.#sessions.set(host, session);
		return session;
	}

	getMountPath(host: string): string {
		return join(this.mountDir, sanitizeHostForSocket(host));
	}

	async ensureConnected(host: string, runner: ProcessRunner): Promise<Session> {
		this.assertHostAvailable(host);
		const pending = this.#pending.get(host);
		if (pending) return await pending;

		const promise = this.connect(host, runner);
		this.#pending.set(host, promise);
		try {
			return await promise;
		} finally {
			this.#pending.delete(host);
		}
	}

	async ensureMounted(host: string, runner: ProcessRunner): Promise<SshMountResult> {
		this.assertMountPlatformSupported();
		await this.ensureConnected(host, runner);
		await this.ensureMountDir();

		const mountPath = this.getMountPath(host);
		await mkdir(mountPath, { recursive: true, mode: 0o700 });
		await chmod(mountPath, 0o700).catch(() => {});

		const current = await this.#mountProbe(mountPath);
		if (current.mounted && current.healthy) {
			this.#mounts.set(host, { host, mountPath, lastUsed: Date.now() });
			return { host, localPath: mountPath, status: "reused" };
		}

		let status: SshMountStatus = "mounted";
		if (current.mounted || (await this.directoryHasEntries(mountPath))) {
			await this.#unmountMount(mountPath).catch(() => false);
			status = "remounted";
		}

		const session = this.get(host);
		const result = await this.runBinary(this.sshfsBin, this.buildSshfsArgs(session, mountPath), 20_000);
		if (result.exitCode !== 0) {
			const detail = result.stderr.trim() || result.stdout.trim();
			const suffix = detail ? `: ${this.sanitize(detail)}` : "";
			throw new Error(`Failed to mount ${host} at ${mountPath}${suffix}`);
		}

		const mounted = await this.#mountProbe(mountPath);
		if (!mounted.mounted || !mounted.healthy) {
			throw new Error(`Mounted ${host} at ${mountPath}, but the mount probe did not report a healthy sshfs mount`);
		}

		this.#mounts.set(host, { host, mountPath, lastUsed: Date.now() });
		return { host, localPath: mountPath, status };
	}

	async closeAll(runner: ProcessRunner, timeoutMs = 5_000): Promise<void> {
		const mounts = Array.from(this.#mounts.values());
		await Promise.allSettled(
			mounts.map(async (mount) => {
				try {
					await this.#unmountMount(mount.mountPath);
				} catch {
					// Cleanup is best-effort.
				} finally {
					this.#mounts.delete(mount.host);
				}
			}),
		);

		const sessions = Array.from(this.#sessions.values());
		await Promise.allSettled(
			sessions.map(async (session) => {
				try {
					await runner(this.buildControlArgs(session, "exit"), timeoutMs);
				} catch {
					// Cleanup is best-effort. Callers should not block on failed exits.
				} finally {
					this.#sessions.delete(session.host);
					await this.removeSocketIfPresent(session.socketPath);
				}
			}),
		);
	}

	buildRunArgs(session: Session, command: string): string[] {
		return [...this.buildCommonArgs(session), session.host, command];
	}

	sensitiveValues(host?: string): string[] {
		const values = Array.from(this.#sessions.values(), (session) => session.socketPath);
		if (host) values.push(this.get(host).socketPath);
		values.push(this.controlDir);
		return values;
	}

	sanitize(value: string): string {
		let sanitized = value;
		for (const session of this.#sessions.values()) {
			sanitized = sanitized.split(session.socketPath).join("<control-socket>");
		}
		sanitized = sanitized.split(this.controlDir).join("<control-socket-dir>");
		return sanitized;
	}

	buildControlArgs(session: Session, operation: "check" | "exit"): string[] {
		return ["-O", operation, ...this.buildCommonArgs(session), session.host];
	}

	buildStartArgs(session: Session): string[] {
		return ["-M", "-N", "-f", ...this.buildCommonArgs(session), session.host];
	}

	buildCommonArgs(session?: Session): string[] {
		const args = [
			"-n",
			"-o",
			`ConnectTimeout=${this.connectTimeoutSeconds}`,
			"-o",
			`ConnectionAttempts=${this.connectionAttempts}`,
			"-o",
			`ServerAliveInterval=${this.serverAliveIntervalSeconds}`,
			"-o",
			`ServerAliveCountMax=${this.serverAliveCountMax}`,
			"-o",
			"BatchMode=yes",
			"-o",
			"StrictHostKeyChecking=accept-new",
		];

		if (this.supportsControlMaster && session) {
			args.push(
				"-S",
				session.socketPath,
				"-o",
				"ControlMaster=auto",
				"-o",
				`ControlPersist=${this.controlPersist}`,
			);
		}

		return args;
	}

	buildSshfsArgs(session: Session, mountPath: string): string[] {
		const args = [
			"-o",
			"reconnect",
			"-o",
			`ServerAliveInterval=${this.serverAliveIntervalSeconds}`,
			"-o",
			`ServerAliveCountMax=${this.serverAliveCountMax}`,
			"-o",
			"BatchMode=yes",
			"-o",
			"StrictHostKeyChecking=accept-new",
		];

		if (this.supportsControlMaster) {
			args.push(
				"-o",
				"ControlMaster=auto",
				"-o",
				`ControlPath=${session.socketPath}`,
				"-o",
				`ControlPersist=${this.controlPersist}`,
			);
		}

		args.push(`${session.host}:/`, mountPath);
		return args;
	}

	private async connect(host: string, runner: ProcessRunner): Promise<Session> {
		const session = this.get(host);
		session.status = "reconnecting";

		if (!this.supportsControlMaster) {
			session.status = "connected";
			session.lastUsed = Date.now();
			this.markHostSuccess(host);
			return session;
		}

		await this.ensureControlDir();
		await this.removeStaleSocket(session.socketPath);

		try {
			const check = await runner(this.buildControlArgs(session, "check"), 10_000);
			if (check.exitCode !== 0) {
				await this.removeSocketIfPresent(session.socketPath);
				const start = await runner(this.buildStartArgs(session), 15_000);
				if (start.exitCode !== 0) {
					const detail = start.stderr.trim() || start.stdout.trim();
					const suffix = detail ? `: ${this.sanitize(detail)}` : "";
					throw new Error(`Failed to start SSH master for ${host}${suffix}`);
				}
			}

			session.status = "connected";
			session.lastUsed = Date.now();
			this.markHostSuccess(host);
			return session;
		} catch (error) {
			this.#sessions.delete(host);
			await this.removeSocketIfPresent(session.socketPath);
			this.markHostFailure(host);
			throw error;
		}
	}

	private assertHostAvailable(host: string): void {
		const failure = this.#failures.get(host);
		if (!failure) return;
		if (failure.blockedUntil <= Date.now()) {
			this.#failures.delete(host);
			return;
		}

		const waitMs = failure.blockedUntil - Date.now();
		throw new Error(`SSH host ${host} is temporarily blocked after repeated failures (${Math.ceil(waitMs / 1000)}s remaining)`);
	}

	private markHostSuccess(host: string): void {
		this.#failures.delete(host);
	}

	private markHostFailure(host: string): void {
		const current = this.#failures.get(host);
		const failures = (current?.failures ?? 0) + 1;
		this.#failures.set(host, {
			failures,
			blockedUntil: Date.now() + this.failureBackoffMs,
		});
	}

	private assertMountPlatformSupported(): void {
		if (supportsSshfsMountPlatform(this.platform)) return;
		throw new Error(`ssh_mount is currently supported only on Linux and macOS hosts running Codex locally; current platform is ${this.platform}`);
	}

	private async ensureControlDir(): Promise<void> {
		await mkdir(this.controlDir, { recursive: true, mode: 0o700 });
		await chmod(this.controlDir, 0o700);
	}

	private async ensureMountDir(): Promise<void> {
		await mkdir(this.mountDir, { recursive: true, mode: 0o700 });
		await chmod(this.mountDir, 0o700).catch(() => {});
	}

	private async directoryHasEntries(path: string): Promise<boolean> {
		try {
			return (await readdir(path)).length > 0;
		} catch {
			return false;
		}
	}

	private async probeMount(mountPath: string): Promise<MountProbeResult> {
		try {
			const stats = await stat(mountPath);
			if (!stats.isDirectory()) return { mounted: false, healthy: false };
		} catch {
			return { mounted: false, healthy: false };
		}

		const result = await this.runBinary("mount", [], 5_000, { tolerateMissingBinary: true });
		if (result.exitCode !== 0) return { mounted: false, healthy: false };

		const output = result.stdout || result.output || "";
		const mounted = output.split("\n").some((line) => line.includes(` on ${mountPath} `));
		return { mounted, healthy: mounted };
	}

	private async unmountPath(mountPath: string): Promise<boolean> {
		const strategies = this.platform === "linux"
			? [
				{ bin: "fusermount", args: ["-u", mountPath] },
				{ bin: "fusermount3", args: ["-u", mountPath] },
				{ bin: "umount", args: [mountPath] },
			]
			: [{ bin: "umount", args: [mountPath] }];

		for (const strategy of strategies) {
			const result = await this.runBinary(strategy.bin, strategy.args, 10_000, { tolerateMissingBinary: true });
			if (result.exitCode === 0) return true;
			if (result.notice !== `${strategy.bin} not found`) return false;
		}

		return false;
	}

	private async runBinary(
		bin: string,
		args: string[],
		timeoutMs: number,
		options: { tolerateMissingBinary?: boolean } = {},
	): Promise<ProcessResult> {
		let child: ReturnType<typeof Bun.spawn>;
		try {
			child = Bun.spawn([bin, ...args], {
				stdin: "ignore",
				stdout: "pipe",
				stderr: "pipe",
			});
		} catch (error) {
			if (options.tolerateMissingBinary && isMissingBinary(error)) {
				return {
					exitCode: null,
					stdout: "",
					stderr: "",
					output: "",
					notice: `${bin} not found`,
				};
			}
			if (isMissingBinary(error)) {
				throw new Error(`${bin} binary not found on PATH`);
			}
			throw error;
		}

		const timeout = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
		try {
			const [stdoutBytes, stderrBytes, exitCode] = await Promise.all([
				child.stdout ? new Response(child.stdout).bytes() : new Uint8Array(),
				child.stderr ? new Response(child.stderr).bytes() : new Uint8Array(),
				child.exited,
			]);
			const stdout = new TextDecoder().decode(stdoutBytes);
			const stderr = new TextDecoder().decode(stderrBytes);
			return {
				exitCode,
				stdout,
				stderr,
				output: `${stdout}${stderr}`,
				truncated: false,
			};
		} finally {
			clearTimeout(timeout);
		}
	}

	private async removeStaleSocket(socketPath: string): Promise<void> {
		try {
			const stats = await stat(socketPath);
			if (stats.isFile()) {
				await rm(socketPath, { force: true });
			}
		} catch {
			// Missing path is expected.
		}
	}

	private async removeSocketIfPresent(socketPath: string): Promise<void> {
		try {
			await rm(socketPath, { force: true });
		} catch {
			// Cleanup is best-effort.
		}
	}
}

function clampPositiveInt(value: number | undefined, fallback: number): number {
	const raw = value ?? fallback;
	if (!Number.isFinite(raw) || raw <= 0) return fallback;
	return Math.max(1, Math.floor(raw));
}

function isMissingBinary(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	return "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}

export function sanitizeHostForSocket(host: string): string {
	const readable = host.replace(/[^A-Za-z0-9_.@:-]+/g, "_").replace(/^_+|_+$/g, "");
	const prefix = (readable || "host").slice(0, 42);
	const digest = createHash("sha1").update(host).digest("hex").slice(0, 12);
	return `${prefix}-${digest}`;
}

export function supportsSshfsMountPlatform(platform: NodeJS.Platform = process.platform): boolean {
	return platform === "linux" || platform === "darwin";
}
