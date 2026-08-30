from __future__ import annotations

from pathlib import Path

import h5py
import numpy as np
from pymatgen.io.vasp.outputs import Chgcar, Locpot, Vaspwave
from ppafm import io


def _is_vasp_hdf5(path: Path) -> bool:
    return path.name.lower() in {"vaspwave.h5", "vaspout.h5"}


def _strip_compression_suffix(path: Path) -> str:
    name = path.name.lower()
    for suffix in (".gz", ".xz"):
        if name.endswith(suffix):
            return name[: -len(suffix)]
    return name


def _is_vaspwave_h5(path: Path) -> bool:
    return _is_vasp_hdf5(path)


def _is_vasp_volumetric(path: Path, kind: str | None = None) -> bool:
    raw_name = _strip_compression_suffix(path)
    if _is_vaspwave_h5(path):
        return True
    if kind == "locpot":
        return raw_name == "locpot"
    if kind == "chgcar":
        return raw_name == "chgcar"
    return raw_name in {"locpot", "chgcar"}


def volumetric_from_path(path: str | Path, kind: str):
    path = Path(path)
    if _is_vaspwave_h5(path):
        vw = Vaspwave(path)
        if kind == "locpot":
            return vw.get_locpot()
        if kind == "chgcar":
            return vw.get_chgcar()
        raise ValueError(f"unsupported kind for vaspwave.h5: {kind}")
    if kind == "locpot":
        return Locpot.from_file(path)
    if kind == "chgcar":
        return Chgcar.from_file(path)
    raise ValueError(f"unsupported kind: {kind}")


def load_density_from_h5(path: str | Path):
    path = Path(path)
    with h5py.File(path, "r") as f:
        if "data_zyx" not in f or "lvec" not in f:
            raise ValueError(f"{path} is not a supported scalar-field h5 file.")
        data = np.array(f["data_zyx"], dtype=float)
        lvec = np.array(f["lvec"], dtype=float)
    n_dim = np.array(data.shape, dtype=np.int32)
    return data, lvec, n_dim


def save_density_to_h5(path: str | Path, data_zyx, lvec, attrs: dict | None = None):
    path = Path(path)
    with h5py.File(path, "w") as f:
        f.create_dataset("data_zyx", data=np.asarray(data_zyx, dtype=float))
        f.create_dataset("lvec", data=np.asarray(lvec, dtype=float))
        if attrs:
            for key, value in attrs.items():
                f.attrs[key] = value


def structure_to_atoms(structure):
    coords = np.array(structure.cart_coords, dtype=float)
    zs = [str(site.specie.symbol) for site in structure]
    qs = [0.0] * len(zs)
    atoms = [zs, list(coords[:, 0]), list(coords[:, 1]), list(coords[:, 2]), qs]
    return atoms


def structure_to_lvec(structure):
    lattice = np.array(structure.lattice.matrix, dtype=float)
    return np.vstack([np.zeros(3, dtype=float), lattice])


def structure_from_vasp_volumetric(path: str | Path):
    path = Path(path)
    if _is_vaspwave_h5(path):
        return Vaspwave(path).get_locpot().structure
    if _strip_compression_suffix(path) == "locpot":
        return Locpot.from_file(path).structure
    if _strip_compression_suffix(path) == "chgcar":
        return Chgcar.from_file(path).structure
    raise ValueError(f"unsupported VASP volumetric input: {path}")


def load_sample_geometry_any(path: str | Path, parameters=None, input_format=None):
    path = Path(path)
    if _is_vasp_volumetric(path):
        structure = structure_from_vasp_volumetric(path)
        atoms = structure_to_atoms(structure)
        lvec = structure_to_lvec(structure)
        return atoms, lvec
    if path.suffix.lower() == ".h5":
        _, lvec, _ = load_density_from_h5(path)
        atoms = [[], [], [], [], []]
        return atoms, lvec
    atoms, _, lvec = io.loadGeometry(
        str(path), format=input_format, parameters=parameters
    )
    return atoms, lvec


def locpot_to_ppafm_arrays(obj):
    # Vaspwave/VolumetricData returns the raw grid with no XSF-style repeated edge.
    # Keep it unpadded in memory. Only ppafm/io XSF serialization should add the
    # periodic repeated boundary planes when writing text XSF on purpose.
    data_xyz = np.array(obj.data["total"], dtype=float)
    data_zyx = np.transpose(data_xyz, (2, 1, 0)).copy()
    lvec = structure_to_lvec(obj.structure)
    n_dim = np.array(data_zyx.shape, dtype=np.int32)
    return data_zyx, lvec, n_dim


def chgcar_to_ppafm_density(obj):
    # Same raw-grid contract as locpot_to_ppafm_arrays(): no cycle padding here.
    data_xyz = np.array(obj.data["total"], dtype=float)
    cell_volume = abs(
        np.linalg.det(np.array(obj.structure.lattice.matrix, dtype=float))
    )
    data_zyx = np.transpose(data_xyz / cell_volume, (2, 1, 0)).copy()
    lvec = structure_to_lvec(obj.structure)
    n_dim = np.array(data_zyx.shape, dtype=np.int32)
    return data_zyx, lvec, n_dim


def make_xsf_head(structure):
    coords = np.array(structure.cart_coords, dtype=float)
    lvec = structure_to_lvec(structure)
    return io.primcoords2Xsf(
        np.array([site.specie.Z for site in structure], dtype=np.int32),
        [coords[:, 0], coords[:, 1], coords[:, 2]],
        lvec,
    )
