#!/usr/bin/env node
// Clean-builds both packages and packs them: release-pack.mjs [output-dir]
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  findUnresolvableSpecifiers,
  formatSha256Sums,
  SUMS_FILE,
  tarballName,
  validateRelease,
  validateTarballEntries,
} from './lib/release-core.mjs';
import {
  defaultOutputDir,
  exitWithErrors,
  packageDirs,
  readManifests,
  repoRoot,
} from './lib/workspace.mjs';

function run(command, args, cwd = repoRoot) {
  execFileSync(command, args, { cwd, stdio: 'inherit' });
}

function capture(command, args) {
  return execFileSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function distSourceFiles(dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(js|d\.ts)$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name));
}

function unresolvableImportErrors(packageDir) {
  return distSourceFiles(join(packageDir, 'dist')).flatMap((file) =>
    findUnresolvableSpecifiers(readFileSync(file, 'utf8')).map(
      (specifier) => `${file}: "${specifier}" will not resolve under Node ESM`,
    ),
  );
}

function packWithLicense(outputDir) {
  const licenses = packageDirs.map((dir) => join(dir, 'LICENSE'));
  try {
    for (const license of licenses) copyFileSync(join(repoRoot, 'LICENSE'), license);
    for (const dir of packageDirs) run('pnpm', ['pack', '--pack-destination', outputDir], dir);
  } finally {
    for (const license of licenses) rmSync(license, { force: true });
  }
}

function tarballEntries(path) {
  return capture('tar', ['-tzf', path]).split('\n').filter(Boolean);
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

const outputDir = resolve(process.argv[2] ?? defaultOutputDir);
const manifests = readManifests();

const releaseErrors = validateRelease({ manifests });
if (releaseErrors.length > 0) exitWithErrors(releaseErrors);

rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });
for (const dir of packageDirs) rmSync(join(dir, 'dist'), { recursive: true, force: true });

run('pnpm', ['build']);

const importErrors = packageDirs.flatMap(unresolvableImportErrors);
if (importErrors.length > 0) exitWithErrors(importErrors);

packWithLicense(outputDir);

const tarballs = manifests.map((manifest) => ({
  manifest,
  file: tarballName(manifest.name, manifest.version),
}));

const tarballErrors = tarballs.flatMap(({ manifest, file }) =>
  validateTarballEntries({ entries: tarballEntries(join(outputDir, file)), manifest }),
);
if (tarballErrors.length > 0) exitWithErrors(tarballErrors);

const digests = tarballs.map(({ file }) => ({ file, sha256: sha256(join(outputDir, file)) }));
writeFileSync(join(outputDir, SUMS_FILE), formatSha256Sums(digests));

console.log(`Packed ${tarballs.length} tarballs and ${SUMS_FILE} into ${outputDir}.`);
