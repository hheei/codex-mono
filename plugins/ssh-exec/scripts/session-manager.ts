import { createHash } from "node:crypto";
import { chmod, mkdir, rm, stat } from "node:fs/promises";
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

export interface SessionManagerOptions {
  sshBin?: string;
  controlDir?: string;
  controlPersist?: string;
  supportsControlMaster?: boolean;
  connectTimeoutSeconds?: number;
  connectionAttempts?: number;
  serverAliveIntervalSeconds?: number;
  serverAliveCountMax?: number;
  failureBackoffMs?: number;
}

interface HostFailureState {
  failures: number;
  blockedUntil: number;
}

const DEFAULT_CONTROL_DIR = join(homedir(), ".codex", "plugins", "ssh-exec", "control-master");

export class SessionManager {
  readonly sshBin: string;
  readonly controlDir: string;
  readonly controlPersist: string;
  readonly supportsControlMaster: boolean;
  readonly connectTimeoutSeconds: number;
  readonly connectionAttempts: number;
  readonly serverAliveIntervalSeconds: number;
  readonly serverAliveCountMax: number;
  readonly failureBackoffMs: number;

  private readonly sessions = new Map<string, Session>();
  private readonly pending = new Map<string, Promise<Session>>();
  private readonly failures = new Map<string, HostFailureState>();

  constructor(options: SessionManagerOptions = {}) {
    this.sshBin = options.sshBin ?? process.env.SSH_EXEC_SSH_BIN ?? "ssh";
    this.controlDir = options.controlDir ?? process.env.SSH_EXEC_CONTROL_DIR ?? DEFAULT_CONTROL_DIR;
    this.controlPersist = options.controlPersist ?? "3600";
    this.supportsControlMaster = options.supportsControlMaster ?? process.platform !== "win32";
    this.connectTimeoutSeconds = clampPositiveInt(options.connectTimeoutSeconds, 5);
    this.connectionAttempts = clampPositiveInt(options.connectionAttempts, 1);
    this.serverAliveIntervalSeconds = clampPositiveInt(options.serverAliveIntervalSeconds, 5);
    this.serverAliveCountMax = clampPositiveInt(options.serverAliveCountMax, 1);
    this.failureBackoffMs = Math.max(0, options.failureBackoffMs ?? 15_000);
  }

  get(host: string): Session {
    const existing = this.sessions.get(host);
    if (existing) return existing;
    const session: Session = {
      host,
      socketPath: join(this.controlDir, `${sanitizeHostForSocket(host)}.sock`),
      lastUsed: 0,
      status: "reconnecting",
    };
    this.sessions.set(host, session);
    return session;
  }

  async ensureConnected(host: string, runner: ProcessRunner): Promise<Session> {
    this.assertHostAvailable(host);
    const pending = this.pending.get(host);
    if (pending) return pending;

    const promise = this.connect(host, runner);
    this.pending.set(host, promise);
    try {
      return await promise;
    } finally {
      this.pending.delete(host);
    }
  }

  async closeAll(runner: ProcessRunner, timeoutMs = 5_000): Promise<void> {
    const sessions = Array.from(this.sessions.values());
    await Promise.allSettled(
      sessions.map(async (session) => {
        try {
          await runner(this.buildControlArgs(session, "exit"), timeoutMs);
        } catch {
          // Cleanup is best-effort. Callers should not block on failed exits.
        } finally {
          this.sessions.delete(session.host);
          await this.removeSocketIfPresent(session.socketPath);
        }
      }),
    );
  }

  buildRunArgs(session: Session, command: string): string[] {
    return [...this.buildCommonArgs(session), session.host, command];
  }

  sensitiveValues(host?: string): string[] {
    const values = Array.from(this.sessions.values(), (session) => session.socketPath);
    if (host) values.push(this.get(host).socketPath);
    values.push(this.controlDir);
    return values;
  }

  sanitize(value: string): string {
    let sanitized = value;
    for (const session of this.sessions.values()) {
      sanitized = sanitized.split(session.socketPath).join("<control-socket>");
    }
    sanitized = sanitized.split(this.controlDir).join("<control-socket-dir>");
    return sanitized;
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
      this.sessions.delete(host);
      await this.removeSocketIfPresent(session.socketPath);
      this.markHostFailure(host);
      throw error;
    }
  }

  private async ensureControlDir(): Promise<void> {
    await mkdir(this.controlDir, { recursive: true, mode: 0o700 });
    await chmod(this.controlDir, 0o700);
  }

  private buildControlArgs(session: Session, operation: "check" | "exit"): string[] {
    return ["-O", operation, ...this.buildCommonArgs(session), session.host];
  }

  private buildStartArgs(session: Session): string[] {
    return ["-M", "-N", "-f", ...this.buildCommonArgs(session), session.host];
  }

  private buildCommonArgs(session?: Session): string[] {
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

  private assertHostAvailable(host: string): void {
    const failure = this.failures.get(host);
    if (!failure) return;
    if (failure.blockedUntil <= Date.now()) {
      this.failures.delete(host);
      return;
    }
    const waitMs = failure.blockedUntil - Date.now();
    throw new Error(`SSH host ${host} temporarily blocked after repeated failures (${Math.ceil(waitMs / 1000)}s remaining)`);
  }

  private markHostSuccess(host: string): void {
    this.failures.delete(host);
  }

  private markHostFailure(host: string): void {
    const current = this.failures.get(host);
    const failures = (current?.failures ?? 0) + 1;
    this.failures.set(host, {
      failures,
      blockedUntil: Date.now() + this.failureBackoffMs,
    });
  }

  private async removeStaleSocket(socketPath: string): Promise<void> {
    try {
      const info = await stat(socketPath);
      if (!info.isSocket()) {
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

export function sanitizeHostForSocket(host: string): string {
  const readable = host.replace(/[^A-Za-z0-9_.@:-]+/g, "_").replace(/^_+|_+$/g, "");
  const prefix = (readable || "host").slice(0, 42);
  const digest = createHash("sha1").update(host).digest("hex").slice(0, 12);
  return `${prefix}-${digest}`;
}
