import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager, sanitizeHostForSocket, type MountProbeResult } from "./session-manager";
import { clampTimeoutSeconds, executeSshExec } from "./ssh-exec";

let tmpRoot: string;
let fakeSshPath: string;
let fakeLogPath: string;

beforeEach(async () => {
	tmpRoot = await mkdtemp(join(tmpdir(), "ssh-exec-test-"));
	fakeSshPath = join(tmpRoot, "fake-ssh.ts");
	fakeLogPath = join(tmpRoot, "ssh.log");
	await Bun.write(fakeSshPath, fakeSshSource(fakeLogPath));
	await chmod(fakeSshPath, 0o755);
});

afterEach(async () => {
	await rm(tmpRoot, { recursive: true, force: true });
});

test("executeSshExec establishes control-master and reuses host session", async () => {
	const controlDir = join(tmpRoot, "control-master");
	const manager = new SessionManager({ sshBin: fakeSshPath, controlDir });

	const first = await executeSshExec(manager, { host: "prod", command: "say-hello", timeout: 5 });
	const second = await executeSshExec(manager, { host: "prod", command: "say-hello", timeout: 5 });

	expect(first).toMatchObject({
		host: "prod",
		exitCode: 0,
		stdout: "hello\n",
		stderr: "warn\n",
		truncated: false,
	});
	expect(second.exitCode).toBe(0);
	expect((await stat(controlDir)).mode & 0o777).toBe(0o700);
	const events = await readFakeLog();
	expect(events.filter((event) => event.kind === "check").length).toBeGreaterThanOrEqual(2);
	expect(events.filter((event) => event.kind === "start").length).toBeGreaterThanOrEqual(1);
	expect(events.filter((event) => event.kind === "run")).toHaveLength(2);
});

test("executeSshExec returns timeout result with captured output when requested", async () => {
	const manager = new SessionManager({ sshBin: fakeSshPath, controlDir: join(tmpRoot, "control-master") });
	const result = await executeSshExec(
		manager,
		{ host: "prod", command: "slow-output", timeout: 2 },
		{ timeoutMode: "result" },
	);

	expect(result.exitCode).toBeNull();
	expect(result.notice).toContain("timed out");
	expect(result.stdout).toContain("before timeout");
	expect(result.stderr).toContain("<control-socket>");
	expect(result.stderr).not.toContain(tmpRoot);
});

test("executeSshExec rejects host values OpenSSH could parse as options", async () => {
	const manager = new SessionManager({ sshBin: fakeSshPath, controlDir: join(tmpRoot, "control-master") });
	await expect(executeSshExec(manager, { host: "-oProxyCommand=sh", command: "say-hello", timeout: 5 })).rejects.toThrow(
		/must not start with '-'/i,
	);
});

test("ensureMounted runs sshfs first time and reuses healthy mount", async () => {
	const mountDir = join(tmpRoot, "mounts");
	const mounted = new Set<string>();
	const manager = new SessionManager({
		sshBin: fakeSshPath,
		sshfsBin: fakeSshPath,
		controlDir: join(tmpRoot, "control-master"),
		mountDir,
		mountProbe: async (mountPath): Promise<MountProbeResult> => ({
			mounted: mounted.has(mountPath) || (await Bun.file(join(mountPath, ".mounted")).exists()),
			healthy: mounted.has(mountPath) || (await Bun.file(join(mountPath, ".mounted")).exists()),
		}),
		unmountMount: async (mountPath) => {
			mounted.delete(mountPath);
			await rm(join(mountPath, ".mounted"), { force: true });
			return true;
		},
	});
	const runner = async (args: string[], timeoutMs?: number) => await runFakeProcess(fakeSshPath, args, timeoutMs);

	const first = await manager.ensureMounted("prod", runner);
	mounted.add(first.localPath);
	const second = await manager.ensureMounted("prod", runner);

	expect(first.status).toBe("mounted");
	expect(second.status).toBe("reused");
	expect(first.localPath).toBe(join(mountDir, sanitizeHostForSocket("prod")));
	const events = await readFakeLog();
	expect(events.filter((event) => event.kind === "mount")).toHaveLength(1);
});

test("ensureMounted remounts stale mount and closeAll unmounts best-effort", async () => {
	const mountDir = join(tmpRoot, "mounts");
	const unmounted: string[] = [];
	const mountState = new Map<string, MountProbeResult>();
	const manager = new SessionManager({
		sshBin: fakeSshPath,
		sshfsBin: fakeSshPath,
		controlDir: join(tmpRoot, "control-master"),
		mountDir,
		mountProbe: async (mountPath) => {
			const fileMounted = await Bun.file(join(mountPath, ".mounted")).exists();
			if (fileMounted) return { mounted: true, healthy: true };
			return mountState.get(mountPath) ?? { mounted: false, healthy: false };
		},
		unmountMount: async (mountPath) => {
			unmounted.push(mountPath);
			mountState.set(mountPath, { mounted: false, healthy: false });
			await rm(join(mountPath, ".mounted"), { force: true });
			return true;
		},
	});
	const runner = async (args: string[], timeoutMs?: number) => await runFakeProcess(fakeSshPath, args, timeoutMs);
	const mountPath = manager.getMountPath("prod");
	await Bun.write(join(mountPath, ".keep"), "");
	await Bun.write(join(mountPath, ".stale"), "stale");
	mountState.set(mountPath, { mounted: true, healthy: false });

	const mountedResult = await manager.ensureMounted("prod", runner);
	mountState.set(mountPath, { mounted: true, healthy: true });
	await manager.closeAll(runner);

	expect(mountedResult.status).toBe("remounted");
	expect(unmounted).toContain(mountPath);
	expect(unmounted.filter((path) => path === mountPath).length).toBeGreaterThanOrEqual(2);
});

test("ensureMounted errors clearly when sshfs binary is missing", async () => {
	const manager = new SessionManager({
		sshBin: fakeSshPath,
		sshfsBin: join(tmpRoot, "missing-sshfs"),
		controlDir: join(tmpRoot, "control-master"),
		mountDir: join(tmpRoot, "mounts"),
	});
	const runner = async (args: string[], timeoutMs?: number) => await runFakeProcess(fakeSshPath, args, timeoutMs);

	await expect(manager.ensureMounted("prod", runner)).rejects.toThrow(/sshfs binary not found/i);
});

test("ensureMounted rejects unsupported local platforms", async () => {
	const manager = new SessionManager({
		sshBin: fakeSshPath,
		sshfsBin: fakeSshPath,
		controlDir: join(tmpRoot, "control-master"),
		mountDir: join(tmpRoot, "mounts"),
		platform: "win32",
	});
	const runner = async (args: string[], timeoutMs?: number) => await runFakeProcess(fakeSshPath, args, timeoutMs);

	await expect(manager.ensureMounted("prod", runner)).rejects.toThrow(/supported only on Linux and macOS/i);
});

test("clampTimeoutSeconds keeps timeouts in supported range", () => {
	expect(clampTimeoutSeconds(undefined)).toBe(10);
	expect(clampTimeoutSeconds(0.1)).toBe(1);
	expect(clampTimeoutSeconds(99999)).toBe(3600);
});

async function readFakeLog(): Promise<Array<{ kind: string; args: string[] }>> {
	const raw = await readFile(fakeLogPath, "utf8").catch(() => "");
	return raw
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line) as { kind: string; args: string[] });
}

async function runFakeProcess(bin: string, args: string[], timeoutMs = 10_000) {
	const child = Bun.spawn([bin, ...args], {
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});
	const timeout = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
	try {
		const [stdoutBytes, stderrBytes, exitCode] = await Promise.all([
			child.stdout ? new Response(child.stdout).bytes() : new Uint8Array(),
			child.stderr ? new Response(child.stderr).bytes() : new Uint8Array(),
			child.exited,
		]);
		const stdout = new TextDecoder().decode(stdoutBytes);
		const stderr = new TextDecoder().decode(stderrBytes);
		return {
			exitCode,
			stdout,
			stderr,
			output: `${stdout}${stderr}`,
			truncated: false,
		};
	} finally {
		clearTimeout(timeout);
	}
}

function fakeSshSource(logPath: string): string {
	return `#!/usr/bin/env bun
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const args = process.argv.slice(2);
const logPath = ${JSON.stringify(logPath)};

function argAfter(flag) {
	const index = args.indexOf(flag);
	return index === -1 ? undefined : args[index + 1];
}

async function log(kind) {
	await appendFile(logPath, JSON.stringify({ kind, args }) + "\\n");
}

const socketPath = argAfter("-S");
const controlPathArg = args.find((arg) => typeof arg === "string" && arg.startsWith("ControlPath="));
const sshfsSocketPath = controlPathArg ? controlPathArg.slice("ControlPath=".length) : undefined;
const effectiveSocketPath = socketPath ?? sshfsSocketPath;
const mountTarget = args.at(-2);
const mountPath = args.at(-1);

if (args.includes("-O") && args.includes("check")) {
	await log("check");
	if (effectiveSocketPath && await Bun.file(effectiveSocketPath).exists()) process.exit(0);
	console.error("No ControlMaster");
	process.exit(255);
}

if (args.includes("-M") && args.includes("-N") && args.includes("-f")) {
	await log("start");
	if (!effectiveSocketPath) process.exit(2);
	await mkdir(dirname(effectiveSocketPath), { recursive: true });
	await Bun.write(effectiveSocketPath, "master");
	process.exit(0);
}

if (typeof mountTarget === "string" && mountTarget.endsWith(":/") && typeof mountPath === "string") {
	await log("mount");
	await mkdir(mountPath, { recursive: true });
	await Bun.write(mountPath + "/.mounted", "mounted");
	process.exit(0);
}

await log("run");
const cmd = args[args.length - 1] ?? "";

if (cmd === "say-hello") {
	process.stdout.write("hello\\n");
	process.stderr.write("warn\\n");
	process.exit(0);
}

if (cmd === "slow-output") {
	process.stdout.write("before timeout\\n");
	process.stderr.write("err " + (effectiveSocketPath ?? "") + "\\n");
	await Bun.sleep(2000);
	process.exit(0);
}

if (cmd === "fail-command") {
	process.stdout.write("bad output\\n");
	process.stderr.write("bad err " + (effectiveSocketPath ?? "") + "\\n");
	process.exit(7);
}

process.stdout.write("ok\\n");
process.exit(0);
`;
}
