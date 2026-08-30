# Codex Mono

This is a monorepo for Codex plugins. Each directory under `plugins/` is an independently versioned plugin package; the repository keeps their manifests, skills, scripts, references, and install metadata together.

## Plugins

| Plugin | Version | Contents |
| --- | --- | --- |
| `atoms-plugin` | `0.1.1` | ASE-based atomistic structure conversion and the `vasp-helper` skill. Its VASP source is a private submodule. |
| `my-ppt` | `0.1.0+codex.20260709192819` | Presentation strategy, storytelling, visual direction, deck review, examples, and local slide-plan scripts. |
| `singbox` | `0.1.0` | Local SFM/sing-box and Clash API routing inspection, selector switching, and domain tests. |
| `sshfs` | `0.7.0` | `host_list`, `host_exec`, and `host_mount` for SSH host discovery, remote commands, and shared SSHFS mounts. |

The `sshfs` plugin exposes `host_list`, `host_exec`, and `host_mount`. Use `host_list` for configured aliases, `host_exec` for non-interactive remote process or service commands, and call `host_mount` before any remote file read, write, edit, search, listing, or inspection; it returns `localPath` and `remoteHomeLocalPath` under `~/.cache/sshfs-addon/<host>/`.

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

# Initialize the private source and refresh the official plugin cache.
setup_script="$(find "${CODEX_HOME:-$HOME/.codex}/plugins/cache/codex-mono/atoms-plugin" -path '*/scripts/install-vasp-source.sh' -print -quit)"
bash "$setup_script"
```

The script locates the marketplace root from Codex itself, initializes the private submodule with your normal Git credentials, and refreshes the official plugin cache. Re-run it after upgrading the marketplace snapshot.

## Install

Install the marketplace from GitHub:

```bash
codex plugin marketplace add hheei/codex-mono --ref main
codex plugin add sshfs@codex-mono
codex plugin add singbox@codex-mono
codex plugin add my-ppt@codex-mono
```

The marketplace publishes all four plugins. The first three can be installed directly from the Git marketplace; `atoms-plugin` needs the manual submodule initialization step above so its private VASP source is present.
