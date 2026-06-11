import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scopeDir = path.join(root, 'node_modules', '@nexus');
const packages = [
  'protocol',
  'model-gateway',
  'sandbox',
  'storage',
  'tools',
  'memory',
  'extensions',
  'i18n',
  'bot',
  'runtime',
];

fs.mkdirSync(scopeDir, { recursive: true });

for (const name of packages) {
  const target = path.join(root, 'packages', name);
  const link = path.join(scopeDir, name);
  if (fs.existsSync(link)) continue;
  fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
}
