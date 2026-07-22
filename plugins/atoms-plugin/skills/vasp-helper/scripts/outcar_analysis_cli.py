#!/usr/bin/env python3
"""Summarize a VASP run from OUTCAR/OSZICAR/INCAR/POSCAR using only stdlib."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from _lib.outcar import analyze_overall


DESCRIPTION = "Write a high-level summary for one VASP OUTCAR."


def configure_parser(parser: argparse.ArgumentParser) -> argparse.ArgumentParser:
    parser.add_argument("outcar", type=Path, help="Path to OUTCAR inside a run directory.")
    parser.add_argument(
        "--output",
        "-o",
        default="analysis.overall.md",
        help="Output file name written next to OUTCAR.",
    )
    return parser


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=DESCRIPTION)
    return configure_parser(parser)


def run(args: argparse.Namespace) -> int:
    outcar_path = args.outcar.resolve()
    if not outcar_path.is_file():
        raise SystemExit(f"OUTCAR `{outcar_path}` does not exist")
    markdown = analyze_overall(outcar_path)
    output_path = outcar_path.parent / args.output
    output_path.write_text(markdown, encoding="utf-8")
    sys.stdout.write(markdown)
    return 0


def main(argv: list[str] | None = None) -> int:
    return run(build_parser().parse_args(argv))


if __name__ == "__main__":
    raise SystemExit(main())
