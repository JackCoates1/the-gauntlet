// Production header policy guardrails. Cloudflare Pages publishes public/_headers
// verbatim, so this source check catches a CSP regression before deploy.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = join(root, 'public');
const headerPath = join(publicDir, '_headers');
let pass = 0, fail = 0;
const check = (condition, name) => {
  if (condition) pass++;
  else { fail++; console.error('FAIL: ' + name); }
};

check(existsSync(headerPath), 'Cloudflare Pages _headers file exists');
const headers = existsSync(headerPath) ? readFileSync(headerPath, 'utf8') : '';
const csp = headers.match(/^\s*Content-Security-Policy:\s*(.+)$/mi)?.[1] ?? '';
check(/default-src 'self'/.test(csp), 'CSP restricts default source to self');
check(/script-src 'self'/.test(csp) && !/script-src[^\n]*unsafe-inline/.test(csp), 'CSP permits only same-origin scripts');
check(/style-src 'self'/.test(csp) && !/style-src[^\n]*unsafe-inline/.test(csp), 'CSP permits only same-origin styles');
check(/img-src 'self' data:/.test(csp), 'CSP permits only same-origin and data images');
check(/connect-src 'self'/.test(csp), 'CSP restricts connections to self');
check(/frame-ancestors 'none'/.test(csp), 'CSP denies framing');
check(/base-uri 'none'/.test(csp) && /form-action 'self'/.test(csp), 'CSP protects base URI and forms');
check(/^\s*X-Frame-Options:\s*DENY\s*$/mi.test(headers), 'X-Frame-Options denies framing');
check(/^\s*X-Content-Type-Options:\s*nosniff\s*$/mi.test(headers), 'X-Content-Type-Options is nosniff');
check(/^\s*Referrer-Policy:\s*strict-origin-when-cross-origin\s*$/mi.test(headers), 'Referrer-Policy is strict-origin-when-cross-origin');
check(/^\s*Permissions-Policy:\s*camera=\(\), microphone=\(\), geolocation=\(\)\s*$/mi.test(headers), 'Permissions-Policy disables unneeded sensors');

const pages = readdirSync(publicDir).filter(file => file.endsWith('.html'));
for (const page of pages) {
  const html = readFileSync(join(publicDir, page), 'utf8');
  check(!/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/i.test(html), `${page} has no inline script`);
  check(!/<style\b[^>]*>[\s\S]*?<\/style>/i.test(html), `${page} has no inline style block`);
  check(!/\sstyle\s*=/i.test(html), `${page} has no inline style attribute`);
  check(!/\son[a-z]+\s*=/i.test(html), `${page} has no inline event handler`);
}

const scripts = readdirSync(publicDir).filter(file => file.endsWith('.js'));
for (const script of scripts) {
  const source = readFileSync(join(publicDir, script), 'utf8');
  check(!/\.style\.[a-zA-Z]/.test(source) && !/\.style\s*=/.test(source) && !/cssText/.test(source), `${script} has no runtime inline style sink`);
}

console.log(`\nsecurity header tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
