# Tuning and Troubleshooting

## First Checks

When a result is ugly, unstable, or clearly different from a trusted baseline, check in this order:

1. `params.ini`
2. electrostatic tip model and `sigma`
3. scan `z` range and step
4. field shapes and axis order
5. whether the relax branch is `--noLJ` or default LJ

## Common Failure Modes

### Wrong axis order

Symptom:

- plots look mirrored, stretched, or shifted in the wrong dimension

Action:

- inspect `.npz` `FF.shape`
- confirm the field is interpreted as `(nz, ny, nx, 3)`
- confirm height labels from `lvec`
- if one branch came from `vaspwave.h5` and another from XSF, account for XSF cycle padding before blaming the array order

### Broken tip-density preprocessing

Symptom:

- Pauli field peaks at implausible heights
- `df` images become bizarre after `rhoTip` changes

Action:

- verify `rhoTip` was not centered or mirrored
- verify resampling kept the sample grid and original origin

### Electrostatics magnitude explosion

Symptom:

- `FFel` min/max are orders of magnitude larger than baseline
- `df` images look numerically broken

Action:

- confirm whether the baseline used `--tip dz2` or an external `--tip_dens`
- if parity with a known `dz2` run matters, do not silently substitute an external tip density

### Z-window mismatch

Symptom:

- `df_cbar_019.png` or similar filenames do not correspond to the same physical height across runs
- `OutFz.npz` or `df.npz` `lvec[0,2]` looks lower than the configured scan z range

Action:

- compute the actual `Tip_z` from `scanMin`, `Amplitude`, and `df` indexing
- compare by physical height, not filename alone
- remember that saved scan-field origins are shifted by `r0Probe`, and saved `df` origins are shifted by amplitude

### Empty or misleading `PPdisp.npz`

Symptom:

- `PPdisp.npz` is tiny or contains an object scalar `None`
- `PPpos.npz` is valid, but displacement plots fail or are meaningless

Action:

- avoid `ppafm-relaxed-scan --disp` for that ppafm version
- use `PPpos.npz` for probe-particle positions
- if displacement is required, compute it deliberately from `PPpos` and the initial tip grid

### False shape mismatch from XSF padding

Symptom:

- `vaspwave.h5` and XSF-derived grids appear to differ by `+1` on each axis
- the field itself looks right, but a direct shape comparison fails

Action:

- remember that `vaspwave.h5`, `LOCPOT(.gz/.xz)`, and `CHGCAR(.gz/.xz)` do not contain periodic cycle padding
- remember that XSF text representation repeats the first plane at the end in each direction
- compare the raw in-memory arrays, not the serialized XSF payload including the repeated edge

## Practical Knobs

### Hartree / Electrostatics

Typical knobs:

- `tip`
- `sigma`
- `charge`

Notes:

- changing `charge` changes the weight of `FFel` in relax
- changing `tip` or `sigma` changes the electrostatic force field itself

### Pauli

Typical knobs:

- `Apauli`
- `Bpauli`
- `density_cutoff`

Interpretation:

- `Apauli` is the direct relax-time scale factor on `FFpauli`
- `Bpauli` changes the density-overlap sharpness, not just amplitude
- `density_cutoff` is a stabilization knob for extreme density peaks near nuclei

### vdW

Typical knobs:

- `DF_NAME`
- `--df_params s6 s8 a1 a2`

Important limitation:

- the native `--noLJ` relax path does not expose a separate `AvdW`
- if you need stronger or weaker vdW, regenerate `FFvdW` with different D3 parameters or rescale `FFvdW.npz` deliberately

## Parameter-Sweep Guidance

For a small Pauli sweep, vary one dimension at a time first:

- `Apauli`: try values such as `8, 10, 12, 14`
- `Bpauli`: try values such as `1.0, 1.1, 1.2`
- `density_cutoff`: reduce from `100` to `80` or `60` if boundaries look unstable

Preserve the same:

- geometry
- scan window
- scan step
- charge
- tip model

Otherwise the comparison is noisy.

## Output Expectations

Typical native outputs:

- `FFel.npz`
- `FFLJ.npz` or `FFvdW.npz`
- `FFpauli.npz`
- `Q*/OutFz.npz`
- `Q*/PPpos.npz`
- `Q*/PPdisp.npz`
- `Q*/Amp*/df.npz`
- `Q*/Amp*/df_cbar_*.png`

If the user asks for comparisons, keep the raw `.npz` outputs and save derived plots in a stable `data/` directory.
