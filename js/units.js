/* VenturiFlow Master — Birim dönüştürücü (MODÜL 2)
 * Tüm hesaplar SI birimlerinde yapılır:
 *   debi: kg/s · basınç: Pa · uzunluk: m · sıcaklık: K · yoğunluk: kg/m³ · viskozite: Pa·s
 * Bağlama bağlı dönüşümler (hacimsel debi, cSt) için ctx = { rho } verilir.
 */
(function (VF) {
  'use strict';

  const GAL_US = 3.785411784e-3; // m³

  const DIMS = {
    flow: {
      label: 'Debi',
      units: {
        'm3/h': { label: 'm³/h', toSI: (v, c) => v * c.rho / 3600, fromSI: (v, c) => v * 3600 / c.rho },
        'LPM':  { label: 'L/min', toSI: (v, c) => v * c.rho / 60000, fromSI: (v, c) => v * 60000 / c.rho },
        'GPM':  { label: 'GPM (US)', toSI: (v, c) => v * GAL_US * c.rho / 60, fromSI: (v, c) => v * 60 / (GAL_US * c.rho) },
        'kg/s': { label: 'kg/s', toSI: v => v, fromSI: v => v },
        'kg/h': { label: 'kg/h', toSI: v => v / 3600, fromSI: v => v * 3600 }
      }
    },
    pressure: {
      label: 'Basınç',
      units: {
        'mbar':  { label: 'mbar', f: 100 },
        'bar':   { label: 'bar', f: 1e5 },
        'Pa':    { label: 'Pa', f: 1 },
        'kPa':   { label: 'kPa', f: 1e3 },
        'psi':   { label: 'psi', f: 6894.757293168 },
        'mmH2O': { label: 'mmH₂O', f: 9.80665 }
      }
    },
    length: {
      label: 'Boyut',
      units: {
        'mm':   { label: 'mm', f: 1e-3 },
        'cm':   { label: 'cm', f: 1e-2 },
        'inch': { label: 'inch', f: 0.0254 },
        'm':    { label: 'm', f: 1 }
      }
    },
    temperature: {
      label: 'Sıcaklık',
      units: {
        'C': { label: '°C', toSI: v => v + 273.15, fromSI: v => v - 273.15 },
        'K': { label: 'K', toSI: v => v, fromSI: v => v },
        'F': { label: '°F', toSI: v => (v - 32) * 5 / 9 + 273.15, fromSI: v => (v - 273.15) * 9 / 5 + 32 }
      }
    },
    density: {
      label: 'Yoğunluk',
      units: {
        'kg/m3': { label: 'kg/m³', f: 1 },
        'g/cm3': { label: 'g/cm³', f: 1000 }
      }
    },
    viscosity: {
      label: 'Viskozite',
      units: {
        'cP':   { label: 'cP', f: 1e-3 },
        'Pa.s': { label: 'Pa·s', f: 1 },
        'cSt':  { label: 'cSt', toSI: (v, c) => v * 1e-6 * c.rho, fromSI: (v, c) => v / (1e-6 * c.rho) }
      }
    },
    angle: { label: 'Açı', units: { 'deg': { label: '°', f: 1 } } },
    percent: { label: '%', units: { '%': { label: '%', f: 1 } } },
    none: { label: '', units: { '-': { label: '', f: 1 } } }
  };

  function unitDef(dim, unit) {
    const d = DIMS[dim];
    if (!d) throw new Error('Bilinmeyen boyut: ' + dim);
    const u = d.units[unit];
    if (!u) throw new Error('Bilinmeyen birim: ' + dim + '/' + unit);
    return u;
  }

  function toSI(dim, value, unit, ctx) {
    const u = unitDef(dim, unit);
    if (u.toSI) return u.toSI(value, ctx || {});
    return value * u.f;
  }

  function fromSI(dim, value, unit, ctx) {
    const u = unitDef(dim, unit);
    if (u.fromSI) return u.fromSI(value, ctx || {});
    return value / u.f;
  }

  function convert(dim, value, from, to, ctx) {
    return fromSI(dim, toSI(dim, value, from, ctx), to, ctx);
  }

  function label(dim, unit) {
    return unitDef(dim, unit).label;
  }

  function units(dim) {
    return Object.keys(DIMS[dim].units);
  }

  /** Mühendislik gösterimi: anlamlı basamak sayısına göre yuvarlar. */
  function fmt(v, sig) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    sig = sig || 4;
    if (v === 0) return '0';
    const a = Math.abs(v);
    if (a >= 1e7 || a < 1e-4) return v.toExponential(sig - 1);
    const dec = Math.max(0, sig - 1 - Math.floor(Math.log10(a)));
    return v.toFixed(Math.min(dec, 8));
  }

  VF.Units = { DIMS, toSI, fromSI, convert, label, units, fmt };
})(window.VF = window.VF || {});
