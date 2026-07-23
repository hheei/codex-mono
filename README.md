# Codex Mono

Small Codex plugins for local workflows and explicit remote-file access.

## Plugins

- `sshfs`: required before SSH remote file operations; mounts only the remote root and returns local root and remote-home paths.
- `singbox`: local SFM/sing-box routing operations.
- `my-ppt`: presentation design and review workflows.

The `sshfs` plugin exposes one MCP tool. Call it with an OpenSSH host alias before any remote file read, write, edit, search, listing, or inspection; it returns `localPath` and `remoteHomeLocalPath` under `~/.cache/sshfs-addon/<host>/`.

## Install

Install the marketplace from GitHub:

```bash
codex plugin marketplace add hheei/codex-mono --ref main
codex plugin add sshfs@codex-mono
```
