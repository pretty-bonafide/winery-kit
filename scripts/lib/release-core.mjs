// Functional core of the release pipeline: no I/O, every function is pure.
// The imperative shells live in scripts/*.mjs.

export const STOREFRONT_KIT = '@pretty-good/storefront-kit';
export const WINERY_UI = '@pretty-good/winery-ui';
export const PACKAGE_DIRS = ['packages/storefront-kit', 'packages/winery-ui'];
export const SUMS_FILE = 'SHA256SUMS';

const IDENTIFIER = '(?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*)';
const NUMERIC = '(?:0|[1-9]\\d*)';
const RELEASE_VERSION = new RegExp(
  `^${NUMERIC}\\.${NUMERIC}\\.${NUMERIC}(?:-${IDENTIFIER}(?:\\.${IDENTIFIER})*)?$`,
);

/**
 * Semver 2.0 without build metadata. `+build` is valid semver but is rejected
 * here: GitHub rewrites `+` in asset names, so the documented install URL
 * would not exist.
 */
export function isReleaseVersion(version) {
  return typeof version === 'string' && RELEASE_VERSION.test(version);
}

export function peerRangeFor(version) {
  return `^${version}`;
}

export function tagFor(version) {
  return `v${version}`;
}

export function isPrereleaseTag(tag) {
  return tag.includes('-');
}

/** `@scope/name` + `1.2.3` -> `scope-name-1.2.3.tgz`, as `pnpm pack` names it. */
export function tarballName(packageName, version) {
  return `${packageName.replace(/^@/, '').replace('/', '-')}-${version}.tgz`;
}

function replaceOnce(text, pattern, value) {
  return text.replace(pattern, (_match, before, after) => `${before}${value}${after}`);
}

function withVersion(manifest, version) {
  const next = structuredClone(manifest);
  next.version = version;
  if (next.peerDependencies?.[STOREFRONT_KIT] !== undefined) {
    next.peerDependencies[STOREFRONT_KIT] = peerRangeFor(version);
  }
  return next;
}

/**
 * Returns the manifest text with the version and the storefront-kit peer range
 * set. Edits the text rather than re-serializing so the file's formatting is
 * kept; the result is compared with the expected manifest so a patch that
 * touched the wrong field (the `file:` devDependency, say) throws.
 */
export function applyVersion(manifestText, version) {
  if (!isReleaseVersion(version)) {
    throw new Error(`Invalid version "${version}": expected X.Y.Z or X.Y.Z-prerelease`);
  }
  const expected = withVersion(JSON.parse(manifestText), version);
  const versioned = replaceOnce(manifestText, /("version"\s*:\s*")[^"]*(")/, version);
  const patched = replaceOnce(
    versioned,
    /("peerDependencies"\s*:\s*\{[^}]*?"@pretty-good\/storefront-kit"\s*:\s*")[^"]*(")/,
    peerRangeFor(version),
  );
  if (JSON.stringify(JSON.parse(patched)) !== JSON.stringify(expected)) {
    throw new Error(`Could not patch manifest for ${expected.name}`);
  }
  return patched;
}

/** Returns one message per problem; an empty array means the release is valid. */
export function validateRelease({ manifests, tag }) {
  const kit = manifests.find((manifest) => manifest.name === STOREFRONT_KIT);
  const ui = manifests.find((manifest) => manifest.name === WINERY_UI);
  if (!kit || !ui) return [`Expected manifests for ${STOREFRONT_KIT} and ${WINERY_UI}`];

  const errors = [];
  if (!isReleaseVersion(kit.version)) {
    errors.push(`${kit.name} has invalid version "${kit.version}"`);
  }
  if (kit.version !== ui.version) {
    errors.push(`Versions differ: ${kit.name} ${kit.version}, ${ui.name} ${ui.version}`);
  }
  const peerRange = ui.peerDependencies?.[STOREFRONT_KIT];
  if (peerRange !== peerRangeFor(kit.version)) {
    errors.push(
      `${ui.name} peer on ${kit.name} is "${peerRange}", expected "${peerRangeFor(kit.version)}"`,
    );
  }
  if (tag !== undefined && tag !== tagFor(kit.version)) {
    errors.push(`Tag "${tag}" does not match version: expected "${tagFor(kit.version)}"`);
  }
  return errors;
}

function exportTargets(exportsField) {
  if (typeof exportsField === 'string') return [exportsField];
  return Object.values(exportsField ?? {}).flatMap(exportTargets);
}

const REQUIRED_ROOT_FILES = ['package.json', 'LICENSE'];
const ALLOWED_ROOT_FILES = new Set([...REQUIRED_ROOT_FILES, 'README.md']);
const TEST_OR_STORY_FILE = /(^|\/)__\w+__\/|\.(test|spec|stories)\.[^/]+$/;

/**
 * Checks a tarball listing against its manifest. Anything outside dist and the
 * root files is rejected, which keeps src, stories and config out by allow-list.
 */
export function validateTarballEntries({ entries, manifest }) {
  const prefix = 'package/';
  const files = entries.filter((entry) => !entry.endsWith('/'));
  const errors = files
    .filter((file) => !file.startsWith(prefix))
    .map((file) => `${manifest.name}: unexpected entry ${file}`);
  const paths = files.filter((file) => file.startsWith(prefix)).map((f) => f.slice(prefix.length));
  const present = new Set(paths);

  for (const required of REQUIRED_ROOT_FILES) {
    if (!present.has(required)) errors.push(`${manifest.name}: missing ${required}`);
  }
  if (!paths.some((path) => path.startsWith('dist/'))) {
    errors.push(`${manifest.name}: missing dist`);
  }
  for (const path of paths) {
    if (!path.startsWith('dist/') && !ALLOWED_ROOT_FILES.has(path)) {
      errors.push(`${manifest.name}: unexpected file ${path}`);
    }
    if (TEST_OR_STORY_FILE.test(path)) {
      errors.push(`${manifest.name}: test or story file ${path}`);
    }
  }
  for (const target of exportTargets(manifest.exports)) {
    const path = target.replace(/^\.\//, '');
    if (!present.has(path)) errors.push(`${manifest.name}: export target ${path} is missing`);
  }
  return errors;
}

const RELATIVE_SPECIFIER = /\b(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]*)['"]/g;
const RESOLVABLE_EXTENSION = /\.(?:js|mjs|cjs|json)$/;

/**
 * Relative import specifiers Node's ESM loader cannot resolve. tsc copies
 * specifiers through unchanged and the bundler moduleResolution accepts
 * `./foo`, so nothing else catches one of these before a consumer does.
 */
export function findUnresolvableSpecifiers(source) {
  return [...source.matchAll(RELATIVE_SPECIFIER)]
    .map((match) => match[1])
    .filter((specifier) => !RESOLVABLE_EXTENSION.test(specifier));
}

/** `sha256sum -c` format, sorted by file name. */
export function formatSha256Sums(digests) {
  return [...digests]
    .sort((a, b) => a.file.localeCompare(b.file))
    .map(({ file, sha256 }) => `${sha256}  ${file}\n`)
    .join('');
}

export function releaseAssetNames(manifests) {
  return [...manifests.map(({ name, version }) => tarballName(name, version)), SUMS_FILE];
}

export function releaseCreateArgs({ tag, assetPaths }) {
  return [
    'release',
    'create',
    tag,
    ...assetPaths,
    '--title',
    tag,
    '--generate-notes',
    '--verify-tag',
    ...(isPrereleaseTag(tag) ? ['--prerelease'] : []),
  ];
}
