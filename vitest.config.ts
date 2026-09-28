import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const pkg = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@lc/schema': pkg('schema'),
      '@lc/sim-core': pkg('sim-core'),
      '@lc/compiler': pkg('compiler'),
      '@lc/content': pkg('content'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    // 需要 DOM 的用例在文件顶部写 // @vitest-environment jsdom
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.{ts,tsx}'],
  },
});
