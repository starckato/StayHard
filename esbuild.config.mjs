import * as esbuild from 'esbuild';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { minify as minifyHtml } from 'html-minifier-terser';

// 디렉토리 하위의 모든 .css 파일 재귀 수집 (해시에 포함시킬 source CSS).
function _collectCssFiles(dir) {
  const out = [];
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e);
    let s;
    try { s = statSync(p); } catch { continue; }
    if (s.isDirectory()) out.push(..._collectCssFiles(p));
    else if (p.endsWith('.css')) out.push(p);
  }
  return out;
}

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

    // dist/app.js + dist/app.css + 모든 source CSS 통합 hash.
    // (components.css 같은 source CSS 가 변경되어도 ?v= 자동 갱신되어 캐시 미스 안 남.)
    const h = createHash('sha256');
    h.update(readFileSync(bundlePath));
    try { h.update(readFileSync(cssPath)); } catch { /* CSS missing — JS only */ }
    // Source CSS 들도 hash 에 포함
    const sourceCss = [
      ..._collectCssFiles(resolve('src/styles')),
      ..._collectCssFiles(resolve('src/features')),
    ];
    for (const p of sourceCss) {
      try { h.update(readFileSync(p)); } catch {}
    }
    const versionSlug = h.digest('hex').slice(0, 8);

    let html = readFileSync(indexPath, 'utf8');
    const SCRIPT_RE = /<script src="\/dist\/app\.js\?v=[^"]+"><\/script>/;
    const newTag = `<script src="/dist/app.js?v=${versionSlug}"></script>`;

    if (!SCRIPT_RE.test(html)) {
      console.warn('[esbuild] WARN: index.html 의 <script src="/dist/app.js?v=..."> 태그를 찾지 못함. 수동 확인 필요.');
    } else {
      let updated = html.replace(SCRIPT_RE, newTag);
      // ── 2026-05-25 확장: 로컬 CSS link 도 cache-bust 동기화.
      // /src/styles/* + /src/features/*/*.css 를 same hash 로 ?v= 갱신.
      // (이전엔 dist/app.js 만 갱신 — components.css 등은 영구 캐시 문제 생김.)
      const CSS_RE = /(<link[^>]+href="\/(?:src\/styles|src\/features)\/[^"?]+\.css)(\?v=[^"]+)?(")/g;
      const beforeCss = updated;
      updated = updated.replace(CSS_RE, `$1?v=${versionSlug}$3`);
      const cssCount = (beforeCss.match(CSS_RE) || []).length;
      if (updated !== html) {
        writeFileSync(indexPath, updated);
        console.log(`[esbuild] cache-bust → ?v=${versionSlug} (index.html 갱신: JS 1 + CSS ${cssCount})`);
      } else {
        console.log(`[esbuild] cache-bust → ?v=${versionSlug} (변경 없음)`);
      }

      // ── HTML minify (vercel 빌드에서만) ──
      // 957KB → ~600KB 예상. Brotli 후 transfer 비슷하지만 모바일 CPU parse 시간 단축.
      // VERCEL=1 env 가 vercel build 시 자동 set. 로컬 npm run build 는 minify X (diff noise 회피).
      if (process.env.VERCEL === '1' || process.env.MINIFY_HTML === '1') {
        try {
          const beforeSize = updated.length;
          const minified = await minifyHtml(updated, {
            collapseWhitespace: true,
            removeComments: true,
            removeRedundantAttributes: true,
            collapseBooleanAttributes: true,
            // Inline JS/CSS 도 minify — 14000줄 inline JS 의 공백/주석/식별자 단축.
            // terser 가 syntax 보존하므로 안전.
            minifyJS: {
              compress: { drop_console: true, drop_debugger: true, passes: 2 },
              // mangle: top-level 안 건드림이 default → onclick="globalFn()" 안전.
              // 로컬 변수만 단축.
              mangle: { toplevel: false, reserved: ['CU', 'CP', 'sb', 'log', 'logCache'] },
              format: { comments: false }
            },
            minifyCSS: true,
            // <pre>, <textarea> 안 공백 보존
            conservativeCollapse: false,
            // 따옴표 제거 (?v=hash 등 보존)
            removeAttributeQuotes: false,
          });
          writeFileSync(indexPath, minified);
          console.log(`[esbuild] HTML minify: ${beforeSize} → ${minified.length} bytes (${Math.round((1 - minified.length/beforeSize) * 100)}% 감소)`);
        } catch (e) {
          console.warn('[esbuild] HTML minify 실패 — 원본 유지:', e?.message || e);
        }
      }
    }
  } catch (e) {
    console.warn('[esbuild] cache-bust 실패:', e?.message || e);
  }

  console.log('[esbuild] build complete');
}
