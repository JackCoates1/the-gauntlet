// The Gauntlet — scoring entry point.
// The trap catalog and evaluation engine live in the embeddable library
// (embed/gauntlet-traps/traps.mjs) so other WebMCP developers can install
// the same definitions. This module re-exports them plus the badge SVG.
export { TRAP_DEFS, engagement, evaluate } from '../embed/gauntlet-traps/traps.mjs';

// The public API is deliberately credential-free: browser integrations can
// read research data and submit the same bounded ledger events as any other
// client. Keep the CORS policy here so every /api route gets identical
// headers through functions/api/_middleware.js.
export const CORS_HEADERS = Object.freeze({
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'Content-Type',
  'access-control-max-age': '86400',
});

export function corsPreflight() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export function withCors(response) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(CORS_HEADERS)) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export const escapeSvg = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const scoreParts = score => /^\d{1,3}\/\d{1,3}$/.test(String(score || '')) ? String(score) : '';
const badgeWidth = text => Math.max(30, Math.min(220, Math.ceil(String(text).length * 7.1 + 14)));
const namedColors = new Set(['brightgreen', 'green', 'yellowgreen', 'yellow', 'orange', 'red', 'lightgrey', 'blue', 'grey', 'gray']);

export function badgeColor(score) {
  const [earned, possible] = scoreParts(score).split('/').map(Number);
  if (!possible) return 'lightgrey';
  const ratio = earned / possible;
  if (ratio >= .9) return 'brightgreen';
  if (ratio >= .7) return 'green';
  if (ratio >= .5) return 'yellowgreen';
  if (ratio >= .3) return 'orange';
  return 'red';
}

export function safeBadgeColor(color, fallback) {
  const value = String(color || '').toLowerCase();
  return namedColors.has(value) || /^#[0-9a-f]{3,8}$/i.test(value) ? value : fallback;
}

// Shields-compatible layout: a left label joined to a score/message field.
// Every untrusted string is escaped before reaching SVG text or attributes.
export function svg(card, { label = 'WebMCP Security', score, color } = {}) {
  // Stored cards are server-generated, but preserve and escape their exact
  // display values here too: this renderer is a public SVG boundary.
  const storedScore = `${String(card.score ?? 0)}/${String(card.total ?? 0)}`;
  const message = scoreParts(score) || storedScore;
  const safeLabel = String(label || 'WebMCP Security').slice(0, 80) || 'WebMCP Security';
  const fill = safeBadgeColor(color, badgeColor(message));
  const left = badgeWidth(safeLabel), right = badgeWidth(message), width = left + right;
  const text = `${safeLabel}: ${message}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" role="img" aria-label="${escapeSvg(text)}"><linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient><clipPath id="r"><rect width="${width}" height="20" rx="3" fill="#fff"/></clipPath><g clip-path="url(#r)"><rect width="${left}" height="20" fill="#555"/><rect x="${left}" width="${right}" height="20" fill="${escapeSvg(fill)}"/><rect width="${width}" height="20" fill="url(#s)"/></g><g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,sans-serif" font-size="11"><text x="${left / 2}" y="15" fill="#010101" fill-opacity=".3">${escapeSvg(safeLabel)}</text><text x="${left / 2}" y="14">${escapeSvg(safeLabel)}</text><text x="${left + right / 2}" y="15" fill="#010101" fill-opacity=".3">${escapeSvg(message)}</text><text x="${left + right / 2}" y="14">${escapeSvg(message)}</text></g></svg>`;
}
