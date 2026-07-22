# Electronic Convergence

This page covers SCF behavior, ionic relaxation status, and high-level interpretation of `OUTCAR`, `OSZICAR`, and key `INCAR` settings.

## What This Covers

- Whether the run is electronically or ionically limited
- How to read `NSW`, `NELM`, `EDIFF`, and `EDIFFG`
- Whether a relax run stopped because it hit the step limit
- How to interpret `scripts/outcar_analysis_cli.py` reports

## Key Rules Heuristics

- If `General timing accounting informations` is present, `NSW` is reached, and no required-accuracy marker appears, treat the run as stopped by the ionic step limit.
- If electronic iterations frequently hit `NELM`, diagnose SCF convergence before changing ionic settings.
- If `EDIFFG < 0`, compare the final movable-degree-of-freedom force component against `abs(EDIFFG)`.
- Large total forces on fully fixed atoms do not imply ionic non-convergence if movable atoms are already well behaved.
- For `POTIM`, prefer `OUTCAR` trial-step and optimization-step diagnostics over visual judgment from small trajectory displacements.

## Relevant Commands

```bash
python3 scripts/vasp_helper_cli.py outcar-analysis /path/to/OUTCAR
python3 scripts/outcar_analysis_cli.py /path/to/OUTCAR
```

Behavior:

- Reads `OUTCAR`, `OSZICAR`, `INCAR`, `POSCAR`, and `POTCAR` from the same directory when present
- Writes `analysis.overall.md` next to `OUTCAR`
- Prints the same markdown summary to stdout

For remote run directories:

- Prefer `scp` staging of `OUTCAR`, `OSZICAR`, `INCAR`, `POSCAR`, `CONTCAR`, `KPOINTS`, and `POTCAR` into `/tmp/vasp-helper/<host>/<job-key>/`
- Run `python3 scripts/vasp_helper_cli.py outcar-analysis /tmp/vasp-helper/$USER/OUTCAR` against the staged local copy; keep `python3 scripts/outcar_analysis_cli.py ...` for the narrower stdlib-only path
- Stay on the remote host only for oversized files, unavailable transfer paths, or tasks that require remote-only tools

Use cached wiki pages for tag-level follow-up:

```bash
python3 scripts/vasp_helper_cli.py vasp-wiki EDIFF EDIFFG NELM NSW POTIM
python3 scripts/vasp_wiki_cli.py EDIFF EDIFFG NELM NSW POTIM
```

## Common Failure Patterns

- `NELM` is repeatedly hit
- `NSW` is exhausted without a required-accuracy marker
- The relax run is incomplete even though the output finished cleanly
- Large forces are reported on frozen atoms
- `EDIFF` is suspiciously loose, especially for charged, polar, or field-coupled calculations

## Implementation Anchors

If the question shifts from diagnosis to implementation, the most useful source files are:

- `charge.F`
- `electron.F`, `electron_all.F`, `electron_common.F`
- `hamil.F`, `hamil_struct.F`
- `mix.F`
- `wave.F`, `wave_struct.F`, `wave_mpi.F`
- `pot.F`, `pot_electrostat.F`, `wpot.F`, `extpot.F`
- `rmm-diis.F`, `davidson.F`, `diis.F`, `steep.F`
- `force.F`

## Graphify Cross-Reference

- `source/graphify-out/6.6.0X/graph.json`

## Related Pages

- [restart-hdf5.md](restart-hdf5.md)
- [platform-runtime.md](platform-runtime.md)

## SCF Convergence Tuning Reference

### Parameter Reference

#### Mixing Parameters (IMIX=4 Broyden)

| Tag | Default | Physical role | Stage | Safe direction | Ice-slab result |
|---|---|---|---|---|---|
| **AMIX** | 0.40 (PAW) | Kerker kernel prefactor: `AMIX·G²/(G²+BMIX²)`. Controls fraction of output−input density difference mixed in step 1 before Broyden takes over. Larger = more aggressive seed; Broyden corrects afterward. | Step 1 only (Kerker init), then Broyden uses history | **Lower** if `rms(prec)/rms(total)` spikes above 1.15 mid-run (init too aggressive → preconditioner mismatch). **Raise** if `spectrum_width` &gt; 15 or width expands run-over-run (init too weak → Broyden history degrades). If unsure, sweep 0.05–0.40 and pick minimum SCF steps. | **Optimal at 0.10**: 24 steps vs 34 baseline.
| **BMIX** | 1.0 | Kerker cutoff wave vector. Higher BMIX → fewer low-G slab/surface modes mixed. Kernel: `G²/(G²+BMIX²)` suppresses G &lt; BMIX. | Step 1 only (IMIX=4). Broyden fully overwrites subsequent history direction. | For IMIX=4: rarely needs tuning. For IMIX=1/2: lower BMIX = more aggressive low-G mixing. | **No effect** (0.5–3.0 tested). Inertness is specific to IMIX=4 + this slab. May matter for IMIX=1/2 or relax runs. |
| **IMIX** | 4 | Mixing algorithm. 1=Kerker (simple, `AMIX·G²/(G²+BMIX²)` every step). 2=Tchebycheff (Kerker kernel + velocity damping via AMIN as μ). 4=Broyden/Pulay (builds inverse dielectric from history). | All SCF steps | Start at 4. Only try 2 if 4 works but per-step overhead matters. Only try 1 for simple metals/small cells. | **IMIX=2 failed**: NELM=50 hit, TOTEN off 2 eV. Broyden required for this complex slab. |
| **WC** | 100 (this build) | Weight per Broyden iteration. When WC≥0, `broyden.F` sets `WI(ITER)=WC` — every step gets equal weight in history. | All SCF steps (Broyden history) | Typically no benefit from tuning. WC=0 is special mode (Broyden-2 variant, WI=100). | **No effect** (50 vs 100 tested). Inertness specific to IMIX=4 + NSW=0 + this slab. |
| **MAXMIX** | −45 | Max Broyden history vectors. Negative = reset per ionic step. Positive = carry between ionic steps (useful for relax/MD). | All SCF steps (history size) | For NSW=0: irrelevant (single ionic step). For NSW&gt;0: positive value can improve convergence by reusing history between ionic steps. | **No effect** (NSW=0). Would matter for relax runs. |
| **MIXPRE** | 1 | Metric in Broyden mixing. 0=no metric, 1=default, 2/3=variant. Changes the inner product used to build Broyden history. | All SCF steps (Broyden history construction) | Wiki says 1 "always improves convergence." Try 0 only if Broyden fails to build useful history (rare). | **No effect** (0 vs 1 tested). |
| **AMIN** | min(0.1,AMIX,AMIX_MAG) | Minimum mixing parameter in Kerker init. Caps `AMIX·max(AMIN, G²/(G²+BMIX²))` for low-G modes. For IMIX=2: velocity damping coefficient μ. | Step 1 (IMIX=4); all steps (IMIX=2) | For IMIX=4: rarely needs tuning (step 1 only). For IMIX=2: μ = 2·√(λ_min/λ_max) from dielectric eigenvalues. | Not tested for IMIX=4 (step-1-only, likely inert). |
| **INIMIX** | 1 | Initial mixing type before Broyden accumulates history. 0=linear, 1=Kerker. | Step 1 only | Default 1 is fine. 0 may help if Kerker init over-suppresses low-G modes. | Default (1) used throughout. |

#### Eigensolver Parameters

| Tag | Default | Physical role | Stage | Safe direction | Ice-slab result |
|---|---|---|---|---|---|
| **ALGO** | Normal | Eigensolver: Normal=Davidson (IALGO=38, robust). Fast=Davidson with fewer empty bands early, then hybrid RMM. VeryFast=RMM-DIIS (IALGO=48, lower per-step cost, more steps on complex systems). | All SCF steps (wavefunction update) | Start at Normal. Try Fast/VeryFast only if per-step EDDAV time dominates and you're willing to accept more steps. Don't use RMM-based algorithms for metals or systems with many band crossings. | Normal (24 DAV) beats Fast (32 mixed) and VeryFast (31 RMM). |
| **LSUBROT** | .FALSE. | Subspace rotation to improve condition number in Davidson diagonalisation. | Davidson subspace iteration | Setting .TRUE. may shave 1–2 late steps if RMS stagnates. Low risk. | **No effect** — Davidson already optimal here. |
| **NELMDL** | −5 (default), 0 (this run) | Non-self-consistent delay steps. Hamiltonian kept fixed while random wavefunctions converge. Negative = only first ionic step. | First N steps of SCF | Wiki recommends −5 for surfaces/low-D starting from random wavefunctions. Rarely needs tuning beyond restoring default if it was accidentally unset. | **No effect** (0→−5 tested). |
| **LDIAG** | .TRUE. | Subspace diagonalisation with eigenvalue reordering. | Davidson subspace step | .FALSE. may speed up per step but risks convergence quality. Not recommended. | Not tested (risky). |
| **LMAXMIX** | 2 | Max L for onsite PAW density mixing passed to Broyden. | All SCF steps (PAW one-center terms) | Raise to 4–6 for DFT+U, noncollinear spin, or when using fixed CHGCAR. Not applicable to simple collinear slabs. | Not tested. |

### Diagnostic Method

**Step 1 — OSZICAR trajectory:**

Parse per-step `|dE|`, `RMS`, `RMS(c)` from OSZICAR. Key markers:
- First step where `|dE| &lt; 1e-2` — entry to fine convergence
- Plateau length: steps between `|dE| &lt; 1e-3` and EDIFF crossing
- RMS(c) stagnation regions: consecutive steps where RMS(c) changes &lt; 10%

**Step 2 — Broyden mixing blocks (OUTCAR):**

Search OUTCAR for `Broyden mixing:` blocks. Extract:
- `rms(total)` — pre-mixing density residual
- `rms(broyden)` — post-Broyden residual
- `rms(prec)` — preconditioned residual
- `weight for this iteration` — set by WC, **fixed per run** with WC≥0. The Broyden mixer adapts via the accumulated history direction (approximate inverse dielectric built from density residuals), NOT via dynamic per-step weight.

Diagnostic ratio: `rms(prec) / rms(total)`.
- ≈1.0–1.05 → preconditioner well-matched to system dielectric response
- Climbing above 1.15 mid-run → preconditioner mismatch developing
- Elevated ratio sustained through blocks 10–20 → extra SCF steps likely

**Step 3 — Dielectric eigenvalue spectrum (OUTCAR):**

Search for `eigenvalues of (default mixing * dielectric matrix)` blocks.

- `average eigenvalue GAMMA` — wiki says Γ≈1 is optimal, but this heuristic is for Kerker/linear mixing (IMIX=1), **not reliable for Broyden (IMIX=4)**
- **Spectrum width** (max eigenvalue − min eigenvalue) is the better classifier for IMIX=4:
  - width &lt; 15 → healthy Broyden history
  - width 15–25 → slower but still converges
  - width &gt; 100 → pathological, history contamination

### Why Γ≠1 Can Still Converge Fast (Broyden/IMIX=4)

With IMIX=4, Broyden builds an approximate inverse dielectric from density residual history. The reported Γ spectrum is of `(default_mixing * dielectric_matrix)` — "default mixing" here is the Broyden history approximation, not the initial Kerker step. Therefore:

- Γ starting far from 1 is expected (history not yet accumulated)
- Γ climbing means Broyden is actively correcting
- The critical diagnostic is whether the eigenvalue **spectrum width shrinks or expands** — expanding width means history vectors are contradicting each other

---

## Case Study: Ice-Surface PBE-D4 Slab

**Context**: H₂O ice-surface slab, 864 atoms (H₅₇₆O₂₈₈), PBE-D4 (IVDW=13, DFTD4_XC=pbe), Gamma-only KPOINTS (1×1×1), dipole correction (LDIPOL=.TRUE., IDIPOL=3), VASP 6.6.0, PAW, NSW=0 single-point SCF, EDIFF=1E-6, ENCUT=550, ISPIN=1. 4 nodes × 32 MPI ranks, `vasp_gam`.

*System-specific findings. Methodology generalises; optimal values may differ.*

### Baseline Diagnosis

Original run (job 22458271): AMIX=0.40, 34 DAV steps, Elapsed 28:20.
Control rerun (job 22458703): same params, 34 DAV, Elapsed 18:32 (different nodes).

Broyden mixing diagnostics showed:
- Initial Kerker: AMIX=0.40, BMIX=1.0
- Γ started at 1.00, climbed to 2.00 — wiki-ideal range, yet 34 steps
- rms(prec)/rms(total) ratio spiked to 1.37 mid-run (block 14)
- RMS(c) plateau at steps 17–21 — energy stagnated despite density residual decreasing

### AMIX Sweep

| AMIX | Steps | Γ range | Width range | Key observation |
|---:|---:|---:|---:|---|
| 0.025 | 50 (NELM) | 8.8→10.3 | 115→189 | ❌ History degradation; width explodes |
| 0.05 | 28 | 5.0→5.0 | 20→21 | Slower but converged; stable descent |
| **0.10** | **24** | 3.0→3.0 | 9.3→9.5 | **✓ Optimal:** shortest plateau, ratio≈1.02 |
| 0.15 | 30 | 2.5→2.6 | 7.5 | Moderate |
| 0.20 | 32 | 2.0→2.5 | 8.0 | Near-baseline |
| 0.25 | 33 | 1.6→2.3 | 7.7 | Minimal improvement |
| 0.30 | 33 | 1.3→2.2 | 7.5 | Slower walltime |
| 0.40 (ctl) | 34 | 1.0→2.0 | 8.2→8.5 | Baseline; mid-run plateau |

**TOTEN**: all converged cases agree within 0.002 meV of −4291.29716 eV.

**Key insight**: AMIX=0.10 has Γ ≈ 3.0 (far from the wiki-ideal 1.0) but is fastest. The eigenvalue spectrum width — not Γ mean — distinguishes the fast cases from the slow/pathological ones.

### Inert / Failed Parameters

| Parameter | Tested | Result |
|---|---|---|
| BMIX | 0.5, 1.0, 1.5, 2.0, 3.0 | **No effect** — step-1 Kerker overwritten by Broyden |
| WC | 50, 100 | **No effect** — equal-weight Broyden |
| MAXMIX | 20, −45 | **No effect** — NSW=0 single-point |
| MIXPRE | 0, 1 | **No effect** — metric irrelevant for this system |
| LSUBROT | .TRUE. | **No effect** — Davidson already optimal |
| NELMDL | 0, −5 | **No effect** — delay steps don't change trajectory |
| ALGO=Fast | — | 32 steps (5 DAV+27 RMM), 14:47 — **worse** |
| ALGO=VeryFast | — | 31 RMM, 12:45 — faster walltime but more steps |
| IMIX=2 | AMIX 0.10 + BMIX 0.5/1.0/2.0 | **Failed**: NELM=50 hit, TOTEN off by 1.9–3.4 eV |

### Practical Sweep Protocol

1. **Establish baseline from OUTCAR echo** (`Startparameter for this run` block), not from disk INCAR.
2. **Sweep AMIX** covering the range around baseline (factor-of-2 steps).
3. **Include a contemporaneous control run** with baseline AMIX to control for node variability.
4. **Use SCF step count as primary metric**, not walltime (walltime is node-dependent).
5. **Validate TOTEN from OUTCAR footer** (`FREE ENERGIE OF THE ION-ELECTRON SYSTEM` block).
6. **Keep fixed**: ENCUT, PREC, EDIFF, KPOINTS, ALGO, ISMEAR, SIGMA, LASPH, IVDW, ISPIN, ISTART, ICHARG.
7. **If AMIX sweep plateaus, stop.** Further tuning (BMIX/WC/MIXPRE/NELMDL/LSUBROT) is unlikely to help on IMIX=4.

### Recommended INCAR (Ice-Surface Slab)

```
SYSTEM    = "VASPX"
ISTART    = 0; ICHARG = 2
ENCUT     = 550; PREC = Normal
ALGO      = Normal; IMIX = 4
AMIX      = 0.10
EDIFF     = 1E-6; NELM = 50
ISMEAR    = 0; SIGMA = 0.1; ISPIN = 1
IVDW      = 13; DFTD4_XC = pbe; LASPH = .TRUE.
LDIPOL    = .TRUE.; IDIPOL = 3; DIPOL = 0.00 0.00 0.20
NSW       = 0; ISYM = 0
NCORE     = 8
```

### Source Anchors

- `mix.F`: Kerker kernel `AMIX * G²/(G²+BMIX²)`; IMIX dispatch (0=none, 1=Kerker, 2=Tchebycheff, 4=Broyden)
- `broyden.F`: `WI(ITER)=WC` (weight per iteration); Broyden 2nd-method update via BETAQ; history vector management with MAXMIX; `RMST`/`RMSP`/`RMS` diagnostics
- `electron_common.F`: `testBreakCondition` — convergence via `max(|dE|, |deval|) &lt; EDIFF`; `testNumberOfStep` — NELMIN adds mandatory minimum, NELMDL delays normal convergence check
- `electron.F`, `electron_all.F`: main SCF loop; `EDDAV`/`EDDIAG` timing; delay phase logic
