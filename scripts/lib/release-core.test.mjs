import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyVersion,
  findUnresolvableSpecifiers,
  formatSha256Sums,
  isPrereleaseTag,
  isReleaseVersion,
  releaseAssetNames,
  releaseCreateArgs,
  STOREFRONT_KIT,
  tarballName,
  validateRelease,
  validateTarballEntries,
  WINERY_UI,
} from './release-core.mjs';

const kit = (version = '0.2.0') => ({ name: STOREFRONT_KIT, version });
const ui = (version = '0.2.0', peer = `^${version}`) => ({
  name: WINERY_UI,
  version,
  peerDependencies: { [STOREFRONT_KIT]: peer, react: '^19.0.0' },
});

describe('isReleaseVersion', () => {
  for (const version of ['0.2.0', '1.0.0', '10.20.30', '1.0.0-rc.1', '1.0.0-alpha-1', '1.0.0-0']) {
    it(`accepts ${version}`, () => assert.equal(isReleaseVersion(version), true));
  }
  for (const version of [
    '',
    '1',
    '1.2',
    'v1.2.3',
    '01.2.3',
    '1.2.3.4',
    '1.2.3-',
    '1.2.3-01',
    '1.2.3-a..b',
    '1.2.3+build',
    ' 1.2.3',
    '1.2.x',
    undefined,
  ]) {
    it(`rejects ${JSON.stringify(version)}`, () => assert.equal(isReleaseVersion(version), false));
  }
});

describe('applyVersion', () => {
  const uiText = `{
  "name": "@pretty-good/winery-ui",
  "version": "0.1.0",
  "files": ["dist"],
  "peerDependencies": {
    "@pretty-good/storefront-kit": "^0.1.0",
    "react": "^19.0.0"
  },
  "devDependencies": {
    "@pretty-good/storefront-kit": "file:../storefront-kit",
    "react": "^19.2.7"
  }
}
`;

  it('sets the version and peer range and leaves the file: devDependency', () => {
    const manifest = JSON.parse(applyVersion(uiText, '0.2.0'));
    assert.equal(manifest.version, '0.2.0');
    assert.equal(manifest.peerDependencies[STOREFRONT_KIT], '^0.2.0');
    assert.equal(manifest.devDependencies[STOREFRONT_KIT], 'file:../storefront-kit');
  });

  it('keeps the existing formatting', () => {
    const expected = uiText.replace('"0.1.0"', '"0.2.0"').replace('"^0.1.0"', '"^0.2.0"');
    assert.equal(applyVersion(uiText, '0.2.0'), expected);
  });

  it('handles a manifest with no peer on the kit', () => {
    const text = '{\n  "name": "@pretty-good/storefront-kit",\n  "version": "0.1.0"\n}\n';
    assert.equal(JSON.parse(applyVersion(text, '1.0.0-rc.1')).version, '1.0.0-rc.1');
  });

  it('rejects an invalid version', () => {
    assert.throws(() => applyVersion(uiText, 'v0.2.0'), /Invalid version/);
  });

  it('throws when the patch cannot reach the peer range', () => {
    const text = '{"name":"x","peerDependencies":{"a":{},"@pretty-good/storefront-kit":"^0.1.0"}}';
    assert.throws(() => applyVersion(`${text.slice(0, -1)},"version":"0.1.0"}`, '0.2.0'), /patch/);
  });
});

describe('validateRelease', () => {
  it('passes matching manifests', () => {
    assert.deepEqual(validateRelease({ manifests: [kit(), ui()] }), []);
  });

  it('passes a matching tag, including prereleases', () => {
    assert.deepEqual(validateRelease({ manifests: [kit(), ui()], tag: 'v0.2.0' }), []);
    const manifests = [kit('1.0.0-rc.1'), ui('1.0.0-rc.1')];
    assert.deepEqual(validateRelease({ manifests, tag: 'v1.0.0-rc.1' }), []);
  });

  it('reports differing versions', () => {
    const errors = validateRelease({ manifests: [kit('0.2.0'), ui('0.3.0', '^0.2.0')] });
    assert.deepEqual(errors, [`Versions differ: ${STOREFRONT_KIT} 0.2.0, ${WINERY_UI} 0.3.0`]);
  });

  it('reports a peer range that is not exactly ^version', () => {
    for (const peer of ['^0.1.0', '>=0.2.0', '0.2.0']) {
      const [error] = validateRelease({ manifests: [kit(), ui('0.2.0', peer)] });
      assert.match(error, /peer on/);
    }
    const [error] = validateRelease({ manifests: [kit(), { ...ui(), peerDependencies: {} }] });
    assert.match(error, /peer on/);
  });

  it('reports a tag mismatch, an unprefixed tag and an empty tag', () => {
    for (const tag of ['v0.2.1', '0.2.0', '']) {
      const [error] = validateRelease({ manifests: [kit(), ui()], tag });
      assert.match(error, /does not match version/);
    }
  });

  it('reports an invalid version', () => {
    const errors = validateRelease({ manifests: [kit('0.2'), ui('0.2')] });
    assert.match(errors[0], /invalid version/);
  });

  it('reports a missing package', () => {
    assert.equal(validateRelease({ manifests: [kit()] }).length, 1);
  });
});

describe('validateTarballEntries', () => {
  const manifest = {
    name: STOREFRONT_KIT,
    exports: {
      './cart': { types: './dist/cart/index.d.ts', default: './dist/cart/index.js' },
    },
  };
  const good = [
    'package/package.json',
    'package/LICENSE',
    'package/dist/cart/index.js',
    'package/dist/cart/index.d.ts',
  ];

  it('accepts a complete tarball', () => {
    assert.deepEqual(validateTarballEntries({ entries: good, manifest }), []);
  });

  it('reports each missing required file', () => {
    for (const [file, message] of [
      ['package/LICENSE', /missing LICENSE/],
      ['package/package.json', /missing package.json/],
      ['package/dist/cart/index.js', /export target dist\/cart\/index.js/],
    ]) {
      const entries = good.filter((entry) => entry !== file);
      assert.match(validateTarballEntries({ entries, manifest }).join('\n'), message);
    }
  });

  it('reports a tarball with no dist', () => {
    const entries = ['package/package.json', 'package/LICENSE'];
    assert.match(validateTarballEntries({ entries, manifest }).join('\n'), /missing dist/);
  });

  for (const file of [
    'package/src/cart/index.ts',
    'package/stories/Cart.stories.tsx',
    'package/tsconfig.json',
    'package/dist/cart/index.test.js',
    'package/dist/Cart.stories.js',
    'package/dist/__tests__/helper.js',
  ]) {
    it(`rejects ${file}`, () => {
      const errors = validateTarballEntries({ entries: [...good, file], manifest });
      assert.match(errors.join('\n'), new RegExp(file.replace('package/', '')));
    });
  }

  it('rejects entries outside the package directory', () => {
    const errors = validateTarballEntries({ entries: [...good, 'other/file'], manifest });
    assert.match(errors[0], /unexpected entry/);
  });
});

describe('findUnresolvableSpecifiers', () => {
  it('finds extensionless relative imports, exports and dynamic imports', () => {
    const source = `import a from './a';\nexport * from "../b";\nconst c = import('./c');\nimport './d';`;
    assert.deepEqual(findUnresolvableSpecifiers(source), ['./a', '../b', './c', './d']);
  });

  it('ignores resolvable and bare specifiers', () => {
    const source = `import a from './a.js';\nimport b from 'react';\nexport * from '../c/index.js';`;
    assert.deepEqual(findUnresolvableSpecifiers(source), []);
  });
});

describe('asset naming', () => {
  it('matches the pnpm pack tarball name', () => {
    assert.equal(tarballName(STOREFRONT_KIT, '0.2.0'), 'pretty-good-storefront-kit-0.2.0.tgz');
  });

  it('lists tarballs and the checksum file', () => {
    assert.deepEqual(releaseAssetNames([kit(), ui()]), [
      'pretty-good-storefront-kit-0.2.0.tgz',
      'pretty-good-winery-ui-0.2.0.tgz',
      'SHA256SUMS',
    ]);
  });

  it('formats checksums for sha256sum -c, sorted by file', () => {
    const digests = [
      { file: 'b.tgz', sha256: '22' },
      { file: 'a.tgz', sha256: '11' },
    ];
    assert.equal(formatSha256Sums(digests), '11  a.tgz\n22  b.tgz\n');
  });
});

describe('releaseCreateArgs', () => {
  it('builds a stable release', () => {
    assert.deepEqual(releaseCreateArgs({ tag: 'v0.2.0', assetPaths: ['/a.tgz', '/SHA256SUMS'] }), [
      'release',
      'create',
      'v0.2.0',
      '/a.tgz',
      '/SHA256SUMS',
      '--title',
      'v0.2.0',
      '--generate-notes',
      '--verify-tag',
    ]);
  });

  it('marks a hyphenated tag as a prerelease', () => {
    assert.equal(isPrereleaseTag('v1.0.0-rc.1'), true);
    assert.equal(isPrereleaseTag('v1.0.0'), false);
    const args = releaseCreateArgs({ tag: 'v1.0.0-rc.1', assetPaths: [] });
    assert.equal(args.at(-1), '--prerelease');
  });
});
