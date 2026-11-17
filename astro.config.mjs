import { existsSync, lstatSync } from 'node:fs';
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import react from '@astrojs/react';

// Git worktrees often share one install via a `node_modules` symlink. Vite then
// serves those modules from /@fs/<other checkout> and blocks them unless the
// owning directory is allowed, which breaks React island hydration.
const usesSymlinkedModules =
  existsSync('node_modules') && lstatSync('node_modules').isSymbolicLink();

// https://astro.build/config
export default defineConfig({
  output: 'server',
  adapter: node({
    mode: 'standalone',
  }),
  integrations: [react()],
  vite: {
    build: {
      chunkSizeWarningLimit: 2000,
    },
    server: usesSymlinkedModules
      ? { fs: { allow: ['..', '../..'] } }
      : undefined,
  },
});
