"""Minimal subprocess helpers for standalone CLIs."""

from __future__ import annotations

import subprocess
from collections.abc import Sequence
from pathlib import Path


def run_checked(cmd: Sequence[str], cwd: Path | None = None) -> None:
    completed = subprocess.run(cmd, cwd=cwd, text=True)
    if completed.returncode != 0:
        raise SystemExit(completed.returncode)
