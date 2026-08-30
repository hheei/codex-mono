#!/usr/bin/env bash
set -euo pipefail

export MPLBACKEND=Agg
export UV_OFFLINE=1

uv run --no-project --offline --with ppafm --with pymatgen --with h5py --with numpy \
  python prepare_lj_hartree_from_locpot.py
uv run --no-project --offline --with ppafm --with pymatgen --with h5py --with numpy \
  python generate_elff.py -i locpot_downsample.h5 -f npy -t dz2 -w 0.71
uv tool run --offline --from ppafm ppafm-generate-ljff -i input.xyz -F xyz -f npy
uv tool run --offline --from ppafm ppafm-relaxed-scan -f npy --pos
uv tool run --offline --from ppafm ppafm-plot-results -f npy --df --save_df --cbar --atoms
