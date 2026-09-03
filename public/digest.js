const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x !== undefined) n.textContent = x; return n; };
try {
  const [data, history] = await Promise.all([
    fetch('/api/digest').then(r => { if (!r.ok) throw new Error('digest unavailable'); return r.json(); }),
    fetch('/api/trapstats/history').then(r => r.ok ? r.json() : null).catch(() => null),
  ]);
  document.querySelector('#generated').textContent = `${data.totalRuns} total runs · updated ${new Date(data.generatedAt).toLocaleString()}`;
  const wrap = document.querySelector('#cards');
  wrap.textContent = '';
  if (!data.cards.length) { wrap.append(el('div', 'line muted', 'No scored runs yet.')); }
  if (history?.available && history.biggestSwing) {
    const swing = history.biggestSwing;
    const direction = swing.deltaPct > 0 ? 'up' : 'down';
    wrap.append(el('p', 'trend-callout ' + (swing.deltaPct > 0 ? 'trend-risk' : 'trend-learning'), `${swing.name} fall-rate ${direction} ${Math.abs(swing.deltaPct)} percentage points in ${swing.days} day${swing.days === 1 ? '' : 's'} (${swing.fromDay} → ${swing.toDay}).`));
  }
  const histories = new Map((history?.traps || []).map(t => [t.name, t.series]));
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
      const spark = fallRateSparkline(histories.get(name));
      if (spark) list.append(el('div', 'trend-line ' + spark.className, `${spark.label} ${spark.bars}`));
    }
    box.append(list);
    wrap.append(box);
  }
} catch (e) {
  const wrap = document.querySelector('#cards');
  wrap.textContent = '';
  wrap.append(el('div', 'line muted', e.message || 'Digest unavailable.'));
}

function fallRateSparkline(series) {
  if (!Array.isArray(series) || series.length < 2) return null;
  const bars = '▁▂▃▄▅▆▇█';
  const rates = series.map(b => b.exposures ? b.falls / b.exposures : 0);
  const glyphs = rates.map(rate => bars[Math.max(0, Math.min(bars.length - 1, Math.round(rate * (bars.length - 1))))]).join('');
  const delta = rates.at(-1) - rates[0];
  return {
    bars: glyphs,
    className: delta > 0 ? 'trend-risk' : 'trend-learning',
    label: `daily fall-rate · ${series.length}d`,
  };
}
