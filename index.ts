import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { getSettingsListTheme, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Container, SettingsList, Text, type SettingItem } from "@earendil-works/pi-tui";
import { Type } from "typebox";

import { createMcpServer } from "./plugins/ssh-exec/scripts/ssh-exec-mcp";
import { SessionManager } from "./plugins/ssh-exec/scripts/session-manager";
import { findConfiguredHosts, type SshHostRecord } from "./plugins/ssh-exec/scripts/ssh-hosts";

interface SshExtensionSettings {
	commandTimeoutSeconds: number;
	controlPersistSeconds: number;
	serverAliveIntervalSeconds: number;
	serverAliveCountMax: number;
	disabledHosts: string[];
}

const SETTINGS_PATH = join(homedir(), ".pi", "agent", "ssh-exec.json");
const DEFAULT_SETTINGS: SshExtensionSettings = {
	commandTimeoutSeconds: 10,
	controlPersistSeconds: 3600,
	serverAliveIntervalSeconds: 300,
	serverAliveCountMax: 3,
	disabledHosts: [],
};

export default function register(pi: ExtensionAPI) {
	let settings = loadSettings();
	let server = createServer(settings);

	const rebuildServer = () => {
		server = createServer(settings);
	};

	const saveSettings = () => {
		persistSettings(settings);
		rebuildServer();
	};

	const isHostDisabled = (host: string) => settings.disabledHosts.includes(host);

	pi.registerCommand("ssh", {
		description: "Configure SSH Exec hosts and defaults",
		handler: async (_args, ctx) => {
			const hosts = await findConfiguredHosts("*");
			await ctx.ui.custom<void>((_tui, theme, _keybindings, done) => {
				const container = new Container();
				container.addChild(new Text(theme.fg("accent", theme.bold("SSH Exec")), 0, 0));
				container.addChild(new Text(theme.fg("dim", "Enter/Space changes value · Esc closes · type to search"), 0, 0));

				const settingsList = new SettingsList(
					sshSettingsItems(settings, hosts),
					Math.min(Math.max(hosts.length + 6, 8), 20),
					getSettingsListTheme(),
					(id, newValue) => {
						settings = updateSetting(settings, id, newValue);
						saveSettings();
						settingsList.updateValue(id, newValue);
					},
					() => done(undefined),
					{ enableSearch: true },
				);
				container.addChild(settingsList);

				return {
					render: (width) => container.render(width),
					invalidate: () => container.invalidate(),
					handleInput: (data) => settingsList.handleInput(data),
				};
			});
		},
	});

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
			if (isHostDisabled(params.host)) return disabledHostResult(params.host);
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
			text += theme.fg("dim", ` (timeout: ${args.timeout ?? settings.commandTimeoutSeconds}s)`);

			text += `\n${theme.fg("bashMode", `$ ${args.command}`)}`;
			return new Text(text, 0, 0);
		},
		renderResult: renderCollapsedResult,
		async execute(_id, params) {
			if (isHostDisabled(params.host)) return disabledHostResult(params.host);
			const response = await server.handle({
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: {
					name: "ssh_exec",
					arguments: { ...params, timeout: params.timeout ?? settings.commandTimeoutSeconds },
				},
			});
			return normalizePiToolResult(response);
		},
	});
}

function createServer(settings: SshExtensionSettings) {
	return createMcpServer({
		manager: new SessionManager({
			controlPersist: String(settings.controlPersistSeconds),
			serverAliveIntervalSeconds: settings.serverAliveIntervalSeconds,
			serverAliveCountMax: settings.serverAliveCountMax,
		}),
		findHosts: async (pattern) => filterDisabledHosts(await findConfiguredHosts(pattern), settings),
	});
}

function sshSettingsItems(settings: SshExtensionSettings, hosts: SshHostRecord[]): SettingItem[] {
	const disabled = new Set(settings.disabledHosts);
	return [
		{
			id: "setting:commandTimeoutSeconds",
			label: "Default command timeout",
			description: "Default timeout for ssh_exec when the tool call does not pass timeout.",
			currentValue: `${settings.commandTimeoutSeconds}s`,
			values: ["5s", "10s", "30s", "60s", "120s", "300s", "600s"],
		},
		{
			id: "setting:controlPersistSeconds",
			label: "ControlMaster alive",
			description: "SSH ControlPersist lifetime for reused master connections.",
			currentValue: `${settings.controlPersistSeconds}s`,
			values: ["300s", "600s", "1800s", "3600s", "7200s"],
		},
		{
			id: "setting:serverAliveIntervalSeconds",
			label: "Alive interval",
			description: "ServerAliveInterval seconds for ssh and sshfs connections.",
			currentValue: `${settings.serverAliveIntervalSeconds}s`,
			values: ["30s", "60s", "120s", "300s", "600s"],
		},
		{
			id: "setting:serverAliveCountMax",
			label: "Alive retry count",
			description: "ServerAliveCountMax before SSH treats the connection as dead.",
			currentValue: String(settings.serverAliveCountMax),
			values: ["1", "2", "3", "5", "10"],
		},
		...hosts.map((host) => ({
			id: `host:${host.alias}`,
			label: `@${host.alias}`,
			description: host.display,
			currentValue: disabled.has(host.alias) ? "disabled" : "enabled",
			values: ["enabled", "disabled"],
		})),
	];
}

function updateSetting(settings: SshExtensionSettings, id: string, newValue: string): SshExtensionSettings {
	if (id.startsWith("host:")) {
		const host = id.slice("host:".length);
		const disabled = new Set(settings.disabledHosts);
		if (newValue === "disabled") disabled.add(host);
		else disabled.delete(host);
		return { ...settings, disabledHosts: sorted(disabled) };
	}

	const seconds = parseSeconds(newValue);
	if (id === "setting:commandTimeoutSeconds") return { ...settings, commandTimeoutSeconds: seconds };
	if (id === "setting:controlPersistSeconds") return { ...settings, controlPersistSeconds: seconds };
	if (id === "setting:serverAliveIntervalSeconds") return { ...settings, serverAliveIntervalSeconds: seconds };
	if (id === "setting:serverAliveCountMax") return { ...settings, serverAliveCountMax: parsePositiveInt(newValue, settings.serverAliveCountMax) };
	return settings;
}

function filterDisabledHosts(hosts: SshHostRecord[], settings: SshExtensionSettings): SshHostRecord[] {
	const disabled = new Set(settings.disabledHosts);
	return hosts.filter((host) => !disabled.has(host.alias));
}

function disabledHostResult(host: string) {
	return {
		content: [{ type: "text", text: `SSH host ${host} is disabled by /ssh settings.` }],
		details: { host, disabled: true },
		isError: true,
	};
}

function loadSettings(): SshExtensionSettings {
	try {
		const raw = readFileSync(SETTINGS_PATH, "utf8");
		return normalizeSettings(JSON.parse(raw));
	} catch {
		return { ...DEFAULT_SETTINGS };
	}
}

function persistSettings(settings: SshExtensionSettings) {
	mkdirSync(dirname(SETTINGS_PATH), { recursive: true });
	writeFileSync(SETTINGS_PATH, `${JSON.stringify(settings, null, 2)}\n`);
}

function normalizeSettings(value: unknown): SshExtensionSettings {
	const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
	return {
		commandTimeoutSeconds: clampInt(record.commandTimeoutSeconds, DEFAULT_SETTINGS.commandTimeoutSeconds, 1, 3600),
		controlPersistSeconds: clampInt(record.controlPersistSeconds, DEFAULT_SETTINGS.controlPersistSeconds, 1, 86_400),
		serverAliveIntervalSeconds: clampInt(record.serverAliveIntervalSeconds, DEFAULT_SETTINGS.serverAliveIntervalSeconds, 1, 3600),
		serverAliveCountMax: clampInt(record.serverAliveCountMax, DEFAULT_SETTINGS.serverAliveCountMax, 1, 100),
		disabledHosts: sorted(Array.isArray(record.disabledHosts) ? record.disabledHosts.filter((item) => typeof item === "string") as string[] : []),
	};
}

function parseSeconds(value: string): number {
	return parsePositiveInt(value.replace(/s$/, ""), 10);
}

function parsePositiveInt(value: string, fallback: number): number {
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	return Math.min(max, Math.max(min, Math.floor(value)));
}

function sorted(names: Iterable<string>): string[] {
	return [...new Set(names)].sort((a, b) => a.localeCompare(b));
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
		return new Text(durationText ? `\n${output}\n\n${durationText}` : `\n${output}`, 0, 0);
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
	return new Text(`\n${output}`, 0, 0);
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
