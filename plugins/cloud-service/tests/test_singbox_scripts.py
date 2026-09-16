"""Isolated CLI contracts; never contact a real controller or Tailnet."""

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import quote

SCRIPTS = Path(__file__).resolve().parents[1] / "skills/singbox/scripts"
GROUP = "代理 / AI"


class ScriptContracts(unittest.TestCase):
    def setUp(self):
        self.selected = "original"
        self.calls = []
        case = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def handle_request(self):
                case.calls.append((self.command, self.path))
                if self.path.startswith("http://"):
                    self.send_response(200)
                    self.end_headers()
                    self.wfile.write(b"<title>proxied</title>")
                    return
                if self.headers.get("Authorization") != "Bearer test-only-secret":
                    self.send_response(401)
                    self.end_headers()
                    return
                if self.path == "/proxies":
                    value = {
                        "proxies": {
                            GROUP: {
                                "type": "Selector",
                                "now": case.selected,
                                "all": ["original", "candidate"],
                            }
                        }
                    }
                elif self.path == "/proxies/" + quote(GROUP, safe=""):
                    if self.command == "PUT":
                        body = json.loads(
                            self.rfile.read(int(self.headers["Content-Length"]))
                        )
                        case.selected = body["name"]
                    value = {"now": case.selected}
                elif self.path == "/connections" and self.command == "DELETE":
                    value = {}
                else:
                    self.send_response(404)
                    self.end_headers()
                    return
                self.send_response(200)
                self.end_headers()
                self.wfile.write(json.dumps(value).encode())

            do_GET = do_PUT = do_DELETE = handle_request

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        address = "http://127.0.0.1:" + str(self.server.server_port)
        self.environment = dict(
            os.environ,
            CLASH_API=address,
            LOCAL_PROXY=address,
            CLASH_API_SECRET="test-only-secret",
            CLASH_SELECTOR=GROUP,
            no_proxy="*",
            NO_PROXY="*",
        )

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def run_script(self, name, *args):
        return subprocess.run(
            [sys.executable, str(SCRIPTS / name), *args],
            env=self.environment,
            capture_output=True,
            text=True,
            timeout=15,
        )

    def test_authenticated_listing_does_not_print_secret(self):
        result = self.run_script("list_sfm_routes.py")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)[0]["name"], GROUP)
        self.assertNotIn("test-only-secret", result.stdout + result.stderr)

    def test_switch_encodes_group_and_keeps_selection(self):
        result = self.run_script("set_sfm_route.py", GROUP, "candidate")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.selected, "candidate")
        self.assertIn(("DELETE", "/connections"), self.calls)

    @unittest.skipUnless(shutil.which("curl"), "curl unavailable")
    def test_route_probe_uses_proxy_despite_no_proxy_and_restores(self):
        result = self.run_script(
            "test_sfm_routes.py", "http://destination.invalid/", "candidate"
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        value = json.loads(result.stdout)
        self.assertEqual(value["results"][0]["title"], "proxied")
        self.assertEqual(value["results"][0]["curl_exit"], 0)
        self.assertEqual(self.selected, "original")
        self.assertIn(("GET", "http://destination.invalid/"), self.calls)

    def test_unknown_selector_is_not_guessed(self):
        self.environment.pop("CLASH_SELECTOR")
        result = self.run_script(
            "test_sfm_routes.py", "http://destination.invalid/", "candidate"
        )
        self.assertEqual(result.returncode, 2)
        self.assertEqual(self.calls, [])

    def test_unavailable_engine_leaves_config_unverified(self):
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / "proxy.json"
            config.write_text('{"outbounds":[{"type":"direct","tag":"direct"}]}')
            result = self.run_script(
                "validate_config.py",
                str(config),
                "--working-directory",
                directory,
                "--binary",
                str(Path(directory) / "missing-engine"),
            )
        self.assertEqual(result.returncode, 2)
        self.assertIn("unverified", result.stderr)
        self.assertNotIn("PKU", result.stdout + result.stderr)

    @unittest.skipUnless(shutil.which("sing-box"), "sing-box unavailable")
    def test_real_engine_accepts_proxy_only_and_rejects_invalid_config(self):
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / "proxy.json"
            for content, expected in [
                ('{"outbounds":[{"type":"direct","tag":"direct"}]}', 0),
                ('{"outbounds":[{"type":"unknown-test-protocol"}]}', 1),
            ]:
                with self.subTest(content=content):
                    config.write_text(content)
                    result = self.run_script(
                        "validate_config.py",
                        str(config),
                        "--working-directory",
                        directory,
                    )
                    self.assertEqual(result.returncode, expected, result.stderr)
                    self.assertEqual(json.loads(result.stdout)["valid"], expected == 0)


if __name__ == "__main__":
    unittest.main()
