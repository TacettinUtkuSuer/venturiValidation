/* VenturiFlow Master — Standartlar & Matematik Motoru (MODÜL 1)
 * ISO 5167-4:2003, ASME MFC-3M ve basit Bernoulli modeli.
 * Tüm giriş/çıkışlar SI birimindedir.
 */
(function (VF) {
  'use strict';

  // ISO 5167-4 §5.5 / ASME MFC-3M — klasik Venturi tüpü imalat tipleri.
  // C: boşaltma katsayısı, uC: C'nin %95 güven düzeyindeki göreli belirsizliği (%)
  // D, beta, Re: geçerlilik aralıkları (D metre cinsinden)
  const TYPES = {
    cast: {
      name: 'Ham döküm konvergent (As-cast)',
      C: 0.984, uC: 0.7, D: [0.100, 0.800], beta: [0.30, 0.75], Re: [2e5, 2e6]
    },
    machined: {
      name: 'İşlenmiş konvergent (Machined)',
      C: 0.995, uC: 1.0, D: [0.050, 0.250], beta: [0.40, 0.75], Re: [2e5, 1e6]
    },
    welded: {
      name: 'Kaba kaynaklı sac (Rough-welded)',
      C: 0.985, uC: 1.5, D: [0.200, 1.200], beta: [0.40, 0.70], Re: [2e5, 2e6]
    }
  };

  const STANDARDS = {
    iso: { name: 'ISO 5167-4:2003', short: 'ISO 5167-4', types: TYPES, tauMin: 0.75, pMax: 10e6 },
    asme: { name: 'ASME MFC-3M', short: 'ASME MFC-3M', types: TYPES, tauMin: 0.75, pMax: null },
    bernoulli: { name: 'Basit Bernoulli', short: 'Bernoulli', types: null, tauMin: null, pMax: null }
  };

  // Gibson konik difüzör kayıp katsayısı k(θ), θ = toplam (tepe) açısı [°].
  // ΔP_difüzör = k · ρ (v₂ − v₁)² / 2
  const GIBSON = [
    [3, 0.16], [5, 0.13], [7, 0.14], [10, 0.17], [15, 0.27], [20, 0.43],
    [30, 0.81], [40, 1.00], [60, 1.12], [90, 1.06], [180, 1.00]
  ];
  // Konvergent + boğaz sürtünme kaybı (boğaz dinamik basıncı cinsinden)
  const K_CONV_THROAT = 0.035;

  // ISO 5167-4 Tablo 1 esaslı memba (upstream) düz boru mesafeleri [D]
  // Sütunlar: β = 0.30, 0.40, 0.50, 0.60, 0.70, 0.75
  const STRAIGHT_BETAS = [0.30, 0.40, 0.50, 0.60, 0.70, 0.75];
  const FITTINGS = {
    bend90:     { name: 'Tek 90° dirsek', L: [0.5, 0.5, 1.5, 3.0, 4.0, 4.5] },
    bendsSame:  { name: 'Aynı düzlemde ≥2 adet 90° dirsek', L: [1.5, 1.5, 2.5, 2.5, 3.5, 4.5] },
    bendsDiff:  { name: 'Farklı düzlemlerde ≥2 adet 90° dirsek', L: [8.0, 8.0, 8.5, 12.5, 17.5, 27.5] },
    reducer:    { name: 'Redüksiyon (3D → D, 3,5D boyunca)', L: [0.5, 2.5, 5.5, 8.5, 10.5, 11.5] },
    expander:   { name: 'Genişleme (0,75D → D, D boyunca)', L: [1.5, 1.5, 2.5, 3.5, 5.5, 6.5] },
    valve:      { name: 'Tam açık küresel / sürgülü vana', L: [1.5, 2.5, 3.5, 4.5, 5.5, 5.5] }
  };
  const DOWNSTREAM_THROAT_D = 4; // Mansap: boğaz basınç alma noktasından ≥ 4d

  function interp(table, x) {
    if (x <= table[0][0]) return table[0][1];
    for (let i = 1; i < table.length; i++) {
      if (x <= table[i][0]) {
        const [x0, y0] = table[i - 1], [x1, y1] = table[i];
        return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
      }
    }
    return table[table.length - 1][1];
  }

  /** ISO 5167-4 Denklem (2): Genleşme faktörü ε (Y). τ = p₂/p₁ */
  function expansibility(beta, tau, kappa) {
    if (!(tau > 0) || tau > 1) return NaN;
    if (1 - tau < 1e-9) return 1;
    const b4 = Math.pow(beta, 4);
    const t2k = Math.pow(tau, 2 / kappa);
    const a = (kappa * t2k) / (kappa - 1);
    const b = (1 - b4) / (1 - b4 * t2k);
    const c = (1 - Math.pow(tau, (kappa - 1) / kappa)) / (1 - tau);
    return Math.sqrt(a * b * c);
  }

  /** Seçilen standart/imalat tipine göre C ve belirsizliği. */
  function discharge(inp) {
    if (inp.method === 'bernoulli') {
      return { C: inp.cd, uC: inp.ucd, typeName: 'Kullanıcı tanımlı C_d', limits: null };
    }
    const t = STANDARDS[inp.method].types[inp.mfg];
    return { C: t.C, uC: t.uC, typeName: t.name, limits: t };
  }

  /**
   * Model kurucu. inp:
   *  method, mfg, D, d, theta (difüzör toplam açısı °), p1 (mutlak Pa),
   *  fluid {type, rho, mu, pv, kappa}, cd, ucd (Bernoulli için)
   */
  function model(inp) {
    const D = inp.D, d = inp.d;
    const beta = d / D;
    const b4 = Math.pow(beta, 4);
    const E = 1 / Math.sqrt(1 - b4);
    const A2 = Math.PI * d * d / 4;
    const A1 = Math.PI * D * D / 4;
    const dc = discharge(inp);
    const isGas = inp.fluid.type === 'gas';
    const rho = inp.fluid.rho;
    const kappa = inp.fluid.kappa || 1.4;

    function eps(dp) {
      if (!isGas) return 1;
      return expansibility(beta, (inp.p1 - dp) / inp.p1, kappa);
    }

    /** ΔP → kütlesel debi (doğrudan çözüm) */
    function flowFromDp(dp) {
      if (!(dp > 0)) return 0;
      const e = eps(dp);
      return dc.C * e * E * A2 * Math.sqrt(2 * dp * rho);
    }

    /** kütlesel debi → ΔP (gazlar için ε'a göre iteratif) */
    function dpFromFlow(qm) {
      if (!(qm > 0)) return 0;
      const k0 = qm / (dc.C * E * A2);
      let dp = k0 * k0 / (2 * rho);
      if (!isGas) return dp;
      for (let i = 0; i < 60; i++) {
        if (dp >= inp.p1) return NaN;
        const e = eps(dp);
        if (!isFinite(e)) return NaN;
        const next = Math.pow(k0 / e, 2) / (2 * rho);
        if (Math.abs(next - dp) < 1e-9 * dp) { dp = next; break; }
        dp = next;
      }
      return dp < inp.p1 ? dp : NaN;
    }

    return { beta, b4, E, A1, A2, C: dc.C, uC: dc.uC, typeName: dc.typeName, limits: dc.limits, isGas, rho, kappa, eps, flowFromDp, dpFromFlow };
  }

  /** Kalıcı basınç kaybı (difüzör açısına bağlı) */
  function pressureLoss(m, qm, theta) {
    const v2 = qm / (m.rho * m.A2);
    const q2 = 0.5 * m.rho * v2 * v2; // boğaz dinamik basıncı
    const kd = interp(GIBSON, theta);
    const loss = (kd * Math.pow(1 - m.beta * m.beta, 2) + K_CONV_THROAT) * q2;
    return { loss, kd, v2, q2 };
  }

  /** ISO 5167-1 Denk. (B) — birleşik göreli belirsizlik (%) */
  function uncertainty(m, inp, dp) {
    const parts = [];
    const add = (key, name, sens, u) => parts.push({ key, name, sens, u, contrib: Math.abs(sens * u) });
    add('C', 'Boşaltma katsayısı C', 1, m.uC);
    let ue = 0;
    if (m.isGas) ue = (4 + 100 * Math.pow(m.beta, 8)) * dp / inp.p1; // ISO 5167-4 §5.7
    add('eps', 'Genleşme faktörü ε', 1, ue);
    add('D', 'Boru çapı D', 2 * m.b4 / (1 - m.b4), inp.tolD);
    add('d', 'Boğaz çapı d', 2 / (1 - m.b4), inp.told);
    const uDp = dp > 0 ? inp.txAcc * inp.txSpan / dp : NaN; // % span → % okuma
    add('dp', 'Fark basınç transmitteri ΔP', 0.5, uDp);
    add('rho', 'Yoğunluk ρ', 0.5, inp.uRho);
    const total = Math.sqrt(parts.reduce((s, p) => s + p.contrib * p.contrib, 0));
    return { parts, total };
  }

  function straightLengths(beta, fitting) {
    const f = FITTINGS[fitting] || FITTINGS.bend90;
    const b = Math.min(Math.max(beta, STRAIGHT_BETAS[0]), STRAIGHT_BETAS[STRAIGHT_BETAS.length - 1]);
    const table = STRAIGHT_BETAS.map((x, i) => [x, f.L[i]]);
    return { upstreamD: interp(table, b), downstream_d: DOWNSTREAM_THROAT_D, fittingName: f.name };
  }

  /** Tam analiz: belirli bir kütlesel debideki çalışma noktası */
  function analyze(inp, qm) {
    const m = model(inp);
    const dp = m.dpFromFlow(qm);
    const e = m.eps(dp);
    const v1 = qm / (m.rho * m.A1);
    const pl = pressureLoss(m, qm, inp.theta);
    const lossFrac = dp > 0 ? pl.loss / dp : NaN;
    const recovered = dp - pl.loss;
    const Re = 4 * qm / (Math.PI * inp.fluid.mu * inp.D);
    const p2 = inp.p1 - dp;
    const tau = p2 / inp.p1;
    const unc = uncertainty(m, inp, dp);
    const straight = straightLengths(m.beta, inp.fitting);

    // Sıvı: kavitasyon kontrolü
    let cav = null;
    if (!m.isGas) {
      const pv = inp.fluid.pv || 0;
      const sigma = (p2 - pv) / pl.q2;
      const qmCav = m.flowFromDp(Math.max(inp.p1 - pv, 0));
      let level = 'ok';
      if (p2 <= pv) level = 'bad';
      else if (sigma < 1.0) level = 'warn';
      cav = { pv, sigma, margin: p2 - pv, qmCav, level };
    }

    // Gaz: genleşme / τ sınırı
    let gas = null;
    if (m.isGas) {
      const tauMin = 0.75;
      const qmTau = m.flowFromDp(inp.p1 * (1 - tauMin));
      gas = { tau, tauMin, qmTau, level: !isFinite(dp) ? 'bad' : tau < tauMin ? 'warn' : 'ok' };
    }

    // Geçerlilik kontrolleri
    const checks = [];
    const lim = m.limits;
    const std = STANDARDS[inp.method];
    const rng = (name, v, r, f) => checks.push({
      name, value: f(v), range: `${f(r[0])} … ${f(r[1])}`, ok: v >= r[0] * 0.9999 && v <= r[1] * 1.0001
    });
    if (lim) {
      rng('Boru çapı D', inp.D, lim.D, x => (x * 1000).toFixed(0) + ' mm');
      rng('Çap oranı β', m.beta, lim.beta, x => x.toFixed(3));
      rng('Reynolds Re_D', Re, lim.Re, x => x.toExponential(2));
      if (m.isGas) checks.push({ name: 'Basınç oranı τ = p₂/p₁', value: tau.toFixed(3), range: '≥ 0.75', ok: tau >= 0.75 });
      checks.push({ name: 'Difüzör açısı φ', value: inp.theta.toFixed(1) + '°', range: '7° … 15°', ok: inp.theta >= 7 && inp.theta <= 15 });
      if (std.pMax) checks.push({ name: 'Hat basıncı p₁', value: (inp.p1 / 1e5).toFixed(2) + ' bar', range: '≤ 100 bar', ok: inp.p1 <= std.pMax });
    } else {
      checks.push({ name: 'Çap oranı β', value: m.beta.toFixed(3), range: '0.20 … 0.80 (öneri)', ok: m.beta >= 0.2 && m.beta <= 0.8 });
      if (m.isGas) checks.push({ name: 'Basınç oranı τ', value: tau.toFixed(3), range: '≥ 0.75 (öneri)', ok: tau >= 0.75 });
    }
    if (!m.isGas) checks.push({ name: 'Kavitasyon (p₂ > p_v)', value: cav.level === 'bad' ? 'VAR' : 'Yok', range: 'p₂ > p_v', ok: cav.level !== 'bad' });

    return {
      model: m, qm, dp, eps: e, C: m.C, beta: m.beta, E: m.E, A2: m.A2,
      v1, v2: pl.v2, Re, p2, tau, loss: pl.loss, kd: pl.kd, lossFrac, recovered,
      unc, straight, cav, gas, checks, std
    };
  }

  /** Geometri: SVG çizimi ve rapor için boyutlar */
  function geometry(D, d, theta) {
    const r = (D - d) / 2;
    const convAngle = 21; // ISO 5167-4: 21° ± 1°
    const Lc = r / Math.tan(convAngle / 2 * Math.PI / 180);
    const Lt = d;
    const Ld = r / Math.tan(theta / 2 * Math.PI / 180);
    return { Lin: D, Lc, Lt, Ld, Lout: D, convAngle, total: D + Lc + Lt + Ld + D };
  }

  VF.Physics = { K_CONV_THROAT, STANDARDS, TYPES, FITTINGS, GIBSON, expansibility, model, analyze, uncertainty, pressureLoss, straightLengths, geometry, interp };
})(window.VF = window.VF || {});
