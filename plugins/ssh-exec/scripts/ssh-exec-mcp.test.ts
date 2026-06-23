import { expect, test } from "bun:test";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMcpServer, runCleanupSshProcess } from "./ssh-exec-mcp";
import { SessionManager } from "./session-manager";
import type { SshExecArgs, SshExecResult } from "./ssh-exec";

test("MCP initialize and tools/list expose only ssh_exec", async () => {
  const server = createMcpServer({ execute: successfulExecute });

  const initialize = await server.handle({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } },
  });
  const tools = await server.handle({ jsonrpc: "2.0", id: 2, method: "tools/list" });

  expect(initialize).toMatchObject({
    jsonrpc: "2.0",
    id: 1,
    result: {
      protocolVersion: "2025-06-18",
      serverInfo: { name: "ssh-exec-mcp", version: "0.1.0" },
    },
  });
  expect(tools.result.tools.map((tool: { name: string }) => tool.name)).toEqual(["ssh_exec"]);
  expect(tools.result.tools[0]).toMatchObject({
    name: "ssh_exec",
    description: expect.stringContaining("50 KiB"),
    inputSchema: {
      type: "object",
      properties: {
        timeout: { type: "number", default: 60 },
      },
      required: ["host", "command"],
    },
  });
});

test("tools/call rejects unsafe host values before reaching SSH", async () => {
  let calls = 0;
  const server = createMcpServer({
    execute: async (args) => {
      calls += 1;
      return successfulExecute(args);
    },
  });

  const response = await server.handle({
    jsonrpc: "2.0",
    id: 6,
    method: "tools/call",
    params: { name: "ssh_exec", arguments: { host: "-oProxyCommand=sh", command: "say-hello" } },
  });

  expect(response.error?.code).toBe(-32602);
  expect(calls).toBe(0);
});

test("tools/call ssh_exec returns text content and structuredContent", async () => {
  const server = createMcpServer({ execute: successfulExecute });

  const response = await server.handle({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "ssh_exec", arguments: { host: "prod", command: "say-hello" } },
  });

  expect(response.error).toBeUndefined();
  expect(response.result).toEqual({
    content: [{ type: "text", text: "hello\nwarn\n" }],
    structuredContent: {
      host: "prod",
      exitCode: 0,
      stdout: "hello\n",
      stderr: "warn\n",
      durationMs: 12,
      truncated: false,
    },
  });
});

test("tools/call ssh_exec renders combined output when stdout and stderr are interleaved", async () => {
  const server = createMcpServer({
    execute: async (args) => ({
      host: args.host,
      exitCode: 0,
      stdout: "out-1\nout-2\n",
      stderr: "err-1\nerr-2\n",
      output: "out-1\nerr-1\nout-2\nerr-2\n",
      durationMs: 12,
      truncated: false,
    }),
  });

  const response = await server.handle({
    jsonrpc: "2.0",
    id: 11,
    method: "tools/call",
    params: { name: "ssh_exec", arguments: { host: "prod", command: "interleaved" } },
  });

  expect(response.result.content[0].text).toBe("out-1\nerr-1\nout-2\nerr-2\n");
  expect(response.result.structuredContent.output).toBe("out-1\nerr-1\nout-2\nerr-2\n");
});

test("tools/call marks non-zero SSH exits as tool errors", async () => {
  const server = createMcpServer({
    execute: async (args) => ({
      host: args.host,
      exitCode: 7,
      stdout: "bad output\n",
      stderr: "bad err\n",
      durationMs: 10,
      truncated: false,
    }),
  });

  const response = await server.handle({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "ssh_exec", arguments: { host: "prod", command: "fail-command" } },
  });

  expect(response.result.isError).toBe(true);
  expect(response.result.content[0].text).toBe("bad output\nbad err\n\nCommand exited with code 7");
  expect(response.result.structuredContent.exitCode).toBe(7);
  expect(response.result.structuredContent.notice).toBe("Command exited with code 7");
});

test("tools/call marks timeout SSH results as tool errors with captured output", async () => {
  const server = createMcpServer({
    execute: async (args) => ({
      host: args.host,
      exitCode: null,
      stdout: "before timeout\n",
      stderr: "timeout err\n",
      durationMs: 1000,
      truncated: false,
      notice: "SSH command timed out after 1s",
    }),
  });

  const response = await server.handle({
    jsonrpc: "2.0",
    id: 9,
    method: "tools/call",
    params: { name: "ssh_exec", arguments: { host: "prod", command: "slow-output", timeout: 1 } },
  });

  expect(response.result.isError).toBe(true);
  expect(response.result.content[0].text).toBe(
    "before timeout\ntimeout err\n\nSSH command timed out after 1s",
  );
  expect(response.result.structuredContent.exitCode).toBeNull();
  expect(response.result.structuredContent.notice).toBe("SSH command timed out after 1s");
});

test("default MCP executor returns timeout tail instead of dropping captured output", async () => {
  const tmpRoot = await mkdtemp(join(tmpdir(), "ssh-exec-mcp-timeout-test-"));
  const fakeSsh = join(tmpRoot, "fake-timeout-ssh.ts");
  await Bun.write(
    fakeSsh,
    `#!/usr/bin/env bun
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
const args = process.argv.slice(2);
const socketPath = args[args.indexOf("-S") + 1];
if (args.includes("-O") && args.includes("check")) process.exit(255);
if (args.includes("-M") && args.includes("-N") && args.includes("-f")) {
  await mkdir(dirname(socketPath), { recursive: true });
  await Bun.write(socketPath, "master");
  process.exit(0);
}
process.stdout.write("partial before timeout\\n");
await Bun.sleep(2000);
process.exit(0);
`,
  );
  await chmod(fakeSsh, 0o755);

  try {
    const server = createMcpServer({
      manager: new SessionManager({ sshBin: fakeSsh, controlDir: join(tmpRoot, "control") }),
    });
    const response = await server.handle({
      jsonrpc: "2.0",
      id: 10,
      method: "tools/call",
      params: { name: "ssh_exec", arguments: { host: "prod", command: "slow", timeout: 1 } },
    });

    expect(response.result.isError).toBe(true);
    expect(response.result.content[0].text).toContain("partial before timeout");
    expect(response.result.content[0].text).toContain("timed out");
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

test("malformed ssh_exec arguments return a JSON-RPC invalid params error", async () => {
  const server = createMcpServer({ execute: successfulExecute });

  const response = await server.handle({
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: { name: "ssh_exec", arguments: { host: "prod" } },
  });

  expect(response).toMatchObject({
    jsonrpc: "2.0",
    id: 5,
    error: {
      code: -32602,
    },
  });
});

test("cleanup runner captures ssh stdout and stderr", async () => {
  const tmpRoot = await mkdtemp(join(tmpdir(), "ssh-exec-cleanup-test-"));
  const fakeSsh = join(tmpRoot, "fake-cleanup-ssh.ts");
  await Bun.write(
    fakeSsh,
    `#!/usr/bin/env bun
process.stdout.write("cleanup out\\n");
process.stderr.write("cleanup err\\n");
process.exit(3);
`,
  );
  await chmod(fakeSsh, 0o755);

  try {
    const result = await runCleanupSshProcess(fakeSsh, ["-O", "exit"], 1000);
    expect(result).toMatchObject({
      exitCode: 3,
      stdout: "cleanup out\n",
      stderr: "cleanup err\n",
      output: "cleanup out\ncleanup err\n",
      truncated: false,
    });
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

test("stdio server exits after stdin closes and cleanup runs", async () => {
  const tmpRoot = await mkdtemp(join(tmpdir(), "ssh-exec-stdio-exit-test-"));
  const fakeSsh = join(tmpRoot, "fake-stdio-ssh.ts");
  await Bun.write(
    fakeSsh,
    `#!/usr/bin/env bun
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
const args = process.argv.slice(2);
const logPath = ${JSON.stringify(join(tmpRoot, "cleanup.log"))};
const socketPath = args[args.indexOf("-S") + 1];
if (args.includes("-O") && args.includes("check")) process.exit(socketPath && await Bun.file(socketPath).exists() ? 0 : 255);
if (args.includes("-O") && args.includes("exit")) {
  await appendFile(logPath, "cleanup\\n");
  process.exit(0);
}
if (args.includes("-M") && args.includes("-N") && args.includes("-f")) {
  await mkdir(dirname(socketPath), { recursive: true });
  await Bun.write(socketPath, "master");
  process.exit(0);
}
process.stdout.write("ok\\n");
process.exit(0);
`,
  );
  await chmod(fakeSsh, 0o755);

  const child = Bun.spawn(["bun", new URL("./ssh-exec-mcp.ts", import.meta.url).pathname], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      SSH_EXEC_SSH_BIN: fakeSsh,
      SSH_EXEC_CONTROL_DIR: join(tmpRoot, "control"),
    },
  });
  child.stdin.write(
    '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"ssh_exec","arguments":{"host":"prod","command":"ok","timeout":2}}}\n',
  );
  child.stdin.end();

  let timeout: Timer | undefined;
  try {
    const exited = await Promise.race([
      child.exited,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          child.kill("SIGTERM");
          reject(new Error("stdio server did not exit after stdin closed"));
        }, 1500);
      }),
    ]);
    expect(exited).toBe(0);
  } finally {
    if (timeout) clearTimeout(timeout);
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

async function successfulExecute(args: SshExecArgs): Promise<SshExecResult> {
  return {
    host: args.host,
    exitCode: 0,
    stdout: "hello\n",
    stderr: "warn\n",
    durationMs: 12,
    truncated: false,
  };
}
