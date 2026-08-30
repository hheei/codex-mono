# vasp-helper

This directory contains the actual Codex skill content for VASP work, plus standalone helper scripts.

The VASP source is kept in the private [`hheei/vasp-source`](https://github.com/hheei/vasp-source) submodule, not in the main plugin repository. After cloning, initialize it with:

```bash
git submodule update --init --recursive
```

## Use The Helper Scripts

Run the scripts from this directory either through the unified subcommand entrypoint or the existing direct entrypoints:

```bash
cd /path/to/atoms-plugin/skills/vasp-helper

# Unified entrypoint
python3 scripts/vasp_helper_cli.py outcar-analysis /path/to/OUTCAR
python3 scripts/vasp_helper_cli.py extract-vaspwave-grid /path/to/vaspwave.h5 --kind chgcar
python3 scripts/vasp_helper_cli.py clean-run-dir --help
python3 scripts/create_static_rerun.py /path/to/vasp-run

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

`create_static_rerun.py` creates the next `/path/to/vasp-run/rerunNNNN-static/`; a number used by any `rerunNNNN-*` directory is never reused. It detects non-empty `CHGCAR`, `TAUCAR`, `WAVECAR`, and `vaspwave.h5`; only `WAVECAR` and `CHGCAR` select automatic `ISTART` and `ICHARG` values. Restart inputs default to absolute softlinks. A file is copied only when the final INCAR will write it: `LCHARG` writes legacy `CHGCAR`/`TAUCAR` when `LH5` is false, `LWAVE` writes legacy `WAVECAR` when `LH5` is false, and `LH5` or `LCHARGH5` writes `vaspwave.h5`. It removes relaxation-only tags, preserves unrelated INCAR and Slurm settings, and supports repeatable generated-tag overrides such as `--set LVHAR=.TRUE. --set LCHARG=.FALSE.`.

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
- `source/` is the `hheei/vasp-source` submodule; branch-specific Graphify graphs live under its local `source/graphify-out/`
