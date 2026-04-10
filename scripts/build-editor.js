import { build, context } from 'esbuild';

const buildOptions = {
  entryPoints: ['public/js/editor/index.js'],
  outfile: 'public/build/editor.js',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2022'],
  sourcemap: false,
  logLevel: 'info'
};

const isWatchMode = process.argv.includes('--watch');

if (isWatchMode) {
  const watchContext = await context(buildOptions);
  await watchContext.watch();
  console.log('Watching editor bundle...');
  await new Promise(() => {});
} else {
  await build(buildOptions);
}
