// Deployment workflow guardrails. CI must test every change, and only a
// successful main-branch run may publish it to the production Pages project.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const workflow = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');
let pass = 0, fail = 0;
const check = (condition, name) => {
  if (condition) pass++;
  else { fail++; console.error('FAIL: ' + name); }
};

const deploy = workflow.match(/\n  deploy:\n([\s\S]*?)(?=\n  [A-Za-z][\w-]*:\n|\s*$)/)?.[1] ?? '';

check(deploy.length > 0, 'workflow defines a deploy job');
check(/^\s*needs:\s*test\s*$/m.test(deploy), 'deploy waits for the test job');
check(/^\s*if:\s*github\.ref == 'refs\/heads\/main'\s*$/m.test(deploy), 'deploy only runs on main');
check(deploy.includes('cloudflare/wrangler-action@v3'), 'deploy uses the Cloudflare Wrangler action');
check(deploy.includes('apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}'), 'deploy reads the Cloudflare token from a GitHub secret');
check(deploy.includes('accountId: e1ba932163ebdc6eac5555c6d95a5944'), 'deploy targets the configured Cloudflare account');
check(deploy.includes('command: pages deploy public --project-name=the-gauntlet'), 'deploy publishes the public Pages build output');
check(!/cfat_|CLOUDFLARE_API_TOKEN:\s*[^$]/.test(workflow), 'workflow contains no Cloudflare token literal');

console.log(`\ndeployment workflow tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
