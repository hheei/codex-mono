import { expect, test } from "bun:test";

import { createMcpServer } from "./mcp";

const listValue = { hosts: ["prod", "gpu"], configPath: "/tmp/.ssh/config" };
const execValue = { host: "prod", command: "id", exitCode: 7, stdout: "out", stderr: "err", timedOut: false as const };
const mountValue = { host: "prod", localPath: "/mounts/prod", remoteHomeLocalPath: "/mounts/prod/home/test", status: "mounted" as const };

test("initialize and tools/list expose the three host tools", async () => {
	const server = createMcpServer();
	const initialize = await server.handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
	const tools = await server.handle({ jsonrpc: "2.0", id: 2, method: "tools/list" });
	const listed = (tools?.result as { tools: Array<Record<string, unknown>> }).tools;

	expect(initialize?.result).toMatchObject({ serverInfo: { name: "sshfs", version: "0.7.0" } });
	expect(listed.map((tool) => tool.name)).toEqual(["host_exec", "host_list", "host_mount"]);
	for (const tool of listed) {
		expect(tool.inputSchema).toMatchObject({ type: "object", additionalProperties: false });
		expect(tool.outputSchema).toMatchObject({ type: "object", additionalProperties: false });
	}
});

test("tools/call returns structured results for all three tools", async () => {
	const calls: string[] = [];
	const server = createMcpServer({
		list: async () => { calls.push("list"); return listValue; },
		exec: async () => { calls.push("exec"); return execValue; },
		mount: async () => { calls.push("mount"); return mountValue; },
	});
	const list = await server.handle({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "host_list" } });
	const exec = await server.handle({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "host_exec", arguments: { host: "prod", command: "id" } } });
	const mount = await server.handle({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "host_mount", arguments: { host: "prod" } } });

	expect(list?.result).toMatchObject({ structuredContent: listValue, content: [{ type: "text" }] });
	expect(exec?.result).toMatchObject({ structuredContent: execValue, content: [{ type: "text" }] });
	expect(mount?.result).toMatchObject({ structuredContent: mountValue, content: [{ type: "text" }] });
	expect(calls).toEqual(["list", "exec", "mount"]);
});

test("tools/call validates arguments and rejects removed tool names", async () => {
	let called = false;
	const server = createMcpServer({ exec: async () => { called = true; return execValue; } });
	const requests = [
		{ name: "sshfs", arguments: { host: "prod" } },
		{ name: "ssh_exec", arguments: {} },
		{ name: "host_exec", arguments: { host: "prod" } },
		{ name: "host_exec", arguments: { host: "prod", command: "" } },
		{ name: "host_exec", arguments: { host: "prod", command: "id", timeoutMs: 0 } },
		{ name: "host_mount", arguments: { host: "prod", extra: true } },
		{ name: "host_list", arguments: { extra: true } },
	];
	for (const argumentsValue of requests) {
		const response = await server.handle({ jsonrpc: "2.0", id: 6, method: "tools/call", params: argumentsValue });
		expect(response?.error?.code).toBe(-32602);
	}
	expect(called).toBe(false);
});

test("host_list accepts omitted and empty arguments", async () => {
	const server = createMcpServer({ list: async () => listValue });
	const omitted = await server.handle({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "host_list" } });
	const empty = await server.handle({ jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "host_list", arguments: {} } });
	expect(omitted?.result).toHaveProperty("structuredContent", listValue);
	expect(empty?.result).toHaveProperty("structuredContent", listValue);
});

test("operational failures are MCP tool errors", async () => {
	const server = createMcpServer({ exec: async () => { throw new Error("exec failed"); } });
	const response = await server.handle({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "host_exec", arguments: { host: "prod", command: "id" } } });
	expect(response?.result).toEqual({ isError: true, content: [{ type: "text", text: "exec failed" }] });
});
