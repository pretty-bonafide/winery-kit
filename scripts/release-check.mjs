#!/usr/bin/env node
// Validates lockstep versions, the peer range and optionally a tag: release-check.mjs [vX.Y.Z]
import { validateRelease } from './lib/release-core.mjs';
import { exitWithErrors, readManifests } from './lib/workspace.mjs';

const [tag] = process.argv.slice(2);
const manifests = readManifests();
const errors = validateRelease({ manifests, tag });

if (errors.length > 0) exitWithErrors(errors);
console.log(`Release check passed for ${manifests[0].version}${tag ? ` (tag ${tag})` : ''}.`);
