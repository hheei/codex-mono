---
name: axonhub
description: >
  Operate and troubleshoot the owner's AxonHub AI gateway, api.lmxu.cc relay,
  PostgreSQL-backed keys, profiles, channels, models, pricing, and the
  CLIProxyAPI (CPA) upstream. Use for AxonHub health, deployment, upgrades,
  routing, billing, or CPA service work.
---

# AxonHub Operations

## Load the current deployment map

Read [Deployment map](references/deployments.md) before touching a host. Treat it
as an ownership map, then verify runtime state before acting. For detailed
AxonHub schema or incident procedures, read the deployed
`/home/ubuntu/axonhub/README.md` on the production host; do not reproduce that
high-churn material here.

When the SSHFS tools are available, use `host_list` to resolve aliases,
`host_mount` before every remote file read or edit, and `host_exec` only for
remote process or service operations. Keep mounted-root searches narrow.

## Safety

- `.env`, AxonHub PostgreSQL, CPA configuration, backups, and logs may contain
  working API keys, OAuth credentials, database passwords, or upstream tokens.
  Inspect the smallest field projection and redact values from output.
- Preserve the production host boundary. Retained New API, AxonHub, or CPA
  directories on another host are rollback artifacts, not alternate owners.
- Take a logical database backup before upgrades or direct data changes. Record
  the current image digest before pulling a mutable tag.
- Prefer the AxonHub UI or GraphQL API for keys, profiles, channels, models, and
  prices because supported mutations refresh caches and enforce invariants.
  Direct SQL is a recovery tool, not the default control plane.
- Keep probes read-only until the failing layer is identified. Do not restart
  AxonHub, PostgreSQL, the relay, CPA, or embedded Tailscale to test a guess.

## Workflow

1. **Identify the layer.** Classify the request as public ingress, relay,
   Tailnet transport, AxonHub application, PostgreSQL state, an upstream
   channel, pricing/accounting, or CPA. Verify the current container/unit owner.
2. **Capture a bounded baseline.** Check the narrow health endpoint, relevant
   Compose or systemd state, and recent logs. Preserve request IDs, timestamps,
   protocol (`openai/chat`, `openai/responses`, or Anthropic), stream mode, model,
   channel, and HTTP status without copying payloads or credentials.
3. **Edit the owner.** Change AxonHub Compose/config on its production host,
   relay configuration on the relay host, and CPA configuration only on the CPA
   host. Use the UI/GraphQL path for application data when possible.
4. **Validate before activation.** Render Compose configuration without printing
   resolved secrets, validate proxy configuration inside its container, and use
   a transaction or dry run for database work. Confirm that a backup is readable.
5. **Activate narrowly.** Recreate or restart only the changed service. A disk or
   database edit alone may not refresh AxonHub's in-memory caches.
6. **Verify end to end.** Exercise the changed internal layer first, then its
   next consumer, then the public API if affected. Verify both health and one
   authenticated behavior when credentials can be handled without disclosure.

## AxonHub operations

Run production Compose commands from `/home/ubuntu/axonhub` with the existing
`.env` file:

```bash
docker compose --env-file .env ps
docker compose --env-file .env logs --since 15m axonhub
docker compose --env-file .env restart axonhub
curl -fsS http://127.0.0.1:8090/health
```

For an upgrade:

1. Record the deployed image digest and Compose/config versions.
2. Create a timestamped PostgreSQL logical backup under the protected backup
   directory and verify that it is non-empty.
3. Pull and recreate with the existing `.env`; never invent replacement secrets.
4. Wait for both PostgreSQL and AxonHub health checks.
5. Check the Tailnet endpoint, relay, public health endpoint, then an
   authenticated model request. Keep the previous digest and backup as rollback.

AxonHub stores durable application state in PostgreSQL, not a New API SQLite
file. Effective rows commonly use `deleted_at = 0`; preserve project ownership,
non-null fields, and uniqueness constraints. Direct SQL changes can remain hidden
behind live caches, so use supported mutations or deliberately restart only the
AxonHub container after committing and verifying the data change.

For keys, display only stable IDs, names, status, and a short prefix/suffix.
For model associations and prices, discover current channel/model IDs and schema
at runtime. Back up the exact affected rows, dry-run the selection, mutate in one
transaction, then verify the externally visible model list and a billed request.
Do not cache today's channel IDs, model names, price rows, or incident IDs in
this skill.

## Public ingress and relay

The currently observed production path for `api.lmxu.cc` remains:

```text
Cloudflare → cloudflared @ tencent-sh → OpenResty relay :8080
           → AxonHub :8090 → PostgreSQL / selected upstream
```

The public hostname now reaches the `tencent-sh` relay. The obsolete
`tencent-kr` (formerly `lmxu-cloud`) relay container and deployment directory have been removed;
its Cloudflare connector is retained for other services.

The `tencent-sh` relay uses the Japan-aligned **header-only** policy in the
[deployment map](references/deployments.md#request-paths). Preserve the request
body byte-for-byte, including locale fields in metadata. The obsolete Lua body
rewriter is removed. This ingress policy changes neither egress IP nor TLS
fingerprint and does not establish what headers AxonHub sends to providers.

Response buffering stays off for SSE. Validate the pinned container,
`openresty -t`, relay-directory `python3 test_relay.py`, and health after changes.
Then verify an authenticated model list and streamed request when credentials
are available; synthetic proxy regression is not provider-call proof.

Test the active public ingress in this order:

1. Active AxonHub loopback health on the serving host.
2. Active relay loopback health on the serving host.
3. Cloudflare public health at `https://api.lmxu.cc/health`.
4. An authenticated streamed request through `https://api.lmxu.cc`.

Before a future route switch, test the target relay separately, then correlate
a unique public request marker with the target relay log. A failure at a later step does not justify
changing an earlier healthy layer. For long requests, distinguish SSE
streaming from non-streaming Cloudflare origin timeouts. Preserve
`server.public_url` and SSE keep-alive behavior when editing relay or Tunnel
settings.

## CPA operations

CPA means CLIProxyAPI. Operate the production systemd units on `oracle-kr`:

```bash
systemctl status cliproxyapi.service
systemctl status cliproxyapi-update.timer
journalctl -u cliproxyapi.service --since '15 min ago' --no-pager
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8317/v1/models
```

The service owns its Docker Compose lifecycle; use that systemd unit rather than
starting a competing container manually. The update timer pulls and recreates
the stack, probes `/v1/models`, and prunes old images. Before changing CPA,
confirm whether the symptom is in AxonHub channel selection or in CPA itself.
An unauthenticated `401` proves that CPA accepted the HTTP request and enforced
authentication; an authenticated `200` model-list response proves CPA
availability, not that AxonHub selected that channel or charged the request.

## Proof table

| Observation | What it proves |
| --- | --- |
| Containers or unit are active | Lifecycle state only |
| `/health` succeeds on production loopback | AxonHub app and local database path |
| Production MagicDNS health succeeds | Tailnet path to AxonHub |
| Relay loopback health succeeds | Relay-to-production path |
| Public health succeeds | Cloudflare, relay, Tailnet, and AxonHub health path |
| CPA `/v1/models` returns `401` | CPA listener and authentication boundary |
| Authenticated CPA `/v1/models` returns `200` | CPA model-list path, not AxonHub routing |
| Authenticated model request succeeds | Key, profile, model visibility, and selected request path |
| Matching usage row has cost/reference | Accounting for that completed request |
