import { build, context } from 'esbuild';

const buildOptions = {
  entryPoints: {
    editor: 'public/js/editor/index.js',
    'note-room': 'public/js/note-room.js'
  },
  outdir: 'public/build',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2022'],
  sourcemap: false,
  logLevel: 'info',
  entryNames: '[name]'
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
