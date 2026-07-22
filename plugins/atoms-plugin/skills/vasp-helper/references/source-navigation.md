# Source Navigation

This page explains how to navigate the bundled VASP source without jumping directly into raw files.

## Navigation Order

1. Start from the category mapping in `SKILL.md`.
2. Read the relevant category page for the user-facing concept.
3. Use that page's `Implementation Anchors` to narrow the source area.
4. Check `projects/source-branches.md` if branch semantics matter.
5. Use graphify artifacts to reduce the search area before opening raw files under `skills/vasp-helper/source/src/`.

## Graphify Usage

- `skills/vasp-helper/source/graphify-out/6.6.0X/graph.json` is the default plugin-modified graph.
- `skills/vasp-helper/source/graphify-out/6.6.0/graph.json` is the independent original-baseline graph.
- Pass the branch-specific file with `graphify query`, `graphify path`, or `graphify explain`; do not compare nodes across the two graphs implicitly.

## Rules

- Do not start by opening many raw source files.
- If a question can be answered from a category page or cached wiki page, do not descend into source.
- Treat graphify as a source-navigation aid, not as a replacement for branch awareness.
