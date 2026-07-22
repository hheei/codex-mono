import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SshfsManager } from "./sshfs-manager";

let tmpRoot: string;

beforeEach(async () => {
	tmpRoot = await mkdtemp(join(tmpdir(), "sshfs-test-"));
});

afterEach(async () => {
	await rm(tmpRoot, { recursive: true, force: true });
});

test("reuses a healthy mount without starting sshfs", async () => {
	const manager = new SshfsManager({
		mountDir: join(tmpRoot, "mounts"),
		sshfsBin: join(tmpRoot, "missing-sshfs"),
		mountProbe: async () => ({ mounted: true, healthy: true }),
	});

	expect(await manager.ensureMounted("prod")).toBe(join(tmpRoot, "mounts", "prod"));
});

test("retries sshfs once", async () => {
	const fakeSshfs = join(tmpRoot, "fake-sshfs.ts");
	const countPath = join(tmpRoot, "count");
	const argsPath = join(tmpRoot, "args");
	await writeFile(fakeSshfs, `#!/usr/bin/env bun
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
const args = process.argv.slice(2);
const countPath = ${JSON.stringify(countPath)};
const argsPath = ${JSON.stringify(argsPath)};
const count = Number(await readFile(countPath, "utf8").catch(() => "0")) + 1;
await writeFile(countPath, String(count));
await appendFile(argsPath, JSON.stringify(args) + "\\n");
if (count === 1) process.exit(1);
const mountPath = args.at(-1);
await mkdir(mountPath, { recursive: true });
await writeFile(mountPath + "/.mounted", "yes");
`);
	await chmod(fakeSshfs, 0o755);
	const deadline = Date.now() + 5_000;
	const manager = new SshfsManager({
		mountDir: join(tmpRoot, "mounts"),
		sshfsBin: fakeSshfs,
		deadline: () => deadline,
		mountProbe: async (mountPath) => ({
			mounted: await stat(join(mountPath, ".mounted")).then(() => true).catch(() => false),
			healthy: await stat(join(mountPath, ".mounted")).then(() => true).catch(() => false),
		}),
		unmount: async () => true,
	});

	await manager.ensureMounted("prod");
	expect(await readFile(countPath, "utf8")).toBe("2");
	const args = await readFile(argsPath, "utf8");
	expect(args).toContain("StrictHostKeyChecking=yes");
	expect(args).toContain("follow_symlinks");
	expect(args).not.toMatch(/Control(Master|Path)/);
});

test("rejects when an unhealthy mount cannot be unmounted", async () => {
	const manager = new SshfsManager({
		mountDir: join(tmpRoot, "mounts"),
		mountProbe: async () => ({ mounted: true, healthy: false }),
		unmount: async () => false,
	});

	await expect(manager.ensureMounted("prod")).rejects.toThrow(/cannot unmount/i);
});

test("reports final cleanup failure after both mount attempts", async () => {
	const fakeSshfs = join(tmpRoot, "fake-sshfs.ts");
	await writeFile(fakeSshfs, "#!/usr/bin/env bun\n");
	await chmod(fakeSshfs, 0o755);
	let probes = 0;
	let unmounts = 0;
	const manager = new SshfsManager({
		mountDir: join(tmpRoot, "mounts"),
		sshfsBin: fakeSshfs,
		mountProbe: async () => (++probes === 1
			? { mounted: false, healthy: false }
			: { mounted: true, healthy: false }),
		unmount: async () => ++unmounts === 1,
	});

	await expect(manager.ensureMounted("prod")).rejects.toThrow(/cannot clear failed/i);
});

test("rejects once the shared deadline is exhausted", async () => {
	const manager = new SshfsManager({
		mountDir: join(tmpRoot, "mounts"),
		deadline: () => Date.now() - 1,
		mountProbe: async () => ({ mounted: false, healthy: false }),
	});

	await expect(manager.ensureMounted("prod")).rejects.toThrow(/timeout budget/i);
});
