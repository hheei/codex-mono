#!/usr/bin/env python3
from __future__ import annotations

import gc
import sys

from ppafm import common, core, io
from ppafm import common as PPU
from ppafm.defaults import d3
from ppafm.HighLevel import prepareArrays, shift_positions

from vasp_volumetric import (
    structure_from_vasp_volumetric,
    structure_to_atoms,
    structure_to_lvec,
)


def main(argv=None):
    parser = common.CLIParser(
        description="Generate DFT-D3 vdW force field from XSF/CUBE or from vaspwave.h5 geometry without writing intermediate files."
    )
    parser.add_arguments(["input", "input_format", "output_format", "noPBC", "energy"])
    parser.add_argument("--df_name", action="store", default="PBE")
    parser.add_argument(
        "--df_params",
        action="store",
        default=None,
        nargs=4,
        type=float,
        metavar=("s6", "s8", "a1", "a2"),
    )
    args = parser.parse_args(argv)

    parameters = common.PpafmParameters.from_file("params.ini")
    parameters.apply_options(vars(args))

    if args.df_params is not None:
        p = args.df_params
        df_params = {"s6": p[0], "s8": p[1], "a1": p[2], "a2": p[3]}
    else:
        if args.df_name not in d3.DF_DEFAULT_PARAMS:
            raise ValueError(f"Unknown functional name `{args.df_name}`")
        df_params = args.df_name

    if args.input.lower().endswith(".h5") or args.input.split("/")[-1].lower() in {
        "locpot",
        "locpot.gz",
        "locpot.xz",
        "chgcar",
        "chgcar.gz",
        "chgcar.xz",
    }:
        structure = structure_from_vasp_volumetric(args.input)
        atoms = structure_to_atoms(structure)
        lvec = structure_to_lvec(structure)
        elem_dict = PPU.getFFdict(PPU.loadSpecies())
        iZs, Rs, _ = PPU.parseAtoms(
            atoms,
            elem_dict,
            autogeom=False,
            PBC=parameters.PBC,
            lvec=lvec,
            parameters=parameters,
        )
        iPP = PPU.atom2iZ(parameters.probeType, elem_dict)
        coeffs = core.computeD3Coeffs(Rs, iZs, iPP, d3.get_df_params(df_params))
        FF, V = prepareArrays(None, args.energy, parameters=parameters)
        core.setFF_shape(FF.shape, lvec, parameters=parameters)
        core.getDFTD3FF(shift_positions(Rs, -lvec[0]), coeffs)
        atom_string = io.primcoords2Xsf(
            PPU.atoms2iZs(atoms[0], elem_dict), atoms[1:4], lvec
        )
        io.save_vec_field(
            "FFvdW",
            FF,
            lvec,
            data_format=args.output_format,
            head=atom_string,
            atomic_info=(atoms[:4], lvec),
        )
        if args.energy:
            io.save_scal_field(
                "EvdW",
                V,
                lvec,
                data_format=args.output_format,
                head=atom_string,
                atomic_info=(atoms[:4], lvec),
            )
    else:
        from ppafm.HighLevel import computeDFTD3

        computeDFTD3(
            args.input,
            df_params=df_params,
            geometry_format=args.input_format,
            save_format=args.output_format,
            compute_energy=args.energy,
            parameters=parameters,
        )

    gc.collect()


if __name__ == "__main__":
    main(sys.argv[1:])
