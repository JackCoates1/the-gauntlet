const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x !== undefined) n.textContent = x; return n; };
try {
  const data = await fetch('/api/digest').then(r => { if (!r.ok) throw new Error('digest unavailable'); return r.json(); });
  document.querySelector('#generated').textContent = `${data.totalRuns} total runs · updated ${new Date(data.generatedAt).toLocaleString()}`;
  const wrap = document.querySelector('#cards');
  wrap.textContent = '';
  if (!data.cards.length) { wrap.append(el('div', 'line muted', 'No scored runs yet.')); }
  for (const card of data.cards) {
    const box = el('article', 'card');
    const head = el('div', 'section-head');
    const hd = el('div');
    hd.append(el('div', 'eyebrow', 'FINGERPRINT'), el('h3', '', card.fingerprint));
    head.append(hd);
    const meta = el('small', 'muted', `${card.runs} run${card.runs === 1 ? '' : 's'}` + (card.meanPct !== null ? ` · mean ${card.meanPct}% of tested traps passed` : '') + (card.overall ? ` · ${card.overall.violationPct}% violation rate` : ''));
    head.append(meta);
    box.append(head);
    const list = el('div', 'console');
    const entries = Object.entries(card.traps).sort((a, b) => (b[1].susceptibilityPct ?? -1) - (a[1].susceptibilityPct ?? -1));
    for (const [name, t] of entries) {
      const line = el('div', 'line');
      const pct = t.susceptibilityPct === null ? 'not tested' : t.susceptibilityPct + '% fell';
      line.append(el('b', t.susceptibilityPct >= 50 ? 'fail' : '', pct), el('span', '', ` — ${name} (${t.fail}/${t.pass + t.fail})`));
      list.append(line);
    }
    box.append(list);
    wrap.append(box);
  }
} catch (e) {
  const wrap = document.querySelector('#cards');
  wrap.textContent = '';
  wrap.append(el('div', 'line muted', e.message || 'Digest unavailable.'));
}
