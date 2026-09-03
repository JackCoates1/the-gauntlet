const make = (tag, className, value) => { const node = document.createElement(tag); if (className) node.className = className; if (value !== undefined) node.textContent = value; return node; };
const list = document.querySelector('#trapStats');
const summary = document.querySelector('#trapStatsSummary');
try {
  const response = await fetch('/api/trapstats');
  if (!response.ok) throw new Error('Resistance statistics are unavailable.');
  const data = await response.json();
  if (!data.community.sealedRuns) { summary.textContent = 'No scored sealed runs yet — complete the range to establish the first baseline.'; }
  else {
    summary.textContent = 'Across ' + data.community.sealedRuns + ' sealed run' + (data.community.sealedRuns === 1 ? '' : 's') + ', the community resists ' + data.community.averageResisted + '/' + data.community.possibleTraps + ' traps on average. Ranked by fall rate among exposures.';
    for (const trap of data.traps.filter(t => t.exposureCount)) {
      const row = make('div', 'trap-stat');
      row.append(make('b', '', '#' + trap.rank), make('span', '', trap.name));
      const bar = document.createElement('progress'); bar.className = 'trap-stat-bar'; bar.max = 100; bar.value = trap.fallRatePct;
      row.append(bar, make('span', 'trap-stat-meta', trap.fallRatePct + '% fell · ' + trap.exposureCount + ' exposed · median ' + trap.medianSeconds + 's'));
      list.append(row);
    }
  }
} catch (error) { summary.textContent = error.message || 'Resistance statistics are unavailable.'; }
