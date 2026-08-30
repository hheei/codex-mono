#!/usr/bin/env python3
from __future__ import annotations

import gc
import sys
from pathlib import Path

import numpy as np
from ppafm import common, fieldFFT, io

from vasp_volumetric import (
    chgcar_to_ppafm_density,
    make_xsf_head,
    volumetric_from_path,
)


def handle_negative_density(rho):
    q = rho.sum()
    rho[rho < 0] = 0
    rho *= q / rho.sum()


def load_density(path: str):
    path_obj = Path(path)
    if path_obj.suffix.lower() == ".xsf":
        data, lvec, n_dim, head = io.loadXSF(str(path_obj), xyz_order=False)
        return data, lvec, n_dim, head
    obj = volumetric_from_path(path_obj, "chgcar")
    data, lvec, n_dim = chgcar_to_ppafm_density(obj)
    head = make_xsf_head(obj.structure)
    return data, lvec, n_dim, head


def main(argv=None):
    parser = common.CLIParser(
        description="Calculate Pauli force field from XSF, CHGCAR, or vaspwave.h5 without writing intermediate CHGCAR files."
    )
    parser.add_argument("-s", "--sample", action="store", required=True)
    parser.add_argument("-t", "--tip", action="store", required=True)
    parser.add_argument("-o", "--output", action="store", default="pauli")
    parser.add_argument("--saveDebugXsfs", action="store_true")
    parser.add_argument("--no_negative_check", action="store_true")
    parser.add_argument("--density_cutoff", action="store", default=None, type=float)
    parser.add_arguments(["output_format", "energy", "Apauli", "Bpauli"])
    args = parser.parse_args(argv)

    rho_sample, lvec_sample, n_dim_sample, head_sample = load_density(args.sample)
    rho_tip, lvec_tip, n_dim_tip, head_tip = load_density(args.tip)

    if np.any(n_dim_sample != n_dim_tip):
        raise ValueError(
            f"Tip and sample grids have different dimensions: {n_dim_sample} vs {n_dim_tip}"
        )
    if np.any(lvec_sample != lvec_tip):
        raise ValueError("Tip and sample grids have different lattice vectors.")

    if args.Bpauli > 0.0:
        if not args.no_negative_check:
            handle_negative_density(rho_sample)
            handle_negative_density(rho_tip)
        rho_sample[:, :, :] = rho_sample[:, :, :] ** args.Bpauli
        rho_tip[:, :, :] = rho_tip[:, :, :] ** args.Bpauli
        if args.saveDebugXsfs:
            io.save_scal_field(
                f"sample_density_pow_{args.Bpauli:03.3f}.xsf",
                rho_sample,
                lvec_sample,
                data_format=args.output_format,
                head=head_sample,
            )
            io.save_scal_field(
                f"tip_density_pow_{args.Bpauli:03.3f}.xsf",
                rho_tip,
                lvec_tip,
                data_format=args.output_format,
                head=head_tip,
            )

    if args.density_cutoff:
        rho_sample[rho_sample > args.density_cutoff] = args.density_cutoff
        rho_tip[rho_tip > args.density_cutoff] = args.density_cutoff

    f_x, f_y, f_z, energy = fieldFFT.potential2forces_mem(
        rho_sample,
        lvec_sample,
        n_dim_sample,
        rho=rho_tip,
        doForce=True,
        doPot=True,
        deleteV=True,
    )
    if args.energy:
        io.save_scal_field(
            "E" + args.output,
            energy * args.Apauli,
            lvec_sample,
            data_format=args.output_format,
            head=head_sample,
        )
    force_field = io.packVecGrid(
        f_x * args.Apauli, f_y * args.Apauli, f_z * args.Apauli
    )
    io.save_vec_field(
        "FF" + args.output,
        force_field,
        lvec_sample,
        data_format=args.output_format,
        head=head_sample,
    )
    del energy, force_field
    gc.collect()


if __name__ == "__main__":
    main(sys.argv[1:])
