# Codex skill token alternatives

## Finding

No community SKILL found that replaces Codex's native startup tool-schema catalog. Native Codex already progressively loads skill bodies, while startup metadata remains cataloged. Community projects are mainly routers, managers, or analyzers.

## Candidates

- [Skill Orchestrator](https://github.com/Andrej1707/skill-orchestrator): routes specialist skills and reduces full-body loads; cannot reduce the native startup catalog.
- [ccski](https://github.com/jixoai/ccski): enable/disable and deduplicate skills; useful for pruning, but does not change Codex's injection algorithm.
- [Skrills](https://github.com/athola/skrills): analyzes token-heavy skills; diagnostic only.
- [skilldigest](https://github.com/JSLEEKR/skilldigest): offline token/dead-skill analysis; no runtime replacement.
- [Token Optimizer](https://github.com/alexgreensh/token-optimizer): reduces tool-output/re-read waste, not startup schemas; may add hooks/context.

Open Codex issues [#33945](https://github.com/openai/codex/issues/33945) and [#21425](https://github.com/openai/codex/issues/21425) request task-aware lazy routing and per-session skill metadata controls; neither is implemented as a supported replacement.
