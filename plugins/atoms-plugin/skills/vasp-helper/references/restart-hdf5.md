# Restart And HDF5 Reuse

This page covers practical reuse of `WAVECAR`, `CHGCAR`, and `vaspwave.h5`, plus HDF5-based post-processing workflows.

## What This Covers

- When old restart files are safe to reuse
- How `scripts/extract_vaspwave_grid.py` fits into HDF5-based workflows
- Which compatibility checks matter before reuse
- Which VASP subsystems own HDF5 and restart-file plumbing

## Key Rules Heuristics

- Do not reuse restart files across changed lattices, k-meshes, spin settings, or materially different cutoffs without rechecking compatibility.
- Treat `vaspwave.h5` density extraction as post-processing convenience, not proof that wavefunction restart compatibility holds.
- If you only need `CHGCAR` or `LOCPOT`, regenerate them from `vaspwave.h5` and avoid carrying stale text outputs around.

## Relevant Commands

```bash
python3 scripts/extract_vaspwave_grid.py vaspwave.h5 --kind chgcar
python3 scripts/extract_vaspwave_grid.py vaspwave.h5 --kind locpot
```

Inspect the HDF5 structure first:

```bash
h5ls -r vaspwave.h5 | sed -n '1,160p'
h5dump -n vaspwave.h5 | sed -n '1,160p'
```

Package restart files when needed:

```bash
tar -I 'zstd -T0' -cf restart.tar.zst WAVECAR CHGCAR vaspwave.h5
tar -I zstd -xf restart.tar.zst
```

## Common Failure Patterns

- `KeyError: object 'wave' doesn't exist`
- Extracted density is available but restart wavefunction data is not
- Restart files were copied across changed lattice or basis settings
- Legacy outputs are preserved out of habit even though downstream tools can consume HDF5-derived text outputs

## Implementation Anchors

- `fileio.F`
- `reader.F`, `reader_base.F`
- `incar_reader.F`
- `poscar.F`, `poscar_struct.F`
- `xml.F`, `xml_writer.F`
- `vhdf5.F`, `vhdf5_base.F`, `vhdf5_struct.F`

## Graphify Cross-Reference

- `skills/vasp-helper/source/graphify-out/6.6.0X/graph.json`

## Related Pages

- [density-postprocess.md](density-postprocess.md)
- [platform-runtime.md](platform-runtime.md)
- [electronic-convergence.md](electronic-convergence.md)
- [source-navigation.md](source-navigation.md)
