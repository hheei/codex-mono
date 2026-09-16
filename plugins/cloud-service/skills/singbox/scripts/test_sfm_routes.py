#!/usr/bin/env python3
import json
import os
import re
import subprocess
import sys
import urllib.request
from urllib.parse import quote


CLASH_API = os.environ.get("CLASH_API", "http://127.0.0.1:9090").rstrip("/")
LOCAL_PROXY = os.environ.get("LOCAL_PROXY", "http://127.0.0.1:7890")


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


def set_route(selector, route):
    request("PUT", f"/proxies/{quote(selector, safe='')}", {"name": route})
    request("DELETE", "/connections")


def fetch(url):
    proc = subprocess.run(
        [
            "curl",
            "--noproxy",
            "",
            "-x",
            LOCAL_PROXY,
            "-L",
            "--max-time",
            "20",
            "-sS",
            "-D",
            "-",
            "-o",
            "-",
            url,
        ],
        text=True,
        capture_output=True,
        check=False,
    )
    combined = proc.stdout
    status_matches = re.findall(r"^HTTP/\S+\s+(\d+)", combined, flags=re.MULTILINE)
    title_match = re.search(
        r"<title>(.*?)</title>", combined, flags=re.IGNORECASE | re.DOTALL
    )
    h1_match = re.search(
        r"<h1[^>]*>(.*?)</h1>", combined, flags=re.IGNORECASE | re.DOTALL
    )
    ray_match = re.findall(
        r"^cf-ray:\s*(\S+)", combined, flags=re.IGNORECASE | re.MULTILINE
    )
    return {
        "curl_exit": proc.returncode,
        "status": status_matches[-1] if status_matches else None,
        "title": re.sub(r"\s+", " ", title_match.group(1)).strip()
        if title_match
        else None,
        "h1": re.sub(r"\s+", " ", h1_match.group(1)).strip() if h1_match else None,
        "cf_ray": ray_match[-1] if ray_match else None,
        "stderr": proc.stderr.strip(),
    }


def main():
    if len(sys.argv) < 3:
        print("usage: test_sfm_routes.py <url> <route> [route...]", file=sys.stderr)
        return 2
    selector = os.environ.get("CLASH_SELECTOR")
    if not selector:
        print("Set CLASH_SELECTOR to the discovered target group.", file=sys.stderr)
        return 2
    url = sys.argv[1]
    routes = sys.argv[2:]
    original = request("GET", f"/proxies/{quote(selector, safe='')}").get("now")
    results = []
    try:
        for route in routes:
            set_route(selector, route)
            result = fetch(url)
            result["route"] = route
            results.append(result)
    finally:
        if original:
            set_route(selector, original)
    print(
        json.dumps(
            {"selector": selector, "restored": original, "results": results},
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
