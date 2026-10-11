// Statik kontroller: tüm JS dosyalarının sözdizimi, README gömülü kopyasının güncelliği,
// index.html'deki ?v= sürümlerinin tutarlılığı.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');
for (const f of fs.readdirSync(path.join(root, 'js'))) if (f.endsWith('.js')) new vm.Script(fs.readFileSync(path.join(root, 'js', f), 'utf8'), { filename: f });
const md = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const emb = fs.readFileSync(path.join(root, 'js', 'readme-data.js'), 'utf8');
assert(emb.includes(JSON.stringify(md)), 'js/readme-data.js güncel değil → node tools/build-readme.js');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const vs = new Set([...html.matchAll(/\?v=([\d.]+)/g)].map(m => m[1]));
assert(vs.size === 1, 'index.html içinde farklı ?v= sürümleri var: ' + [...vs].join(', '));
assert(html.includes(`<span>v${[...vs][0]}</span>`), 'altbilgi sürümü ?v= ile aynı değil');
assert(!/https?:\/\/(cdn|cdnjs|unpkg)/.test(html), 'index.html CDN kullanmamalı (internetsiz çalışma)');
for (const m of html.matchAll(/src="(lib\/[^"?]+)"/g)) assert(fs.existsSync(path.join(root, m[1])), 'eksik kütüphane: ' + m[1]);
console.log('build-check: TAMAM (sürüm ' + [...vs][0] + ')');
