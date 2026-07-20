import { readdir } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_SCOPES = ['packages', 'apps'];
const SKIPPED_DIRECTORIES = new Set(['dist', 'dist-types', 'node_modules']);
const SOURCE_ARTIFACT_PATTERN = /(?:\.js(?:\.map)?|\.d\.ts(?:\.map)?)$/;

export async function findSourceArtifacts(workspaceRoot) {
  const absoluteWorkspaceRoot = resolve(workspaceRoot);
  const sourceRoots = await findSourceRoots(absoluteWorkspaceRoot);
  const artifacts = [];

  for (const sourceRoot of sourceRoots) {
    await collectSourceArtifacts(sourceRoot, absoluteWorkspaceRoot, artifacts);
  }

  return artifacts.sort();
}

async function findSourceRoots(workspaceRoot) {
  const sourceRoots = [];

  for (const scope of SOURCE_SCOPES) {
    const scopeRoot = resolve(workspaceRoot, scope);
    const entries = await readDirectory(scopeRoot);
    if (entries === null) {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || SKIPPED_DIRECTORIES.has(entry.name)) {
        continue;
      }

      const sourceRoot = resolve(scopeRoot, entry.name, 'src');
      const sourceEntries = await readDirectory(sourceRoot);
      if (sourceEntries !== null) {
        sourceRoots.push(sourceRoot);
      }
    }
  }

  return sourceRoots;
}

async function collectSourceArtifacts(directory, workspaceRoot, artifacts) {
  const entries = await readDirectory(directory);
  if (entries === null) {
    return;
  }

  for (const entry of entries) {
    const entryPath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) {
        await collectSourceArtifacts(entryPath, workspaceRoot, artifacts);
      }
      continue;
    }

    if (entry.isFile() && SOURCE_ARTIFACT_PATTERN.test(entry.name)) {
      artifacts.push(relative(workspaceRoot, entryPath).split(sep).join('/'));
    }
  }
}

async function readDirectory(directory) {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const artifacts = await findSourceArtifacts(process.cwd());
    if (artifacts.length > 0) {
      console.error([
        'Generated TypeScript artifacts found in source directories:',
        ...artifacts.map((artifact) => `- ${artifact}`),
      ].join('\n'));
      process.exitCode = 1;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to check source artifacts: ${message}`);
    process.exitCode = 1;
  }
}
