#!/usr/bin/env python3
from __future__ import annotations

import gc
import sys
from pathlib import Path

import numpy as np
from ppafm import common, cpp_utils, io
from ppafm.HighLevel import (
    computeElFF,
    loadValenceElectronDict,
    subtractCoreDensities,
)

from vasp_volumetric import (
    chgcar_to_ppafm_density,
    load_density_from_h5,
    load_sample_geometry_any,
    locpot_to_ppafm_arrays,
    make_xsf_head,
    volumetric_from_path,
)


def _load_sample_potential(path: str, input_format: str):
    path_obj = Path(path)
    if path_obj.suffix.lower() == ".xsf":
        return io.loadXSF(str(path_obj))
    if path_obj.suffix.lower() == ".cube":
        return io.loadCUBE(str(path_obj))
    if path_obj.suffix.lower() == ".h5" and path_obj.name.lower() not in {
        "vaspwave.h5",
        "vaspout.h5",
    }:
        data, lvec, n_dim = load_density_from_h5(path_obj)
        return data, lvec, n_dim, None
    sample_obj = volumetric_from_path(path_obj, "locpot")
    potential, lvec, n_dim = locpot_to_ppafm_arrays(sample_obj)
    return potential, lvec, n_dim, sample_obj


def _load_tip_density(path: str):
    path_obj = Path(path)
    if path_obj.suffix.lower() == ".xsf":
        rho_tip, lvec_tip, _, head_tip = io.loadXSF(str(path_obj))
        return rho_tip, lvec_tip, head_tip, None
    if path_obj.suffix.lower() == ".cube":
        rho_tip, lvec_tip, _, head_tip = io.loadCUBE(str(path_obj), hartree=False)
        return rho_tip, lvec_tip, head_tip, None
    if path_obj.suffix.lower() == ".h5" and path_obj.name.lower() not in {
        "vaspwave.h5",
        "vaspout.h5",
    }:
        rho_tip, lvec_tip, _ = load_density_from_h5(path_obj)
        return rho_tip, lvec_tip, None, None
    tip_obj = volumetric_from_path(path_obj, "chgcar")
    rho_tip, lvec_tip, _ = chgcar_to_ppafm_density(tip_obj)
    return rho_tip, lvec_tip, None, tip_obj


def main(argv=None):
    parser = common.CLIParser(
        description="Generate electrostatic force field from LOCPOT or vaspwave.h5 without writing intermediate LOCPOT files."
    )
    parser.add_arguments(
        [
            "input",
            "input_format",
            "output_format",
            "tip",
            "sigma",
            "Rcore",
            "energy",
            "noPBC",
        ]
    )
    parser.add_argument(
        "--tip_dens",
        action="store",
        type=str,
        default=None,
        help="Use tip density from .xsf or VASP CHGCAR/vaspwave.h5. Overrides --tip.",
    )
    parser.add_argument("--doDensity", action="store_true", help="Do density overlap")
    parser.add_argument("--tilt", action="store", type=float, default=0)
    parser.add_argument(
        "--KPFM_tip",
        action="store",
        type=str,
        default="Fit",
        help="Read tip density under bias, or use Fit/dipole/pz linear approximation.",
    )
    parser.add_argument(
        "--KPFM_sample",
        action="store",
        type=str,
        help="Read sample Hartree potential under bias / external field.",
    )
    parser.add_argument(
        "--Vref",
        action="store",
        type=float,
        help="Reference field strength used for the linear-response normalization.",
    )
    parser.add_argument(
        "--z0",
        action="store",
        type=float,
        default=0.0,
        help="Height of the topmost metallic layer for E-to-V conversion.",
    )
    args = parser.parse_args(argv)

    parameters = common.PpafmParameters.from_file("params.ini")
    parameters.apply_options(vars(args))

    species_path = (
        Path("atomtypes.ini")
        if Path("atomtypes.ini").is_file()
        else cpp_utils.PACKAGE_PATH / "defaults" / "atomtypes.ini"
    )
    common.loadSpecies(species_path)

    sample_potential_data = _load_sample_potential(args.input, args.input_format)
    electrostatic_potential, lvec, n_dim, sample_obj = sample_potential_data
    electrostatic_potential *= -1
    atoms_samp, lvec_samp = load_sample_geometry_any(
        args.input, parameters=parameters, input_format=args.input_format
    )
    if sample_obj is not None and hasattr(sample_obj, "structure"):
        head_samp = make_xsf_head(sample_obj.structure)
    elif len(atoms_samp[0]) > 0:
        head_samp = io.primcoords2Xsf(atoms_samp[0], atoms_samp[1:4], lvec_samp)
    else:
        head_samp = None

    subtract_core_densities = (
        args.doDensity and (args.Rcore > 0.0) and (args.tip_dens is not None)
    )
    rho_tip = None
    if args.tip_dens is not None:
        rho_tip, lvec_tip, _, tip_obj = _load_tip_density(args.tip_dens)
        if subtract_core_densities:
            valence_electrons_dictionary = loadValenceElectronDict()
            tip_structure = tip_obj.structure if tip_obj is not None else None
            if tip_structure is None:
                raise ValueError(
                    "Rcore subtraction with XSF/CUBE tip density is not supported in this skill script."
                )
            coords = tip_structure.cart_coords
            elems = [site.specie.symbol for site in tip_structure]
            subtractCoreDensities(
                rho_tip,
                lvec_tip,
                elems=elems,
                Rs=coords,
                valElDict=valence_electrons_dictionary,
                Rcore=args.Rcore,
                head=None,
            )
        parameters.tip = -rho_tip

    if args.KPFM_sample is not None:
        if args.Vref is None:
            raise ValueError("--Vref is required when using --KPFM_sample.")
        v_kpfm, _, _, _ = _load_sample_potential(args.KPFM_sample, args.input_format)
        v_kpfm *= -1
        dv_kpfm = v_kpfm - electrostatic_potential

        if args.tip_dens is None:
            raise ValueError("--tip_dens is required when using KPFM/sample bias correction.")
        if rho_tip is None:
            raise ValueError("tip density was not loaded.")

        sigma = parameters.sigma
        if args.KPFM_tip.lower().endswith(".xsf") or args.KPFM_tip.lower().endswith(
            ".cube"
        ):
            rho_tip_kpfm, _, _, _ = _load_tip_density(args.KPFM_tip)
            drho_kpfm = rho_tip - rho_tip_kpfm
            v_ref_t = args.Vref
        elif args.KPFM_tip in {"Fit", "fit", "dipole", "pz"}:
            v_ref_t = -0.1
            if parameters.probeType == "8":
                drho_kpfm = {"pz": 0.045}
                sigma = 0.48
            elif parameters.probeType == "47":
                drho_kpfm = {"pz": 0.21875}
                sigma = 0.7
            elif parameters.probeType == "54":
                drho_kpfm = {"pz": 0.250}
                sigma = 0.67
            else:
                raise ValueError(
                    f"KPFM_tip={args.KPFM_tip} is only parameterized for probeType 8/47/54, got {parameters.probeType}."
                )
        else:
            raise ValueError(f"Unsupported --KPFM_tip input: {args.KPFM_tip}")

        ff_kpfm_t0sv, _ = computeElFF(
            dv_kpfm,
            lvec,
            n_dim,
            parameters.tip,
            computeVpot=args.energy,
            tilt=args.tilt,
            parameters=parameters,
        )
        ff_kpfm_tvs0, _ = computeElFF(
            electrostatic_potential,
            lvec,
            n_dim,
            drho_kpfm,
            computeVpot=args.energy,
            tilt=args.tilt,
            sigma=sigma,
            deleteV=False,
            parameters=parameters,
        )

        zpos = np.linspace(
            lvec[0, 2] - args.z0,
            lvec[0, 2] + lvec[3, 2] - args.z0,
            n_dim[0],
        )
        for i in range(n_dim[0]):
            zpos[i] %= lvec[3, 2]
            ff_kpfm_t0sv[i, :, :] = ff_kpfm_t0sv[i, :, :] / (
                args.Vref * (zpos[i] + 0.1)
            )
            ff_kpfm_tvs0[i, :, :] = ff_kpfm_tvs0[i, :, :] / (
                v_ref_t * (zpos[i] + 0.1)
            )

        io.save_vec_field(
            "FFkpfm_t0sV",
            ff_kpfm_t0sv,
            lvec_samp,
            data_format=args.output_format,
            head=head_samp,
            atomic_info=(atoms_samp[:4], lvec_samp),
        )
        io.save_vec_field(
            "FFkpfm_tVs0",
            ff_kpfm_tvs0,
            lvec_samp,
            data_format=args.output_format,
            head=head_samp,
            atomic_info=(atoms_samp[:4], lvec_samp),
        )

    ff_electrostatic, e_electrostatic = computeElFF(
        electrostatic_potential,
        lvec,
        n_dim,
        parameters.tip,
        computeVpot=args.energy,
        tilt=args.tilt,
        parameters=parameters,
    )

    io.save_vec_field(
        "FFel",
        ff_electrostatic,
        lvec_samp,
        data_format=args.output_format,
        head=head_samp,
        atomic_info=((atoms_samp[:4], lvec_samp) if len(atoms_samp[0]) > 0 else None),
    )
    if args.energy:
        io.save_scal_field(
            "Eel",
            e_electrostatic,
            lvec_samp,
            data_format=args.output_format,
            head=head_samp,
            atomic_info=((atoms_samp[:4], lvec_samp) if len(atoms_samp[0]) > 0 else None),
        )
    del e_electrostatic, ff_electrostatic
    gc.collect()


if __name__ == "__main__":
    main(sys.argv[1:])
