/* VenturiFlow Master — Yerinde (in-situ) kalibrasyon motoru
 *
 * Test noktaları: referans kütlesel debi (Coriolis), ölçülen ΔP, sıcaklık T, (ops.) ölçülen yoğunluk ρ.
 * Tüm modeller yoğunluk kompanzasyonludur (h = √(ρ·ΔP)); C(Re) modelleri ayrıca viskoziteyi
 * (sıcaklığa bağlı Reynolds etkisini) kompanze eder.
 * Model kıyası, birini-dışarıda-bırak (leave-one-out) çapraz doğrulamasıyla yapılır.
 * Yalnızca sıvılar içindir (SI birimleri).
 */
(function (VF) {
  'use strict';
  const F = VF.Fluids;
  const SQRT2 = Math.SQRT2;

  /* ---------------- Sayısal yardımcılar ---------------- */
  /** Ağırlıklı en küçük kareler: X·c ≈ y */
  function lsq(X, y, w) {
    const m = X[0].length;
    const A = Array.from({ length: m }, () => new Array(m + 1).fill(0));
    for (let i = 0; i < X.length; i++) {
      const wi = w ? w[i] : 1;
      for (let r = 0; r < m; r++) {
        for (let c = 0; c < m; c++) A[r][c] += wi * X[i][r] * X[i][c];
        A[r][m] += wi * X[i][r] * y[i];
      }
    }
    // Gauss eliminasyonu (kısmi pivotlama)
    for (let c = 0; c < m; c++) {
      let p = c;
      for (let r = c + 1; r < m; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      if (Math.abs(A[p][c]) < 1e-300) return null;
      [A[c], A[p]] = [A[p], A[c]];
      for (let r = 0; r < m; r++) {
        if (r === c) continue;
        const f = A[r][c] / A[c][c];
        for (let k = c; k <= m; k++) A[r][k] -= f * A[c][k];
      }
    }
    const out = A.map((row, i) => row[m] / row[i]);
    return out.every(isFinite) ? out : null;
  }

  /** Yakın x değerlerini birleştirip sıralı tablo oluşturur */
  function mergeTable(xs, ys, tolRel, tolAbs) {
    const pts = xs.map((x, i) => [x, ys[i]]).sort((a, b) => a[0] - b[0]);
    const out = [];
    for (const [x, y] of pts) {
      const last = out[out.length - 1];
      const tol = tolAbs !== undefined ? tolAbs : Math.abs(last ? last.x0 : x) * tolRel;
      if (last && Math.abs(x - last.x0) <= tol) { last.sx += x; last.sy += y; last.n++; }
      else out.push({ x0: x, sx: x, sy: y, n: 1 });
    }
    return out.map(g => [g.sx / g.n, g.sy / g.n]);
  }

  function interp(tab, x) {
    if (x <= tab[0][0]) return tab[0][1];
    for (let i = 1; i < tab.length; i++) {
      if (x <= tab[i][0]) {
        const [x0, y0] = tab[i - 1], [x1, y1] = tab[i];
        return x1 === x0 ? y1 : y0 + (y1 - y0) * (x - x0) / (x1 - x0);
      }
    }
    return tab[tab.length - 1][1];
  }

  const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
  const poly = (c, x) => c.reduce((s, ci, i) => s + ci * Math.pow(x, i), 0);

  /* ---------------- Noktaların hazırlanması ---------------- */
  /** Genleşme faktörü ε (gaz) — sıvıda 1 */
  function epsOf(geo, dp, p1) {
    if (!geo.gas) return 1;
    if (!(p1 > dp) || !(dp > 0)) return NaN;
    return VF.Physics.expansibility(geo.beta, (p1 - dp) / p1, geo.kappa);
  }
  /** Ortak değişken: h = ε·√(ρ·ΔP)  (sıvıda ε = 1) */
  const hOf = x => (x.eps || 1) * Math.sqrt(x.rho * x.dp);

  /**
   * ctx: { fluid (akışkan tanımı), p1 (tasarım, mutlak), Tdesign, D, d }
   * Satır: { qm, dp, T?, rho?, p1? (mutlak, gaz) }
   * Dönüş: [{ qm, dp, T, p1, rho, mu, eps, h, K, C, Re, L, idx }]
   */
  function prepare(rows, ctx) {
    const beta = ctx.d / ctx.D;
    const E = 1 / Math.sqrt(1 - Math.pow(beta, 4));
    const A2 = Math.PI * ctx.d * ctx.d / 4;
    const gas = ctx.fluid.type === 'gas';
    const geo = { D: ctx.D, d: ctx.d, beta, E, A2, CGEO: E * A2 * SQRT2, gas, kappa: ctx.fluid.kappa || 1.4 };
    const pts = [];
    rows.forEach((r, idx) => {
      if (!r.on || !(r.qm > 0) || !(r.dp > 0)) return;
      const T = r.T > 0 ? r.T : ctx.Tdesign;
      const p1 = r.p1 > 0 ? r.p1 : ctx.p1;
      const pr = F.resolve(ctx.fluid, T, p1);
      const rho = r.rho > 0 ? r.rho : pr.rho;
      const mu = pr.mu;
      const eps = epsOf(geo, r.dp, p1);
      if (!isFinite(eps)) return;
      const h = eps * Math.sqrt(rho * r.dp);
      const Re = 4 * r.qm / (Math.PI * mu * ctx.D);
      pts.push({ qm: r.qm, dp: r.dp, T, p1, rho, mu, eps, h, K: r.qm / h, C: r.qm / (geo.CGEO * h), Re, L: Math.log10(Re), idx });
    });
    return { pts, geo };
  }

  /* ---------------- Modeller ---------------- */
  // predict(params, {dp, rho, mu}, geo) → kütlesel debi [kg/s]
  function iterC(cfun, x, geo) {
    const h = hOf(x);
    let C = cfun(null);
    let q = 0;
    for (let k = 0; k < 8; k++) {
      q = C * geo.CGEO * h;
      const L = Math.log10(4 * q / (Math.PI * x.mu * geo.D));
      C = cfun(isFinite(L) ? L : null);
    }
    return C * geo.CGEO * h;
  }

  const MODELS = [
    {
      id: 'K', name: 'Tek katsayı', short: 'K', minPts: 1, visc: false,
      formula: 'q_m = K·h,  h = ε·√(ρ·ΔP)',
      tex: 'q_m = K\\sqrt{\\rho\\,\\Delta P}',
      fit(p) {
        const K = p.reduce((s, x) => s + x.h / x.qm, 0) / p.reduce((s, x) => s + x.h * x.h / (x.qm * x.qm), 0);
        return { K };
      },
      predict: (m, x) => m.K * hOf(x)
    },
    {
      id: 'pow', name: 'Üslü', short: 'K·(h²)ⁿ', minPts: 2, visc: false,
      formula: 'q_m = K·(h²)^n,  h = ε·√(ρ·ΔP)',
      tex: 'q_m = K\\,(h^2)^{n}',
      fit(p) {
        const c = lsq(p.map(x => [1, Math.log(x.h * x.h)]), p.map(x => Math.log(x.qm)));
        return c ? { K: Math.exp(c[0]), n: c[1] } : null;
      },
      predict: (m, x) => { const h = hOf(x); return m.K * Math.pow(h * h, m.n); }
    },
    {
      id: 'poly', name: 'Polinom', short: 'a₀+a₁h+a₂h²', minPts: 3, visc: false,
      formula: 'q_m = a₀ + a₁·h + a₂·h²,  h = ε·√(ρ·ΔP)',
      tex: 'q_m = a_0 + a_1 h + a_2 h^2,\\quad h=\\sqrt{\\rho\\,\\Delta P}',
      fit(p) {
        const c = lsq(p.map(x => [1, x.h, x.h * x.h]), p.map(x => x.qm), p.map(x => 1 / (x.qm * x.qm)));
        return c ? { a: c } : null;
      },
      predict: (m, x) => Math.max(0, poly(m.a, hOf(x)))
    },
    {
      id: 'ktab', name: 'K düzeltme tablosu', short: 'K(ΔP) tablo', minPts: 2, visc: false,
      formula: 'q_m = K(ΔP)·h,  K tablodan doğrusal interpolasyon',
      tex: 'q_m = K(\\Delta P)\\,\\sqrt{\\rho\\,\\Delta P}',
      fit(p) {
        const tab = mergeTable(p.map(x => x.dp), p.map(x => x.K), 0.02);
        return tab.length >= 1 ? { tab } : null;
      },
      predict: (m, x) => interp(m.tab, x.dp) * hOf(x)
    },
    {
      id: 'cre', name: 'C(Re) polinom', short: 'C(Re) polinom', minPts: 2, visc: true,
      formula: 'q_m = C(Re)·E·A₂·√2·h,  C = c₀ + c₁·L + c₂·L²,  L = log₁₀(Re)',
      tex: 'q_m = C(Re)\\,E\\,A_2\\sqrt{2\\rho\\,\\Delta P},\\quad C=c_0+c_1L+c_2L^2,\\ L=\\log_{10}Re',
      fit(p) {
        const distinct = mergeTable(p.map(x => x.L), p.map(x => x.C), 0, 0.01).length;
        const deg = Math.min(2, distinct - 1, p.length - 1);
        let c;
        if (deg <= 0) c = [p.reduce((s, x) => s + x.C, 0) / p.length];
        else c = lsq(p.map(x => Array.from({ length: deg + 1 }, (_, i) => Math.pow(x.L, i))), p.map(x => x.C));
        if (!c) return null;
        while (c.length < 3) c.push(0);
        const Ls = p.map(x => x.L);
        return { c, Lmin: Math.min(...Ls), Lmax: Math.max(...Ls) };
      },
      predict(m, x, geo) {
        const Lmid = (m.Lmin + m.Lmax) / 2;
        return iterC(L => poly(m.c, clamp(L === null ? Lmid : L, m.Lmin, m.Lmax)), x, geo);
      }
    },
    {
      id: 'crtab', name: 'C(Re) tablosu', short: 'C(Re) tablo', minPts: 2, visc: true,
      formula: 'q_m = C(Re)·E·A₂·√2·h,  C tablodan log₁₀(Re)\'ye göre interpolasyon',
      tex: 'q_m = C(\\log_{10}Re)\\,E\\,A_2\\sqrt{2\\rho\\,\\Delta P}',
      fit(p) {
        const tab = mergeTable(p.map(x => x.L), p.map(x => x.C), 0, 0.01);
        return tab.length >= 1 ? { tab } : null;
      },
      predict(m, x, geo) {
        const mid = m.tab[Math.floor(m.tab.length / 2)][0];
        return iterC(L => interp(m.tab, L === null ? mid : L), x, geo);
      }
    }
  ];
  const byId = id => MODELS.find(m => m.id === id);
  const SIMPLICITY = ['K', 'pow', 'cre', 'poly', 'ktab', 'crtab'];

  function stats(errs) {
    if (!errs.length) return null;
    return {
      maxAbs: Math.max(...errs.map(Math.abs)),
      rms: Math.sqrt(errs.reduce((s, e) => s + e * e, 0) / errs.length),
      mean: errs.reduce((s, e) => s + e, 0) / errs.length
    };
  }

  /** Bir modeli uydurur, nokta hatalarını ve LOO hatalarını hesaplar */
  function evaluate(model, pts, geo) {
    if (pts.length < model.minPts) return { model, ok: false, reason: `En az ${model.minPts} nokta gerekli` };
    const params = model.fit(pts);
    if (!params) return { model, ok: false, reason: 'Uydurma başarısız (tekil veri)' };
    const err = pts.map(x => (model.predict(params, x, geo) - x.qm) / x.qm * 100);
    let loo = null, looErr = null;
    if (pts.length >= model.minPts + 1) {
      looErr = pts.map((x, i) => {
        const rest = pts.filter((_, j) => j !== i);
        const p = model.fit(rest);
        return p ? (model.predict(p, x, geo) - x.qm) / x.qm * 100 : NaN;
      });
      if (looErr.every(isFinite)) loo = stats(looErr); else looErr = null;
    }
    return { model, ok: true, params, err, fit: stats(err), looErr, loo };
  }

  /** Aynı debideki tekrar ölçümlerin K saçılması (kalibrasyonla düzeltilemeyen kısım) */
  function repeatability(pts) {
    const s = pts.slice().sort((a, b) => a.qm - b.qm);
    const groups = [];
    for (const p of s) {
      const g = groups[groups.length - 1];
      if (g && (p.qm - g[0].qm) / g[0].qm <= 0.015) g.push(p); else groups.push([p]);
    }
    const multi = groups.filter(g => g.length >= 2).map(g => {
      const Ks = g.map(p => p.K);
      const mean = Ks.reduce((a, b) => a + b, 0) / Ks.length;
      return { qm: g.reduce((a, p) => a + p.qm, 0) / g.length, n: g.length, spread: (Math.max(...Ks) - Math.min(...Ks)) / mean * 50 };
    });
    const worst = multi.length ? Math.max(...multi.map(g => g.spread)) : null;
    return { groups: multi, worst, level: worst === null ? 'none' : worst > 1.5 ? 'bad' : worst > 0.5 ? 'warn' : 'ok' };
  }

  /** ρ(T) ve μ(T) için PLC'ye uygun yaklaşık fonksiyonlar */
  function propertyFits(fluid, p1, TminK, TmaxK) {
    const lo = TminK - 5, hi = TmaxK + 5;
    const ts = Array.from({ length: 31 }, (_, i) => lo + (hi - lo) * i / 30);
    const data = ts.map(T => { const r = F.resolve(fluid, T, p1); return { T, t: T - 273.15, rho: r.rho, mu: r.mu }; });
    const rc = lsq(data.map(x => [1, x.t, x.t * x.t]), data.map(x => x.rho)) || [data[0].rho, 0, 0];
    const mc = lsq(data.map(x => [1, 1000 / x.T, Math.pow(1000 / x.T, 2)]), data.map(x => Math.log(x.mu))) || [Math.log(data[0].mu), 0, 0];
    const rhoF = t => poly(rc, t);
    const muF = T => Math.exp(poly(mc, 1000 / T));
    const rhoErr = Math.max(...data.map(x => Math.abs(rhoF(x.t) - x.rho) / x.rho * 100));
    const muErr = Math.max(...data.map(x => Math.abs(muF(x.T) - x.mu) / x.mu * 100));
    const hasTable = !!(fluid.table && fluid.table.length);
    return { rho: rc, mu: mc, rhoErr, muErr, range: [lo, hi], hasTable, muRatio: Math.max(...data.map(x => x.mu)) / Math.min(...data.map(x => x.mu)) };
  }

  /** Tam analiz */
  function analyze(rows, ctx, opts) {
    const { pts, geo } = prepare(rows, ctx);
    const results = MODELS.map(m => evaluate(m, pts, geo));
    const rep = repeatability(pts);
    const TminK = opts.TminK, TmaxK = opts.TmaxK;
    const pf = propertyFits(ctx.fluid, ctx.p1, TminK, TmaxK);
    const Ts = pts.map(p => p.T);
    const testTspan = Ts.length ? Math.max(...Ts) - Math.min(...Ts) : 0;

    // Teorik (kalibrasyonsuz) referans
    const theory = pts.map(x => (ctx.Cstd * geo.CGEO * x.h - x.qm) / x.qm * 100);

    // Öneri
    const viscSensitive = pf.muRatio > 1.3;
    let cands = results.filter(r => r.ok);
    const score = r => r.loo ? r.loo.maxAbs : r.fit.maxAbs + 100;
    let reason = '';
    if (viscSensitive && cands.some(r => r.model.visc)) {
      cands = cands.filter(r => r.model.visc);
      reason = `İşletme sıcaklık aralığında viskozite ${pf.muRatio.toFixed(2)} kat değişiyor; Reynolds etkisini kompanze eden C(Re) modelleri seçildi. `;
    }
    let rec = null;
    if (cands.length) {
      const best = Math.min(...cands.map(score));
      rec = SIMPLICITY.map(byIdIn(cands)).find(r => r && score(r) <= best + 0.15) || cands[0];
      reason += rec.loo
        ? `Çapraz doğrulamada (LOO) en büyük hata ±%${rec.loo.maxAbs.toFixed(2)}; benzer doğruluktaki modeller içinde en basiti.`
        : 'Çapraz doğrulama için yeterli nokta yok; uydurma hatasına göre seçildi.';
    }
    return { pts, geo, results, rep, pf, theory, rec, reason, viscSensitive, testTspan, Cstd: ctx.Cstd };
  }
  const byIdIn = list => id => list.find(r => r.model.id === id);

  /** Seçili model ile tahmin (canlı izleme / grafik) */
  function predict(modelId, params, geo, dp, rho, mu, p1) {
    const m = byId(modelId);
    if (!m || !params || !(dp > 0)) return 0;
    const eps = epsOf(geo, dp, p1);
    if (!isFinite(eps)) return 0;
    return m.predict(params, { dp, rho, mu, eps }, geo);
  }

  /* ---------------- PLC kod üretimi ---------------- */
  /** IEC 61131-3 REAL/LREAL literali */
  function lit(v) {
    if (!isFinite(v)) return '0.0';
    let s = Number(v).toPrecision(12);
    if (/e/.test(s)) {
      let [m, e] = s.split('e');
      if (m.includes('.')) m = m.replace(/0+$/, '').replace(/\.$/, '.0'); else m += '.0';
      return m + 'E' + (Number(e) < 0 ? '-' : '+') + String(Math.abs(Number(e))).padStart(2, '0');
    }
    if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '.0'); else s += '.0';
    return s;
  }

  const DP_TO_PA = { mbar: 100, bar: 1e5, Pa: 1, kPa: 1000, psi: 6894.757293168, mmH2O: 9.80665 };

  /**
   * g: { modelId, params, geo, pf, dpUnit, lowCutPct, ranges:{dpMin,dpMax,Tmin,Tmax,qMax}, meta:{date, n, loo, fit, fluid, name} }
   * flavor: 'twincat' | 'iec'
   */
  function plcCode(g, flavor) {
    const tc = flavor === 'twincat';
    const R = tc ? 'LREAL' : 'REAL';
    const m = byId(g.modelId);
    const p = g.params;
    const k = DP_TO_PA[g.dpUnit] || 100;
    const lowCutPa = Math.pow(g.lowCutPct / 100, 2) * g.ranges.dpMax;
    const name = g.name || 'FB_VenturiFlow';
    const gas = !!g.geo.gas;
    const idealGas = gas && g.gasM > 0;
    const kp = DP_TO_PA[g.p1Unit] || 1e5;
    const lines = [];
    const L = s => lines.push(s);
    const tab = (t, nx, ny) => {
      const n = t.length;
      return [`    ${nx} : ARRAY[1..${n}] OF ${R} := [${t.map(r => lit(r[0])).join(', ')}];`,
        `    ${ny} : ARRAY[1..${n}] OF ${R} := [${t.map(r => lit(r[1])).join(', ')}];`];
    };
    const interpCode = (x, ax, ay, n, y) => [
      `IF ${x} <= ${ax}[1] THEN`,
      `    ${y} := ${ay}[1];`,
      `ELSIF ${x} >= ${ax}[${n}] THEN`,
      `    ${y} := ${ay}[${n}];`,
      'ELSE',
      `    FOR i := 1 TO ${n - 1} DO`,
      `        IF ${x} <= ${ax}[i + 1] THEN`,
      `            ${y} := ${ay}[i] + (${ay}[i + 1] - ${ay}[i]) * (${x} - ${ax}[i]) / (${ax}[i + 1] - ${ax}[i]);`,
      '            EXIT;',
      '        END_IF',
      '    END_FOR',
      'END_IF'
    ];

    L(`FUNCTION_BLOCK ${name}`);
    L('(* =====================================================================');
    L(`   VenturiFlow Master — ${tc ? 'Beckhoff TwinCAT 3' : 'Genel IEC 61131-3 ST'} — otomatik üretildi`);
    L(`   Tarih        : ${g.meta.date}`);
    L(`   Model        : ${m.name} — ${m.formula}`);
    L(`   Kalibrasyon  : ${g.meta.n} nokta, akışkan: ${g.meta.fluid} (${gas ? 'GAZ — ε ve ' + (idealGas ? 'ideal gaz yoğunluğu' : 'yoğunluk') + ' dahil' : 'sıvı'})`);
    L(`   Hata (uydurma): maks ±%${g.meta.fit.maxAbs.toFixed(3)}, RMS %${g.meta.fit.rms.toFixed(3)}`);
    if (g.meta.loo) L(`   Hata (LOO)   : maks ±%${g.meta.loo.maxAbs.toFixed(3)}, RMS %${g.meta.loo.rms.toFixed(3)}`);
    L(`   Geçerli aralık: ΔP ${(g.ranges.dpMin / k).toPrecision(4)} … ${(g.ranges.dpMax / k).toPrecision(4)} ${g.dpUnit}, T ${(g.ranges.Tmin - 273.15).toFixed(1)} … ${(g.ranges.Tmax - 273.15).toFixed(1)} °C`);
    L(`   ρ(T) yaklaşımı maks hata %${g.pf.rhoErr.toFixed(3)}, μ(T) maks hata %${g.pf.muErr.toFixed(2)}`);
    L('   Kullanım:');
    L(`     fbVenturi(fDp := <ΔP [${g.dpUnit}]>, fTemp := <T [°C]>, ${gas ? `fP1 := <P1 mutlak [${g.p1Unit}]>, ` : ''}fDensityIn := <Coriolis ρ veya 0>);`);
    L('     fbVenturi.fMassFlow  → [kg/h], fbVenturi.fVolFlow → [m3/h]');
    L('   ===================================================================== *)');
    L('VAR_INPUT');
    L(`    fDp        : ${R};      (* Fark basınç [${g.dpUnit}] *)`);
    L(`    fTemp      : ${R};      (* Akışkan sıcaklığı [°C] *)`);
    if (gas) L(`    fP1        : ${R};      (* Giriş basıncı, MUTLAK [${g.p1Unit}] *)`);
    L(`    fDensityIn : ${R};      (* Ölçülen yoğunluk [kg/m3]; 0 ise ${idealGas ? 'ρ = p1·M/(Z·R·T)' : 'ρ(T)'} kullanılır *)`);
    L('END_VAR');
    L('VAR_OUTPUT');
    L(`    fMassFlow   : ${R};     (* Kütlesel debi [kg/h] *)`);
    L(`    fVolFlow    : ${R};     (* Hacimsel debi [m3/h] *)`);
    L(`    fDensity    : ${R};     (* Kullanılan yoğunluk [kg/m3] *)`);
    L(`    fViscosity  : ${R};     (* Dinamik viskozite [Pa.s] *)`);
    L(`    fRe         : ${R};     (* Reynolds sayısı (boru) *)`);
    L(`    fCd         : ${R};     (* Etkin boşaltma katsayısı *)`);
    L('    bLowFlowCut : BOOL;     (* Düşük debi kesmesi aktif *)');
    L('    bOutOfRange : BOOL;     (* ΔP veya T kalibrasyon aralığı dışında *)');
    L('END_VAR');
    L('VAR CONSTANT');
    L(`    PI_C       : ${R} := 3.14159265358979;`);
    L(`    DP_TO_PA   : ${R} := ${lit(k)};       (* ${g.dpUnit} → Pa *)`);
    L(`    D_PIPE     : ${R} := ${lit(g.geo.D)};   (* Boru iç çapı [m] *)`);
    L(`    C_GEO      : ${R} := ${lit(g.geo.CGEO)};   (* E·A2·√2 [m2] *)`);
    L(`    RHO_0      : ${R} := ${lit(g.pf.rho[0])};   (* ρ(T) = RHO_0 + RHO_1·t + RHO_2·t², t[°C] *)`);
    L(`    RHO_1      : ${R} := ${lit(g.pf.rho[1])};`);
    L(`    RHO_2      : ${R} := ${lit(g.pf.rho[2])};`);
    L(`    MU_0       : ${R} := ${lit(g.pf.mu[0])};   (* ln μ = MU_0 + MU_1·x + MU_2·x², x = 1000/T[K] *)`);
    L(`    MU_1       : ${R} := ${lit(g.pf.mu[1])};`);
    L(`    MU_2       : ${R} := ${lit(g.pf.mu[2])};`);
    if (gas) {
      L(`    P1_TO_PA   : ${R} := ${lit(kp)};       (* ${g.p1Unit} → Pa *)`);
      L(`    KAPPA      : ${R} := ${lit(g.geo.kappa)};   (* izentropik üs *)`);
      L(`    BETA4      : ${R} := ${lit(Math.pow(g.geo.beta, 4))};   (* β⁴ *)`);
      if (idealGas) {
        L(`    M_KG       : ${R} := ${lit(g.gasM / 1000)};   (* molar kütle [kg/mol] *)`);
        L(`    Z_F        : ${R} := ${lit(g.gasZ || 1)};   (* sıkıştırılabilirlik *)`);
        L(`    R_GAS      : ${R} := 8.314462618;`);
      }
    }
    L(`    LOWCUT_PA  : ${R} := ${lit(lowCutPa)};   (* %${g.lowCutPct} maks. debi *)`);
    L(`    DP_MIN_PA  : ${R} := ${lit(g.ranges.dpMin)};`);
    L(`    DP_MAX_PA  : ${R} := ${lit(g.ranges.dpMax)};`);
    L(`    T_MIN_C    : ${R} := ${lit(g.ranges.Tmin - 273.15)};`);
    L(`    T_MAX_C    : ${R} := ${lit(g.ranges.Tmax - 273.15)};`);
    if (m.id === 'K') L(`    K_CAL      : ${R} := ${lit(p.K)};`);
    if (m.id === 'pow') { L(`    K_CAL      : ${R} := ${lit(p.K)};`); L(`    N_EXP      : ${R} := ${lit(p.n)};`); }
    if (m.id === 'poly') p.a.forEach((a, i) => L(`    A_${i}        : ${R} := ${lit(a)};`));
    if (m.id === 'cre') {
      p.c.forEach((c, i) => L(`    C_${i}        : ${R} := ${lit(c)};`));
      L(`    L_MIN      : ${R} := ${lit(p.Lmin)};   (* log10(Re) aralığı *)`);
      L(`    L_MAX      : ${R} := ${lit(p.Lmax)};`);
    }
    L('END_VAR');
    L('VAR');
    if (m.id === 'ktab') tab(p.tab, 'aDpTab', 'aKTab').forEach(L);
    if (m.id === 'crtab') tab(p.tab, 'aLTab', 'aCTab').forEach(L);
    L(`    fDpPa, fTK, fH, fQm, fC, fL, fX : ${R};`);
    if (gas) L(`    fP1Pa, fTau, fT2k, fEps : ${R};`);
    L('    i, k : INT;');
    L('END_VAR');
    const declEnd = lines.length;
    L('');
    L('(* ---------- Akışkan özellikleri ---------- *)');
    L('fDpPa := fDp * DP_TO_PA;');
    L('fTK := fTemp + 273.15;');
    if (gas) L('fP1Pa := fP1 * P1_TO_PA;');
    L('IF fDensityIn > 0.0 THEN');
    L('    fDensity := fDensityIn;');
    L('ELSE');
    L(idealGas ? '    fDensity := fP1Pa * M_KG / (Z_F * R_GAS * fTK);   (* ideal gaz *)' : '    fDensity := RHO_0 + RHO_1 * fTemp + RHO_2 * fTemp * fTemp;');
    L('END_IF');
    L('fX := 1000.0 / fTK;');
    L('fViscosity := EXP(MU_0 + MU_1 * fX + MU_2 * fX * fX);');
    L('bOutOfRange := (fDpPa < DP_MIN_PA) OR (fDpPa > DP_MAX_PA) OR (fTemp < T_MIN_C) OR (fTemp > T_MAX_C);');
    L('bLowFlowCut := fDpPa < LOWCUT_PA;');
    L('');
    L(gas ? 'IF bLowFlowCut OR (fDensity <= 0.0) OR (fDpPa >= fP1Pa) THEN' : 'IF bLowFlowCut OR (fDensity <= 0.0) THEN');
    L('    fQm := 0.0;');
    L('    fRe := 0.0;');
    L('    fCd := 0.0;');
    L('ELSE');
    const body = [];
    const B = s => body.push(s);
    if (gas) {
      B('(* Genleşme faktörü ε (ISO 5167-4 Denk. 2), τ = p2/p1 *)');
      B('fTau := (fP1Pa - fDpPa) / fP1Pa;');
      B('IF fTau >= 1.0 THEN');
      B('    fEps := 1.0;');
      B('ELSE');
      B('    fT2k := EXPT(fTau, 2.0 / KAPPA);');
      B('    fEps := SQRT((KAPPA * fT2k / (KAPPA - 1.0)) * ((1.0 - BETA4) / (1.0 - BETA4 * fT2k)) * ((1.0 - EXPT(fTau, (KAPPA - 1.0) / KAPPA)) / (1.0 - fTau)));');
      B('END_IF');
      B('fH := fEps * SQRT(fDensity * fDpPa);');
    } else B('fH := SQRT(fDensity * fDpPa);');
    B(`(* ---------- Model: ${m.name} ---------- *)`);
    if (m.id === 'K') B('fQm := K_CAL * fH;');
    if (m.id === 'pow') B('fQm := K_CAL * EXPT(fH * fH, N_EXP);');
    if (m.id === 'poly') { B('fQm := A_0 + A_1 * fH + A_2 * fH * fH;'); B('IF fQm < 0.0 THEN fQm := 0.0; END_IF'); }
    if (m.id === 'ktab') { interpCode('fDpPa', 'aDpTab', 'aKTab', p.tab.length, 'fC').forEach(B); B('fQm := fC * fH;   (* fC burada K katsayısıdır *)'); }
    if (m.id === 'cre' || m.id === 'crtab') {
      B(m.id === 'cre' ? 'fC := C_0 + C_1 * ((L_MIN + L_MAX) / 2.0) + C_2 * ((L_MIN + L_MAX) / 2.0) * ((L_MIN + L_MAX) / 2.0);' : `fC := aCTab[${Math.floor(p.tab.length / 2) + 1}];`);
      B('(* Re, debiye bağlı olduğundan sabit nokta iterasyonu (hızlı yakınsar) *)');
      B('FOR k := 1 TO 6 DO');
      B('    fQm := fC * C_GEO * fH;');
      B('    fL := LOG(4.0 * fQm / (PI_C * fViscosity * D_PIPE));   (* LOG = log10 *)');
      if (m.id === 'cre') {
        B('    IF fL < L_MIN THEN fL := L_MIN; ELSIF fL > L_MAX THEN fL := L_MAX; END_IF');
        B('    fC := C_0 + C_1 * fL + C_2 * fL * fL;');
      } else {
        interpCode('fL', 'aLTab', 'aCTab', p.tab.length, 'fC').forEach(s => B('    ' + s));
      }
      B('END_FOR');
      B('fQm := fC * C_GEO * fH;');
    }
    B('fRe := 4.0 * fQm / (PI_C * fViscosity * D_PIPE);');
    B('fCd := fQm / (C_GEO * fH);');
    body.forEach(s => L('    ' + s));
    L('END_IF');
    L('');
    L('fMassFlow := fQm * 3600.0;');
    L('IF fDensity > 0.0 THEN');
    L('    fVolFlow := fMassFlow / fDensity;');
    L('ELSE');
    L('    fVolFlow := 0.0;');
    L('END_IF');
    if (tc) {
      // TwinCAT 3: bildirim ve uygulama editörde ayrı panellerdir; END_FUNCTION_BLOCK yazılmaz.
      return {
        decl: ascii(lines.slice(0, declEnd).join('\n')),
        impl: ascii(lines.slice(declEnd + 1).join('\n'))
      };
    }
    L('END_FUNCTION_BLOCK');
    lines.push('', '(* Not: Siemens SCL’de ARRAY başlangıç değerleri ve LOG/EXPT adları farklı olabilir;', '   gerekirse "Katsayılar" sekmesindeki değerlerle uyarlayın. *)');
    return ascii(lines.join('\n'));
  }

  /** PLC editörleri için ASCII'ye çevirir (eski TwinCAT/IDE'lerde UTF-8 yorum sorunu) */
  const ASCII_MAP = {
    'ı': 'i', 'İ': 'I', 'ş': 's', 'Ş': 'S', 'ğ': 'g', 'Ğ': 'G', 'ü': 'u', 'Ü': 'U', 'ö': 'o', 'Ö': 'O', 'ç': 'c', 'Ç': 'C',
    'ρ': 'rho', 'μ': 'mu', 'Δ': 'd', '°': 'deg', '√': 'sqrt', '²': '^2', '³': '3', '·': '*', '…': '...', '—': '-', '–': '-',
    '±': '+/-', '→': '->', '’': "'", '₀': '0', '₁': '1', '₂': '2', 'ⁿ': '^n', '≥': '>=', '≤': '<='
  };
  function ascii(s) {
    return s.replace(/[^\x00-\x7F]/g, ch => ASCII_MAP[ch] !== undefined ? ASCII_MAP[ch] : '?');
  }

  /** Düz metin katsayı listesi (HMI / farklı PLC için) */
  function coefText(g) {
    const m = byId(g.modelId), p = g.params;
    const k = DP_TO_PA[g.dpUnit] || 100;
    const out = [];
    out.push(`VenturiFlow Master — Kalibrasyon katsayıları (${g.meta.date})`);
    out.push(`Model: ${m.name}`);
    out.push(`Formül: ${m.formula}`);
    out.push('Birimler: q_m [kg/s], ΔP [Pa], ρ [kg/m3], μ [Pa.s], T [K], t [°C]');
    out.push(`ΔP girişi ${g.dpUnit} ise: ΔP[Pa] = ΔP[${g.dpUnit}] × ${lit(k)}`);
    out.push('');
    out.push('Geometri:');
    out.push(`  D = ${lit(g.geo.D)} m, d = ${lit(g.geo.d)} m, E = ${lit(g.geo.E)}, A2 = ${lit(g.geo.A2)} m2, C_GEO = E·A2·√2 = ${lit(g.geo.CGEO)}`);
    if (g.geo.gas) {
      out.push(`GAZ: h = ε·√(ρ·ΔP), ε = √[(κτ^(2/κ)/(κ−1))·((1−β⁴)/(1−β⁴τ^(2/κ)))·((1−τ^((κ−1)/κ))/(1−τ))], τ = (p1−ΔP)/p1 (p1 mutlak)`);
      out.push(`  κ = ${lit(g.geo.kappa)}, β⁴ = ${lit(Math.pow(g.geo.beta, 4))}` + (g.gasM > 0 ? `, ρ = p1·M/(Z·R·T): M = ${lit(g.gasM / 1000)} kg/mol, Z = ${lit(g.gasZ || 1)}, R = 8.314462618` : ''));
    } else out.push('SIVI: h = √(ρ·ΔP)');
    out.push('Akışkan özellikleri:');
    out.push(`  ρ(t)  = ${lit(g.pf.rho[0])} + ${lit(g.pf.rho[1])}·t + ${lit(g.pf.rho[2])}·t²     (maks hata %${g.pf.rhoErr.toFixed(3)})`);
    out.push(`  ln μ  = ${lit(g.pf.mu[0])} + ${lit(g.pf.mu[1])}·x + ${lit(g.pf.mu[2])}·x²,  x = 1000/T   (maks hata %${g.pf.muErr.toFixed(2)})`);
    out.push('Model katsayıları:');
    if (m.id === 'K') out.push(`  K = ${lit(p.K)}`);
    if (m.id === 'pow') out.push(`  K = ${lit(p.K)}`, `  n = ${lit(p.n)}`);
    if (m.id === 'poly') p.a.forEach((a, i) => out.push(`  a${i} = ${lit(a)}`));
    if (m.id === 'cre') { p.c.forEach((c, i) => out.push(`  c${i} = ${lit(c)}`)); out.push(`  L aralığı: ${lit(p.Lmin)} … ${lit(p.Lmax)} (dışında sınır değer)`); out.push('  Çözüm: C ile başla → q = C·C_GEO·√(ρΔP) → Re = 4q/(πμD) → C(L) → 6 tekrar'); }
    if (m.id === 'ktab') { out.push('  ΔP [Pa]            K'); p.tab.forEach(r => out.push(`  ${lit(r[0]).padEnd(18)} ${lit(r[1])}`)); }
    if (m.id === 'crtab') { out.push('  log10(Re)          C'); p.tab.forEach(r => out.push(`  ${lit(r[0]).padEnd(18)} ${lit(r[1])}`)); }
    out.push('');
    out.push(`Düşük debi kesme: ΔP < ${lit(Math.pow(g.lowCutPct / 100, 2) * g.ranges.dpMax)} Pa (%${g.lowCutPct} maks. debi) → q = 0`);
    out.push(`Geçerli aralık: ΔP ${lit(g.ranges.dpMin)} … ${lit(g.ranges.dpMax)} Pa, T ${(g.ranges.Tmin - 273.15).toFixed(1)} … ${(g.ranges.Tmax - 273.15).toFixed(1)} °C`);
    return out.join('\n');
  }

  VF.Calib = { MODELS, byId, analyze, predict, plcCode, coefText, propertyFits, lsq, lit, DP_TO_PA };
})(window.VF = window.VF || {});
