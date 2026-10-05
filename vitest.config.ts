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
    // 时序分析用例（elementEdgeOf 快照、calc/reg-8 探测）很重，默认全核并行会让
    // worker 忙到 RPC 超时（vitest "Timeout calling onTaskUpdate" 假错误）→ 限并发保稳定。
    // 2026-01：给出 s3-bin2bcd / s3-calc 标定延迟预算之后，计算器的传播延迟实测（13 端口 ×
    // 2 方向的全电路收敛，约 23s 同步阻塞）让单次阻塞更长了 —— maxWorkers: 2 时两个重文件
    // 撞上就复现假超时（复现过：第一次红、第二次绿）。降到 1 彻底避免争抢，代价是墙钟变长。
    maxWorkers: 1,
  },
});
