import * as esbuild from 'esbuild';

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
  console.log('[esbuild] build complete');
}
