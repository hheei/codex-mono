#!/usr/bin/env python3
import argparse
from pathlib import Path

try:
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    import numpy as np
except ModuleNotFoundError as exc:
    matplotlib = None
    plt = None
    np = None
    IMPORT_ERROR = exc
else:
    IMPORT_ERROR = None


def _require_runtime_dependencies() -> None:
    if IMPORT_ERROR is not None:
        raise SystemExit(
            "Missing runtime dependency for planar-average-plot: "
            f"{IMPORT_ERROR.name}. Install numpy and matplotlib to use this command."
        )


DESCRIPTION = 'Compute planar-averaged VASP grid data and plot coord vs value.'


def configure_parser(parser: argparse.ArgumentParser) -> argparse.ArgumentParser:
    parser.add_argument(
        '--file',
        default='LOCPOT',
        help='Path to VASP grid file (e.g. LOCPOT, CHGCAR).',
    )
    parser.add_argument(
        '--axis',
        choices=['x', 'y', 'z'],
        default='z',
        help='Averaging normal direction (default: z).',
    )
    parser.add_argument(
        '--out-data',
        default='{file}_{axis}_planar_avg.dat',
        help='Output data file with columns: coord(Angstrom) avg_value.',
    )
    parser.add_argument(
        '--out-fig',
        default='{file}_{axis}_planar_avg.png',
        help='Output figure path.',
    )
    parser.add_argument(
        '--dpi',
        type=int,
        default=180,
        help='Figure DPI (default: 180).',
    )
    return parser


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=DESCRIPTION)
    return configure_parser(parser)


AXIS_INDEX = {'x': 0, 'y': 1, 'z': 2}


def _read_nonempty_line(f):
    while True:
        line = f.readline()
        if line == '':
            return None
        if line.strip():
            return line


def parse_vasp_grid(vasp_grid_path: Path):
    with vasp_grid_path.open('r') as f:
        # POSCAR-like header
        title = f.readline()
        if title == '':
            raise ValueError('Empty VASP grid file')

        scale = float(f.readline().split()[0])
        lattice = np.array(
            [list(map(float, f.readline().split())) for _ in range(3)],
            dtype=float,
        ) * scale

        species_line = _read_nonempty_line(f)
        if species_line is None:
            raise ValueError('Unexpected EOF after lattice vectors')
        tokens = species_line.split()

        # Handle VASP5 (symbols + counts) and VASP4 (counts only)
        if all(tok.replace('-', '').isdigit() for tok in tokens):
            counts = list(map(int, tokens))
        else:
            counts_line = _read_nonempty_line(f)
            if counts_line is None:
                raise ValueError('Unexpected EOF while reading atom counts')
            counts = list(map(int, counts_line.split()))

        natoms = sum(counts)

        coord_mode_line = _read_nonempty_line(f)
        if coord_mode_line is None:
            raise ValueError('Unexpected EOF before coordinates')

        # Optional selective dynamics line
        if coord_mode_line.strip().lower().startswith('s'):
            coord_mode_line = _read_nonempty_line(f)
            if coord_mode_line is None:
                raise ValueError('Unexpected EOF after selective dynamics line')

        # Skip atomic positions
        for _ in range(natoms):
            pos_line = _read_nonempty_line(f)
            if pos_line is None:
                raise ValueError('Unexpected EOF in atomic positions')

        # Grid dimensions (start of first volumetric dataset)
        dims_line = _read_nonempty_line(f)
        while dims_line is not None and len(dims_line.split()) < 3:
            dims_line = _read_nonempty_line(f)
        if dims_line is None:
            raise ValueError('Could not find volumetric grid dimensions')

        nx, ny, nz = map(int, dims_line.split()[:3])
        n_total = nx * ny * nz

        data = np.empty(n_total, dtype=np.float64)
        filled = 0

        # Read potential values (free-width floats)
        while filled < n_total:
            line = f.readline()
            if line == '':
                break
            parts = line.split()
            if not parts:
                continue
            vals = np.fromstring(' '.join(parts), sep=' ')
            if vals.size == 0:
                continue
            n_take = min(vals.size, n_total - filled)
            data[filled : filled + n_take] = vals[:n_take]
            filled += n_take

        if filled < n_total:
            raise ValueError(
                f'Volumetric data truncated: expected {n_total} values, got {filled}'
            )

    # VASP volumetric order: NX fastest, then NY, then NZ
    vgrid = data.reshape((nz, ny, nx))
    return lattice, (nx, ny, nz), vgrid


def average_along_axis(lattice, dims, vgrid, axis_name):
    axis_name = axis_name.lower()
    if axis_name not in AXIS_INDEX:
        raise ValueError(f'Invalid axis "{axis_name}", choose from x, y, z')

    frac_axis = AXIS_INDEX[axis_name]
    n_axis = dims[frac_axis]
    axis_len = np.linalg.norm(lattice[frac_axis])

    if axis_name == 'z':
        avg = vgrid.mean(axis=(1, 2))
    elif axis_name == 'y':
        avg = vgrid.mean(axis=(0, 2))
    else:
        avg = vgrid.mean(axis=(0, 1))

    coord = (np.arange(n_axis, dtype=float) / n_axis) * axis_len
    return coord, avg


def run(args: argparse.Namespace) -> int:
    _require_runtime_dependencies()
    grid_path = Path(args.file)
    if not grid_path.exists():
        raise FileNotFoundError(f'File not found: {grid_path}')

    template_vars = {
        'file': grid_path.stem,
        'axis': args.axis,
    }
    out_data = Path(args.out_data.format(**template_vars))
    out_fig = Path(args.out_fig.format(**template_vars))

    lattice, dims, vgrid = parse_vasp_grid(grid_path)
    coord, avg = average_along_axis(lattice, dims, vgrid, args.axis)
    nx, ny, nz = dims

    np.savetxt(
        out_data,
        np.column_stack((coord, avg)),
        fmt='%10.6e',
        header=f'{args.axis}(Å) average({grid_path.name})',
        comments='# ',
    )

    plt.figure(figsize=(7.2, 4.6))
    plt.plot(coord, avg, lw=1.4)
    plt.xlabel(f'{args.axis} (Å)')
    plt.ylabel('Average value')
    plt.title(f'Planar average from {grid_path.name}: {args.axis} vs avg')
    plt.grid(alpha=0.3)
    plt.tight_layout()

    plt.savefig(out_fig, dpi=args.dpi)

    print(f'Read grid: NX={nx}, NY={ny}, NZ={nz}')
    print(f'Averaging along axis: {args.axis}')
    print(f'Wrote data: {out_data}')
    print(f'Wrote figure: {out_fig}')
    return 0


def main(argv: list[str] | None = None) -> int:
    return run(build_parser().parse_args(argv))


if __name__ == '__main__':
    raise SystemExit(main())
