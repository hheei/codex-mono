# Structure, Symmetry, And K-Points

This page covers practical checks around structural setup, symmetry-sensitive settings, and k-point choices.

## What This Covers

- When symmetry assumptions are likely too aggressive or too weak
- How slab and molecular cases should change k-point reasoning
- What helper scripts can and cannot tell you from local text inputs

## Key Rules Heuristics

- Treat `ISYM` changes as restart-compatibility changes, not cosmetic toggles.
- For slabs, verify the non-periodic direction before interpreting planar averages or k-point density.
- The stdlib `outcar_analysis_cli.py` script reports fixed versus movable atoms, but it does not perform ASE-style connectivity or molecule inference.

## Relevant Commands

Generate or inspect k-point-related outputs:

```bash
vaspkit -task 102 -file POSCAR -kpr 0.04
vaspkit -task 601
vaspkit -task 609
```

Run a summary on the current structure and relaxation state:

```bash
python3 scripts/outcar_analysis_cli.py /path/to/OUTCAR
```

Look up tags when symmetry or k-point settings matter:

```bash
python3 scripts/vasp_wiki_cli.py ISYM KSPACING KGAMMA
```

## Common Failure Patterns

- Treating heuristic structure summaries as formal bonding analysis
- Using a physically irrelevant planar direction for slabs
- Changing symmetry or k-point assumptions during restart attempts and then trusting old restart files anyway

## Implementation Anchors

- `symmetry.F`, `symlib.F`, `sym_grad.F`, `spinsym.F`
- `subrot.F`, `subrot_scf.F`, `subrot_lr.F`, `subrot_cluster.F`
- `mkpoints.F`, `mkpoints_change.F`, `mkpoints_full.F`, `mkpoints_struct.F`
- `k-proj.F`, `sydmat.F`, `rot.F`
- `wave_rotator.F`, `wave_window.F`, `wave_interpolate.F`
- `locproj.F`, `locproj_struct.F`

## Graphify Cross-Reference

- `source/graphify-out/6.6.0X/graph.json`

## Related Pages

- [electronic-convergence.md](electronic-convergence.md)
- [restart-hdf5.md](restart-hdf5.md)
- [density-postprocess.md](density-postprocess.md)
- [source-navigation.md](source-navigation.md)
