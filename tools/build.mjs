#!/usr/bin/env node
// build.mjs — pack the game into ONE self-contained HTML file (CORE).
//   node tools/build.mjs            (from qiloumao/, or `npm run build`)
// Bundles src/main.js with esbuild into a single IIFE with three.js inside, inlines it into a copy of dev.html (the import
// map and the module script tag are dropped), writes dist/index.html and a copy at release/qiloumao.html, then prints
// the size and checks that the file asks the network for nothing: no http(s) asset references, no <img, no data:image,
// no fetch( of the game's own.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rel = p => path.relative(ROOT, p);
const missing = [];

const result = await build({
  entryPoints: [path.join(ROOT, 'src/main.js')],
  bundle: true, format: 'iife', platform: 'browser', target: ['es2020'], minify: true, legalComments: 'eof', charset: 'utf8', write: false, logLevel: 'warning',
  alias: { three: path.join(ROOT, 'vendor/three.module.min.js') },
  plugins: [{
    // the shell imports every module with import('./name.js') and falls back to a stub when a file is missing;
    // keep that behaviour in the bundle instead of failing the build
    name: 'missing-module-falls-back-to-stub',
    setup(b) {
      b.onResolve({ filter: /^\.\/[\w-]+\.js$/ }, a => (a.kind === 'dynamic-import' && !fs.existsSync(path.join(a.resolveDir, a.path)) ? (missing.push(a.path), { path: a.path, namespace: 'missing' }) : null));
      b.onLoad({ filter: /.*/, namespace: 'missing' }, a => ({ contents: `throw new Error('Cannot find module ${a.path}');`, loader: 'js' }));
    },
  }],
});
let js = new TextDecoder().decode(result.outputFiles[0].contents);
js = js.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');

let html = fs.readFileSync(path.join(ROOT, 'dev.html'), 'utf8');
const before = html.length;
html = html.replace(/[ \t]*<script type="importmap">[\s\S]*?<\/script>\s*\n?/, '').replace(/[ \t]*<script type="module"[^>]*><\/script>\s*\n?/, '');
if (html.length === before || /type="module"|importmap/.test(html)) throw new Error('build: dev.html no longer has the import map and module script tags this tool expects');
html = html.replace('</body>', () => `<script>\n${js}\n</script>\n</body>`);

for (const out of ['dist/index.html', 'release/qiloumao.html']) { fs.mkdirSync(path.dirname(path.join(ROOT, out)), { recursive: true }); fs.writeFileSync(path.join(ROOT, out), html); }

// ---------------------------------------------------------------- report
const bytes = Buffer.byteLength(html), kb = n => (n / 1024).toFixed(0) + ' KB';
const own = fs.readdirSync(path.join(ROOT, 'src')).filter(f => f.endsWith('.js')).map(f => ({ f, s: fs.readFileSync(path.join(ROOT, 'src', f), 'utf8') }));
const count = (s, re) => (s.match(re) || []).length;
const three = fs.readFileSync(path.join(ROOT, 'vendor/three.module.min.js'), 'utf8') + fs.readFileSync(path.join(ROOT, 'vendor/three.core.min.js'), 'utf8');
console.log(`dist/index.html      ${bytes} bytes (${kb(bytes)}), copy at release/qiloumao.html`);
console.log(`  three.js inside    about ${kb(Buffer.byteLength(three))} before minifying again; the game's own source is ${kb(own.reduce((a, o) => a + Buffer.byteLength(o.s), 0))} in ${own.length} files`);
if (missing.length) console.log(`  modules not written yet (their stubs are used): ${missing.join(', ')}`);

let bad = 0;
const check = (label, ok, detail) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`); if (!ok) bad++; };
// 1. links: every http(s) string in the file, and whether it could ever be requested
const urls = [...new Set(html.match(/https?:\/\/[^\s"'`\\)<>]+/g) || [])];
const ownUrls = [...new Set(own.flatMap(o => o.s.match(/https?:\/\/[^\s"'`\\)<>]+/g) || []))];
const harmless = u => /^http:\/\/www\.w3\.org\//.test(u) || three.includes(u);   // XML namespaces, and links inside three.js warning texts
const loaders = urls.filter(u => !harmless(u));
check('no http(s) asset references', loaders.length === 0 && ownUrls.length === 0,
  `${urls.length} link strings in the file: ${urls.filter(u => /w3\.org/.test(u)).length} XML namespace names, ${urls.filter(u => !/w3\.org/.test(u) && harmless(u)).length} inside three.js messages, ${ownUrls.length} in the game's own source${loaders.length ? ' -> ' + loaders.slice(0, 5).join(' ') : ''}`);
check('no <img', count(html, /<img/gi) === 0, `${count(html, /<img/gi)} found`);
const dataOwn = own.reduce((a, o) => a + count(o.s, /data:(image|audio|video|font|model)/gi), 0), dataAll = count(html, /data:image/gi);
check('no data:image', dataOwn === 0 && dataAll - count(three, /data:image/gi) <= 0, `${dataAll} in the file (${count(three, /data:image/gi)} of them a pattern test inside three.js), ${dataOwn} media data: URIs in the game's own source`);
const fetchOwn = own.map(o => [o.f, count(o.s, /\bfetch\s*\(|XMLHttpRequest|new\s+Image\s*\(|new\s+Audio\s*\(|importScripts|new\s+Worker\s*\(|sendBeacon|WebSocket|EventSource/g)]).filter(x => x[1]);
check('no fetch( of its own', fetchOwn.length === 0, `the game's own source: ${fetchOwn.length ? fetchOwn.map(x => x.join(' x')).join(', ') : 'none'}; three.js carries ${count(three, /\bfetch\s*\(/g)} inside its file loaders, which nothing here calls`);
check('one file, no module tags', !/<script[^>]+src=|<link[^>]+href=|type="module"|importmap/i.test(html.replace(js, '')), '');
if (bad) { console.log(`build: ${bad} check(s) failed`); process.exitCode = 1; } else console.log('build: all checks passed');
