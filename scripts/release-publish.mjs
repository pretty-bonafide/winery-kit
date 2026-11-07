#!/usr/bin/env node
// Creates the GitHub Release for a tag from packed assets: release-publish.mjs <vX.Y.Z> [output-dir]
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { releaseAssetNames, releaseCreateArgs, validateRelease } from './lib/release-core.mjs';
import { defaultOutputDir, exitWithErrors, readManifests } from './lib/workspace.mjs';

const [tag, outputDirArg] = process.argv.slice(2);
if (!tag) exitWithErrors(['Usage: release-publish.mjs <vX.Y.Z> [output-dir]']);

const outputDir = resolve(outputDirArg ?? defaultOutputDir);
const manifests = readManifests();

const errors = validateRelease({ manifests, tag });
if (errors.length > 0) exitWithErrors(errors);

const assetPaths = releaseAssetNames(manifests).map((name) => join(outputDir, name));
const missing = assetPaths.filter((path) => !existsSync(path));
if (missing.length > 0) exitWithErrors(missing.map((path) => `Missing release asset ${path}`));

if (spawnSync('gh', ['release', 'view', tag], { stdio: 'ignore' }).status === 0) {
  exitWithErrors([`Release ${tag} already exists`]);
}

execFileSync('gh', releaseCreateArgs({ tag, assetPaths }), { stdio: 'inherit' });
