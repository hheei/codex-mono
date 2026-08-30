# SSHFS

This plugin exposes three MCP tools: `host_list`, `host_exec`, and `host_mount`.

`host_list` reads the user's `~/.ssh/config` and recursively included files. It returns explicit aliases in first-seen order, skips wildcard and negated patterns, and does not read the system SSH config or run SSH.

`host_exec` runs one complete command string on a specified host using the remote account's default shell. It accepts optional `cwd` and `timeoutMs` (1 to 300000 milliseconds), captures stdout and stderr, and returns remote non-zero exit codes as structured data. It is non-interactive and does not support sudo or password prompts. `host_exec` reuses a plugin-owned OpenSSH ControlMaster per host with `ControlPersist=60m`; `host_mount` uses a separate SSHFS connection and does not share that mux.

For every SSH remote file read, write, edit, search, listing, or inspection request, call `host_mount` first and then use built-in local file tools under one of the returned paths. It mounts the remote root (`<host>:/`) under `~/.cache/sshfs-addon/<host>/` and returns `localPath` plus `remoteHomeLocalPath`, the local path corresponding to the remote user's home directory.

Healthy matching mounts are reused across compatible clients, including Pi Basics, and are never remounted. The MCP server leaves healthy mounts in place when it exits. A conflicting filesystem is never unmounted or replaced.

Every explicit call first queries the host over SSH and resolves its remote home. It makes at most two query attempts within one 10-second budget, so unreachable hosts fail without starting SSHFS. Reachable hosts then receive a separate 30-second mount window; failed mounts receive at most 5 additional seconds for rollback.

Local `grep` and `find` work through SSHFS, but network metadata round trips make broad recursive scans expensive. Always target a narrow file or directory and never recursively scan the mounted root.


## Requirements

- Linux or macOS
- Bun
- `sshfs`
- Non-interactive OpenSSH authentication

## Install

```bash
codex plugin marketplace add hheei/codex-mono --ref main
codex plugin add sshfs@codex-mono
```
