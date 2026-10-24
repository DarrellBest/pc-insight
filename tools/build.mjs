import { build } from 'esbuild';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
await Promise.all([
  build({ entryPoints: ['electron/main.mjs'], outfile: 'dist/main.cjs', bundle: true, minify: true, platform: 'node', target: 'node22', format: 'cjs', external: ['electron'] }),
  build({ entryPoints: ['electron/preload.cjs'], outfile: 'dist/preload.cjs', bundle: true, minify: true, platform: 'node', format: 'cjs', external: ['electron'] }),
  build({ entryPoints: ['electron/bench-worker.mjs'], outfile: 'dist/bench-worker.cjs', bundle: true, minify: true, platform: 'node', format: 'cjs' }),
  build({ entryPoints: ['ui/app.js'], outfile: 'dist/app.js', bundle: true, minify: true, platform: 'browser', target: 'chrome130', legalComments: 'eof' }),
  build({ entryPoints: ['ui/style.css'], outfile: 'dist/style.css', minify: true }),
  readFile('ui/index.html','utf8').then(html=>writeFile('dist/index.html',html.replace(/>\s+</g,'><').trim())),
  copyFile('build-resources/icon.png','dist/icon.png')
]);
console.log('Minified production bundles ready in dist/.');
