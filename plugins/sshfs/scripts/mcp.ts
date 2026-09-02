#!/usr/bin/env bun

import { listConfiguredHosts, type HostListResult } from "./config";
import {
	SshfsManager,
	type HostExecInput,
	type HostExecResult,
	type SshfsResult,
	validateHost,
} from "./manager";

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
	list?: () => Promise<HostListResult>;
	exec?: (input: HostExecInput) => Promise<HostExecResult>;
	mount?: (host: string) => Promise<SshfsResult>;
	sshfsAvailable?: () => Promise<boolean>;
}

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "sshfs", version: "0.7.0" };

const TOOLS = [{
	name: "host_exec",
	description: "Run a non-interactive command string on a configured SSH host using its default remote shell. Use for remote process and service operations. Does not support sudo or password prompts.",
	inputSchema: {
		type: "object",
		properties: {
			host: { type: "string", minLength: 1 },
			command: { type: "string", minLength: 1 },
			cwd: { type: "string", minLength: 1 },
			timeoutMs: { type: "number", minimum: 1, maximum: 300000 },
		},
		required: ["host", "command"],
		additionalProperties: false,
	},
	outputSchema: {
		type: "object",
		properties: {
			host: { type: "string" },
			command: { type: "string" },
			cwd: { type: "string" },
			exitCode: { type: "integer" },
			stdout: { type: "string" },
			stderr: { type: "string" },
			timedOut: { type: "boolean", const: false },
		},
		required: ["host", "command", "exitCode", "stdout", "stderr", "timedOut"],
		additionalProperties: false,
	},
}, {
	name: "host_list",
	description: "List explicit OpenSSH host aliases configured in the user's SSH config and included files.",
	inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
	outputSchema: {
		type: "object",
		properties: { hosts: { type: "array", items: { type: "string" } }, configPath: { type: "string" } },
		required: ["hosts", "configPath"],
		additionalProperties: false,
	},
}];

const MOUNT_TOOL = {
	name: "host_mount",
	description: "Mount the remote root of an SSH host for local file tools. Call before remote file reads, writes, edits, searches, listings, or inspections. Reuses a healthy matching mount; unhealthy mounts are remounted.",
	inputSchema: {
		type: "object",
		properties: { host: { type: "string", minLength: 1 } },
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
	const list = options.list ?? (() => listConfiguredHosts());
	const exec = options.exec ?? ((input: HostExecInput) => manager.execOnHost(input));
	const mount = options.mount ?? ((host: string) => manager.ensureMounted(host));
	const sshfsAvailable = options.sshfsAvailable ?? isSshfsAvailable;
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
					return result(id, { tools: [...TOOLS, ...(await sshfsAvailable() ? [MOUNT_TOOL] : [])] });
				case "tools/call":
					return await callTool(id, message.params, { list, exec, mount });
				default:
					return failure(id, -32601, `Method not found: ${message.method}`);
			}
		},
	};
}

async function isSshfsAvailable(): Promise<boolean> {
	try {
		const child = Bun.spawn(["sshfs", "--version"], { stdout: "ignore", stderr: "ignore" });
		return await child.exited === 0;
	} catch {
		return false;
	}
}

async function callTool(
	id: JsonRpcId,
	params: unknown,
	operations: {
		list: () => Promise<HostListResult>;
		exec: (input: HostExecInput) => Promise<HostExecResult>;
		mount: (host: string) => Promise<SshfsResult>;
	},
): Promise<JsonRpcResponse> {
	if (!params || typeof params !== "object" || Array.isArray(params)) {
		return failure(id, -32602, "tools/call params must be an object");
	}
	const record = params as Record<string, unknown>;
	const name = record.name;
	if (name !== "host_list" && name !== "host_exec" && name !== "host_mount") return failure(id, -32602, "Unknown tool");
	const rawArguments = record.arguments;
	if (name === "host_list" && rawArguments === undefined) return await runOperation(id, operations.list, formatList);
	if (!rawArguments || typeof rawArguments !== "object" || Array.isArray(rawArguments)) {
		return failure(id, -32602, `${name} arguments must be an object`);
	}
	const args = rawArguments as Record<string, unknown>;
	if (name === "host_list") {
		if (Object.keys(args).length > 0) return failure(id, -32602, "host_list accepts no arguments");
		return await runOperation(id, operations.list, formatList);
	}
	if (typeof args.host !== "string") return failure(id, -32602, `${name}.host must be a string`);
	try {
		validateHost(args.host);
	} catch (error) {
		return failure(id, -32602, error instanceof Error ? error.message : String(error));
	}
	if (name === "host_mount") {
		if (Object.keys(args).some((key) => key !== "host")) return failure(id, -32602, "host_mount accepts only the host argument");
		return await runOperation(id, () => operations.mount(args.host as string), formatMount);
	}
	if (typeof args.command !== "string" || args.command.length === 0 || args.command.includes("\0")) return failure(id, -32602, "host_exec.command must be a non-empty string without NUL");
	if (args.cwd !== undefined && (typeof args.cwd !== "string" || args.cwd.length === 0 || args.cwd.includes("\0") || /[\r\n]/.test(args.cwd))) return failure(id, -32602, "host_exec.cwd must be a non-empty string without NUL, CR, or LF");
	if (args.timeoutMs !== undefined && (!Number.isInteger(args.timeoutMs) || (args.timeoutMs as number) < 1 || (args.timeoutMs as number) > 300000)) return failure(id, -32602, "host_exec.timeoutMs must be an integer between 1 and 300000");
	if (Object.keys(args).some((key) => !["host", "command", "cwd", "timeoutMs"].includes(key))) return failure(id, -32602, "host_exec received an unknown argument");
	return await runOperation(id, () => operations.exec(args as unknown as HostExecInput), formatExec);
}

async function runOperation<T>(id: JsonRpcId, operation: () => Promise<T>, format: (value: T) => string): Promise<JsonRpcResponse> {
	try {
		const value = await operation();
		return result(id, { content: [{ type: "text", text: format(value) }], structuredContent: value });
	} catch (error) {
		return result(id, {
			isError: true,
			content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
		});
	}
}

function formatList(value: HostListResult): string {
	return [`SSH config: ${value.configPath}`, value.hosts.length ? `Configured hosts: ${value.hosts.join(", ")}` : "Configured hosts: none"].join("\n");
}

function formatExec(value: HostExecResult): string {
	return [`Host: ${value.host}`, `Command: ${value.command}`, ...(value.cwd === undefined ? [] : [`CWD: ${value.cwd}`]), `Exit code: ${value.exitCode}`, `STDOUT:\n${value.stdout}`, `STDERR:\n${value.stderr}`, "Timed out: false"].join("\n");
}

function formatMount(value: SshfsResult): string {
	return [`Remote root ${value.status === "reused" ? "reused" : "mounted"}.`, `Local root path: ${value.localPath}`, `Remote home path: ${value.remoteHomeLocalPath}`, "Use local file tools directly under this path.", "Keep grep and find scoped to a narrow path; never recursively scan the mounted root."].join("\n");
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
