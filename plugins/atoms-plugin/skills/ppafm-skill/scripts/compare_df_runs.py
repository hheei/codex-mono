#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path

import matplotlib
import numpy as np

matplotlib.use("Agg")
import matplotlib.pyplot as plt


def infer_run_root(df_path: Path) -> Path:
    for parent in df_path.resolve().parents:
        if (parent / "params.ini").is_file():
            return parent
    raise FileNotFoundError(f"could not infer run root from {df_path}")


def read_param_vector(params_path: Path, name: str) -> list[float]:
    for line in params_path.read_text().splitlines():
        stripped = line.split("#", 1)[0].strip()
        if not stripped.startswith(name):
            continue
        parts = stripped.split()
        return [float(parts[1]), float(parts[2]), float(parts[3])]
    raise ValueError(f"missing {name} in {params_path}")


def read_param_scalar(params_path: Path, name: str) -> float:
    for line in params_path.read_text().splitlines():
        stripped = line.split("#", 1)[0].strip()
        if not stripped.startswith(name):
            continue
        parts = stripped.split()
        return float(parts[1])
    raise ValueError(f"missing {name} in {params_path}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Compare two ppafm df.npz files and render old/new/delta panels."
    )
    parser.add_argument("--old", required=True, type=Path, help="Older df.npz file.")
    parser.add_argument("--new", required=True, type=Path, help="Newer df.npz file.")
    parser.add_argument(
        "--outdir",
        type=Path,
        default=Path("comparison-output"),
        help="Directory where delta_df.npz and PNG slices are written.",
    )
    parser.add_argument(
        "--label-old",
        type=str,
        default=None,
        help="Label for the old run. Defaults to the parent run folder name.",
    )
    parser.add_argument(
        "--label-new",
        type=str,
        default=None,
        help="Label for the new run. Defaults to the parent run folder name.",
    )
    parser.add_argument(
        "--params",
        type=Path,
        default=None,
        help="params.ini used to recover scanMin, scanStep, and Amplitude. Defaults to the nearest ancestor params.ini for --new.",
    )
    args = parser.parse_args()

    old_path = args.old.resolve()
    new_path = args.new.resolve()
    old_root = infer_run_root(old_path)
    new_root = infer_run_root(new_path)
    params_path = args.params.resolve() if args.params is not None else new_root / "params.ini"
    if not params_path.is_file():
        raise FileNotFoundError(f"missing params.ini: {params_path}")

    old = np.load(old_path)
    new = np.load(new_path)
    old_data = np.asarray(old["data"], dtype=float)
    new_data = np.asarray(new["data"], dtype=float)
    if old_data.shape != new_data.shape:
        raise ValueError(f"shape mismatch: {old_data.shape} vs {new_data.shape}")

    delta = new_data - old_data
    if not np.array_equal(np.asarray(old["lvec"]), np.asarray(new["lvec"])):
        raise ValueError("lvec mismatch between the two df files")

    args.outdir.mkdir(parents=True, exist_ok=True)
    np.savez(
        args.outdir / "delta_df.npz",
        data=delta,
        lvec=np.asarray(new["lvec"]),
        atoms=np.asarray(new["atoms"]),
        lvec0=np.asarray(new["lvec0"]),
    )

    scan_min = read_param_vector(params_path, "scanMin")
    scan_step = read_param_vector(params_path, "scanStep")
    amplitude = read_param_scalar(params_path, "Amplitude")

    x0, y0 = scan_min[0], scan_min[1]
    x1 = x0 + scan_step[0] * (delta.shape[2] - 1)
    y1 = y0 + scan_step[1] * (delta.shape[1] - 1)
    tip_z = scan_min[2] + np.arange(delta.shape[0]) * scan_step[2] + amplitude / 2.0
    old_label = args.label_old or old_root.name
    new_label = args.label_new or new_root.name

    for i, z in enumerate(tip_z):
        vmin_old, vmax_old = float(np.min(old_data[i])), float(np.max(old_data[i]))
        vmin_new, vmax_new = float(np.min(new_data[i])), float(np.max(new_data[i]))
        vmin_delta, vmax_delta = float(np.min(delta[i])), float(np.max(delta[i]))
        if vmin_old == vmax_old:
            vmin_old, vmax_old = vmin_old - 1.0, vmax_old + 1.0
        if vmin_new == vmax_new:
            vmin_new, vmax_new = vmin_new - 1.0, vmax_new + 1.0
        if vmin_delta == vmax_delta:
            vmin_delta, vmax_delta = vmin_delta - 1.0, vmax_delta + 1.0

        fig, axes = plt.subplots(1, 3, figsize=(13.5, 4.8), dpi=160, constrained_layout=True)
        panels = [
            (old_data[i], vmin_old, vmax_old, old_label, "gray", "df [Hz]"),
            (new_data[i], vmin_new, vmax_new, new_label, "gray", "df [Hz]"),
            (delta[i], vmin_delta, vmax_delta, f"{new_label} - {old_label}", "seismic", "Δdf [Hz]"),
        ]
        for ax, (panel, vmin, vmax, title, cmap, cbar_label) in zip(axes, panels):
            im = ax.imshow(
                panel,
                origin="lower",
                extent=(x0, x1, y0, y1),
                cmap=cmap,
                vmin=vmin,
                vmax=vmax,
                interpolation="nearest",
            )
            ax.set_xlabel("Tip_x Å")
            ax.set_ylabel("Tip_y Å")
            ax.set_title(title)
            fig.colorbar(im, ax=ax, label=cbar_label)
        fig.suptitle(f"Tip_z = {z:.2f} Å")
        fig.savefig(args.outdir / f"delta_df_{i:03d}.png")
        plt.close(fig)

    print(f"wrote {args.outdir / 'delta_df.npz'}")
    print(f"wrote {delta.shape[0]} PNG slices to {args.outdir}")


if __name__ == "__main__":
    main()
