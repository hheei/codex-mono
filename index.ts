import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
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
		renderCall(args, theme) {
			let text = theme.fg("toolTitle", theme.bold("ssh_host "));
			text += theme.fg("accent", `"${args.ssh_host}"`);
			return new Text(text, 0, 0);
		},
		renderResult: renderCollapsedResult,
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
		renderCall(args, theme) {
			let text = theme.fg("toolTitle", theme.bold("ssh_mount "));
			text += theme.fg("accent", `@${args.host}`);
			return new Text(text, 0, 0);
		},
		renderResult: renderCollapsedResult,
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
		renderCall(args, theme) {
			let text = theme.fg("toolTitle", theme.bold("ssh_exec "));
			text += theme.fg("accent", `@${args.host}`);
			if (args.timeout) text += theme.fg("dim", ` (timeout: ${args.timeout}s)`);

			text += `\n${theme.fg("bashMode", `$ ${args.command}`)}`;
			return new Text(text, 0, 0);
		},
		renderResult: renderCollapsedResult,
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

function renderCollapsedResult(result, { expanded }, theme) {
	const text = result.content
		.filter((item) => item.type === "text" && typeof item.text === "string")
		.map((item) => item.text)
		.join("\n")
		.trimEnd();
	if (!text) return new Text("", 0, 0);

	const durationMs = result.details?.durationMs;
	const durationText = typeof durationMs === "number" ? theme.fg("muted", `Took ${(durationMs / 1000).toFixed(1)}s`) : "";
	if (expanded) {
		const output = theme.fg("toolOutput", text);
		return new Text(durationText ? `${output}\n\n${durationText}` : output, 0, 0);
	}

	const lines = text.split("\n");
	const previewLines = 5;
	const skipped = Math.max(0, lines.length - previewLines);
	const preview = lines.slice(-previewLines).join("\n");
	let output = theme.fg("toolOutput", preview);
	if (skipped > 0) {
		output = `${theme.fg("dim", `... (${skipped} earlier lines, ctrl+o to expand)`)}\n${output}`;
	}

	if (durationText) output += `\n\n${durationText}`;
	return new Text(output, 0, 0);
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
