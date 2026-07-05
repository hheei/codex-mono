# SSH Exec

`@hheei/ssh-exec` is a single package that supports three usage modes:

- Codex plugin
- pi extension
- general MCP server

It exposes three SSH-oriented tools:

- `host`: search configured SSH aliases from local OpenSSH config
- `mount`: mount a remote host locally through `sshfs`
- `exec`: run non-interactive remote commands over SSH

If you are not sure whether a remote alias exists, use `host` first.

## Install in Codex

This repo already includes a Codex plugin at `plugins/ssh-exec/`.

### Method 1: install through Codex Marketplace

Add this repo as a marketplace source, then install the plugin from that marketplace:

```bash
codex plugin marketplace add hheei/ssh-exec --ref main --sparse .agents/plugins
codex plugin add ssh-exec@ssh-exec
```

Notes:

- marketplace source is defined in `.agents/plugins/marketplace.json`
- plugin metadata lives at `plugins/ssh-exec/.codex-plugin/plugin.json`

### Method 2: install from a local checkout with Codex CLI

If you already cloned this repo locally, add the local marketplace path and install from it:

```bash
codex plugin marketplace add /path/to/ssh-exec/.agents/plugins
codex plugin add ssh-exec@ssh-exec
```

## Install in pi

Recommended:

```bash
pi install npm:@hheei/ssh-exec
```

You can also install it as a normal npm package:

```bash
npm install @hheei/ssh-exec
```

The pi extension entrypoint is `index.ts`.

It registers these tools:

- `host(ssh_host: string)`
- `mount(host: string)`
- `exec(host: string, command: string, timeout?: number)`

Note:

- `pi install` should use the `npm:` prefix for npm packages

## Install in General MCP Clients

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

If you want to run from a local checkout, use the root MCP entrypoint `ssh-exec-mcp.ts`.

Reference config:

- `examples/pi-agent.mcp.json`

## `host` Tool

`host` is the discovery tool to use when you are not sure whether a remote host exists.

Examples:

- `host(ssh_host: "*")`: list all configured hosts
- `host(ssh_host: "ileqm")`: return the exact or matching host if it exists
- `host(ssh_host: "ileqm|sccpu")`: regex search for multiple hosts

Return examples:

- `ileqm (user@hostname)`
- `No \`ileqm\` host.`

## Recommended Workflow

1. Call `host` with `ssh_host: "*"` or a regex such as `ileqm|sccpu`.
2. Pick the alias you want from results like `alias (user@hostname)`.
3. Call `mount` before editing remote files.
4. Call `exec` to inspect state, verify changes, or reload services.

Example flow:

- `host(ssh_host: "prod|staging")`
- `mount(host: "prod")`
- edit files under the returned local path
- `exec(host: "prod", command: "systemctl reload nginx")`

## Behavior Notes

- `host` reads local OpenSSH config; it does not verify reachability
- `mount` mounts the remote root `/`
- `exec` returns bounded output and exit metadata
