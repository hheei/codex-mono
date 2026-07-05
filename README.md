# SSH Exec

`@hheei/ssh-exec` gives coding agents three practical SSH tools: discover configured hosts, run remote commands, and mount remote files so normal file tools can edit them.

It is meant for agents such as pi, Codex, or any MCP client that should work with machines you already access through OpenSSH aliases.

## What It Solves

Most agents can run shell commands, but remote work is awkward without a clear tool interface. This package gives the agent explicit SSH tools instead of making it invent shell command formats.

It also supports `sshfs` mounting. After a remote host is mounted, the agent can use its usual `read`, `write`, and `edit` tools on the returned local mount path, instead of trying to patch files through ad hoc `ssh` command strings.

In pi, the tools also render in a compact, readable form:

```text
ssh_host "prod|staging"
ssh_mount @prod
ssh_exec @prod (timeout: 10s)
$ systemctl status nginx
```

Tool output follows pi's normal collapsed/expanded behavior, so long command output can stay compact and be expanded when needed.

## Requirements

- OpenSSH with usable host aliases in your local SSH config
- `sshfs` for `ssh_mount`
- pi, Codex, or another MCP client

Platform note: this has only been tested on macOS so far. Linux should work as long as OpenSSH and `sshfs` are installed and available on `PATH`.

`ssh_exec` and `ssh_host` do not require `sshfs`; only `ssh_mount` does.

## Install in pi

Recommended:

```bash
pi install npm:@hheei/ssh-exec
```

This registers:

- `ssh_host(ssh_host: string)`
- `ssh_mount(host: string)`
- `ssh_exec(host: string, command: string, timeout?: number)`

Use the `npm:` prefix when installing npm packages with pi.

### pi Settings

Run `/ssh` in pi to open the SSH Exec settings UI. These settings apply only to the pi extension.

The UI contains two kinds of settings:

- connection defaults used by future `ssh_exec`, `ssh_mount`, and SSH master sessions
- a host filter that can globally disable selected SSH aliases

Available settings:

| Setting | Default | Applies To | Meaning |
| --- | ---: | --- | --- |
| Default command timeout | `10s` | `ssh_exec` | Used when the tool call omits `timeout`. Per-call `timeout` still wins. |
| ControlMaster alive | `3600s` | `ssh_exec`, `ssh_mount` | SSH `ControlPersist`; how long the reusable master connection stays alive. |
| Alive interval | `300s` | `ssh`, `sshfs` | SSH `ServerAliveInterval`; keepalive ping interval. |
| Alive retry count | `3` | `ssh`, `sshfs` | SSH `ServerAliveCountMax`; retry count before the connection is considered dead. |
| `@host` rows | `enabled` | all SSH tools | Disable a host globally without editing `~/.ssh/config`. |

Disabled hosts are hidden from `ssh_host` results. Direct `ssh_exec` and `ssh_mount` calls to disabled hosts return an error instead of connecting.

The settings are stored globally at `~/.pi/agent/ssh-exec.json`:

```json
{
  "commandTimeoutSeconds": 60,
  "controlPersistSeconds": 7200,
  "serverAliveIntervalSeconds": 300,
  "serverAliveCountMax": 3,
  "disabledHosts": ["prod", "staging"]
}
```

Example behavior with that file:

```text
ssh_host(ssh_host: "*")
// prod and staging are hidden

ssh_exec(host: "prod", command: "uptime")
// returns an error without opening an SSH connection

ssh_exec(host: "dev", command: "uptime")
// uses timeout 60s unless timeout is passed explicitly
```

## Install in Codex

This repo includes a Codex plugin at `plugins/ssh-exec/`.

Install through a Codex marketplace source:

```bash
codex plugin marketplace add hheei/ssh-exec --ref main --sparse .agents/plugins
codex plugin add ssh-exec@ssh-exec
```

Or from a local checkout:

```bash
codex plugin marketplace add /path/to/ssh-exec/.agents/plugins
codex plugin add ssh-exec@ssh-exec
```

## Use with MCP Clients

If your MCP client can launch npm packages directly, use `npx`:

```json
{
  "mcpServers": {
    "ssh": {
      "command": "npx",
      "args": ["-y", "@hheei/ssh-exec"]
    }
  }
}
```

If you prefer Bun, use `bunx`:

```json
{
  "mcpServers": {
    "ssh": {
      "command": "bunx",
      "args": ["@hheei/ssh-exec"]
    }
  }
}
```

Reference config: `examples/pi-agent.mcp.json`.

### MCP and Codex Environment Variables

The pi `/ssh` settings UI is only for the pi extension. Codex and general MCP clients run through the MCP server and do not read `~/.pi/agent/ssh-exec.json`. Configure those clients with environment variables instead.

| Environment Variable | Default | Applies To | Meaning |
| --- | ---: | --- | --- |
| `SSH_EXEC_COMMAND_TIMEOUT_SECONDS` | `10` | `ssh_exec` | Default command timeout when a call omits `timeout`. |
| `SSH_EXEC_CONTROL_PERSIST_SECONDS` | `3600` | `ssh_exec`, `ssh_mount` | SSH `ControlPersist` lifetime for master connections. |
| `SSH_EXEC_CONNECT_TIMEOUT_SECONDS` | `30` | SSH connection setup | SSH `ConnectTimeout`. |
| `SSH_EXEC_CONNECTION_ATTEMPTS` | `2` | SSH connection setup | SSH `ConnectionAttempts`. |
| `SSH_EXEC_SERVER_ALIVE_INTERVAL_SECONDS` | `300` | `ssh`, `sshfs` | SSH `ServerAliveInterval`. |
| `SSH_EXEC_SERVER_ALIVE_COUNT_MAX` | `3` | `ssh`, `sshfs` | SSH `ServerAliveCountMax`. |
| `SSH_EXEC_DISABLED_HOSTS` | `[]` | all SSH tools | JSON list string of aliases hidden from `ssh_host` and blocked for `ssh_exec` / `ssh_mount`, for example `["prod","staging"]`. |

Example `npx` launch:

```bash
SSH_EXEC_COMMAND_TIMEOUT_SECONDS=60 \
SSH_EXEC_CONTROL_PERSIST_SECONDS=7200 \
SSH_EXEC_SERVER_ALIVE_INTERVAL_SECONDS=120 \
SSH_EXEC_SERVER_ALIVE_COUNT_MAX=5 \
SSH_EXEC_DISABLED_HOSTS='["prod","staging"]' \
npx -y @hheei/ssh-exec
```

Example MCP config with environment variables:

```json
{
  "mcpServers": {
    "ssh": {
      "command": "npx",
      "args": ["-y", "@hheei/ssh-exec"],
      "env": {
        "SSH_EXEC_COMMAND_TIMEOUT_SECONDS": "60",
        "SSH_EXEC_CONTROL_PERSIST_SECONDS": "7200",
        "SSH_EXEC_DISABLED_HOSTS": "[\"prod\",\"staging\"]"
      }
    }
  }
}
```

With `SSH_EXEC_DISABLED_HOSTS='["prod","staging"]'`:

```text
ssh_host(ssh_host: "*")
// prod and staging are hidden

ssh_mount(host: "prod")
// returns an error without mounting

ssh_exec(host: "prod", command: "uptime")
// returns an error without connecting
```

## Tools

### `ssh_host`

Search local OpenSSH config aliases. Use this first when you are not sure which alias exists.

Examples:

- `ssh_host(ssh_host: "*")`: list configured hosts
- `ssh_host(ssh_host: "prod")`: find matching aliases
- `ssh_host(ssh_host: "prod|staging")`: regex-style search for multiple aliases

Example output:

```text
prod (deploy@example.com)
staging (deploy@staging.example.com)
```

### `ssh_exec`

Run a non-interactive command on a remote OpenSSH host alias.

Example:

```text
ssh_exec(host: "prod", command: "systemctl reload nginx", timeout: 10)
```

Use it for inspection, verification, service reloads, log checks, and other commands where text output is enough.

### `ssh_mount`

Mount a remote host locally through `sshfs`. The returned path is a local mount point. After mounting, the agent can operate under that path with normal file tools.

Example flow:

```text
ssh_mount(host: "prod")
read(path: "/local/mount/path/etc/nginx/nginx.conf")
edit(path: "/local/mount/path/etc/nginx/nginx.conf", ...)
ssh_exec(host: "prod", command: "nginx -t && systemctl reload nginx")
```

`ssh_mount` mounts the remote root `/`, so the returned local path represents the remote filesystem root.

## Recommended Workflow

1. Use `ssh_host` to find or confirm the SSH alias.
2. Use `ssh_mount` before reading or editing remote files.
3. Use normal file tools on the returned local mount path.
4. Use `ssh_exec` to verify state, run tests, reload services, or inspect logs.

Example:

```text
ssh_host(ssh_host: "prod|staging")
ssh_mount(host: "prod")
read(path: "/returned/mount/path/home/app/config.yml")
edit(path: "/returned/mount/path/home/app/config.yml", ...)
ssh_exec(host: "prod", command: "systemctl reload app")
```

## Behavior Notes

- `ssh_host` reads your local OpenSSH config; it does not verify network reachability.
- `ssh_host` applies disabled-host filters from `/ssh` in pi or `SSH_EXEC_DISABLED_HOSTS` in MCP/Codex.
- `ssh_exec` returns bounded output and exit metadata.
- `ssh_mount` depends on `sshfs` and your local mount permissions.
- Default SSH keepalive settings are `ServerAliveInterval=300` and `ServerAliveCountMax=3`.
- The pi `/ssh` settings file is pi-only; Codex and general MCP clients use environment variables.
- The tools use your existing SSH config and authentication setup. If regular `ssh <alias>` does not work locally, these tools will not fix that.
