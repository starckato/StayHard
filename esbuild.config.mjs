import * as esbuild from 'esbuild';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const isWatch = process.argv.includes('--watch');
const isServe = process.argv.includes('--serve');

// Format note: IIFE (not ESM) so the bundle runs SYNCHRONOUSLY when its
// <script> tag is reached. This is required during migration because
// inline <script> blocks in index.html depend on globals set by the bundle.
// `<script type="module">` would defer until after parse, executing AFTER
// the inline blocks — too late. After Phase 4 (when inline scripts are
// gone), we can switch back to format: 'esm' for tree-shakable imports.
const ctx = await esbuild.context({
  entryPoints: [
    { in: 'src/main.js', out: 'app' },
    { in: 'src/styles/index.css', out: 'app' }
  ],
  bundle: true,
  outdir: 'dist',
  format: 'iife',
  target: ['es2020', 'safari14', 'chrome90'],
  sourcemap: true,
  minify: !isWatch,
  treeShaking: true,
  // Drop console.* from production builds; keep during watch for debugging.
  drop: isWatch ? [] : ['console'],
  loader: { '.png': 'file', '.svg': 'file' },
  logLevel: 'info'
});

if (isWatch) {
  await ctx.watch();
  console.log('[esbuild] watching for changes...');
}

if (isServe) {
  const server = await ctx.serve({ servedir: '.', port: 5173 });
  console.log(`[esbuild] dev server: http://localhost:${server.port}`);
} else if (!isWatch) {
  await ctx.rebuild();
  await ctx.dispose();

  // ── Auto cache-bust: dist/app.js content hash → index.html ?v= 갱신 ──
  // 5/8 사고 (mobile cache miss) 재발 방지. dist 변경 시 ?v= 자동 업데이트.
  // - SHA256 첫 8자 = 버전 슬러그.
  // - 같은 내용 빌드 시 동일 hash → index.html 변경 X (git diff noise 회피).
  // - dev (watch / serve) 모드에선 동작 X.
  try {
    const bundlePath = resolve('dist/app.js');
    const cssPath = resolve('dist/app.css');
    const indexPath = resolve('index.html');

    // JS + CSS 둘 다 영향 받는 통합 hash (한쪽만 바뀌어도 ?v= 갱신).
    const h = createHash('sha256');
    h.update(readFileSync(bundlePath));
    try { h.update(readFileSync(cssPath)); } catch { /* CSS missing — JS only */ }
    const versionSlug = h.digest('hex').slice(0, 8);

    let html = readFileSync(indexPath, 'utf8');
    const SCRIPT_RE = /<script src="\/dist\/app\.js\?v=[^"]+"><\/script>/;
    const newTag = `<script src="/dist/app.js?v=${versionSlug}"></script>`;

    if (!SCRIPT_RE.test(html)) {
      console.warn('[esbuild] WARN: index.html 의 <script src="/dist/app.js?v=..."> 태그를 찾지 못함. 수동 확인 필요.');
    } else {
      const updated = html.replace(SCRIPT_RE, newTag);
      if (updated !== html) {
        writeFileSync(indexPath, updated);
        console.log(`[esbuild] cache-bust → ?v=${versionSlug} (index.html 갱신)`);
      } else {
        console.log(`[esbuild] cache-bust → ?v=${versionSlug} (변경 없음)`);
      }
    }
  } catch (e) {
    console.warn('[esbuild] cache-bust 실패:', e?.message || e);
  }

  console.log('[esbuild] build complete');
}
