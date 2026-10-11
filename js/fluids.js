/* VenturiFlow Master — Akışkan yönetimi (MODÜL 3) & boru kütüphanesi (MODÜL 4)
 * Akışkan nesnesi (SI):
 *  { id, name, type:'liquid'|'gas', rho, mu, pv, kappa, M (g/mol), Z,
 *    table: [{T, rho, mu, pv}]  // T [K]; opsiyonel, sıcaklığa göre interpolasyon }
 */
(function (VF) {
  'use strict';

  const R = 8.314462618; // J/(mol·K)

  // Saf su, 1 atm (IAPWS esaslı yuvarlanmış değerler)
  const WATER_TABLE = [
    [0, 999.84, 1.792, 0.611], [10, 999.70, 1.307, 1.228], [20, 998.21, 1.002, 2.339],
    [30, 995.65, 0.798, 4.247], [40, 992.22, 0.653, 7.384], [50, 988.04, 0.547, 12.35],
    [60, 983.20, 0.467, 19.95], [70, 977.76, 0.404, 31.20], [80, 971.79, 0.355, 47.41],
    [90, 965.31, 0.315, 70.18], [100, 958.35, 0.282, 101.42]
  ].map(([t, rho, mu, pv]) => ({ T: t + 273.15, rho, mu: mu * 1e-3, pv: pv * 1e3 }));

  const BUILTIN = [
    { id: 'water', name: 'Su', type: 'liquid', rho: 998.2, mu: 1.002e-3, pv: 2339, kappa: 1.4, M: 0, Z: 1, table: WATER_TABLE, builtin: true },
    { id: 'air', name: 'Hava', type: 'gas', rho: 1.204, mu: 1.81e-5, pv: 0, kappa: 1.40, M: 28.965, Z: 1, table: null, builtin: true },
    { id: 'ng', name: 'Doğal Gaz (≈CH₄)', type: 'gas', rho: 0.668, mu: 1.10e-5, pv: 0, kappa: 1.31, M: 16.04, Z: 0.998, table: null, builtin: true },
    { id: 'n2', name: 'Azot (N₂)', type: 'gas', rho: 1.165, mu: 1.76e-5, pv: 0, kappa: 1.40, M: 28.013, Z: 1, table: null, builtin: true },
    { id: 'glycol30', name: 'Su–Glikol %30', type: 'liquid', rho: 1040, mu: 2.5e-3, pv: 2000, kappa: 1.4, M: 0, Z: 1, table: null, builtin: true },
    { id: 'diesel', name: 'Dizel', type: 'liquid', rho: 832, mu: 3.0e-3, pv: 300, kappa: 1.4, M: 0, Z: 1, table: null, builtin: true }
  ];

  function interpTable(table, T, key) {
    const rows = table.filter(r => isFinite(r[key]));
    if (!rows.length) return NaN;
    if (T <= rows[0].T) return rows[0][key];
    for (let i = 1; i < rows.length; i++) {
      if (T <= rows[i].T) {
        const a = rows[i - 1], b = rows[i];
        return a[key] + (b[key] - a[key]) * (T - a.T) / (b.T - a.T);
      }
    }
    return rows[rows.length - 1][key];
  }

  /** Çalışma koşullarında (T, p₁) akışkan özelliklerini çözer. */
  function resolve(f, T, p1) {
    const out = { type: f.type, rho: f.rho, mu: f.mu, pv: f.pv || 0, kappa: f.kappa || 1.4, source: {} };
    if (f.table && f.table.length) {
      const tb = f.table.slice().sort((a, b) => a.T - b.T);
      for (const k of ['rho', 'mu', 'pv']) {
        const v = interpTable(tb, T, k);
        if (isFinite(v)) { out[k] = v; out.source[k] = 'tablo'; }
      }
      out.tableRange = [tb[0].T, tb[tb.length - 1].T];
      out.outOfTable = T < tb[0].T - 0.01 || T > tb[tb.length - 1].T + 0.01;
    }
    if (f.type === 'gas' && f.M > 0) {
      out.rho = p1 * (f.M / 1000) / ((f.Z || 1) * R * T);
      out.source.rho = 'ideal gaz (pM/ZRT)';
    }
    return out;
  }

  function uid() {
    return 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  // Boru kütüphanesi — iç çaplar [mm]
  const PIPES = [
    { group: 'EN 10220 / DN (tipik et kalınlığı)', items: [
      ['DN50 (60,3 × 2,9)', 54.5], ['DN65 (76,1 × 2,9)', 70.3], ['DN80 (88,9 × 3,2)', 82.5],
      ['DN100 (114,3 × 3,6)', 107.1], ['DN125 (139,7 × 4,0)', 131.7], ['DN150 (168,3 × 4,5)', 159.3],
      ['DN200 (219,1 × 6,3)', 206.5]
    ] },
    { group: 'ANSI B36.10 — Sch 40', items: [
      ['2" Sch40', 52.50], ['2½" Sch40', 62.71], ['3" Sch40', 77.93], ['4" Sch40', 102.26],
      ['5" Sch40', 128.19], ['6" Sch40', 154.05], ['8" Sch40', 202.72]
    ] },
    { group: 'ANSI B36.10 — Sch 80', items: [
      ['2" Sch80', 49.25], ['2½" Sch80', 59.00], ['3" Sch80', 73.66], ['4" Sch80', 97.18],
      ['5" Sch80', 122.25], ['6" Sch80', 146.33], ['8" Sch80', 193.68]
    ] }
  ];

  VF.Fluids = { BUILTIN, PIPES, resolve, uid, interpTable };
})(window.VF = window.VF || {});
