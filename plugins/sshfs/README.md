# SSHFS

Use configured SSH hosts from Codex, with explicit mounts for remote files.

## Tools

| Tool | Use it for | Notes |
| --- | --- | --- |
| `host_list` | Discover SSH aliases | Reads `~/.ssh/config` and included files only. Wildcard and negated entries are omitted. |
| `host_exec` | Remote processes and services | Runs one non-interactive command in the remote account's default shell. Supports `cwd` and `timeoutMs` (1-300000 ms); no `sudo` or password prompts. |
| `host_mount` | Any remote file operation | Mounts `<host>:/` and returns `localPath` plus `remoteHomeLocalPath`. |

## Usage Rules

1. Call `host_list` when the host alias is unknown.
2. Use `host_exec` for remote process or service operations.
3. Before every remote file read, write, edit, search, listing, or inspection, call `host_mount` first. Then use local file tools under its returned paths.

Keep `grep` and `find` scoped to a specific directory or file. Recursive scans of a mounted root are slow because filesystem metadata crosses the network.

Mounts live under `~/.cache/sshfs-addon/<host>/`. Healthy matching mounts are reused, including mounts created by Pi Basics, and remain after the MCP server exits. A conflicting filesystem is never unmounted or replaced.

`host_exec` uses a plugin-owned OpenSSH ControlMaster per host (`ControlPersist=60m`). SSHFS uses a separate connection.

## Environment

These optional variables configure new `SshfsManager` instances. Unset or empty values use the current defaults. `BatchMode=yes` remains fixed so the tools cannot block on interactive authentication.

| Variable | Default | Applies to |
| --- | --- | --- |
| `SSHFS_MOUNT_ROOT` | `~/.cache/sshfs-addon` | Local mount and ControlMaster directory |
| `SSHFS_SERVER_ALIVE_INTERVAL` | `300` | SSH and SSHFS keepalive interval, in seconds |
| `SSHFS_EXEC_SERVER_ALIVE_COUNT_MAX` | `1` | `host_exec` and remote-home SSH query |
| `SSHFS_MOUNT_SERVER_ALIVE_COUNT_MAX` | `3` | SSHFS mount connection |
| `SSHFS_EXEC_CONNECT_TIMEOUT` | `15` | `host_exec` and remote-home SSH query, in seconds |
| `SSHFS_MOUNT_CONNECT_TIMEOUT` | `30` | SSHFS mount connection, in seconds |
| `SSHFS_CONNECTION_ATTEMPTS` | `1` | SSH and SSHFS connection attempts |
| `SSHFS_CONTROL_PERSIST` | `60m` | `host_exec` and remote-home SSH ControlMaster lifetime |
| `SSHFS_STRICT_HOST_KEY_CHECKING` | `accept-new` | SSH and SSHFS host key policy |

Each mount request checks SSH connectivity and resolves the remote home within 10 seconds. SSHFS then has a separate 30-second mount window, followed by up to 5 seconds of rollback if mounting fails.

## Requirements

- Linux or macOS
- Bun
- `sshfs`
- Non-interactive OpenSSH authentication

### Linux

FUSE 2 and FUSE 3 are supported. The plugin prefers `fusermount3` for unmounting, then falls back to `fusermount` and `umount`.

```bash
# Debian, Ubuntu
sudo apt install sshfs

# Fedora, RHEL, Rocky, AlmaLinux
sudo dnf install fuse-sshfs

# Arch Linux
sudo pacman -S sshfs

# openSUSE
sudo zypper install sshfs
```

Rootless mounts need a working FUSE installation. In containers, expose `/dev/fuse` and allow the FUSE device.

### Windows

Use the plugin from WSL2 and install SSHFS inside that Linux distribution:

```bash
sudo apt update
sudo apt install sshfs
```

Native Windows is unsupported. SSHFS-Win uses drive letters and Windows-specific mount handling, while this plugin requires POSIX mount paths.

## Install

```bash
codex plugin marketplace add hheei/codex-mono --ref main
codex plugin add sshfs@codex-mono
```
