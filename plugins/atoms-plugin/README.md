# Atoms Plugin

ASE-based atomistic structure utilities, `vasp-helper` for VASP work, and `ppafm-skill` for PP-AFM simulations from VASP outputs.

## Initialize The Private Source

After installing `atoms-plugin` from the Codex marketplace, initialize the private `hheei/vasp-source` submodule and refresh the plugin cache with the bundled setup script:

```bash
setup_script="$(find "${CODEX_HOME:-$HOME/.codex}/plugins/cache/codex-mono/atoms-plugin" -path '*/scripts/install-vasp-source.sh' -print -quit)"
bash "$setup_script"
```

The script uses the marketplace root registered by Codex, so it does not require a local repository checkout or a hard-coded cache path.
