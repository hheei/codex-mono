#!/usr/bin/env bash

# Prepare a new PPAFM run from a validated template without overwriting files.
set -euo pipefail

usage() {
  echo "usage: $0 VASP_DIRECTORY OUTPUT_DIRECTORY VALIDATED_TEMPLATE_DIRECTORY" >&2
  exit 64
}

[[ $# -eq 3 ]] || usage
vasp_dir="$(cd -- "$1" && pwd -P)"
template_dir="$(cd -- "$3" && pwd -P)"
output_parent="$(cd -- "$(dirname -- "$2")" && pwd -P)"
output_dir="$output_parent/$(basename -- "$2")"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

[[ -d "$vasp_dir" && -d "$template_dir" ]] || {
  echo "ERROR=vasp-or-template-directory-missing" >&2
  exit 1
}
[[ ! -e "$output_dir" ]] || {
  echo "ERROR=output-directory-already-exists" >&2
  exit 1
}

run_source="$template_dir"
run_script="${PPAFM_RUN_SCRIPT:-}"
if [[ -n "$run_script" ]]; then
  [[ "$run_script" != */* && -s "$script_dir/$run_script" ]] || {
    echo "ERROR=unknown-skill-run-script" >&2
    exit 1
  }
  run_source="$script_dir"
else
  for candidate in run_lj_hartree.sh run_ppafm.sh; do
    if [[ -s "$template_dir/$candidate" ]]; then
      run_script="$candidate"
      break
    fi
  done
  if [[ -z "$run_script" ]]; then
    run_script="$(find "$template_dir" -maxdepth 1 -type f -name 'run*.sh' -print -quit)"
    [[ -n "$run_script" ]] && run_script="$(basename "$run_script")"
  fi
  [[ -n "$run_script" && -s "$template_dir/params.ini" ]] || {
    echo "ERROR=template-needs-params-and-run-script" >&2
    exit 1
  }
fi
bash -n "$run_source/$run_script" || {
  echo "ERROR=run-script-syntax" >&2
  exit 1
}

mkdir "$output_dir"
link_input() {
  local name="$1"
  if [[ -s "$vasp_dir/$name" ]]; then
    ln -s "$vasp_dir/$name" "$output_dir/$name"
  fi
}

link_input CONTCAR
link_input POSCAR
link_input LOCPOT
link_input LOCPOT.gz
link_input LOCPOT.xz
link_input CHGCAR
link_input CHGCAR.gz
link_input CHGCAR.xz
link_input vaspwave.h5

for name in params.ini atomtypes.ini input.xyz input_plot.xyz rhoTip.xsf rhoTip.raw.xsf \
  rhoTip_on_sample_grid.xsf locpot_downsample.h5 LOCPOT.xsf CHGCAR.xsf \
  prepare_inputs.py generate_elff.py vasp_volumetric.py; do
  if [[ -s "$template_dir/$name" ]]; then
    cp -p "$template_dir/$name" "$output_dir/$name"
  fi
done

if [[ "$run_source" == "$script_dir" ]]; then
  for name in generate_elff.py vasp_volumetric.py prepare_lj_hartree_from_locpot.py "$run_script"; do
    cp -p "$script_dir/$name" "$output_dir/$name"
  done
else
  cp -p "$run_source/$run_script" "$output_dir/$run_script"
fi

cat > "$output_dir/job.sh" <<EOF
#!/usr/bin/env bash
#SBATCH --job-name=ppafm
#SBATCH --nodes=1
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=8
#SBATCH --time=12:00:00
#SBATCH --output=ppafm-%j.out

set -euo pipefail
export MPLBACKEND=Agg
export OMP_NUM_THREADS="\${SLURM_CPUS_PER_TASK}"
export MKL_NUM_THREADS="\${SLURM_CPUS_PER_TASK}"
export OPENBLAS_NUM_THREADS="\${SLURM_CPUS_PER_TASK}"
export NUMEXPR_NUM_THREADS="\${SLURM_CPUS_PER_TASK}"
export UV_OFFLINE=1
cd "\${SLURM_SUBMIT_DIR}"
bash "$run_script"
EOF

printf 'OUTPUT_DIRECTORY=%s\n' "$output_dir"
printf 'RUN_SCRIPT=%s\n' "$run_script"
printf 'SBATCH_FILE=%s\n' "$output_dir/job.sh"
