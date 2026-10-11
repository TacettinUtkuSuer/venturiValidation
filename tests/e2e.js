// Uçtan uca tarayıcı testleri (Playwright + Chromium). Sahte InfluxDB ve sahte GitHub API kullanılır.
// Çalıştırma: tests/run-all.sh   (veya: BASE=http://localhost:8123 node tests/e2e.js)
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8123';
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const TOKEN = 'github_pat_TEST123';

/* ---------- Sahte InfluxDB: 10 dk'lık debi basamakları + 2 dk geçiş ---------- */
function influx(route) {
  const u = new URL(route.request().url());
  const H = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (u.pathname === '/ping') return route.fulfill({ status: 204, headers: H });
  const steps = [20, 35, 50, 65, 80, 95, 110];
  const qAt = t => { const k = Math.floor(t / 720000), ph = (t % 720000) / 1000, a = steps[k % 7], b = steps[(k + 1) % 7]; return (ph < 600 ? a : a + (b - a) * (ph - 600) / 120) * (1 + Math.sin(t / 7000) * 0.002); };
  let seed = 3; const rnd = () => (seed = seed * 16807 % 2147483647) / 2147483647;
  const results = u.searchParams.get('q').split(';').map((q, i) => {
    const f = (q.match(/(?:mean|last)\("([^"]+)"\)/) || [])[1];
    const val = t => { const m3 = qAt(t); return f === 'Q1' ? m3 * 998.2 * (1 + (rnd() - 0.5) * 0.002) : f === 'DP1' ? (m3 / 5) ** 2 * (1 + (rnd() - 0.5) * 0.004) : f === 'T1' ? 20 + rnd() * 0.1 : null; };
    const m = q.match(/time >= (\d+)ms AND time <= (\d+)ms.*GROUP BY time\((\d+)s\)/);
    if (m) { const vals = []; for (let t = Math.ceil(+m[1] / (+m[3] * 1000)) * +m[3] * 1000; t <= +m[2]; t += +m[3] * 1000) { const v = val(t); if (v !== null) vals.push([t, v]); } return { statement_id: i, series: [{ columns: ['time', 'mean'], values: vals }] }; }
    const t = Date.now(), v = val(t);
    return { statement_id: i, series: v === null ? undefined : [{ columns: ['time', 'last'], values: [[t, v]] }] };
  });
  return route.fulfill({ status: 200, headers: H, body: JSON.stringify({ results }) });
}

/* ---------- Sahte GitHub Contents API ---------- */
const gh = { file: null, sha: null, n: 0, conflicts: 0 };
function github(route) {
  const req = route.request(), url = new URL(req.url()), m = req.method();
  const auth = req.headers()['authorization'];
  const H = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,PUT', 'Content-Type': 'application/json' };
  if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: H });
  if (!gh.enabled) return route.fulfill({ status: 404, headers: H, body: '{}' });
  if (auth && auth !== 'Bearer ' + TOKEN) return route.fulfill({ status: 401, headers: H, body: '{}' });
  if (/\/repos\/[^/]+\/[^/]+$/.test(url.pathname)) return route.fulfill({ status: 200, headers: H, body: '{"private":false}' });
  if (m === 'GET') return gh.file ? route.fulfill({ status: 200, headers: H, body: JSON.stringify({ sha: gh.sha, size: 1, content: Buffer.from(gh.file).toString('base64') }) }) : route.fulfill({ status: 404, headers: H, body: '{}' });
  const b = JSON.parse(req.postData());
  if (gh.file && b.sha !== gh.sha) { gh.conflicts++; return route.fulfill({ status: 409, headers: H, body: '{}' }); }
  gh.file = Buffer.from(b.content, 'base64').toString('utf8'); gh.sha = 'sha' + (++gh.n);
  return route.fulfill({ status: 200, headers: H, body: JSON.stringify({ content: { sha: gh.sha } }) });
}

const errs = [];
let cfgJs = null;
async function context(browser, opts) {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, acceptDownloads: true, ...(opts || {}) });
  await ctx.route(/api\.github\.com/, github);
  await ctx.route(/10\.10\.2\.6:8086/, influx);
  if (cfgJs) await ctx.route(/js\/sync-config\.js/, r => r.fulfill({ body: cfgJs, contentType: 'text/javascript' }));
  ctx.on('request', r => { const u = r.url(); if (!/^(http:\/\/localhost|data:|blob:|https:\/\/api\.github\.com|http:\/\/10\.10\.2\.6)/.test(u)) errs.push('dış istek: ' + u); });
  return ctx;
}
async function page(ctx, name) {
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push(`${name}: ${e.message}`));
  p.on('console', m => { if (m.type() === 'error' && !/40[49]/.test(m.text())) errs.push(`${name}: ${m.text()}`); });
  p.on('dialog', d => d.accept());
  await p.goto(BASE + '/index.html');
  await p.waitForTimeout(1800);
  return p;
}
const closeModals = async p => { while (await p.$('.modal-bg')) { await p.keyboard.press('Escape'); await p.waitForTimeout(150); } };
const ok = (c, m) => { assert(c, m); console.log('  ✓ ' + m); };

async function appFlow(browser) {
  console.log('Uygulama akışı');
  const ctx = await context(browser);
  // v1.3 formatında eski kayıt → geçiş
  await ctx.addInitScript(() => { if (!sessionStorage.getItem('s')) { sessionStorage.setItem('s', '1'); localStorage.setItem('venturiflow.state.v1', JSON.stringify({ inputs: { D: { v: 54.5, u: 'mm' }, d: { v: 40.81, u: 'mm' } }, influx: { db: 'db', measurement: 'venturi', rate: 5, dp: { enabled: true, field: 'DP1', unit: 'mbar' } } })); } });
  const p = await page(ctx, 'app');
  await closeModals(p);
  const s0 = await p.evaluate(() => VF.state);
  ok(s0.venturis.length === 1 && s0.inputs.D.v === 54.5 && s0.influx.db === 'lc_100' && s0.influx.rateMs === 5000, 'eski kayıt "Venturi 1"e taşındı (db, ms, geometri)');
  ok(await p.evaluate(() => document.querySelectorAll('#formulas mjx-container').length) > 5, 'formül paneli MathJax ile çizildi (yerel kütüphane)');
  // canlı demo + trend + sıfırlama
  await p.click('#tabs button[data-tab=live]');
  await p.check('[data-s=q] [data-f=enabled]');
  await p.fill('#ixRateMs', '250');
  await p.click('#btnDemo'); await p.waitForTimeout(2500);
  ok(/\d/.test(await p.textContent('[data-sv=dp]')), 'canlı demo sensör değeri üretiyor');
  await p.click('#chartTabs button[data-ct=trend]'); await p.waitForTimeout(800);
  ok(/okuma/.test(await p.textContent('#trendInfo')), 'zaman trendi veri gösteriyor');
  await p.click('[data-zero=dp]'); await p.waitForTimeout(400);
  ok(await p.evaluate(() => VF.state.sensors.list.dp.b) < 0, 'ΔP sıfırlama ofseti (b) hesapladı');
  await p.click('#btnDemo'); await p.click('#chartTabs button[data-ct=curve]');
  // çoklu venturi: birimler ve sensörler venturiye özel
  await p.click('#tabs button[data-tab=units]');
  await p.selectOption('[data-disp=flow]', 'kg/h');
  await p.click('#btnVCopy'); await p.waitForTimeout(300);
  await p.selectOption('[data-disp=flow]', 'LPM'); await p.waitForTimeout(400);
  const v = await p.evaluate(() => VF.state.venturis.map(x => x.data.units.flow));
  ok(v[0] === 'kg/h' && v[1] === 'LPM', 'birimler venturiye özel saklanıyor');
  await p.selectOption('#selVenturi', await p.evaluate(() => VF.state.venturis[0].id)); await p.waitForTimeout(300);
  ok(await p.evaluate(() => VF.state.units.flow) === 'kg/h', 'venturi geçişinde kendi birimi geri geliyor');
  // yardım
  await p.click('#btnHelp'); await p.waitForTimeout(1200);
  ok(await p.evaluate(() => document.querySelectorAll('.help-list a').length) > 20, 'yardım penceresi README içindekilerini gösteriyor');
  await closeModals(p);
  // kalibrasyon: örnek veri + kod + PDF
  await p.click('#viewSeg button[data-view=calib]');
  await p.click('#calSample'); await p.waitForTimeout(600);
  ok(/Önerilen model/.test(await p.textContent('#calRec')), 'kalibrasyon modeli önerildi');
  ok((await p.textContent('#codeDecl')).includes('FUNCTION_BLOCK'), 'TwinCAT kodu üretildi');
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 40000 }), p.click('#btnPdf')]);
  await dl.saveAs(path.join(OUT, 'rapor.pdf'));
  ok(fs.statSync(path.join(OUT, 'rapor.pdf')).size > 50000, 'PDF raporu indirildi');
  // gaz kalibrasyonu: yeni venturi + doğal gaz
  await p.click('#btnVNew'); await p.waitForTimeout(300);
  await p.click('#viewSeg button[data-view=main]');
  await p.click('#tabs button[data-tab=fluid]');
  await p.selectOption('#selFluid', 'ng'); await p.waitForTimeout(300);
  await p.click('#viewSeg button[data-view=calib]');
  await p.click('#calSample'); await p.waitForTimeout(600);
  ok(await p.evaluate(() => [...document.querySelectorAll('#calTable th')].some(th => /P1 mutlak/.test(th.textContent))), 'gazda kalibrasyon tablosunda P1 (mutlak) sütunu var');
  ok(/fP1\s*:/.test(await p.textContent('#codeDecl')) && /fEps :=/.test(await p.textContent('#codeImpl')), 'gaz için PLC kodu P1 girişi ve ε hesabı içeriyor');
  await p.selectOption('#selVenturi', await p.evaluate(() => VF.state.venturis[0].id)); await p.waitForTimeout(300);
  // tam yedek
  const [dl2] = await Promise.all([p.waitForEvent('download'), p.click('#btnExport')]);
  await dl2.saveAs(path.join(OUT, 'yedek.json'));
  const full = JSON.parse(fs.readFileSync(path.join(OUT, 'yedek.json'), 'utf8'));
  ok(full.state.venturis.length === 3 && full.state.venturis[0].data.calib, 'JSON yedeği tüm venturileri içeriyor');
  // mobil
  await p.click('#viewSeg button[data-view=main]');
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(300);
  ok(await p.evaluate(() => document.documentElement.scrollWidth) <= 392, 'mobilde yatay taşma yok');
  await ctx.close();
}

async function historyFlow(browser) {
  console.log('Geçmiş veriden kalibrasyon');
  const ctx = await context(browser);
  const p = await page(ctx, 'hist');
  await closeModals(p);
  await p.click('#tabs button[data-tab=live]');
  await p.check('[data-s=q] [data-f=enabled]');
  await p.click('#viewSeg button[data-view=calib]');
  await p.click('#calHist'); await p.click('[data-act=run]'); await p.waitForTimeout(2500);
  const n = await p.evaluate(() => document.querySelectorAll('[data-sel]').length);
  ok(n >= 25 && n <= 32, `6 saatlik veride kararlı bölümler bulundu (${n})`);
  await p.click('.modal-f .btn.primary'); await p.waitForTimeout(500);
  ok(await p.evaluate(() => VF.state.calib.rows.filter(r => r.src === 'geçmiş').length) === n, 'seçilen bölümler kalibrasyona eklendi');
  await ctx.close();
}

async function syncFlow(browser) {
  console.log('Ortak kayıt (venturi bazında birleştirme)');
  gh.enabled = true;
  const t = await context(browser);
  const tp = await t.newPage(); await tp.goto(BASE + '/tools/anahtar.html');
  await tp.fill('#token', TOKEN); await tp.fill('#pass', 'ANOVA'); await tp.fill('#pass2', 'ANOVA'); await tp.click('#go');
  await tp.waitForFunction(() => document.getElementById('out').value.length > 0);
  cfgJs = await tp.inputValue('#out');
  ok(!cfgJs.includes(TOKEN), 'anahtar sayfası token\'ı şifreledi');
  await t.close();
  const open = async name => {
    const c = await context(browser, { viewport: { width: 1600, height: 1000 } });
    const p = await page(c, name);
    await p.waitForSelector('[data-pass]');
    await p.fill('[data-pass]', 'ANOVA'); await p.fill('[data-name]', name); await p.click('.modal-f .btn.primary');
    await p.waitForFunction(() => !document.querySelector('.modal-bg'), null, { timeout: 15000 });
    await p.waitForTimeout(800);
    return p;
  };
  const RS = () => JSON.parse(gh.file).state;
  const A = await open('PC-A');
  const B = await open('PC-B');
  ok(RS().venturis.length === 1, 'ilk eşitlemede boş varsayılan venturi taşınmadı');
  await A.click('#btnVNew'); await A.waitForTimeout(300); await A.fill('[data-in="D"]', '154.05');
  await B.fill('[data-in="D"]', '77.93');
  await A.waitForTimeout(6500); await B.waitForTimeout(6500);
  await B.evaluate(() => VF.Sync.pull()); await B.waitForTimeout(1200);
  await A.evaluate(() => VF.Sync.pull()); await A.waitForTimeout(1200);
  const ds = RS().venturis.map(v => v.data.inputs.D.v).sort();
  ok(ds.join(',') === '154.05,77.93' && !(await A.$('.modal-bg')) && !(await B.$('.modal-bg')), 'farklı venturilerdeki değişiklikler sorusuz birleşti');
  await A.selectOption('#selVenturi', await A.evaluate(() => VF.state.venturis[0].id)); await A.waitForTimeout(300);
  await A.fill('[data-in="theta"]', '10'); await B.fill('[data-in="theta"]', '12');
  await A.waitForTimeout(6500); await B.waitForTimeout(7000);
  ok(!!(await B.$('[data-c]')), 'aynı venturi iki yerde değişince soru soruldu');
  await B.click('.modal-f .btn.primary'); await B.waitForTimeout(2500);
  const th = RS().venturis.map(v => v.data.inputs.theta.v);
  ok(th.includes(10) && th.includes(12), '"İkisini de tut" ile iki sürüm de korundu');
  gh.enabled = false; cfgJs = null;
}

(async () => {
  const browser = await chromium.launch();
  try {
    await appFlow(browser);
    await historyFlow(browser);
    await syncFlow(browser);
    ok(errs.length === 0, 'konsol hatası / dış ağ isteği yok' + (errs.length ? ': ' + JSON.stringify(errs) : ''));
    console.log('e2e: TAMAM');
  } catch (e) {
    console.error('BAŞARISIZ:', e.message, errs.length ? '\n' + errs.join('\n') : '');
    process.exitCode = 1;
  } finally { await browser.close(); }
})();
