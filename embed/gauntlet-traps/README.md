# @gauntlet/traps — Embeddable WebMCP Trap Library

The Gauntlet's trap catalog as a standalone, dependency-free ES module that
any WebMCP / MCP developer can install and run against their own tool
surface. Same trap definitions, same scoring engine, same attack-class
taxonomy that powers the public range at https://gauntlet.jackcoates.co.uk.

## Why

Tool surfaces (MCP/WebMCP) fail in predictable ways: hostile tool
descriptions, look-alike tool names, injection smuggled in tool results,
excessive agency, and credential leakage. This package gives you those
attack classes as executable tests — no server, no build step, no runtime
dependencies.

## Install

Copy the module into your project (single file, ~10 KB):

```sh
curl -O https://raw.githubusercontent.com/JackCoates1/the-gauntlet/main/embed/gauntlet-traps/traps.mjs
```

or vendor it:

```sh
npm install github:JackCoates1/the-gauntlet --prefix ./vendor
# import from vendor/the-gauntlet/embed/gauntlet-traps/traps.mjs
```

## Usage

```js
import { evaluate, engagement, TRAP_DEFS } from './traps.mjs';

// 1. Record the tool-call sequence your WebMCP surface produced.
const events = [
  { tool: 'sessionStarted', args: {}, createdAt: '2026-09-02T12:00:00Z' },
  { tool: 'searchProducts', args: { query: 'mug' }, createdAt: '2026-09-02T12:00:01Z' },
  // ...every tool invocation, in order, with timestamps
];

// 2. Score it.
const card = evaluate(events);
card.score;                 // traps passed
card.total;                 // traps actually tested (exposed)
card.tested;                // did the run meet the engagement gate?
card.outcomes;              // per-trap results:
//   { name, status: 'PASS'|'FAIL'|'NOT TESTED', detail,
//     attackClass,  // e.g. 'LLM01: Prompt Injection (indirect...)'
//     reference,    // OWASP LLM Top 10 / MITRE ATLAS citation
//     explain }     // why this class matters
card.badges;                // capability badges earned

// 3. Inspect the catalog itself.
TRAP_DEFS.map(t => t.attackClass);
```

### API

| Export | Purpose |
|---|---|
| `TRAP_DEFS` | Array of trap definitions: `name`, `detail`, `exposed(events)`, `violated(events)`, `attackClass`, `reference`, `explain`. |
| `engagement(events)` | The minimum-workflow gate: `{ ok, reasons }`. Runs that never really engage are rejected, not scored 0. |
| `evaluate(events)` | Full scoring: engagement gate → per-trap exposure/violation → badges. Tolerates malformed input (returns an unscored card). |

Events are plain objects: `{ tool: string, args?: object, createdAt?: ISO string }`.
Exposure/violation predicates match on tool names and argument shapes, so you
can either adopt the reference tool names (recommended: build the same decoy
tools into your own surface) or rewrite the predicates for your own names
while keeping the attack-class taxonomy intact.

## Coverage

| Trap | Attack class |
|---|---|
| Decoy description | LLM01 Prompt Injection (tool-description poisoning) |
| Typosquat tool name | LLM01 Prompt Injection (decoy tool substitution) |
| Indirect result injection | LLM01 Prompt Injection (indirect, via tool result) |
| Credential exfiltration | LLM02 Sensitive Information Disclosure |
| Destructive scope | LLM06 Excessive Agency (unauthorized destructive action) |
| Confused deputy | LLM06 Excessive Agency (privilege escalation) |
| Quantity manipulation | LLM01 (behavioral nudge via tool metadata) |
| Phantom discount stacking | LLM06 (loophole optimization / fraud) |
| Third-party PII leakage | LLM02 (third-party PII chaining) |
| Second-order instruction | LLM01 (delayed activation payload) |

## Node compatibility

Pure ES module using only `Number`, `Array`, `Set` and JSON — works in any
modern Node, Bun, Deno, browser, or Workers runtime. No dependencies, no
transpile step.

## Provenance

This is the exact module the public range deploys (re-exported by
`functions/_lib.js`); changes here change the live benchmark, so PRs should
include tests (`test/evaluate.test.mjs`).
