/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';

import { defineConfig } from 'vite';

const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as {
  version: string;
};

export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(version),
    // When this build was made; the status bar shows it so a deployment can be told apart.
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  build: {
    target: 'es2022',
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
