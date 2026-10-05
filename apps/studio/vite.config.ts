import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const source = (p: string): string =>
  new URL(`../../packages/${p}/src/index.ts`, import.meta.url).pathname;

/**
 * 把 JS/CSS 全部内联进 index.html，产出「单文件 demo」。
 * 用途：① 给朋友发一个文件就能试玩；② 让 CI/自动化能用 file:// 直接截图验证 UI。
 * 单文件模式下 Web Worker 无法加载，前端会自动回退到主线程仿真（见 src/sim/runner.ts）。
 */
function singleFile(): Plugin {
  return {
    name: 'lc-single-file',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const html = bundle['index.html'];
      if (html?.type !== 'asset') return;
      let source = String(html.source);
      const jsChunks: string[] = [];
      const cssChunks: string[] = [];

      for (const [fileName, item] of Object.entries(bundle)) {
        if (fileName === 'index.html') continue;
        if (item.type === 'chunk') {
          if (item.isEntry) jsChunks.push(item.code);
          delete bundle[fileName];
        } else if (fileName.endsWith('.css')) {
          cssChunks.push(String(item.source));
          delete bundle[fileName];
        }
      }

      // 必须用「函数替换器」：字符串替换器会把 JS 代码里的 $& / $` / $' / $$ 当成替换模式，
      // 把整份 HTML 片段注入到打包代码中间（曾经真的把页面弄成一堆语法错误）。
      source = source.replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, () => '');
      const styleTag = cssChunks.length > 0 ? `<style>${cssChunks.join('\n')}</style>` : '';
      source = source.replace(/<link[^>]*rel="stylesheet"[^>]*>/g, () => styleTag);
      const scriptTag =
        jsChunks.length > 0 ? `<script type="module">${jsChunks.join('\n')}</script>` : '';
      source = source.replace(/<\/body>/, () => `${scriptTag}</body>`);
      html.source = source;
    },
  };
}

export default defineConfig({
  // base：默认 '/'（域名根目录部署）。子路径部署（如 GitHub Pages 项目站 user.github.io/repo/）
  // 必须用 `LC_BASE=/repo/ pnpm build` —— 千万不要用 './'：Worker 的 URL 会变成
  // './worker-xxx.js'（少了 assets/）→ 404 → 仿真静默回退主线程（见 DEPLOY.md）。
  base: process.env.LC_BASE ?? '/',
  plugins: [react(), singleFile()],
  resolve: {
    alias: {
      '@lc/schema': source('schema'),
      '@lc/sim-core': source('sim-core'),
      '@lc/compiler': source('compiler'),
      '@lc/content': source('content'),
    },
  },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    cssCodeSplit: false,
    // 资源（图标/字体）也内联，保证 dist/index.html 自包含
    assetsInlineLimit: 100_000_000,
    rollupOptions: { output: { inlineDynamicImports: false } },
  },
  server: { port: 5273, strictPort: false },
});
