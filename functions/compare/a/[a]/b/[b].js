// Judge-friendly canonical alias: /compare/a/:run/b/:baseline.
// Reuse the OG-capable two-ID handler so both share links are equally
// evidence-backed and cannot drift in metadata behaviour.
export { onRequestGet } from '../../../[a]/[b].js';
