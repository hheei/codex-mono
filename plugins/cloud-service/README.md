# Cloud Service

Operational skills for this private cloud stack: AxonHub/CLIProxyAPI,
sing-box/SFM, native and embedded Tailscale, and related host maintenance.

## Skills

| Skill | Use it for |
| --- | --- |
| `axonhub` | AxonHub health, deployment, PostgreSQL-backed gateway data, `api.lmxu.cc` relay, and CLIProxyAPI operations |
| `singbox` | Profile changes, TUN/DNS/routing diagnostics, Tailnet topology, KingNAS SMB over Tailscale, subscription updates |

Each skill keeps portable workflow in `SKILL.md` and host-specific ownership in
its deployment reference. The sing-box skill additionally carries networking,
topology, and selected upstream documentation snapshots.

- `skills/axonhub/references/deployments.md` — AxonHub, public relay, and CPA ownership map
- `skills/singbox/references/networking.md` — platform procedures and the offline official-docs index
- `skills/singbox/references/policy-tuning.md` — SPA asset protection, build-time YAML aggregation, version-scoped NAT/DNS tuning, QUIC and portable-network tradeoffs
- `skills/singbox/references/deployments.md` — Judy's shared `sub-hheei-cc` subscription source and Mac / Judy / iPhone ownership hints
- `skills/singbox/references/topology.md` — native/embedded client ownership, Tailnet names, SSH aliases, and SMB automount policy
- `skills/singbox/references/upstream/` — selected sing-box documentation snapshot

Clash API helpers live in `skills/singbox/scripts/`. Discover the actual
controller bind and selector names first. Switching helpers close all controller
connections; use them only when disruption is authorized, not for read-only probes.

Helpers require Python 3; route testing also requires curl. Configure `CLASH_API`
and `LOCAL_PROXY` on the machine running the helper; loopback defaults are
`127.0.0.1:9090` and `127.0.0.1:7890`. Supply controller authentication through
`CLASH_API_SECRET`, not command-line arguments, and select the discovered test
group with `CLASH_SELECTOR`. The controller connection ignores ambient proxy
variables; route probes explicitly use the configured proxy even with `NO_PROXY`.

Run `validate_config.py CONFIG --working-directory SERVICE_DIRECTORY`
with a compatible `sing-box` in PATH, or provide `--binary EXECUTABLE`.
It checks with the real engine and exits 0 for accepted config, 1 for engine
rejection, or 2 when validation cannot run. It neither applies configuration nor
tests runtime health. Engine diagnostics are withheld from output because they
may contain secrets; inspect them privately when the engine rejects a config.

Copy the whole skill directory, including references and scripts. Host/account
records are scoped hints, not settings for the receiving machine. Discover the
local OS, tools, client ownership, and permissions before running any procedure.
Run isolated helper tests with `python3 -m unittest discover -s tests` from this
plugin directory; these do not connect to production controllers or Tailnet peers.

## Safety

Profiles, subscriptions, gateway state, databases, and service configuration can
contain credentials. Do not print, upload, or commit their values. Keep
host-specific paths in deployment references; revalidate addresses at use time.

## Install

```bash
codex plugin marketplace add hheei/codex-mono --ref main
codex plugin add cloud-service@codex-mono
```

This plugin replaces the former `singbox` marketplace entry.
