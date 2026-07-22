# Source Navigation

This page explains how to navigate the bundled VASP source without jumping directly into raw files.

## Navigation Order

1. Start from the category mapping in `SKILL.md`.
2. Read the relevant category page for the user-facing concept.
3. Use that page's `Implementation Anchors` to narrow the source area.
4. Check `projects/source-branches.md` if branch semantics matter.
5. Use graphify artifacts to reduce the search area before opening raw files under `skills/vasp-helper/vendor/vasp-6.6.0X/src/`.

## Graphify Usage

- `skills/vasp-helper/vendor/vasp-6.6.0X/graphify-gpt54-out/GRAPH_REPORT.md`
  - best human-readable subsystem overview
- `skills/vasp-helper/vendor/vasp-6.6.0X/graphify-gpt54-out/graph.html`
  - best for interactive relationship browsing
- `skills/vasp-helper/vendor/vasp-6.6.0X/graphify-gpt54-out/graph.json`
  - best for exact node/edge lookup
- `skills/vasp-helper/vendor/vasp-6.6.0X/graphify-out/GRAPH_REPORT.md`
  - alternate summary pass
- `skills/vasp-helper/vendor/vasp-6.6.0X/graphify-out/graph.json`
  - alternate machine-readable graph

## Rules

- Do not start by opening many raw source files.
- If a question can be answered from a category page or cached wiki page, do not descend into source.
- Treat graphify as a source-navigation aid, not as a replacement for branch awareness.
