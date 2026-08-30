# Comparison and Delta Analysis

Use this path when the user wants to compare two completed AFM runs, subtract maps, or place the two outputs plus their difference in one figure.

## When to Use

- The two runs already exist and share the same scan grid, tip model, amplitude, and plotting window.
- The user wants a direct visual comparison such as `11`, `12`, and `12 - 11`.
- The user wants a difference map without rerunning `ppafm-relaxed-scan`.

## Required Checks

Before subtracting maps, confirm:

1. `Q*/Amp*/df.npz` shapes match exactly.
2. `lvec` matches exactly.
3. The scan windows and amplitude are identical.
4. The same `Tip_z` indexing is used in both runs.

If any of those differ, do not subtract blindly. Regrid or rebuild the comparison on a shared physical height axis.

## Data to Compare

Prefer these files:

- `Q*/Amp*/df.npz`
- `Q*/OutFz.npz` if you need force-level comparison before the oscillation average

Use `df.npz` when the user wants the rendered AFM contrast. Use `OutFz.npz` only if you need to inspect the force field itself.

## Delta Workflow

For a same-grid comparison:

1. Load both `df.npz` arrays.
2. Compute `delta = df_new - df_old`.
3. Save `delta_df.npz` with the same `lvec`, `atoms`, and `lvec0` metadata.
4. Plot the three panels for each slice:
   - old run
   - new run
   - delta

Use `scripts/compare_df_runs.py` for this path when you want a reusable command-line entrypoint.

- If the user wants all three panels to share one visual language, using `viridis` for raw and delta panels is acceptable; treat that as a presentation choice, not a scientific constraint.
- For compact three-panel figures, prefer `matplotlib` `GridSpec` with dedicated colorbar axes instead of default colorbar placement, so the colorbars stay inside the figure bounds.
- In the current CuPC/ice rerun project, same-grid delta comparisons have been validated for `Amp2.00` reruns with `df` shape `(31, 92, 92)` and matching `lvec` and `lvec0`.

## Interpreting Large Deltas

- A large delta at low `Tip_z` between two completed runs is often physically real: near-surface slices are most sensitive to local LJ and electrostatic differences.
- If the largest contrast is concentrated in the first few `df` slices and decays quickly with height, suspect a genuine near-surface structural or electrostatic change before suspecting a plotting bug.
- When a user asks why two delta maps differ strongly, check not only `df`, but also `FFLJ`, `FFel`, and `PPpos`; field-level differences can explain the slice behavior.

## Plotting Rules

- Use independent colorbars for the old run, new run, and delta panels.
- Do not force the same colorbar range across the old and new panels unless the user explicitly asks for a normalized visual scale.
- Use each panel's actual slice-local min/max by default. Do not force positive and negative radii to be equal; that can wash out mostly one-sided `df` maps.
- For the delta panel, use the actual slice-local min/max by default. Use a zero-centered symmetric scale only when the user explicitly wants sign-balanced comparison.
- If the user asks for less clutter, allow each slice to scale independently rather than fixing one global range across all slices.

## Expected Layout

For each `Tip_z` slice, render a single figure with three panels:

- left: run 1
- middle: run 2
- right: `run 2 - run 1`

Keep the physical height in the title so slices can be compared across runs.

## Practical Notes

- If `input_plot.xyz` differs between runs but the force-field grid and scan window are unchanged, that affects only the overlay, not the delta map itself.
- If the scan window changed, compare by physical `Tip_z`, not by slice index.
- If the grids differ by shape or `lvec`, treat it as a workflow mismatch, not a subtraction problem.
