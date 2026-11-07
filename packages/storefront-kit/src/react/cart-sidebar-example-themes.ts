import type { CartSidebarTheme } from './CartSidebar';

/**
 * Reference `CartSidebarTheme` presets for prototyping and Storybook. These are
 * NOT the production site themes (each site owns its own token map) — they are
 * starting points that show the range the component can express: light/dark,
 * serif/mono, image-ful/image-less, sharp/soft corners. Copy one into a new
 * site and retune the hex values.
 *
 * Fonts use generic stacks so they render without any web-font loading.
 */
export const exampleCartSidebarThemes = {
  /** Editorial light: white sheet, near-black ink, burgundy accent, sharp. */
  noir: {
    colors: {
      surface: '#FFFFFF',
      surfaceWarm: '#F5F5F5',
      border: '#E0E0E0',
      textPrimary: '#0A0A0A',
      textSecondary: '#333333',
      textMuted: '#666666',
      textFaint: '#999999',
      accent: '#0A0A0A',
      accentText: '#FFFFFF',
      wishlist: '#722F37',
      wishlistTint: '#722F3733',
      badgeNeutralBg: '#0A0A0A15',
    },
    fonts: { display: 'Georgia, "Times New Roman", serif', body: 'Helvetica, Arial, sans-serif' },
    radius: 0,
    showLineImages: true,
  },

  /** Dark monochrome: charcoal sheet, light ink, muted gold accent, sharp. */
  cellar: {
    colors: {
      surface: '#101014',
      surfaceWarm: '#1B1B20',
      border: '#303036',
      textPrimary: '#FAFAFA',
      textSecondary: '#C9C9CE',
      textMuted: '#9A9AA2',
      textFaint: '#6E6E76',
      accent: '#C9A86A',
      accentText: '#101014',
      wishlist: '#C98A5E',
      wishlistTint: '#C98A5E26',
      badgeNeutralBg: '#FFFFFF14',
    },
    fonts: { display: 'Georgia, serif', body: 'Inter, system-ui, sans-serif' },
    radius: 0,
    showLineImages: true,
  },

  /** Warm bone surface, saddle-brown ink, lilac accent, softly rounded. */
  terracotta: {
    colors: {
      surface: '#FFFFFF',
      surfaceWarm: '#F5F2EE',
      border: '#CECAC6',
      textPrimary: '#583B1F',
      textSecondary: '#3B2A1D',
      textMuted: '#8A765F',
      textFaint: '#A9988233',
      accent: '#3B2A1D',
      accentText: '#FFFFFF',
      wishlist: '#8C2F23',
      wishlistTint: '#8C2F2326',
      badgeNeutralBg: '#583B1F14',
    },
    fonts: { display: '"Marcellus", Georgia, serif', body: '"PT Serif", Georgia, serif' },
    radius: 4,
    showLineImages: true,
  },

  /** Ledger: cream paper, dark ink, ochre accent, monospace, image-less, 2px. */
  ledger: {
    colors: {
      surface: '#F6F1E7',
      surfaceWarm: '#EFE7D6',
      border: '#D8CDB6',
      textPrimary: '#1C1916',
      textSecondary: '#5D544A',
      textMuted: '#7A6F5E',
      textFaint: '#A89A82',
      accent: '#C8862A',
      accentText: '#1C1916',
      wishlist: '#A8552F',
      wishlistTint: '#A8552F26',
      badgeNeutralBg: '#1C191614',
    },
    fonts: {
      display: '"Fraunces", Georgia, serif',
      body: '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
    },
    radius: 2,
    showLineImages: false,
  },
} satisfies Record<string, CartSidebarTheme>;

export type ExampleCartThemeName = keyof typeof exampleCartSidebarThemes;
