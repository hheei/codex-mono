# Source Branch Mapping

This page defines the branch naming convention used by this plugin when discussing the bundled VASP source and its graphify outputs.

## Branch Roles

- `main`
  - the original baseline
  - treat the first version-defining commit as the original reference point
- `6.6.0X`
  - the current plugin-modified VASP source line used by this skill
  - use this as the default target when discussing `skills/vasp-helper/vendor/vasp-6.6.0X/` and its graphify outputs

## Default Rule

If a source-level question does not explicitly name a branch:

- assume `6.6.0X`
- fall back to `main` only when the question is explicitly about the original baseline or pre-modification behavior

## Graphify Scope

The graphify artifacts under `skills/vasp-helper/vendor/vasp-6.6.0X/` describe the `6.6.0X` branch view, not the original `main` baseline.

## Mention the Branch Explicitly When

- the user asks where a feature is implemented
- the plugin-modified source may differ from the original baseline
- the answer draws on graphify output
- the distinction between original and modified behavior matters
