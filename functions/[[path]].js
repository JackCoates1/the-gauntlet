// Root catch-all for genuinely unmatched paths. A top-level 404.html also
// disables Pages' SPA fallback; this Function makes the HTTP contract explicit
// and keeps API and static-asset requests out of the HTML error surface.

const ASSET_PATH = /\/(?:[^/]+\.(?:css|js|mjs|json|xml|txt|png|svg|ico|webmanifest)|_headers|_redirects)$/i;
const STATIC_PAGES = new Set(['/', '/compare', '/connect', '/demo', '/digest', '/docs', '/leaderboard', '/scorecard', '/traps', '/verify']);

export function isPassthroughPath(pathname) {
  const prettyPath = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return pathname === '/api' || pathname.startsWith('/api/') || ASSET_PATH.test(pathname) || STATIC_PAGES.has(prettyPath);
}

export async function onRequest({ request, env, next }) {
  const url = new URL(request.url);
  if (isPassthroughPath(url.pathname)) return next();

  // Fetch the checked-in shell through Pages' asset binding, then preserve its
  // security headers while changing only the status line to a real 404.
  const page = await env.ASSETS.fetch(new URL('/404.html', request.url));
  return new Response(request.method === 'HEAD' ? null : page.body, {
    status: 404,
    statusText: 'Not Found',
    headers: page.headers,
  });
}
