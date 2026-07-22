"""Stdlib-only helpers for summarizing VASP OUTCAR runs."""

from __future__ import annotations

import math
import re
from collections import Counter
from pathlib import Path


def parse_incar(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw_line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw_line.split("#", 1)[0].split("!", 1)[0].strip()
        if not line or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip().upper()] = value.strip()
    return values


def parse_float(value: str | None) -> float | None:
    if value is None:
        return None
    try:
        return float(value.replace("D", "E").replace("d", "e"))
    except ValueError:
        return None


def parse_int(value: str | None) -> int | None:
    parsed = parse_float(value)
    if parsed is None:
        return None
    return int(parsed)


def parse_potcar_titles(path: Path) -> list[str]:
    if not path.exists():
        return []
    titles: list[str] = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        if "TITEL" in line:
            titles.append(line.split("=", 1)[-1].strip())
    return titles


def parse_poscar(path: Path) -> dict[str, object] | None:
    if not path.exists():
        return None
    lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    if len(lines) < 8:
        return None
    species_tokens = lines[5].split()
    try:
        counts = [int(item) for item in lines[6].split()]
    except ValueError:
        return None

    selective = lines[7].strip().lower().startswith("s")
    coord_line = 8 if selective else 7
    start = coord_line + 1
    atom_count = sum(counts)
    flags: list[tuple[bool, bool, bool]] = []
    species: list[str] = []
    for label, count in zip(species_tokens, counts):
        species.extend([label] * count)
    for atom_index in range(atom_count):
        row_index = start + atom_index
        if row_index >= len(lines):
            break
        parts = lines[row_index].split()
        if len(parts) < 3:
            break
        if selective and len(parts) >= 6:
            flags.append(tuple(part.upper().startswith("T") for part in parts[3:6]))
        else:
            flags.append((True, True, True))
    formula_counts = Counter(species)
    formula = " ".join(f"{el}{formula_counts[el]}" for el in sorted(formula_counts))
    free_atoms = sum(1 for flag in flags if any(flag))
    fixed_atoms = len(flags) - free_atoms
    return {
        "species": species,
        "flags": flags,
        "formula": formula or "n/a",
        "atom_count": len(species),
        "free_atoms": free_atoms,
        "fixed_atoms": fixed_atoms,
    }


def parse_oszicar(path: Path) -> tuple[list[tuple[int, float, float, float]], list[int]]:
    ionic_steps: list[tuple[int, float, float, float]] = []
    electronic_counts: list[int] = []
    if not path.exists():
        return ionic_steps, electronic_counts
    current_electronic = 0
    pattern = re.compile(
        r"^\s*(\d+)\s+F=\s*([\-+0-9.EedD]+)\s+E0=\s*([\-+0-9.EedD]+)\s+d E =\s*([\-+0-9.EedD]+)"
    )
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        stripped = line.strip()
        if stripped.startswith(("DAV:", "RMM:", "DMP:", "CG:")):
            current_electronic += 1
        match = pattern.match(line)
        if match:
            ionic_steps.append(
                (
                    int(match.group(1)),
                    float(match.group(2).replace("D", "E").replace("d", "e")),
                    float(match.group(3).replace("D", "E").replace("d", "e")),
                    float(match.group(4).replace("D", "E").replace("d", "e")),
                )
            )
            electronic_counts.append(current_electronic)
            current_electronic = 0
    return ionic_steps, electronic_counts


def parse_outcar_forces(
    path: Path, flags: list[tuple[bool, bool, bool]]
) -> tuple[list[dict[str, float | int]], bool, bool, list[str]]:
    steps: list[dict[str, float | int]] = []
    reached_accuracy = False
    has_timing = False
    warnings: list[str] = []
    if not path.exists():
        return steps, reached_accuracy, has_timing, warnings

    lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    index = 0
    total_atoms = len(flags)
    warning_markers = (
        "WARNING",
        "Error",
        "BRMIX",
        "ZBRENT",
        "Sub-Space-Matrix is not hermitian",
        "grid Broyden might be small",
    )
    while index < len(lines):
        line = lines[index]
        if "reached required accuracy" in line or "stopping structural energy minimisation" in line:
            reached_accuracy = True
        if "General timing accounting informations" in line:
            has_timing = True
        if any(marker in line for marker in warning_markers):
            warnings.append(line.strip())
        if "POSITION" in line and "TOTAL-FORCE" in line:
            index += 2
            atom_index = 0
            max_all_norm = -1.0
            max_all_atom = -1
            max_free_component = -1.0
            max_free_component_atom = -1
            while index < len(lines):
                row = lines[index].split()
                if len(row) < 6:
                    break
                try:
                    fx, fy, fz = float(row[3]), float(row[4]), float(row[5])
                except ValueError:
                    break
                atom_index += 1
                norm = math.sqrt(fx * fx + fy * fy + fz * fz)
                if norm > max_all_norm:
                    max_all_norm = norm
                    max_all_atom = atom_index
                movable = flags[atom_index - 1] if atom_index - 1 < total_atoms else (True, True, True)
                free_components = [
                    abs(component)
                    for component, is_free in zip((fx, fy, fz), movable)
                    if is_free
                ]
                if free_components:
                    free_component = max(free_components)
                    if free_component > max_free_component:
                        max_free_component = free_component
                        max_free_component_atom = atom_index
                index += 1
            steps.append(
                {
                    "step": len(steps) + 1,
                    "max_all_norm": max_all_norm,
                    "max_all_atom": max_all_atom,
                    "max_free_component": max_free_component,
                    "max_free_component_atom": max_free_component_atom,
                }
            )
        index += 1
    return steps, reached_accuracy, has_timing, warnings


def section(title: str, rows: list[tuple[str, str]]) -> list[str]:
    lines = [f"## {title}", ""]
    if not rows:
        lines.append("- not available")
    else:
        for key, value in rows:
            lines.append(f"- {key}: {value}")
    lines.append("")
    return lines


def analyze_overall(outcar_path: Path) -> str:
    run_dir = outcar_path.resolve().parent
    incar = parse_incar(run_dir / "INCAR")
    poscar = parse_poscar(run_dir / "POSCAR")
    potcar_titles = parse_potcar_titles(run_dir / "POTCAR")
    ionic_steps, electronic_counts = parse_oszicar(run_dir / "OSZICAR")
    flags = list(poscar["flags"]) if poscar else []
    force_steps, reached_accuracy, has_timing, warnings = parse_outcar_forces(outcar_path, flags)

    nsw = parse_int(incar.get("NSW"))
    nelm = parse_int(incar.get("NELM"))
    ediff = parse_float(incar.get("EDIFF"))
    ediffg = parse_float(incar.get("EDIFFG"))
    stopped_by_nsw = bool(nsw is not None and ionic_steps and len(ionic_steps) >= nsw and not reached_accuracy)
    hit_nelm = bool(nelm is not None and any(count >= nelm for count in electronic_counts))

    overview_rows = [
        ("Run directory", str(run_dir)),
        ("General timing footer", "yes" if has_timing else "no"),
        ("Reached ionic accuracy", "yes" if reached_accuracy else "no"),
        ("Stopped by NSW", "yes" if stopped_by_nsw else "no"),
        ("Hit NELM", "yes" if hit_nelm else "no"),
        ("Ionic steps", f"{len(ionic_steps)}" + (f" / NSW {nsw}" if nsw is not None else "")),
    ]
    if ionic_steps:
        step, free_energy, e0, delta_e = ionic_steps[-1]
        overview_rows.extend(
            [
                ("Final OSZICAR step", str(step)),
                ("Final free energy F", f"{free_energy:.10f}"),
                ("Final E0", f"{e0:.10f}"),
                ("Final dE", f"{delta_e:.3e}"),
            ]
        )
    if nelm is not None:
        overview_rows.append(("NELM", str(nelm)))
    if ediff is not None:
        overview_rows.append(("EDIFF", f"{ediff:.3e}"))
    if ediffg is not None:
        overview_rows.append(("EDIFFG", f"{ediffg:.3e}"))

    structure_rows: list[tuple[str, str]] = []
    if poscar:
        structure_rows.extend(
            [
                ("Formula", str(poscar["formula"])),
                ("Atom count", str(poscar["atom_count"])),
                ("Free atoms", str(poscar["free_atoms"])),
                ("Fixed atoms", str(poscar["fixed_atoms"])),
            ]
        )
    if potcar_titles:
        structure_rows.append(("POTCAR entries", ", ".join(title.split()[-1] for title in potcar_titles)))

    force_rows: list[tuple[str, str]] = []
    if force_steps:
        last = force_steps[-1]
        force_rows.extend(
            [
                (
                    "Final max |F|",
                    f"{float(last['max_all_norm']):.4f} eV/A on atom {int(last['max_all_atom'])}",
                ),
                (
                    "Final max movable component",
                    f"{float(last['max_free_component']):.4f} eV/A on atom {int(last['max_free_component_atom'])}",
                ),
            ]
        )
        if ediffg is not None and ediffg < 0:
            threshold = abs(ediffg)
            meets = float(last["max_free_component"]) <= threshold
            force_rows.append(("EDIFFG force check", "pass" if meets else f"fail (> {threshold:.4f} eV/A)"))

    input_rows: list[tuple[str, str]] = []
    for key in ("ISPIN", "ENCUT", "LREAL", "ISMEAR", "SIGMA", "LASPH"):
        value = incar.get(key)
        if value is not None:
            input_rows.append((key, value))

    lines = ["# VASP overall summary", ""]
    lines.extend(section("Overview", overview_rows))
    lines.extend(section("Structure", structure_rows))
    lines.extend(section("Forces", force_rows))
    lines.extend(section("Input sanity", input_rows))
    if warnings:
        lines.extend(section("Warnings", [(str(index + 1), warning) for index, warning in enumerate(warnings[:20])]))
    return "\n".join(lines).rstrip() + "\n"
