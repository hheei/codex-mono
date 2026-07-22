#!/usr/bin/env python3
"""Automate differential charge-density workflow for VASP CHGCAR grids.

Workflow:
1) Build differential CHGCAR with numpy + pymatgen
2) Convert differential CHGCAR to XSF without modifying its title
3) Write a grid_diff.txt metadata file
4) Archive XSF into <grid_name>_diff.tar.zst by default and remove plain XSF
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

try:
    import numpy as np
    from pymatgen.io.vasp.outputs import Chgcar, VolumetricData
except ModuleNotFoundError as exc:
    np = None
    Chgcar = None
    VolumetricData = None
    IMPORT_ERROR = exc
else:
    IMPORT_ERROR = None

from _lib.process import run_checked


def _require_runtime_dependencies() -> None:
    if IMPORT_ERROR is not None:
        raise SystemExit(
            "Missing runtime dependency for grid-diff-analysis: "
            f"{IMPORT_ERROR.name}. Install numpy and pymatgen to use this command."
        )


DESCRIPTION = "Run full differential-grid analysis workflow."


def configure_parser(parser: argparse.ArgumentParser) -> argparse.ArgumentParser:
    parser.add_argument("--run-dir", default=".", help="Current system run directory.")
    parser.add_argument("--ref-dir", required=True, help="Reference system run directory.")
    parser.add_argument("--chg-file", default="CHGCAR", help="Grid filename in both directories (default: CHGCAR).")
    parser.add_argument("--output-prefix", default="CHGCAR_diff", help="Output base filename (no extension).")
    parser.add_argument("--info-name", default="grid_diff.txt", help="Metadata output filename.")
    parser.add_argument("--no-xsf", action="store_true", help="Skip XSF conversion.")
    parser.add_argument(
        "--archive-zst",
        dest="archive_zst",
        action="store_true",
        help="Archive XSF to <name>.tar.zst using tar+zstd (default: enabled).",
    )
    parser.add_argument(
        "--no-archive-zst",
        dest="archive_zst",
        action="store_false",
        help="Disable tar+zstd archive generation and keep plain XSF.",
    )
    parser.set_defaults(archive_zst=True)
    parser.add_argument("--zstd-threads", type=int, default=6, help="zstd thread count for archive generation.")
    return parser


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=DESCRIPTION)
    return configure_parser(parser)


def run(args: argparse.Namespace) -> int:
    _require_runtime_dependencies()
    run_dir = Path(args.run_dir).expanduser().resolve()
    ref_dir = Path(args.ref_dir).expanduser().resolve()

    current_chg = run_dir / args.chg_file
    ref_chg = ref_dir / args.chg_file
    if not current_chg.exists():
        raise SystemExit(f"Current grid file not found: {current_chg}")
    if not ref_chg.exists():
        raise SystemExit(f"Reference grid file not found: {ref_chg}")

    diff_path = run_dir / args.output_prefix
    build_differential_chgcar(current_chg, ref_chg, diff_path)

    print(f"Differential grid: {diff_path}")

    xsf_path = run_dir / f"{args.output_prefix}.xsf"
    values_read = 0
    values_written = 0
    values_expected = 0
    padded = False
    if not args.no_xsf:
        values_read, values_written, values_expected, padded = chgcar_to_xsf(diff_path, xsf_path)
        print(f"XSF written: {xsf_path}")

    poscar_diff, _data_diff, _data_aug_diff = VolumetricData.parse_file(str(diff_path))
    natoms = len(poscar_diff.structure)
    info_path = run_dir / args.info_name
    write_info_file(
        info_path,
        run_dir,
        ref_dir,
        args.chg_file,
        natoms,
        diff_path,
        xsf_path,
        values_read,
        values_written,
        values_expected,
        padded,
    )
    print(f"Info written: {info_path}")

    if args.archive_zst:
        if args.no_xsf:
            raise SystemExit("--archive-zst requires XSF output; remove --no-xsf")
        archive_path = run_dir / f"{args.output_prefix}.tar.zst"
        run_checked(["tar", "-I", f"zstd -T{args.zstd_threads}", "-cf", str(archive_path), xsf_path.name], cwd=run_dir)
        print(f"Archive written: {archive_path}")
        if xsf_path.exists():
            xsf_path.unlink()
            print(f"Removed: {xsf_path}")

    return 0




def _pick_grid_data(data: dict[str, np.ndarray], source_name: str) -> tuple[str, np.ndarray]:
    if not data:
        raise RuntimeError(f"No volumetric data found in {source_name}")
    if "total" in data:
        return "total", np.asarray(data["total"])
    first_key = next(iter(data))
    return first_key, np.asarray(data[first_key])


def build_differential_chgcar(current_path: Path, ref_path: Path, diff_path: Path) -> None:
    poscar_this, data_this, data_aug_this = VolumetricData.parse_file(str(current_path))
    poscar_ref, data_ref, data_aug_ref = VolumetricData.parse_file(str(ref_path))

    _this_key, grid_this = _pick_grid_data(data_this, str(current_path))
    _ref_key, grid_ref = _pick_grid_data(data_ref, str(ref_path))

    if grid_this.shape != grid_ref.shape:
        raise RuntimeError(f"Grid shape mismatch: this={grid_this.shape}, ref={grid_ref.shape}")

    lat_this = np.asarray(poscar_this.structure.lattice.matrix)
    lat_ref = np.asarray(poscar_ref.structure.lattice.matrix)
    if not np.allclose(lat_this, lat_ref, atol=1e-8):
        raise RuntimeError("Lattice mismatch between current and reference CHGCAR")

    diff_grid = grid_this - grid_ref

    diff_aug: dict[str, np.ndarray] = {}
    for key in set(data_aug_this) & set(data_aug_ref):
        arr_this = np.asarray(data_aug_this[key])
        arr_ref = np.asarray(data_aug_ref[key])
        if arr_this.shape == arr_ref.shape:
            diff_aug[key] = arr_this - arr_ref

    chgcar_diff = Chgcar(poscar_this, {"total": diff_grid}, data_aug=diff_aug or None)
    chgcar_diff.write_file(str(diff_path))


def chgcar_to_xsf(in_path: Path, out_path: Path) -> tuple[int, int, int, bool]:
    with in_path.open("r", encoding="utf-8", errors="replace") as fin:
        title = fin.readline().rstrip("\n") or in_path.name

    poscar, data, _data_aug = VolumetricData.parse_file(str(in_path))
    structure = poscar.structure
    lattice = structure.lattice.matrix
    natoms = len(structure)

    grid = data.get("total")
    if grid is None:
        if not data:
            raise RuntimeError(f"No volumetric data found in {in_path}")
        first_key = next(iter(data))
        grid = data[first_key]

    nx, ny, nz = grid.shape
    ngrid = nx * ny * nz
    values = grid.ravel(order="F")

    values_per_line = 6
    with out_path.open("w", encoding="utf-8") as fout:
        fout.write("CRYSTAL\n")
        fout.write("PRIMVEC\n")
        for vec in lattice:
            fout.write(f"{vec[0]:.14f} {vec[1]:.14f} {vec[2]:.14f}\n")
        fout.write("PRIMCOORD\n")
        fout.write(f"{natoms} 1\n")
        for site in structure:
            z = int(getattr(site.specie, "Z", 0) or 0)
            x, y, zc = site.coords
            fout.write(f"{z:3d} {x:.14f} {y:.14f} {zc:.14f}\n")

        fout.write("BEGIN_BLOCK_DATAGRID_3D\n")
        fout.write(f"  {title}\n")
        fout.write("  DATAGRID_3D_UNKNOWN\n")
        fout.write(f"    {nx} {ny} {nz}\n")
        fout.write("    0.0 0.0 0.0\n")
        for vec in lattice:
            fout.write(f"    {vec[0]:.14f} {vec[1]:.14f} {vec[2]:.14f}\n")

        line_vals: list[str] = []
        for val in values:
            line_vals.append(f"{float(val):.11e}")
            if len(line_vals) == values_per_line:
                fout.write("    " + " ".join(line_vals) + "\n")
                line_vals = []
        if line_vals:
            fout.write("    " + " ".join(line_vals) + "\n")

        fout.write("  END_DATAGRID_3D\n")
        fout.write("END_BLOCK_DATAGRID_3D\n")

    raw_read = ngrid
    written = ngrid
    padded = False
    return raw_read, written, ngrid, padded


def write_info_file(
    info_path: Path,
    run_dir: Path,
    ref_dir: Path,
    chg_file: str,
    natoms: int,
    diff_path: Path,
    xsf_path: Path,
    values_read: int,
    values_written: int,
    values_expected: int,
    padded: bool,
) -> None:
    with info_path.open("w", encoding="utf-8") as fout:
        fout.write("Grid Diff Analysis\n")
        fout.write("==================\n\n")
        fout.write(f"this = {run_dir}\n")
        fout.write(f"ref  = {ref_dir}\n")
        fout.write(f"grid_name = {chg_file}\n")
        fout.write(f"atom_count = {natoms}\n")
        fout.write(f"differential_grid = {diff_path}\n")
        fout.write(f"xsf = {xsf_path}\n")
        fout.write(f"grid_points_read = {values_read}\n")
        fout.write(f"grid_points_written = {values_written}\n")
        fout.write(f"grid_points_expected = {values_expected}\n")
        fout.write(f"grid_points_padded = {str(padded).lower()}\n")


def main(argv: list[str] | None = None) -> int:
    return run(build_parser().parse_args(argv))


if __name__ == "__main__":
    raise SystemExit(main())
