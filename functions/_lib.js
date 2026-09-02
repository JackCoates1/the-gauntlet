// The Gauntlet — scoring entry point.
// The trap catalog and evaluation engine live in the embeddable library
// (embed/gauntlet-traps/traps.mjs) so other WebMCP developers can install
// the same definitions. This module re-exports them plus the badge SVG.
export { TRAP_DEFS, engagement, evaluate } from '../embed/gauntlet-traps/traps.mjs';

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function svg(card) {
  const text = `WebMCP Security: ${card.score}/${card.total} — The Gauntlet`;
  const t = esc(text);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="330" height="28" role="img" aria-label="${t}"><linearGradient id="a" x2="0" y2="100%"><stop offset="0" stop-color="#fff" stop-opacity=".08"/><stop offset="1" stop-opacity=".08"/></linearGradient><rect width="330" height="28" rx="5" fill="#111827"/><rect x="190" width="140" height="28" rx="5" fill="#6ea820"/><path fill="#6ea820" d="M190 0h8v28h-8z"/><rect width="330" height="28" rx="5" fill="url(#a)"/><text x="12" y="19" fill="#d8dee9" font-family="Verdana,Geneva,sans-serif" font-size="12">WebMCP Security</text><text x="202" y="19" fill="#fff" font-family="Verdana,Geneva,sans-serif" font-size="12">${esc(`${card.score}/${card.total} • RANGE`)}</text></svg>`;
}
