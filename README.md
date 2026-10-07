# Instruction Router

A zero-dependency Node 20+ lab for the article *"You Don't Have a Prompting
Problem — You Have an Instruction-Routing Problem."* Companion repo to the
LinkedIn piece; companion to `examples/` fixtures.

## What it proves

Coding-agent configuration surfaces (`CLAUDE.md`, scoped rules, skills,
subagents, hooks) differ on two axes: **when the instruction loads** and
**whether anything enforces it**. The lab makes the routing decision explicit
and then shows the two canonical misroutes costing real turns:

- `public/router.mjs` — `routeInstruction()` walks five questions in
  precedence order (enforcement first — only hooks guarantee execution) and
  returns the surface plus the full trace. `auditPlacement()` names the
  failure: `enforcement-gap`, `over-enforcement`, `context-tax`,
  `coverage-gap`, `context-pollution`.
- `simulatePlacement()` runs 100 seeded turns per placement and counts loads,
  missed turns, context tokens paid, and violations — watch `no-env-commit`
  in `CLAUDE.md` get loaded every turn and still violated, while the hook
  placement pays zero tokens and misses nothing.
- `examples/misrouted.json` — a deliberately wrong `.claude/` layout (six
  misplacements); `npm run report` audits each and exits 1 on drift.

## Run it

```bash
npm start      # lab on :3000 (PORT env to override)
npm run report # CLI: routing table + misroute audit
npm test       # node --test "test/*.test.mjs"
npm run check  # tests + report (Render buildCommand)
```

## Layout

- `app/server.js` — allowlist static server + `/health`, `/version`,
  `/instructions.json`, `/misrouted.json`, CSP headers.
- `public/` — `router.mjs` (the model), `index.html` (lab), `guide.html`,
  `app.js`, `styles.css`.
- `examples/instructions.json` — 11-instruction catalog covering all five
  surfaces plus a prompt counter-example.
- `examples/misrouted.json` — the wrong layout to audit.
- `scripts/report.mjs` — CLI side-by-side report.
- `test/` — router precedence, audit labels, catalog parity, server contract.

## Honest limits

- Advisory compliance is **simulated** (92%, a documented constant in
  `router.mjs`), not measured against a real model. The lab reproduces the
  *shape* of each failure — the exact rate depends on your model and prompt.
- Hooks enforce only **checkable** rules at defined events; real hook APIs
  (matchers, exit codes, tool names) differ per harness.
- Scoped-rule loads are modeled by `scopeRate` (fraction of turns the glob
  matches) and skill loads by `relevance` — real globs and triggers have
  false positives and misses beyond that.
- The router teaches the *decision*, not any one tool's file layout —
  `CLAUDE.md`, `.cursor/rules/`, `AGENTS.md` are treated as one surface each.
