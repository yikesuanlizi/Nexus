import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import './link-workspaces.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';

function bin(name) {
  return path.join(root, 'node_modules', '.bin', isWindows ? `${name}.CMD` : name);
}

function run(command, args, options = {}) {
  const child = isWindows && command.toLowerCase().endsWith('.cmd')
    ? spawn(command, args, {
        cwd: options.cwd ?? root,
        stdio: 'inherit',
        shell: true,
        env: { ...process.env, ...options.env },
      })
    : spawn(command, args, {
    cwd: options.cwd ?? root,
    stdio: 'inherit',
    shell: false,
    env: { ...process.env, ...options.env },
  });
  child.on('exit', (code) => {
    if (code && !options.allowExit) {
      process.exit(code);
    }
  });
  return child;
}

const build = run(bin('tsc'), ['-b'], { allowExit: true });
build.on('exit', (code) => {
  if (code) process.exit(code);

  const api = run('node', ['apps/api/dist/server.js'], {
    env: { NEXUS_API_PORT: process.env.NEXUS_API_PORT ?? '4127' },
  });
  const web = run(bin('vite'), ['--host', '127.0.0.1', '--port', '5177'], {
    cwd: path.join(root, 'apps', 'web'),
    env: { FORCE_COLOR: '1' },
  });

  const stop = () => {
    api.kill();
    web.kill();
  };

  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
});
