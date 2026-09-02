// The Gauntlet — evidence-replay forensics.
// Produces a canonical, hash-chained, cryptographically-signed replay of the
// exact tool-call sequence for a run, plus the signed evidence bundle.

// Ed25519 private key lives in the Pages secret GAUNTLET_SIGNING_KEY (raw
// 32-byte seed, hex-encoded). Verification needs only the public key, which
// is published in the repo and embedded in every evidence bundle.

const enc = new TextEncoder();

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
export function bytesToHex(bytes) {
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function sha256(data) {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(data));
  return bytesToHex(new Uint8Array(d));
}

// Canonical JSON: sorted keys, no whitespace — so hashes are reproducible
// across runtimes.
export function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalize(value[k])).join(',') + '}';
}

export async function canonicalHash(value) {
  return sha256(canonicalize(value));
}

// Build the hash-chained replay. Each step hashes the canonical form of the
// previous step's hash + this step's event, so any later tampering with the
// stored ledger breaks the chain.
export async function buildReplay(events) {
  const steps = [];
  let prev = 'genesis';
  for (const e of events) {
    const step = {
      seq: steps.length + 1,
      tool: e.tool,
      args: e.args ?? {},
      timestamp: e.createdAt,
      prevHash: prev,
    };
    step.hash = await canonicalHash(step);
    prev = step.hash;
    steps.push(step);
  }
  return steps;
}

export async function chainRoot(steps) {
  return steps.length ? steps[steps.length - 1].hash : 'genesis';
}

// Sign a payload with Ed25519 (WebCrypto). Returns base64 signature.
export async function signPayload(payload, signingKey) {
  if (!signingKey) throw new Error('signing key not configured');
  let key;
  if (/^[0-9a-f]+$/i.test(signingKey) && signingKey.length === 64) {
    // Raw 32-byte seed. The Workers runtime accepts raw import with sign
    // usage; Node requires the JWK form of the same seed, so try raw first
    // and fall back.
    try {
      key = await crypto.subtle.importKey('raw', hexToBytes(signingKey), { name: 'Ed25519' }, false, ['sign']);
    } catch {
      key = await crypto.subtle.importKey('jwk', seedJwk(signingKey), { name: 'Ed25519' }, false, ['sign']);
    }
  } else {
    // PKCS#8 hex (local tests).
    key = await crypto.subtle.importKey('pkcs8', hexToBytes(signingKey), { name: 'Ed25519' }, false, ['sign']);
  }
  const sig = await crypto.subtle.sign({ name: 'Ed25519' }, key, enc.encode(canonicalize(payload)));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

function seedJwk(seedHex) {
  const b64u = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return {
    kty: 'OKP', crv: 'Ed25519',
    x: b64u(hexToBytes(PUBLIC_KEY_HEX)),
    d: b64u(hexToBytes(seedHex)),
    key_ops: ['sign'], ext: true,
  };
}

// Public key (raw hex) corresponding to the deployed GAUNTLET_SIGNING_KEY
// seed. Anyone can verify a bundle offline with this key.
export const PUBLIC_KEY_HEX = '17f868001b3ad45cc67a069e1115c1e8390debe4ad21add712477d91c857827a';

export async function buildEvidenceBundle(run, card, signingKeyHex) {
  const steps = await buildReplay(run.events);
  const root = await chainRoot(steps);
  const payload = {
    runId: run.id,
    createdAt: card.createdAt,
    userAgent: run.userAgent || null,
    score: card.score,
    total: card.total,
    eventsRoot: root,
    eventCount: steps.length,
    algorithm: 'Ed25519',
    canonicalization: 'JCS-style sorted-key JSON',
  };
  const signature = await signPayload(payload, signingKeyHex);
  return {
    ...payload,
    publicKey: PUBLIC_KEY_HEX,
    signature,
    replay: steps,
    scorecard: {
      id: card.id,
      score: card.score,
      total: card.total,
      badges: card.badges,
      outcomes: card.outcomes,
      engagement: card.engagement,
    },
  };
}

// ---- Verifier badge (leaderboard) ------------------------------------------
// At seal time the scorecard is signed over a canonical payload that includes
// the event-ledger chain root. The badge is earned only if the stored
// signature verifies AND the ledger still re-derives to the same chain root,
// so a fabricated run (or one whose ledger was tampered with post-seal) can
// never pass.
export function sealPayload(runId, card, eventsRoot) {
  return {
    runId,
    createdAt: card.createdAt,
    score: card.score,
    total: card.total,
    eventsRoot,
    algorithm: 'Ed25519',
    purpose: 'leaderboard-verification',
  };
}

// Sign at seal time. Returns base64 signature (or null if no key configured).
export async function sealScorecard(runId, card, events, signingKey) {
  if (!signingKey) return null;
  const root = await chainRoot(await buildReplay(events));
  return signPayload(sealPayload(runId, card, root), signingKey);
}

// Server-side verification: recompute the hash chain from the event ledger,
// rebuild the payload, and check the stored signature against the published
// public key. Never trusts client input.
export async function verifyRun(events, card, sig, publicKeyHex = PUBLIC_KEY_HEX) {
  if (!sig) return { verified: false, reason: 'unsigned' };
  const root = await chainRoot(await buildReplay(events));
  const payload = sealPayload(card.id, card, root);
  try {
    const key = await crypto.subtle.importKey('raw', hexToBytes(publicKeyHex), { name: 'Ed25519' }, false, ['verify']);
    const sigBytes = Uint8Array.from(atob(sig), c => c.charCodeAt(0));
    const ok = await crypto.subtle.verify({ name: 'Ed25519' }, key, sigBytes, enc.encode(canonicalize(payload)));
    return ok ? { verified: true, reason: 'signature + ledger chain verified' } : { verified: false, reason: 'signature invalid' };
  } catch (e) {
    return { verified: false, reason: 'verification error: ' + e.message };
  }
}

// Offline verification, exported so tests (and other developers using the
// embeddable library) can confirm a bundle without trusting the server.
export async function verifyBundle(bundle) {
  const steps = await buildReplay(bundle.replay.map(s => ({ tool: s.tool, args: s.args, createdAt: s.timestamp })));
  for (let i = 0; i < steps.length; i++) {
    if (steps[i].hash !== bundle.replay[i].hash || steps[i].prevHash !== bundle.replay[i].prevHash) return { ok: false, reason: `hash chain broken at step ${i + 1}` };
  }
  if (await chainRoot(steps) !== bundle.eventsRoot) return { ok: false, reason: 'events root mismatch' };
  const { signature, replay, scorecard, publicKey, ...payload } = bundle;
  const key = await crypto.subtle.importKey('raw', hexToBytes(publicKey), { name: 'Ed25519' }, false, ['verify']);
  const sigBytes = Uint8Array.from(atob(signature), c => c.charCodeAt(0));
  const ok = await crypto.subtle.verify({ name: 'Ed25519' }, key, sigBytes, enc.encode(canonicalize(payload)));
  return { ok, reason: ok ? 'valid' : 'signature invalid' };
}
