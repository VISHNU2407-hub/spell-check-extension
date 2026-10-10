import { build, context } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const dist = join(root, 'dist');
const isWatch = process.argv.includes('--watch');

const entries = [
  { in: 'src/background/background.ts', out: 'background/background' },
  { in: 'src/content/content.ts', out: 'content/content' },
  { in: 'src/popup/popup.ts', out: 'popup/popup' },
  { in: 'src/options/options.ts', out: 'options/options' },
];

async function bundle() {
  if (!isWatch && existsSync(dist)) rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });

  const opts = {
    bundle: true,
    minify: true,
    sourcemap: false,
    target: 'chrome110',
    format: 'iife',
    logLevel: 'info',
  };

  if (isWatch) {
    const ctxs = [];
    for (const e of entries) {
      const ctx = await context({
        ...opts,
        entryPoints: [join(root, e.in)],
        outfile: join(dist, e.out + '.js'),
      });
      await ctx.watch();
      ctxs.push(ctx);
    }
    console.log('Watching...');
  } else {
    for (const e of entries) {
      await build({
        ...opts,
        entryPoints: [join(root, e.in)],
        outfile: join(dist, e.out + '.js'),
      });
    }
  }

  // ESM test bundles (pure logic, importable by node --test)
  const testEntries = [
    { in: 'src/correction/local-spellcheck.ts', out: 'test/local-spellcheck.mjs' },
    { in: 'src/correction/ai-correction.ts', out: 'test/ai-correction.mjs' },
    { in: 'src/utils/helpers.ts', out: 'test/helpers.mjs' },
    { in: 'src/content/button-policy.ts', out: 'test/button-policy.mjs' },
  ];
  for (const e of testEntries) {
    await build({
      bundle: true,
      minify: false,
      sourcemap: false,
      target: 'node20',
      format: 'esm',
      logLevel: 'warning',
      entryPoints: [join(root, e.in)],
      outfile: join(dist, e.out),
    });
  }
  mkdirSync(join(dist, 'icons'), { recursive: true });
  cpSync(join(root, 'public', 'manifest.json'), join(dist, 'manifest.json'));
  if (existsSync(join(root, 'public', 'icons'))) {
    cpSync(join(root, 'public', 'icons'), join(dist, 'icons'), { recursive: true });
  }
  cpSync(join(root, 'src', 'popup', 'popup.html'), join(dist, 'popup', 'popup.html'));
  cpSync(join(root, 'src', 'popup', 'popup.css'), join(dist, 'popup', 'popup.css'));
  cpSync(join(root, 'src', 'options', 'options.html'), join(dist, 'options', 'options.html'));
  cpSync(join(root, 'src', 'options', 'options.css'), join(dist, 'options', 'options.css'));

  // Validate manifest exists
  const manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'));
  console.log(`Built AutoCorrect AI v${manifest.version} -> dist/`);
}

bundle().catch((err) => {
  console.error(err);
  process.exit(1);
});
