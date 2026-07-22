"""Helpers for extracting volumetric data from vaspwave.h5."""

from __future__ import annotations

from pathlib import Path


SUPPORTED_KINDS = {"chgcar": "CHGCAR", "locpot": "LOCPOT", "taucar": "TAUCAR"}


def build_output_path(input_h5: Path, kind: str, output: Path | None) -> Path:
    if output is not None:
        return output
    return input_h5.resolve().parent / SUPPORTED_KINDS[kind]


def ensure_output_path(path: Path, overwrite: bool) -> None:
    if path.exists() and path.is_dir():
        raise SystemExit(f"output path `{path}` is a directory")
    if path.exists() and path.stat().st_size > 0 and not overwrite:
        raise SystemExit(
            f"output `{path}` already exists and is non-empty; rerun with `--yes` to overwrite"
        )
    path.parent.mkdir(parents=True, exist_ok=True)


def load_vaspwave(input_h5: Path):
    try:
        from pymatgen.io.vasp.outputs import Vaspwave
    except ImportError as exc:
        raise SystemExit(
            "pymatgen is required for vaspwave.h5 extraction. "
            "Install it in the Python environment used for this script."
        ) from exc

    try:
        return Vaspwave(input_h5)
    except Exception as exc:  # pragma: no cover
        raise SystemExit(f"failed to load `{input_h5}`: {exc}") from exc


def extract_from_vaspwave(input_h5: Path, output_path: Path, kind: str) -> None:
    if not input_h5.is_file():
        raise SystemExit(f"input file `{input_h5}` does not exist")
    if kind == "taucar":
        raise SystemExit(
            "TAUCAR extraction is not available: "
            "pymatgen.io.vasp.outputs.Vaspwave currently exposes CHGCAR and LOCPOT only"
        )
    vaspwave = load_vaspwave(input_h5)
    grid = vaspwave.get_chgcar() if kind == "chgcar" else vaspwave.get_locpot()
    grid.write_file(output_path)
