#!/usr/bin/env python3
"""Prepare a cell-consistent PPAFM LJ + Hartree input from a VASP LOCPOT."""

from pathlib import Path

import h5py
import numpy as np
from pymatgen.io.vasp.outputs import Locpot
from ppafm import io


TARGET_SPACING_A = 0.175


def update_existing_params(path: Path, cell: np.ndarray, grid_zyx: tuple[int, int, int]) -> None:
    lines = path.read_text().splitlines()
    values = {
        line.split(maxsplit=1)[0]: line.split(maxsplit=1)[1]
        for line in lines
        if line.strip() and not line.lstrip().startswith("#") and len(line.split(maxsplit=1)) == 2
    }
    old_a = float(values["gridA"].split()[0])
    old_b = float(values["gridB"].split()[1])
    scan_min = [float(value) for value in values["scanMin"].split()]
    scan_max = [float(value) for value in values["scanMax"].split()]
    scan_min[0] *= cell[0, 0] / old_a
    scan_max[0] *= cell[0, 0] / old_a
    scan_min[1] *= cell[1, 1] / old_b
    scan_max[1] *= cell[1, 1] / old_b
    replacements = {
        "gridN": f"gridN {grid_zyx[2]} {grid_zyx[1]} {grid_zyx[0]}",
        "gridA": f"gridA {cell[0, 0]:.16g} 0.0 0.0",
        "gridB": f"gridB 0.0 {cell[1, 1]:.16g} 0.0",
        "gridC": f"gridC 0.0 0.0 {cell[2, 2]:.16g}",
        "scanMin": "scanMin " + " ".join(f"{value:.6g}" for value in scan_min),
        "scanMax": "scanMax " + " ".join(f"{value:.6g}" for value in scan_max),
    }
    updated = []
    for line in lines:
        parts = line.split(maxsplit=1)
        updated.append(replacements.get(parts[0], line) if parts else line)
    path.write_text("\n".join(updated) + "\n")


def main() -> None:
    locpot = Locpot.from_file("LOCPOT")
    cell = np.asarray(locpot.structure.lattice.matrix, dtype=float)
    if np.max(np.abs(cell - np.diag(np.diag(cell)))) > 1e-8:
        raise ValueError("This helper currently requires an orthogonal VASP cell.")

    potential_zyx = np.transpose(np.asarray(locpot.data["total"], dtype=float), (2, 1, 0))
    lengths_xyz = np.diag(cell)
    target_zyx = np.maximum(1, np.rint(lengths_xyz[::-1] / TARGET_SPACING_A).astype(int))
    stride_zyx = np.maximum(1, np.ceil(np.array(potential_zyx.shape) / target_zyx).astype(int))
    potential_zyx = potential_zyx[:: stride_zyx[0], :: stride_zyx[1], :: stride_zyx[2]]
    lvec = np.vstack([np.zeros(3), cell])

    with h5py.File("locpot_downsample.h5", "w") as out:
        out.create_dataset("data_zyx", data=potential_zyx)
        out.create_dataset("lvec", data=lvec)
        out.attrs["source"] = "LOCPOT"
        out.attrs["axis_order"] = "zyx"
        out.attrs["stride_zyx"] = stride_zyx

    structure_file = "CONTCAR" if Path("CONTCAR").is_file() and Path("CONTCAR").stat().st_size > 0 else "POSCAR"
    xyzs, zs, _ = io.loadPOSCAR(structure_file)
    lattice = " ".join(f"{value:.16g}" for value in cell.ravel())
    io.saveXYZ("input.xyz", xyzs, zs, comment=f'Lattice="{lattice}"')
    top_z = float(xyzs[:, 2].max())
    plot_mask = xyzs[:, 2] > top_z - 6.0
    io.saveXYZ("input_plot.xyz", xyzs[plot_mask], zs[plot_mask], comment=f'Lattice="{lattice}"')

    scan_min_z = top_z + 4.5
    params_path = Path("params.ini")
    if params_path.exists():
        update_existing_params(params_path, cell, tuple(potential_zyx.shape))
        print(f"updated grid and fractional x/y scan range in {params_path}")
        return
    with params_path.open("w") as out:
        out.write(
            f"""PBC True
nPBC 1 1 1
gridN {potential_zyx.shape[2]} {potential_zyx.shape[1]} {potential_zyx.shape[0]}
gridO 0.0 0.0 0.0
gridA {cell[0, 0]} 0.0 0.0
gridB 0.0 {cell[1, 1]} 0.0
gridC 0.0 0.0 {cell[2, 2]}

probeType O
charge -0.10
tip dz2
sigma 0.71

klat 0.50
krad 20.0
r0Probe 0.0 0.0 4.0

scanMin 3.0 3.0 {scan_min_z:.4f}
scanMax {cell[0, 0] - 3.0:.4f} {cell[1, 1] - 3.0:.4f} {scan_min_z + 3.5:.4f}
scanStep 0.2 0.2 0.05

kCantilever 1800.0
f0Cantilever 30300.0
Amplitude 2.0

plotSliceFrom 0
plotSliceTo 70
plotSliceBy 1
colorscale viridis
"""
        )

    print(f"grid_zyx={potential_zyx.shape}, stride_zyx={tuple(stride_zyx)}")
    print(f"top_z={top_z:.4f}, scan_z={scan_min_z:.4f}..{scan_min_z + 3.5:.4f}")


if __name__ == "__main__":
    main()
