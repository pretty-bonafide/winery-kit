// Filesystem edge shared by the release scripts.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PACKAGE_DIRS } from './release-core.mjs';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const packageDirs = PACKAGE_DIRS.map((dir) => join(repoRoot, dir));

export const defaultOutputDir = join(repoRoot, 'release-artifacts');

export function manifestPath(packageDir) {
  return join(packageDir, 'package.json');
}

export function readManifests() {
  return packageDirs.map((dir) => JSON.parse(readFileSync(manifestPath(dir), 'utf8')));
}

export function exitWithErrors(errors) {
  for (const error of errors) console.error(`error: ${error}`);
  process.exit(1);
}
