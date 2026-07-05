import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { createMcpServer } from "./plugins/ssh-exec/scripts/ssh-exec-mcp";

export default function register(pi: ExtensionAPI) {
	const server = createMcpServer();

	pi.registerTool({
	name: "ssh_host",
		label: "SSH Host",
		description: "Find configured SSH aliases from the local OpenSSH config.",
		promptSnippet: "Find configured SSH aliases before connecting to a remote host.",
		promptGuidelines: [
			"Use this tool first when you are not sure whether a remote host alias exists.",
		],
		parameters: Type.Object({
			ssh_host: Type.String(),
		}),
		async execute(_id, params) {
			const response = await server.handle({
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: { name: "ssh_host", arguments: params },
			});
			return normalizePiToolResult(response);
		},
	});

	pi.registerTool({
	name: "ssh_mount",
		label: "SSH Mount",
		description: "Mount a remote host locally through sshfs.",
		promptSnippet: "Mount a remote SSH host so local file tools can operate on it.",
		promptGuidelines: ["Use host first if the SSH alias is uncertain."],
		parameters: Type.Object({
			host: Type.String(),
		}),
		async execute(_id, params) {
			const response = await server.handle({
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: { name: "ssh_mount", arguments: params },
			});
			return normalizePiToolResult(response);
		},
	});

	pi.registerTool({
	name: "ssh_exec",
		label: "SSH Exec",
		description: "Run a non-interactive command on a remote OpenSSH host.",
		promptSnippet: "Run a remote SSH command for inspection, verification, or service control.",
		promptGuidelines: ["Use host first if the SSH alias is uncertain."],
		parameters: Type.Object({
			host: Type.String(),
			command: Type.String(),
			timeout: Type.Optional(Type.Number()),
		}),
		async execute(_id, params) {
			const response = await server.handle({
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: { name: "ssh_exec", arguments: params },
			});
			return normalizePiToolResult(response);
		},
	});
}

function normalizePiToolResult(response: unknown) {
	const result = (response as { result?: Record<string, unknown> }).result ?? {};
	const content = Array.isArray(result.content) ? result.content : [];
	const details = (result.structuredContent ?? {}) as Record<string, unknown>;
	return {
		content,
		details,
		isError: Boolean(result.isError),
	};
}
