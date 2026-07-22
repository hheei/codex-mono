#!/usr/bin/env python3
"""Clean VASP runtime output files from one or more directories.

Default mode is dry-run (print what would be removed).
Use --apply to actually delete files.
"""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Iterable

DEFAULT_PATTERNS = [
    "slurm*",
    "slurm.out",
    "slurm.err",
    "pygrid.h5",
    "REPORT",
    "PCDAT",
    "OUTCAR",
    "OSZICAR",
    "vaspout.h5",
    "vaspout.xml",
    "vasprun.xml",
    "WAVECAR",
    "XDATCAR",
    "LOCPOT",
    "EIGENVAL",
    "IBZKPT",
    "DOSCAR",
    "PROCAR",
    "CONTCAR",
    "CHG",
    "CHGCAR",
    "AECCAR0",
    "AECCAR1",
    "AECCAR2",
]

DESCRIPTION = "Clean VASP runtime files from directories."


def configure_parser(parser: argparse.ArgumentParser) -> argparse.ArgumentParser:
    parser.add_argument(
        "paths",
        nargs="*",
        default=["."],
        help="Target directories to clean (default: current directory).",
    )
    parser.add_argument(
        "-r",
        "--recursive",
        action="store_true",
        help="Recursively clean subdirectories.",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Actually delete matched files. Without this flag, only print matches.",
    )
    parser.add_argument(
        "--patterns",
        nargs="+",
        default=DEFAULT_PATTERNS,
        help="Glob patterns to remove.",
    )
    return parser


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=DESCRIPTION)
    return configure_parser(parser)


def _candidate_dirs(root: Path, recursive: bool) -> Iterable[Path]:
    if recursive:
        yield from (p for p in root.rglob("*") if p.is_dir())
    else:
        yield root


def find_matches(target_dirs: list[Path], recursive: bool, patterns: list[str]) -> list[Path]:
    matches: set[Path] = set()
    for root in target_dirs:
        if not root.exists() or not root.is_dir():
            continue
        for directory in _candidate_dirs(root, recursive):
            for pattern in patterns:
                for item in directory.glob(pattern):
                    if item.is_file() or item.is_symlink():
                        matches.add(item)
    return sorted(matches)


def run(args: argparse.Namespace) -> int:
    targets = [Path(p).expanduser().resolve() for p in args.paths]
    matches = find_matches(targets, args.recursive, args.patterns)
    if not matches:
        print("No matching files found.")
        return 0

    mode = "DELETE" if args.apply else "DRY-RUN"
    print(f"Mode: {mode}")
    print(f"Matched files: {len(matches)}")
    for path in matches:
        print(path)

    if not args.apply:
        print("Dry-run only. Re-run with --apply to delete files.")
        return 0

    deleted = 0
    failed = 0
    for path in matches:
        try:
            path.unlink()
            deleted += 1
        except OSError as exc:
            failed += 1
            print(f"[WARN] Failed to delete {path}: {exc}")

    print(f"Deleted: {deleted}")
    if failed:
        print(f"Failed: {failed}")
        return 1
    return 0


def main(argv: list[str] | None = None) -> int:
    return run(build_parser().parse_args(argv))


if __name__ == "__main__":
    raise SystemExit(main())
