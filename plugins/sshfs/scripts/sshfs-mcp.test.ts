import { expect, test } from "bun:test";

import { createMcpServer } from "./sshfs-mcp";

test("initialize and tools/list expose only sshfs", async () => {
	const server = createMcpServer();
	const initialize = await server.handle({
		jsonrpc: "2.0",
		id: 1,
		method: "initialize",
		params: { protocolVersion: "2025-06-18" },
	});
	const tools = await server.handle({ jsonrpc: "2.0", id: 2, method: "tools/list" });

	expect(initialize?.result).toMatchObject({
		protocolVersion: "2025-06-18",
		serverInfo: { name: "sshfs", version: "0.6.0" },
		capabilities: { tools: {} },
	});
	expect((tools?.result as { tools: Array<{ name: string }> }).tools.map((tool) => tool.name)).toEqual(["sshfs"]);
	expect((tools?.result as { tools: Array<{ description: string }> }).tools[0].description).toContain("MANDATORY");
});

test("tools/call returns the mounted path as text and structured content", async () => {
	const server = createMcpServer({
		mount: async (host) => ({
			host,
			localPath: `/mounts/${host}`,
			remoteHomeLocalPath: `/mounts/${host}/home/test`,
			status: "mounted",
		}),
	});
	const response = await server.handle({
		jsonrpc: "2.0",
		id: 3,
		method: "tools/call",
		params: { name: "sshfs", arguments: { host: "prod" } },
	});

	expect(response?.result).toMatchObject({
		content: [{ type: "text" }],
		structuredContent: {
			host: "prod",
			localPath: "/mounts/prod",
			remoteHomeLocalPath: "/mounts/prod/home/test",
			status: "mounted",
		},
	});
});

test("tools/call rejects unknown tools and invalid arguments", async () => {
	const server = createMcpServer();
	const unknown = await server.handle({
		jsonrpc: "2.0",
		id: 4,
		method: "tools/call",
		params: { name: "ssh_exec", arguments: {} },
	});
	const invalid = await server.handle({
		jsonrpc: "2.0",
		id: 5,
		method: "tools/call",
		params: { name: "sshfs", arguments: { host: "prod", command: "id" } },
	});

	expect(unknown?.error?.code).toBe(-32602);
	expect(invalid?.error?.message).toContain("only the host");
});

test("tools/call returns operational failures as MCP tool errors", async () => {
	const server = createMcpServer({ mount: async () => { throw new Error("mount failed"); } });
	const response = await server.handle({
		jsonrpc: "2.0",
		id: 6,
		method: "tools/call",
		params: { name: "sshfs", arguments: { host: "prod" } },
	});

	expect(response?.result).toEqual({
		isError: true,
		content: [{ type: "text", text: "mount failed" }],
	});
});
