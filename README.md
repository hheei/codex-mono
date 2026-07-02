# SSH Exec

`SSH Exec` lets Codex work with remote machines over OpenSSH in two steps:

1. Use `ssh_mount` once for a host when you want to read or edit remote files.
2. Use `ssh_exec` for remote commands such as checking status, restarting services, or verifying a change.

## Recommended workflow

For file changes:

1. Call `ssh_mount` with a host.
2. Use the returned local path with built-in `read`, `edit`, or `write`.
3. Use `ssh_exec` to validate the result or reload the remote service.

Example flow:

- `ssh_mount(host: "prod")`
- Read or edit files under the returned local mount path
- `ssh_exec(host: "prod", command: "systemctl reload nginx")`

## Tools

### `ssh_mount`

- Mounts the remote host locally with `sshfs`
- Reuses an existing healthy mount when possible
- Repairs a stale mount by remounting
- Returns a local path for built-in file tools
- Supported on Linux and macOS

### `ssh_exec`

- Runs a non-interactive remote command over SSH
- Best for validation, inspection, and service operations
- Returns bounded output with exit metadata

## Notes

- `ssh_mount` always mounts the remote root `/`
- Hosts use any OpenSSH-resolvable destination that your local machine can reach
- This plugin does not implement its own remote file read or write protocol; file edits are meant to go through Codex built-in file tools after `ssh_mount`
