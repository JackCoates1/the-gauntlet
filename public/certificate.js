// Browser-only resistance certificate.  It deliberately accepts only the
// already-sealed scorecard and the evidence bundle the scorecard has fetched:
// no new endpoint, storage, or HTML parsing is involved.
export const CERTIFICATE_WIDTH = 1200;
export const CERTIFICATE_HEIGHT = 630;

// These are the same palette values used by the resistance timeline in
// styles.css. Keep the outcome mapping here so the downloaded artifact cannot
// disagree with the on-page ledger.
export const TIMELINE_COLORS = Object.freeze({
  PASS: '#c5ff5f',
  FAIL: '#ff6b6b',
  'NOT TESTED': '#161d29',
});

const PINNED_PUBLIC_KEY_HEX = '17f868001b3ad45cc67a069e1115c1e8390debe4ad21add712477d91c857827a';
const encoder = new TextEncoder();

const bytesFromHex = hex => {
  if (!/^[0-9a-f]{64}$/i.test(String(hex || ''))) throw new Error('Invalid public key');
  return Uint8Array.from(hex.match(/../g), pair => parseInt(pair, 16));
};
const bytesFromBase64 = value => Uint8Array.from(atob(value), char => char.charCodeAt(0));
const canonicalize = value => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalize(value[key])).join(',') + '}';
};

// This is intentionally a lightweight signature-only check for the card.
// The full offline verifier also checks the replay hash chain and score; here
// we pin the known public key before allowing the certificate to say VERIFIED.
export async function hasVerifiedSignature(bundle) {
  if (!bundle || bundle.algorithm !== 'Ed25519' || bundle.publicKey !== PINNED_PUBLIC_KEY_HEX || !bundle.signature || !crypto?.subtle) return false;
  try {
    const { signature, replay, scorecard, publicKey, resistanceTimeline, ...payload } = bundle;
    const key = await crypto.subtle.importKey('raw', bytesFromHex(PINNED_PUBLIC_KEY_HEX), { name: 'Ed25519' }, false, ['verify']);
    return crypto.subtle.verify({ name: 'Ed25519' }, key, bytesFromBase64(signature), encoder.encode(canonicalize(payload)));
  } catch { return false; }
}

export function certificateOutcomeColor(status) {
  return TIMELINE_COLORS[status] || TIMELINE_COLORS['NOT TESTED'];
}

export function formatSealAge(createdAt, now = Date.now()) {
  const sealed = Date.parse(createdAt || '');
  if (!Number.isFinite(sealed)) return 'SEALED TIME UNAVAILABLE';
  const seconds = Math.max(0, Math.floor((now - sealed) / 1000));
  if (seconds < 60) return 'SEALED JUST NOW';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `SEALED ${minutes}M AGO`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `SEALED ${hours}H ${minutes % 60}M AGO`;
  return `SEALED ${Math.floor(hours / 24)}D AGO`;
}

const safeText = value => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 160);
const roundedRect = (ctx, x, y, width, height, radius) => {
  ctx.beginPath(); ctx.roundRect(x, y, width, height, radius); ctx.closePath();
};

export function drawResistanceCertificate({ scorecard, evidence, origin = location.origin, now = Date.now() } = {}) {
  if (!scorecard?.id) throw new Error('A sealed scorecard is required');
  const canvas = document.createElement('canvas');
  canvas.width = CERTIFICATE_WIDTH; canvas.height = CERTIFICATE_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is unavailable');
  const score = Number(scorecard.score) || 0;
  const total = Number(scorecard.total) || 0;
  const shortLink = String(origin).replace(/\/+$/, '') + '/scorecards/' + encodeURIComponent(scorecard.id);
  const timeline = Array.isArray(evidence?.resistanceTimeline) && evidence.resistanceTimeline.length
    ? evidence.resistanceTimeline : (scorecard.outcomes || []);
  const signatureVerified = evidence?.signatureVerified === true;

  ctx.fillStyle = '#070a10'; ctx.fillRect(0, 0, CERTIFICATE_WIDTH, CERTIFICATE_HEIGHT);
  ctx.fillStyle = '#0d121c'; ctx.fillRect(30, 30, 1140, 570);
  ctx.strokeStyle = '#202938'; ctx.lineWidth = 2; ctx.strokeRect(30, 30, 1140, 570);
  ctx.fillStyle = '#c5ff5f'; ctx.fillRect(30, 30, 8, 570);
  ctx.fillStyle = '#c5ff5f'; ctx.font = '500 19px monospace'; ctx.fillText('THE GAUNTLET  /  PUBLIC SECURITY RANGE', 76, 86);
  ctx.fillStyle = '#8490a2'; ctx.font = '16px monospace'; ctx.fillText('RESISTANCE CERTIFICATE', 76, 120);
  ctx.fillStyle = '#e9edf5'; ctx.font = '800 122px sans-serif'; ctx.fillText(`${score}/${total}`, 76, 248);
  ctx.fillStyle = '#8490a2'; ctx.font = '18px monospace'; ctx.fillText('TRAPS RESISTED', 82, 282);
  ctx.fillStyle = '#8490a2'; ctx.font = '16px monospace'; ctx.fillText('RUN ID  ' + safeText(scorecard.id), 76, 334);
  ctx.fillText(formatSealAge(scorecard.createdAt, now), 76, 366);

  roundedRect(ctx, 842, 72, 252, 44, 22);
  ctx.fillStyle = signatureVerified ? '#263a17' : '#382328'; ctx.fill();
  ctx.strokeStyle = signatureVerified ? '#c5ff5f' : '#ff6b6b'; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = signatureVerified ? '#c5ff5f' : '#ff6b6b'; ctx.font = '600 14px monospace';
  ctx.fillText(signatureVerified ? '✓ SIGNATURE VERIFIED' : 'SIGNATURE UNVERIFIED', 863, 100);

  ctx.fillStyle = '#8490a2'; ctx.font = '15px monospace'; ctx.fillText('SEALED OUTCOME STRIP', 76, 432);
  const stripX = 76, stripY = 452, stripWidth = 1018, stripHeight = 42, gap = 5;
  const segmentWidth = Math.max(3, (stripWidth - Math.max(0, timeline.length - 1) * gap) / Math.max(1, timeline.length));
  timeline.forEach((outcome, index) => {
    ctx.fillStyle = certificateOutcomeColor(outcome?.status);
    ctx.fillRect(stripX + index * (segmentWidth + gap), stripY, segmentWidth, stripHeight);
  });
  ctx.fillStyle = '#8490a2'; ctx.font = '14px monospace';
  ctx.fillText(`${timeline.filter(x => x?.status === 'PASS').length} RESISTED  /  ${timeline.filter(x => x?.status === 'FAIL').length} FLAGGED  /  ${timeline.filter(x => x?.status === 'NOT TESTED').length} NOT TESTED`, 76, 530);
  ctx.fillStyle = '#e9edf5'; ctx.font = '15px monospace'; ctx.fillText(safeText(shortLink), 76, 566);
  return canvas;
}

// `toDataURL` keeps the export local. The opened tab is a practical fallback
// on browsers that decline synthetic downloads; it also leaves a native image
// surface that can be right-clicked and saved.
export function downloadResistanceCertificate(options) {
  const canvas = drawResistanceCertificate(options);
  const dataUrl = canvas.toDataURL('image/png');
  const id = safeText(options?.scorecard?.id || 'run');
  const link = document.createElement('a');
  link.href = dataUrl; link.download = `gauntlet-resistance-${id}.png`;
  if ('download' in link) {
    document.body.append(link); link.click(); link.remove();
  } else {
    window.open(dataUrl, '_blank', 'noopener');
  }
  return dataUrl;
}
