#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const wineryKitRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = resolve(wineryKitRoot, '..');

const KIT_PACKAGE = '@pretty-good/storefront-kit';

const failures = [];

function workspacePath(...parts) {
  return join(workspaceRoot, ...parts);
}

function fail(message) {
  failures.push(message);
}

function readText(path) {
  return readFileSync(path, 'utf8');
}

function walk(dir, shouldSkip = () => false) {
  if (!existsSync(dir)) return [];
  const entries = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (shouldSkip(path, name)) continue;
    const stat = statSync(path);
    if (stat.isDirectory()) {
      entries.push(...walk(path, shouldSkip));
    } else {
      entries.push(path);
    }
  }
  return entries;
}

function rel(path) {
  return relative(workspaceRoot, path);
}

function dependsOnKit(manifest) {
  return ['dependencies', 'devDependencies', 'peerDependencies'].some(
    (field) => manifest[field]?.[KIT_PACKAGE] !== undefined,
  );
}

function isLinkedGitWorktree(dir) {
  return statSync(join(dir, '.git'), { throwIfNoEntry: false })?.isFile() === true;
}

function discoverSiteDirs() {
  const sites = [];
  for (const name of readdirSync(workspaceRoot).sort()) {
    const dir = workspacePath(name);
    const manifestPath = join(dir, 'package.json');
    if (dir === wineryKitRoot || !existsSync(manifestPath) || isLinkedGitWorktree(dir)) continue;
    try {
      if (dependsOnKit(JSON.parse(readText(manifestPath)))) sites.push(name);
    } catch {
      fail(`${rel(manifestPath)} is not valid JSON`);
    }
  }
  return sites;
}

const siteDirs = discoverSiteDirs();

for (const required of [
  'RULES.md',
  'PLAYBOOK.md',
  'docs/winery-store-requirements.md',
  'docs/documentation-strategy.md',
]) {
  if (!existsSync(join(wineryKitRoot, required))) {
    fail(`Missing canonical doc: ${required}`);
  }
}

for (const site of siteDirs) {
  const docsDir = workspacePath(site, 'docs');
  if (!existsSync(docsDir)) continue;

  const readme = join(docsDir, 'README.md');
  if (!existsSync(readme)) {
    fail(`${site}/docs is missing README.md`);
    continue;
  }

  const text = readText(readme);
  for (const field of ['Status:', 'Owner:', 'Last verified:']) {
    if (!text.includes(field)) {
      fail(`${site}/docs/README.md is missing lifecycle field: ${field}`);
    }
  }
}

for (const site of siteDirs) {
  const dir = workspacePath(site);
  if (!existsSync(dir)) continue;

  for (const file of walk(dir, (path, name) => {
    return (
      name === '.git' ||
      name === 'node_modules' ||
      name === 'dist' ||
      name === 'storybook-static' ||
      name === '.astro'
    );
  })) {
    const pathFromSite = relative(dir, file);
    if (!/\.(astro|md|mdx|ts|tsx|js|mjs|json|jsonc|yml|yaml)$/.test(file)) continue;
    if (!/^(src|docs|README\.md|package\.json|\.github)/.test(pathFromSite)) continue;

    const text = readText(file);
    if (text.includes('pg_memberships_cache_v1')) {
      fail(`${rel(file)} references removed membership cache key pg_memberships_cache_v1`);
    }

    if (/src\/components\/pdp\/.*PurchasePanelStoryHarness\.tsx$/.test(pathFromSite)) {
      for (const stalePattern of [
        "resource === 'pricing'",
        'resource === "pricing"',
        "resource === 'availability'",
        'resource === "availability"',
        "resource === 'memberships'",
        'resource === "memberships"',
      ]) {
        if (text.includes(stalePattern)) {
          fail(`${rel(file)} still mocks split customer-context endpoint: ${stalePattern}`);
        }
      }
      if (!text.includes("resource === 'purchase-context'") && !text.includes('resource === "purchase-context"')) {
        fail(`${rel(file)} does not mock POST /purchase-context`);
      }
    }
  }
}

for (const site of siteDirs) {
  const docsDir = workspacePath(site, 'docs');
  if (!existsSync(docsDir)) continue;

  for (const file of walk(docsDir)) {
    if (file.endsWith('.DS_Store')) {
      fail(`Remove generated Finder file from docs: ${rel(file)}`);
    }
  }
}

if (failures.length > 0) {
  console.error('Documentation checks failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('Documentation checks passed.');
