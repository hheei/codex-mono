# SSH Exec

SSH Exec is a Codex MCP plugin for non-interactive remote command execution over OpenSSH.

It exposes one tool, `ssh_exec`, with a small RPC-style interface:

```json
{
  "host": "prod",
  "command": "uname -a",
  "timeout": 60
}
```

The plugin reuses OpenSSH ControlMaster connections, keeps session state hidden from the agent, and returns bounded command output with structured exit metadata.

## Install

Install the marketplace from GitHub:

```bash
codex plugin marketplace add hheei/ssh-exec --ref main
```

Install the plugin:

```bash
codex plugin add ssh-exec@ssh-exec
```

Start a new Codex thread after installation so the MCP tool is loaded.

## Requirements

- Codex with plugin support
- Bun
- OpenSSH client
- Existing SSH configuration or destination names resolvable by `ssh`

## Tool

### `ssh_exec`

Runs a non-interactive command on a remote OpenSSH destination.

Input:

- `host`: OpenSSH destination, for example `prod` or `user@example.com`
- `command`: command passed to the remote shell by OpenSSH
- `timeout`: optional timeout in seconds, default `60`, clamped to `1..3600`

Output:

- text content containing the combined stdout/stderr tail or `(no output)`
- `structuredContent` with `host`, `exitCode`, `stdout`, `stderr`, `durationMs`, `truncated`, and output size metadata

Non-zero exits, timeouts, and SSH startup failures are returned as MCP tool errors with captured output when available.

## Scope

SSH Exec intentionally does not expose session lifecycle tools, shell sessions, file transfer, host discovery, batch execution, or streaming APIs.

## Development

Run tests:

```bash
bun test plugins/ssh-exec/scripts/*.test.ts
```
