---
name: ppafm-skill
description: Use when a user asks to generate, rerun, tune, debug, or compare PPAFM/AFM images from VASP outputs, especially on a remote Slurm host. Covers checking the remote uv/PPAFM/Slurm environment, preparing a non-destructive rerun, producing remote df/PNG results, and diagnosing force-field or grid mismatches.
---

# PPAFM Simulation

Run production AFM calculations in a remote Slurm allocation, not on a login shell. Keep all generated fields, `df` arrays, plots, and logs in the remote rerun directory.

## Remote-First Workflow

1. Read [references/remote-execution.md](references/remote-execution.md) before creating or submitting a run.
2. Run `scripts/env-check.sh` once on the selected host for this task. If it reports any missing prerequisite or no idle partition, stop and ask the user whether to install/cache the dependency or wait/select another host. Do not install packages or retry the check repeatedly without that approval.
3. Run `scripts/vasp-check.sh <vasp-directory>` before selecting a PPAFM branch. Use its `LJ_POINT_CHARGE`, `LJ_HARTREE`, and `FULL_DENSITY` results and their reasons.
4. Inspect the requested VASP directory and any validated PPAFM sibling. Confirm the available volumetric input, `params.ini`, existing outputs, and whether rerunning would overwrite anything.
5. Choose an unused sibling name such as `ppafm0001`, then run `scripts/ppafm-prep.sh <vasp-directory> <output-directory> <validated-template-directory>`. Reuse validated inputs and scripts by link or copy as appropriate; never modify a completed baseline in place.
6. Choose `LJ + Hartree` or `vdW + Pauli + Hartree`, then submit one Slurm node and one task to the environment check's recommended partition. Use threads through `--cpus-per-task`; do not use MPI or Python multiprocessing. Direct execution is reserved for a small, explicitly approved diagnostic.
7. Verify the Slurm result and report the remote paths to `FF*`, `Q*/OutFz.npz`, `Q*/Amp*/df.npz`, plots, and the job log. Do not claim an AFM image exists merely because the job submitted.

## Execution Environment

- Use native `ppafm` commands for output parity. Invoke helpers with `uv run --no-project ...` and CLIs with `uv tool run --from ppafm ...` when the project interpreter is incompatible.
- Stage the bundled helpers needed by a run in its remote rerun directory. Do not install dependencies into a shared skill directory; use `uv`'s isolated environment from the submitted job.
- Run an existing validated shell script with `bash script.sh`, not `./script.sh`, unless its executable bit is known-good.
- Keep force-field geometry in `input.xyz`; use `input_plot.xyz` only for plot overlays.

## Workflow Selection

- Use `LJ + Hartree` when geometry plus electrostatics is sufficient, or when only `vaspwave.h5`/`LOCPOT` is available. See [references/direct-ppafm-from-vasp.md](references/direct-ppafm-from-vasp.md).
- Use `vdW + Pauli + Hartree` only with a compatible sample density and external tip density. Never substitute the sample density as a tip density.
- For an existing calculation with a changed scan range, scan step, charge, `klat`, amplitude, or plotting overlay, reuse valid force fields and resubmit only relax and plot stages.
- For parameter tuning or malformed output, read [references/tuning-and-troubleshooting.md](references/tuning-and-troubleshooting.md). For two completed same-grid runs, use [references/comparison-and-delta-analysis.md](references/comparison-and-delta-analysis.md).

## Data Contracts

- Volumetric arrays and saved vector fields are `zyx`: `(nz, ny, nx, 3)`.
- Confirm `FF.shape` and `lvec` before interpreting a slice or declaring a mismatch. Raw VASP volumetric data has no XSF periodic-cycle padding.
- Keep `rhoTip` at its original origin. Do not center or mirror it unless its source contract requires it.
- `scanMin` and `scanMax` z are absolute tip-apex coordinates. Compare images by physical `Tip_z`, not filename or array index alone.

## Result Requirements

Before reporting success, check the expected fields for the chosen branch and at least one rendered `df` image. Preserve the raw `.npz` files; plots alone are insufficient for later comparison or diagnosis.

## Regeneration Boundaries

- Regenerate `FFel` when the potential, electrostatic tip model, grid, or `sigma` changes.
- Regenerate `FFLJ`/`FFvdW` when geometry, atom types, grid, or vdW parameters change.
- Regenerate `FFpauli` when sample/tip density, `Apauli` baked into generation, `Bpauli`, or density cutoff changes.
- Keep force fields fixed for output-only comparisons when the grid, scan window, amplitude, and tip model are identical.
