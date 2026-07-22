# Source Branch Mapping

This page defines the branch naming convention used by this plugin when discussing the bundled VASP source and its graphify outputs.

## Branch Roles

- `6.6.0`
  - the original baseline
  - use `source/graphify-out/6.6.0/graph.json` for its code graph
- `6.6.0X`
  - the current plugin-modified VASP source line used by this skill
  - use this as the default target when discussing `source/` and its graphify outputs
  - use `source/graphify-out/6.6.0X/graph.json` for its code graph

## Default Rule

If a source-level question does not explicitly name a branch:

- assume `6.6.0X`
- fall back to `6.6.0` only when the question is explicitly about the original baseline or pre-modification behavior

## Graphify Scope

The graphify artifacts are generated independently under `source/graphify-out/6.6.0/` and `source/graphify-out/6.6.0X/`; they must not be mixed when comparing branch behavior.

## Mention the Branch Explicitly When

- the user asks where a feature is implemented
- the plugin-modified source may differ from the original baseline
- the answer draws on graphify output
- the distinction between original and modified behavior matters
