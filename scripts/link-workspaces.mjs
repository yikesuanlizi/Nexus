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

function normalizePath(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function readLinkTarget(value) {
  try {
    return fs.realpathSync.native(value);
  } catch {
    return null;
  }
}

for (const name of packages) {
  const target = path.join(root, 'packages', name);
  const link = path.join(scopeDir, name);
  try {
    const stat = fs.lstatSync(link);
    const currentTarget = readLinkTarget(link);
    const desiredTarget = readLinkTarget(target) ?? target;
    if (currentTarget && normalizePath(currentTarget) === normalizePath(desiredTarget)) {
      continue;
    }
    if (!stat.isSymbolicLink()) {
      throw new Error(`Workspace link path exists but is not a symlink: ${link}`);
    }
    fs.rmSync(link, { force: true });
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }
  fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
}
