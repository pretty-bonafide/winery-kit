import type { StorybookConfig } from '@storybook/react-vite';

// Stories live outside `src/` so they are not compiled into `dist` by
// `tsc -p tsconfig.build.json` (which builds `src/`).
const config: StorybookConfig = {
  stories: ['../stories/**/*.stories.@(ts|tsx)'],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  addons: [],
};

export default config;
