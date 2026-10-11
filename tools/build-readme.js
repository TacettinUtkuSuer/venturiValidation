// README.md → js/readme-data.js (uygulama içi yardım penceresi için gömülü kopya).
// README her değiştiğinde çalıştırılır:  node tools/build-readme.js
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const md = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const out = '/* Otomatik üretildi: node tools/build-readme.js — elle düzenlemeyin */\nwindow.VF_README = ' + JSON.stringify(md) + ';\n';
fs.writeFileSync(path.join(root, 'js', 'readme-data.js'), out);
console.log('js/readme-data.js güncellendi (' + md.length + ' karakter)');
