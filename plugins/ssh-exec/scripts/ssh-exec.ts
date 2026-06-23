import { SessionManager, type ProcessResult } from "./session-manager";
import { OutputTailSink, type OutputSource } from "./output-tail-sink";

export const MAX_OUTPUT_BYTES = 50 * 1024;

export interface SshExecArgs {
  host: string;
  command: string;
  timeout?: number;
}

export interface SshExecResult {
  host: string;
  exitCode: number | null;
  output?: string;
  stdout: string;
  stderr: string;
  durationMs: number;
  truncated: boolean;
  totalBytes?: number;
  outputBytes?: number;
  totalLines?: number;
  outputLines?: number;
  notice?: string;
}

export interface ExecuteSshExecOptions {
  timeoutMode?: "throw" | "result";
}

export function validateSshExecArgs(value: unknown): SshExecArgs {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("ssh_exec arguments must be an object");
  }

  const record = value as Record<string, unknown>;
  if (typeof record.host !== "string" || record.host.trim() === "") {
    throw new Error("ssh_exec.host must be a non-empty string");
  }
  const command = record.command ?? record.cmd;
  if (typeof command !== "string" || command.trim() === "") {
    throw new Error("ssh_exec.command must be a non-empty string");
  }
  if (
    record.timeout !== undefined &&
    (typeof record.timeout !== "number" || !Number.isFinite(record.timeout))
  ) {
    throw new Error("ssh_exec.timeout must be a finite number");
  }

  return {
    host: validateHost(record.host),
    command,
    timeout: record.timeout as number | undefined,
  };
}

export async function executeSshExec(
  manager: SessionManager,
  args: SshExecArgs,
  options: ExecuteSshExecOptions = {},
): Promise<SshExecResult> {
  const startedAt = Date.now();
  const host = validateHost(args.host);
  const timeoutMs = clampTimeoutSeconds(args.timeout) * 1000;
  const session = manager.get(host);
  const runner = (sshArgs: string[], timeoutOverrideMs?: number) =>
    runSshProcess(manager.sshBin, sshArgs, timeoutOverrideMs ?? timeoutMs, {
      timeoutMode: options.timeoutMode ?? "throw",
      sensitiveValues: manager.sensitiveValues(host),
    });

  await manager.ensureConnected(host, runner);
  const result = await runner(manager.buildRunArgs(session, args.command));

  session.lastUsed = Date.now();
  return {
    host,
    exitCode: result.exitCode,
    output: result.output ?? `${result.stdout}${result.stderr}`,
    stdout: result.stdout,
    stderr: result.stderr,
    durationMs: Date.now() - startedAt,
    truncated: Boolean(result.truncated || result.stdoutTruncated || result.stderrTruncated),
    totalBytes: result.totalBytes,
    outputBytes: result.outputBytes,
    totalLines: result.totalLines,
    outputLines: result.outputLines,
    notice: result.notice ? manager.sanitize(result.notice) : undefined,
  };
}

export function validateHost(host: string): string {
  const trimmed = host.trim();
  if (!trimmed) {
    throw new Error("ssh_exec.host must be a non-empty string");
  }
  if (trimmed.startsWith("-")) {
    throw new Error("ssh_exec.host must not start with '-'");
  }
  if (/[\0\r\n\t ]/.test(trimmed)) {
    throw new Error("ssh_exec.host must not contain whitespace or control characters");
  }
  return trimmed;
}

export function clampTimeoutSeconds(value: number | undefined): number {
  const raw = value ?? 60;
  return Math.min(3600, Math.max(1, raw));
}

async function runSshProcess(
  sshBin: string,
  args: string[],
  timeoutMs: number,
  options: ExecuteSshExecOptions & { sensitiveValues?: string[] } = {},
): Promise<ProcessResult> {
  const child = Bun.spawn([sshBin, ...args], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  let timedOut = false;
  let killTimer: Timer | undefined;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
    killTimer = setTimeout(() => child.kill("SIGKILL"), 1000);
  }, timeoutMs);

  try {
    const [output, exitCode] = await Promise.all([
      readProcessOutputTail(child.stdout, child.stderr, options.sensitiveValues ?? []),
      child.exited,
    ]);
    if (timedOut) {
      const notice = `SSH command timed out after ${Math.round(timeoutMs / 1000)}s`;
      if (options.timeoutMode === "result") {
        return {
          exitCode: null,
          output: output.text,
          stdout: output.stdout,
          stderr: output.stderr,
          truncated: output.truncated,
          totalBytes: output.totalBytes,
          outputBytes: output.outputBytes,
          totalLines: output.totalLines,
          outputLines: output.outputLines,
          notice,
        };
      }
      throw new Error(notice);
    }
    return {
      exitCode,
      output: output.text,
      stdout: output.stdout,
      stderr: output.stderr,
      truncated: output.truncated,
      totalBytes: output.totalBytes,
      outputBytes: output.outputBytes,
      totalLines: output.totalLines,
      outputLines: output.outputLines,
    };
  } finally {
    clearTimeout(timeout);
    if (killTimer) clearTimeout(killTimer);
  }
}

export async function readProcessOutputTail(
  stdout: ReadableStream<Uint8Array> | null,
  stderr: ReadableStream<Uint8Array> | null,
  sensitiveValues: string[],
  maxBytes = MAX_OUTPUT_BYTES,
) {
  const sink = new OutputTailSink(maxBytes);
  await pipeStreamsToSink(stdout, stderr, sink, sensitiveValues);
  return sink.dump();
}

interface StreamState {
  source: OutputSource;
  reader: ReadableStreamDefaultReader<Uint8Array>;
  decoder: TextDecoder;
  redactor: StreamingRedactor;
  pending: Promise<ReadableStreamReadResult<Uint8Array>>;
}

async function pipeStreamsToSink(
  stdout: ReadableStream<Uint8Array> | null,
  stderr: ReadableStream<Uint8Array> | null,
  sink: OutputTailSink,
  sensitiveValues: string[],
): Promise<void> {
  const states: StreamState[] = [];
  if (stdout) states.push(createStreamState("stdout", stdout, sensitiveValues));
  if (stderr) states.push(createStreamState("stderr", stderr, sensitiveValues));

  try {
    while (states.length > 0) {
      const { index, state, result } = await Promise.race(
        states.map((state, index) => state.pending.then((result) => ({ index, state, result }))),
      );
      const { done, value } = result;
      if (done) {
        const flushed = state.redactor.write(state.decoder.decode()) + state.redactor.flush();
        if (flushed) sink.write(state.source, flushed);
        state.reader.releaseLock();
        states.splice(index, 1);
        continue;
      }
      if (value) {
        const text = state.decoder.decode(value, { stream: true });
        const redacted = state.redactor.write(text);
        if (redacted) sink.write(state.source, redacted);
      }
      state.pending = state.reader.read();
    }
  } finally {
    for (const state of states) {
      state.reader.releaseLock();
    }
  }
}

function createStreamState(
  source: OutputSource,
  stream: ReadableStream<Uint8Array>,
  sensitiveValues: string[],
): StreamState {
  const reader = stream.getReader();
  return {
    source,
    reader,
    decoder: new TextDecoder(),
    redactor: new StreamingRedactor(sensitiveValues),
    pending: reader.read(),
  };
}

class StreamingRedactor {
  private readonly values: string[];
  private readonly retainChars: number;
  private pending = "";

  constructor(values: string[]) {
    this.values = Array.from(new Set(values.filter(Boolean))).sort((a, b) => b.length - a.length);
    this.retainChars = Math.max(0, ...this.values.map((value) => value.length));
  }

  write(text: string): string {
    if (!text) return "";
    if (this.values.length === 0) return text;

    this.pending += text;
    let output = "";

    while (this.pending.length > 0) {
      const match = this.findEarliestMatch();
      if (match) {
        output += this.pending.slice(0, match.index);
        output += match.value.endsWith(".sock") ? "<control-socket>" : "<control-socket-dir>";
        this.pending = this.pending.slice(match.index + match.value.length);
        continue;
      }

      const emitLength = this.pending.length - this.retainChars;
      if (emitLength <= 0) break;
      output += this.pending.slice(0, emitLength);
      this.pending = this.pending.slice(emitLength);
    }

    return output;
  }

  flush(): string {
    const value = this.redact(this.pending);
    this.pending = "";
    return value;
  }

  private redact(text: string): string {
    let redacted = text;
    for (const value of this.values) {
      const replacement = value.endsWith(".sock") ? "<control-socket>" : "<control-socket-dir>";
      redacted = redacted.split(value).join(replacement);
    }
    return redacted;
  }

  private findEarliestMatch(): { index: number; value: string } | undefined {
    let match: { index: number; value: string } | undefined;
    for (const value of this.values) {
      const index = this.pending.indexOf(value);
      if (index === -1) continue;
      if (!match || index < match.index || (index === match.index && value.length > match.value.length)) {
        match = { index, value };
      }
    }
    return match;
  }
}
