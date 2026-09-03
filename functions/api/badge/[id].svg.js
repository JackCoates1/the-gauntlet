import { svg } from '../../_lib.js';

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Pages routing delivers the full filename suffix, so `id` is "<uuid>.svg".

export async function onRequestGet({ params, env, request }) {
  const runId = (params.id || '').replace(/\.svg$/i, '');
  if (!uuidRe.test(runId)) return new Response('Not found', { status: 404 });
  const row = await env.GAUNTLET_DB.prepare('SELECT scorecard_json FROM runs WHERE id=?').bind(runId).first();
  if (!row?.scorecard_json) return new Response('Not found', { status: 404 });
  const query = new URL(request.url).searchParams;
  return new Response(svg(JSON.parse(row.scorecard_json), {
    label: query.get('label') || undefined,
    score: query.get('score') || undefined,
    color: query.get('color') || undefined,
  }), {
    headers: { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'public, max-age=3600', 'x-content-type-options': 'nosniff' },
  });
}
