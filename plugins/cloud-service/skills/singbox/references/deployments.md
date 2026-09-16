# Local Deployments

Read only the target section. These are local ownership conventions and policy
intent retained from prior maintenance, not a live inventory. Revalidate paths
and inspect only authorized fields before use. No configuration files were read
to produce this reference. Keep discovered versions, selected profiles, peer IPs,
node lists, and service health in task results rather than this document.

All paths and policies in a section belong to its named host and account.
Resolve `~` on that target account, not on whichever machine received this skill.
The owner's Mac is the owner's laptop, not a synonym for the execution host.

Host names, MagicDNS suffixes, SSH aliases, and KingNAS SMB live in
[Tailnet topology](topology.md). Revalidate addresses at use time.

## Shared subscription source

The owner identifies the `sub-hheei-cc` project on **Judy** as the sing-box node
subscription source used by all their computers. This is shared ownership
knowledge, not a path relative to the computer executing this skill.

For subscription or node changes, resolve the chain from Judy's `sub-hheei-cc`
source through its published subscription to the target client's active profile.
Change the owning source or supported client override, not generated node lists
that a refresh will overwrite. Verify source publication and the affected
client's refresh separately; do not refresh unrelated computers automatically.
Discover the project's path, publication mechanism, subscription URL, credentials,
and service owner when needed. Keep secret subscription URLs out of this skill.
Test service availability over SSH without mounting other hosts.

## Owner's Mac: SFM and profile sources

Applies to the `supercgor` account's deployment, not every SFM host.

| Purpose | Discovery hint |
| --- | --- |
| Capture mode | **TUN mode** (SFM packet tunnel capture) |
| Configuration repository | `~/.config/singbox/`; read its `AGENTS.md` before edits |
| Shared source | `cn-ts.parts/`: base, DNS, inbounds, outbounds, rule-set, route fragments |
| Builder | `build-cn-profiles.py`; `apply_ts_patch(config)` adds Tailscale policy |
| Generated outputs | `cn.json` without embedded Tailscale; `cn-ts.json` with it |
| SFM data | `~/Library/Group Containers/<TEAMID>.io.nekohasekai.sfamt/` |
| SFM profile mapping | App Group `settings.db` and mapped `configs/` paths |
Build shared changes from the fragments, keeping Tailscale-only changes in the
builder patch. Generated files are not the editing source. A subscription may be
active instead of either generated profile: resolve the app's actual selection
and ownership before deployment. A `GUI.for.SingBox` export is not proof of SFM's
packet-tunnel configuration. Discover the engine/CLI availability rather than
assuming a standalone binary exists.

### Local policy to preserve

These are repository-specific intentions. Check the relevant source when access
is authorized; do not impose them on an unrelated subscription or other host.

- The generated Mac Tailscale profile uses one endpoint tagged `ts-ep` with
  `system_interface: false`; its DNS server and traffic rules reference that tag.
- Keep the mixed proxy loopback-only (local convention `127.0.0.1:7890`).
  Campus ranges `111.205.0.0/16` and `162.105.0.0/16` remain physical exclusions.
- Campus DNS has a fallback to the general resolver. Domain-specific IPv4 policy
  (historically Google) must not remove IPv6 from unrelated traffic.
- Preserve policy separation for Ads Block, Academic, Apple, AI, Media, CN,
  Service, and Foreign. Discover current tags, node membership, and selected or
  default candidates from the owning source or runtime rather than a copied inventory.
- Academic matching combines rule-sets with a supplemental manual domain list
  under one logical route action; retain that intent without duplicate actions.
- Remote binary SRS downloads use the intended proxy path. In the maintained
  1.14-style source, this uses `http_clients.rule-set-proxy` and
  `route.default_http_client`; verify engine support before changing download fields.


## Authoritative route order

For profiles that implement the shared policy, `route.rules` is first-match-wins.
Keep the following order and route each matched group to its named selector or
outbound. The final fallback is `🌏 Foreign`.
1. `🛡️ 私有地址 / 本地直连` — private addresses and local traffic (`Direct`), excluding Tailnet destinations owned by a Tailscale endpoint.
2. `🛑 Ads Block` — advertising blocking, including Apple advertising.
3. `📚 Academic` — academic databases and scholarly resources.
4. `🍎 Apple` — the independent Apple group: `apple`, `apple-dev`, `apple-pki`, and `apple-update`.
5. `🤖 AI` — OpenAI, Claude, and Gemini.
6. `📺 Media` — YouTube, Netflix, and ProxyMedia.
7. `🇨🇳 CN` — unified domestic direct services: SteamCN, Bilibili, NetEase Cloud Music, domestic media, `geosite:cn`, `geoip:cn`, and equivalent current CN rule-sets.
8. `🌏 Service` — selected foreign infrastructure services, including Google and GitHub.
9. `🌏 Foreign` — non-CN geographic traffic (`geosite:geolocation-!cn`) and GFWlist rules.
10. `Final → 🌏 Foreign` — remaining unmatched traffic.

Platform transport guards sit outside the numbered policy and must be evaluated
before it: Tailnet domains and CIDRs reach the owning Tailscale endpoint, while
configured campus/LAN exclusions remain physical. They are not user-facing
policy groups. Within the numbered policy, preserve first-match precedence:
Apple advertising remains blocked because Ads Block precedes Apple; Academic
precedes broader CN/Foreign matches; Google and GitHub use Service before
Foreign; and unmatched traffic terminates at `Final → 🌏 Foreign`.

**Core-asset exception:** within the AI stage, place the Google authentication,
static-CDN, and avatar bundle after OpenAI/Claude and before Gemini, Media, and
CN white lists; route that bundle to the existing Service selector. This is an
early Service exception, not a promotion of all Service traffic. Preserve the
earlier transport guards, Ads, Academic, and Apple policy. The domain example,
scope tradeoffs, and verification live in
[SPA asset protection](policy-tuning.md#spa-assets-protect-the-dependency-bundle).
This prevents broad media/direct rules from capturing shared Google assets;
verify actual rule overlaps and selected nodes rather than assuming a common
selector guarantees a fixed public IP.

Check nested logical rules, referenced tags, and the effective final outbound
after every change. The labels above are policy names, not guaranteed runtime
tags. Discover the active profile's actual tags and rule-set format before
editing; if a profile does not contain a group, report it as absent rather than
silently mapping it to another group.

For tunnel activation, resolver cleanup, and service probes, use the platform
procedures in [Networking runbook](networking.md). Obtain current TUN/resolver
addresses from the active configuration and OS state, not the generated source.

## Judy: standalone Linux deployment

Applies to Judy's `chlo` account and system service.

| Purpose | Discovery hint |
| --- | --- |
| Capture mode | **Transparent proxy** (TProxy via `auto_route` + `auto_redirect` / nftables) |
| Service | `/etc/systemd/system/singbox.service` |
| Binary | `/home/chlo/.local/bin/sing-box` |
| Working directory | `/home/chlo/.config/singbox` |
| Deployed profile | `/home/chlo/.config/singbox/cn-ts.json` |
| Capture interface | `singbox0` |
| Mixed listener | `127.0.0.1:7890` |
Confirm the effective unit (including overrides), binary version, and source
ownership before editing. Validate a staged profile with the service's binary
and working directory, then use `singbox.service` for an authorized restart.
Avoid a competing instance on the listener or capture interface.

Keep Judy's Linux capture settings separate from Mac-generated settings. Its
established full-host setup uses `auto_route` with `auto_redirect`; preserve both
unless deliberately redesigning routing. `198.18.0.1/30` was selected to avoid
Docker overlap with `172.18.0.0/30`; recheck subnet conflicts when networks change.
Retain required LAN, container, and campus exclusions.

The endpoint convention is `system_interface: true`. This creates an interface
for sing-box's Tailscale endpoint; an interface named `tailscale0` alone does not
establish ownership by a separate native daemon. Inspect ownership before adding
or changing a Tailscale service. Verify capture TUN and endpoint interface as
distinct components, plus policy rules and actual no-proxy IPv4/IPv6 egress.

## iPhone: legacy jro and node generation

The Mac repository's `jro.json` is an independent legacy iPhone profile, not a
source for SFM or Judy. The existing `gen-walless-subs.py` workflow generates
`walless-nodes.json`; use the generator for node updates, validate its output,
and avoid manually copying subscription credentials. Generating nodes does not
authorize modifying `jro.json`; only update the phone profile when requested.

## Overseas cloud servers: direct connectivity

Applies to overseas cloud servers (`tencent-kr`, `oracle-kr`, `oracle-sg`, `tencent-sh`).

- **Direct egress:** These nodes have native unrestricted international connectivity and operate with **direct connection** (`direct`), without tunneling through local sing-box client proxies.
- Hosted workloads (AxonHub, CPA, Docker stacks) route directly to upstream services or across Tailnet peers.
