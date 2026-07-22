# SSH

This plugin adds a `PreToolUse` hook for unified exec (`Bash`) and `apply_patch`. It maps `ssh/<host>:...` paths to an on-demand `sshfs` mount, using aliases from `~/.ssh/config`.

## Paths

```text
ssh/judy:/etc/hosts       # remote root: /etc/hosts
ssh/ileqm:~/project/a     # remote home: ~/project/a
ssh/ileqm:project/a       # remote home: ~/project/a
```

The root of each mount is `~/.codex/plugins/ssh/<host>/`. The hook reuses healthy mounts, follows symlinks on the remote server, and requires an existing trusted host key, `sshfs`, and Bun. A `SessionStart` hook teaches Codex the virtual path syntax without exposing the local mount path.

## Install

```bash
codex plugin marketplace add hheei/codex-mono --ref main
codex plugin add sshfs@codex-mono
```
