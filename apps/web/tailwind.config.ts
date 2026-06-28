import type { Config } from 'tailwindcss';
import preset from '@vsp/ui/tailwind.preset';

const config: Config = {
  presets: [preset],
  content: [
    './src/**/*.{ts,tsx}',
    '../../packages/ui/src/**/*.{ts,tsx}',
    '../../packages/player/src/**/*.{ts,tsx}',
  ],
};

export default config;
