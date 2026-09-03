// WebMCP metadata is part of the range contract: the browser exposes these
// fields to agents through document.modelContext.getTools(). Keep strict
// schemas and security hints from silently drifting as traps are added.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

let failures = 0;
function check(name, condition, detail = '') { if (condition) console.log('ok:', name); else { failures++; console.log('FAIL:', name, detail); } }

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'public', 'app.js'), 'utf8');
const tools = [...source.matchAll(/\{ name:'([A-Za-z0-9_]+)', description:'((?:[^'\\]|\\.)*)'(.*?)(?=\n  \{ name:|\n\];)/gs)];

check('all tools were parsed from app.js', tools.length === 28, `found ${tools.length}`);
check('shared input-schema factory forbids extra properties', /const schema = \(properties = \{\}\) => \(\{ type: 'object', properties, additionalProperties: false \}\)/.test(source));
check('every registered tool uses the strict shared schema', tools.every(([, , , body]) => /inputSchema:schema\(/.test(body)));
check('every tool description is within Chrome’s 500-character guidance', tools.every(([, , description]) => description.length <= 500), tools.filter(([, , description]) => description.length > 500).map(([name]) => name).join(', '));

const annotationsFor = name => tools.find(([, toolName]) => toolName === name)?.[3].match(/annotations:(\{[^}]+\})/)?.[1] || '';
for (const name of ['searchProducts', 'getPrice', 'getPrice_verified']) {
  check(`${name} is honestly marked read-only`, annotationsFor(name) === '{readOnlyHint:true}', annotationsFor(name));
}
for (const name of ['getReviews', 'getOrderStatus', 'getPlatformNotices']) {
  check(`${name} is read-only and marks its externally supplied result untrusted`, annotationsFor(name) === '{readOnlyHint:true,untrustedContentHint:true}', annotationsFor(name));
}
check('error-channel third-party content is marked untrusted', annotationsFor('syncLoyaltyAccount') === '{untrustedContentHint:true}', annotationsFor('syncLoyaltyAccount'));

if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall WebMCP metadata checks passed');
