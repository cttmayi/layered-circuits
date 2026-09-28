import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const pkg = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));
const tool = (name: string) =>
  fileURLToPath(new URL(`./tools/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@lc/schema': pkg('schema'),
      '@lc/sim-core': pkg('sim-core'),
      '@lc/compiler': pkg('compiler'),
      '@lc/content': pkg('content'),
      '@lc/opt-solver': tool('opt-solver'),
      '@lc/level-editor': tool('level-editor'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    // 需要 DOM 的用例在文件顶部写 // @vitest-environment jsdom
    include: [
      'packages/*/test/**/*.test.ts',
      'tools/*/test/**/*.test.ts',
      'apps/*/test/**/*.test.{ts,tsx}',
    ],
  },
});
