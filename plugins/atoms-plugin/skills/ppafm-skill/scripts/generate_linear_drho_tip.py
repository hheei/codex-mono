#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from ppafm import io

from vasp_volumetric import (
    chgcar_to_ppafm_density,
    load_density_from_h5,
    make_xsf_head,
    save_density_to_h5,
    volumetric_from_path,
)


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if len(argv) < 1:
        raise SystemExit(
            "Usage: generate_linear_drho_tip.py TIP_CHGCAR_OR_H5 [SCALE] [OUT_PREFIX]"
        )
    src = Path(argv[0])
    scale = float(argv[1]) if len(argv) >= 2 else 1.0
    out_prefix = Path(argv[2]) if len(argv) >= 3 else Path("drho_tip_linear")

    if src.suffix.lower() == ".h5" and src.name.lower() not in {
        "vaspwave.h5",
        "vaspout.h5",
    }:
        rho_zyx, lvec, n_dim = load_density_from_h5(src)
        head = None
    else:
        obj = volumetric_from_path(src, "chgcar")
        rho_zyx, lvec, n_dim = chgcar_to_ppafm_density(obj)
        head = make_xsf_head(obj.structure)

    dz = np.linalg.norm(lvec[3]) / n_dim[0]
    drho = scale * np.gradient(rho_zyx, dz, axis=0)

    save_density_to_h5(
        out_prefix.with_suffix(".h5"),
        drho,
        lvec,
        attrs={
            "source": str(src),
            "scale": scale,
            "convention": "no_roll_o_at_0_c_at_plus_z",
            "axis_order": "zyx",
        },
    )
    io.save_scal_field(
        str(out_prefix),
        drho,
        lvec,
        data_format="xsf",
        head=head,
    )


if __name__ == "__main__":
    main()
