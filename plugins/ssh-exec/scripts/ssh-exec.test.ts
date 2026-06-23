import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "./session-manager";
import { clampTimeoutSeconds, executeSshExec, MAX_OUTPUT_BYTES } from "./ssh-exec";

let tmpRoot: string;
let fakeSshPath: string;
let fakeLogPath: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), "ssh-exec-test-"));
  fakeSshPath = join(tmpRoot, "fake-ssh.ts");
  fakeLogPath = join(tmpRoot, "ssh.log");
  await Bun.write(fakeSshPath, fakeSshSource());
  await chmod(fakeSshPath, 0o755);
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

test("executeSshExec starts one master connection and reuses it per host", async () => {
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

  const mode = (await stat(controlDir)).mode & 0o777;
  expect(mode).toBe(0o700);

  const events = await readFakeLog();
  expect(events.filter((event) => event.kind === "check")).toHaveLength(2);
  expect(events.filter((event) => event.kind === "start")).toHaveLength(1);
  expect(events.filter((event) => event.kind === "run")).toHaveLength(2);
  for (const event of events) {
    expect(event.args).toContain("-n");
    expect(event.args).toContain("BatchMode=yes");
    expect(event.args).toContain("StrictHostKeyChecking=accept-new");
    expect(event.args).toContain("ControlMaster=auto");
    expect(event.args).toContain("ControlPersist=3600");
  }
});

test("executeSshExec rejects host values that OpenSSH could parse as options", async () => {
  const manager = new SessionManager({ sshBin: fakeSshPath, controlDir: join(tmpRoot, "control-master") });

  await expect(
    executeSshExec(manager, { host: "-oProxyCommand=sh", command: "say-hello", timeout: 5 }),
  ).rejects.toThrow(/host/i);

  expect(await Bun.file(fakeLogPath).exists()).toBe(false);
});

test("executeSshExec falls back to direct ssh when ControlMaster is unsupported", async () => {
  const manager = new SessionManager({
    sshBin: fakeSshPath,
    controlDir: join(tmpRoot, "control-master"),
    supportsControlMaster: false,
  });

  const result = await executeSshExec(manager, { host: "prod", command: "say-hello", timeout: 5 });

  expect(result.exitCode).toBe(0);
  const events = await readFakeLog();
  expect(events.map((event) => event.kind)).toEqual(["run"]);
  expect(events[0].args).not.toContain("-S");
  expect(events[0].args).toContain("-n");
  expect(events[0].args).toContain("BatchMode=yes");
  expect(events[0].args).toContain("StrictHostKeyChecking=accept-new");
});

test("executeSshExec returns non-zero command output without leaking socket paths", async () => {
  const controlDir = join(tmpRoot, "control-master");
  const manager = new SessionManager({ sshBin: fakeSshPath, controlDir });

  const result = await executeSshExec(manager, { host: "prod", command: "fail-command", timeout: 5 });

  expect(result.exitCode).toBe(7);
  expect(result.stdout).toContain("bad output");
  expect(result.stderr).toContain("<control-socket>");
  expect(result.stderr).not.toContain(controlDir);
});

test("executeSshExec aborts commands that exceed the timeout", async () => {
  const manager = new SessionManager({
    sshBin: fakeSshPath,
    controlDir: join(tmpRoot, "control-master"),
  });

  await expect(
    executeSshExec(manager, { host: "prod", command: "slow-command", timeout: 0.05 }),
  ).rejects.toThrow(/timed out/i);
});

test("executeSshExec returns captured tail and notice when timeout results are requested", async () => {
  const manager = new SessionManager({
    sshBin: fakeSshPath,
    controlDir: join(tmpRoot, "control-master"),
  });

  const result = await executeSshExec(
    manager,
    { host: "prod", command: "slow-output", timeout: 1 },
    { timeoutMode: "result" },
  );

  expect(result.exitCode).toBeNull();
  expect(result.notice).toContain("timed out");
  expect(result.stdout).toContain("before timeout");
  expect(result.stderr).toContain("<control-socket>");
  expect(result.stderr).not.toContain(tmpRoot);
  expect(result.truncated).toBe(false);
});

test("executeSshExec keeps only the output tail when stdout exceeds the cap", async () => {
  const manager = new SessionManager({
    sshBin: fakeSshPath,
    controlDir: join(tmpRoot, "control-master"),
  });

  const result = await executeSshExec(manager, { host: "prod", command: "large-output", timeout: 5 });

  expect(result.truncated).toBe(true);
  expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(MAX_OUTPUT_BYTES);
  expect(result.stdout.endsWith("END\n")).toBe(true);
});

test("executeSshExec keeps only the stderr tail when stderr exceeds the cap", async () => {
  const manager = new SessionManager({
    sshBin: fakeSshPath,
    controlDir: join(tmpRoot, "control-master"),
  });

  const result = await executeSshExec(manager, { host: "prod", command: "large-error", timeout: 5 });

  expect(result.truncated).toBe(true);
  expect(Buffer.byteLength(result.stderr)).toBeLessThanOrEqual(MAX_OUTPUT_BYTES);
  expect(result.stderr.endsWith("ERR_END\n")).toBe(true);
});

test("executeSshExec retains a single combined stdout and stderr tail", async () => {
  const manager = new SessionManager({
    sshBin: fakeSshPath,
    controlDir: join(tmpRoot, "control-master"),
  });

  const result = await executeSshExec(manager, { host: "prod", command: "large-mixed-output", timeout: 5 });

  expect(result.truncated).toBe(true);
  expect(Buffer.byteLength(result.output ?? `${result.stdout}${result.stderr}`)).toBeLessThanOrEqual(MAX_OUTPUT_BYTES);
  expect(Buffer.byteLength(`${result.stdout}${result.stderr}`)).toBeLessThanOrEqual(MAX_OUTPUT_BYTES);
  expect(result.totalBytes).toBeGreaterThan(result.outputBytes ?? 0);
  expect(result.outputLines).toBeLessThanOrEqual(result.totalLines ?? Number.POSITIVE_INFINITY);
});

test("executeSshExec returns combined output plus separate retained stdout and stderr", async () => {
  const manager = new SessionManager({
    sshBin: fakeSshPath,
    controlDir: join(tmpRoot, "control-master"),
  });

  const result = await executeSshExec(manager, { host: "prod", command: "interleaved-output", timeout: 5 });

  expect(result.output).toContain("out-1\n");
  expect(result.output).toContain("err-1\n");
  expect(result.output).toContain("out-2\n");
  expect(result.output).toContain("err-2\n");
  expect(result.stdout).toBe("out-1\nout-2\n");
  expect(result.stderr).toBe("err-1\nerr-2\n");
});

test("executeSshExec redacts socket paths before tail truncation", async () => {
  const controlDir = join(tmpRoot, "control-master");
  const manager = new SessionManager({ sshBin: fakeSshPath, controlDir });
  const rawSocketPath = manager.get("prod").socketPath;

  const result = await executeSshExec(manager, { host: "prod", command: "split-socket-tail", timeout: 5 });

  expect(result.truncated).toBe(true);
  expect(result.stderr).not.toContain(rawSocketPath.slice(5, 30));
  expect(result.stderr).not.toContain(controlDir.slice(5));
});

test("executeSshExec does not split multibyte UTF-8 characters when truncating", async () => {
  const manager = new SessionManager({
    sshBin: fakeSshPath,
    controlDir: join(tmpRoot, "control-master"),
  });

  const result = await executeSshExec(manager, { host: "prod", command: "utf8-boundary", timeout: 5 });

  expect(result.truncated).toBe(true);
  expect(result.output).not.toContain("\uFFFD");
});

test("ssh_exec timeout defaults to OMP-aligned 60 seconds", () => {
  expect(clampTimeoutSeconds(undefined)).toBe(60);
});

async function readFakeLog(): Promise<Array<{ kind: string; args: string[] }>> {
  const raw = await readFile(fakeLogPath, "utf8");
  return raw
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function fakeSshSource(): string {
  return `#!/usr/bin/env bun
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const args = process.argv.slice(2);
const logPath = ${JSON.stringify(fakeLogPath)};

function argAfter(flag) {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

async function log(kind) {
  await appendFile(logPath, JSON.stringify({ kind, args }) + "\\n");
}

const socketPath = argAfter("-S");

if (args.includes("-O") && args.includes("check")) {
  await log("check");
  if (socketPath && await Bun.file(socketPath).exists()) {
    process.exit(0);
  }
  console.error("No ControlMaster");
  process.exit(255);
}

if (args.includes("-M") && args.includes("-N") && args.includes("-f")) {
  await log("start");
  if (!socketPath) process.exit(2);
  await mkdir(dirname(socketPath), { recursive: true });
  await Bun.write(socketPath, "master");
  process.exit(0);
}

await log("run");
const cmd = args[args.length - 1] ?? "";

if (cmd === "say-hello") {
  process.stdout.write("hello\\n");
  process.stderr.write("warn\\n");
  process.exit(0);
}

if (cmd === "fail-command") {
  process.stdout.write("bad output\\n");
  process.stderr.write("bad err " + socketPath + "\\n");
  process.exit(7);
}

if (cmd === "slow-command") {
  await Bun.sleep(2000);
  process.stdout.write("too late\\n");
  process.exit(0);
}

if (cmd === "slow-output") {
  process.stdout.write("before timeout\\n");
  process.stderr.write("err " + socketPath + "\\n");
  await Bun.sleep(2000);
  process.exit(0);
}

if (cmd === "large-output") {
  process.stdout.write("A".repeat(60 * 1024) + "END\\n");
  process.exit(0);
}

if (cmd === "large-error") {
  process.stderr.write("E".repeat(60 * 1024) + "ERR_END\\n");
  process.exit(0);
}

if (cmd === "large-mixed-output") {
  process.stdout.write("O".repeat(40 * 1024));
  process.stderr.write("E".repeat(40 * 1024) + "MIX_END\\n");
  process.exit(0);
}

if (cmd === "interleaved-output") {
  process.stdout.write("out-1\\n");
  await Bun.sleep(10);
  process.stderr.write("err-1\\n");
  await Bun.sleep(10);
  process.stdout.write("out-2\\n");
  await Bun.sleep(10);
  process.stderr.write("err-2\\n");
  process.exit(0);
}

if (cmd === "split-socket-tail") {
  const suffixLen = ${MAX_OUTPUT_BYTES} + 20;
  process.stderr.write("prefix" + socketPath + "Y".repeat(suffixLen));
  process.exit(0);
}

if (cmd === "utf8-boundary") {
  process.stdout.write("x🙂y" + "Z".repeat(${MAX_OUTPUT_BYTES}));
  process.exit(0);
}

process.stderr.write("unknown command: " + cmd + "\\n");
process.exit(9);
`;
}
