import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

let failures = 0, checks = 0;
const check = (name, condition) => { checks++; if (!condition) { failures++; console.error('FAIL:', name); } };
const root = new URL('..', import.meta.url);
const script = new URL('../scripts/backup-d1.sh', import.meta.url).pathname;
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const docs = readFileSync(new URL('../public/docs.html', import.meta.url), 'utf8');
const source = readFileSync(script, 'utf8');

check('uses strict shell error handling and restrictive output permissions', source.includes('set -euo pipefail') && source.includes('umask 077'));
check('exports the named production D1 database remotely', source.includes('wrangler d1 export the-gauntlet --remote --output'));
check('compresses snapshots and verifies non-empty SQL before compression', source.includes('[[ -s "$SQL_PATH" ]]') && source.includes('gzip -9 -- "$SQL_PATH"'));
check('keeps a bounded number of snapshots with a narrow backup glob', source.includes("-name 'd1-*.sql.gz'") && source.includes('GAUNTLET_D1_BACKUP_KEEP:-14'));
check('does not embed a token literal', !/cfat_|CLOUDFLARE_API_TOKEN=[A-Za-z0-9_-]{20,}/.test(source));
check('README documents the durability policy and restore command', readme.includes('## Data durability') && readme.includes('wrangler d1 execute the-gauntlet --remote --file'));
check('judge-facing docs expose the durability control', docs.includes('Data durability') && docs.includes('D1 ledger'));

const sandbox = mkdtempSync(join(tmpdir(), 'gauntlet-d1-backup-'));
try {
  const bin = join(sandbox, 'bin');
  const backups = join(sandbox, 'backups');
  mkdirSync(bin); mkdirSync(backups);
  writeFileSync(join(bin, 'npx'), `#!/usr/bin/env bash\nset -euo pipefail\n[[ "$*" == *"wrangler d1 export the-gauntlet --remote --output"* ]]\nfor ((i=1; i <= $#; i++)); do\n  if [[ "\${!i}" == "--output" ]]; then\n    next=$((i + 1)); out="\${!next}"; break\n  fi\ndone\nprintf '%s\\n' 'BEGIN TRANSACTION;' 'CREATE TABLE runs (id TEXT);' 'COMMIT;' > "$out"\n`);
  writeFileSync(join(sandbox, 'auth.json'), '{"dns_token":"test-token"}');
  execFileSync('chmod', ['+x', join(bin, 'npx')]);
  execFileSync('bash', [script], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GAUNTLET_NPX_BIN: join(bin, 'npx'), GAUNTLET_REPO_DIR: sandbox, GAUNTLET_D1_BACKUP_DIR: backups, GAUNTLET_CLOUDFLARE_CONFIG: join(sandbox, 'auth.json'), GAUNTLET_D1_BACKUP_KEEP: '1' }, stdio: 'pipe' });
  const files = readdirSync(backups);
  const snapshot = files.find(file => /^d1-\d{4}-\d{2}-\d{2}-\d{4}\.sql\.gz$/.test(file));
  check('mocked export creates one compressed timestamped SQL snapshot', !!snapshot && existsSync(join(backups, snapshot)));
  const sql = execFileSync('gzip', ['-dc', join(backups, snapshot)], { encoding: 'utf8' });
  check('compressed snapshot preserves exported SQL', sql.includes('CREATE TABLE runs'));
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}

console.log(`d1 backup: ${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
