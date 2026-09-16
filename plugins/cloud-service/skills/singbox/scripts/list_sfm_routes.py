#!/usr/bin/env python3
import json
import os
import urllib.request


CLASH_API = os.environ.get("CLASH_API", "http://127.0.0.1:9090").rstrip("/")


def get_json(path):
    req = urllib.request.Request(f"{CLASH_API}{path}")
    secret = os.environ.get("CLASH_API_SECRET")
    if secret:
        req.add_header("Authorization", f"Bearer {secret}")
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(req, timeout=5) as response:
        return json.load(response)


def main():
    proxies = get_json("/proxies").get("proxies", {})
    selectors = []
    for name, info in proxies.items():
        if info.get("type") in {"Selector", "URLTest", "Fallback", "LoadBalance"}:
            selectors.append(
                {
                    "name": name,
                    "type": info.get("type"),
                    "now": info.get("now"),
                    "all": info.get("all", []),
                }
            )
    print(json.dumps(selectors, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
