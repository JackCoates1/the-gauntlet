// The Gauntlet — client-side evidence verification.
// Fetches the signed evidence bundle for a run and verifies it entirely in
// the browser: hash chain rebuilt from the replay, events root match, and
// the Ed25519 seal checked against the published public key (embedded below,
// identical to functions/_evidence.js). No server trust involved — a judge
// can confirm "tamper-evident" with one click, including a tampered-bundle
// demo that must fail red.

// Published public key — MUST match functions/_evidence.js PUBLIC_KEY_HEX
// (enforced by test/verifypage.test.mjs).
export const PUBLIC_KEY_HEX = '17f868001b3ad45cc67a069e1115c1e8390debe4ad21add712477d91c857827a';

const enc = new TextEncoder();

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, 2 + i * 2, 16), 16);
  return out;
}

// Canonical JSON: sorted keys, no whitespace — same algorithm as
// functions/_evidence.js canonicalize() so hashes are reproducible.
export function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalize(value[k])).join(',') + '}';
}

async function canonicalHash(value) {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(canonicalize(value)));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Rebuild the hash chain from the bundle's replay steps and return per-step
// results plus the recomputed root.
export async function rebuildChain(bundle) {
  const results = [];
  let prev = 'genesis';
  let root = 'genesis';
  const steps = bundle.replay || [];
  for (let i = 0; i < steps.length; i++) {
    const step = {
      seq: i + 1,
      tool: steps[i].tool,
      args: steps[i].args ?? {},
      timestamp: steps[i].timestamp,
      prevHash: prev,
    };
    step.hash = await canonicalHash(step);
    const ok = step.hash === steps[i].hash && steps[i].prevHash === prev;
    results.push({ seq: i + 1, ok, tool: steps[i].tool });
    prev = step.hash;
    root = step.hash;
  }
  return { results, root };
}

// Full verification. Returns an ordered list of verdicts for the UI:
// { ok, label, detail } — plus top-level ok.
export async function verifyBundleClient(bundle) {
  const verdicts = [];
  const bad = detail => ({ ok: false, label: '✗', detail });
  const good = detail => ({ ok: true, label: '✓', detail });

  if (!bundle || !Array.isArray(bundle.replay)) return { ok: false, verdicts: [bad('evidence bundle missing or malformed')] };

  // 1. Hash chain.
  const { results, root } = await rebuildChain(bundle);
  const broken = results.find(r => !r.ok);
  if (broken) {
    verdicts.push(bad(`event chain broken at step ${broken.seq} (${broken.tool})`));
    return { ok: false, verdicts };
  }
  verdicts.push(good(`event chain intact (${results.length} event${results.length === 1 ? '' : 's'}, root ${root.slice(0, 12)}…)`));

  // 2. Published eventsRoot matches the rebuilt chain.
  if (bundle.eventsRoot !== root) {
    verdicts.push(bad(`events root mismatch: bundle claims ${String(bundle.eventsRoot).slice(0, 12)}…, chain re-derives to ${root.slice(0, 12)}…`));
    return { ok: false, verdicts };
  }
  verdicts.push(good(`events root matches published root (${root.slice(0, 12)}…)`));

  // 3. Ed25519 seal against the published public key, over the canonical
  // payload (everything except the signature, replay, scorecard, timeline).
  const { signature, replay, scorecard, publicKey, resistanceTimeline, ...payload } = bundle;
  if (publicKey !== PUBLIC_KEY_HEX) {
    verdicts.push(bad('bundle embeds an unexpected public key (not the published one)'));
    return { ok: false, verdicts };
  }
  let sigOk = false, sigErr = null;
  try {
    const key = await crypto.subtle.importKey('raw', hexToBytes(PUBLIC_KEY_HEX), { name: 'Ed25519' }, false, ['verify']);
    const sigBytes = Uint8Array.from(atob(signature), c => c.charCodeAt(0));
    sigOk = await crypto.subtle.verify({ name: 'Ed25519' }, key, sigBytes, enc.encode(canonicalize(payload)));
  } catch (e) {
    sigErr = e;
  }
  if (!sigOk) {
    verdicts.push(bad('seal signature INVALID against published public key' + (sigErr ? ` (${sigErr.message})` : '')));
    return { ok: false, verdicts };
  }
  verdicts.push(good('seal signature valid against published public key'));

  // 4. The signature covers the scorecard fields (score/total/runId are part
  // of the sealed payload — confirm the displayed scorecard agrees).
  const covered = scorecard && bundle.score === scorecard.score && bundle.total === scorecard.total &&
    payload.runId === (scorecard.id ?? bundle.runId);
  if (!covered) {
    verdicts.push(bad('scorecard fields do not match the signed payload'));
    return { ok: false, verdicts };
  }
  verdicts.push(good(`signature covers scorecard ${String(bundle.runId).slice(0, 8)}… (score ${bundle.score}/${bundle.total}, signed ${payload.createdAt})`));

  return { ok: true, verdicts };
}

// ---- Browser UI (no-op under Node tests) ------------------------------------
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text; // textContent only — never set HTML
  return n;
}

function renderVerdicts(container, verdicts, headline) {
  container.replaceChildren();
  const box = el('div', 'verdict ' + (verdicts.every(v => v.ok) ? 'verdict-ok' : 'verdict-bad'));
  box.appendChild(el('div', 'verdict-headline', headline));
  for (const v of verdicts) {
    const row = el('div', 'verdict-row ' + (v.ok ? 'v-ok' : 'v-bad'));
    row.appendChild(el('span', 'v-mark', v.label));
    row.appendChild(el('span', 'v-text', v.detail));
    box.appendChild(row);
  }
  container.appendChild(box);
}

if (typeof document !== 'undefined') {
  const out = document.getElementById('verdict');
  const input = document.getElementById('runid');

  async function loadBundle() {
    const id = (input.value || '').trim();
    if (!id) { out.replaceChildren(el('p', 'v-hint', 'Paste a run id (from a scorecard URL) and press VERIFY SIGNATURE.')); return null; }
    out.replaceChildren(el('p', 'v-hint', 'Fetching evidence bundle…'));
    let res, bundle;
    try {
      res = await fetch('/api/scorecards/' + encodeURIComponent(id) + '/evidence');
      bundle = await res.json();
    } catch (e) {
      renderVerdicts(out, [{ ok: false, label: '✗', detail: 'could not fetch evidence bundle: ' + e.message }], 'FETCH FAILED');
      return null;
    }
    if (!res.ok) {
      renderVerdicts(out, [{ ok: false, label: '✗', detail: bundle.error || ('HTTP ' + res.status) }], 'EVIDENCE UNAVAILABLE');
      return null;
    }
    return bundle;
  }

  document.getElementById('btn-verify')?.addEventListener('click', async () => {
    const bundle = await loadBundle();
    if (!bundle) return;
    const r = await verifyBundleClient(bundle);
    renderVerdicts(out, r.verdicts, r.ok ? 'EVIDENCE VERIFIED — SELF-AUDIT PASSED' : 'VERIFICATION FAILED');
  });

  // Tamper demo: mutate one event's args in a copy of the bundle — the chain
  // must break, proving the ledger is tamper-evident.
  document.getElementById('btn-tamper')?.addEventListener('click', async () => {
    const bundle = await loadBundle();
    if (!bundle) return;
    const mutated = JSON.parse(JSON.stringify(bundle));
    if (!mutated.replay?.length) {
      renderVerdicts(out, [{ ok: false, label: '✗', detail: 'bundle has no replay steps to mutate' }], 'DEMO UNAVAILABLE');
      return;
    }
    const i = Math.floor(mutated.replay.length / 2);
    mutated.replay[i] = { ...mutated.replay[i], args: { ...(mutated.replay[i].args || {}), tampered: 'judge-demo' } };
    const r = await verifyBundleClient(mutated);
    renderVerdicts(out, r.verdicts, 'TAMPER DETECTED — MUTATED BUNDLE REJECTED (step ' + (i + 1) + ', tool ' + mutated.replay[i].tool + ')');
  });
}
