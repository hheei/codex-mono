# Codex Mono

This is a monorepo for Codex plugins. Each directory under `plugins/` is an independently versioned plugin package; the repository keeps their manifests, skills, scripts, references, and install metadata together.

## Plugins

| Plugin | Version | Contents |
| --- | --- | --- |
| `atoms-plugin` | `0.1.0` | ASE-based atomistic structure conversion and the `vasp-helper` skill. Its VASP source is a private submodule. |
| `my-ppt` | `0.1.0+codex.20260709192819` | Presentation strategy, storytelling, visual direction, deck review, examples, and local slide-plan scripts. |
| `singbox` | `0.1.0` | Local SFM/sing-box and Clash API routing inspection, selector switching, and domain tests. |
| `sshfs` | `0.6.0` | One explicit MCP tool that mounts an SSH remote root for local file tools and reuses healthy shared mounts. |

The `sshfs` plugin exposes one MCP tool. Call it with an OpenSSH host alias before any remote file read, write, edit, search, listing, or inspection; it returns `localPath` and `remoteHomeLocalPath` under `~/.cache/sshfs-addon/<host>/`.

The `vasp-helper` source is a private submodule from [`hheei/vasp-source`](https://github.com/hheei/vasp-source); the VASP source is not stored in this repository. You need access to that private repository to use `atoms-plugin`'s source-navigation features.

## Clone

Clone the monorepo together with its submodule:

```bash
git clone --recurse-submodules https://github.com/hheei/codex-mono.git
cd codex-mono
```

For an existing checkout, initialize or update all submodules with:

```bash
git submodule update --init --recursive
```

`codex plugin add` does not run Git's submodule initialization. It can install `atoms-plugin`, but its `vasp-helper/source/` directory will be empty when the marketplace snapshot has an uninitialized submodule. Install it from the Git marketplace first, then initialize the submodule in Codex's marketplace checkout:

```bash
codex plugin marketplace add hheei/codex-mono --ref main
codex plugin add atoms-plugin@codex-mono

# Find the marketplace checkout path registered by Codex.
codex plugin marketplace list

# Read the ROOT shown for codex-mono above; do not assume a cache path.
MARKETPLACE_ROOT="$(codex plugin marketplace list | awk '$1 == \"codex-mono\" {print $2; exit}')"
test -n "$MARKETPLACE_ROOT" && test -d "$MARKETPLACE_ROOT"
git -C "$MARKETPLACE_ROOT" submodule update --init --recursive

# Refresh the installed plugin cache after the source appears.
codex plugin remove atoms-plugin@codex-mono
codex plugin add atoms-plugin@codex-mono
```

The submodule clone uses your normal Git credentials, so the account must have access to the private [`hheei/vasp-source`](https://github.com/hheei/vasp-source) repository. Re-run the `git -C ... submodule update` step after upgrading the marketplace snapshot.

## Install

Install the marketplace from GitHub:

```bash
codex plugin marketplace add hheei/codex-mono --ref main
codex plugin add sshfs@codex-mono
codex plugin add singbox@codex-mono
codex plugin add my-ppt@codex-mono
```

The marketplace publishes all four plugins. The first three can be installed directly from the Git marketplace; `atoms-plugin` needs the manual submodule initialization step above so its private VASP source is present.
