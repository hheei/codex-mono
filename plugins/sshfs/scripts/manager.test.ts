import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	SshfsManager,
	type ProcessResult,
	type ProcessRunner,
	validateHost,
} from "./manager";

interface MountedState {
	source: string;
	path: string;
	type: string;
	healthy: boolean;
}

const temporaryPaths: string[] = [];

afterEach(async () => {
	await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function temporaryMountRoot(): Promise<string> {
	const path = await mkdtemp(join(tmpdir(), "sshfs-test-"));
	temporaryPaths.push(path);
	return path;
}

function harness() {
	const calls: Array<{ command: string; args: string[] }> = [];
	let mounted: MountedState | undefined;
	let filesystemSource: string | undefined;
	let visibilityDelay = 0;
	let sshfsResult: ProcessResult = { exitCode: 0, stdout: "", stderr: "" };
	let sshResult: ProcessResult = { exitCode: 0, stdout: "/home/test", stderr: "" };
	let sshResults: ProcessResult[] = [];
	let unmountFails = false;
	let replaceWithConflictOnUnmount = false;

	const runner: ProcessRunner = async (command, args) => {
		calls.push({ command, args });
		if (command === "mount") {
			const visible = mounted && visibilityDelay === 0;
			if (mounted && visibilityDelay > 0) visibilityDelay -= 1;
			return ok(visible && mounted ? `${mounted.source} on ${mounted.path} type ${mounted.type} (rw)\n` : "");
		}
		if (command === "df") {
			const source = filesystemSource ?? mounted?.source ?? "/dev/local";
			return ok(`Filesystem 512-blocks Used Available Capacity Mounted on\n${source} 1 1 1 1% ${args.at(-1)}\n`);
		}
		if (command === "ls") return mounted?.healthy === false ? fail("stale") : ok();
		if (command === "ssh") return sshResults.shift() ?? sshResult;
		if (command === "sshfs") {
			const source = args.at(-2)!;
			const path = args.at(-1)!;
			mounted = { source, path, type: "fuse.sshfs", healthy: true };
			filesystemSource = undefined;
			return sshfsResult;
		}
		if (command === "fusermount" || command === "umount" || command === "diskutil") {
			if (!unmountFails) {
				mounted = replaceWithConflictOnUnmount
					? { source: "other:/", path: mounted?.path ?? "", type: "fuse.sshfs", healthy: true }
					: undefined;
			}
			return unmountFails ? fail("busy") : ok();
		}
		return fail("unsupported");
	};

	return {
		calls,
		runner,
		mounted: () => mounted,
		setMounted: (value: MountedState | undefined) => { mounted = value; },
		setFilesystemSource: (value: string | undefined) => { filesystemSource = value; },
		setVisibilityDelay: (value: number) => { visibilityDelay = value; },
		setSshfsResult: (value: ProcessResult) => { sshfsResult = value; },
		setSshResult: (value: ProcessResult) => { sshResult = value; },
		setSshResults: (value: ProcessResult[]) => { sshResults = [...value]; },
		setUnmountFails: (value: boolean) => { unmountFails = value; },
		setReplaceWithConflictOnUnmount: (value: boolean) => { replaceWithConflictOnUnmount = value; },
	};
}

function ok(stdout = ""): ProcessResult {
	return { exitCode: 0, stdout, stderr: "" };
}

function fail(stderr: string): ProcessResult {
	return { exitCode: 1, stdout: "", stderr };
}

describe("sshfs manager", () => {
	test("executes a complete command through the host default shell", async () => {
		const host = harness();
		const manager = new SshfsManager({ runner: host.runner });
		host.setSshResult({ exitCode: 7, stdout: "out", stderr: "err" });

		await expect(manager.execOnHost({ host: "prod", command: "printf 'a b'", cwd: "/tmp/a'b", timeoutMs: 1234 })).resolves.toEqual({
			host: "prod",
			command: "printf 'a b'",
			cwd: "/tmp/a'b",
			exitCode: 7,
			stdout: "out",
			stderr: "err",
			timedOut: false,
		});
		const call = host.calls.find((entry) => entry.command === "ssh");
		expect(call?.args).toEqual([
			"-n", "-o", "ServerAliveInterval=300", "-o", "ServerAliveCountMax=1", "-o", "ConnectTimeout=15",
			"-o", "ConnectionAttempts=1", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new",
			"--", "prod", "cd -- '/tmp/a'\\''b' && printf 'a b'",
		]);
	});

	test("returns a remote non-zero exit and rejects diagnostic failures", async () => {
		const host = harness();
		const manager = new SshfsManager({ runner: host.runner });
		host.setSshResult({ exitCode: 255, stdout: "", stderr: "Could not resolve hostname offline" });
		await expect(manager.execOnHost({ host: "offline", command: "true" })).rejects.toThrow("not reachable");

		host.setSshResult({ exitCode: 255, stdout: "remote", stderr: "remote application failed" });
		await expect(manager.execOnHost({ host: "prod", command: "true" })).resolves.toMatchObject({ exitCode: 255, timedOut: false });
	});

	test("rejects invalid exec input and reports timeout", async () => {
		const host = harness();
		const manager = new SshfsManager({ runner: host.runner });
		await expect(manager.execOnHost({ host: "prod", command: "" })).rejects.toThrow("non-empty");
		await expect(manager.execOnHost({ host: "prod", command: "id", timeoutMs: 300001 })).rejects.toThrow("between 1 and 300000");
		host.setSshResult({ exitCode: null, stdout: "", stderr: "", timedOut: true });
		await expect(manager.execOnHost({ host: "prod", command: "sleep 10", timeoutMs: 42 })).rejects.toThrow("timed out");
	});

	test("rejects runner failures and truncates oversized output", async () => {
		const rejected = new SshfsManager({ runner: async () => { throw new Error("runner failed"); } });
		await expect(rejected.execOnHost({ host: "prod", command: "id" })).rejects.toThrow("runner failed");

		const head = "a".repeat(5 * 1024);
		const tail = "b".repeat(5 * 1024);
		const oversized = new SshfsManager({
			runner: async () => ({ exitCode: 0, stdout: `${head}${"x".repeat(64 * 1024)}${tail}`, stderr: `${head}${"y".repeat(64 * 1024)}${tail}` }),
		});
		const result = await oversized.execOnHost({ host: "prod", command: "id" });
		expect(result.stdout).toBe(`${head}\n...[output truncated; omitted 64 KiB]...\n${tail}`);
		expect(result.stderr).toBe(`${head}\n...[output truncated; omitted 64 KiB]...\n${tail}`);
	});

	test("mounts a remote root and reuses the healthy shared mount", async () => {
		const mountRoot = await temporaryMountRoot();
		const host = harness();
		const manager = new SshfsManager({ mountRoot, platform: "linux", runner: host.runner });

		const first = await manager.ensureMounted("prod");
		const second = await manager.ensureMounted("prod");

		expect(first).toEqual({
			host: "prod",
			localPath: join(mountRoot, "prod"),
			remoteHomeLocalPath: join(mountRoot, "prod", "home", "test"),
			status: "mounted",
		});
		expect(second.status).toBe("reused");
		expect(host.calls.filter((call) => call.command === "sshfs")).toHaveLength(1);
		expect(host.calls.filter((call) => call.command === "ssh")).toHaveLength(2);
		expect(host.calls.find((call) => call.command === "ssh")?.args).toContain("ConnectTimeout=15");
		expect(host.calls.find((call) => call.command === "sshfs")?.args).toContain("ConnectTimeout=30");
	});

	test("refuses a mountpoint occupied by another filesystem", async () => {
		const mountRoot = await temporaryMountRoot();
		const host = harness();
		const localPath = join(mountRoot, "prod");
		host.setMounted({ source: "/dev/disk1", path: localPath, type: "ext4", healthy: true });
		const manager = new SshfsManager({ mountRoot, platform: "linux", runner: host.runner });

		await expect(manager.ensureMounted("prod")).rejects.toThrow("occupied by another filesystem");
		expect(host.calls.some((call) => call.command === "sshfs")).toBe(false);
		expect(host.calls.some((call) => call.command === "fusermount")).toBe(false);
	});

	test("replaces a matching unhealthy mount", async () => {
		const mountRoot = await temporaryMountRoot();
		const host = harness();
		const localPath = join(mountRoot, "prod");
		host.setMounted({ source: "prod:/", path: localPath, type: "fuse.sshfs", healthy: false });
		const manager = new SshfsManager({ mountRoot, platform: "linux", runner: host.runner });

		expect((await manager.ensureMounted("prod")).status).toBe("mounted");
		expect(host.calls.some((call) => call.command === "fusermount")).toBe(true);
		expect(host.calls.filter((call) => call.command === "sshfs")).toHaveLength(1);
	});

	test("ignores a stale mount-table entry whose live source differs", async () => {
		const mountRoot = await temporaryMountRoot();
		const host = harness();
		const localPath = join(mountRoot, "prod");
		host.setMounted({ source: "prod:/", path: localPath, type: "fuse.sshfs", healthy: true });
		host.setFilesystemSource("/dev/local");
		const manager = new SshfsManager({ mountRoot, platform: "linux", runner: host.runner });

		expect((await manager.ensureMounted("prod")).status).toBe("mounted");
		expect(host.calls.filter((call) => call.command === "sshfs")).toHaveLength(1);
	});

	test("waits for a daemonized mount to become visible", async () => {
		const mountRoot = await temporaryMountRoot();
		const host = harness();
		host.setVisibilityDelay(2);
		const manager = new SshfsManager({ mountRoot, platform: "linux", runner: host.runner });

		await manager.ensureMounted("prod");
		expect(host.calls.filter((call) => call.command === "mount").length).toBeGreaterThan(2);
	});

	test("rolls back a mount that times out", async () => {
		const mountRoot = await temporaryMountRoot();
		const host = harness();
		host.setSshfsResult({ exitCode: null, stdout: "", stderr: "", timedOut: true });
		const manager = new SshfsManager({ mountRoot, platform: "linux", runner: host.runner });

		await expect(manager.ensureMounted("prod")).rejects.toThrow("timed out");
		expect(host.mounted()).toBeUndefined();
	});

	test("does not remove a mount path replaced by a conflicting filesystem during rollback", async () => {
		const mountRoot = await temporaryMountRoot();
		const host = harness();
		host.setSshfsResult({ exitCode: 1, stdout: "", stderr: "mount failed" });
		host.setReplaceWithConflictOnUnmount(true);
		const manager = new SshfsManager({ mountRoot, platform: "linux", runner: host.runner });

		await expect(manager.ensureMounted("prod")).rejects.toThrow("mount failed");
		expect(host.mounted()?.source).toBe("other:/");
		await expect(readdir(join(mountRoot, "prod"))).resolves.toBeArray();
	});

	test("reports a missing sshfs binary", async () => {
		const mountRoot = await temporaryMountRoot();
		const host = harness();
		host.setSshfsResult({ exitCode: 127, stdout: "", stderr: "" });
		const manager = new SshfsManager({ mountRoot, platform: "linux", runner: host.runner });

		await expect(manager.ensureMounted("prod")).rejects.toThrow("binary not found");
	});

	test("fails before touching sshfs when the connectivity query fails", async () => {
		const mountRoot = await temporaryMountRoot();
		const host = harness();
		host.setSshResult({ exitCode: 255, stdout: "", stderr: "unreachable" });
		const manager = new SshfsManager({ mountRoot, platform: "linux", runner: host.runner });

		await expect(manager.ensureMounted("offline")).rejects.toThrow("not reachable");
		expect(host.calls.some((call) => call.command === "sshfs")).toBe(false);
		expect(host.calls.filter((call) => call.command === "ssh")).toHaveLength(2);
	});

	test("mounts when a transient connectivity failure recovers on the second query", async () => {
		const mountRoot = await temporaryMountRoot();
		const host = harness();
		host.setSshResults([fail("network changed"), ok("/home/test")]);
		const manager = new SshfsManager({ mountRoot, platform: "linux", runner: host.runner });

		expect((await manager.ensureMounted("recovering")).status).toBe("mounted");
		expect(host.calls.filter((call) => call.command === "ssh")).toHaveLength(2);
		expect(host.calls.filter((call) => call.command === "sshfs")).toHaveLength(1);
	});

	test("uses a traversal-safe path and the macOS local option", async () => {
		const mountRoot = await temporaryMountRoot();
		const host = harness();
		const manager = new SshfsManager({ mountRoot, platform: "darwin", runner: host.runner });

		const result = await manager.ensureMounted("user@host");
		expect(result.localPath).toBe(join(mountRoot, "user%40host"));
		const args = host.calls.find((call) => call.command === "sshfs")?.args;
		expect(args).toContain("local");
		expect(args).toContain("ConnectTimeout=30");
	});

	test("rejects symlink mountpoints and unsafe hosts", async () => {
		const root = await temporaryMountRoot();
		const mountRoot = join(root, "mounts");
		const target = join(root, "target");
		await mkdir(mountRoot);
		await mkdir(target);
		await symlink(target, join(mountRoot, "prod"));
		const manager = new SshfsManager({ mountRoot, platform: "linux", runner: harness().runner });

		await expect(manager.ensureMounted("prod")).rejects.toThrow("real directory");
		expect(() => validateHost("-oProxyCommand=sh")).toThrow("must not start");
		expect(() => validateHost("host name")).toThrow("whitespace");
		expect(() => validateHost("host:/tmp")).toThrow("path or port");
		expect(() => validateHost("host:2200")).toThrow("path or port");
	});

	test("rejects non-empty mountpoints and unsupported platforms", async () => {
		const mountRoot = await temporaryMountRoot();
		await mkdir(join(mountRoot, "prod"));
		await writeFile(join(mountRoot, "prod", "data"), "occupied");
		const host = harness();
		const manager = new SshfsManager({ mountRoot, platform: "linux", runner: host.runner });

		await expect(manager.ensureMounted("prod")).rejects.toThrow("not empty");
		await expect(new SshfsManager({ mountRoot, platform: "win32", runner: host.runner }).ensureMounted("prod"))
			.rejects.toThrow("Linux and macOS");
	});

	test("does not report a failed unmount as success", async () => {
		const mountRoot = await temporaryMountRoot();
		const host = harness();
		const localPath = join(mountRoot, "prod");
		host.setMounted({ source: "prod:/", path: localPath, type: "fuse.sshfs", healthy: false });
		host.setUnmountFails(true);
		const manager = new SshfsManager({ mountRoot, platform: "linux", runner: host.runner });

		await expect(manager.ensureMounted("prod")).rejects.toThrow("Unable to unmount unhealthy");
	});
});
