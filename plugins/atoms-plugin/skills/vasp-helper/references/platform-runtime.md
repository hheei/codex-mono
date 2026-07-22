# Platform Runtime

This page covers portable environment assumptions, runtime tool availability, and infrastructure details that affect practical use of this skill.

## What This Covers

- Generic runtime expectations for plotting, Bader, and conversion workflows
- Tool-availability checks
- Practical guardrails around helper scripts
- VASP infrastructure details that matter for source-reading and runtime behavior

## Key Rules Heuristics

- Do not assume helper binaries are globally available; verify with `command -v`.
- For plotting tasks, check `matplotlib` availability and set `MPLCONFIGDIR` if needed in restricted environments.
- Prefer direct script execution over packaging when using this skill locally.
- Treat host-specific module names, paths, and wrapper environments as project-local overlays, not universal defaults.
- Keep cleanup policy and remote staging workflow details in `run-hygiene.md`; use this page for environment assumptions and tool-availability constraints.

## Relevant Commands

Run helper scripts directly or through the unified entrypoint:

```bash
python3 scripts/vasp_helper_cli.py --help
python3 scripts/vasp_helper_cli.py outcar-analysis /path/to/OUTCAR
python3 scripts/outcar_analysis_cli.py /path/to/OUTCAR
python3 scripts/extract_vaspwave_grid.py /path/to/vaspwave.h5 --kind chgcar
```

Check tool availability:

```bash
command -v vaspkit
command -v bader
command -v chgsum.pl
command -v v2xsf
```

For plotting environments:

```bash
export MPLCONFIGDIR=/tmp/mplconfig_$USER
mkdir -p "$MPLCONFIGDIR"
```

For remote staging and cleanup workflows, use the commands collected in [run-hygiene.md](run-hygiene.md).


## Common Failure Patterns

- Assuming a helper tool is installed separately when it only exists in one local environment
- Plotting failures caused by environment-config write permissions
- Deleting useful restart or diagnostic files by running cleanup scripts too aggressively
- Spending latency on repeated remote greps when parsing a small staged local copy would be cheaper

## Implementation Anchors

- `fileio.F`
- `reader.F`, `reader_base.F`, `incar_reader.F`
- `xml.F`, `xml_writer.F`
- `vhdf5.F`, `vhdf5_base.F`, `vhdf5_struct.F`
- `fft_base.F`, `fft_comm.F`, `fft_wrappers.F`, `fftlib/`
- `blas_wrappers.F`, `lapack_wrappers.F`, `scalapack_wrappers.F`
- `mpi.F`, `mpi_shmem.F`, `openmp.F`, `openacc.F`, `offload.F`
- `command_line.F`, `build_info.F`, `version.F`

## Graphify Cross-Reference

- `skills/vasp-helper/vendor/vasp-6.6.0X/graphify-gpt54-out/GRAPH_REPORT.md`
- `skills/vasp-helper/vendor/vasp-6.6.0X/graphify-gpt54-out/graph.json`
- `skills/vasp-helper/vendor/vasp-6.6.0X/graphify-out/GRAPH_REPORT.md`

## Related Pages

- [density-postprocess.md](density-postprocess.md)
- [restart-hdf5.md](restart-hdf5.md)
