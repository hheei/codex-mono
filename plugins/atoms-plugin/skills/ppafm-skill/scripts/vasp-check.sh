#!/usr/bin/env bash

# Reports the inputs available for PPAFM; it never creates or changes files.
set -u

usage() {
  echo "usage: $0 VASP_DIRECTORY" >&2
  exit 64
}

[[ $# -eq 1 ]] || usage
directory="$1"
[[ -d "$directory" ]] || { echo "DIRECTORY=missing"; exit 64; }

first_file() {
  local candidate
  for candidate in "$@"; do
    if [[ -s "$directory/$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

structure="$(first_file CONTCAR POSCAR || true)"
potential="$(first_file LOCPOT LOCPOT.gz LOCPOT.xz vaspwave.h5 || true)"
density="$(first_file CHGCAR CHGCAR.gz CHGCAR.xz vaspwave.h5 || true)"

tip_density="$(first_file rhoTip.xsf rhoTip.raw.xsf rhoTip.xsf.gz tip.CHGCAR tip.vaspwave.h5 || true)"

elements=""
if [[ -n "$structure" ]]; then
  elements="$(awk '
    NR == 6 {
      for (i = 1; i <= NF; i++) {
        if ($i !~ /^[0-9]+$/ && !seen[$i]++) out = out (out ? " " : "") $i
      }
      print out
      exit
    }
  ' "$directory/$structure")"
fi
if [[ -z "$elements" && -s "$directory/POTCAR" ]]; then
  elements="$(awk '
    /TITEL[[:space:]]*=/ {
      for (i = 1; i <= NF; i++) {
        if ($i ~ /^PAW/) {
          element = $(i + 1)
          sub(/_.*/, "", element)
          if (!seen[element]++) out = out (out ? " " : "") element
        }
      }
    }
    END { print out }
  ' "$directory/POTCAR")"
fi

printf 'DIRECTORY=%s\n' "$directory"
printf 'STRUCTURE=%s\n' "${structure:-missing}"
printf 'ELEMENTS=%s\n' "${elements:-unknown}"
printf 'HARTREE_POTENTIAL=%s\n' "${potential:-missing}"
printf 'SAMPLE_DENSITY=%s\n' "${density:-missing}"
printf 'TIP_DENSITY=%s\n' "${tip_density:-missing}"

if [[ -n "$structure" ]]; then
  printf 'LJ_POINT_CHARGE=ready\n'
else
  printf 'LJ_POINT_CHARGE=missing-structure\n'
fi
if [[ -n "$structure" && -n "$potential" ]]; then
  printf 'LJ_HARTREE=ready\n'
else
  printf 'LJ_HARTREE=missing-structure-or-potential\n'
fi
if [[ -n "$structure" && -n "$potential" && -n "$density" && -n "$tip_density" ]]; then
  printf 'FULL_DENSITY=ready\n'
else
  printf 'FULL_DENSITY=missing-structure-potential-density-or-tip-density\n'
fi
