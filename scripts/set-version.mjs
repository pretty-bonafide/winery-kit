#!/usr/bin/env node
// Sets the lockstep version and the winery-ui peer range: set-version.mjs <X.Y.Z>
import { readFileSync, writeFileSync } from 'node:fs';
import { applyVersion } from './lib/release-core.mjs';
import { exitWithErrors, manifestPath, packageDirs } from './lib/workspace.mjs';

const [version] = process.argv.slice(2);

try {
  // Patch everything before writing anything, so a failure leaves no partial bump.
  const patches = packageDirs.map((dir) => {
    const path = manifestPath(dir);
    return { path, text: applyVersion(readFileSync(path, 'utf8'), version) };
  });
  for (const { path, text } of patches) writeFileSync(path, text);
  console.log(`Set both packages to ${version}.`);
} catch (error) {
  exitWithErrors([error.message]);
}
