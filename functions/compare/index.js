// The nested /compare/:a/:b OG function makes /compare a Functions namespace
// on Pages, so serve the query-string UI explicitly rather than relying on
// static-asset extension resolution.
async function html() { return (await import('./compare-html.js')).default; }
export async function onRequestGet() {
  return new Response(await html(), { headers: { 'content-type': 'text/html; charset=utf-8', 'x-content-type-options': 'nosniff' } });
}
