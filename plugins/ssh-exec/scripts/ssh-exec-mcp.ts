#!/usr/bin/env bun

import { SessionManager } from "./session-manager";
import type { ProcessResult } from "./session-manager";
import {
  executeSshExec,
  readProcessOutputTail,
  validateSshExecArgs,
  type SshExecArgs,
  type SshExecResult,
} from "./ssh-exec";

type JsonRpcId = string | number | null;

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

interface McpServerOptions {
  execute?: (args: SshExecArgs) => Promise<SshExecResult>;
  manager?: SessionManager;
}

interface SshExecStructuredContent {
  host: string;
  exitCode: number | null;
  durationMs: number;
  truncated: boolean;
  totalBytes?: number;
  outputBytes?: number;
  totalLines?: number;
  outputLines?: number;
  notice?: string;
}

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "ssh-exec-mcp", version: "0.1.0" };

const SSH_EXEC_TOOL = {
  name: "ssh_exec",
  description:
    "Run non-interactive command on remote OpenSSH destination. Returns combined 50 KiB output tail structured exit metadata. Timeout defaults 10 seconds.",
  inputSchema: {
    type: "object",
    properties: {
      host: { type: "string" },
      command: { type: "string" },
      timeout: { type: "number", default: 10 },
    },
    required: ["host", "command"],
  },
};

export function createMcpServer(options: McpServerOptions = {}) {
  const manager = options.manager ?? new SessionManager();
  const execute =
    options.execute ??
    ((args: SshExecArgs) => executeSshExec(manager, args, { timeoutMode: "result" }));

  return {
    manager,
    async handle(message: JsonRpcRequest): Promise<JsonRpcResponse | undefined> {
      const id = message.id ?? null;
      try {
        switch (message.method) {
          case "initialize":
            return resultResponse(id, {
              protocolVersion: requestedProtocolVersion(message.params),
              capabilities: { tools: {} },
              serverInfo: SERVER_INFO,
            });
          case "notifications/initialized":
            return undefined;
          case "ping":
            return resultResponse(id, {});
          case "tools/list":
            return resultResponse(id, { tools: [SSH_EXEC_TOOL] });
          case "tools/call":
            return await handleToolCall(id, message.params, execute);
          default:
            return errorResponse(id, -32601, `Method not found: ${message.method}`);
        }
      } catch (error) {
        return errorResponse(id, -32603, error instanceof Error ? error.message : String(error));
      }
    },
  };
}

async function handleToolCall(
  id: JsonRpcId,
  params: unknown,
  execute: (args: SshExecArgs) => Promise<SshExecResult>,
): Promise<JsonRpcResponse> {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return errorResponse(id, -32602, "tools/call params must be an object");
  }
  const record = params as Record<string, unknown>;
  if (record.name !== "ssh_exec") {
    return errorResponse(id, -32602, "Unknown tool");
  }

  let args: SshExecArgs;
  try {
    args = validateSshExecArgs(record.arguments);
  } catch (error) {
    return errorResponse(id, -32602, error instanceof Error ? error.message : String(error));
  }

  try {
    const result = await execute(args);
    return resultResponse(id, toolResultFromSsh(result, result.exitCode !== 0 || result.exitCode === null));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return resultResponse(id, {
      isError: true,
      content: [{ type: "text", text: message }],
      structuredContent: {
        host: args.host,
        exitCode: null,
        durationMs: 0,
        truncated: false,
        notice: message,
      } satisfies SshExecStructuredContent,
    });
  }
}

function toolResultFromSsh(result: SshExecResult, isError: boolean) {
  const notice =
    result.notice ??
    (isError && result.exitCode !== null && result.exitCode !== 0
      ? `Command exited with code ${result.exitCode}`
      : undefined);
  const outputText = result.output ?? `${result.stdout}${result.stderr}`;
  const displayOutput = outputText ? outputText.trimEnd() : "(no output)";
  const text = notice ? `${displayOutput}\n\n${notice}` : outputText || "(no output)";
  const payload: Record<string, unknown> = {
    content: [{ type: "text", text }],
    structuredContent: structuredContentFromSsh(result, notice),
  };
  if (isError) payload.isError = true;
  return payload;
}

function structuredContentFromSsh(
  result: SshExecResult,
  notice?: string,
): SshExecStructuredContent {
  return {
    host: result.host,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    truncated: result.truncated,
    totalBytes: result.totalBytes,
    outputBytes: result.outputBytes,
    totalLines: result.totalLines,
    outputLines: result.outputLines,
    ...(notice ? { notice } : {}),
  };
}

function requestedProtocolVersion(params: unknown): string {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return PROTOCOL_VERSION;
  }
  const version = (params as Record<string, unknown>).protocolVersion;
  return typeof version === "string" && version.trim() ? version : PROTOCOL_VERSION;
}

function resultResponse(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function errorResponse(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcResponse {
  const error: JsonRpcResponse["error"] = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: "2.0", id, error };
}

export async function runStdio(server: ReturnType<typeof createMcpServer>): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = "";

  for await (const chunk of Bun.stdin.stream()) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      await handleLine(server, line);
    }
  }

  if (buffer.trim()) {
    await handleLine(server, buffer);
  }
}

export async function runCleanupSshProcess(
  sshBin: string,
  args: string[],
  timeoutMs = 5_000,
  sensitiveValues: string[] = [],
): Promise<ProcessResult> {
  const child = Bun.spawn([sshBin, ...args], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const timeout = setTimeout(() => child.kill("SIGTERM"), timeoutMs);

  try {
    const [output, exitCode] = await Promise.all([
      readProcessOutputTail(child.stdout, child.stderr, sensitiveValues),
      child.exited,
    ]);
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
  }
}

async function handleLine(server: ReturnType<typeof createMcpServer>, line: string): Promise<void> {
  if (!line.trim()) return;
  let response: JsonRpcResponse | undefined;
  try {
    response = await server.handle(JSON.parse(line));
  } catch (error) {
    response = errorResponse(
      null,
      -32700,
      "Parse error",
      error instanceof Error ? error.message : String(error),
    );
  }

  if (response) {
    process.stdout.write(`${JSON.stringify(response)}\n`);
  }
}

if (import.meta.main) {
  const server = createMcpServer();
  const runner = (args: string[], timeoutMs?: number) =>
    runCleanupSshProcess(server.manager.sshBin, args, timeoutMs, server.manager.sensitiveValues());

  let cleanupPromise: Promise<void> | undefined;
  const cleanup = async (budgetMs = 1_500) => {
    cleanupPromise ??= Promise.race([
      server.manager.closeAll(runner, Math.min(1_000, budgetMs)),
      new Promise<void>((resolve) => setTimeout(resolve, budgetMs)),
    ]).catch(() => undefined);
    await cleanupPromise;
  };

  process.once("beforeExit", () => {
    void cleanup();
  });
  process.on("SIGINT", () => {
    void cleanup().finally(() => process.exit(130));
  });
  process.on("SIGTERM", () => {
    void cleanup().finally(() => process.exit(143));
  });

  runStdio(server)
    .then(async () => {
      await cleanup();
      process.exit(0);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
      process.exit(1);
    });
}
