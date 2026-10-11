// Kalibrasyon motoru birim testi (tarayıcısız): sıvı ve gaz için model uydurma + üretilen PLC kodunun
// aynı sonucu verdiğinin doğrulanması.  Çalıştırma: node tests/unit-calib.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
global.window = {};
for (const f of ['units', 'physics', 'fluids', 'calib']) eval(fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf8'));
const VF = window.VF, F = VF.Fluids, C = VF.Calib, P = VF.Physics;
const D = 0.10226, d = 0.6 * D, beta = 0.6, E = 1 / Math.sqrt(1 - beta ** 4), A2 = Math.PI * d * d / 4;
let seed = 7; const rnd = () => (seed = seed * 16807 % 2147483647) / 2147483647;

// ---- ε: bağımsız hesapla karşılaştır ----
const t = 0.9, k = 1.4, b4 = beta ** 4, t2 = t ** (2 / k);
const epsRef = Math.sqrt(k * t2 / (k - 1) * (1 - b4) / (1 - b4 * t2) * (1 - t ** ((k - 1) / k)) / (1 - t));
assert(Math.abs(P.expansibility(beta, t, k) - epsRef) < 1e-12, 'ε formülü');

/** Üretilen ST kodunu (IEC, REAL) JS'te çalıştırıp debiyi hesaplar (yalnızca C(Re) polinom modeli) */
function simST(st, dpMbar, tC, p1Bar) {
  const c = {}; st.replace(/^\s+(\w+)\s*:\s*REAL := ([^;]+);/gm, (m, kk, v) => { c[kk] = Number(v); });
  const dpPa = dpMbar * c.DP_TO_PA, TK = tC + 273.15;
  let rho, eps = 1;
  if (c.P1_TO_PA) {
    const p1 = p1Bar * c.P1_TO_PA; rho = p1 * c.M_KG / (c.Z_F * c.R_GAS * TK);
    const tau = (p1 - dpPa) / p1, tk = Math.pow(tau, 2 / c.KAPPA);
    eps = Math.sqrt((c.KAPPA * tk / (c.KAPPA - 1)) * ((1 - c.BETA4) / (1 - c.BETA4 * tk)) * ((1 - Math.pow(tau, (c.KAPPA - 1) / c.KAPPA)) / (1 - tau)));
  } else rho = c.RHO_0 + c.RHO_1 * tC + c.RHO_2 * tC * tC;
  const x = 1000 / TK, mu = Math.exp(c.MU_0 + c.MU_1 * x + c.MU_2 * x * x);
  const h = eps * Math.sqrt(rho * dpPa), Lm = (c.L_MIN + c.L_MAX) / 2;
  let Cc = c.C_0 + c.C_1 * Lm + c.C_2 * Lm * Lm, q;
  for (let i = 0; i < 6; i++) { q = Cc * c.C_GEO * h; let L = Math.log10(4 * q / (c.PI_C * mu * c.D_PIPE)); L = Math.min(Math.max(L, c.L_MIN), c.L_MAX); Cc = c.C_0 + c.C_1 * L + c.C_2 * L * L; }
  return Cc * c.C_GEO * h;
}

function run(fluid, rows, label) {
  const ctx = { fluid, p1: 4e5, Tdesign: 293.15, D, d, Cstd: 0.995 };
  const a = C.analyze(rows, ctx, { TminK: 278.15, TmaxK: 353.15 });
  const theory = Math.max(...a.theory.map(Math.abs));
  const cre = a.results.find(r => r.model.id === 'cre');
  const g = { modelId: 'cre', params: cre.params, geo: a.geo, pf: a.pf, dpUnit: 'mbar', p1Unit: 'bar', gasM: fluid.M, gasZ: fluid.Z, lowCutPct: 1,
    ranges: { dpMin: 1, dpMax: 1e7, Tmin: 270, Tmax: 360 }, meta: { date: '-', n: rows.length, fit: cre.fit, loo: cre.loo, fluid: fluid.name } };
  const st = C.plcCode(g, 'iec');
  const tc = C.plcCode(g, 'twincat');
  assert(/^[\x00-\x7F]*$/.test(tc.decl + tc.impl), 'TwinCAT kodu ASCII olmalı');
  let worst = 0;
  for (const r of rows) worst = Math.max(worst, Math.abs(simST(st, r.dp / 100, r.T - 273.15, (r.p1 || 4e5) / 1e5) - r.qm) / r.qm * 100);
  console.log(`${label}: teorik ±%${theory.toFixed(2)} → C(Re) uydurma ±%${cre.fit.maxAbs.toFixed(3)}, LOO ±%${cre.loo.maxAbs.toFixed(3)}, PLC simülasyonu ±%${worst.toFixed(3)}, öneri ${a.rec.model.id}`);
  assert(theory > 3, 'kötü imalat verisi teoriden sapmalı');
  assert(cre.fit.maxAbs < 0.3, 'C(Re) uydurma hatası küçük olmalı');
  assert(Math.abs(worst - cre.fit.maxAbs) < 0.05, 'PLC kodu uygulama ile aynı sonucu vermeli');
}

// ---- Sıvı (su), 3 sıcaklık ----
const water = F.BUILTIN.find(f => f.id === 'water');
const wr = [];
for (const T of [15, 45, 80]) for (const f of [0.15, 0.3, 0.5, 0.7, 0.9, 1.0]) {
  const r = F.resolve(water, T + 273.15, 3e5), qm = 27.7 * f;
  const Re = 4 * qm / (Math.PI * r.mu * D), Ct = 0.955 + 0.012 * Math.log10(Re / 1e5);
  wr.push({ on: true, qm, dp: (qm / (Ct * E * A2)) ** 2 / (2 * r.rho) * (1 + (rnd() - 0.5) * 0.004), T: T + 273.15 });
}
run(water, wr, 'Sıvı (su)');

// ---- Gaz (doğal gaz), 3 sıcaklık × 2 basınç ----
const ng = F.BUILTIN.find(f => f.id === 'ng');
const gr = [];
for (const T of [5, 25, 45]) for (const p1 of [3e5, 5e5]) for (const f of [0.2, 0.4, 0.6, 0.8, 1.0]) {
  const r = F.resolve(ng, T + 273.15, p1), qm = 0.9 * f * (p1 / 5e5);
  const Re = 4 * qm / (Math.PI * r.mu * D), Ct = 0.955 + 0.012 * Math.log10(Re / 1e5);
  let dp = (qm / (Ct * E * A2)) ** 2 / (2 * r.rho);
  for (let i = 0; i < 40; i++) dp = (qm / (Ct * P.expansibility(beta, (p1 - dp) / p1, ng.kappa) * E * A2)) ** 2 / (2 * r.rho);
  gr.push({ on: true, qm, dp: dp * (1 + (rnd() - 0.5) * 0.004), T: T + 273.15, p1 });
}
run(ng, gr, 'Gaz (doğal gaz)');
console.log('unit-calib: TAMAM');
