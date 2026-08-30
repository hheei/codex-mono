---
name: singbox
description: Use only when the user explicitly asks for the singbox skill, SFM route control, sing-box local proxy control, or Clash API routing diagnostics. Provides reusable local knowledge and optional scripts for inspecting SFM/sing-box, switching selector groups, and testing whether a domain works through direct or proxy routes.
---

# Singbox / SFM Route Control

Use this skill for local SFM/sing-box routing work. Prefer read-only inspection first, then make temporary selector changes only when the user asks to try a route or solve connectivity.

## Local Facts From This Machine

- SFM app process name may appear as `/Applications/SFM.app/Contents/MacOS/SFM`.
- SFM uses the `io.nekohasekai` sing-box runtime.
- The local HTTP proxy observed from Codex is `127.0.0.1:7890`.
- macOS system proxy may be disabled even when Codex is already using `127.0.0.1:7890` through environment variables.
- The Clash-compatible API was previously available at `127.0.0.1:9090` with an empty secret, but it may be disabled in the active SFM profile. Probe it before relying on API commands.
- Current SFM profiles live under `~/Library/Group Containers/287TTNZF8L.io.nekohasekai.sfavt/configs/`; `~/.config/singbox/config.json` may not exist.
- `config_1.json` contained the active routing shape observed on 2026-07-24, including `[KR] SCOPE`, but confirm the selected profile before editing because SFM manages these files.
- When the API is available in `rule` mode, selector group `Default` controls the route used by Codex/browser requests.

## Useful Commands

Inspect app and proxy state:

```bash
ps aux | rg -i 'SFM|sing-box|singbox|mihomo|clash|7890|9090'
scutil --proxy
lsof -nP -iTCP:7890 -sTCP:LISTEN
curl -sS --max-time 5 http://127.0.0.1:9090/configs
find "$HOME/Library/Group Containers/287TTNZF8L.io.nekohasekai.sfavt/configs" \
  -maxdepth 1 -name 'config*.json' -print
```

If port `9090` refuses the connection, do not assume SFM is stopped. Inspect the app and system extension instead:

```bash
ps aux | rg -i '/Applications/SFM|io\.nekohasekai|sing-box'
log show --last 20m --style compact \
  --predicate 'process == "SFM" OR process == "io.nekohasekai.sfavt.system"'
```

List selector groups:

```bash
curl -s --max-time 5 http://127.0.0.1:9090/proxies | jq '.proxies | keys'
curl -s --max-time 5 http://127.0.0.1:9090/proxies/Default | jq '{name, type, now, all}'
```

Switch `Default` temporarily:

```bash
jq -nc --arg name 'Direct-Out' '{name:$name}' \
  | curl -s -X PUT http://127.0.0.1:9090/proxies/Default \
      -H 'Content-Type: application/json' --data-binary @-
curl -s -X DELETE http://127.0.0.1:9090/connections
```

Test a domain through the local proxy:

```bash
curl -x http://127.0.0.1:7890 -I -L --max-time 20 https://invite.linuxdo.org/
```

## KR SCOPE IPv6 Case

Observed on 2026-07-24:

- `[KR] SCOPE` is a Hysteria2 outbound to `link.lmxu.cc:8442`; the server hostname resolved only to IPv4. This is normal because IPv6 destinations are carried inside the Hysteria2 tunnel.
- The client had native IPv6 and a valid SFM TUN IPv6 default route. IPv4 HTTPS succeeded, while IPv6 HTTPS reached TLS and then failed with `SSL_ERROR_SYSCALL`.
- The server is reachable through SSH alias `lmxu-cloud` as user `ubuntu`; if Tailscale DNS is unavailable, use public IPv4 `43.133.225.216` with the same SSH identity settings.
- The server service is `sing-box-lmxu.service`; Hysteria2 listens on UDP `8442`.
- Before cloud IPv6 was enabled, `eth0` had no public IPv6 or IPv6 default route. The only global-looking IPv6 was Tailscale ULA `fd7a:115c:a1e0::/48`, which cannot reach the public IPv6 Internet. Server-side `ping -6` returned `Network is unreachable`, causing sing-box to close proxied IPv6 connections immediately.
- After cloud IPv6 was enabled, `eth0` received a public `240d:` address and a default route via a link-local gateway. Server-side and client-through-proxy IPv6 HTTPS both succeeded without sing-box changes.

Use this read-only workflow for similar failures:

```bash
# Client: compare address families through the active SFM route.
curl -4 -sS -o /dev/null --connect-timeout 5 --max-time 12 \
  -w 'IPv4 %{http_code} %{remote_ip}\n' https://www.cloudflare.com
curl -6 -sS -o /dev/null --connect-timeout 5 --max-time 12 \
  -w 'IPv6 %{http_code} %{remote_ip}\n' https://www.cloudflare.com

# Server: verify a public address, default route, outbound IPv6, and listener.
ssh -o BatchMode=yes lmxu-cloud '
  ip -6 addr show scope global
  ip -6 route show
  ping -6 -c 2 -W 3 2606:4700:4700::1111
  curl -6 -sS -o /dev/null --connect-timeout 5 --max-time 12 \
    -w "IPv6 %{http_code} %{remote_ip}\\n" https://ipv6.google.com
  ss -lunp | grep ":8442"
'
```

Interpretation:

- No public IPv6 and no `default` IPv6 route: enable IPv6 in the cloud network first; sing-box routing changes will not fix the server egress.
- Public IPv6 and default route exist, but `ping -6`/`curl -6` fail: inspect cloud security rules, host firewall, neighbor discovery, and provider routing.
- Server IPv6 succeeds but client IPv6 fails: inspect sing-box logs and Hysteria2/QUIC path next.
- `RootHelperXPC: findConnectionOwner error` means SFM could not attribute a flow to an app; it is not evidence that the network connection failed.

## Linux.do Invite Case

Observed behavior on 2026-07-07:

- `https://linux.do/` opened in the in-app browser.
- `https://invite.linuxdo.org/` returned Cloudflare `403` when routed through `Default -> SG-Z1`.
- Cloudflare page said `Sorry, you have been blocked`.
- The active SFM chain for the failing request was `Default -> SG-Z1`.
- Switching `Default` to `Direct-Out`, clearing active connections, and reloading the browser changed the invite page to `200` with title `LINUX DO 邀请码`.

Recommended workflow for similar cases:

1. Record the current selector value before changing it.
2. Try the direct route first for domains where proxy egress is blocked by Cloudflare.
3. Clear active connections after switching a selector.
4. Reload the browser tab and verify visible page state.
5. Restore the original selector unless the user wants to keep the new route.

## PKU Campus Network And Tailscale Case

Observed during PKU campus-network debugging on 2026-07-08:

- When the user asks for persistent config changes, first identify the currently selected SFM profile under `~/Library/Group Containers/287TTNZF8L.io.nekohasekai.sfavt/configs/`. Do not assume `~/.config/singbox/config.json` exists.
- SFM manages profile files and may rewrite them. Make a timestamped backup of the selected profile before editing, then validate that exact path:

```bash
CONFIG="$HOME/Library/Group Containers/287TTNZF8L.io.nekohasekai.sfavt/configs/config_1.json"
python3 -m json.tool "$CONFIG" >/tmp/singbox-config-check.json
sing-box check -c "$CONFIG"
```

Important working model:

- PKU campus services such as `iaaa.pku.edu.cn` and `its.pku.edu.cn` should resolve through PKU DNS and route direct.
- `iaaa.pku.edu.cn` observed as `162.105.131.147`; `its.pku.edu.cn` observed as `162.105.129.65`.
- ICMP ping to PKU services may fail while TCP 443 works; test with `nc -vz -G 3 <ip> 443` before concluding the campus network is down.
- For PKU direct access, keep TUN route exclusions for `111.205.0.0/16` and `162.105.0.0/16`.
- Use PKU DNS such as `162.105.129.122` and `162.105.129.88` for PKU/campus/bootstrap DNS.
- Do not use PKU DNS as the final resolver for Google, ChatGPT, GitHub, or other proxy-only domains. Use proxy-routed DoH/DoT for those.
- In sing-box 1.13.x, DoH server objects should use `type: "https"`, `server: "1.1.1.1"` or `"8.8.8.8"`, and `server_port: 443`. Do not put a full URL like `https://1.1.1.1/dns-query` in `server`; that can become `https://https:%2F%2F.../dns-query`.
- DNS servers routed through a selector inherit selector failures. If DNS logs show `reality verification failed`, remove failing Reality/Hysteria nodes from `Auto` or detour DNS to a known-good selector.
- On PKU campus network, DoT `:853` to public DNS may fail or EOF. Prefer DoH `:443` through a working proxy route for proxy-domain DNS.
- If `Auto` includes unstable nodes, especially Reality nodes failing with `reality verification failed` or UDP/Hysteria nodes blocked by campus network, remove them from `Auto` while leaving them available in manual selectors.
- `log.level: "error"` reduces routine SFM noise once connectivity is stable.
- `169.254.169.254:80` errors are usually metadata/link-local probes; reject `169.254.169.254/32` if the log noise matters.

Tailscale-specific notes:

- This SFM setup uses sing-box's built-in Tailscale endpoint, not a separate `tailscale` CLI/process.
- Route `ts.net`, `100.64.0.0/10`, `100.100.100.100/32`, and `fd7a:115c:a1e0::/48` to the `ts-ep` outbound when using built-in Tailscale.
- Do not permanently route those tailnet ranges to `Direct-Out`; that treats them as ordinary TCP and can timeout.
- Do not add tailnet ranges to `route_exclude_address` when built-in `ts-ep` should handle them.
- If logs show `missing Tailscale IPv4 address`, debug the `ts-ep` endpoint state next rather than switching the route to `Direct-Out`.
- If logs show `dial en0` for `100.x` addresses, check `auto_detect_interface`; binding Direct-Out to the physical interface can bypass the intended Tailscale path.

Known useful config shape:

```json
{
  "log": {
    "level": "error"
  },
  "dns": {
    "servers": [
      {
        "tag": "pku_dns",
        "type": "udp",
        "server": "162.105.129.122",
        "server_port": 53
      },
      {
        "tag": "proxy_dns",
        "type": "https",
        "server": "1.1.1.1",
        "server_port": 443,
        "detour": "Auto",
        "domain_resolver": "cn_bootstrap"
      }
    ]
  },
  "route": {
    "auto_detect_interface": false,
    "rules": [
      {
        "ip_cidr": ["169.254.169.254/32"],
        "action": "reject"
      },
      {
        "domain_suffix": ["pku.edu.cn"],
        "outbound": "Direct-Out"
      },
      {
        "domain_suffix": ["ts.net"],
        "outbound": "ts-ep"
      },
      {
        "ip_cidr": ["100.64.0.0/10", "100.100.100.100/32", "fd7a:115c:a1e0::/48"],
        "outbound": "ts-ep"
      }
    ]
  }
}
```

## Optional Scripts

Run bundled scripts from the skill directory:

```bash
python3 scripts/list_sfm_routes.py
python3 scripts/set_sfm_route.py Default Direct-Out
python3 scripts/test_sfm_routes.py https://invite.linuxdo.org/ Direct-Out 'SG-Z1'
python3 scripts/check_config_health.py "$HOME/Library/Group Containers/287TTNZF8L.io.nekohasekai.sfavt/configs/config_1.json"
```

Scripts assume the Clash API is at `http://127.0.0.1:9090` and the local HTTP proxy is `http://127.0.0.1:7890`. Override with:

```bash
CLASH_API=http://127.0.0.1:9090 LOCAL_PROXY=http://127.0.0.1:7890 python3 scripts/list_sfm_routes.py
```

## Safety

- Do not edit an SFM profile unless the user explicitly asks for a persistent rule.
- Before editing, identify the selected profile, read its latest contents, and make a timestamped backup.
- For temporary testing, prefer the Clash API selector endpoint over config file edits.
- Always restore the previous selector if the route change was only for testing.
- Do not print secrets or full proxy server credentials from config files.
