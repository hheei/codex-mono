import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { listConfiguredHosts } from "./config";

test("lists explicit hosts in recursive includes in first-seen order", async () => {
	const root = await mkdtemp(join(tmpdir(), "ssh-config-test-"));
	const config = join(root, "config");
	const include = join(root, "included.conf");
	await writeFile(config, "Host prod *.wild !blocked\nInclude included.conf\nHost prod local\nMatch host ignored\n");
	await writeFile(include, "Host gpu\nHost \"quoted-host\"\n");

	await expect(listConfiguredHosts(config)).resolves.toEqual({
		hosts: ["prod", "gpu", "quoted-host", "local"],
		configPath: resolve(config),
	});
});

test("returns an empty list for a missing root config", async () => {
	const config = join(await mkdtemp(join(tmpdir(), "ssh-config-test-")), "missing");
	await expect(listConfiguredHosts(config)).resolves.toEqual({ hosts: [], configPath: resolve(config) });
});

test("expands include globs in lexical order and avoids cycles", async () => {
	const root = await mkdtemp(join(tmpdir(), "ssh-config-test-"));
	const config = join(root, "config");
	await writeFile(config, "Include parts/*.conf\n");
	await mkdir(join(root, "parts"));
	await writeFile(join(root, "parts", "a.conf"), "Host first\nInclude ../config\n");
	await writeFile(join(root, "parts", "b.conf"), "Host second\n");
	await expect(listConfiguredHosts(config)).resolves.toMatchObject({ hosts: ["first", "second"] });
});
