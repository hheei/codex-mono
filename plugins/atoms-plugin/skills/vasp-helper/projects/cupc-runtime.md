# CuPC Runtime Project Note

This page is project-specific. It records the local runtime assumptions for the CuPC host environment.

## Runtime Notes

- On CuPC host, `module add vasp/6.6.0X` exposes:
  - `vaspkit`
  - `bader`
  - `chgsum.pl`
  - `v2xsf`
- Do not assume separate `bader` or `vaspkit` modules exist there.
- Some plotting workflows may also rely on a local Python or conda environment.

## Typical Commands

```bash
source ~/.bashrc
module add vasp/6.6.0X
command -v vaspkit bader chgsum.pl v2xsf
```

```bash
export MPLCONFIGDIR=/tmp/mplconfig_$USER
mkdir -p "$MPLCONFIGDIR"
```

## When To Use This Page

- when the answer depends on the actual CuPC module layout
- when a workflow assumes this host's tool exposure
- when debugging local runtime mismatches between generic docs and the CuPC machine

## Related General Pages

- [../references/platform-runtime.md](../references/platform-runtime.md)
- [../references/density-postprocess.md](../references/density-postprocess.md)
