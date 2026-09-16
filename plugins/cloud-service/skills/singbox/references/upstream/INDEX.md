# Offline sing-box Official Documentation

Selected English Markdown pages from the [official sing-box repository](https://github.com/SagerNet/sing-box), captured on **2026-09-12**.

- Revision: `f6ce1d5be042436d2b498d216cef718ea87a1ca8`
- Branch at capture: `testing`
- Commit time: `2026-09-10T22:09:32+08:00`
- Provenance and SHA-256 checksums: [manifest.json](manifest.json)
- Upstream repository license: [LICENSE](LICENSE)

## Scope and use

These are complete upstream source pages, not assistant-written summaries.
Only Markdown link destinations were changed: links between included pages resolve
locally; references to pages outside this snapshot remain absolute online URLs.
MkDocs source notation (admonitions, tabs, icons) is retained and readable as text;
this is an agent-readable Markdown collection, not a rendered website.

Read only the page needed. This is an eight-page selection, not a complete offline
mirror; following an external link still requires network access. The upstream
`testing` branch includes newer-version fields (including 1.15). It is **not** a
1.14 release manual. Check each field's version annotations against the installed
engine; if the required version or dependency is absent, report that limitation
rather than assuming compatibility or silently substituting a cached answer.

## Pages

| Topic | Offline page |
| --- | --- |
| TUN capture, DNS integration, Linux routing | [TUN inbound](configuration/inbound/tun.md) |
| Tailscale identity, interface, lifecycle | [Tailscale endpoint](configuration/endpoint/tailscale.md) |
| MagicDNS and resolver fallback | [Tailscale DNS](configuration/dns/server/tailscale.md) |
| DNS selection and matching | [DNS rules](configuration/dns/rule.md) |
| Traffic routing and logical rules | [Route rules](configuration/route/rule.md) |
| Rule-set sources and formats | [Rule-sets](configuration/rule-set/index.md) |
| Runtime controller configuration | [Clash API](configuration/experimental/clash-api.md) |
| Version-specific changes | [Migration](migration.md) |

## Refreshing

Refresh explicitly when requested or when the target engine requires documentation
outside this snapshot. Do not fetch all pages on routine skill invocation.

1. Resolve an official repository tag/commit appropriate to the task. Fetch the
   `docs/` sources for all paths listed in the manifest from that same revision.
2. Preserve each complete source page. Relink included pages using relative local
   paths and resolve other site links to their absolute official URLs, retaining
   fragments. Preserve the upstream license.
3. Update capture date, revision, source URLs, original-source checksums and saved
   checksums in the manifest and this index. Keep pages from one revision together.
4. Verify every saved page against its source apart from declared link changes;
   check local links and exercise a local lookup before replacing the snapshot.

Keep local operating policy in the skill's runbook/deployment reference, not in
these upstream pages. This avoids mixing official documentation with host-specific
exceptions when the snapshot is refreshed.
