import * as esbuild from 'esbuild';

const isWatch = process.argv.includes('--watch');
const isServe = process.argv.includes('--serve');

const ctx = await esbuild.context({
  entryPoints: [
    { in: 'src/main.js', out: 'app' },
    { in: 'src/styles/index.css', out: 'app' }
  ],
  bundle: true,
  outdir: 'dist',
  format: 'esm',
  target: ['es2020', 'safari14', 'chrome90'],
  sourcemap: true,
  minify: !isWatch,
  treeShaking: true,
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
