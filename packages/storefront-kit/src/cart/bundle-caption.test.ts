import { describe, expect, it } from 'vitest';
import { bundleIncludesCaption } from './bundle-caption';

describe('bundleIncludesCaption', () => {
  it('lists each wine with its per-bundle count, saying a count only when it is more than one', () => {
    expect(
      bundleIncludesCaption([
        { title: '2024 Roussanne', quantity: 3 },
        { title: '2024 Garnacha', quantity: 1 },
        { title: '2023 Avenger', quantity: 2 },
      ]),
    ).toBe('Includes: 2024 Roussanne × 3 · 2024 Garnacha · 2023 Avenger × 2');
  });
});
