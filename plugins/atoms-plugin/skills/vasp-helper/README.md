# vasp-helper

This directory contains the actual Codex skill content for VASP work, plus standalone helper scripts.

## Use The Helper Scripts

Run the scripts from this directory either through the unified subcommand entrypoint or the existing direct entrypoints:

```bash
cd /path/to/atoms-plugin/skills/vasp-helper

# Unified entrypoint
python3 scripts/vasp_helper_cli.py outcar-analysis /path/to/OUTCAR
python3 scripts/vasp_helper_cli.py extract-vaspwave-grid /path/to/vaspwave.h5 --kind chgcar
python3 scripts/vasp_helper_cli.py clean-run-dir --help

# Existing direct entrypoints still work
python3 scripts/outcar_analysis_cli.py /path/to/OUTCAR
python3 scripts/extract_vaspwave_grid.py /path/to/vaspwave.h5 --kind chgcar
```

Available unified subcommands:

- `outcar-analysis`
- `extract-vaspwave-grid`
- `clean-run-dir`
- `bader-analysis`
- `grid-diff-analysis`
- `planar-average-plot`
- `vasp-wiki`

These CLIs bootstrap the skill-local `scripts/_lib` package automatically, so you do not need to install this repository as a Python package before running them.

Dependency notes:

- `scripts/outcar_analysis_cli.py` uses only the Python standard library.
- `scripts/extract_vaspwave_grid.py` requires `pymatgen`.
- `scripts/bader_analysis_cli.py` requires `numpy` and `ase`.
- `scripts/grid_diff_analysis_cli.py` requires `numpy` and `pymatgen`.
- `scripts/planar_average_plot.py` requires `numpy` and `matplotlib`.
## Layout

- `SKILL.md` is the canonical skill entrypoint
- `references/` contains general VASP knowledge pages
- `projects/` contains project-specific overlays
- `scripts/` contains standalone helper scripts
- `source/` contains the bundled VASP source; branch-specific Graphify graphs live under `source/graphify-out/`
