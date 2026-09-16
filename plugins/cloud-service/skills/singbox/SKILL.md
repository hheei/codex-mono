---
name: singbox
description: >
  Use for any tailscale, singbox (sing-box), VPN, or proxy request. Operate and
  troubleshoot SFM profiles, TUN routing, native or embedded Tailscale,
  MagicDNS, Tailnet topology, NAS SMB, DNS policy, proxy selectors, rule-sets,
  subscriptions, and network-environment changes.
---

# sing-box Operations

## Scope and references

Keep this entry portable. Read only the reference relevant to the target:

This skill is portable operating guidance, not a service installer. Establish
the execution host, target host, account, OS, shell, and available tools before
following a platform procedure. When already on the target, run checks locally;
SSH is only for a different host. Loopback and `~` always refer to the execution
host/account, never implicitly to the owner's Mac. Resolve bundled references
and scripts relative to this skill's directory, not a monorepo checkout path.
Deployment records apply only after matching the named host/account. Missing
Python, curl, a compatible engine, controller API, or required permissions means
the corresponding helper is unavailable, not permission to install software or
change networking. Use available native diagnostics and report the limitation.

- **SFM, Linux TUN, Tailscale, DNS, or routing work:** read
  [Networking runbook](references/networking.md) for platform procedures,
  diagnostic boundaries, and the offline official-documentation index. Read local
  snapshots first; check their provenance and version scope before applying fields.
- **The owner's Mac, Judy, or iPhone profile work:** also read the matching section
  of [Local deployments](references/deployments.md) before inspecting or editing
  that deployment. Its paths are discovery hints, not proof of current state.
- **Shared route order or policy groups:** also read the authoritative route
  order in [Local deployments](references/deployments.md#authoritative-route-order).
- **Partial SPA loads, YAML template builds, WebRTC/NAT, MPTCP, DNS failover/cache,
  selector stability, QUIC, or portable network selection:** read
  [Policy and tuning](references/policy-tuning.md) for examples, version/platform
  gates, tradeoffs, and behavioral verification criteria.
- **Native versus embedded Tailscale ownership, Tailnet host mapping, SSH aliases,
  KingNAS SMB, or DERP vs userspace-TUN blackholes:** also read
  [Tailnet topology](references/topology.md) and follow the linked ownership
  discovery before changing clients or routes. Revalidate addresses and health.
- **Node subscriptions on any computer:** read the shared subscription source
  section in [Local deployments](references/deployments.md#shared-subscription-source)
  before changing generated nodes or a client's subscription ownership.

## Safety

- Profiles, subscriptions, endpoint state, and logs can contain credentials,
  UUIDs, keys, or login URLs. Inspect the smallest necessary field projection;
  keep secrets out of output, documentation, uploads, and commits.
- Preserve login state, endpoint identity, system proxy/DNS settings, and the
  running profile unless the requested operation authorizes changing them.
  Keep diagnostic probes read-only. Respect explicit file-access restrictions.
- Retain the existing endpoint topology. In SFM, do not add a second Tailscale
  endpoint or a `state_directory` override to the app-managed endpoint.
- Keep a private rollback copy before deployment. Use the existing service/app
  lifecycle rather than starting a competing process on the same ports/TUNs.

## Local network conventions

- **Proxy and capture modes across hosts:**
  - **Owner's Mac**: Runs **TUN** mode (SFM packet tunnel capture) to route full-host traffic.
  - **Judy**: Uses **transparent proxy** (Linux TProxy / `auto_route` + `auto_redirect` via nftables) to capture campus/host traffic.
  - **Overseas cloud servers** (`tencent-kr`, `oracle-kr`, `oracle-sg`, `tencent-sh`): Use **direct connection** (`direct`), with native international egress directly reaching external services without passing through local proxies.
- **Embedded Tailscale has NO CLI:**
  - Tailscale endpoints embedded inside sing-box do **not** provide or interact with the `tailscale` CLI tool. Do not attempt `tailscale status`, `tailscale up`, `tailscale ping`, or `tailscale netcheck` on sing-box embedded endpoints; their lifecycle, authentication, and routing are managed entirely within sing-box.
- Servers generally use the local sing-box mixed proxy on `127.0.0.1:7890` for outbound proxy access when needed. Treat this as the default convention to verify, not proof of a live listener or a reason to replace a host-specific setting.
- Network adjustments begin with the current-host preflight below, before any change that could interrupt the session's SSH, Tailnet, or proxy path.

## Change workflow

1. **Preflight the current host.** Identify where commands are executing, then
   verify Tailscale ownership/health, sing-box lifecycle, and the local
   `127.0.0.1:7890` listener where applicable. For another host, resolve its
   configured SSH alias and run these checks over SSH without filesystem mounts.
   Complete this gate before editing DNS,
   routes, TUNs, endpoints, selectors, system proxy settings, or services.
   Require a bounded application reply through the intended Tailnet path and
   through the sing-box proxy, not process or TCP-connect success alone. If a
   component is unavailable, identify that failure and the surviving management
   path first; preserve that path while making only the authorized repair.
   Distinguish absent/not-applicable from installed-but-failing components; a
   native-only host need not run sing-box, and a proxy-only host need not join
   a Tailnet. Do not require adding either client to complete this preflight.
2. **Identify the target.** Establish platform, engine version, running
   service/profile, and configuration owner (source builder, subscription, or
   manually maintained file). Read that source repository's instructions.
   Finish with an explicit source → generated output → deployment mapping;
   do not infer it from a familiar profile name or cached file path. For
   Tailscale work, identify native, embedded, both, or unknown ownership;
   distinguish the node owner from system-interface/userspace networking mode.
3. **Define success.** Select the affected observable behavior: DNS response,
   route/selector choice, service reachability, or full-host egress. Record a
   bounded baseline without changing unrelated network policy.
4. **Edit the owner.** Change builder inputs when output is generated; use the
   subscription's supported update/override mechanism when provider-managed.
   Share routing policy where already shared, but keep platform capture settings
   and device-specific profiles separate. Check rule order and referenced tags.
5. **Validate before activation.** Parse JSON without dumping it. Use the target
   engine's `check -c` with its working directory and compatible version when
   available; JSON validity alone does not establish schema compatibility.
   If no compatible CLI exists, state that limitation and require app-load and
   behavioral verification. Consult version-matched official docs for changed fields.
6. **Deploy only to the identified target.** Compare source/output with the
   intended installed copy where direct file deployment applies. Never overwrite
   an unrelated active subscription with a locally generated profile. Activate
   through the owning app/service; a disk edit alone does not reload the runtime.
7. **Verify and report.** Exercise the affected path and any preserved exceptions
   it could disrupt. Report target, changes, observed results, and rollback path.
   If activation fails, restore through the same owner; if runtime testing is
   unavailable, explicitly report the change as unverified, not deployed success.

## Diagnostic order and proof

Resolve the active configuration first, then separate local listener/TUN capture,
DNS, IPv4 versus IPv6, route order/current selector, and upstream peer transport.
Use scoped runtime logs to distinguish remaining hypotheses.

| Observation | What it proves |
| --- | --- |
| Service active, Connected UI, or TUN present | Lifecycle state, not working traffic |
| Bare TCP connect (`nc -z`) | Connection acceptance; userspace TUN may accept locally |
| MagicDNS response | Name resolution, not peer/service reachability |
| HTTP/protocol reply from the intended service | That service path; `401` does not prove authentication |
| Request through a mixed proxy | Proxy inbound, not full-host TUN capture |
| No-proxy request with expected route/egress evidence | The exercised full-host traffic path |

Use bounded application-layer probes. Compare internal and system DNS when DNS
changes; verify both IP families where intended. Preserve required LAN, campus,
and Tailnet access. Do not infer a DERP failure from a TCP timeout alone or disable
IPv6 globally to fix one destination.

## Optional scripts

Clash API helpers live in `scripts/` and require Python 3; route testing also
requires `curl`. Use them only when a compatible controller is listening on the
same host. Discover the API bind and selector names first; defaults are loopback
`9090` / mixed proxy `7890`. Set `CLASH_API_SECRET` when the controller requires
authentication and `CLASH_SELECTOR` for route tests. `list_sfm_routes.py` reads
groups; `set_sfm_route.py` leaves the requested selection in place.
`test_sfm_routes.py` attempts restoration in `finally`, but both switching
helpers close **all** controller connections. Treat them as disruptive operations
requiring explicit authorization, not read-only probes.

`validate_config.py` requires an explicit config, compatible sing-box binary,
and target working directory. It reports the engine check result without printing
engine diagnostics, which may contain secrets. Schema validity is not runtime health.

## Keeping this skill useful

Store durable procedures, decision rules, and documentation links here. Keep
local paths and policy intent in the deployment reference. Keep host names and
Tailnet membership in the topology reference. Discover active profile IDs,
addresses, versions, node lists, and selector values at use time. Leave incident
timelines, temporary commands, and one-off success logs out of the skill.
