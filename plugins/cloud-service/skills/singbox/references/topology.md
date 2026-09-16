# Tailnet Topology

Read this for host mapping, SSH aliases, KingNAS SMB, and which MagicDNS suffix
a name belongs to. It is a retained map, not a live inventory. Revalidate
addresses, keys, and service health at use time. Discover current CGNAT
assignments from SSH/DNS/runtime; do not treat a remembered `100.x` address as
identity.

Do not dump peer IPs, keys, auth URLs, or profile JSON into output or commits.

## Nets

Two MagicDNS suffixes are in regular use:

| Suffix | Role |
| --- | --- |
| `leo-gentoo.ts.net` | Personal Tailnet for Judy, ileqm, tencent-kr (formerly lmxu-cloud), billy, and the owner's Mac's embedded endpoint |
| `bicolor-luma.ts.net` | Family/NAS Tailnet for KingNAS and the mac-mini |

`tail4c93f7.ts.net` appears as a legacy KingNAS SSH `HostName`. Treat it as an
alias to revalidate, not a third independent map.

The owner's Mac normally joins through SFM's embedded Tailscale endpoint
(`ts-ep`), not a native Tailscale app. It usually has no `100.x` address on a
system interface.
MagicDNS answers do not prove peer transport. A userspace TUN (SFM or another
proxy) may complete a local TCP handshake while the Tailnet path is blackholed.

Native `tailscale` / `tailscaled` is a different node when present. Do not use
one runtime as proof of the other.

## Deployment ownership matrix

This table records intended client ownership, not running state. Revalidate the
target before every network change; keep process IDs, current health, endpoint
tags, configuration paths, and probe failures in the task report.

| Host / deployment | Intended Tailscale implementation | Revalidation boundary |
| --- | --- | --- |
| Owner's Mac / SFM | sing-box embedded, userspace (`system_interface: false`) | Resolve SFM's selected profile and owning extension |
| `judy` | sing-box embedded, system interface (`system_interface: true`) | Confirm effective sing-box service and endpoint ownership |
| `tencent-kr` (formerly `lmxu-cloud`) | sing-box embedded, system interface (`system_interface: true`) | Confirm the running configuration still owns the endpoint |
| `ileqm` | Native, account-scoped `tailscaled` | Resolve the target account and its non-default socket; multiple accounts may run separate nodes |
| `buddy` | Native macOS Tailscale | Confirm the official network extension and native CLI refer to the intended node |
| `paddy` | Native Windows Tailscale | Confirm the Windows service/client and intended node |
| `tencent-sh`, `oracle-kr`, `oracle-sg`, `billy`, `kingnas`, `silly` | Unknown | Classify from current runtime; a sing-box process or Tailnet name is insufficient |

Follow [ownership discovery](networking.md#determine-tailscale-ownership-on-a-remote-host)
before changing a host. Client ownership and network mode are separate axes: a
native client may use userspace networking, and an embedded endpoint may own a
system interface. Multiple daemons may represent different accounts, containers,
sockets, and nodes rather than redundant copies to remove.

### Proxy and capture modes

| Host / deployment | Proxy / capture mode | Egress / network role |
| --- | --- | --- |
| Owner's Mac / SFM | **TUN mode** | Packet tunnel capture via SFM extension |
| `judy` | **Transparent proxy** | Linux TProxy (`auto_route` + `auto_redirect` / nftables) |
| Overseas cloud servers (`tencent-kr`, `oracle-kr`, `oracle-sg`, `tencent-sh`) | **Direct connection** (`direct`) | Native unrestricted international egress; bypasses local proxies |

> **Note on embedded Tailscale**: Sing-box embedded Tailscale endpoints have **no `tailscale` CLI**. Do not use `tailscale status`, `tailscale up`, or other CLI commands on these endpoints; their lifecycle and routing are managed entirely within sing-box.

## Host map

SSH `Host` aliases are the live index (`~/.ssh/config`). Resolve the alias before
running process/service checks over SSH. Remote file access follows the calling
environment's file-access policy. The table records durable names and roles.

| SSH Host | MagicDNS / discovery | Role |
| --- | --- | --- |
| _(owner's Mac)_ | embedded `ts-ep` on SFM | Owner laptop; expected source under `~/.config/singbox/` |
| `judy` | `judy.leo-gentoo.ts.net` | Linux sing-box host (`chlo`); campus SOCKS hop |
| `ileqm` | `ileqm.leo-gentoo.ts.net` | Linux peer (`chlo`); SSH config disables hostname canonicalization |
| `tencent-kr` (alias `lmxu-cloud`) | `tencent-kr.leo-gentoo.ts.net` | Cloud VM (`ubuntu`); proxy origin, not a LAN peer |
| `billy` | `billy.leo-gentoo.ts.net` | Linux peer (`chlo`) |
| `kingnas` | `kingsnas.bicolor-luma.ts.net` (legacy `kingsnas.tail4c93f7.ts.net`) | Synology NAS; SMB share `hei` |
| `buddy` | `mac-mini.bicolor-luma.ts.net` | Family Mac mini; default SSH user `buddy`, NAS automount user `kings` |
| `nscc` | campus LAN via Judy SOCKS | Reached with Judy as `ProxyCommand`; not a Tailnet node |

Other SSH hosts (`sccpu`, `scdcu`, `nscc`) may be campus or public aliases.
Confirm Tailnet membership separately from the client implementation above.

## Reachability layers

Separate these claims:

1. **Name** — MagicDNS or SSH `HostName` resolved.
2. **Local TCP** — `nc -z` / SYN-ACK. A userspace TUN may accept this locally.
3. **Application** — SSH banner, SMB2 NEGOTIATE, or an HTTP/protocol reply from
   the intended service.
4. **Transport** — direct peer path versus DERP relay. Do not infer a DERP
   failure from a TCP timeout alone.

For SMB, DNS success is not a liveness check. Probe with a bounded SMB2
NEGOTIATE (MessageId 0 on the initial request). For SSH, require a banner or
authenticated command, not connect-success.

When a proxy TUN routes `100.64.0.0/10` as ordinary direct TCP, a dead Tailnet
looks like an open port followed by a stall. Diagnose the endpoint/DERP path;
do not "fix" it by sending Tailnet ranges to a physical Direct outbound.

## KingNAS SMB

On the owner's Mac, automount is `com.supercgor.kingnas-smb` →
`~/Library/Scripts/kingnas-mount.sh`.

| Item | Convention |
| --- | --- |
| Server | `kingsnas.bicolor-luma.ts.net` |
| Share | `hei` → `/Volumes/hei` |
| Account | `hheei` (Keychain; do not print the secret) |
| Failure policy | Silent skip: no dialog, no hang, no retry storm |

The script must prove SMB spoke before asking Finder to mount. Wrap the mount
in a timeout and back off after failure so NetAuth cannot loop a GUI prompt.
`nc -z :445` is not sufficient on a userspace TUN.

The mac-mini (`buddy` / user `kings`) has a related automount. Check that host
only over a working Tailnet path; do not scan the LAN for it.

## Judy as campus hop

`Host nscc` uses Judy as a SOCKS proxy rather than joining NSCC to a Tailnet.
Preserve that hop. Confirm Judy's listener and SSH auth separately from NSCC
reachability. Do not add a second Tailscale endpoint on Judy to replace the
SOCKS path.

Judy's sing-box capture uses `system_interface: true` for its own endpoint.
`tailscale0` on Judy is that endpoint's interface unless ownership inspection
says otherwise. See [Local deployments](deployments.md) for service paths.

## Change boundaries

- Keep `leo-gentoo` and `bicolor-luma` as separate nets. Do not merge them in
  routing policy or assume a name in one suffix exists in the other.
- Keep SFM's single app-managed Tailscale endpoint. Do not add a native
  `tailscaled` beside it on the owner's Mac to "fix" MagicDNS.
- KingNAS and mac-mini live on `bicolor-luma`. Personal compute (Judy, ileqm,
  billy, tencent-kr) lives on `leo-gentoo`.
- Re-read SSH config and runtime DNS before editing aliases or automount hosts.
  Stale CGNAT literals in SSH config are discovery hints.
