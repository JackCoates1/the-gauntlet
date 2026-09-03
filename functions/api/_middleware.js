import { corsPreflight, withCors } from '../_lib.js';

// Applies to every nested /api Pages Function, including JSON, CSV and SVG
// responses (and error responses), without each endpoint having to remember
// to reproduce the public browser-integration policy.
export async function onRequest({ request, next }) {
  if (request.method === 'OPTIONS') return corsPreflight();
  return withCors(await next());
}
