import esbuild from 'esbuild';
import process from 'process';
import { builtinModules } from 'node:module';
import { join } from 'node:path';

const prod = process.argv[2] === 'production';

// A dev build lands in the dev vault inside this repo; the release build
// stays at the root.
const pluginDir = join('dev-vault', '.obsidian', 'plugins', 'video-notes');

const context = await esbuild.context({
  banner: { js: '/* bundled by esbuild; source: see repository */\n' },
  entryPoints: ['src/main.ts'],
  bundle: true,
  external: [
    'obsidian',
    'electron',
    '@codemirror/autocomplete',
    '@codemirror/collab',
    '@codemirror/commands',
    '@codemirror/language',
    '@codemirror/lint',
    '@codemirror/search',
    '@codemirror/state',
    '@codemirror/view',
    '@lezer/common',
    '@lezer/highlight',
    '@lezer/lr',
    ...builtinModules,
  ],
  format: 'cjs',
  target: 'es2021',
  logLevel: 'info',
  sourcemap: prod ? false : 'inline',
  treeShaking: true,
  outfile: prod ? 'main.js' : join(pluginDir, 'main.js'),
  minify: prod,
});

if (prod) {
  await context.rebuild();
  process.exit(0);
}

const assets = await esbuild.context({
  entryPoints: ['styles.css', 'manifest.json'],
  outdir: pluginDir,
  loader: { '.css': 'copy', '.json': 'copy' },
  logLevel: 'info',
});

await context.watch();
await assets.watch();
