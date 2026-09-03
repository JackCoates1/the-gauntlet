// Every remote scorecard value is rendered with textContent / DOM assignment.
// This is deliberately a no-innerHTML page: evidence fields are data, never markup.
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const trapSlug = name => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const params = new URLSearchParams(location.search);
const pathIds = location.pathname.match(/^\/compare\/([^/]+)\/([^/]+)\/?$/);
const judgePathIds = location.pathname.match(/^\/compare\/a\/([^/]+)\/b\/([^/]+)\/?$/);
const aId = params.get('a') || judgePathIds?.[1] || pathIds?.[1], bId = params.get('b') || judgePathIds?.[2] || pathIds?.[2];
const root = document.querySelector('#comparison');
const outcome = (bundle, name) => (bundle.scorecard?.outcomes || []).find(x => x.name === name) || { name, status: 'NOT TESTED' };
const timeline = (bundle, name) => (bundle.resistanceTimeline || []).find(x => x.name === name) || { name, status: 'NOT TESTED', seconds: 0 };
const label = (s) => s === 'PASS' ? 'RESISTED' : s === 'FAIL' ? 'FELL' : 'NOT TESTED';
const note = (s) => s.status === 'NOT TESTED' ? 'not tested' : s.status === 'FAIL' ? 'fell after ' + (s.seconds || 0) + 's' : 'resisted, ' + (s.seconds || 0) + 's';
function trapLink(name, failed) { if (!failed) return el('span', '', name); const a = el('a', 'trap-link', name); a.href = '/traps#trap-' + trapSlug(name); return a; }
function verdict(a, b, name, baselineComparison) {
  const at = timeline(a, name), bt = timeline(b, name);
  if (baselineComparison && at.status === 'FAIL' && bt.status === 'PASS') return 'Your run fell for ' + name + '; the reference agent resisted it.';
  if (baselineComparison && at.status === 'PASS' && bt.status === 'FAIL') return 'Your run resisted ' + name + '; the reference agent fell for it.';
  if (at.status === 'PASS' && bt.status === 'FAIL') return 'Run A resisted ' + name + ' but Run B fell after ' + (bt.seconds || 0) + 's.';
  if (at.status === 'FAIL' && bt.status === 'PASS') return 'Run B resisted ' + name + ' but Run A fell after ' + (at.seconds || 0) + 's.';
  if (at.status !== bt.status) return 'Run A: ' + label(at.status) + '; Run B: ' + label(bt.status) + '.';
  if (at.status !== 'NOT TESTED' && at.seconds !== bt.seconds) return 'Both ' + (at.status === 'PASS' ? 'resisted' : 'fell') + '; Run ' + (at.seconds < bt.seconds ? 'A' : 'B') + ' resolved it ' + Math.abs(at.seconds - bt.seconds) + 's sooner.';
  return at.status === 'NOT TESTED' ? 'Neither run tested this trap.' : 'Same outcome in both runs.';
}
function runHead(letter, bundle, id, label = 'RUN ' + letter) {
  const c = bundle.scorecard || {};
  const box = el('div', 'compare-run');
  box.append(el('div', 'eyebrow', label + ' / ' + id), el('h2', '', String(c.score ?? 0) + '/' + String(c.total ?? 0)));
  box.append(el('p', 'signal', '✓ SIGNED EVIDENCE · ' + ((c.badges || []).join(' / ') || 'No badges')));
  const card = el('a', 'ghost', 'OPEN SCORECARD'); card.href = '/scorecards/' + encodeURIComponent(id); box.append(card);
  return box;
}
function timelineCell(bundle, name) {
  const s = timeline(bundle, name), kind = s.status === 'PASS' ? 'tl-pass' : s.status === 'FAIL' ? 'tl-fail' : 'tl-untested';
  const cell = el('div', 'compare-timeline');
  cell.append(el('div', 'tl-seg ' + kind));
  cell.append(el('span', kind, note(s)));
  return cell;
}
try {
  if (!uuid.test(aId || '') || !uuid.test(bId || '')) throw new Error('Choose two valid run IDs: /compare?a=<id>&b=<id>');
  if (aId === bId) throw new Error('Choose two different runs to compare.');
  const load = id => fetch('/api/scorecards/' + encodeURIComponent(id) + '/evidence').then(r => { if (!r.ok) throw new Error('Run ' + id + ' was not found'); return r.json(); });
  const [a, b, baseline] = await Promise.all([load(aId), load(bId), fetch('/baseline.json', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null)]);
  const baselineComparison = baseline?.id === bId;
  root.textContent = '';
  root.append(el('div', 'eyebrow', baselineComparison ? 'JUDGE VIEW / YOUR RUN VS REFERENCE AGENT' : 'JUDGE VIEW / EVIDENCE-BACKED COMPARISON'), el('h1', '', baselineComparison ? 'Your run vs the ' + baseline.score + '/' + baseline.total + ' reference agent.' : 'Why one agent outperformed.'));
  const heads = el('div', 'compare-heads'); heads.append(runHead('A', a, aId, baselineComparison ? 'YOUR RUN' : 'RUN A'), runHead('B', b, bId, baselineComparison ? baseline.score + '/' + baseline.total + ' REFERENCE AGENT' : 'RUN B')); root.append(heads);
  const share = el('button', 'ghost', 'SHARE COMPARISON');
  share.onclick = async () => { const url = location.origin + '/compare/' + encodeURIComponent(aId) + '/' + encodeURIComponent(bId); try { await navigator.clipboard.writeText(url); share.textContent = 'URL COPIED'; } catch { location.href = 'mailto:?subject=' + encodeURIComponent('Gauntlet run comparison') + '&body=' + encodeURIComponent(url); } setTimeout(() => { share.textContent = 'SHARE COMPARISON'; }, 1500); };
  root.append(share);
  const section = el('section', 'compare-table');
  const title = el('div', 'section-head'); title.append(el('div', '', '')); title.firstChild.append(el('div', 'eyebrow', 'TRAP-BY-TRAP DELTA'), el('h2', '', 'Aligned evidence'));
  section.append(title);
  const table = el('div', 'compare-rows');
  const header = el('div', 'compare-row compare-labels'); header.append(el('div', '', 'TRAP'), el('div', '', baselineComparison ? 'YOUR RUN' : 'RUN A'), el('div', '', baselineComparison ? 'REFERENCE' : 'RUN B'), el('div', '', 'DELTA')); table.append(header);
  const names = [...new Set([...(a.resistanceTimeline || []).map(x => x.name), ...(b.resistanceTimeline || []).map(x => x.name)])];
  for (const name of names) {
    const ao = outcome(a, name), bo = outcome(b, name), row = el('article', 'compare-row');
    const trap = el('div', 'compare-trap'); trap.append(trapLink(name, ao.status === 'FAIL' || bo.status === 'FAIL'), el('small', 'muted', timeline(a, name).attackClass || timeline(b, name).attackClass || ''));
    const ac = el('div', 'compare-result ' + (ao.status === 'FAIL' ? 'fail' : ao.status === 'PASS' ? 'tl-pass' : 'muted')); ac.append(el('b', '', label(ao.status)), timelineCell(a, name));
    const bc = el('div', 'compare-result ' + (bo.status === 'FAIL' ? 'fail' : bo.status === 'PASS' ? 'tl-pass' : 'muted')); bc.append(el('b', '', label(bo.status)), timelineCell(b, name));
    row.append(trap, ac, bc, el('div', 'compare-delta', verdict(a, b, name, baselineComparison))); table.append(row);
  }
  section.append(table); root.append(section);
} catch (e) {
  root.textContent = '';
  root.append(el('div', 'eyebrow', 'RUN COMPARISON'), el('h1', '', 'Comparison unavailable.'), el('p', 'lede', e.message || 'Unable to load those evidence bundles.'));
  // Clickable examples: pull a couple of real recent verified runs so a judge
  // can try the compare feature in one click instead of hand-typing UUIDs.
  // Soft-fail: if the API is unreachable the plain error message above stands.
  try {
    const recent = await fetch('/api/recent?limit=8').then(r => r.ok ? r.json() : null);
    const verified = (recent?.runs || []).filter(run => run.verified && run.url).slice(0, 3);
    if (verified.length >= 2) {
      const box = el('div', 'compare-examples');
      box.append(el('p', 'signal', 'TRY ONE OF THESE RECENT VERIFIED RUNS:'));
      const list = el('ul', 'compare-examples-list');
      for (const run of verified) {
        const item = el('li');
        const a = el('a', 'compare-example-link', 'Compare vs reference agent →');
        a.href = '/compare?a=' + encodeURIComponent(run.id) + '&b=baseline';
        item.append(el('span', '', String(run.score) + '/' + String(run.total) + ' — ' + String(run.label || 'web')), a);
        list.append(item);
      }
      box.append(list);
      const open = el('a', 'compare-example-link compare-example-browse', 'Browse all verified runs on the leaderboard →');
      open.href = '/leaderboard';
      box.append(open);
      root.append(box);
    }
  } catch { /* examples are additive decoration; the error message already rendered */ }
}
