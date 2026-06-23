import { createHash } from "node:crypto";
import { chmod, mkdir } from "node:fs/promises";
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
}

const DEFAULT_CONTROL_DIR = join(homedir(), ".codex", "plugins", "ssh-exec", "control-master");

export class SessionManager {
  readonly sshBin: string;
  readonly controlDir: string;
  readonly controlPersist: string;
  readonly supportsControlMaster: boolean;

  private readonly sessions = new Map<string, Session>();
  private readonly pending = new Map<string, Promise<Session>>();

  constructor(options: SessionManagerOptions = {}) {
    this.sshBin = options.sshBin ?? process.env.SSH_EXEC_SSH_BIN ?? "ssh";
    this.controlDir = options.controlDir ?? process.env.SSH_EXEC_CONTROL_DIR ?? DEFAULT_CONTROL_DIR;
    this.controlPersist = options.controlPersist ?? "3600";
    this.supportsControlMaster = options.supportsControlMaster ?? process.platform !== "win32";
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

  async closeAll(runner: ProcessRunner): Promise<void> {
    const sessions = Array.from(this.sessions.values());
    await Promise.allSettled(
      sessions.map((session) =>
        runner(this.buildControlArgs(session, "exit"), 5_000),
      ),
    );
  }

  buildRunArgs(session: Session, command: string): string[] {
    return [...this.buildCommonArgs(session), session.host, command];
  }

  sensitiveValues(host?: string): string[] {
    const values = Array.from(this.sessions.values(), (session) => session.socketPath);
    if (host) {
      values.push(this.get(host).socketPath);
    }
    values.push(this.controlDir);
    return values;
  }

  private async connect(host: string, runner: ProcessRunner): Promise<Session> {
    const session = this.get(host);
    session.status = "reconnecting";
    if (!this.supportsControlMaster) {
      session.status = "connected";
      session.lastUsed = Date.now();
      return session;
    }
    await this.ensureControlDir();

    const check = await runner(this.buildControlArgs(session, "check"), 10_000);
    if (check.exitCode !== 0) {
      const start = await runner(this.buildStartArgs(session), 15_000);
      if (start.exitCode !== 0) {
        const detail = start.stderr.trim() || start.stdout.trim();
        const suffix = detail ? `: ${this.sanitize(detail)}` : "";
        throw new Error(`Failed to start SSH master for ${host}${suffix}`);
      }
    }

    session.status = "connected";
    session.lastUsed = Date.now();
    return session;
  }

  sanitize(value: string): string {
    let sanitized = value;
    for (const session of this.sessions.values()) {
      sanitized = sanitized.split(session.socketPath).join("<control-socket>");
    }
    sanitized = sanitized.split(this.controlDir).join("<control-socket-dir>");
    return sanitized;
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
    const args = ["-n"];
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
    args.push("-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new");
    return args;
  }
}

export function sanitizeHostForSocket(host: string): string {
  const readable = host.replace(/[^A-Za-z0-9_.@:-]+/g, "_").replace(/^_+|_+$/g, "");
  const prefix = (readable || "host").slice(0, 42);
  const digest = createHash("sha1").update(host).digest("hex").slice(0, 12);
  return `${prefix}-${digest}`;
}
