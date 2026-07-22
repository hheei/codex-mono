# Run Hygiene

This page covers safe cleanup, staging, and local working-copy hygiene for VASP run directories.

## What This Covers

- Dry-run-first cleanup of runtime artifacts
- `scripts/clean_vasp_run_dir.py` usage and safety rules
- Which files are typically safe to remove versus keep
- Local staging patterns before analysis or post-processing

## Key Rules Heuristics

- Default to dry-run first; only delete after reviewing the matched list.
- Keep restart-critical and input-defining files unless the user explicitly asks otherwise.
- Prefer cleaning generated runtime artifacts, logs, and derived grids before touching setup files.
- When pulling data from a remote host, stage small analysis inputs locally before running lightweight helper scripts.
- Treat cleanup as reversible planning work until `--apply` is present.

## Cleanup Workflow

Script:
- Skill path: `scripts/clean_vasp_run_dir.py`

Default behavior:
- Dry-run by default.
- Print matched files and summary.
- Delete only when `--apply` is specified.

CLI interface:
- Positional `paths`: target directories (default `.`)
- `-r, --recursive`: include subdirectories
- `--apply`: actually delete matched files
- `--patterns`: override the default glob patterns

Default cleanup patterns include:
- Scheduler and log files: `slurm*`, `slurm.out`, `slurm.err`
- VASP outputs: `OUTCAR`, `OSZICAR`, `vasprun.xml`, `vaspout.h5`, `vaspout.xml`, `WAVECAR`, `XDATCAR`, `LOCPOT`, `EIGENVAL`, `IBZKPT`, `DOSCAR`, `PROCAR`, `CONTCAR`
- Charge and potential grids: `CHG`, `CHGCAR`, `AECCAR0`, `AECCAR1`, `AECCAR2`
- Other runtime artifacts: `REPORT`, `PCDAT`, `pygrid.h5`

## Relevant Commands

Dry-run in the current directory:

```bash
python3 scripts/clean_vasp_run_dir.py
```

Dry-run specific directories:

```bash
python3 scripts/clean_vasp_run_dir.py run1 run2
```

Dry-run recursively:

```bash
python3 scripts/clean_vasp_run_dir.py runs --recursive
```

Apply deletion after review:

```bash
python3 scripts/clean_vasp_run_dir.py runs --recursive --apply
```

Use custom patterns only:

```bash
python3 scripts/clean_vasp_run_dir.py . --patterns OUTCAR OSZICAR WAVECAR
```

For remote staging before local analysis:

```bash
mkdir -p /tmp/vasp-helper/$USER
scp host:/remote/run/{OUTCAR,OSZICAR,INCAR,POSCAR,CONTCAR,KPOINTS,POTCAR} /tmp/vasp-helper/$USER/
python3 scripts/vasp_helper_cli.py outcar-analysis /tmp/vasp-helper/$USER/OUTCAR
# direct script entrypoint remains valid if you want the narrower stdlib-only path
python3 scripts/outcar_analysis_cli.py /tmp/vasp-helper/$USER/OUTCAR
```

Use [platform-runtime.md](platform-runtime.md) for host-side tool-availability and plotting-environment constraints.

## Safe Workflow

1. Run dry-run first and inspect the file list.
2. Confirm no needed restart or checkpoint files are included.
3. Re-run with `--apply` only after review.
4. Re-run dry-run to verify the directory state.

## Common Failure Patterns

- Deleting `WAVECAR`, `CHGCAR`, or `AECCAR*` before confirming no restart or post-processing step still needs them
- Treating cleanup as harmless when comparison or density-analysis workflows still depend on generated files
- Running recursive cleanup too broadly from a parent directory
- Cleaning remote directories in place when a staged local copy would have been safer

## Notes

- This tool also removes matching symlinks, including broken symlinks.
- Non-existent or non-directory path arguments are skipped.
- Keep `INCAR`, `KPOINTS`, `POSCAR`, `POTCAR`, and job scripts unless you explicitly include them in custom `--patterns`.

## Related Pages

- [platform-runtime.md](platform-runtime.md)
- [restart-hdf5.md](restart-hdf5.md)
- [density-postprocess.md](density-postprocess.md)
