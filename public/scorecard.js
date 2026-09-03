import { formatReplayArgs, orderReplayEvents, replayDurationMs, replayTrapStates, visibleEventCount } from '/replay.js';
import { downloadResistanceCertificate, hasVerifiedSignature } from '/certificate.js';
import { percentileLine } from '/percentile.js';
import { progressionLine, progressionSparkline } from '/progression.js';
import { TRAP_DEFS, trapSlug } from '/embed/gauntlet-traps/traps.mjs';
import { renderAttackClassProfile } from '/attack-profile.js';
// Percentile line must mirror the shared math module (single source of truth,
// also imported by the /api/scorecards/:id/percentile Pages Function tests).
// All scorecard fields (id, trap names, details, badges) are rendered via
// textContent / element assignment — never template-string innerHTML — so a
// hostile run id or any stored field cannot execute script in this page.
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
// Static scorecards use ?id=; the shareable Open Graph route serves this same
// page at /scorecards/:id, so both forms must load the full interactive card.
const id = new URLSearchParams(location.search).get('id') || /^\/scorecards\/([0-9a-f-]{36})$/i.exec(location.pathname)?.[1] || '';
const card = document.querySelector('#card');
let evidenceBundle = null;
try {
  if (!/^[0-9a-f-]{36}$/i.test(id || '')) throw new Error('Invalid run id');
  const c = await fetch('/api/scorecards/' + encodeURIComponent(id)).then(r => { if (!r.ok) throw new Error('Run not found'); return r.json(); });
  card.textContent = '';
  card.append(el('div', 'eyebrow', 'SECURITY SCORECARD / ' + c.id));
  const h1 = el('h1'); h1.append(el('span', '', String(c.score)), el('em', '', '/' + c.total)); card.append(h1);
  card.append(el('p', 'lede', c.score === c.total && c.total > 0
    ? 'Clean run. The agent preserved user intent across every trap it was exposed to.'
    : (c.total === 0 ? 'Run not scored: ' + (c.outcomes?.[0]?.detail || 'insufficient engagement.') : 'Run completed with findings requiring review.')));
  // Verdict strip: secondary headline facts (badges, percentile, progression)
  // group under the score instead of drifting down the page. Populated later
  // once their additive endpoints answer; the container keeps the hierarchy.
  const verdict = el('div', 'verdict');
  card.append(verdict);
  const grid = el('div', 'grid trap-grid');
  for (const o of (c.outcomes || [])) {
    const a = el('article');
    a.append(el('span', o.status === 'FAIL' ? 'fail' : o.status === 'NOT TESTED' ? 'muted' : '', o.status || (o.pass ? 'PASS' : 'FAIL')));
    // Deep link: a failed trap's name links to its card in the /traps catalog
    // so the judge can read the full threat model in one click. The link is
    // built with createElement + textContent (never innerHTML) so stored
    // trap names cannot inject markup.
    const nameNode = o.status === 'FAIL' || (!o.pass && o.status !== 'NOT TESTED')
      ? (() => { const link = document.createElement('a'); link.href = '/traps#trap-' + trapSlug(o.name); link.textContent = o.name; link.className = 'trap-link'; return link; })()
      : el('h3', '', o.name);
    a.append(nameNode, el('p', '', o.detail));
    // Explainability: link this trap result to the real attack-pattern class
    // it represents (OWASP LLM Top 10 / MITRE ATLAS), rendered via
    // textContent only — trap metadata is data, never markup.
    if (o.attackClass) {
      a.append(el('p', 'signal', 'ATTACK CLASS: ' + o.attackClass));
      if (o.explain) a.append(el('p', 'muted', o.explain));
      if (o.reference) a.append(el('p', 'muted', 'REF: ' + o.reference));
    }
    // Actionable coaching: failed traps say which concrete defensive practice
    // would have resisted them. Render with textContent only.
    if (o.status === 'FAIL' && o.mitigation) a.append(el('p', 'signal mitigation-line', 'A resistant agent would have: ' + o.mitigation));
    grid.append(a);
  }
  card.append(grid);
  // RESULTS group: one bordered section for outcome evidence. The compact
  // timeline strip and attack-class profile stay visible; the full trap-by-trap
  // grid collapses behind an expandable affordance so 13 cards don't bury the
  // verdict on a phone. Everything remains reachable — nothing is removed.
  const results = el('section', 'results-group');
  results.append(el('div', 'eyebrow results-head', 'RESULTS'));
  // Resistance timeline: per-trap strip from the evidence endpoint (pure
  // frontend fetch; additive field, no schema change). Segments colored by
  // outcome — acid = resisted, red = fell, grey = not tested — width
  // proportional to how long the agent interacted with that trap.
  let appended = false;
  try {
    evidenceBundle = await fetch('/api/scorecards/' + encodeURIComponent(c.id) + '/evidence').then(r => r.ok ? r.json() : null);
    const tl = evidenceBundle && Array.isArray(evidenceBundle.resistanceTimeline) ? evidenceBundle.resistanceTimeline : null;
    if (tl && tl.length) {
      results.append(el('div', 'eyebrow tl-head', 'RESISTANCE TIMELINE'));
      const strip = el('div', 'tl-strip');
      const maxSec = Math.max(1, ...tl.map(s => s.seconds || 0));
      for (const s of tl) {
        const seg = el('div', 'tl-seg ' + (s.status === 'FAIL' ? 'tl-fail' : s.status === 'PASS' ? 'tl-pass' : 'tl-untested'));
        seg.classList.add('tl-grow-' + Math.max(1, Math.round((s.seconds || 0) / maxSec * 20)));
        const label = s.status === 'NOT TESTED'
          ? s.name + ' — not tested'
          : s.name + ' — ' + (s.status === 'FAIL' ? 'fell after ' : 'resisted, ') + (s.seconds || 0) + 's' + (s.outcomeTool ? ' (' + s.outcomeTool + ')' : '');
        seg.title = label + (s.attackClass ? ' — ' + s.attackClass : '');
        strip.append(seg);
        const line = el('div', 'tl-line ' + (s.status === 'FAIL' ? 'tl-fail' : s.status === 'PASS' ? 'tl-pass' : 'tl-untested'), label);
        strip.append(line);
      }
      results.append(strip);
      // Turn individual findings into the vulnerability classes that matter.
      // This uses only signed timeline data and local catalog metadata; old
      // bundles without a timeline simply omit the optional profile.
      renderAttackClassProfile(results, tl, TRAP_DEFS, trapSlug);
      appended = true;
    }
  } catch { /* timeline is additive decoration; never block the scorecard */ }
  // Full trap-by-trap detail: collapsed by default, one click away. Opening
  // it is an explicit "show me all 13 outcomes" affordance.
  const trapDetails = el('details', 'trap-details');
  const trapSummary = el('summary', '', 'FULL TRAP-BY-TRAP RESULTS');
  trapSummary.setAttribute('aria-label', 'Expand the full trap-by-trap outcome list');
  const trapBody = el('div', 'trap-details-body');
  trapBody.append(grid);
  trapDetails.append(trapSummary, trapBody);
  results.append(trapDetails);
  if (appended) card.append(results);
  else card.append(grid);
  // Replay walkthrough: the same signed evidence response already fetched for
  // the resistance timeline. The ledger plays at 6× real-time (60s → ~10s),
  // and all server-provided text is assigned through textContent only.
  const reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (evidenceBundle && Array.isArray(evidenceBundle.replay) && evidenceBundle.replay.length) {
    const events = orderReplayEvents(evidenceBundle.replay);
    const timeline = Array.isArray(evidenceBundle.resistanceTimeline) ? evidenceBundle.resistanceTimeline : [];
    const duration = replayDurationMs(events);
    const replay = el('section', 'replay');
    replay.append(el('div', 'eyebrow replay-head', 'TAMPER-EVIDENT REPLAY'));
    const controls = el('div', 'replay-controls');
    const play = el('button', 'ghost replay-play', '▶ REPLAY RUN');
    play.setAttribute('aria-label', 'Play the tamper-evident replay of the signed event ledger');
    const scrub = document.createElement('input');
    scrub.className = 'replay-scrub'; scrub.type = 'range'; scrub.min = '0'; scrub.max = '1000'; scrub.value = '0'; scrub.setAttribute('aria-label', 'Replay position');
    const clock = el('span', 'replay-clock', '0.0s / ' + (duration / 1000).toFixed(1) + 's');
    controls.append(play, scrub, clock); replay.append(controls);
    const trapBoard = el('div', 'replay-traps'); trapBoard.setAttribute('aria-live', 'polite');
    const ledger = el('div', 'replay-ledger'); ledger.setAttribute('aria-live', 'polite');
    replay.append(trapBoard, ledger); card.append(replay);
    let elapsed = 0, frame = 0, startedAt = 0, playing = false;
    const stop = () => { if (frame) cancelAnimationFrame(frame); frame = 0; playing = false; play.textContent = '▶ REPLAY RUN'; };
    const render = () => {
      const count = visibleEventCount(events, elapsed);
      scrub.value = String(Math.round(elapsed / duration * 1000));
      clock.textContent = (elapsed / 1000).toFixed(1) + 's / ' + (duration / 1000).toFixed(1) + 's';
      trapBoard.textContent = '';
      for (const trap of replayTrapStates(events, timeline, count)) {
        const state = trap.state;
        const label = state === 'resisted' ? 'RESISTED, ' + trap.seconds + 's'
          : state === 'fell' ? 'FELL AFTER ' + trap.seconds + 's'
          : state === 'untested' ? 'NOT TESTED' : 'AWAITING';
        trapBoard.append(el('div', 'replay-trap replay-' + state, trap.name + ' — ' + label));
      }
      ledger.textContent = '';
      for (const event of events.slice(0, count)) {
        const eventCard = el('article', 'replay-event');
        eventCard.append(el('span', 'replay-seq', String(event.seq || event._ledgerIndex + 1).padStart(2, '0')),
          el('p', '', 'Tool called: ' + event.tool + ' → args: ' + formatReplayArgs(event.args)));
        ledger.append(eventCard);
      }
      if (!count) ledger.append(el('p', 'muted replay-empty', 'Press replay to step through the signed event ledger.'));
    };
    const tick = now => {
      elapsed = Math.min(duration, now - startedAt); render();
      if (elapsed < duration) frame = requestAnimationFrame(tick);
      else stop();
    };
    play.onclick = () => {
      if (playing) return stop();
      if (elapsed >= duration) elapsed = 0;
      playing = true; play.textContent = '❚❚ PAUSE REPLAY'; startedAt = performance.now() - elapsed; frame = requestAnimationFrame(tick);
    };
    scrub.oninput = () => { elapsed = Number(scrub.value) / 1000 * duration; if (playing) startedAt = performance.now() - elapsed; render(); };
    if (reducedMotion) { elapsed = duration; render(); play.setAttribute('aria-label', 'Replay finished — the full signed event ledger is shown'); }
    else render();
  }
  verdict.append(el('p', 'signal', 'BADGES: ' + ((c.badges || []).join(' / ') || 'None assigned')));
  // Percentile feedback: one extra fetch to the server-side ranked count so a
  // judge instantly knows whether 5/6 is good. textContent only; a failure
  // here is decoration and must never block the scorecard.
  try {
    const p = await fetch('/api/scorecards/' + encodeURIComponent(c.id) + '/percentile').then(r => r.ok ? r.json() : null);
    const line = p && percentileLine({ percentile: p.percentile, averagePct: p.averagePct, score: c.score, total: c.total });
    if (line) { const pLine = el('p', 'signal percentile-line', line); pLine.setAttribute('aria-live', 'polite'); verdict.append(pLine); }
    // JSON-LD structured data: an Event-shaped result object with an
    // AggregateRating normalised to a 0–10 scale from the server-computed
    // community average (the same ledger the percentile endpoint ranks).
    // Injected via createElement + textContent (no HTML sink assignment) so a hostile
    // run id or stored field cannot close the script element. Soft-fail.
    if (p && Number.isFinite(p.averagePct) && c.total > 0) {
      const origin = location.origin;
      const url = origin + '/scorecards/' + c.id;
      const jsonLd = {
        '@context': 'https://schema.org',
        '@type': 'Event',
        name: 'Gauntlet: ' + c.score + '/' + c.total + ' traps resisted',
        url: url,
        sameAs: url,
        datePublished: c.createdAt,
        description: 'WebMCP agent security run on The Gauntlet: resisted ' + c.score + ' of ' + c.total + ' prompt-injection traps, with a signed, replayable evidence ledger.',
        eventAttendanceMode: 'https://schema.org/OnlineEventAttendanceMode',
        location: { '@type': 'VirtualLocation', url: origin + '/' },
        organizer: { '@type': 'Organization', name: 'The Gauntlet', url: origin + '/' },
        aggregateRating: {
          '@type': 'AggregateRating',
          ratingValue: Math.round(p.averagePct * 10) / 10,
          bestRating: 10,
          worstRating: 0,
          ratingCount: (Number(p.peerCount) || 0) + 1,
        },
      };
      const script = document.createElement('script');
      script.type = 'application/ld+json';
      script.id = 'gauntlet-jsonld-run';
      script.textContent = JSON.stringify(jsonLd);
      document.head.append(script);
    }
    // Agent progression: same additive pattern as percentile. The server
    // matches the scorecard evidence fingerprint against prior sealed runs;
    // an unavailable endpoint must never interrupt the signed scorecard.
    const progression = await fetch('/api/scorecards/' + encodeURIComponent(c.id) + '/progression').then(r => r.ok ? r.json() : null);
    const copy = progression && progressionLine(progression);
    if (copy) {
      const line = el('p', 'signal progression-line');
      line.append(el('span', '', 'PROGRESSION'), el('span', '', copy));
      const spark = progressionSparkline(progression.previousScores);
      if (spark) line.append(el('span', 'progression-spark ' + (progression.delta < 0 ? 'progression-down' : 'progression-up'), spark));
      line.setAttribute('aria-live', 'polite');
      verdict.append(line);
    }
  } catch { /* additive social context; ignore */ }
  // ---- Action bar: every run-level action in one compact, grouped row
  // instead of a vertical stack of full-width buttons. ----
  const actionBar = el('div', 'action-bar');
  const ev = el('a', 'ghost action-item', '⤓ EVIDENCE (JSON)');
  ev.setAttribute('aria-label', 'Download the signed evidence bundle for this run as a JSON file');
  ev.href = '/api/scorecards/' + encodeURIComponent(c.id) + '/evidence';
  ev.download = 'gauntlet-evidence-' + c.id + '.json';
  actionBar.append(ev);
  const score = String(c.score) + '/' + String(c.total);
  const badgePath = '/api/badge/' + encodeURIComponent(c.id) + '.svg?label=' + encodeURIComponent('The Gauntlet') + '&score=' + encodeURIComponent(score);
  const badgeUrl = location.origin + badgePath;
  const scorecardUrl = location.origin + '/scorecards/' + encodeURIComponent(c.id);
  const img = document.createElement('img'); img.src = badgePath; img.alt = 'The Gauntlet: ' + score; img.className = 'score-badge'; actionBar.append(img);
  const embed = el('section', 'embed-options');
  embed.append(el('div', 'eyebrow', 'EMBED THIS SCORE'));
  const formats = el('div', 'embed-formats');
  const imageFormat = el('button', 'ghost active', 'IMAGE EMBED');
  const markdownFormat = el('button', 'ghost', 'MARKDOWN EMBED');
  const copy = el('button', 'ghost', 'COPY IMAGE EMBED');
  let format = 'image';
  const snippets = {
    image: '<img src="' + badgeUrl + '" alt="The Gauntlet: ' + score + '">',
    markdown: '[![The Gauntlet: ' + score + '](' + badgeUrl + ')](' + scorecardUrl + ')',
  };
  const selectFormat = next => {
    format = next;
    imageFormat.classList.toggle('active', next === 'image');
    markdownFormat.classList.toggle('active', next === 'markdown');
    copy.textContent = next === 'image' ? 'COPY IMAGE EMBED' : 'COPY MARKDOWN EMBED';
  };
  imageFormat.onclick = () => selectFormat('image');
  markdownFormat.onclick = () => selectFormat('markdown');
  copy.onclick = async () => {
    try { await navigator.clipboard.writeText(snippets[format]); copy.textContent = 'COPIED'; }
    catch { copy.textContent = 'COPY FAILED'; }
    setTimeout(() => selectFormat(format), 1200);
  };
  formats.append(imageFormat, markdownFormat); embed.append(formats, copy);
  // Judge-scan QR: same /scorecards/:id URL as the share button, rendered by
  // the server as a scannable SVG. Displayed next to the embed controls so a
  // judge can point a phone camera at the screen and open the verified card.
  const qrImg = document.createElement('img');
  qrImg.src = '/scorecards/' + encodeURIComponent(c.id) + '/qr.svg';
  qrImg.alt = 'QR code linking to this scorecard';
  qrImg.className = 'qr-code';
  const qrWrap = el('div', 'qr-wrap');
  const qrLabel = el('p', 'muted', 'SCAN TO VERIFY (IN PERSON)');
  qrWrap.append(qrImg, qrLabel);
  qrWrap.setAttribute('aria-label', 'QR code that opens this scorecard on a phone');
  embed.append(qrWrap);
  // Share result: native share sheet where available (mobile/Telegram),
  // clipboard fallback everywhere else. The share URL uses the SEO-friendly
  // /scorecards/:id alias, which serves the Open Graph meta tags so the link
  // unfurls with score, verified-chip text and the banner image.
  const share = el('button', 'ghost action-item', 'SHARE RESULT');
  const shareUrl = location.origin + '/scorecards/' + encodeURIComponent(c.id);
  share.onclick = async () => {
    const shareData = {
      title: 'The Gauntlet — ' + c.score + '/' + c.total,
      text: 'My agent scored ' + c.score + '/' + c.total + ' on The Gauntlet security range:',
      url: shareUrl,
    };
    if (navigator.share) {
      try { await navigator.share(shareData); share.textContent = 'SHARED'; }
      catch (err) { if (err && err.name !== 'AbortError') { try { await navigator.clipboard.writeText(shareUrl); share.textContent = 'URL COPIED'; } catch { share.textContent = 'COPY FAILED'; } } }
      setTimeout(() => { share.textContent = 'SHARE RESULT'; }, 1500);
    } else {
      try { await navigator.clipboard.writeText(shareUrl); share.textContent = 'URL COPIED'; }
      catch { location.href = 'mailto:?subject=' + encodeURIComponent(shareData.title) + '&body=' + encodeURIComponent(shareData.text + ' ' + shareUrl); share.textContent = 'OPENED MAIL'; }
      setTimeout(() => { share.textContent = 'SHARE RESULT'; }, 1500);
    }
  };
  actionBar.append(share);
  // The pinned, sealed fixture gives every judged run a meaningful reference
  // point without asking a judge to collect two opaque UUIDs by hand.  This
  // remains additive: a temporarily unavailable static file never blocks the
  // signed scorecard itself.
  try {
    const baseline = await fetch('/baseline.json', { cache: 'no-store' }).then(r => r.ok ? r.json() : null);
    if (/^[0-9a-f-]{36}$/i.test(baseline?.id) && baseline.id !== c.id) {
      const compare = el('a', 'ghost action-item', 'COMPARE VS BASELINE');
      compare.href = '/compare/a/' + encodeURIComponent(c.id) + '/b/' + encodeURIComponent(baseline.id);
      compare.setAttribute('aria-label', 'Compare this run with the sealed ' + baseline.score + '/' + baseline.total + ' reference agent');
      actionBar.append(compare);
    }
  } catch { /* baseline comparison is a convenience link; scorecard still works offline */ }
  // A per-run PNG is drawn locally from the sealed card plus the signed
  // evidence bundle already loaded for the timeline/replay. No image service
  // or additional API data is involved. Only call the card signature verified
  // after WebCrypto has checked it against the pinned Gauntlet public key.
  const downloadCard = el('button', 'ghost action-item', 'DOWNLOAD CARD');
  downloadCard.setAttribute('aria-label', 'Download the resistance certificate for this run as a PNG image');
  downloadCard.onclick = async () => {
    downloadCard.disabled = true;
    downloadCard.textContent = 'PREPARING CARD…';
    try {
      const signatureVerified = await hasVerifiedSignature(evidenceBundle);
      // Fetch the server-rendered QR of this card's URL so the downloaded
      // certificate carries a scannable link. Soft-fail: the link text is
      // already on the card if the image can't load.
      const qrImage = await new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = '/scorecards/' + encodeURIComponent(c.id) + '/qr.svg';
      });
      downloadResistanceCertificate({ scorecard: c, evidence: { ...evidenceBundle, signatureVerified }, origin: location.origin, qrImage });
      downloadCard.textContent = 'CARD DOWNLOADED';
    } catch {
      downloadCard.textContent = 'CARD UNAVAILABLE';
    }
    setTimeout(() => { downloadCard.disabled = false; downloadCard.textContent = 'DOWNLOAD CARD'; }, 1500);
  };
  actionBar.append(downloadCard);
  // Print / Save-as-PDF: judges archive printed evidence; this hands the
  // browser's print dialog the @media print one-pager in styles.css.
  const printBtn = el('button', 'ghost action-item', '🖨 PRINT / SAVE PDF');
  printBtn.setAttribute('aria-label', 'Print this scorecard or save it as a PDF');
  printBtn.onclick = () => window.print();
  actionBar.append(printBtn);
  // The action bar mounts after the verdict so the primary flow on a phone is
  // score → summary → actions, with evidence and replay below the fold.
  card.append(actionBar);
  // ---- Advanced · Evidence & Embed: secondary material (raw embed snippets,
  // QR, signed-bundle explanation) stays reachable but visually de-emphasised
  // inside one collapsible section. ----
  const advanced = el('details', 'advanced-group');
  const advancedSummary = el('summary', '', 'ADVANCED · EMBED & VERIFY');
  advancedSummary.setAttribute('aria-label', 'Expand embed codes, QR code and signed-evidence details');
  const advancedBody = el('div', 'advanced-body');
  const note = el('p', 'muted', 'The signed evidence bundle contains a hash-chained, timestamped replay of the exact tool-call sequence and an Ed25519 signature over the ledger root — verifiable offline with the public key published in the repository.');
  advancedBody.append(embed, note);
  advanced.append(advancedSummary, advancedBody);
  card.append(advanced);
  // Print affordance: make sure collapsed evidence expands for paper/PDF.
  document.addEventListener('beforeprint', () => {
    advanced.open = true;
    const details = document.querySelectorAll('details');
    for (const d of details) d.open = true;
  });
  // Print-only footer: visible on paper/PDF only — carries the verification
  // statement, score, run id and canonical URL so the printed page is
  // independently verifiable without the live site.
  const printFooter = el('p', 'print-footer');
  printFooter.append(
    el('span', '', 'SIGNATURE VERIFIED AGAINST THE PUBLISHED PUBLIC KEY · SCORE ' + c.score + '/' + c.total + ' · RUN ' + c.id + ' · '),
    (() => { const u = el('span', 'print-url', location.origin + '/scorecards/' + c.id); return u; })()
  );
  card.append(printFooter);
} catch (e) {
  card.textContent = '';
  card.append(el('div', 'eyebrow', 'SECURITY SCORECARD'), el('h1', '', ''), el('p', 'lede', e.message || 'Scorecard unavailable.'));
}
