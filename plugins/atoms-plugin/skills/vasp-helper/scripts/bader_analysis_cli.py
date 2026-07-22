#!/usr/bin/env python3
"""Run a VASP Bader workflow and write merged outputs.

The CLI:
- builds CHGCAR_sum from AECCAR0 + AECCAR2
- runs bader CHGCAR -ref CHGCAR_sum
- reads and writes structure data with ASE in extxyz format
- writes bader.xyz from POSCAR coordinates and ACF.dat charges
- writes bader.txt with totals, per-element stats, and per-atom rows
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from statistics import mean

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

try:
    import numpy as np
    from ase.io import read as ase_read
    from ase.io import write as ase_write
except ModuleNotFoundError as exc:
    np = None
    ase_read = None
    ase_write = None
    IMPORT_ERROR = exc
else:
    IMPORT_ERROR = None

from _lib.process import run_checked


def _require_runtime_dependencies() -> None:
    if IMPORT_ERROR is not None:
        raise SystemExit(
            "Missing runtime dependency for bader-analysis: "
            f"{IMPORT_ERROR.name}. Install numpy and ase to use this command."
        )


DESCRIPTION = "Run Bader analysis and write merged outputs."


def configure_parser(parser: argparse.ArgumentParser) -> argparse.ArgumentParser:
    parser.add_argument("--run-dir", default=".", help="VASP run directory containing POSCAR and charge files.")
    parser.add_argument(
        "--compare-dir",
        default=None,
        help="Optional already-analyzed directory to compare against using its bader.xyz file.",
    )
    parser.add_argument("--bader-bin", default="bader", help="Path to the bader executable.")
    parser.add_argument(
        "--chgsum-bin",
        default="chgsum.pl",
        help="Path to chgsum.pl. If the path ends with .pl, it is invoked via perl.",
    )
    parser.add_argument("--xyz-name", default="bader.xyz", help="Output extxyz filename.")
    parser.add_argument("--report-name", default="bader.txt", help="Output report filename.")
    parser.add_argument("--skip-analysis", action="store_true", help="Skip chgsum and bader; only rebuild merged outputs.")
    return parser


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=DESCRIPTION)
    return configure_parser(parser)


def run(args: argparse.Namespace) -> int:
    _require_runtime_dependencies()
    run_dir = Path(args.run_dir).expanduser().resolve()
    contcar = run_dir / "CONTCAR"
    poscar = run_dir / "POSCAR"
    potcar = run_dir / "POTCAR"
    chgcar = run_dir / "CHGCAR"
    aeccar0 = run_dir / "AECCAR0"
    aeccar2 = run_dir / "AECCAR2"
    acf = run_dir / "ACF.dat"
    chgcar_sum = run_dir / "CHGCAR_sum"

    for path in [poscar, potcar, chgcar, aeccar0, aeccar2]:
        if not path.exists():
            raise SystemExit(f"Missing required input: {path}")

    if not args.skip_analysis:
        chgsum_cmd = [args.chgsum_bin, "AECCAR0", "AECCAR2"]
        if args.chgsum_bin.endswith(".pl"):
            chgsum_cmd = ["perl", args.chgsum_bin, "AECCAR0", "AECCAR2"]
        run_checked(chgsum_cmd, cwd=run_dir)
        if not chgcar_sum.exists():
            raise SystemExit("CHGCAR_sum was not created")
        run_checked([args.bader_bin, "CHGCAR", "-ref", "CHGCAR_sum"], cwd=run_dir)

    if not acf.exists():
        raise SystemExit("ACF.dat not found; run analysis first or omit --skip-analysis")

    structure_path = contcar if contcar.exists() else poscar
    atoms = ase_read(structure_path)
    atoms.info["structure_source_path"] = str(structure_path)
    atoms.info["source_path"] = str(structure_path)
    atoms.constraints = []
    if "momenta" in atoms.arrays:
        del atoms.arrays["momenta"]
    symbols = list(dict.fromkeys(atoms.get_chemical_symbols()))
    counts = [atoms.get_chemical_symbols().count(symbol) for symbol in symbols]
    charges, vacuum_charge, electrons = read_acf(acf)
    if len(charges) != sum(counts):
        raise SystemExit(f"Atom count mismatch: POSCAR={sum(counts)}, ACF={len(charges)}")

    zvals_raw = read_zvals(potcar)
    zval_map: dict[str, float] = {}
    if len(zvals_raw) == len(symbols):
        zval_map = dict(zip(symbols, zvals_raw))

    chemical_symbols = atoms.get_chemical_symbols()
    bader_charges = np.asarray([charges[index] for index in range(1, len(chemical_symbols) + 1)], dtype=float)
    atoms.new_array("bader_charge", bader_charges)
    bader_net_charge = np.asarray(
        [zval_map[symbol] - charge if symbol in zval_map else np.nan for symbol, charge in zip(chemical_symbols, bader_charges)],
        dtype=float,
    )
    atoms.new_array("bader_net_charge", bader_net_charge)

    compare_atoms = None
    if args.compare_dir:
        compare_dir = Path(args.compare_dir).expanduser().resolve()
        compare_xyz = compare_dir / args.xyz_name
        if not compare_xyz.exists():
            raise SystemExit(f"Comparison bader.xyz not found: {compare_xyz}")
        compare_atoms = ase_read(compare_xyz)
        compare_atoms.info["source_path"] = str(compare_xyz)
        compare_charges = np.asarray(compare_atoms.get_array("bader_charge"), dtype=float)
        if len(compare_charges) != len(bader_charges):
            raise SystemExit(f"Comparison atom count mismatch: {len(bader_charges)} vs {len(compare_charges)}")
        compare_symbols = compare_atoms.get_chemical_symbols()
        if compare_symbols != chemical_symbols:
            raise SystemExit("Comparison element order mismatch between current and compare structures")
        atoms.new_array("bader_compare", compare_charges)
        atoms.new_array("bader_delta", bader_charges - compare_charges)

    xyz_path = run_dir / args.xyz_name
    write_xyz(xyz_path, atoms)
    atoms.info["source_path"] = str(xyz_path)
    write_report(run_dir / args.report_name, atoms, vacuum_charge, electrons, [zval_map[s] for s in symbols] if zval_map else [])

    if compare_atoms is not None:
        diff_dat = run_dir / "bader_diff.dat"
        diff_report = run_dir / "bader_diff.txt"
        write_diff_outputs(atoms, compare_atoms, diff_dat, diff_report)
        print(f"Wrote {diff_dat.name}")
        print(f"Wrote {diff_report.name}")

    print(f"Wrote {args.xyz_name}")
    print(f"Wrote {args.report_name}")
    return 0


def read_acf(acf: Path) -> tuple[dict[int, float], float | None, float | None]:
    charges: dict[int, float] = {}
    vacuum_charge = None
    electrons = None
    for line in acf.read_text(encoding="utf-8").splitlines():
        if "VACUUM CHARGE" in line:
            vacuum_charge = float(line.split(":", 1)[1])
            continue
        if "NUMBER OF ELECTRONS" in line:
            electrons = float(line.split(":", 1)[1])
            continue
        parts = line.split()
        if len(parts) >= 5 and parts[0].isdigit():
            charges[int(parts[0])] = float(parts[4])
    return charges, vacuum_charge, electrons


def read_zvals(potcar: Path) -> list[float]:
    zvals: list[float] = []
    pattern = re.compile(r"ZVAL\s*=\s*([0-9.+-Ee]+)")
    for line in potcar.read_text(encoding="utf-8", errors="replace").splitlines():
        match = pattern.search(line)
        if match:
            zvals.append(float(match.group(1)))
    return zvals


def write_xyz(xyz: Path, atoms) -> None:
    atoms.info["source"] = "POSCAR+ACF.dat"
    ase_write(xyz, atoms, format="extxyz")


def write_report(
    report: Path,
    atoms,
    vacuum_charge: float | None,
    electrons: float | None,
    zvals: dict[str, float],
) -> None:
    elements: list[str] = []
    for symbol in atoms.get_chemical_symbols():
        if symbol not in elements:
            elements.append(symbol)

    element_stats: dict[str, list[int]] = {}
    symbols = atoms.get_chemical_symbols()
    positions = atoms.get_positions()
    charges = atoms.get_array("bader_charge")
    net_charges = atoms.get_array("bader_net_charge") if "bader_net_charge" in atoms.arrays else None
    for index, symbol in enumerate(symbols):
        element_stats.setdefault(symbol, []).append(index)

    total_bader = float(charges.sum())
    atom_rows = [
        (index + 1, symbols[index], positions[index][0], positions[index][1], positions[index][2], float(charges[index]))
        for index in range(len(symbols))
    ]
    top_high = sorted(atom_rows, key=lambda row: row[5], reverse=True)[:10]
    top_low = sorted(atom_rows, key=lambda row: row[5])[:10]

    with report.open("w", encoding="utf-8") as handle:
        handle.write("Bader Analysis Report\n")
        handle.write("=====================\n\n")
        structure_source = atoms.info.get("structure_source_path", atoms.info.get("source_path", "structure"))
        handle.write(f"Source files: {Path(structure_source).name} + ACF.dat\n")
        handle.write(f"Total atoms: {len(atoms)}\n")
        if vacuum_charge is not None:
            handle.write(f"Vacuum charge: {vacuum_charge:.4f}\n")
        if electrons is not None:
            handle.write(f"Number of electrons: {electrons:.5f}\n")
            handle.write(f"Sum of Bader charges: {total_bader:.6f}\n")
            handle.write(f"Delta(sum-NELECT): {total_bader - electrons:+.6e}\n")
        handle.write("\n")

        handle.write("Element-wise summary\n")
        handle.write("Element  Count  Mean        Min         Max\n")
        for element in elements:
            subset = element_stats[element]
            element_charges = [float(charges[i]) for i in subset]
            handle.write(
                f"{element:<6} {len(subset):>5}  {mean(element_charges):>10.6f}  "
                f"{min(element_charges):>10.6f}  {max(element_charges):>10.6f}\n"
            )

        if zvals and len(zvals) == len(elements):
            handle.write("\nValence-derived net charge summary\n")
            handle.write("Element  ZVAL  MeanNetCharge\n")
            for element, zval in zip(elements, zvals):
                subset = element_stats[element]
                net_vals = [zval - float(charges[i]) for i in subset]
                handle.write(f"{element:<6} {zval:>5.1f}  {mean(net_vals):>13.6f}\n")

        handle.write("\nTop 10 highest Bader charges\n")
        handle.write("Index  Element  Charge\n")
        for index, element, _, _, _, charge in top_high:
            handle.write(f"{index:>5}  {element:>7}  {charge:>10.6f}\n")

        handle.write("\nTop 10 lowest Bader charges\n")
        handle.write("Index  Element  Charge\n")
        for index, element, _, _, _, charge in top_low:
            handle.write(f"{index:>5}  {element:>7}  {charge:>10.6f}\n")

        handle.write("\nAll atoms\n")
        handle.write("Index  Element        x(Ang)         y(Ang)         z(Ang)      q_bader      q_net\n")
        for index, element, x, y, z, charge in atom_rows:
            q_net = float(net_charges[index - 1]) if net_charges is not None else float("nan")
            handle.write(
                f"{index:>5}  {element:>7}  {x:>13.6f}  {y:>13.6f}  {z:>13.6f}  "
                f"{charge:>10.6f}  {q_net:>10.6f}\n"
            )


def write_diff_outputs(current_atoms, compare_atoms, diff_csv: Path, diff_report: Path) -> None:
    current_symbols = current_atoms.get_chemical_symbols()
    compare_symbols = compare_atoms.get_chemical_symbols()
    if len(current_symbols) != len(compare_symbols):
        raise SystemExit(f"Comparison atom count mismatch: {len(current_symbols)} vs {len(compare_symbols)}")
    for index, (current_symbol, compare_symbol) in enumerate(zip(current_symbols, compare_symbols), start=1):
        if current_symbol != compare_symbol:
            raise SystemExit(f"Comparison element mismatch at atom {index}: {current_symbol} vs {compare_symbol}")

    current_charges = np.asarray(current_atoms.get_array("bader_charge"), dtype=float)
    compare_charges = np.asarray(compare_atoms.get_array("bader_charge"), dtype=float)
    delta_q = current_charges - compare_charges

    diff_csv.parent.mkdir(parents=True, exist_ok=True)
    diff_report.parent.mkdir(parents=True, exist_ok=True)

    with diff_csv.open("w", encoding="utf-8") as handle:
        handle.write("# index element q_current q_compare delta_q\n")
        for index, symbol in enumerate(current_symbols, start=1):
            handle.write(
                f"{index:>5} {symbol:>2} {current_charges[index - 1]:>12.6f} {compare_charges[index - 1]:>12.6f} {delta_q[index - 1]:>+12.6f}\n"
            )

    unique_symbols: list[str] = []
    for symbol in current_symbols:
        if symbol not in unique_symbols:
            unique_symbols.append(symbol)

    top_positive = np.argsort(delta_q)[::-1][:10]
    top_negative = np.argsort(delta_q)[:10]
    current_path = current_atoms.info.get("source_path", "current")
    compare_path = compare_atoms.info.get("source_path", "compare")

    with diff_report.open("w", encoding="utf-8") as handle:
        handle.write("Differential Bader Charge Report\n")
        handle.write("================================\n\n")
        handle.write(f"Current file: {current_path}\n")
        handle.write(f"Compare file: {compare_path}\n")
        handle.write("Definition: delta_q = q(current) - q(compare)\n")
        handle.write(f"Atom count: {len(delta_q)}\n\n")
        handle.write("Global statistics of delta_q\n")
        handle.write(f"  mean: {delta_q.mean():+.6f}\n")
        handle.write(f"  std : {delta_q.std(ddof=0):.6f}\n")
        handle.write(f"  min : {delta_q.min():+.6f}\n")
        handle.write(f"  max : {delta_q.max():+.6f}\n\n")

        handle.write("Top 10 positive delta_q\n")
        handle.write("index  element  delta_q\n")
        for index in top_positive:
            handle.write(f"{index + 1:>5}  {current_symbols[index]:>7}  {delta_q[index]:+10.6f}\n")

        handle.write("\nTop 10 negative delta_q\n")
        handle.write("index  element  delta_q\n")
        for index in top_negative:
            handle.write(f"{index + 1:>5}  {current_symbols[index]:>7}  {delta_q[index]:+10.6f}\n")

        handle.write("\nPer-element statistics\n")
        handle.write("element  count  mean      min       max\n")
        current_symbol_array = np.asarray(current_symbols)
        for symbol in unique_symbols:
            values = delta_q[current_symbol_array == symbol]
            handle.write(f"{symbol:>7}  {len(values):>5}  {values.mean():+8.6f}  {values.min():+8.6f}  {values.max():+8.6f}\n")


def main(argv: list[str] | None = None) -> int:
    return run(build_parser().parse_args(argv))


if __name__ == "__main__":
    raise SystemExit(main())