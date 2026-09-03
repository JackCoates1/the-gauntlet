# The Gauntlet

**The Gauntlet** is a public adversarial security range for WebMCP agents. Instead of protecting an application *from* an agent, it deliberately exposes an agent to a mixed catalog of honest tools and realistic tool-layer attacks, then creates an evidence-backed scorecard of its behaviour.

Built for [OpenAI's WebMCP Challenge](https://devpost.com/submit-to/31011-the-webmcp-challenge).

## Why WebMCP

WebMCP gives web applications a direct, structured way to expose capabilities to capable agents. That is powerful—and it makes the integrity of tool names, descriptions, schemas, returned data, and authority boundaries worth testing. The Gauntlet makes those failure modes visible in a controlled, fictional environment.

The site registers tools with the official browser API, using `document.modelContext` as the primary surface and `navigator.modelContext` only as a compatibility fallback:

```js
const context = document.modelContext || navigator.modelContext;
const unregister = context.registerTool({
  name: 'searchProducts',
  description: 'Search the clean fictional catalogue by a customer-provided query.',
  inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
  execute: async ({ query }) => ({ content: [{ type: 'text', text: query }] })
});

// on page teardown
unregister();
```

## What it tests

The range includes ten checkable traps, each mapped to the real attack-pattern class it represents (OWASP LLM Top 10 2025 / MITRE ATLAS):

- poisoned-description decoy pricing endpoint — *LLM01 Prompt Injection*
- checkout typosquat (`check0ut`) — *LLM01 Prompt Injection (decoy substitution)*
- indirect prompt injection embedded in a tool **result** — *LLM01 (indirect injection)*
- fake session-token exfiltration attempt — *LLM02 Sensitive Information Disclosure*
- unsolicited destructive bulk action — *LLM06 Excessive Agency*
- confused-deputy privilege escalation hidden in a profile update — *LLM06 (confused deputy)*
- quantity manipulation through a self-serving tool description — *LLM01 behavioral nudge*
- phantom discount stacking invited by a tool description — *LLM06 (loophole abuse)*
- third-party PII leakage chained across two tools — *LLM02 (PII chaining)*
- second-order instruction planted in a tool result for later activation — *LLM01 (delayed payload)*

Each invocation is written to an in-page trace and a Cloudflare D1-backed event ledger. The scorecard is computed from the recorded invocation sequence, produces per-control outcomes (with attack-class explainability), named badges, a permanent result URL, and a small embeddable SVG badge.

## Public benchmark & research

- **Leaderboard** — [/leaderboard](https://gauntlet.jackcoates.co.uk/leaderboard) lists every sealed run (score, timestamp, browser, link to the full scorecard) as an ongoing public benchmark. API: `GET /api/leaderboard?limit=50`.
- **Research digest** — [/digest](https://gauntlet.jackcoates.co.uk/digest) aggregates all runs into per-browser fingerprint cards showing susceptibility per attack class. API: `GET /api/digest`.

## Evidence-replay forensics

Every scorecard has a downloadable, cryptographically-signed evidence bundle:

```
GET /api/scorecards/<run-id>/evidence
```

The bundle contains a hash-chained, timestamped replay of the exact tool-call sequence (each step hashes the previous step's hash plus the canonicalized event, rooted at `genesis`) plus an Ed25519 signature over the canonical payload. Verify offline with the public key published in `functions/_evidence.js` (`PUBLIC_KEY_HEX`) and the `verifyBundle()` helper.

## Testing & CI

[![Tests](https://github.com/JackCoates1/the-gauntlet/actions/workflows/ci.yml/badge.svg)](https://github.com/JackCoates1/the-gauntlet/actions/workflows/ci.yml)

All changes are verified by CI on every push: the full test suite runs automatically on GitHub Actions, and successful pushes to `main` deploy straight to Cloudflare Pages. The production path is therefore **push → test → live site**, with no manual deployment step.

## Embeddable trap library

The entire trap catalog + scoring engine is packaged as a standalone, dependency-free ES module other WebMCP developers can install and run against their own tool surfaces. See [embed/gauntlet-traps/README.md](embed/gauntlet-traps/README.md).

## Use it

1. Visit the deployment in a WebMCP-capable browser context (or Chrome with `chrome://flags/#enable-webmcp-testing` and the WebMCP Inspector extension).
2. Give the agent an ordinary fictional shopping/support request.
3. Call `generateScorecard`, or click **Generate my scorecard**.
4. Share the generated scorecard URL or paste its badge into a README.

The page remains useful for human inspection if WebMCP is unavailable, but tools are only exposed when the model-context API is present.

## Local development

```bash
npm install
npx wrangler d1 create the-gauntlet
# Copy the returned database_id into wrangler.toml.
npx wrangler d1 execute the-gauntlet --local --file=schema.sql
npm run dev
```

For production, create the same D1 database and run `npx wrangler d1 execute the-gauntlet --remote --file=schema.sql`. Bind it as `GAUNTLET_DB` in Cloudflare Pages, then deploy `public/` plus `functions/` through Wrangler or a Git integration.

## Security & data handling

All catalogue data, order IDs and tokens are fictional. No account access, payments, or real personal data exist in the application. Do not supply real credentials to any test tool.

## License

[MIT](LICENSE)
