#!/usr/bin/env python3
"""Validate an explicit configuration with the target sing-box engine."""

import argparse
import json
from pathlib import Path
import shutil
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("config", type=Path, help="Explicit target config file")
    parser.add_argument(
        "--binary", default="sing-box", help="Compatible target engine executable"
    )
    parser.add_argument(
        "--working-directory",
        type=Path,
        required=True,
        help="Target service working directory",
    )
    args = parser.parse_args()
    config = args.config.expanduser().resolve()
    working_directory = args.working_directory.expanduser().resolve()
    binary = shutil.which(args.binary)
    if binary is None:
        parser.exit(
            2, "Target sing-box executable unavailable; configuration is unverified.\n"
        )
    if not config.is_file() or not working_directory.is_dir():
        parser.exit(
            2,
            "Config file or working directory unavailable; configuration is unverified.\n",
        )
    try:
        result = subprocess.run(
            [str(Path(binary).resolve()), "check", "-c", str(config)],
            cwd=working_directory,
            capture_output=True,
            timeout=30,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        parser.exit(
            2, "Engine check could not complete; configuration is unverified.\n"
        )
    # Engine diagnostics may echo credentials from configuration fields.
    print(
        json.dumps(
            {
                "config": str(config),
                "engine_exit": result.returncode,
                "valid": result.returncode == 0,
                "note": "Schema check only, not runtime health. Inspect engine diagnostics privately on failure.",
            }
        )
    )
    return 0 if result.returncode == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
