// GET /scorecards/:id/qr.svg — scannable QR code of the signed scorecard link.
//
// In-person judges can point a phone camera at the table display and land
// straight on the verifiable /scorecards/:id page instead of typing a UUID.
// Mirrors the badge route's contract: strict UUID validation, 404 for unknown
// or unsealed ids (unknown ids never touch D1 beyond the primary-key lookup),
// short public cache, nosniff. The QR encodes the absolute URL of the
// OG-rendering share route so scanning lands on the full branded page.
//
// Rendering uses the `qrcode` package's SVG output. The payload is built from
// validated components only (origin + fixed path + validated uuid), so no
// untrusted string is ever passed to the encoder; the package's SVG output
// contains only path data — no user text — making it XML-safe by construction.
import QRCode from 'qrcode';

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Pages routing delivers the full filename suffix, so `id` is "<uuid>.svg.svg".

export function scorecardUrlFor(origin, runId) {
  return String(origin).replace(/\/+$/, '') + '/scorecards/' + encodeURIComponent(runId);
}

export function qrHeaders() {
  return {
    'content-type': 'image/svg+xml; charset=utf-8',
    'cache-control': 'public, max-age=3600',
    'x-content-type-options': 'nosniff',
  };
}

export async function onRequestGet({ params, env, request }) {
  // Accept both /qr.svg and a Pages filename-suffix variant like /qr.svg.svg.
  const runId = (params.id || '').replace(/(\.svg)+$/i, '');
  if (!uuidRe.test(runId)) return new Response('Not found', { status: 404 });
  // A QR of an unsealed scorecard would scan to a dead page; verify the seal
  // exists (primary-key read only, same query shape as the badge route).
  if (env?.GAUNTLET_DB) {
    const row = await env.GAUNTLET_DB.prepare('SELECT id FROM runs WHERE id=?').bind(runId).first();
    if (!row) return new Response('Not found', { status: 404 });
  }
  const origin = new URL(request.url).origin;
  const svg = await QRCode.toString(scorecardUrlFor(origin, runId), {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 240,
    color: { dark: '#0d1117', light: '#ffffff' },
  });
  return new Response(svg, { headers: qrHeaders() });
}
