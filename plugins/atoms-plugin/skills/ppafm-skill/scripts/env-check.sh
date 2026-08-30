#!/usr/bin/env bash

# Reports only; it never installs packages or changes the remote host.
set -u

if [[ $# -ne 0 ]]; then
  echo "usage: $0" >&2
  exit 64
fi

failed=0

require_command() {
  local name="$1"
  local label="$2"
  if command -v "$name" >/dev/null 2>&1; then
    printf '%s=ok\n' "$label"
  else
    printf '%s=missing\n' "$label"
    failed=1
  fi
}

printf 'HOST=%s\n' "$(hostname 2>/dev/null || printf unknown)"
require_command uv UV
require_command sbatch SBATCH
require_command squeue SQUEUE
require_command sinfo SINFO
require_command srun SRUN

if command -v uv >/dev/null 2>&1; then
if uv run --no-project --offline --with ppafm --with pymatgen python -c 'import ppafm; from pymatgen.io.vasp.outputs import Locpot' >/dev/null 2>&1; then
    printf 'PPAFM_UV_CACHE=ok\n'
  else
    printf 'PPAFM_UV_CACHE=missing\n'
    failed=1
  fi
else
  printf 'PPAFM_UV_CACHE=unavailable\n'
fi

partition=""
idle_nodes=0
if command -v sinfo >/dev/null 2>&1; then
  candidate="$(sinfo -h -o '%P|%a|%D|%t' 2>/dev/null | awk -F'|' '
    tolower($2) == "up" && tolower($4) == "idle" {
      name = $1
      sub(/\\*$/, "", name)
      nodes[name] += $3
    }
    END {
      for (name in nodes) {
        if (nodes[name] > best) {
          best = nodes[name]
          chosen = name
        }
      }
      if (chosen != "") print chosen "|" best
    }
  ')"
  if [[ -n "$candidate" ]]; then
    partition="${candidate%%|*}"
    idle_nodes="${candidate##*|}"
  else
    failed=1
  fi
fi

printf 'RECOMMENDED_PARTITION=%s\n' "$partition"
printf 'RECOMMENDED_PARTITION_IDLE_NODES=%s\n' "$idle_nodes"

if [[ $failed -eq 0 ]]; then
  printf 'STATUS=ok\n'
  exit 0
fi

printf 'STATUS=missing-prerequisite\n'
exit 2
