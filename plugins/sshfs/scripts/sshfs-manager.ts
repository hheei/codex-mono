import { execFile } from "node:child_process";
import { chmod, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

interface ProcessResult {
	exitCode: number | null;
	stdout: string;
	stderr: string;
}

interface MountProbeResult {
	mounted: boolean;
	healthy: boolean;
}

interface SshfsManagerOptions {
	sshBin?: string;
	sshfsBin?: string;
	mountDir?: string;
	platform?: NodeJS.Platform;
	deadline?: () => number | undefined;
	mountProbe?: (mountPath: string) => Promise<MountProbeResult>;
	unmount?: (mountPath: string) => Promise<boolean>;
}

const DEFAULT_MOUNT_DIR = join(homedir(), ".codex", "plugins", "ssh");
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_OUTPUT_BYTES = 64 * 1024;
const MOUNT_ATTEMPTS = 2;
const SSH_OPTIONS = [
	"-o", "ConnectionAttempts=2",
	"-o", "ServerAliveInterval=300",
	"-o", "ServerAliveCountMax=3",
	"-o", "BatchMode=yes",
	"-o", "StrictHostKeyChecking=yes",
];

export class SshfsManager {
	readonly #sshBin: string;
	readonly #sshfsBin: string;
	readonly #mountDir: string;
	readonly #platform: NodeJS.Platform;
	readonly #deadline?: () => number | undefined;
	readonly #mountProbe: (mountPath: string) => Promise<MountProbeResult>;
	readonly #unmount: (mountPath: string) => Promise<boolean>;

	constructor(options: SshfsManagerOptions = {}) {
		this.#sshBin = options.sshBin ?? "ssh";
		this.#sshfsBin = options.sshfsBin ?? "sshfs";
		this.#mountDir = options.mountDir ?? DEFAULT_MOUNT_DIR;
		this.#platform = options.platform ?? process.platform;
		this.#deadline = options.deadline;
		this.#mountProbe = options.mountProbe ?? ((mountPath) => this.probeMount(mountPath));
		this.#unmount = options.unmount ?? ((mountPath) => this.unmountPath(mountPath));
	}

	async runSsh(host: string, command: string): Promise<ProcessResult> {
		return this.run(this.#sshBin, ["-n", ...SSH_OPTIONS, host, command]);
	}

	async ensureMounted(host: string): Promise<string> {
		this.assertPlatformSupported();
		await mkdir(this.#mountDir, { recursive: true, mode: 0o700 });
		await chmod(this.#mountDir, 0o700).catch(() => {});
		const mountPath = join(this.#mountDir, host);

		const current = await this.probe(mountPath);
		if (current.mounted && current.healthy) return mountPath;
		if (current.mounted && !(await this.#unmount(mountPath))) {
			throw new Error(`Cannot unmount unhealthy SSHFS mount for ${host}`);
		}
		await mkdir(mountPath, { recursive: true, mode: 0o700 });
		await chmod(mountPath, 0o700).catch(() => {});

		let failure = "mount probe did not report a healthy SSHFS mount";
		let failedMountPresent = false;
		for (let attempt = 1; attempt <= MOUNT_ATTEMPTS; attempt += 1) {
			const result = await this.run(this.#sshfsBin, [
				"-o", "reconnect",
				"-o", "follow_symlinks",
				...SSH_OPTIONS,
				`${host}:/`, mountPath,
			]);
			if (result.exitCode === 127) throw new Error("sshfs binary not found");
			const mounted = await this.probe(mountPath);
			failedMountPresent = mounted.mounted;
			if (result.exitCode === 0 && mounted.mounted && mounted.healthy) return mountPath;
			if (result.exitCode !== 0) {
				failure = result.stderr.trim() || result.stdout.trim() || `sshfs exited with ${result.exitCode}`;
			}
			if (attempt < MOUNT_ATTEMPTS && mounted.mounted) {
				if (!(await this.#unmount(mountPath).catch(() => false))) throw new Error(`Cannot clear failed SSHFS mount for ${host}`);
				failedMountPresent = false;
			}
		}

		if (failedMountPresent && !(await this.#unmount(mountPath).catch(() => false))) {
			throw new Error(`Cannot clear failed SSHFS mount for ${host}`);
		}
		throw new Error(`Failed to mount ${host}: ${failure}`);
	}

	private async probeMount(mountPath: string): Promise<MountProbeResult> {
		const result = await this.run("mount", []);
		const mounted = result.exitCode === 0 && result.stdout.split("\n").some((line) => line.includes(` on ${mountPath} `));
		if (!mounted) return { mounted: false, healthy: false };
		return { mounted: true, healthy: (await this.run("ls", ["-A", mountPath])).exitCode === 0 };
	}

	private probe(mountPath: string): Promise<MountProbeResult> {
		return this.withDeadline(this.#mountProbe(mountPath));
	}

	private async unmountPath(mountPath: string): Promise<boolean> {
		const strategies = this.#platform === "linux"
			? [["fusermount", "-u", mountPath], ["umount", mountPath]]
			: [["umount", mountPath], ["diskutil", "unmount", mountPath]];
		for (const [bin, ...args] of strategies) {
			if ((await this.run(bin, args)).exitCode === 0) return true;
		}
		return false;
	}

	private run(bin: string, args: string[]): Promise<ProcessResult> {
		return new Promise((resolve) => {
			execFile(bin, args, {
				encoding: "utf8",
				killSignal: "SIGKILL",
				maxBuffer: MAX_OUTPUT_BYTES,
				timeout: this.remainingMs(),
			}, (error, stdout, stderr) => {
				const code = error && "code" in error ? error.code : 0;
				resolve({
					exitCode: code === "ENOENT" ? 127 : typeof code === "number" ? code : error ? null : 0,
					stdout: String(stdout ?? ""),
					stderr: String(stderr ?? ""),
				});
			});
		});
	}

	private async withDeadline<T>(operation: Promise<T>): Promise<T> {
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			return await Promise.race([
				operation,
				new Promise<never>((_, reject) => {
					timer = setTimeout(() => reject(new Error("SSHFS operation exceeded its timeout budget")), this.remainingMs());
				}),
			]);
		} finally {
			if (timer) clearTimeout(timer);
		}
	}

	private remainingMs(): number {
		const deadline = this.#deadline?.();
		if (deadline === undefined) return DEFAULT_TIMEOUT_MS;
		const remaining = deadline - Date.now();
		if (remaining <= 0) throw new Error("SSHFS operation exceeded its timeout budget");
		return remaining;
	}

	private assertPlatformSupported(): void {
		if (this.#platform === "linux" || this.#platform === "darwin") return;
		throw new Error(`SSHFS is supported only on Linux and macOS; current platform is ${this.#platform}`);
	}
}
