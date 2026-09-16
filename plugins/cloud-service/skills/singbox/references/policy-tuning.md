# Service Routing, Template Builds, and Transport Tuning

Read this reference for partial SPA loads, YAML template design, WebRTC/NAT,
MPTCP, DNS failover/cache, selector stability, QUIC, or portable network policy.
Examples are source fragments, not complete deployable profiles. YAML requires
the owning project's build step; sing-box consumes the generated JSON. Resolve
all outbound, DNS-server, and rule-set tags from that source before using them.

## SPA assets: protect the dependency bundle

**Symptom:** the page shell loads but avatars, cards, illustrations, SVG/WebP,
or scripts time out. Diagnose the failing request, not just the main page.
Google, Microsoft, and Apple applications can use separate authentication, API,
static-CDN, and avatar domains; a working main domain proves none of those paths.

The reported Google incident exposed two ordering hazards: a domestic-direct
white list such as `acl:UnBan` captured static CDN traffic, and earlier
`geosite:youtube` / `acl:ProxyMedia` rules captured avatar traffic. Treat those
as known failure patterns, not a claim about every current upstream rule-set.
A `dial tcp ... i/o timeout` alone does not establish which rule matched or why.

1. Collect a failing asset hostname from browser Network tools; keep tokens and
   account data out of logs. Compare its DNS answers, IP family, matched rule,
   selector, and actual outbound with authentication/API requests.
2. Inspect the effective rule-set contents and earlier terminal rules. Confirm
   whether the asset is going direct or through a different egress. Also separate
   DNS, upstream reachability, HTTP errors, and browser-side blocking.
3. Put the required dependency bundle before conflicting media and domestic
   white-list rules, without bypassing Tailnet/campus guards or intentional ad
   blocking. Keep the shared ordering authority in
   [Local deployments](deployments.md#authoritative-route-order).

Example Google protection rule, targeting the existing Service selector:

```yaml
domain_suffix:
  - gstatic.com
  - googleusercontent.com
  - ggpht.com
domain:
  - accounts.google.com
  - myaccount.google.com
  - apis.google.com
  - oauth2.googleapis.com
outbound: Service
action: route
```

`Service` is a tag to replace with the actual configured selector. These suffixes
are broad: `ggpht.com` includes YouTube avatars, and shared CDNs serve multiple
products. Review that deliberate override; use observed exact hosts when a
narrower exception suffices. Derive Microsoft/Apple bundles from their actual
requests rather than copying Google domains or capturing their entire ecosystem.

A common selector reduces accidental egress splits; it does not ensure a fixed
public IP if it contains an automatic group or changes nodes. Verify both
previously failing assets and login/API behavior, plus preserved media/CN routes.
Do not promise that unified routing prevents account sanctions.

## Compile-on-build: commented sources, static runtime artifacts

For a large generated profile, keep editable `template/**/*.yaml` as the source
of truth and build `template/*.json` before packaging. Strict JSON cannot carry
`#` comments; commented business fragments make rule intent and review clearer.
This is an architecture pattern, not a claim that every local deployment has
already migrated. Preserve an existing builder unless its migration is requested.

- **Authoring:** group rules by business function; explain precedence at the
  relevant fragment. Keep platform TUN settings separate from shared policy.
- **Build:** an owning script such as `scripts/build-templates.mjs` parses YAML,
  explicitly sorts numbered fragments, concatenates rule arrays in order, and
  emits deterministic JSON. Fail on malformed fragments, duplicate mapping keys,
  ambiguous ordering, or missing referenced tags rather than publishing a partial
  configuration. Do not rely on filesystem enumeration or generic array merging.
- **Lifecycle:** wire the build into the project's actual test and deployment
  entry points (for example `pretest` / `predeploy` where supported). CI or direct
  deploy commands that bypass package hooks must invoke it explicitly. Verify
  that a clean checkout cannot package stale generated JSON.
- **Runtime:** import the built JSON through the existing bundler/runtime; keep
  YAML parsing and its dependency out of request handling. This removes runtime
  YAML work, not all loading/allocation cost. Measure bundle size, startup, and
  request CPU before claiming a performance gain.

Example fragment layout (names and numbers are an explicit build contract):

```text
00-sniff.yaml              # nonterminal protocol inspection
01-private-direct.yaml     # private/LAN; preserve Tailnet exceptions
02-custom-direct.yaml      # scoped internal domains
03-campus-pku.yaml         # campus policy
04-ads-block.yaml           # intentional blocking
05-academic.yaml            # scholarly resources
06-apple.yaml               # Apple services
07-openai.yaml              # OpenAI
08-claude.yaml              # Claude
09-google-auth.yaml         # auth/CDN/avatar protection
10-gemini.yaml              # Gemini-specific traffic
11-media.yaml               # media
12-china-rules.yaml         # domestic domains/apps
13-china-geoip.yaml         # domestic IPs
14-service.yaml             # other foreign infrastructure
15-foreign.yaml             # foreign matches; retain route.final
```

This layout does not replace physical capture exclusions or Tailnet guards.
Earlier broad terminal rules can still shadow later fragments despite numbering.
Check observable precedence: Google assets before Media/CN, Ads before Apple,
Academic before broad domestic/foreign matches, and the intended final outbound.

Cloudflare CPU limits depend on plan and configuration, not a universal 10–50 ms
window. The [official limits](https://developers.cloudflare.com/workers/platform/limits/)
distinguish CPU time from network waiting and startup time. Avoid fixed claims
such as “5 ms cold start” or “zero-cost JSON loading” without a measured workload.

## TUN UDP and WebRTC

For engines supporting the 1.14 UDP NAT fields, this explicitly records the
currently documented defaults rather than enabling a previously absent feature:

```yaml
udp_mapping: endpoint_independent
udp_filtering: endpoint_independent
udp_timeout: 5m
```

Mapping reuses a source address/port mapping across destinations; filtering
controls which remote endpoints may send packets back. Full-cone-style behavior
requires considering both, not `udp_mapping` alone. More permissive filtering is
also an exposure tradeoff. Consult the target version's
[UDP NAT fields](https://sing-box.sagernet.org/configuration/shared/udp-nat/)
and [TUN documentation](upstream/configuration/inbound/tun.md); older engines
have different fields and stack constraints.

Endpoint-independent behavior can help ICE connectivity, but the proxy server,
router/CGNAT, firewall, and peer also determine traversal. STUN discovery is not
itself a guarantee of a usable candidate pair; symmetric mappings do not imply
“100% STUN failure.” TURN can remain necessary and is not inherently a fault.
`udp_timeout` controls sing-box NAT expiry, not NIC or upstream NAT lifetimes;
5 minutes is the documented default, not a keepalive. Longer retention also costs
session memory and cannot prevent eviction at a session limit.

Verify a real call's selected ICE candidate pair (direct/server-reflexive/relay),
packet loss, and audio resumption after silence. Include network switching when
that is the reported fault; a successful STUN request alone is insufficient.

### Deferred: evaluate the Go stack after 1.15 releases

**Status (2026-09-15): 1.15 is not yet released.** This is a post-release
optimization candidate, not an instruction to upgrade to a prerelease or change
active profiles. Revisit only after a stable 1.15-or-later engine is available
in the target client and its release documentation confirms these fields.

The bundled upstream `testing` snapshot describes `stack: "go"` as added in
1.15 and made the default. It is a purpose-built userspace stack without a
gVisor dependency, documented as using significantly less memory than `gvisor`
or `mixed`. Historically, `mixed` uses system TCP and gVisor UDP. The snapshot
does not establish a universal “over 60%” memory reduction or a guaranteed
throughput gain; measure against the target's existing stack and workload.

Candidate TUN fragment for a supported Linux deployment after release:

```yaml
stack: "go"
multi_queue: true
```

`multi_queue` requires Linux and the Go stack. It uses `IFF_MULTI_QUEUE` to
allow throughput to scale across CPU cores, rather than guaranteeing CPU
affinity or removal of every single-core bottleneck. Keep it out of Apple
profiles. If the released engine already defaults to Go, an explicit `stack`
override may be unnecessary; check the final schema and migration guidance.

Before adoption, compare memory, CPU/core utilization, and TCP/UDP throughput
under the same workload; verify DNS, WebRTC, and required LAN/Tailnet paths.
Check kernel support and preserve a rollback profile. Record measured gains,
not predicted gigabit/10-gigabit line-rate performance. Source:
[TUN stack and multi-queue](upstream/configuration/inbound/tun.md#stack), from
the version-scoped [testing snapshot](upstream/INDEX.md).

## MPTCP: Linux bypass for Apple-originated traffic

`exclude_mptcp: true` is available since 1.13 **only on Linux with nftables,
`auto_route`, and `auto_redirect` enabled**. It is not an SFM/macOS/iOS TUN tuning
flag. The traffic may originate from Apple devices behind that Linux gateway.

The [official TUN field](upstream/configuration/inbound/tun.md#exclude_mptcp)
bypasses sing-box and connects MPTCP traffic directly; otherwise such traffic is
rejected by default because it cannot be transparently proxied. Enable bypass
only when direct egress is allowed and works for the destination. It trades
capture policy for compatibility, rather than adding MPTCP proxy support.
Verify the affected service and the intended direct path after an authorized change.

## DNS: evaluate, match a response, then return or fall back

`evaluate`, `respond`, and `match_response` require 1.14 support. They replace
legacy response/address-filtering patterns where needed; ordinary `route` remains
valid. This is ordered primary/fallback resolution, not automatic fastest-server
selection or a parallel race:

```yaml
- rule_set: ["geosite:google"]
  action: evaluate
  server: google
  timeout: 500ms
- rule_set: ["geosite:google"]
  match_response: true
  ip_accept_any: true
  action: respond
- rule_set: ["geosite:google"]
  action: route
  server: cloudflare
```

These are existing rule-set/server tags, not built-in names. `evaluate` stores a
response without terminating evaluation. `match_response: true` refers to the
latest untagged evaluation; an explicit evaluation tag is safer for interleaved
pipelines. `respond` returns that response without issuing a query and must be
guarded so it cannot run without an evaluated response.

`ip_accept_any` means “contains at least one address,” not “any successful DNS
response”: NODATA, NXDOMAIN, TXT, and other address-free replies need deliberate
policy. This example falls through when no acceptable address response is
available, including primary timeout. It does not verify address reachability or
filter poisoned public IPs. The fallback's query time is additional to the primary
wait; choose its timeout deliberately rather than promising millisecond recovery.

Verify A/AAAA and required non-address queries, valid negative answers, primary
success, primary timeout/error, and fallback failure in an isolated environment.
Sources: [DNS rules](upstream/configuration/dns/rule.md#match_response) and
[DNS actions](https://sing-box.sagernet.org/configuration/dns/rule_action/).

### Persistent cache

```yaml
experimental:
  cache_file:
    enabled: true
    store_dns: true
```

`store_dns` requires 1.14; it persists DNS cache through the enabled cache file.
Use a writable persistent path in the owning service/app context. TTL, cache
policy, and upstream/network changes still matter; persistence cannot guarantee
an immediate or correct answer for every query after reconnect.

Distinguish cached remote rule-set data from DNS records. Reading compiled `.srs`
files is not recompiling their source on every restart; `store_dns` does not cache
rule-set compilation or eliminate parsing/loading work. No fixed rule-set count
belongs in portable guidance. Verify restart reuse with controlled queries and
upstream-query evidence, not latency alone. See
[cache-file fields](https://sing-box.sagernet.org/configuration/experimental/cache-file/).

## Selector stability: choose disruption deliberately

| Group | Candidate setting | Tradeoff |
| --- | --- | --- |
| Manual selector | `interrupt_exist_connections: true` when immediate cutover is intended | Existing inbound sessions are interrupted; apps must reconnect. Downloads, SSH, and calls can break. |
| Automatic `urltest` | `interrupt_exist_connections: false` | Preserve existing inbound sessions during reselection; new and old flows may temporarily use different nodes. |
| Automatic `urltest` | `tolerance: 100` | A 100 ms tolerance can reduce latency-driven churn; it is a tuning starting point, not a universal optimum or a health guarantee. |

The documented urltest tolerance default is 50 ms. In both group types the
interruption flag affects inbound connections; internal connections are always
interrupted on selection change. Nested selectors require checking the actual
selected path. Compare cutover behavior and long-lived sessions, not just probe
latency. For strict egress consistency prefer a stable selected node and an
explicit reconnection policy rather than automatic speed chasing.
Sources: [Selector](https://sing-box.sagernet.org/configuration/outbound/selector/),
[URLTest](https://sing-box.sagernet.org/configuration/outbound/urltest/).

## QUIC: distinguish application traffic from proxy transport

Decide from the failing path and measurements, not the node protocol name alone.
Application HTTP/3 over UDP:443 and an outer Hysteria2/TUIC connection are different
layers. Blocking captured application UDP:443 does not inherently disable the
outer transport: HTTP/2 application traffic can still travel through Hysteria2.
A firewall rule that blocks the proxy server's own UDP port can instead break the
whole tunnel. VLESS and Shadowsocks are not simply “TCP-only” labels; inspect the
configured transport and UDP relay support.

- **Consider a scoped reject** when application QUIC repeatedly stalls while the
  same destination works over TCP, or the selected path cannot relay UDP. A reject
  may accelerate browser fallback; silently dropping packets can retain timeout
  stalls. Neither guarantees an immediate HTTP/2 retry.
- **Preserve application QUIC** when it works, or the application benefits from
  HTTP/3/connection migration. Measure both playback/call continuity and latency
  before sacrificing it. Hysteria2/TUIC alone is not an absolute exemption from
  application-layer troubleshooting.
- **Scope the change:** identify traffic direction, inbound, destination and
  actual proxy endpoint; avoid broad rules affecting DNS, STUN/RTP, or tunnel
  transport. Verify rule order and both UDP and TCP application paths.

QUIC connection migration is a capability, not a guarantee that a particular
YouTube app, proxy relay, and mobile OS preserve every session. Compare the real
application with QUIC allowed/rejected only when that experiment is authorized.

## Portable network selection: fallback dialing, not session migration

For supported Android/Apple graphical clients with `auto_detect_interface`
enabled (network-strategy fields since 1.11), a portable policy can be:

```json
{
  "route": {
    "auto_detect_interface": true,
    "default_network_strategy": "fallback",
    "default_network_type": ["wifi", "ethernet"],
    "default_fallback_network_type": ["cellular"],
    "default_fallback_delay": "300ms"
  }
}
```

This prefers Wi-Fi/Ethernet dialing and starts fallback attempts on unavailability
or timeout. The 300 ms value is the delay before a fallback attempt, not a bound
on connection completion, outage detection, or migration of existing sessions.
The documented strategy enters a temporary fast-fallback state after preferred
network failure. It does not manufacture a cellular interface: a laptop attached
to a phone's Wi-Fi hotspot may see that path as Wi-Fi instead.

Check conflicts with `default_interface`, per-outbound interface/address binding,
and outbound strategy overrides; do not deploy these GUI-only semantics as Linux
server roaming policy. Consider cellular availability, OS permissions, and data
costs. Endpoint-independent NAT and QUIC may help parts of a path, but combining
three settings cannot promise uninterrupted audio/video or unchanged public IPs.

After an authorized switch, test new connections and existing calls/downloads
separately, then recovery to the preferred network. Preserve the management path.
Sources: [Route defaults](https://sing-box.sagernet.org/configuration/route/),
[Dial fields](https://sing-box.sagernet.org/configuration/shared/dial/#network_strategy).
