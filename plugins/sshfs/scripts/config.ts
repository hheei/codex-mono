import { access, readdir, readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

import { validateHost } from "./manager";

export interface HostListResult {
	hosts: string[];
	configPath: string;
}

export async function listConfiguredHosts(configPath = resolve(homedir(), ".ssh", "config")): Promise<HostListResult> {
	const absoluteConfigPath = resolve(configPath);
	const hosts: string[] = [];
	const seenHosts = new Set<string>();
	const visitedFiles = new Set<string>();
	try {
		await parseFile(absoluteConfigPath, hosts, seenHosts, visitedFiles, true);
	} catch (error) {
		if (isMissing(error)) return { hosts, configPath: absoluteConfigPath };
		throw error;
	}
	return { hosts, configPath: absoluteConfigPath };
}

async function parseFile(
	filePath: string,
	hosts: string[],
	seenHosts: Set<string>,
	visitedFiles: Set<string>,
	isRoot = false,
): Promise<void> {
	let canonicalPath: string;
	try {
		canonicalPath = await realpath(filePath);
	} catch (error) {
		if (!isRoot && isSkippableIncludeError(error)) return;
		throw error;
	}
	if (visitedFiles.has(canonicalPath)) return;
	visitedFiles.add(canonicalPath);

	let content: string;
	try {
		content = await readFile(canonicalPath, "utf8");
	} catch (error) {
		if (!isRoot && isSkippableIncludeError(error)) return;
		throw error;
	}
	for (const line of content.split(/\r?\n/)) {
		const tokens = tokenize(line);
		if (tokens.length === 0) continue;
		const directive = tokens[0].toLowerCase();
		if (directive === "host") {
			for (const token of tokens.slice(1)) addHost(token, hosts, seenHosts);
		} else if (directive === "include") {
			for (const pattern of tokens.slice(1)) {
				for (const included of await expandInclude(pattern, dirname(canonicalPath))) {
					await parseFile(included, hosts, seenHosts, visitedFiles);
				}
			}
		}
	}
}

function addHost(token: string, hosts: string[], seenHosts: Set<string>): void {
	if (token.startsWith("!") || token.includes("*") || token.includes("?") || /[\0\s]/.test(token)) return;
	try {
		const host = validateHost(token);
		if (!seenHosts.has(host)) {
			seenHosts.add(host);
			hosts.push(host);
		}
	} catch {
		return;
	}
}

function tokenize(line: string): string[] {
	const tokens: string[] = [];
	let token = "";
	let quote = "";
	let escaped = false;
	for (const character of line) {
		if (escaped) {
			token += character;
			escaped = false;
			continue;
		}
		if (character === "\\") {
			escaped = true;
			continue;
		}
		if (quote) {
			if (character === quote) quote = "";
			else token += character;
			continue;
		}
		if (character === "'" || character === '"') {
			quote = character;
		} else if (character === "#") {
			break;
		} else if (/\s/.test(character)) {
			if (token) {
				tokens.push(token);
				token = "";
			}
		} else {
			token += character;
		}
	}
	if (escaped) token += "\\";
	if (token) tokens.push(token);
	return tokens;
}

async function expandInclude(pattern: string, baseDirectory: string): Promise<string[]> {
	const expanded = pattern === "~" ? homedir() : pattern.startsWith("~/") ? join(homedir(), pattern.slice(2)) : pattern;
	const absolutePattern = isAbsolute(expanded) ? expanded : join(baseDirectory, expanded);
	if (!/[?*]/.test(absolutePattern)) {
		try {
			await access(absolutePattern);
			return [absolutePattern];
		} catch {
			return [];
		}
	}
	const parts = absolutePattern.split("/");
	const root = parts[0] === "" ? (parts.shift(), "/") : parts.shift()!;
	return (await expandSegments(root, parts)).sort();
}

async function expandSegments(directory: string, segments: string[]): Promise<string[]> {
	if (segments.length === 0) return [directory];
	const [segment, ...rest] = segments;
	let entries;
	try {
		entries = await readdir(directory, { withFileTypes: true });
	} catch {
		return [];
	}
	const matches = entries
		.filter((entry) => matchesPattern(entry.name, segment))
		.sort((left, right) => left.name.localeCompare(right.name));
	const results: string[] = [];
	for (const entry of matches) {
		const path = join(directory, entry.name);
		if (rest.length > 0 && !entry.isDirectory()) continue;
		results.push(...await expandSegments(path, rest));
	}
	return results;
}

function matchesPattern(value: string, pattern: string): boolean {
	const expression = `^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*").replaceAll("?", ".")}$`;
	return new RegExp(expression).test(value);
}

function isMissing(error: unknown): boolean {
	return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function isSkippableIncludeError(error: unknown): boolean {
	return isMissing(error) || Boolean(error && typeof error === "object" && "code" in error && ["EACCES", "EISDIR", "ENOTDIR"].includes(String(error.code)));
}