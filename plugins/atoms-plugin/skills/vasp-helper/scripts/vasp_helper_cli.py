#!/usr/bin/env python3
"""Unified argparse entrypoint for vasp-helper standalone scripts."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))


COMMAND_SPECS = [
    ("outcar-analysis", "outcar_analysis_cli", "Write a high-level summary for one VASP OUTCAR."),
    ("extract-vaspwave-grid", "extract_vaspwave_grid", "Extract CHGCAR or LOCPOT from vaspwave.h5."),
    ("clean-run-dir", "clean_vasp_run_dir", "Clean VASP runtime files from directories."),
    ("bader-analysis", "bader_analysis_cli", "Run Bader analysis and write merged outputs."),
    ("grid-diff-analysis", "grid_diff_analysis_cli", "Run full differential-grid analysis workflow."),
    ("planar-average-plot", "planar_average_plot", "Compute planar-averaged VASP grid data and plot coord vs value."),
    ("vasp-wiki", "vasp_wiki_cli", "Print VASP wiki pages as markdown, using assets/vasp-wiki as cache."),
]


def _load_module(module_name: str):
    __import__(module_name)
    return sys.modules[module_name]


def build_parser(selected_command: str | None = None) -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Unified entrypoint for vasp-helper helper scripts.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    for name, module_name, help_text in COMMAND_SPECS:
        subparser = subparsers.add_parser(name, help=help_text, description=help_text)
        if selected_command == name:
            module = _load_module(module_name)
            module.configure_parser(subparser)
            subparser.set_defaults(_runner=module.run)

    return parser


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    selected_command = None
    if argv and not argv[0].startswith("-"):
        selected_command = argv[0]
    args = build_parser(selected_command).parse_args(argv)
    if not hasattr(args, "_runner"):
        raise SystemExit(f"Command `{args.command}` is unavailable in this environment or missing parser wiring.")
    return args._runner(args)


if __name__ == "__main__":
    raise SystemExit(main())
