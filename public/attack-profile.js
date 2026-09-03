// Client-side aggregation for the scorecard's class-level exposure profile.
// Evidence timelines identify exercised traps; the local catalog supplies the
// canonical OWASP class, mitigation, and /traps anchor.
export const attackClassCode = value => /^([A-Z]+\d{2})\b/.exec(String(value || '').trim())?.[1] || '';

export function buildAttackClassProfile(timeline, trapDefs = []) {
  if (!Array.isArray(timeline) || !Array.isArray(trapDefs)) return [];
  const definitions = new Map(trapDefs.map(trap => [trap?.name, trap]));
  const groups = new Map(), seen = new Set();
  for (const result of timeline) {
    if (!result || seen.has(result.name) || !['PASS', 'FAIL'].includes(result.status)) continue;
    seen.add(result.name);
    const trap = definitions.get(result.name), code = attackClassCode(trap?.attackClass);
    if (!trap || !code) continue;
    const group = groups.get(code) || { code, resisted: 0, fell: 0, total: 0, anchorName: trap.name, mitigation: '' };
    group.total++;
    if (result.status === 'PASS') group.resisted++;
    else {
      group.fell++;
      // One focused coaching line per weak class, from canonical metadata.
      if (!group.mitigation) group.mitigation = typeof trap.mitigation === 'string' ? trap.mitigation : '';
    }
    groups.set(code, group);
  }
  return [...groups.values()];
}

export function renderAttackClassProfile(container, timeline, trapDefs, trapSlug) {
  const profile = buildAttackClassProfile(timeline, trapDefs);
  if (!profile.length || !container || typeof document === 'undefined') return false;
  const make = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const section = make('section', 'attack-profile');
  section.append(make('div', 'eyebrow attack-profile-head', 'ATTACK CLASS PROFILE'));
  for (const group of profile) {
    const row = make('div', 'attack-profile-row');
    const label = document.createElement('a');
    label.className = 'attack-profile-label';
    label.href = '/traps#trap-' + trapSlug(group.anchorName);
    label.textContent = group.code + ': ' + group.resisted + '/' + group.total + ' resisted';
    label.setAttribute('aria-label', group.code + ': ' + group.resisted + ' of ' + group.total + ' traps resisted. View catalog trap.');
    const bar = make('div', 'attack-profile-bar');
    const pass = make('span', 'attack-profile-pass');
    pass.classList.add('attack-profile-grow-' + group.resisted);
    const fail = make('span', 'attack-profile-fail');
    fail.classList.add('attack-profile-grow-' + group.fell);
    pass.title = group.resisted + ' resisted'; fail.title = group.fell + ' fell';
    bar.append(pass, fail); row.append(label, bar);
    if (group.fell && group.mitigation) row.append(make('p', 'attack-profile-coaching', 'COACHING: ' + group.mitigation));
    section.append(row);
  }
  container.append(section);
  return true;
}
