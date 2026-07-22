# SSHFS

This plugin exposes one MCP tool: `sshfs`.

Call it explicitly with an OpenSSH host alias. It only mounts the remote root (`<host>:/`) under `~/.cache/sshfs-addon/` and returns both the local root path and the local path corresponding to the remote user's home directory.

For every SSH remote file read, write, edit, search, listing, or inspection request, the model must call `sshfs` first and then use built-in local file tools under one of the returned paths. Direct SSH commands are not used for remote file operations.

Healthy mounts are reused across compatible clients, including Pi Basics, and are never remounted. The MCP server leaves healthy mounts in place when it exits. A conflicting filesystem is never unmounted or replaced.

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
