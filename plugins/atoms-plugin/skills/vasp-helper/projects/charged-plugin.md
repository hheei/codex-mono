# Charged Plugin Project Note

This page is project-specific. It covers the charged VASP workflow implemented by the external wall-charge / potential-correction plugin.

## What This Covers

- charge bookkeeping between `NELECT` and plugin-side charge parameters
- plugin-field construction checks
- plugin-specific INCAR coupling
- charged-field convergence concerns

## Routing Note

- Use `SKILL.md` as the main routing entrypoint for general VASP questions.
- Open this project note only after the request is clearly about the charged wall-charge / potential-correction plugin workflow.
- For reusable background, pair this note with the linked category pages instead of duplicating their generic guidance.

## Review Checklist

1. Confirm the run type assumptions.
   - Check slab/vacuum geometry and whether Gamma-only or a k-mesh is used.
   - State the target: relaxation, single-point, or property extraction.
2. Check input completeness.
   - Verify `POTCAR` exists in the submitted directory.
   - Verify POTCAR species order matches POSCAR species order.
   - Verify valence setup is consistent with charge bookkeeping assumptions.
3. Check charge consistency.
   - Verify `NELECT` (INCAR), plugin `Q`, and plugin `nelect_neutral` are self-consistent.
   - Make the sign convention explicit.
4. Check plugin field construction.
   - Confirm the active mode, for example `gaussianWall`, is the intended one.
   - Confirm wall parameters are actually used.
   - Confirm fixed choices such as `sigma=0.3` are reflected in the code path.
5. Check correction-path consistency.
   - Verify force and energy corrections use the same ownership/mapping strategy.
   - Verify fallback or read-cache paths allocate buffers with correct shapes and dtypes.
6. Check INCAR coupling.
   - Keep internal dipole correction disabled if the plugin already applies the correction logic.
   - For slab relaxations, prefer `ISIF=2` unless cell relaxation is explicitly intended.
   - Avoid setting `NPAR` and `NCORE` simultaneously unless there is a tested reason.
7. Check electronic convergence controls.
   - Flag too-loose `EDIFF` in charged-field runs.
   - Check `ISMEAR` and `SIGMA` against the actual system type.
8. Check Gamma-only parallel guidance if relevant.
   - Use `KPAR=1` as the baseline.

## Validation Ideas

- POTCAR integrity test
- charge bookkeeping test
- sensitivity test
- restart continuity test

## Related General Pages

- [../references/electronic-convergence.md](../references/electronic-convergence.md)
- [../references/restart-hdf5.md](../references/restart-hdf5.md)
- [../references/structure-symmetry-kpoints.md](../references/structure-symmetry-kpoints.md)
