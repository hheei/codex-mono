# Direct `ppafm` from VASP

Use this path when exact parity with native `ppafm` matters more than wrapper convenience.

For a remote calculation, prepare and submit the commands through [remote-execution.md](remote-execution.md). The commands below define the physical workflow; they are not permission to run a production scan on the login node or overwrite an existing result.

## Inputs

Typical sample inputs:

- `CONTCAR`
- `CHGCAR`
- `CHGCAR.gz`
- `CHGCAR.xz`
- `LOCPOT`
- `LOCPOT.gz`
- `LOCPOT.xz`
- `vaspwave.h5`
- local `atomtypes.ini`

Typical tip inputs:

- tip `CHGCAR` for density-based Pauli
- built-in tip model such as `dz2` for electrostatics

## Execution Route

Preferred CLI route:

```bash
uvx --from ppafm <command> ...
```

If the current project pins an incompatible Python version, bypass the project environment:

```bash
uv run --no-project --with ppafm --with h5py --with numpy --with scipy python helper.py
uv tool run --from ppafm ppafm-relaxed-scan -f npy --pos
```

If you need a local environment for helper scripts:

```bash
uv venv .venv
uv pip install --python .venv/bin/python ppafm h5py numpy scipy click git+https://github.com/materialsproject/pymatgen-core.git
```

Skill-local helper scripts:

- `scripts/generate_elff.py`
- `scripts/generate_dftd3.py`
- `scripts/generate_pauli.py`
- `scripts/generate_linear_drho_tip.py`

## Native Force-Field Branches

### `LJ + Hartree`

Total force used in relax is:

`FFtot = charge * FFel + FFLJ`

Typical commands:

```bash
uvx --from ppafm ppafm-generate-ljff -i sample_for_lj.xsf -F xsf -f npy
uvx --from ppafm ppafm-generate-elff -i LOCPOT.sample.xsf -F xsf -f npy --tip dz2 --sigma 0.71
uvx --from ppafm ppafm-relaxed-scan -f npy --pos
```

### `vdW + Pauli + Hartree`

With `--noLJ`, total force is:

`FFtot = charge * FFel + FFvdW + Apauli * FFpauli`

Typical commands:

```bash
uvx --from ppafm ppafm-generate-dftd3 -i LOCPOT.sample.xsf -F xsf -f npy --df_name PBE
uvx --from ppafm ppafm-conv-rho -s CHGCAR.sample.xsf -t rhoTip.xsf -o pauli -f npy -A 1.0 -B 1.2 --density_cutoff 100.0
uvx --from ppafm ppafm-generate-elff -i LOCPOT.sample.xsf -F xsf -f npy --tip dz2 --sigma 0.71
uvx --from ppafm ppafm-relaxed-scan --noLJ --Apauli 12.0 -f npy --pos
```

Then plot `df`:

```bash
uvx --from ppafm ppafm-plot-results -f npy --df --save_df --cbar
```

## Array and Grid Contract

- `ppafm` internal array handling is `zyx`.
- Saved vector fields in `.npz` should be treated as `(nz, ny, nx, 3)`.
- `gridN` concepts are often written in `xyz`, but the actual volumetric arrays and XSF payloads are `zyx`.
- If you downsample a VASP volumetric grid for tractable FFTs, keep `lvec` unchanged and set `params.ini` `gridN` to the downsampled dimensions in `xyz` order. For example, a downsampled scalar array `(nz, ny, nx) = (288, 128, 150)` needs `gridN 150 128 288`.
- Generate every force field on the same grid contract. Do not mix a downsampled `FFel` with a full-grid `FFLJ`/`FFvdW`.
- `vaspwave.h5`, `LOCPOT(.gz/.xz)`, and `CHGCAR(.gz/.xz)` volumetric datasets read through `pymatgen-core` are raw grids and do not include XSF-style periodic cycle padding.
- XSF serialization is the boundary where the repeated edge gets introduced; in-memory `vaspwave` arrays should not be padded manually.
- When comparing fields or slicing plots, inspect `FF.shape` and `lvec` together before concluding a field is wrong.

## XSF Preparation

When converting from VASP:

- `LOCPOT` gives scalar potential for electrostatics and D3 geometry input.
- `CHGCAR` gives density for Pauli.
- An empty `CHGCAR` does not block `LJ + Hartree` if `vaspwave.h5` contains `locpot/total`.
- Do not fake density-based Pauli by using the sample density as the tip. Require a compatible tip density or stay with `LJ + Hartree`.
- `vaspwave.h5` can provide both through `Vaspwave.get_locpot()` and `Vaspwave.get_chgcar()` without writing intermediate `LOCPOT` or `CHGCAR` files.
- direct `LOCPOT(.gz/.xz)` and `CHGCAR(.gz/.xz)` should be treated as the same raw non-padded volumetric grids in memory.
- If writing XSF manually, save the volumetric data on the sample grid in `zyx` order.
- If staying in memory, keep the raw non-padded grid and pass it directly to `ppafm` internals.

For `ppafm-generate-ljff`, a geometry-only XSF may require atom-type relabeling so that species IDs match `atomtypes.ini`.

For atom overlays in plots, `ppafm-plot-results --atoms` reads `input_plot.xyz`. Filter this file for display without changing the all-atom geometry used for force-field generation.

## Local Atom-Type Overrides

- `ppafm-generate-ljff` loads a local `atomtypes.ini` from the run directory when present; otherwise it falls back to the package default `ppafm/defaults/atomtypes.ini`.
- If a project needs a modified LJ radius or epsilon for one element, prefer a run-local `atomtypes.ini` override over editing the installed ppafm defaults.
- In the current CuPC/ice project, Cu uses a run-local override `rmin = 2.0070` instead of the ppafm default `2.2300`.

## Scan Height and Plot Semantics

- `scanMin` and `scanMax` are absolute tip-apex coordinates.
- `r0Probe` shifts the saved scan-field `lvec` origin, so `OutFz.npz` origin z is not the same value as `scanMin z`.
- `df` plots are shifted again by half the oscillation amplitude. Compare slices by the plotted `Tip_z` label or by reconstructing it from `scanMin`, `scanStep`, and `Amplitude`.
- Raising the scan window without changing grid, geometry, tip model, or `sigma` only requires rerunning `ppafm-relaxed-scan` and `ppafm-plot-results`; reuse existing force fields.

## Tip-Density Rules

- Keep `rhoTip` on its original origin.
- Do not center, recenter, or mirror the external tip density by default.
- Resample `rhoTip` onto the sample grid if needed, but preserve the origin contract.

## Parity Checks

When results look wrong, compare these together:

- `params.ini`
- `FFel.npz`
- `FFLJ.npz` or `FFvdW.npz`
- `FFpauli.npz`
- `Q*/OutFz.npz`
- `Q*/Amp*/df.npz`

Do not trust a single stage in isolation.
