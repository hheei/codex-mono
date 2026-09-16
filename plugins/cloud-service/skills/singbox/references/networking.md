# Networking Runbook

Read the section matching the deployment or fault. Examples use variables resolved
from the actual target, not historical host values. Commands are templates, not
an instruction to activate or reconfigure a host without authorization.

Choose tools by platform: POSIX shell blocks below are for Linux/macOS with the
named utilities installed. On Windows, use PowerShell, `Resolve-DnsName`, and
`curl.exe` (not PowerShell's `curl` alias); `/dev/null` becomes `NUL` for curl.exe.
On Synology or minimal Linux, discover the service manager rather than assuming
systemd. Missing utilities are diagnostic limitations, not installation requests.
An SSH alias is local to the initiating account; rediscover it on each machine.
Run local checks directly when the target is the current host.

## SFM profile ownership and activation

The GUI and packet-tunnel runtime have different lifecycles. An absent SFM GUI
process does not mean the extension is stopped. `systemextensionsctl list` helps
identify a standalone SFM extension, but registration/enabled state alone does
not prove a connected tunnel. Correlate app status, interfaces, and real traffic.

Discover the app's actual Group Container and `settings.db`. Inspect its schema
read-only before relying on a query. In versions with the known `profiles` table:

```sh
sqlite3 -readonly "$SETTINGS_DB" \
  'SELECT id,name,type,path FROM profiles ORDER BY "order";'
```

This lists candidates; it does not identify the selected/running profile by
itself. Resolve selection through app settings/UI and runtime evidence, then
resolve its mapped path. Other GUI exports and old `configs/config_N.json` files
are not authoritative. Preserve subscription ownership and refresh behavior.

For a requested update, validate the intended source, use the app's supported
import/update mechanism, and restart only the intended profile. Where direct
file synchronization is supported, check the intended pair for equality without
printing either file. Verify the changed behavior after activation; neither
copy equality nor Connected status proves the new configuration is running.

## Linux TUN

- `auto_route` installs routes toward the capture TUN. Avoid outbound loops with
  `route.auto_detect_interface`, `route.default_interface`, or appropriate
  outbound interface binding.
- `auto_redirect` requires Linux and `auto_route`; it uses nftables to improve
  routing/performance and avoid Docker bridge conflicts. Upstream recommends it
  on Linux. It is not a universal requirement for every working TUN deployment.
  Check kernel support and conflicts with `route.default_mark`/dial `routing_mark`.
- Select TUN subnets that do not overlap existing LAN, VPN, or container networks.
  Preserve intended physical-route exclusions. Review `strict_route` in the
  context of multiple interfaces and local-network requirements.
- Keep Linux capture options in Linux-specific inputs; do not copy them into
  shared Apple-platform profiles.

Validate using the installed binary with the service's working directory and
permissions. After an authorized restart, inspect the configured interface,
IPv4/IPv6 policy rules, relevant route tables, and nftables rules as applicable.
Table `2022` is a default, not a guaranteed deployment value.

```sh
"$SING_BOX_BIN" check -c "$STAGED_CONFIG"
ip -brief address show "$TUN_IF"
ip -4 rule show
ip -6 rule show
ip route show table "$TUN_TABLE"
curl --noproxy '*' --connect-timeout 4 --max-time 12 -4 \
  "$TEST_URL" -o /dev/null -w '%{http_code}\n'
curl --noproxy '*' --connect-timeout 4 --max-time 12 -6 \
  "$TEST_URL" -o /dev/null -w '%{http_code}\n'
```

Choose a test destination that policy sends through the intended outbound.
Correlate successful no-proxy requests with route/connection or expected egress
address evidence; a public HTTP success alone may also be direct access.

## Tailscale: identity, DNS, and routing

Treat these as separate layers:

1. The `tailscale` endpoint owns a Tailscale node and its peer transport.
   `system_interface: false` keeps networking in the endpoint's userspace path;
   `true` creates a system TUN for that endpoint. It does not attach to an
   independently running `tailscaled` or prove that the native app owns it.
   **Embedded Tailscale has NO CLI:** sing-box's built-in Tailscale endpoint
   does not provide or attach to the system `tailscale` CLI command. Do not use
   `tailscale status`, `tailscale up`, `tailscale ping`, or `tailscale netcheck`
   to probe an embedded endpoint; observe its state via sing-box logs and network
   reachability probes instead.
2. A DNS server of type `tailscale` references the endpoint tag and provides
   MagicDNS. DNS rules determine which queries use it. In supported versions,
   `preferred_by` can select its domains; explicit suffix routing is another
   deployment policy. Check version and custom tailnet naming before changing it.
3. Traffic rules send intended Tailnet domains and addresses to the endpoint.
   Common policy covers `ts.net`, `100.64.0.0/10` (including `100.100.100.100`),
   and `fd7a:115c:a1e0::/48`; subnet routes and custom domains need their own review.
   These are DNS/route matchers, not fields to add to the endpoint object.

Inspect nested logical rules as well as top-level rules. This projection finds
relevant matches without dumping entire rules or endpoint objects:

```sh
jq '[.route.rules // [] | .. | objects |
  select(has("ip_cidr") or has("domain_suffix")) |
  {type, mode, domain_suffix, ip_cidr, action, outbound}]' "$CONFIG"
```

For effective behavior, also inspect parent logical conditions, inversion,
earlier rules, and current selectors; the projection is discovery, not a route
trace. Keep Tailnet matches ahead of conflicting direct/catch-all rules.

Verify a known peer name against internal and system resolvers, then request a
real service on that peer. A negative-control name can help detect wildcard or
unexpected answers, but an empty answer does not prove cache freshness or peer
health. If names resolve but services fail, inspect endpoint state, route choice,
peer/ACL status, and direct/relay transport separately. The native Tailscale CLI
may describe a different node from the embedded endpoint.

Userspace TUN may accept TCP locally even when the upstream path is broken.
Require a bounded reply from the intended application protocol. DNS success is
not an SMB liveness check. For SMB automation, an SMB2 NEGOTIATE probe must be
validated against a real server; use MessageId 0 for the initial request for
server compatibility. A synthetic responder alone cannot validate the request.

For named hosts, SSH aliases, MagicDNS suffixes, and KingNAS SMB, read
[Tailnet topology](topology.md). Revalidate CGNAT assignments and service
health at use time; a remembered `100.x` address is not identity.

### Determine Tailscale ownership on a remote host

1. **Discover the target.** Resolve the configured SSH alias, then run bounded
   process/service queries over SSH. Remote availability checks require no
   filesystem mounts or remote file inspection. Establish the remote OS and shell
   first; Windows PowerShell cannot execute POSIX shell conditionals.
   Request process names before arguments, which can contain secrets.
2. **Check the conventional proxy.** On a server, test the expected sing-box
   mixed listener at `127.0.0.1:7890` from that same host, then use a bounded
   proxy request only when the target path authorizes network traffic. A closed
   port means the convention is unavailable; do not silently substitute another
   proxy port.
3. **Identify candidates.** On Linux, compare `tailscaled` and sing-box processes
   with system and user services; both `singbox.service` and `sing-box.service`
   occur locally. An inactive system unit does not exclude user, container, or
   manually supervised instances. On macOS, check native Tailscale versus SFM
   network extensions and the owning app. On Windows, use `Get-Process` and
   `Get-Service` for Tailscale and sing-box. Extension registration alone is not
   a running-connection check.
4. **Resolve the node owner.** Follow the relevant branch:
   - **Native:** associate the daemon/app with its account and CLI socket. For
     multiple Linux instances, project only `--socket` from target-process
     arguments; inspect that account's socket or namespace rather than starting
     a default daemon. Query `tailscale --socket=<resolved-socket> status --json`
     where supported. Parse privately and display only `BackendState` and
     `Self.Online`; handle command failure before JSON parsing. On macOS, the
     native CLI may live inside `Tailscale.app`; use PowerShell JSON projection
     on Windows. A CLI connection failure leaves health unknown.
   - **Embedded:** correlate the owning sing-box/SFM process with its service/app
     status and a bounded application reply through the intended path. This
     availability check does not mount or read remote configuration. If endpoint
     ownership cannot be established from runtime evidence, report it as unknown.
     Inspecting effective configuration is a separate, authorized file operation
     subject to the repository's remote-file policy, not part of SSH testing.
5. **Classify and verify.** Report native, embedded, both, or unknown, plus
   system-interface/userspace mode when established. Correlate the intended
   node with routes and a bounded application reply. Missing permissions,
   unresolved SSH aliases, and unavailable sockets are evidence limits,
   not reasons to install a second client or declare the host off-Tailnet.

For native nodes, diagnose their owning client/socket and OS routes; for embedded
nodes, diagnose endpoint DNS references and sing-box route selection. With both,
map each node independently before choosing the traffic path. Preserve existing
clients, login state, and service ownership throughout discovery.

## DNS and route policy

Discover the configured internal resolver and system resolver addresses; do not
reuse a historical TUN address. Query A and AAAA separately, comparing response
code and answer data rather than treating any empty result as success.

```sh
dig +time=2 +tries=1 @"$INTERNAL_DNS" "$TEST_NAME" A
dig +time=2 +tries=1 @"$INTERNAL_DNS" "$TEST_NAME" AAAA
```

Also test the OS resolver used by applications. On macOS, `dig` alone does not
exercise all scoped resolver behavior; use `scutil --dns`,
`dscacheutil -q host -a name "$TEST_NAME"`, and an application request. Browser
DNS/cache can differ from both. Verify DNS policy without globally changing IP
family preferences merely to work around one domain.

For selector changes, discover current group tags and candidates from the
running configuration/API; compare configured defaults with runtime selection.
Keep control API credentials out of commands/output and preserve loopback binding.
For rule-set updates, check rule ordering, tag references, binary/source format,
and download/bootstrap routing. Use fields supported by the target version;
consult migration docs before replacing deprecated download or DNS syntax.

### Stale macOS DNS after tunnel shutdown

When hostname requests fail after stopping SFM, compare tunnel state,
`scutil --dns`, and `networksetup -getdnsservers "$NETWORK_SERVICE"`. First discover
the actual service name and physical interface. Fixed-address traffic can isolate
DNS from physical IPv4/IPv6 reachability; prefer `curl --resolve` with a known
address to preserve hostname/SNI and certificate verification.

Only when the tunnel is confirmed stopped and its resolver addresses remain
persisted as manual service DNS should cleanup target those entries. Preserve
intentional static DNS. If the service is meant to use DHCP and the user has
authorized the system DNS repair, restore it with:

```sh
networksetup -setdnsservers "$NETWORK_SERVICE" Empty
```

Completion requires the intended resolver configuration and successful hostname
requests for supported IP families. A healthy fixed-address IPv6 path is evidence
against disabling IPv6 as a DNS workaround.

## Official references

The selected upstream pages are available offline under
[the offline index](upstream/INDEX.md). Read the local page first; use its `manifest.json` to
identify the upstream repository, commit, capture date, and page hashes. The
snapshot is deliberately limited to the pages most relevant to this skill, is
not a complete website mirror, and may describe a newer engine than the target.
Check the target version's migration notes before adopting a field. Online URLs
remain listed for source verification and refreshing the snapshot.

- [TUN inbound](upstream/configuration/inbound/tun.md) ([online](https://sing-box.sagernet.org/configuration/inbound/tun/)): capture, DNS integration, exclusions, and Linux routing.
- [Tailscale endpoint](upstream/configuration/endpoint/tailscale.md) ([online](https://sing-box.sagernet.org/configuration/endpoint/tailscale/)): endpoint identity, system interface, and lifecycle.
- [Tailscale DNS](upstream/configuration/dns/server/tailscale.md) ([online](https://sing-box.sagernet.org/configuration/dns/server/tailscale/)): MagicDNS and resolver fallback.
- [DNS rules](upstream/configuration/dns/rule.md) ([online](https://sing-box.sagernet.org/configuration/dns/rule/)): DNS selection and matching.
- [Route rules](upstream/configuration/route/rule.md) ([online](https://sing-box.sagernet.org/configuration/route/rule/)): match order and logical rules.
- [Rule-sets](upstream/configuration/rule-set/index.md) ([online](https://sing-box.sagernet.org/configuration/rule-set/)): remote/local sources and formats.
- [Clash API](upstream/configuration/experimental/clash-api.md) ([online](https://sing-box.sagernet.org/configuration/experimental/clash-api/)): runtime controller configuration.
- [Migration](upstream/migration.md) ([online](https://sing-box.sagernet.org/migration/)): version-specific removals and replacements.
