---
name: vasp-helper
description: Practical VASP workflow support for INCAR tuning, OUTCAR and OSZICAR diagnosis, vaspwave.h5 extraction, restart-file reuse checks, Bader and planar-average workflows, CHGCAR comparisons, run-directory hygiene, VASPKIT guidance, and source-level implementation mapping.
---

# vasp-helper

Use the smallest relevant context first.

- For installation or helper-script usage questions, route to `README.md` in this skill directory first; it documents both `scripts/vasp_helper_cli.py` subcommands and the preserved direct script entrypoints.
- Use this file as the only routing/index entrypoint for the skill.
- The category mapping below replaces the old directory-style index.
- Use `references/` for general knowledge.
- Use `projects/` only for project-specific overlays.
- Use cached wiki pages for narrow INCAR-tag questions.
- Use graphify only when the question actually requires source-code reading.
- Do not start by opening raw files under `skills/vasp-helper/source/src/*`.
- If the user points to a remote run directory, prefer staging small analysis inputs under `/tmp/vasp-helper/` and analyzing the staged local copy first.

## Routing Order

1. Classify the request category.
2. Open exactly one category page under `references/`.
3. Use cached wiki pages if tag-level follow-up is needed.
4. When implementation details are required, use the page's `Implementation Anchors` and graphify cross-references before opening raw source files.
5. If the question depends on one local project, host setup, or source-branch convention, open the matching note under `projects/`.
6. If requested inputs live on a remote host, copy small files locally first and run local helper scripts on the staged directory.

## Category Mapping

- Convergence, stopping conditions, and relax health: `references/electronic-convergence.md`
- Restart reuse, `LH5`, `WAVECAR`, `CHGCAR`, `vaspwave.h5`: `references/restart-hdf5.md`
- Density post-processing, Bader, planar averages, and grid differences: `references/density-postprocess.md`
- Runtime environment, helper binaries, and plotting constraints: `references/platform-runtime.md`
- Run-directory cleanup, staging, and local hygiene workflows: `references/run-hygiene.md`
- Symmetry, k-points, and structural inspection: `references/structure-symmetry-kpoints.md`
- Source-navigation and implementation questions: `references/source-navigation.md`

## Source-Navigation Notes

- For source-level questions, query the branch-specific code graph before opening raw files:
  - `6.6.0`: `skills/vasp-helper/source/graphify-out/6.6.0/graph.json`
  - `6.6.0X`: `skills/vasp-helper/source/graphify-out/6.6.0X/graph.json`
- Use `graphify query "<question>" --graph skills/vasp-helper/source/graphify-out/<branch>/graph.json` for relationship-aware searches.
- Use `graphify path "<node-a>" "<node-b>" --graph skills/vasp-helper/source/graphify-out/<branch>/graph.json` to trace a route, or `graphify explain "<node>" --graph skills/vasp-helper/source/graphify-out/<branch>/graph.json` to inspect a node and its neighbors.
- The graphs are code-only and independently generated per branch; HTML visualization is intentionally not required. Cite resulting source locations, then open only relevant raw files.

## Guardrails

- `scripts/outcar_analysis_cli.py` is intentionally stdlib-only and does not attempt ASE-based bonding or molecule heuristics.
- Prefer `python3 scripts/vasp_helper_cli.py --help` for a quick inventory of available helper commands, but keep direct script entrypoints available for established workflows and narrow dependency surfaces.
- For remote directories, prefer `scp` of small text-like inputs such as `OUTCAR`, `OSZICAR`, `INCAR`, `POSCAR`, `CONTCAR`, `KPOINTS`, and `POTCAR` into `/tmp/vasp-helper/<host>/<job-key>/` before analysis.
- Fall back to direct remote inspection only when transfer is unavailable, files are too large, or the task explicitly requires in-place remote execution.
- Preserve existing accuracy-sensitive settings by default.
- Do not change `ENCUT`, `PREC`, `EDIFF`, `EDIFFG`, `KPOINTS` or `KSPACING`, `LREAL`, `ALGO`, `ISMEAR`, `SIGMA`, `LASPH`, `METAGGA`, `IVDW`, or restart and output tags unless the user explicitly asks for tuning.
- When reusing restart files, check lattice, k-mesh, band count, spin state, and cutoff compatibility first.
