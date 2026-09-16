# Deployment map

Use host aliases and MagicDNS names; revalidate current addresses, image versions,
container state, and listeners before every operation.

## Ownership

| Layer | Owner | Durable source | Current role |
| --- | --- | --- | --- |
| AxonHub application and PostgreSQL | `tencent-sh` | `/home/ubuntu/axonhub/` | Production backend |
| Public relay and Cloudflare Tunnel | `tencent-sh` | `/home/ubuntu/axonhub-relay/`, `cloudflared.service` | Active `api.lmxu.cc` ingress via `127.0.0.1:8080` |
| CLIProxyAPI (CPA) | `oracle-kr` | `/opt/cliproxyapi/` plus `cliproxyapi*.service` units | Production protocol-conversion upstream |

## Request paths

The currently observed production path for `api.lmxu.cc` remains:

```text
client → Cloudflare → cloudflared / OpenResty relay on `tencent-sh` :8080
       → AxonHub on `tencent-sh` :8090
       → PostgreSQL / selected upstream
```

The public hostname reaches the `tencent-sh` relay. For future routing changes,
correlate a unique public request marker with the intended relay log; health
alone is insufficient to establish which host served a request.

The `tencent-sh` relay normalizes only request headers: `Accept-Language` is
`ja-JP,ja;q=0.9,en;q=0.8`, `CF-IPCountry` is `JP`, `X-Timezone` and
`CF-Timezone` are `Asia/Tokyo`, and `X-UTC-Offset` is `+09:00`.
It removes client forwarding IPs and conflicting Cloudflare city/region/location
headers. Request bodies remain byte-for-byte unchanged, including structured
metadata; authorization headers and unbuffered SSE responses are preserved.
This policy applies at the relay-to-AxonHub boundary, not necessarily AxonHub's
upstream requests. It changes neither public egress IP nor TLS fingerprint.

The private AxonHub entry is
`http://tencent-sh.leo-gentoo.ts.net:8090`; the public API base is
`https://api.lmxu.cc/v1`.

CPA is reached on `oracle-kr` port `8317` through Tailnet where configured as an
AxonHub upstream. Discover the current MagicDNS address from host/runtime
configuration rather than storing a Tailscale IP here.

## Host-specific boundaries

### `tencent-sh`

- Production Compose project: `/home/ubuntu/axonhub/`.
- Containers: `axonhub` and `axonhub-postgres`.
- Listeners are bound to loopback and this host's Tailnet address, not its public
  interface.
- Durable data is the PostgreSQL Compose volume. Treat `.env` and `backups/` as
  secrets.
- `/home/ubuntu/cliproxyapi/` is a retained, inactive CPA draft; it is not the
  production CPA owner.
- The detailed deployed runbook is `/home/ubuntu/axonhub/README.md`. Read only
  the section needed for schema-level work, current model associations, pricing,
  backup/restore, or known incidents.

### `tencent-kr` (formerly `lmxu-cloud`)

- The obsolete `axonhub-relay` container and `/home/ubuntu/axonhub-relay/`
  deployment directory are removed. This host no longer serves AxonHub ingress.
- The shared `nginx:alpine` image is retained for `sub2api-gateway`.
- AxonHub and PostgreSQL formerly ran under `/home/ubuntu/axonhub/`; stopped
  containers/volumes there are rollback artifacts.
- The legacy `/home/ubuntu/newapi/` stack is not the active AI gateway.
- A local CLIProxyAPI container may exist, but it is not the production CPA
  owner. Do not operate it as CPA based only on a familiar container name.
- The old Cloudflare connector may still serve other hostnames such as
  `lmxu.cc`; do not stop it as part of the AxonHub migration.

### `tencent-sh` relay

- `/home/ubuntu/axonhub-relay/` contains the OpenResty relay, pinned by image
  digest and listening on `127.0.0.1:8080`.
- `cloudflared.service` and the relay serve the active public hostname.
- Its tested origin is `http://localhost:8080`; Cloudflare should not connect
  directly to AxonHub's `8090` listener.
- Validate `docker compose config --quiet`, `openresty -t`, relay health, and
  `python3 test_relay.py` in the relay directory. The regression test runs an
  isolated real proxy with synthetic authentication and an echo/SSE upstream;
  it does not prove an authenticated provider call. Also verify a real streamed
  model request when usable credentials are available.

### `oracle-kr`

- Production CPA source: `/opt/cliproxyapi/`.
- Lifecycle owner: `cliproxyapi.service`.
- Scheduled update owner: `cliproxyapi-update.timer` invoking
  `cliproxyapi-update.service`.
- The update service recreates the Compose stack and verifies loopback port
  `8317`. Inspect unit and Compose state before changing their behavior.

## Staleness rule

This map records stable ownership and flow, not a snapshot of mutable state.
Discover current image digests, model/channel IDs, API keys, prices, Tailscale
IPs, container health, and DNS/Tunnel configuration at operation time. When the
observed owner differs from this map, stop mutating, establish the new
source-to-runtime mapping, and update this reference in the same change.
