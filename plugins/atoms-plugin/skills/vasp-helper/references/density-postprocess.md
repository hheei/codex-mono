# Density and Postprocess

This page covers density- and potential-oriented postprocessing around `CHGCAR`, `LOCPOT`, `AECCAR*`, and derived volumetric products.

## What This Covers

- Bader analysis
- planar averages
- density-grid differences
- `LOCPOT` / `CHGCAR` conversion and validation
- when to use VASPKIT vs. bundled scripts

## Key Rules and Heuristics

- Prefer pymatgen-written `CHGCAR` when extracting from `vaspwave.h5`.
- For Bader, all-electron-style workflows need `AECCAR0` and `AECCAR2`; otherwise label the result as valence-density analysis.
- Preserve atom order from the chosen structure source when generating merged outputs like `bader.xyz`.
- Differential grid workflows should compare physically compatible structures and grids, not arbitrary unrelated runs.
- Planar averages are meaningful only along a physically relevant direction; for slabs this is usually `z`.

## Relevant Commands

Bader workflow:

```bash
python3 scripts/vasp_helper_cli.py bader-analysis --run-dir /path/to/run
python3 scripts/vasp_helper_cli.py bader-analysis --run-dir /path/to/current-run --compare-dir /path/to/reference-run
# direct entrypoint still works
python3 scripts/bader_analysis_cli.py --run-dir /path/to/run
```

Grid-difference workflow:

```bash
python3 scripts/vasp_helper_cli.py grid-diff-analysis --run-dir /path/to/this --ref-dir /path/to/ref
python3 scripts/grid_diff_analysis_cli.py --run-dir /path/to/this --ref-dir /path/to/ref
```

Planar-average workflow:

```bash
python3 scripts/vasp_helper_cli.py planar-average-plot --file LOCPOT --axis z
python3 scripts/planar_average_plot.py --file CHGCAR --axis z
```

Wiki and VASPKIT helpers:

```bash
python3 scripts/vasp_helper_cli.py vasp-wiki LVHAR LVTOT
python3 scripts/vasp_wiki_cli.py LVHAR LVTOT
vaspkit -task 426 -file LOCPOT -dir z
```

## Common Failure Patterns

- `AECCAR0` or `AECCAR2` missing
  - cannot build the usual `CHGCAR_sum` workflow
- `ACF.dat` atom count mismatch
  - structure alignment is broken and the report should not be trusted
- VASP4-style headers in old charge files
  - some exporters may lose species labels and fall back to atomic-number placeholders
- wrong planar direction
  - output is numerically valid but physically unhelpful
- grid-difference between incompatible runs
  - can produce meaningless density maps

## Implementation Anchors

When the question becomes implementation-oriented, the most relevant source areas are:

- `fileio.F`
- `reader.F`, `reader_base.F`
- `poscar.F`, `poscar_struct.F`
- `xml.F`, `xml_writer.F`
- `vhdf5.F`, `vhdf5_base.F`, `vhdf5_struct.F`

The plugin-side workflows are mostly postprocessing, but these VASP infrastructure files matter when tracing how density- and structure-bearing files are written and organized.

## Graphify Cross-Reference

Most useful graphify artifacts for this category:

- `source/graphify-out/6.6.0X/graph.json`
  - use the `6.6.0/graph.json` sibling when comparing against the original baseline

## Related Pages

- [restart-hdf5.md](restart-hdf5.md)
- [platform-runtime.md](platform-runtime.md)
- [structure-symmetry-kpoints.md](structure-symmetry-kpoints.md)
- [source-navigation.md](source-navigation.md)
