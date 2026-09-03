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
    const box = el('article', 'digest-card');
    const head = el('div', 'digest-card-head');
    const title = el('div');
    title.append(el('div', 'eyebrow', 'FINGERPRINT'), el('h3', '', card.fingerprint));
    const summary = el('div', 'digest-summary');
    summary.append(
      digestMetric(card.meanPct === null ? '—' : `${card.meanPct}%`, 'MEAN RESISTANCE'),
      digestMetric(card.overall ? `${card.overall.violationPct}%` : '—', 'VIOLATION RATE'),
      digestMetric(String(card.runs), card.runs === 1 ? 'SEALED RUN' : 'SEALED RUNS'),
    );
    head.append(title, summary);
    box.append(head);
    const entries = Object.entries(card.traps).sort((a, b) => (b[1].susceptibilityPct ?? -1) - (a[1].susceptibilityPct ?? -1));
    const overview = el('div', 'digest-overview');
    overview.append(el('div', 'digest-overview-label', 'ATTACK-CLASS RISK OVERVIEW'));
    const grid = el('div', 'digest-risk-grid');
    for (const [name, t] of entries) {
      const pct = t.susceptibilityPct === null ? 'not tested' : t.susceptibilityPct + '% fell';
      const tested = t.pass + t.fail;
      const cell = el('div', 'digest-risk ' + (t.susceptibilityPct >= 50 ? 'digest-risk-high' : ''));
      const rate = el('b', t.susceptibilityPct >= 50 ? 'fail' : '', pct);
      cell.append(rate, el('span', 'digest-risk-name', name), el('small', 'muted', tested ? `${t.fail}/${tested} fell` : 'no exposures'));
      grid.append(cell);
    }
    overview.append(grid);
    box.append(overview);

    const details = el('details', 'digest-details');
    const detailSummary = el('summary', '', 'FULL PER-TRAP BREAKDOWN & DAILY TRENDS');
    detailSummary.setAttribute('aria-label', `Expand per-trap breakdown and daily fall-rate trends for ${card.fingerprint}`);
    const list = el('div', 'digest-detail-list');
    for (const [name, t] of entries) {
      const row = el('div', 'digest-detail-row');
      const copy = el('div');
      const tested = t.pass + t.fail;
      copy.append(el('b', t.susceptibilityPct >= 50 ? 'fail' : '', name), el('small', 'muted', t.susceptibilityPct === null ? 'Not tested' : `${t.susceptibilityPct}% fell · ${t.fail}/${tested} exposures`));
      const spark = fallRateSparkline(histories.get(name));
      row.append(copy);
      row.append(el('span', 'digest-trend ' + (spark?.className || ''), spark ? `${spark.label} ${spark.bars}` : 'daily trend unavailable'));
      list.append(row);
    }
    details.append(detailSummary, list);
    box.append(details);
    wrap.append(box);
  }
} catch (e) {
  const wrap = document.querySelector('#cards');
  wrap.textContent = '';
  wrap.append(el('div', 'line muted', e.message || 'Digest unavailable.'));
}

function digestMetric(value, label) {
  const metric = el('div', 'digest-metric');
  metric.append(el('strong', '', value), el('span', '', label));
  return metric;
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
