# SSHFS

This plugin exposes one MCP tool: `sshfs`.

Call it explicitly with an OpenSSH host alias. It only mounts the remote root (`<host>:/`) under `~/.cache/sshfs-addon/` and returns both the local root path and the local path corresponding to the remote user's home directory.

For every SSH remote file read, write, edit, search, listing, or inspection request, the model must call `sshfs` first and then use built-in local file tools under one of the returned paths. Direct SSH commands are not used for remote file operations.

Healthy mounts are reused across compatible clients, including Pi Basics. The MCP server leaves healthy mounts in place when it exits. A conflicting filesystem is never unmounted or replaced.

Local `grep` and `find` work through SSHFS, but network metadata round trips make broad recursive scans expensive. Always target a narrow file or directory and never recursively scan the mounted root.

Remote connections and mount operations allow up to 30 seconds for high-latency clusters. Failed mounts receive at most 5 additional seconds for rollback, bounding a call to about 35 seconds.

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
