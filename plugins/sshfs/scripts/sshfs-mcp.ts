#!/usr/bin/env bun

import { SshfsManager, type SshfsResult } from "./sshfs-manager";

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
	error?: { code: number; message: string };
}

interface McpServerOptions {
	mount?: (host: string) => Promise<SshfsResult>;
}

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "sshfs", version: "0.6.0" };

const SSHFS_TOOL = {
	name: "sshfs",
	description: "MANDATORY for every SSH remote file read, write, edit, search, listing, or inspection request. Call this tool first, then use local file tools under the returned paths. It first runs a short SSH reachability query, then mounts only the remote root (<host>:/). A reachable healthy mount is reused and never remounted. Do not use direct SSH commands for remote file operations. Local grep and find are supported, but must target a narrow directory or file; never recursively scan the mounted root.",
	inputSchema: {
		type: "object",
		properties: {
			host: { type: "string", minLength: 1, description: "OpenSSH host alias, optionally prefixed with user@; paths and ports are not accepted" },
		},
		required: ["host"],
		additionalProperties: false,
	},
	outputSchema: {
		type: "object",
		properties: {
			host: { type: "string" },
			localPath: { type: "string" },
			remoteHomeLocalPath: { type: "string" },
			status: { type: "string", enum: ["mounted", "reused"] },
		},
		required: ["host", "localPath", "remoteHomeLocalPath", "status"],
		additionalProperties: false,
	},
};

export function createMcpServer(options: McpServerOptions = {}) {
	const manager = new SshfsManager();
	const mount = options.mount ?? ((host: string) => manager.ensureMounted(host));
	return {
		async handle(message: JsonRpcRequest): Promise<JsonRpcResponse | undefined> {
			const id = message.id ?? null;
			switch (message.method) {
				case "initialize":
					return result(id, {
						protocolVersion: requestedProtocolVersion(message.params),
						serverInfo: SERVER_INFO,
						capabilities: { tools: {} },
					});
				case "notifications/initialized":
					return undefined;
				case "ping":
					return result(id, {});
				case "tools/list":
					return result(id, { tools: [SSHFS_TOOL] });
				case "tools/call":
					return await callTool(id, message.params, mount);
				default:
					return failure(id, -32601, `Method not found: ${message.method}`);
			}
		},
	};
}

async function callTool(
	id: JsonRpcId,
	params: unknown,
	mount: (host: string) => Promise<SshfsResult>,
): Promise<JsonRpcResponse> {
	if (!params || typeof params !== "object" || Array.isArray(params)) {
		return failure(id, -32602, "tools/call params must be an object");
	}
	const record = params as Record<string, unknown>;
	if (record.name !== "sshfs") return failure(id, -32602, "Unknown tool");
	if (!record.arguments || typeof record.arguments !== "object" || Array.isArray(record.arguments)) {
		return failure(id, -32602, "sshfs arguments must be an object");
	}
	const args = record.arguments as Record<string, unknown>;
	if (typeof args.host !== "string") return failure(id, -32602, "sshfs.host must be a string");
	if (Object.keys(args).some((key) => key !== "host")) {
		return failure(id, -32602, "sshfs accepts only the host argument");
	}

	try {
		const mounted = await mount(args.host);
		return result(id, {
			content: [{
				type: "text",
				text: [
					"Remote root mounted.",
					`Local root path: ${mounted.localPath}`,
					`Remote home path: ${mounted.remoteHomeLocalPath}`,
					"Use local file tools directly under this path to access the remote filesystem.",
					"Keep grep and find scoped to a narrow path; never recursively scan the mounted root.",
				].join("\n"),
			}],
			structuredContent: mounted,
		});
	} catch (error) {
		return result(id, {
			isError: true,
			content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
		});
	}
}

function requestedProtocolVersion(params: unknown): string {
	if (!params || typeof params !== "object" || Array.isArray(params)) return PROTOCOL_VERSION;
	const version = (params as Record<string, unknown>).protocolVersion;
	return typeof version === "string" && version.trim() ? version : PROTOCOL_VERSION;
}

function result(id: JsonRpcId, value: unknown): JsonRpcResponse {
	return { jsonrpc: "2.0", id, result: value };
}

function failure(id: JsonRpcId, code: number, message: string): JsonRpcResponse {
	return { jsonrpc: "2.0", id, error: { code, message } };
}

export async function runStdio(server = createMcpServer()): Promise<void> {
	process.stdin.setEncoding("utf8");
	let buffer = "";
	for await (const chunk of process.stdin) {
		buffer += chunk;
		let newline = buffer.indexOf("\n");
		while (newline >= 0) {
			await handleLine(server, buffer.slice(0, newline));
			buffer = buffer.slice(newline + 1);
			newline = buffer.indexOf("\n");
		}
	}
	if (buffer.trim()) await handleLine(server, buffer);
}

async function handleLine(server: ReturnType<typeof createMcpServer>, line: string): Promise<void> {
	if (!line.trim()) return;
	let response: JsonRpcResponse | undefined;
	try {
		response = await server.handle(JSON.parse(line));
	} catch {
		response = failure(null, -32700, "Parse error");
	}
	if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
}

if (import.meta.main) {
	runStdio().catch((error) => {
		process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
		process.exitCode = 1;
	});
}
