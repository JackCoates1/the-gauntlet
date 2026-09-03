// Bundle the static scorecard shell for the dynamic /scorecards/:id OG route.
// Keeping this generated avoids the two delivery paths drifting apart.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'public', 'scorecard.html'), 'utf8');
writeFileSync(join(root, 'functions', 'scorecards', 'scorecard-html.js'), `export default ${JSON.stringify(html)};\n`);
console.log('built functions/scorecards/scorecard-html.js from public/scorecard.html');
