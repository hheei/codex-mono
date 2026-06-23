export interface TailDump {
  text: string;
  stdout: string;
  stderr: string;
  truncated: boolean;
  totalBytes: number;
  outputBytes: number;
  totalLines: number;
  outputLines: number;
}

export type OutputSource = "stdout" | "stderr";

interface TailEntry {
  source: OutputSource;
  buffer: Buffer;
}

export class OutputTailSink {
  private entries: TailEntry[] = [];
  private didTruncate = false;
  private retainedBytes = 0;
  private writtenBytes = 0;
  private writtenLines = 0;

  constructor(private readonly maxBytes: number) {}

  write(chunk: Uint8Array | string): void;
  write(source: OutputSource, chunk: Uint8Array | string): void;
  write(sourceOrChunk: OutputSource | Uint8Array | string, maybeChunk?: Uint8Array | string): void {
    const source = maybeChunk === undefined ? "stdout" : (sourceOrChunk as OutputSource);
    const chunk = maybeChunk === undefined ? (sourceOrChunk as Uint8Array | string) : maybeChunk;
    const next = typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk);
    if (next.length === 0) return;

    this.entries.push({ source, buffer: next });
    this.retainedBytes += next.length;
    this.writtenBytes += next.length;
    this.writtenLines += countNewlines(next.toString("utf8"));
    this.trim();
  }

  dump(): TailDump {
    let text = "";
    let stdout = "";
    let stderr = "";
    for (const entry of this.entries) {
      const value = entry.buffer.toString("utf8");
      text += value;
      if (entry.source === "stdout") {
        stdout += value;
      } else {
        stderr += value;
      }
    }

    return {
      text,
      stdout,
      stderr,
      truncated: this.didTruncate,
      totalBytes: this.writtenBytes,
      outputBytes: this.retainedBytes,
      totalLines: this.writtenLines,
      outputLines: countNewlines(text),
    };
  }

  private trim(): void {
    if (this.maxBytes <= 0) {
      if (this.entries.length > 0) this.didTruncate = true;
      this.entries = [];
      this.retainedBytes = 0;
      return;
    }

    while (this.retainedBytes > this.maxBytes && this.entries.length > 0) {
      this.didTruncate = true;
      const excess = this.retainedBytes - this.maxBytes;
      const first = this.entries[0];
      if (first.buffer.length <= excess) {
        this.retainedBytes -= first.buffer.length;
        this.entries.shift();
        continue;
      }

      const start = findUtf8BoundaryForward(first.buffer, excess);
      this.retainedBytes -= start;
      first.buffer = first.buffer.subarray(start);
      if (first.buffer.length === 0) {
        this.entries.shift();
      }
      break;
    }
  }
}

export async function readStreamTail(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<TailDump> {
  const sink = new OutputTailSink(maxBytes);
  if (!stream) return sink.dump();

  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) sink.write(value);
    }
  } finally {
    reader.releaseLock();
  }

  return sink.dump();
}

function countNewlines(text: string): number {
  let count = 0;
  let index = text.indexOf("\n");
  while (index !== -1) {
    count += 1;
    index = text.indexOf("\n", index + 1);
  }
  return count;
}

function findUtf8BoundaryForward(buffer: Buffer, position: number): number {
  let index = Math.max(0, Math.min(position, buffer.length));
  while (index < buffer.length && (buffer[index] & 0xc0) === 0x80) {
    index += 1;
  }
  return index;
}
