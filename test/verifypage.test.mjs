// Verify-page tests: the client-side evidence verifier page exists, its
// embedded public key matches functions/_evidence.js, the verifier logic
// actually passes a genuine signed bundle and rejects a tampered one, and
// the page contains no innerHTML usage (XSS guard).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { PUBLIC_KEY_HEX, buildEvidenceBundle, verifyBundle } from '../functions/_evidence.js';
import { canonicalize, verifyBundleClient, PUBLIC_KEY_HEX as PAGE_KEY } from '../public/verify.js';
import { evaluate } from '../embed/gauntlet-traps/traps.mjs';

let failures = 0;
function check(name, cond, extra = '') {
  if (cond) console.log('ok:', name);
  else { failures++; console.log('FAIL:', name, extra); }
}

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const html = readFileSync(join(root, 'public/verify.html'), 'utf8');
const js = readFileSync(join(root, 'public/verify.js'), 'utf8');
const evidenceSrc = readFileSync(join(root, 'functions/_evidence.js'), 'utf8');
const indexSrc = readFileSync(join(root, 'public/index.html'), 'utf8');

// ---- page exists + is wired ----
check('verify page exists with verifier title', html.includes('Verify Evidence Signature'));
check('page has run-id input and both buttons', html.includes('id="runid"') && html.includes('id="btn-verify"') && html.includes('id="btn-tamper"'));
check('page loads verify.js as a module', /<script[^>]*type="module"[^>]*src="\/verify\.js"/.test(html));
check('page fetches the evidence endpoint in JS', js.includes('/api/scorecards/') && js.includes('/evidence'));
check('index nav links /verify', /href="\/verify"/.test(indexSrc));
check('verifier page itself has no runtime innerHTML', !/innerHTML/.test(js) && !/innerHTML/.test(html));

// ---- key cross-checks ----
check('page public key matches functions/_evidence.js', PAGE_KEY === PUBLIC_KEY_HEX, `${PAGE_KEY} vs ${PUBLIC_KEY_HEX}`);
const srcKey = evidenceSrc.match(/PUBLIC_KEY_HEX = '([0-9a-f]+)'/)?.[1];
check('evidence source key parses and equals page key', srcKey === PAGE_KEY);
check('page renders the published key in the explainer', html.includes(PUBLIC_KEY_HEX));

// ---- verifier actually verifies (browser crypto code, Node runtime) ----
const _kp = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
const SIGNING_KEY_HEX = [...new Uint8Array(await crypto.subtle.exportKey('pkcs8', _kp.privateKey))].map(b => b.toString(16).padStart(2, '0')).join('');
const pubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', _kp.publicKey));
const pubHex = [...pubRaw].map(b => b.toString(16).padStart(2, '0')).join('');

const t0 = Date.parse('2026-09-02T12:00:00Z');
const ev = (tool, args, s) => ({ tool, args: args || {}, createdAt: new Date(t0 + s * 1000).toISOString() });
const run = [
  ev('sessionStarted', {}, 0),
  ev('searchProducts', { query: 'coffee' }, 5),
  ev('getReviews', { id: 'p1' }, 12),
  ev('getPrice', { id: 'p1' }, 20),
  ev('addToCart', { id: 'p1', quantity: 1 }, 30),
];
const card = { ...evaluate(run), id: 'd44bed6c-demo-run-id-not-a-uuid000000', createdAt: new Date(t0 + 60 * 1000).toISOString() };
let bundle = await buildEvidenceBundle({ id: card.id, events: run, userAgent: 'verify-test' }, card, SIGNING_KEY_HEX);
bundle.publicKey = pubHex; // sign against the test key

// sanity: the server-side offline verifier agrees the bundle is well-formed
check('server-side verifyBundle ok on the test bundle', (await verifyBundle(bundle)).ok === true);

// client-side: page key must be swapped to the test key for this run —
// re-verify with the payload canonically signed for THIS public key by
// re-signing through the same path the page trusts.
// (The page verifies against PAGE_KEY; for the test we override it.)
const realKey = PAGE_KEY;
const mod = await import('../public/verify.js?testkey=' + Date.now()); // fresh module copy
// can't mutate a const export — instead verify the exported logic directly by
// temporarily substituting the key inside a locally-patched copy:
let src = readFileSync(join(root, 'public/verify.js'), 'utf8').replace(realKey, pubHex);
const tmpPath = join(here, '.verify-keyswap.mjs');
const { writeFileSync, unlinkSync } = await import('node:fs');
writeFileSync(tmpPath, src);
const patched = await import(tmpPath + '?t=' + Date.now());
const verdict = await patched.verifyBundleClient(bundle);
check('client verifier passes a genuine signed bundle', verdict.ok === true, JSON.stringify(verdict.verdicts));
check('client verifier emits the four expected verdict lines', verdict.verdicts.length === 4 && verdict.verdicts.every(v => v.ok === true));
unlinkSync(tmpPath);

// canonicalize() agrees with the server implementation
import { canonicalize as serverCanonical } from '../functions/_evidence.js';
const probe = { z: 1, a: [2, { b: null, c: 'x"y' }], m: { nested: true } };
check('page canonicalize matches server canonicalize', patched.canonicalize(probe) === serverCanonical(probe) && canonicalize(probe) === serverCanonical(probe));

// ---- tamper demos must fail red ----
// 1. mutated replay args (what the TAMPER DEMO button does)
const mutated = JSON.parse(JSON.stringify(bundle));
mutated.replay[2] = { ...mutated.replay[2], args: { ...mutated.replay[2].args, tampered: 'judge-demo' } };
const vt = await patched.verifyBundleClient(mutated);
check('client verifier rejects mutated replay args', vt.ok === false && /chain broken/i.test(vt.verdicts.at(-1).detail), JSON.stringify(vt.verdicts));

// 2. mutated scorecard score (signature must not cover the lie)
const mutated2 = JSON.parse(JSON.stringify(bundle));
mutated2.score = mutated2.total + 7;
const vs = await patched.verifyBundleClient(mutated2);
check('client verifier rejects mutated score (seal check)', vs.ok === false, JSON.stringify(vs.verdicts));

// 3. swapped-in foreign public key
const mutated3 = JSON.parse(JSON.stringify(bundle));
mutated3.publicKey = '00'.repeat(32);
const vk = await patched.verifyBundleClient(mutated3);
check('client verifier rejects non-published public key', vk.ok === false && /unexpected public key/.test(vk.verdicts.at(-1).detail));

// 4. malformed bundle
check('client verifier rejects malformed bundle', (await patched.verifyBundleClient(null)).ok === false && (await patched.verifyBundleClient({})).ok === false);

// ---- the repo-published key still verifies a bundle signed by the repo path ----
// (guards against the seed/pkcs8 drift: PUBLIC_KEY_HEX must pair with GAUNTLET_SIGNING_KEY,
// which we can't read here — but we can check the page's raw-key verify path
// works with the same import form the server uses.)
const key = await crypto.subtle.importKey('raw', pubRaw, { name: 'Ed25519' }, false, ['verify']);
const { signature, replay, scorecard, publicKey, ...payload } = bundle;
const sigBytes = Uint8Array.from(atob(signature), c => c.charCodeAt(0));
check('raw public-key import + verify path works (JWK fallback unchanged)', await crypto.subtle.verify({ name: 'Ed25519' }, key, sigBytes, new TextEncoder().encode(serverCanonical(payload))));

console.log(failures ? `\n${failures} FAILURES` : '\nall verifypage checks passed');
process.exit(failures ? 1 : 0);
