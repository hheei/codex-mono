# Codex Plugins

This repository contains Codex plugins.

## Plugins

- `sshfs`: required before SSH remote file operations; mounts only the remote root and returns local root and remote-home paths.

## Install

Install the marketplace from GitHub:

```bash
codex plugin marketplace add hheei/codex-mono --ref main
codex plugin add sshfs@codex-mono
```
