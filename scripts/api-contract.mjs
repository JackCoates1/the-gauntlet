// The public API contract. `build-openapi.mjs` serializes this to
// public/openapi.json and the docs tests make the human guide agree with it.
// Keep request/response guarantees here rather than maintaining a second,
// hand-authored machine-readable description.

const uuid = { type: 'string', format: 'uuid', example: '7f0c2e5a-1d4b-4a9e-9f21-3c8b6d5e2a10' };
const error = (description) => ({ description, content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } });
const json = (schema, example) => ({ content: { 'application/json': { schema, ...(example ? { example } : {}) } } });
const runId = { name: 'runId', in: 'path', required: true, schema: uuid, description: 'UUID v4 chosen by the client for this run.' };
const retryAfter = { 'Retry-After': { description: 'Seconds until this IP may retry.', schema: { type: 'integer', minimum: 1 } } };

export const openapi = {
  openapi: '3.1.0',
  info: {
    title: 'The Gauntlet Public API', version: '1.0.0',
    description: 'Ingest a WebMCP tool-call ledger, seal a server-scored Ed25519 evidence bundle, and query public research results. No API key is required.',
    license: { name: 'MIT', url: 'https://github.com/JackCoates1/the-gauntlet/blob/main/LICENSE' },
  },
  servers: [{ url: 'https://gauntlet.jackcoates.co.uk', description: 'Production' }],
  tags: [{ name: 'Runs' }, { name: 'Research' }, { name: 'Assets' }],
  paths: {
    '/api/events': { post: {
      tags: ['Runs'], summary: 'Ingest one tool invocation into an immutable run ledger',
      description: 'Rate limited to 30 requests per IP per sliding minute. A run accepts at most 200 events; each event args object is at most 2 KB.',
      requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/EventIngest' } } } },
      responses: { '200': { description: 'Event recorded.', ...json({ $ref: '#/components/schemas/Ok' }) }, '400': error('Invalid JSON, runId, event, or args.'), '409': error('Run is already sealed.'), '413': error('Body exceeds 8 KB or args exceed 2 KB.'), '429': { ...error('Per-IP event limit or 200-event run budget exceeded.'), headers: retryAfter } },
    } },
    '/api/scorecards/{runId}': {
      post: {
        tags: ['Runs'], summary: 'Seal a server-scored, signed scorecard',
        description: 'Idempotent. Rate limited to 5 requests per IP per sliding hour. Sealing requires at least 2 events over at least 10 seconds, all using known range tools.',
        parameters: [runId], requestBody: { required: false, content: { 'application/json': { schema: { $ref: '#/components/schemas/SealRequest' } } } },
        responses: { '200': { description: 'Original or newly sealed scorecard.', ...json({ $ref: '#/components/schemas/SealedScorecard' }) }, '400': error('Invalid run ID or JSON.'), '413': error('Body exceeds 2 KB.'), '422': error('Run fails proof-of-interaction plausibility checks.'), '429': { ...error('Per-IP seal limit exceeded.'), headers: retryAfter } },
      },
      get: { tags: ['Runs'], summary: 'Fetch a stored scorecard', parameters: [runId], responses: { '200': { description: 'Stored scorecard.', ...json({ $ref: '#/components/schemas/Scorecard' }) }, '400': error('Invalid run ID.'), '404': error('Run not found.') } },
    },
    '/api/scorecards/{runId}/evidence': { get: { tags: ['Runs'], summary: 'Fetch signed evidence and hash-chained replay', parameters: [runId], responses: { '200': { description: 'Offline-verifiable evidence bundle.', ...json({ $ref: '#/components/schemas/EvidenceBundle' }) }, '400': error('Invalid run ID.'), '404': error('Run not found.') } } },
    '/api/scorecards/{runId}/percentile': { get: { tags: ['Research'], summary: 'Community percentile for a sealed run', description: 'Server-side ranked count over every other sealed run. Used by the scorecard page for social context ("Better than 72% of verified runs").',
      parameters: [runId],
      responses: { '200': { description: 'Percentile, peer count and community average.', ...json({ $ref: '#/components/schemas/Percentile' }) }, '400': error('Invalid run ID.'), '404': error('Run not found.') } } },
    '/api/recent': { get: { tags: ['Research'], summary: 'Live ticker of the most recent sealed runs', description: 'The last N sealed runs in seal-time order, each with a server-side verified flag computed exactly like the leaderboard. Powers the homepage RECENT RUNS strip.',
      parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 12, default: 8 } }],
      responses: { '200': { description: 'Recent sealed runs.', ...json({ $ref: '#/components/schemas/RecentRuns' }) } } } },
    '/api/leaderboard': { get: { tags: ['Research'], summary: 'Query the verified public leaderboard', parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 50, default: 20 } }, { name: 'verified', in: 'query', description: 'Use 0 to include unverified runs; default is verified only.', schema: { type: 'string', enum: ['0', '1'], default: '1' } }], responses: { '200': { description: 'Recent sealed runs.', ...json({ $ref: '#/components/schemas/Leaderboard' }) } } } },
    '/api/digest': { get: { tags: ['Research'], summary: 'Aggregate fingerprint-level susceptibility research', responses: { '200': { description: 'Research digest.', ...json({ $ref: '#/components/schemas/Digest' }) } } } },
    '/api/trapstats': { get: { tags: ['Research'], summary: 'Aggregate per-trap resistance statistics', responses: { '200': { description: 'Community resistance leaderboard.', ...json({ $ref: '#/components/schemas/TrapStats' }) } } } },
    '/api/leaderboard.csv': { get: { tags: ['Research'], summary: 'Download leaderboard rows as CSV', parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 50, default: 20 } }, { name: 'verified', in: 'query', schema: { type: 'string', enum: ['0', '1'], default: '1' } }], responses: { '200': { description: 'CSV export.', content: { 'text/csv': { schema: { type: 'string', format: 'binary' } } } } } } },
    '/api/digest.csv': { get: { tags: ['Research'], summary: 'Download research digest as CSV', responses: { '200': { description: 'CSV export.', content: { 'text/csv': { schema: { type: 'string', format: 'binary' } } } } } } },
    '/api/badge/{runId}.svg': { get: { tags: ['Assets'], summary: 'Render an embeddable score badge', parameters: [runId, { name: 'label', in: 'query', schema: { type: 'string', maxLength: 80 } }, { name: 'score', in: 'query', schema: { type: 'string', maxLength: 40 } }, { name: 'color', in: 'query', schema: { type: 'string', pattern: '^[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$' } }], responses: { '200': { description: '330×28 SVG badge; cacheable for one hour.', content: { 'image/svg+xml': { schema: { type: 'string', format: 'binary' } } } }, '400': error('Invalid run ID.'), '404': error('Run not found.') } } },
    '/scorecards/{runId}': { get: { tags: ['Assets'], summary: 'Shareable scorecard HTML with Open Graph and Twitter metadata', parameters: [runId], responses: { '200': { description: 'Scorecard page or branded fallback.', content: { 'text/html': { schema: { type: 'string' } } } } } } },
    '/og-banner.png': { get: { tags: ['Assets'], summary: 'Static social-share banner', responses: { '200': { description: '1200×630 PNG share image.', content: { 'image/png': { schema: { type: 'string', format: 'binary' } } } } } } },
  },
  components: { schemas: {
    Error: { type: 'object', required: ['error'], properties: { error: { type: 'string' } } },
    Ok: { type: 'object', required: ['ok'], properties: { ok: { const: true } } },
    EventIngest: { type: 'object', required: ['runId', 'event'], properties: { runId: uuid, userAgent: { type: 'string', maxLength: 500 }, event: { type: 'object', required: ['tool'], properties: { tool: { type: 'string', maxLength: 64, description: 'A real range tool name; unknown names make sealing fail.' }, args: { type: 'object', additionalProperties: true, description: 'JSON object, serialized size ≤ 2 KB.' }, createdAt: { type: 'string', format: 'date-time', description: 'UTC ISO-8601 timestamp; server time is used if omitted.' } } } } },
    SealRequest: { type: 'object', properties: { userAgent: { type: 'string', maxLength: 500 } } },
    Outcome: { type: 'object', properties: { name: { type: 'string' }, status: { type: 'string', enum: ['PASS', 'FAIL', 'NOT TESTED'] }, detail: { type: 'string' } } },
    Scorecard: { type: 'object', required: ['id', 'score', 'total', 'outcomes'], properties: { id: uuid, score: { type: 'integer', minimum: 0 }, total: { type: 'integer', minimum: 0 }, pct: { type: 'integer', minimum: 0, maximum: 100 }, badges: { type: 'array', items: { type: 'string' } }, outcomes: { type: 'array', items: { $ref: '#/components/schemas/Outcome' } }, engagement: { type: 'object', additionalProperties: true }, createdAt: { type: 'string', format: 'date-time' } } },
    SealedScorecard: { allOf: [{ $ref: '#/components/schemas/Scorecard' }, { type: 'object', properties: { verified: { type: 'boolean', description: 'True when the seal-time Ed25519 signature was produced.' }, url: { type: 'string' }, badgeUrl: { type: 'string' } } }] },
    EvidenceBundle: { type: 'object', required: ['runId', 'eventsRoot', 'algorithm', 'publicKey', 'signature', 'replay', 'scorecard'], properties: { runId: uuid, createdAt: { type: 'string', format: 'date-time' }, userAgent: { type: ['string', 'null'] }, score: { type: 'integer' }, total: { type: 'integer' }, eventsRoot: { type: 'string' }, eventCount: { type: 'integer' }, algorithm: { const: 'Ed25519' }, canonicalization: { type: 'string' }, publicKey: { type: 'string', pattern: '^[0-9a-f]{64}$' }, signature: { type: 'string', contentEncoding: 'base64' }, replay: { type: 'array', items: { type: 'object', additionalProperties: true } }, scorecard: { $ref: '#/components/schemas/Scorecard' }, resistanceTimeline: { type: 'array', items: { type: 'object', additionalProperties: true } } } },
    Leaderboard: { type: 'object', required: ['runs', 'verifiedCount', 'totalSealed', 'generatedAt'], properties: { runs: { type: 'array', items: { allOf: [{ $ref: '#/components/schemas/Scorecard' }, { type: 'object', properties: { verified: { type: 'boolean' }, label: { type: ['string', 'null'] }, browser: { type: 'string' }, url: { type: 'string' }, badgeUrl: { type: 'string' } } }] } }, verifiedCount: { type: 'integer' }, totalSealed: { type: 'integer' }, generatedAt: { type: 'string', format: 'date-time' } } },
    RecentRuns: { type: 'object', required: ['runs', 'generatedAt'], properties: { runs: { type: 'array', items: { type: 'object', required: ['id', 'sealedAt', 'score', 'total', 'verified', 'url'], properties: { id: uuid, sealedAt: { type: 'string', format: 'date-time' }, score: { type: 'integer', minimum: 0 }, total: { type: 'integer', minimum: 0 }, label: { type: ['string', 'null'], description: 'Agent label, or browser family derived from the user agent.' }, verified: { type: 'boolean' }, url: { type: 'string', description: 'Shareable /scorecards/{id} path.' } } } }, generatedAt: { type: 'string', format: 'date-time' } } },
    Digest: { type: 'object', properties: { cards: { type: 'array', items: { type: 'object', additionalProperties: true } }, generatedAt: { type: 'string', format: 'date-time' }, totalRuns: { type: 'integer' }, verifiedRuns: { type: 'integer' } } },
    TrapStats: { type: 'object', properties: { traps: { type: 'array', items: { type: 'object', additionalProperties: true } }, hardestTrap: { type: ['object', 'null'], additionalProperties: true }, community: { type: 'object', additionalProperties: true }, generatedAt: { type: 'string', format: 'date-time' } } },
    Percentile: { type: 'object', required: ['id', 'percentile', 'betterThanCount', 'peerCount', 'averagePct'], properties: { id: uuid, percentile: { type: ['integer', 'null'], minimum: 0, maximum: 100, description: 'Share of peer runs this run beat; null when no peers.' }, betterThanCount: { type: 'integer', minimum: 0 }, peerCount: { type: 'integer', minimum: 0 }, averagePct: { type: ['number', 'null'], description: 'Mean peer score percentage.' } } },
  } },
};
