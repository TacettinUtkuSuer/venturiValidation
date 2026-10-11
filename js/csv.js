/* VenturiFlow Master — Akıllı CSV içe aktarma (MODÜL 3)
 * Ayırıcı / ondalık biçimi otomatik algılanır, kullanıcı sütun ↔ büyüklük ↔ birim eşleştirmesi yapar.
 */
(function (VF) {
  'use strict';
  const U = VF.Units;

  function detectDelimiter(text) {
    const lines = text.split(/\r?\n/).filter(l => l.trim()).slice(0, 10);
    const cands = [';', '\t', ',', '|'];
    let best = ',', bestScore = -1;
    for (const c of cands) {
      const counts = lines.map(l => splitLine(l, c).length);
      const min = Math.min(...counts);
      const consistent = counts.every(n => n === counts[0]);
      const score = (consistent ? 1000 : 0) + min;
      if (min > 1 && score > bestScore) { best = c; bestScore = score; }
    }
    return best;
  }

  function splitLine(line, delim) {
    const out = [];
    let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q;
      } else if (ch === delim && !q) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out.map(s => s.trim());
  }

  /** "1.234,5" / "1,234.5" / "12,5" / "1e-3" → sayı */
  function parseNum(s) {
    if (s === undefined || s === null) return NaN;
    s = String(s).trim().replace(/\s/g, '');
    if (!s) return NaN;
    const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
    if (lc > -1 && ld > -1) {
      s = lc > ld ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    } else if (lc > -1) {
      s = s.replace(',', '.');
    }
    const v = Number(s);
    return isFinite(v) ? v : NaN;
  }

  function parse(text) {
    text = text.replace(/^﻿/, '');
    const delim = detectDelimiter(text);
    const rows = text.split(/\r?\n/).filter(l => l.trim()).map(l => splitLine(l, delim));
    const first = rows[0] || [];
    const hasHeader = first.some(c => c && isNaN(parseNum(c)));
    const header = hasHeader ? first : first.map((_, i) => 'Sütun ' + (i + 1));
    return { delim, hasHeader, header, rows: hasHeader ? rows.slice(1) : rows };
  }

  // İçe aktarma hedefleri
  const TARGETS = {
    fluid: [
      { key: 'T', name: 'Sıcaklık', dim: 'temperature', req: true, re: /sıcak|sicak|temp|^t$|^t[ _(\[]|°/i },
      { key: 'rho', name: 'Yoğunluk', dim: 'density', req: true, re: /yoğun|yogun|dens|rho|ρ/i },
      { key: 'mu', name: 'Viskozite', dim: 'viscosity', req: true, re: /visk|visc|^mu|μ|cp\b|cst/i },
      { key: 'pv', name: 'Buhar basıncı', dim: 'pressure', req: false, re: /buhar|vap|^pv|p_v|psat/i }
    ],
    measure: [
      { key: 'q', name: 'Debi', dim: 'flow', req: true, re: /debi|flow|^q|m3|m³|lpm|gpm|kg\/[sh]/i },
      { key: 'dp', name: 'Fark basınç ΔP', dim: 'pressure', req: true, re: /fark|^dp|Δp|delta|diff|dpt/i },
      { key: 'T', name: 'Sıcaklık (ops.)', dim: 'temperature', req: false, re: /sıcak|sicak|temp|^t$|^t[ _(\[]/i },
      { key: 'rho', name: 'Yoğunluk (ops.)', dim: 'density', req: false, re: /yoğun|yogun|dens|rho|ρ/i },
      { key: 'p1', name: 'Giriş basıncı P1, mutlak (ops., gaz)', dim: 'pressure', req: false, re: /^p1\b|^p_1|giriş bas|giris bas|inlet|upstream/i }
    ]
  };

  const UNIT_HINTS = [
    [/m3\/h|m³\/h|m3h/i, 'm3/h'], [/lpm|l\/min/i, 'LPM'], [/gpm/i, 'GPM'], [/kg\/s/i, 'kg/s'], [/kg\/h/i, 'kg/h'],
    [/mbar/i, 'mbar'], [/kpa/i, 'kPa'], [/psi/i, 'psi'], [/mmh2o|mmsu|mmwc/i, 'mmH2O'], [/(^|[^a-z])bar([^a-z]|$)/i, 'bar'], [/(^|[^a-z])pa([^a-z.·]|$)/i, 'Pa'],
    [/°f|degf|[(\[]f[)\]]/i, 'F'], [/[(\[]k[)\]]|kelvin|^k$/i, 'K'], [/°c|degc|[(\[]c[)\]]/i, 'C'],
    [/g\/cm/i, 'g/cm3'], [/kg\/m/i, 'kg/m3'],
    [/cst/i, 'cSt'], [/mpa\.?s|mpa·s|\bcp\b/i, 'cP'], [/pa\.?s|pa·s/i, 'Pa.s']
  ];

  function guessUnit(dim, header) {
    const allowed = U.units(dim);
    for (const [re, u] of UNIT_HINTS) if (re.test(header) && allowed.includes(u)) return u;
    return { flow: 'm3/h', pressure: 'mbar', temperature: 'C', density: 'kg/m3', viscosity: 'cP' }[dim];
  }

  function guessColumn(target, header, used) {
    for (let i = 0; i < header.length; i++) if (!used.has(i) && target.re.test(header[i])) return i;
    return -1;
  }

  /**
   * Eşleştirme arayüzünü açar.
   * opts: { mode:'fluid'|'measure', ctx:{rho}, onDone(result) }
   */
  function openMapping(text, fileName, opts) {
    const P = parse(text);
    let mode = opts.mode || 'fluid';
    const body = document.createElement('div');
    body.className = 'csv-map';

    function render() {
      const targets = TARGETS[mode];
      const used = new Set();
      const guess = targets.map(t => { const c = guessColumn(t, P.header, used); if (c >= 0) used.add(c); return c; });
      const preview = P.rows.slice(0, 6);
      body.innerHTML = `
        <div class="csv-meta">
          <span><b>Dosya:</b> ${esc(fileName)}</span>
          <span><b>Ayırıcı:</b> ${P.delim === '\t' ? 'TAB' : esc(P.delim)}</span>
          <span><b>Satır:</b> ${P.rows.length}</span>
          <span><b>Başlık:</b> ${P.hasHeader ? 'Var' : 'Yok'}</span>
        </div>
        <div class="seg csv-mode">
          <button data-mode="fluid" class="${mode === 'fluid' ? 'on' : ''}">Akışkan Özellik Tablosu</button>
          <button data-mode="measure" class="${mode === 'measure' ? 'on' : ''}">Ölçüm Verisi (Debi–ΔP)</button>
        </div>
        <div class="csv-preview"><table><thead><tr>${P.header.map((h, i) => `<th>${i + 1}. ${esc(h)}</th>`).join('')}</tr></thead>
          <tbody>${preview.map(r => `<tr>${P.header.map((_, i) => `<td>${esc(r[i] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
        <table class="csv-targets">
          <thead><tr><th>Büyüklük</th><th>CSV sütunu</th><th>Birim</th></tr></thead>
          <tbody>${targets.map((t, ti) => `
            <tr>
              <td>${t.name}${t.req ? ' <span class="req">*</span>' : ''}</td>
              <td><select data-col="${t.key}">
                <option value="-1">— yok —</option>
                ${P.header.map((h, i) => `<option value="${i}" ${guess[ti] === i ? 'selected' : ''}>${i + 1}. ${esc(h)}</option>`).join('')}
              </select></td>
              <td><select data-unit="${t.key}">
                ${U.units(t.dim).map(u => `<option value="${u}" ${guessUnit(t.dim, guess[ti] >= 0 ? P.header[guess[ti]] : '') === u ? 'selected' : ''}>${U.label(t.dim, u)}</option>`).join('')}
              </select></td>
            </tr>`).join('')}
          </tbody>
        </table>
        ${mode === 'fluid' ? `<label class="row"><span>Akışkan adı</span><input type="text" data-name value="${esc(fileName.replace(/\.[^.]+$/, ''))}"></label>
        <label class="row"><span>Akışkan tipi</span><select data-ftype><option value="liquid">Sıvı</option><option value="gas">Gaz</option></select></label>` : ''}
        <div class="csv-err"></div>`;
      body.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { mode = b.dataset.mode; render(); });
      body.querySelectorAll('[data-col]').forEach(s => s.onchange = () => {
        const t = targets.find(x => x.key === s.dataset.col);
        const i = +s.value;
        if (i >= 0) body.querySelector(`[data-unit="${t.key}"]`).value = guessUnit(t.dim, P.header[i]);
      });
    }

    function collect() {
      const targets = TARGETS[mode];
      const map = {};
      for (const t of targets) {
        map[t.key] = { col: +body.querySelector(`[data-col="${t.key}"]`).value, unit: body.querySelector(`[data-unit="${t.key}"]`).value, dim: t.dim };
        if (t.req && map[t.key].col < 0) throw new Error(`"${t.name}" için bir sütun seçmelisiniz (zorunlu).`);
      }
      const out = [];
      for (const r of P.rows) {
        const raw = {};
        for (const k in map) raw[k] = map[k].col >= 0 ? parseNum(r[map[k].col]) : NaN;
        if (targets.some(t => t.req && !isFinite(raw[t.key]))) continue;
        const row = {};
        if (mode === 'fluid') {
          row.T = U.toSI('temperature', raw.T, map.T.unit);
          row.rho = U.toSI('density', raw.rho, map.rho.unit);
          row.mu = U.toSI('viscosity', raw.mu, map.mu.unit, { rho: row.rho });
          row.pv = isFinite(raw.pv) ? U.toSI('pressure', raw.pv, map.pv.unit) : NaN;
        } else {
          row.qv = raw.q; row.qu = map.q.unit; // hacimsel birimler gösterimde güncel ρ ile çevrilir
          row.dp = U.toSI('pressure', raw.dp, map.dp.unit);
          row.T = isFinite(raw.T) ? U.toSI('temperature', raw.T, map.T.unit) : null;
          row.rho = isFinite(raw.rho) ? U.toSI('density', raw.rho, map.rho.unit) : null;
          row.p1 = isFinite(raw.p1) ? U.toSI('pressure', raw.p1, map.p1.unit) : null;
        }
        out.push(row);
      }
      if (!out.length) throw new Error('Geçerli sayısal satır bulunamadı. Sütun eşleştirmesini kontrol edin.');
      const res = { mode, rows: out, skipped: P.rows.length - out.length };
      if (mode === 'fluid') {
        res.name = body.querySelector('[data-name]').value.trim() || 'CSV Akışkanı';
        res.type = body.querySelector('[data-ftype]').value;
        res.rows.sort((a, b) => a.T - b.T);
      }
      return res;
    }

    render();
    VF.UI.modal({
      title: 'Akıllı CSV İçe Aktarma — Sütun Eşleştirme',
      body,
      wide: true,
      buttons: [
        { label: 'İptal' },
        { label: 'İçe Aktar', primary: true, action: () => {
          try { opts.onDone(collect()); return true; }
          catch (e) { body.querySelector('.csv-err').textContent = e.message; return false; }
        } }
      ]
    });
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  VF.CSV = { parse, parseNum, openMapping, esc };
})(window.VF = window.VF || {});
