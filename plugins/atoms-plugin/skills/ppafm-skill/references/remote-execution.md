# Remote PPAFM Execution

Use this procedure when the user asks to generate an AFM image from a VASP calculation on a configured remote host. Treat remote and local paths as separate namespaces.

## One-Time Host Check

Before changing a run directory, transfer or invoke `scripts/env-check.sh` on the target host and run:

```bash
bash env-check.sh
```

Run it once per host per task. Repeat only after reconnecting to a different host, an explicit dependency installation, or a scheduler/environment failure. It prints `KEY=VALUE` records and exits nonzero when a prerequisite is missing. In particular, it reports:

- `UV`, the required `uv` command.
- `PPAFM_UV_CACHE`, a no-network check that `uv` can run `ppafm`.
- `SLURM_*`, including `RECOMMENDED_PARTITION` and its idle-node count.

If the check fails, show the missing keys to the user and ask whether they authorize installation/caching on that host, or prefer a different host. Do not make a hidden package download in the job. If `RECOMMENDED_PARTITION` is empty, ask whether to wait or use another host; do not silently select a busy partition.

## Prepare A Non-Destructive Rerun

1. Run `vasp-check.sh <vasp-directory>` and use only its ready workflows. It reports the available inputs and the reason each workflow is unavailable. It accepts only the directory argument.
2. Inspect the requested directory for `CONTCAR`, one of `vaspwave.h5`/`LOCPOT`/`CHGCAR` as appropriate, `params.ini`, the validated run script, and current `FF*`, `OutFz`, `df`, and PNG outputs.
3. Use an existing validated sibling as the template when one exists. Its parameters and local `atomtypes.ini` are scientific inputs, not disposable boilerplate.
4. Choose an unused sibling name such as `ppafm0001` and run `ppafm-prep.sh <vasp-directory> <output-directory> <validated-template-directory>`. The prep script links large VASP inputs, copies the template's standard inputs and task script, and writes `job.sh`.
5. For `LJ + Hartree` using a direct `LOCPOT`, select the cell-aware path explicitly: `PPAFM_RUN_SCRIPT=run_lj_hartree_from_locpot.sh ppafm-prep.sh ...`. It derives the PPAFM grid from `LOCPOT`, preserves the actual cell, and places the scan 4.5--8.0 A above the topmost atom. Do not reuse a `vaspwave.h5` template with a different cell's hard-coded grid or scan coordinates.
6. Change only the requested parameters. Keep the force-field grid, tip model, and atomic geometry unchanged unless the user requested a physical-model change.
7. Never reuse a completed run directory for a new scan or delete force fields/images as a cleanup shortcut.

## Submit With Slurm

PPAFM field generation and relaxation belong in a batch allocation. Use `RECOMMENDED_PARTITION` from `env-check.sh`: it is the currently idle partition with the largest total idle-node count. This chooses a partition, not the number of nodes to request. PPAFM uses exactly one node and one Slurm task; scale only through `--cpus-per-task` and threaded numerical libraries. Do not use MPI, `srun -n >1`, or Python multiprocessing. Prefer the thread count from a validated nearby job; otherwise use a conservative count.

Create the wrapper inside the new rerun directory:

```bash
#!/usr/bin/env bash
#SBATCH --job-name=ppafm
#SBATCH --partition=<RECOMMENDED_PARTITION>
#SBATCH --nodes=1
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=8
#SBATCH --time=12:00:00
#SBATCH --output=ppafm-%j.out

set -euo pipefail
export MPLBACKEND=Agg
export OMP_NUM_THREADS="${SLURM_CPUS_PER_TASK}"
export MKL_NUM_THREADS="${SLURM_CPUS_PER_TASK}"
export OPENBLAS_NUM_THREADS="${SLURM_CPUS_PER_TASK}"
export NUMEXPR_NUM_THREADS="${SLURM_CPUS_PER_TASK}"
export UV_OFFLINE=1
cd "<remote-rerun-directory>"
bash <validated-run-script>.sh
```

Replace the placeholders with the checked partition, inspected directory, and validated script name. Do not guess a larger partition, account, GPU request, or wall time. Submit and retain the job identifier:

```bash
sbatch job.sh
squeue -j <job-id>
```

For a small, explicitly approved diagnostic, first request an interactive allocation with `srun` and run only the needed stage there. Do not run a production scan directly on the login node.

## Verify The Remote Result

After the job leaves the queue, inspect `ppafm-<job-id>.out` for the failing command and require these artifacts before declaring success:

- `FFel.npz` and `FFLJ.npz`, or `FFvdW.npz` and `FFpauli.npz` for the Pauli branch.
- `Q*/OutFz.npz` and `Q*/PPpos.npz`.
- `Q*/Amp*/df.npz` and at least one `df_cbar_*.png` (or the template's equivalent rendered AFM image).

Check that the `.npz` shapes and `lvec` agree with `params.ini`, and report the final remote directory, job ID, image path, and retained log path. A successful `sbatch` response is not a successful AFM calculation.

## Failures And Recovery

- Missing `FF*`: inspect the job log and input links before resubmitting; do not overwrite the failed directory.
- Existing output but no PNG: rerun only the native plot stage after verifying `df.npz`.
- Wrong shape or height: compare `FF.shape`, `lvec`, `scanMin`, `scanStep`, `r0Probe`, and amplitude before transposing or regenerating any field.
- Need a new scan window only: preserve valid force fields and submit a fresh relax/plot rerun.
