# SSH Exec

SSH Exec is a Codex plugin that exposes three MCP tools:

- `ssh_host`: discover configured OpenSSH host aliases
- `ssh_exec`: run non-interactive commands on a remote host
- `ssh_mount`: mount a remote host locally through `sshfs`

## Requirements

- OpenSSH host aliases in your local SSH config
- `sshfs` for `ssh_mount`
- Bun available on `PATH`

## Install

Install through the GitHub marketplace:

```bash
codex plugin marketplace add hheei/codex-plugins --ref main
codex plugin add ssh-exec@codex-plugins
```

## Tools

### `ssh_host`

Search local OpenSSH config aliases. Use it first when you are not sure an alias exists.

### `ssh_exec`

Run a non-interactive command on a remote OpenSSH host alias.

```text
ssh_exec(host: "prod", command: "systemctl reload nginx", timeout: 10)
```

### `ssh_mount`

Mount a remote host locally through `sshfs`. The returned path is a local mount point.

```text
ssh_mount(host: "prod")
read(path: "/local/mount/path/etc/nginx/nginx.conf")
edit(path: "/local/mount/path/etc/nginx/nginx.conf", ...)
ssh_exec(host: "prod", command: "nginx -t && systemctl reload nginx")
```
