import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	SshfsManager,
	type ProcessResult,
	type ProcessRunner,
	validateSshfsHost,
} from "./sshfs-manager";

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

	const runner: ProcessRunner = async (command, args) => {
		calls.push({ command, args });
		if (command === "mount") {
			const visible = mounted && visibilityDelay === 0;
			if (mounted && visibilityDelay > 0) visibilityDelay -= 1;
			return ok(visible ? `${mounted.source} on ${mounted.path} type ${mounted.type} (rw)\n` : "");
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
			if (!unmountFails) mounted = undefined;
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
	};
}

function ok(stdout = ""): ProcessResult {
	return { exitCode: 0, stdout, stderr: "" };
}

function fail(stderr: string): ProcessResult {
	return { exitCode: 1, stdout: "", stderr };
}

describe("sshfs manager", () => {
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
		expect(host.calls.find((call) => call.command === "ssh")?.args).toContain("ConnectTimeout=8");
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
		expect(() => validateSshfsHost("-oProxyCommand=sh")).toThrow("must not start");
		expect(() => validateSshfsHost("host name")).toThrow("whitespace");
		expect(() => validateSshfsHost("host:/tmp")).toThrow("path or port");
		expect(() => validateSshfsHost("host:2200")).toThrow("path or port");
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
