import { expect, test } from "bun:test";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMcpServer, runCleanupSshProcess } from "./ssh-exec-mcp";
import { SessionManager } from "./session-manager";
import type { SshMountArgs } from "./ssh-mount";
import type { SshExecArgs, SshExecResult } from "./ssh-exec";

test("MCP initialize and tools/list expose ssh_exec and ssh_mount", async () => {
	const server = createMcpServer({ execute: successfulExecute });

	const initialize = await server.handle({
		jsonrpc: "2.0",
		id: 1,
		method: "initialize",
		params: {
			protocolVersion: "2025-06-18",
			capabilities: {},
			clientInfo: { name: "test", version: "0" },
		},
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
	expect((tools as { result: { tools: Array<{ name: string }> } }).result.tools.map((tool) => tool.name)).toEqual([
		"ssh_exec",
		"ssh_mount",
	]);
});

test("tools/call rejects unsafe ssh_exec and ssh_mount hosts before execution", async () => {
	let execCalls = 0;
	let mountCalls = 0;
	const server = createMcpServer({
		execute: async (args: SshExecArgs) => {
			execCalls += 1;
			return await successfulExecute(args);
		},
		mount: async (args: SshMountArgs) => {
			mountCalls += 1;
			return { host: args.host, localPath: "/tmp/ssh-mount/prod", status: "mounted" };
		},
	});

	const execResponse = await server.handle({
		jsonrpc: "2.0",
		id: 3,
		method: "tools/call",
		params: { name: "ssh_exec", arguments: { host: "-bad", command: "ok" } },
	});
	const mountResponse = await server.handle({
		jsonrpc: "2.0",
		id: 4,
		method: "tools/call",
		params: { name: "ssh_mount", arguments: { host: "-bad" } },
	});

	expect(execCalls).toBe(0);
	expect(mountCalls).toBe(0);
	expect(execResponse).toMatchObject({ jsonrpc: "2.0", id: 3, error: { code: -32602 } });
	expect(mountResponse).toMatchObject({ jsonrpc: "2.0", id: 4, error: { code: -32602 } });
});

test("tools/call returns ssh_mount local path and Codex file-tool hint", async () => {
	const server = createMcpServer({
		mount: async (args: SshMountArgs) => ({
			host: args.host,
			localPath: "/tmp/ssh-mount/prod",
			status: "remounted",
		}),
	});

	const response = await server.handle({
		jsonrpc: "2.0",
		id: 5,
		method: "tools/call",
		params: { name: "ssh_mount", arguments: { host: "prod" } },
	});
	const result = (response as { result: { content: Array<{ text: string }>; structuredContent: Record<string, unknown> } }).result;

	expect(result.content[0]?.text).toContain("Remounted prod.");
	expect(result.content[0]?.text).toContain("Local path: /tmp/ssh-mount/prod");
	expect(result.content[0]?.text).toContain("Next: use built-in read, edit, or write");
	expect(result.structuredContent).toEqual({
		host: "prod",
		localPath: "/tmp/ssh-mount/prod",
		status: "remounted",
	});
});

test("default MCP executor keeps timeout tail output for ssh_exec", async () => {
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
			id: 6,
			method: "tools/call",
			params: { name: "ssh_exec", arguments: { host: "prod", command: "slow", timeout: 1 } },
		});
		const text = (response as { result: { isError: boolean; content: Array<{ text: string }> } }).result.content[0]?.text ?? "";

		expect((response as { result: { isError?: boolean } }).result.isError).toBe(true);
		expect(text).toContain("partial before timeout");
		expect(text).toContain("timed out");
	} finally {
		await rm(tmpRoot, { recursive: true, force: true });
	}
});

test("cleanup runner captures stdout and stderr", async () => {
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

async function successfulExecute(args: SshExecArgs): Promise<SshExecResult> {
	return {
		host: args.host,
		exitCode: 0,
		stdout: "hello\n",
		stderr: "warn\n",
		output: "hello\nwarn\n",
		durationMs: 12,
		truncated: false,
		totalBytes: 11,
		outputBytes: 11,
		totalLines: 2,
		outputLines: 2,
	};
}
