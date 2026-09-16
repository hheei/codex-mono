#!/usr/bin/env python3
import json
import os
import sys
import urllib.request
from urllib.parse import quote


CLASH_API = os.environ.get("CLASH_API", "http://127.0.0.1:9090").rstrip("/")


def request(method, path, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(
        f"{CLASH_API}{path}",
        data=data,
        method=method,
        headers={"Content-Type": "application/json"},
    )
    secret = os.environ.get("CLASH_API_SECRET")
    if secret:
        req.add_header("Authorization", f"Bearer {secret}")
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(req, timeout=5) as response:
        raw = response.read()
        return json.loads(raw) if raw else None


def main():
    if len(sys.argv) != 3:
        print("usage: set_sfm_route.py <selector> <route>", file=sys.stderr)
        return 2
    selector, route = sys.argv[1], sys.argv[2]
    selector_path = f"/proxies/{quote(selector, safe='')}"
    before = request("GET", selector_path)
    request("PUT", selector_path, {"name": route})
    request("DELETE", "/connections")
    after = request("GET", selector_path)
    print(
        json.dumps(
            {
                "selector": selector,
                "before": before.get("now"),
                "after": after.get("now"),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
