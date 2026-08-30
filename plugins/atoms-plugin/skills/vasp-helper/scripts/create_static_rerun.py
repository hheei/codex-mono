#!/usr/bin/env python3
"""Create a non-destructive VASP static rerun under ``rerun-static``."""

from __future__ import annotations

import argparse
import re
import shutil
from pathlib import Path


STATIC_REMOVALS = {
    "EDIFFG",
    "ISIF",
    "POTIM",
    "NFREE",
    "SMASS",
    "MDALGO",
    "TEBEG",
    "TEEND",
    "NBLOCK",
    "KBLOCK",
    "ANDERSEN_PROB",
    "LANGEVIN_GAMMA",
    "LANGEVIN_GAMMA_L",
    "PMASS",
}


def _incar_values(lines: list[str]) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in lines:
        match = re.match(r"^\s*([A-Za-z][A-Za-z0-9_/-]*)\s*=\s*(.*?)(?:\s*!.*)?$", line.rstrip("\n"))
        if match:
            values[match.group(1).upper()] = match.group(2).strip()
    return values


def _is_true(value: str | None) -> bool:
    return value is not None and value.strip().upper() in {"T", ".T.", "TRUE", ".TRUE."}


def _restart_storage_mode(name: str, tags: dict[str, str]) -> str:
    lh5 = _is_true(tags.get("LH5"))
    if name == "CHGCAR":
        return "copy" if _is_true(tags.get("LCHARG")) and not lh5 else "link"
    if name == "TAUCAR":
        return "copy" if _is_true(tags.get("LTAU")) and not lh5 and not _is_true(tags.get("LCHARGH5")) else "link"
    if name == "WAVECAR":
        return "copy" if _is_true(tags.get("LWAVE")) and not lh5 else "link"
    if name == "vaspwave.h5":
        return "copy" if lh5 or _is_true(tags.get("LCHARGH5")) else "link"
    raise ValueError(f"unsupported restart file: {name}")


def _replace_incar(lines: list[str], replacements: dict[str, str]) -> list[str]:
    output: list[str] = []
    seen = set()
    for line in lines:
        match = re.match(r"^(\s*)([A-Za-z][A-Za-z0-9_/-]*)(\s*=\s*)(.*?)(\s*!.*)?$", line.rstrip("\n"))
        if not match:
            output.append(line)
            continue
        indent, key, separator, value, comment = match.groups()
        normalized = key.upper()
        if normalized in STATIC_REMOVALS and normalized not in replacements:
            continue
        if normalized in replacements:
            value = replacements[normalized]
            seen.add(normalized)
        output.append(f"{indent}{key}{separator}{value}{comment or ''}\n")

    for key, value in replacements.items():
        if key not in seen:
            output.append(f"{key} = {value}\n")
    return output


def _copy_job(source: Path, destination: Path, job_name: str) -> None:
    text = source.read_text()
    text, count = re.subn(r"(?m)^(\s*#SBATCH\s+--job-name=)[^\s]+", rf"\g<1>{job_name}", text, count=1)
    if count == 0:
        text = f"#SBATCH --job-name={job_name}\n{text}"
    destination.write_text(text)
    destination.chmod(source.stat().st_mode & 0o777)


def _find_job(source: Path, requested: str | None) -> Path:
    if requested:
        path = source / requested
        if not path.is_file():
            raise SystemExit(f"job script not found: {path}")
        return path
    for name in ("job.sh", "job.sbatch"):
        candidate = source / name
        if candidate.is_file():
            return candidate
    candidates = sorted(p for p in source.glob("*.sh") if p.is_file())
    if len(candidates) == 1:
        return candidates[0]
    raise SystemExit("could not choose a unique Slurm job script; use --job-script")


def _next_output(source: Path) -> Path:
    used = {
        int(match.group(1))
        for path in source.iterdir()
        if (match := re.match(r"^rerun(\d{4})-", path.name))
    }
    for index in range(1, 10_000):
        if index not in used:
            return source / f"rerun{index:04d}-static"
    raise SystemExit("no rerun index available")


def _parse_overrides(items: list[str]) -> dict[str, str]:
    result: dict[str, str] = {}
    for item in items:
        key, separator, value = item.partition("=")
        key = key.strip().upper()
        if not separator or not key or not re.fullmatch(r"[A-Z][A-Z0-9_/-]*", key):
            raise SystemExit(f"invalid --set value: {item!r}; expected KEY=VALUE")
        result[key] = value.strip()
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("vasp_directory", type=Path)
    parser.add_argument("--job-script", default=None, help="job script name inside VASP_DIRECTORY")
    parser.add_argument("--set", action="append", default=[], metavar="KEY=VALUE", help="override or add a generated INCAR tag")
    args = parser.parse_args()

    source = args.vasp_directory.resolve()
    if not source.is_dir():
        raise SystemExit(f"VASP directory not found: {source}")
    output = _next_output(source)

    structure = source / "CONTCAR" if (source / "CONTCAR").is_file() else source / "POSCAR"
    required = [source / "INCAR", source / "POTCAR", source / "KPOINTS", structure]
    missing = [str(path.name) for path in required if not path.is_file() or path.stat().st_size == 0]
    if missing:
        raise SystemExit(f"missing or empty required inputs: {', '.join(missing)}")
    job = _find_job(source, args.job_script)
    restart_files = [
        name
        for name in ("CHGCAR", "TAUCAR", "WAVECAR", "vaspwave.h5")
        if (source / name).is_file() and (source / name).stat().st_size > 0
    ]
    replacements = {
        "NSW": "0",
        "IBRION": "-1",
        "PLUGINS/STRUCTURE": ".FALSE.",
        "ISTART": "1" if "WAVECAR" in restart_files else "0",
        "ICHARG": "1" if "CHGCAR" in restart_files else "2",
    }
    replacements.update(_parse_overrides(args.set))
    incar_lines = _replace_incar((source / "INCAR").read_text().splitlines(keepends=True), replacements)
    tags = _incar_values(incar_lines)
    restart_modes = {name: _restart_storage_mode(name, tags) for name in restart_files}

    output.mkdir(parents=False)
    try:
        (output / "INCAR").write_text("".join(incar_lines))
        shutil.copy2(source / "POTCAR", output / "POTCAR")
        shutil.copy2(source / "KPOINTS", output / "KPOINTS")
        shutil.copy2(structure, output / structure.name)
        if structure.name == "CONTCAR":
            (output / "POSCAR").symlink_to("CONTCAR")
        for name in restart_files:
            destination = output / name
            if restart_modes[name] == "copy":
                shutil.copy2(source / name, destination)
            else:
                destination.symlink_to(source / name)
        _copy_job(job, output / "job.sh", output.name)
    except Exception:
        shutil.rmtree(output)
        raise

    print(f"OUTPUT_DIRECTORY={output}")
    print(f"DETECTED_FILES={','.join(restart_files) if restart_files else 'none'}")
    print(f"RESTART_LINKS={','.join(name for name in restart_files if restart_modes[name] == 'link') or 'none'}")
    print(f"RESTART_COPIES={','.join(name for name in restart_files if restart_modes[name] == 'copy') or 'none'}")
    print(f"STATIC_CHANGES={','.join(f'{key}={value}' for key, value in replacements.items())}")
    print("SBATCH_FILE=job.sh")


if __name__ == "__main__":
    main()
