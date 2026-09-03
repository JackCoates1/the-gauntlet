import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { openapi } from './api-contract.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
writeFileSync(join(root, 'public/openapi.json'), JSON.stringify(openapi, null, 2) + '\n');
