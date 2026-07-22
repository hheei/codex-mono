#!/usr/bin/env python3
"""Extract CHGCAR or LOCPOT from vaspwave.h5 without a packaged CLI."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from _lib.vaspwave import (
    SUPPORTED_KINDS,
    build_output_path,
    ensure_output_path,
    extract_from_vaspwave,
)


DESCRIPTION = "Extract CHGCAR or LOCPOT from vaspwave.h5."


def configure_parser(parser: argparse.ArgumentParser) -> argparse.ArgumentParser:
    parser.add_argument("input_h5", type=Path, help="Path to vaspwave.h5.")
    parser.add_argument(
        "--kind",
        "-k",
        required=True,
        choices=tuple(SUPPORTED_KINDS),
        help="Requested output kind.",
    )
    parser.add_argument(
        "--output",
        "-o",
        type=Path,
        help="Optional explicit output path. Defaults to INPUT directory / CHGCAR or LOCPOT.",
    )
    parser.add_argument(
        "--yes",
        "-y",
        action="store_true",
        help="Overwrite an existing non-empty output file.",
    )
    return parser


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=DESCRIPTION)
    return configure_parser(parser)


def run(args: argparse.Namespace) -> int:
    output_path = build_output_path(args.input_h5, args.kind, args.output)
    ensure_output_path(output_path, overwrite=args.yes)
    extract_from_vaspwave(args.input_h5, output_path, args.kind)
    print(output_path)
    return 0


def main(argv: list[str] | None = None) -> int:
    return run(build_parser().parse_args(argv))


if __name__ == "__main__":
    sys.exit(main())
