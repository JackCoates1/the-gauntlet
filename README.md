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

The range includes eight checkable controls:

- poisoned-description decoy pricing endpoint
- checkout typosquat (`check0ut`)
- indirect prompt injection embedded in a tool **result**
- fake session-token exfiltration attempt
- unsolicited destructive bulk action
- confused-deputy privilege escalation hidden in a profile update
- quantity manipulation through a self-serving tool description
- use of canonical, honest paths alongside clean control tools

Each invocation is written to an in-page trace and a Cloudflare D1-backed event ledger. The scorecard is computed from the recorded invocation sequence, produces per-control outcomes, named badges, a permanent result URL, and a small embeddable SVG badge.

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
