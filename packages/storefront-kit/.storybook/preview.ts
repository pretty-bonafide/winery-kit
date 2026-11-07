import type { Preview } from '@storybook/react-vite';

const preview: Preview = {
  parameters: {
    // The sidebar is a full-height fixed sheet — give it the whole canvas.
    layout: 'fullscreen',
    controls: { expanded: true },
  },
};

export default preview;
