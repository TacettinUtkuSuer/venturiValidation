/* VenturiFlow Master — Uygulama kontrolcüsü (durum, arayüz, hesap döngüsü) */
(function (VF) {
  'use strict';
  const U = VF.Units, P = VF.Physics, F = VF.Fluids;
  const $ = id => document.getElementById(id);
  const esc = s => VF.CSV.esc(s);
  const STORE_KEY = 'venturiflow.state.v1';

  /* ============================================================
   * Giriş alanı şeması — değerler {v, u} (girilen birimde) saklanır
   * ============================================================ */
  const INPUTS = {
    cd:     { label: 'Boşaltma katsayısı C<sub>d</sub>', dim: 'none', def: { v: 0.98, u: '-' }, group: 'fieldsBernoulli', min: 0.5, max: 1.05, step: 0.001 },
    ucd:    { label: 'C<sub>d</sub> belirsizliği', dim: 'percent', def: { v: 2.0, u: '%' }, group: 'fieldsBernoulli', min: 0, step: 0.1 },
    D:      { label: 'Boru iç çapı D', dim: 'length', def: { v: 102.26, u: 'mm' }, group: 'fieldsGeom', min: 0 },
    d:      { label: 'Boğaz çapı d', dim: 'length', def: { v: 61.36, u: 'mm' }, group: 'fieldsGeom', min: 0 },
    theta:  { label: 'Difüzör açısı φ (toplam)', dim: 'angle', def: { v: 7, u: 'deg' }, group: 'fieldsGeom', min: 3, max: 45, step: 0.5 },
    qMax:   { label: 'Maks. tasarım debisi', dim: 'flow', def: { v: 100, u: 'm3/h' }, group: 'fieldsProc', min: 0 },
    p1:     { label: 'Giriş basıncı p₁ (mutlak)', dim: 'pressure', def: { v: 3, u: 'bar' }, group: 'fieldsProc', min: 0 },
    T:      { label: 'Akışkan sıcaklığı T', dim: 'temperature', def: { v: 20, u: 'C' }, group: 'fieldsProc' },
    txAcc:  { label: 'Transmitter doğruluğu (% span)', dim: 'percent', def: { v: 0.075, u: '%' }, group: 'fieldsUnc', min: 0, step: 0.005 },
    txSpan: { label: 'Transmitter span (URV)', dim: 'pressure', def: { v: 500, u: 'mbar' }, group: 'fieldsUnc', min: 0 },
    tolD:   { label: 'D toleransı δD/D', dim: 'percent', def: { v: 0.25, u: '%' }, group: 'fieldsUnc', min: 0, step: 0.01 },
    told:   { label: 'd toleransı δd/d', dim: 'percent', def: { v: 0.05, u: '%' }, group: 'fieldsUnc', min: 0, step: 0.01 },
    uRho:   { label: 'Yoğunluk belirsizliği δρ/ρ', dim: 'percent', def: { v: 0.10, u: '%' }, group: 'fieldsUnc', min: 0, step: 0.01 }
  };

  const FLUID_FIELDS = {
    rho:   { label: 'Yoğunluk ρ', dim: 'density', unitKey: 'rho', req: true },
    mu:    { label: 'Dinamik viskozite μ', dim: 'viscosity', unitKey: 'mu', req: true },
    pv:    { label: 'Buhar basıncı p<sub>v</sub>', dim: 'pressure', unitKey: 'pv', only: 'liquid' },
    kappa: { label: 'İzentropik üs κ', dim: 'none', only: 'gas', req: true },
    M:     { label: 'Molar kütle M <span class="hint">(g/mol, ops.)</span>', dim: 'none', only: 'gas' },
    Z:     { label: 'Sıkıştırılabilirlik Z', dim: 'none', only: 'gas' }
  };

  const DISP_DIMS = ['flow', 'pressure', 'length', 'temperature', 'density', 'viscosity'];

  function defaults() {
    const inputs = {};
    for (const k in INPUTS) inputs[k] = { ...INPUTS[k].def };
    return {
      v: 1,
      theme: 'dark',
      tab: 'design',
      method: 'iso',
      mfg: 'machined',
      fitting: 'bend90',
      inputs,
      units: { flow: 'm3/h', pressure: 'mbar', length: 'mm', temperature: 'C', density: 'kg/m3', viscosity: 'cP' },
      fluidUnits: { rho: 'kg/m3', mu: 'cP', pv: 'kPa' },
      fluids: JSON.parse(JSON.stringify(F.BUILTIN)),
      activeFluid: 'water',
      measured: [],
      whatIf: 70,
      influx: {
        url: 'http://10.10.2.6:8086', db: 'db', user: '', pass: '', measurement: 'venturi', rate: 5,
        dp: { field: 'value', tagKey: 'sensor', tagValue: 'DPT-101', unit: 'mbar' },
        q: { enabled: false, field: 'value', tagKey: 'sensor', tagValue: 'FT-101', unit: 'm3/h' }
      }
    };
  }

  /** Derin birleştirme: eksik alanlar varsayılandan gelir (eski yedeklerle uyum) */
  function merge(base, over) {
    if (Array.isArray(base)) return Array.isArray(over) ? over : base;
    if (base && typeof base === 'object') {
      const out = { ...base };
      if (over && typeof over === 'object') for (const k in over) out[k] = k in base ? merge(base[k], over[k]) : over[k];
      return out;
    }
    return over === undefined || over === null ? base : over;
  }

  let state = defaults();
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) state = merge(defaults(), JSON.parse(raw));
  } catch (e) { console.warn('Kayıtlı durum okunamadı', e); }
  if (!state.fluids.length) state.fluids = JSON.parse(JSON.stringify(F.BUILTIN));
  if (!state.fluids.find(f => f.id === state.activeFluid)) state.activeFluid = state.fluids[0].id;

  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(state));
        $('stSave').textContent = '● Kaydedildi ' + new Date().toLocaleTimeString('tr-TR');
      } catch (e) {
        $('stSave').textContent = '⚠ Kaydedilemedi (localStorage kapalı)';
      }
    }, 300);
  }

  /* ============================================================
   * UI yardımcıları (modal, toast)
   * ============================================================ */
  const UI = {
    modal({ title, body, buttons, wide }) {
      const bg = document.createElement('div');
      bg.className = 'modal-bg';
      bg.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
        <div class="modal-h"><span></span><button class="btn icon sm x" aria-label="Kapat">✕</button></div>
        <div class="modal-b"></div><div class="modal-f"></div></div>`;
      bg.querySelector('.modal-h span').textContent = title;
      const b = bg.querySelector('.modal-b');
      if (typeof body === 'string') b.innerHTML = body; else b.appendChild(body);
      const close = () => { bg.remove(); document.removeEventListener('keydown', onKey); };
      const onKey = e => { if (e.key === 'Escape') close(); };
      document.addEventListener('keydown', onKey);
      bg.querySelector('.x').onclick = close;
      bg.addEventListener('mousedown', e => { if (e.target === bg) close(); });
      const f = bg.querySelector('.modal-f');
      (buttons || [{ label: 'Kapat', primary: true }]).forEach(btn => {
        const el = document.createElement('button');
        el.className = 'btn' + (btn.primary ? ' primary' : '');
        el.textContent = btn.label;
        el.onclick = () => { if (!btn.action || btn.action() !== false) close(); };
        f.appendChild(el);
      });
      document.body.appendChild(bg);
      return { close, el: bg };
    },
    toast(msg, kind) {
      const t = document.createElement('div');
      t.className = 'toast ' + (kind || '');
      t.textContent = msg;
      $('toasts').appendChild(t);
      setTimeout(() => t.remove(), 4200);
    }
  };
  VF.UI = UI;

  /* ============================================================
   * Hesap bağlamı
   * ============================================================ */
  function activeFluid() {
    return state.fluids.find(f => f.id === state.activeFluid) || state.fluids[0];
  }

  function si(key, ctx) {
    const def = INPUTS[key], val = state.inputs[key];
    return U.toSI(def.dim, Number(val.v), val.u, ctx);
  }

  /** Mevcut durumdan SI giriş seti ve akışkan özelliklerini üretir */
  function context() {
    const T = si('T'), p1 = si('p1');
    const fl = F.resolve(activeFluid(), T, p1);
    const ctx = { rho: fl.rho };
    const inp = {
      method: state.method, mfg: state.mfg, fitting: state.fitting,
      D: si('D'), d: si('d'), theta: si('theta'), p1, T,
      fluid: fl,
      cd: si('cd'), ucd: si('ucd'),
      txAcc: si('txAcc'), txSpan: si('txSpan'), tolD: si('tolD'), told: si('told'), uRho: si('uRho')
    };
    return { inp, ctx, qMax: si('qMax', ctx), fl };
  }

  function validate(c) {
    const e = [];
    const { inp, fl } = c;
    if (!(inp.D > 0)) e.push('Boru çapı D > 0 olmalı');
    if (!(inp.d > 0)) e.push('Boğaz çapı d > 0 olmalı');
    if (inp.d >= inp.D) e.push('d < D olmalı (β < 1)');
    if (!(fl.rho > 0)) e.push('Yoğunluk > 0 olmalı');
    if (!(fl.mu > 0)) e.push('Viskozite zorunludur (> 0)');
    if (!(inp.p1 > 0)) e.push('Mutlak giriş basıncı > 0 olmalı');
    if (!(inp.T > 0)) e.push('Sıcaklık mutlak sıfırın üzerinde olmalı');
    if (!(c.qMax > 0)) e.push('Maks. tasarım debisi > 0 olmalı');
    if (fl.type === 'gas' && !(fl.kappa > 1)) e.push('Gazlar için κ > 1 olmalı');
    if (inp.method === 'bernoulli' && !(inp.cd > 0)) e.push('C_d > 0 olmalı');
    return e;
  }

  // Gösterim biçimlendiricileri
  const D = {
    flow: (v, ctx) => U.fmt(U.fromSI('flow', v, state.units.flow, ctx), 4),
    p: v => U.fmt(U.fromSI('pressure', v, state.units.pressure), 4),
    len: v => U.fmt(U.fromSI('length', v, state.units.length), 4),
    fu: () => U.label('flow', state.units.flow),
    pu: () => U.label('pressure', state.units.pressure),
    lu: () => U.label('length', state.units.length)
  };

  /* ============================================================
   * Giriş alanlarının oluşturulması
   * ============================================================ */
  function unitSelect(dim, cur, attrs) {
    const us = U.units(dim);
    if (us.length === 1) return `<span class="unit-static">${U.label(dim, us[0]) || '–'}</span>`;
    return `<select ${attrs}>${us.map(u => `<option value="${u}" ${u === cur ? 'selected' : ''}>${U.label(dim, u)}</option>`).join('')}</select>`;
  }

  function buildInputs() {
    const groups = {};
    for (const k in INPUTS) {
      const d = INPUTS[k];
      (groups[d.group] = groups[d.group] || []).push(`
        <label class="row"><span>${d.label}</span>
          <div class="inp"><input type="number" step="${d.step || 'any'}" data-in="${k}" ${d.min !== undefined ? `min="${d.min}"` : ''} ${d.max !== undefined ? `max="${d.max}"` : ''}>
          ${unitSelect(d.dim, state.inputs[k].u, `data-inu="${k}"`)}</div></label>`);
    }
    for (const g in groups) $(g).innerHTML = groups[g].join('');

    document.querySelectorAll('[data-in]').forEach(el => {
      el.addEventListener('input', () => {
        const k = el.dataset.in, v = parseFloat(el.value);
        el.classList.toggle('invalid', !isFinite(v));
        if (!isFinite(v)) return;
        state.inputs[k].v = v;
        if (k === 'D' || k === 'd') syncBeta();
        if (k === 'D') syncPipe();
        recalc();
      });
    });
    document.querySelectorAll('[data-inu]').forEach(el => {
      el.addEventListener('change', () => {
        const k = el.dataset.inu, def = INPUTS[k];
        const ctx = context().ctx;
        const cur = state.inputs[k];
        cur.v = round(U.convert(def.dim, Number(cur.v), cur.u, el.value, ctx));
        cur.u = el.value;
        fillInputs();
        save();
      });
    });
  }

  const round = v => isFinite(v) ? Number(v.toPrecision(7)) : v;

  function fillInputs() {
    for (const k in INPUTS) {
      const el = document.querySelector(`[data-in="${k}"]`);
      if (el && document.activeElement !== el) el.value = state.inputs[k].v;
      const us = document.querySelector(`[data-inu="${k}"]`);
      if (us) us.value = state.inputs[k].u;
    }
    syncBeta();
  }

  function syncPipe() {
    const mm = si('D') * 1000;
    const opt = [...$('selPipe').options].find(o => o.value && Math.abs(parseFloat(o.value) - mm) < 0.01);
    $('selPipe').value = opt ? opt.value : '';
  }

  function syncBeta() {
    const b = si('d') / si('D');
    if (document.activeElement !== $('inpBeta')) $('inpBeta').value = isFinite(b) ? b.toFixed(4) : '';
  }

  function buildPipeLib() {
    $('selPipe').innerHTML = '<option value="">— Elle giriş —</option>' + F.PIPES.map(g =>
      `<optgroup label="${g.group}">${g.items.map(([n, mm]) => `<option value="${mm}">${n} — ID ${mm.toFixed(2)} mm</option>`).join('')}</optgroup>`).join('');
    $('selPipe').addEventListener('change', e => {
      const mm = parseFloat(e.target.value);
      if (!isFinite(mm)) return;
      const beta = si('d') / si('D');
      const u = state.inputs.D.u;
      state.inputs.D.v = round(U.fromSI('length', mm / 1000, u));
      // β korunarak boğaz çapı yeniden boyutlandırılır
      if (isFinite(beta) && beta > 0 && beta < 1) state.inputs.d.v = round(U.fromSI('length', beta * mm / 1000, state.inputs.d.u));
      fillInputs();
      recalc();
    });
    $('inpBeta').addEventListener('input', e => {
      const b = parseFloat(e.target.value);
      const ok = b > 0.05 && b < 0.95;
      e.target.classList.toggle('invalid', !ok);
      if (!ok) return;
      state.inputs.d.v = round(U.fromSI('length', b * si('D'), state.inputs.d.u));
      fillInputs();
      recalc();
    });
  }

  /* ============================================================
   * Akışkan sekmesi
   * ============================================================ */
  function buildFluidTab() {
    const sel = $('selFluid');
    sel.innerHTML = state.fluids.map(f => `<option value="${esc(f.id)}">${esc(f.name)} (${f.type === 'gas' ? 'Gaz' : 'Sıvı'})</option>`).join('');
    sel.value = state.activeFluid;
    const f = activeFluid();
    $('fName').value = f.name;
    $('fType').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === f.type));
    const hasTable = f.table && f.table.length;
    const ctx = { rho: f.rho };
    $('fluidFields').innerHTML = Object.entries(FLUID_FIELDS).filter(([, d]) => !d.only || d.only === f.type).map(([k, d]) => {
      const unit = d.unitKey ? state.fluidUnits[d.unitKey] : null;
      const val = d.unitKey ? U.fromSI(d.dim, f[k], unit, ctx) : f[k];
      const fromTable = hasTable && ['rho', 'mu', 'pv'].includes(k);
      const fromGas = k === 'rho' && f.type === 'gas' && f.M > 0;
      return `<label class="row"><span>${d.label}${d.req ? ' <span class="req">*</span>' : ''}</span>
        <div class="inp"><input type="number" step="any" data-fl="${k}" value="${fromTable || fromGas || !isFinite(val) ? '' : round(val)}" placeholder="${fromGas ? 'ρ = p₁M/ZRT' : fromTable ? 'tablodan T\'ye göre' : ''}" ${fromTable || fromGas ? 'disabled title="' + (fromGas ? 'İdeal gaz denkleminden hesaplanıyor' : 'Tablodan interpole ediliyor') + '"' : ''}>
        ${d.unitKey ? unitSelect(d.dim, unit, `data-flu="${d.unitKey}"`) : '<span class="unit-static">–</span>'}</div></label>`;
    }).join('');

    $('fluidFields').querySelectorAll('[data-fl]').forEach(el => el.addEventListener('input', () => {
      const k = el.dataset.fl, d = FLUID_FIELDS[k], v = parseFloat(el.value);
      const bad = !isFinite(v) || (d.req && v <= 0);
      el.classList.toggle('invalid', bad);
      if (!isFinite(v)) return;
      const fl = activeFluid();
      fl[k] = d.unitKey ? U.toSI(d.dim, v, state.fluidUnits[d.unitKey], { rho: fl.rho }) : v;
      if (k === 'M') buildFluidTab();
      recalc();
    }));
    $('fluidFields').querySelectorAll('[data-flu]').forEach(el => el.addEventListener('change', () => {
      state.fluidUnits[el.dataset.flu] = el.value;
      buildFluidTab(); save();
    }));

    const ti = $('fluidTableInfo');
    if (hasTable) {
      const tb = f.table;
      ti.innerHTML = `📈 Özellik tablosu: <b>${tb.length}</b> nokta (${U.fmt(U.fromSI('temperature', tb[0].T, state.units.temperature), 3)} … ${U.fmt(U.fromSI('temperature', tb[tb.length - 1].T, state.units.temperature), 3)} ${U.label('temperature', state.units.temperature)}), ρ/μ/p<sub>v</sub> T'ye göre interpole edilir.
        <a href="#" id="lnkTblView">Görüntüle</a> · <a href="#" id="lnkTblDel">Tabloyu kaldır</a>`;
      $('lnkTblView').onclick = e => { e.preventDefault(); showTable(f); };
      $('lnkTblDel').onclick = e => {
        e.preventDefault();
        const r = F.resolve(f, si('T'), si('p1'));
        f.rho = r.rho; f.mu = r.mu; f.pv = r.pv; f.table = null;
        buildFluidTab(); recalc(); UI.toast('Tablo kaldırıldı; mevcut T değerindeki özellikler sabit değer olarak atandı.', 'ok');
      };
    } else {
      ti.innerHTML = f.type === 'gas' ? 'Gazlarda M girilirse yoğunluk p₁ ve T\'den ideal gaz denklemiyle (ρ = p₁M/ZRT) hesaplanır.' : 'Sabit özellikler kullanılıyor. Sıcaklığa bağlı tablo için CSV içe aktarın.';
    }
    $('btnFluidDel').disabled = state.fluids.length <= 1;
    $('pillFluid').textContent = f.name;
  }

  function showTable(f) {
    const tu = state.units.temperature, ru = state.fluidUnits.rho, mu = state.fluidUnits.mu, pu = state.fluidUnits.pv;
    UI.modal({
      title: f.name + ' — Özellik Tablosu',
      body: `<table class="grid"><thead><tr><th>T [${U.label('temperature', tu)}]</th><th>ρ [${U.label('density', ru)}]</th><th>μ [${U.label('viscosity', mu)}]</th><th>p<sub>v</sub> [${U.label('pressure', pu)}]</th></tr></thead><tbody>
        ${f.table.map(r => `<tr><td class="n">${U.fmt(U.fromSI('temperature', r.T, tu), 4)}</td><td class="n">${U.fmt(U.fromSI('density', r.rho, ru), 5)}</td><td class="n">${U.fmt(U.fromSI('viscosity', r.mu, mu, { rho: r.rho }), 4)}</td><td class="n">${isFinite(r.pv) ? U.fmt(U.fromSI('pressure', r.pv, pu), 4) : '—'}</td></tr>`).join('')}
        </tbody></table>`
    });
  }

  function bindFluidTab() {
    $('selFluid').addEventListener('change', e => { state.activeFluid = e.target.value; buildFluidTab(); recalc(); });
    $('fName').addEventListener('input', e => {
      activeFluid().name = e.target.value || 'Adsız';
      const o = $('selFluid').selectedOptions[0];
      if (o) o.textContent = `${activeFluid().name} (${activeFluid().type === 'gas' ? 'Gaz' : 'Sıvı'})`;
      $('pillFluid').textContent = activeFluid().name;
      save();
    });
    $('fType').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      const f = activeFluid();
      f.type = b.dataset.v;
      if (f.type === 'gas' && !(f.kappa > 1)) f.kappa = 1.4;
      buildFluidTab(); recalc();
    });
    $('btnFluidNew').onclick = () => {
      const f = { id: F.uid(), name: 'Yeni Akışkan', type: 'liquid', rho: 1000, mu: 1e-3, pv: 2339, kappa: 1.4, M: 0, Z: 1, table: null };
      state.fluids.push(f); state.activeFluid = f.id; buildFluidTab(); recalc();
      $('fName').focus(); $('fName').select();
    };
    $('btnFluidDup').onclick = () => {
      const f = JSON.parse(JSON.stringify(activeFluid()));
      f.id = F.uid(); f.name += ' (kopya)'; delete f.builtin;
      state.fluids.push(f); state.activeFluid = f.id; buildFluidTab(); recalc();
    };
    $('btnFluidDel').onclick = () => {
      if (state.fluids.length <= 1) return;
      const f = activeFluid();
      if (!confirm(`"${f.name}" silinsin mi?`)) return;
      state.fluids = state.fluids.filter(x => x.id !== f.id);
      state.activeFluid = state.fluids[0].id; buildFluidTab(); recalc();
    };
    $('btnCsv').onclick = () => $('fileCsv').click();
    $('fileCsv').addEventListener('change', async e => {
      const file = e.target.files[0]; e.target.value = '';
      if (!file) return;
      const text = await file.text();
      VF.CSV.openMapping(text, file.name, {
        mode: /ölçüm|olcum|meas|test|log/i.test(file.name) ? 'measure' : 'fluid',
        onDone: res => {
          if (res.mode === 'fluid') {
            const r0 = res.rows[0];
            const f = { id: F.uid(), name: res.name, type: res.type, rho: r0.rho, mu: r0.mu, pv: isFinite(r0.pv) ? r0.pv : 0, kappa: 1.4, M: 0, Z: 1, table: res.rows };
            state.fluids.push(f); state.activeFluid = f.id;
            buildFluidTab();
            UI.toast(`"${f.name}" eklendi: ${res.rows.length} satır${res.skipped ? `, ${res.skipped} satır atlandı` : ''}.`, 'ok');
          } else {
            state.measured = res.rows;
            UI.toast(`${res.rows.length} ölçüm noktası grafiğe eklendi${res.skipped ? ` (${res.skipped} satır atlandı)` : ''}.`, 'ok');
          }
          recalc();
        }
      });
    });
  }

  function renderResolved(c) {
    const fl = c.fl, ctx = c.ctx;
    const src = k => fl.source[k] ? `<span class="src">(${fl.source[k]})</span>` : '';
    const rows = [
      ['Yoğunluk ρ', U.fmt(U.fromSI('density', fl.rho, state.units.density), 5) + ' ' + U.label('density', state.units.density), src('rho')],
      ['Viskozite μ', U.fmt(U.fromSI('viscosity', fl.mu, state.units.viscosity, ctx), 4) + ' ' + U.label('viscosity', state.units.viscosity), src('mu')],
      ['Kinematik viskozite ν', U.fmt(fl.mu / fl.rho * 1e6, 4) + ' cSt', '']
    ];
    if (fl.type === 'liquid') rows.push(['Buhar basıncı p_v', U.fmt(U.fromSI('pressure', fl.pv, state.units.pressure), 4) + ' ' + D.pu(), src('pv')]);
    else rows.push(['İzentropik üs κ', fl.kappa.toFixed(3), '']);
    $('fResolved').innerHTML = `<table>${rows.map(r => `<tr><td>${r[0]} ${r[2]}</td><td>${r[1]}</td></tr>`).join('')}</table>` +
      (fl.outOfTable ? '<div class="note warn">⚠ T, tablo aralığı dışında — uç değer kullanılıyor.</div>' : '');
    $('fCond').textContent = `T = ${U.fmt(U.fromSI('temperature', c.inp.T, state.units.temperature), 4)} ${U.label('temperature', state.units.temperature)} · p₁ = ${D.p(c.inp.p1)} ${D.pu()}`;
    $('measInfo').innerHTML = state.measured.length
      ? `Ölçüm verisi: <b>${state.measured.length}</b> nokta grafikte gösteriliyor. <a href="#" id="lnkMeasClr">Temizle</a>`
      : 'Ölçüm verisi yüklenmedi.';
    const l = $('lnkMeasClr');
    if (l) l.onclick = e => { e.preventDefault(); state.measured = []; recalc(); };
  }

  /* ============================================================
   * Birimler sekmesi
   * ============================================================ */
  function buildUnitsTab() {
    $('dispUnits').innerHTML = DISP_DIMS.map(dim => `<label class="row"><span>${U.DIMS[dim].label}</span>
      <select data-disp="${dim}">${U.units(dim).map(u => `<option value="${u}" ${state.units[dim] === u ? 'selected' : ''}>${U.label(dim, u)}</option>`).join('')}</select></label>`).join('');
    $('dispUnits').querySelectorAll('[data-disp]').forEach(el => el.addEventListener('change', () => {
      state.units[el.dataset.disp] = el.value; buildFluidTab(); recalc(); liveRender();
    }));
    $('cvDim').innerHTML = DISP_DIMS.map(d => `<option value="${d}">${U.DIMS[d].label}</option>`).join('');
    const fillFrom = () => { const d = $('cvDim').value; $('cvFrom').innerHTML = U.units(d).map(u => `<option value="${u}">${U.label(d, u)}</option>`).join(''); };
    fillFrom();
    $('cvDim').onchange = () => { fillFrom(); convRender(); };
    $('cvFrom').onchange = convRender;
    $('cvVal').oninput = convRender;
    convRender();
  }

  function convRender() {
    const dim = $('cvDim').value, from = $('cvFrom').value, v = parseFloat($('cvVal').value);
    const ctx = context().ctx;
    $('cvOut').innerHTML = isFinite(v) ? U.units(dim).map(u => `<tr><td>${U.label(dim, u)}</td><td>${U.fmt(U.convert(dim, v, from, u, ctx), 6)}</td></tr>`).join('') : '';
    $('cvNote').textContent = (dim === 'flow' || dim === 'viscosity')
      ? `Hacimsel ↔ kütlesel / cSt dönüşümleri aktif akışkanın yoğunluğunu kullanır: ρ = ${U.fmt(ctx.rho, 5)} kg/m³ (${activeFluid().name}).` : '';
  }

  /* ============================================================
   * Ana hesap ve görüntüleme
   * ============================================================ */
  let lastCalc = null;
  let rafPending = false;
  function recalc() {
    save();
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => { rafPending = false; doCalc(); });
  }

  function doCalc() {
    const t0 = performance.now();
    const c = context();
    renderResolved(c);
    $('rowMfg').style.display = state.method === 'bernoulli' ? 'none' : '';
    $('fieldsBernoulli').style.display = state.method === 'bernoulli' ? '' : 'none';
    $('pillStd').textContent = P.STANDARDS[state.method].short + (state.method !== 'bernoulli' ? ' · ' + P.TYPES[state.mfg].name.split(' (')[0] : '');

    const errs = validate(c);
    $('errBanner').textContent = errs.length ? '⚠ ' + errs.join(' · ') : '';
    $('errBanner').classList.toggle('show', errs.length > 0);
    if (errs.length) { $('stCalc').textContent = 'Giriş hatası — hesap durduruldu'; return; }

    const qOp = c.qMax * state.whatIf / 100;
    const res = P.analyze(c.inp, qOp);
    const resMax = P.analyze(c.inp, c.qMax);
    lastCalc = { c, res, resMax, qOp };

    renderKpis(res, resMax, c);
    renderDrawing(res, c);
    renderChart(res, resMax, c);
    renderFormulas(res, c);
    renderUncertainty(res);
    renderChecks(res);
    renderStraight(res, c);
    liveRecompute();
    $('stCalc').textContent = `Hesap ${(performance.now() - t0).toFixed(1)} ms · ${P.STANDARDS[state.method].name}`;
  }

  function kpi(k, v, unit, s, cls) {
    return `<div class="kpi ${cls || ''}"><div class="k">${k}</div><div class="v">${v}${unit ? `<small>${unit}</small>` : ''}</div><div class="s">${s || ''}</div></div>`;
  }

  function renderKpis(r, rm, c) {
    const ctx = c.ctx;
    let last;
    if (r.cav) {
      const lv = r.cav.level;
      last = kpi('Kavitasyon', lv === 'bad' ? 'VAR!' : lv === 'warn' ? 'YÜKSEK' : 'Düşük', '',
        `σ = ${U.fmt(r.cav.sigma, 3)} · başlangıç ≈ ${D.flow(r.cav.qmCav, ctx)} ${D.fu()}`, lv === 'bad' ? 'bad' : lv === 'warn' ? 'warn' : 'ok');
    } else {
      const g = r.gas;
      last = kpi('Genleşme Y (ε)', isFinite(r.eps) ? r.eps.toFixed(4) : '—', '',
        `τ = ${isFinite(r.tau) ? r.tau.toFixed(3) : '—'} · τ≥0,75 sınırı ${D.flow(g.qmTau, ctx)} ${D.fu()}`, g.level === 'ok' ? 'ok' : g.level === 'warn' ? 'warn' : 'bad');
    }
    const flowS = `${U.fmt(r.qm, 4)} kg/s · v₂ = ${U.fmt(r.v2, 3)} m/s`;
    $('kpis').innerHTML = [
      kpi('Çap Oranı β', r.beta.toFixed(4), '', `C = ${r.C.toFixed(3)} · E = ${r.E.toFixed(4)}`, 'accent'),
      kpi('Debi (What-If)', D.flow(r.qm, ctx), D.fu(), flowS, 'accent'),
      kpi('Fark Basınç ΔP', D.p(r.dp), D.pu(), `Maks.: ${D.p(rm.dp)} ${D.pu()}`, 'accent'),
      kpi('Reynolds Re<sub>D</sub>', isFinite(r.Re) ? r.Re.toExponential(2) : '—', '', r.Re > 4000 ? 'Türbülanslı akış' : 'Laminer / geçiş!', r.Re < 4000 ? 'warn' : ''),
      kpi('Belirsizlik', '±%' + (isFinite(r.unc.total) ? r.unc.total.toFixed(2) : '—'), '', `C ±%${r.model.uC} · ΔP ±%${U.fmt(r.unc.parts[4].u, 2)}`, 'hl'),
      kpi('Kalıcı Kayıp', D.p(r.loss), D.pu(), `ΔP'nin %${U.fmt(r.lossFrac * 100, 3)}'i · φ ${c.inp.theta}°`, 'hl'),
      kpi('Geri Kazanım', D.p(r.recovered), D.pu(), `ΔP'nin %${U.fmt((1 - r.lossFrac) * 100, 3)}'i geri kazanılır`, 'hl'),
      last
    ].join('');
  }

  function renderDrawing(r, c) {
    const box = $('drawing');
    const w = Math.max(400, box.clientWidth), h = Math.max(160, box.clientHeight);
    box.innerHTML = VF.Draw.venturiSVG({
      D: c.inp.D, d: c.inp.d, theta: c.inp.theta, width: w, height: h,
      theme: state.theme, fmtLen: v => D.len(v) + ' ' + D.lu(),
      profile: { p1: c.inp.p1, dp: r.dp, loss: r.loss, fmtP: v => D.p(v) + ' ' + D.pu() }
    });
    const g = P.geometry(c.inp.D, c.inp.d, c.inp.theta);
    $('drawTag').textContent = `D ${D.len(c.inp.D)} · d ${D.len(c.inp.d)} ${D.lu()} · β ${r.beta.toFixed(3)} · L ≈ ${D.len(g.Lc + g.Lt + g.Ld)} ${D.lu()}`;
  }

  function curveData(r, rm, c) {
    const ctx = c.ctx, m = rm.model;
    const qTop = c.qMax * 1.25;
    const N = 80;
    const curve = [], hi = [], lo = [];
    for (let i = 0; i <= N; i++) {
      const q = qTop * i / N;
      const dp = m.dpFromFlow(q);
      if (!isFinite(dp)) break;
      const x = U.fromSI('flow', q, state.units.flow, ctx), y = U.fromSI('pressure', dp, state.units.pressure);
      curve.push({ x, y });
      if (i > 0) {
        const u = P.uncertainty(m, c.inp, dp).total / 100;
        hi.push({ x: x * (1 + u), y }); lo.push({ x: x * (1 - u), y });
      } else { hi.push({ x: 0, y: 0 }); lo.push({ x: 0, y: 0 }); }
    }
    const fx = q => U.fromSI('flow', q, state.units.flow, ctx);
    const fy = p => U.fromSI('pressure', p, state.units.pressure);
    const limits = [{ x: fx(c.qMax), label: 'Tasarım maks.', colorKey: 'text' }];
    if (r.cav && r.cav.qmCav > 0) limits.push({ x: fx(r.cav.qmCav), label: 'Kavitasyon başlangıcı', colorKey: 'bad' });
    if (r.gas && r.gas.qmTau > 0) limits.push({ x: fx(r.gas.qmTau), label: 'τ = 0,75 sınırı', colorKey: 'warn' });
    const yMaxData = Math.max(...curve.map(p => p.y), ...state.measured.map(p => fy(p.dp)));
    return {
      curve, bandHi: hi, bandLo: lo,
      measured: state.measured.map(p => ({ x: fx(measQ(p, ctx)), y: fy(p.dp) })),
      whatIf: { x: fx(r.qm), y: fy(r.dp) },
      limits,
      xMax: niceMax(Math.max(fx(qTop), ...state.measured.map(p => fx(measQ(p, ctx))))),
      yMax: niceMax(yMaxData * 1.05),
      xLabel: `Debi [${D.fu()}]`, yLabel: `ΔP [${D.pu()}]`, xUnit: D.fu(), yUnit: D.pu(),
      live: live.point, trail: live.trail
    };
  }

  const measQ = (p, ctx) => p.qu ? U.toSI('flow', p.qv, p.qu, ctx) : p.q;

  function niceMax(v) {
    if (!(v > 0) || !isFinite(v)) return 1;
    const e = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / e;
    return (n <= 1 ? 1 : n <= 1.2 ? 1.2 : n <= 1.5 ? 1.5 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 3 ? 3 : n <= 4 ? 4 : n <= 5 ? 5 : n <= 6 ? 6 : n <= 8 ? 8 : 10) * e;
  }

  function renderChart(r, rm, c) {
    VF.ChartView.update(curveData(r, rm, c));
    $('outWhatIf').textContent = `${state.whatIf.toFixed(1)}% · ${D.flow(r.qm, c.ctx)} ${D.fu()} → ΔP ${D.p(r.dp)} ${D.pu()}`;
  }

  /* ---------- Canlı formül paneli (MathJax) ---------- */
  const n = (v, s) => {
    if (!isFinite(v)) return '\\text{—}';
    const t = U.fmt(v, s || 4);
    return t.includes('e') ? t.replace(/e([+-]?)(\d+)/, (m, sg, ex) => `\\times10^{${sg === '-' ? '-' : ''}${+ex}}`) : t;
  };

  function formulaList(r, c) {
    const m = r.model, inp = c.inp, fl = c.fl;
    const L = [];
    const std = P.STANDARDS[inp.method];
    L.push({ t: 'Çap oranı ve hız yaklaşım faktörü', tex: `\\beta = \\frac{d}{D} = \\frac{${n(inp.d * 1000)}}{${n(inp.D * 1000)}} = ${n(r.beta)}, \\quad E = \\frac{1}{\\sqrt{1-\\beta^4}} = ${n(r.E)}` });
    L.push({ t: inp.method === 'bernoulli' ? 'Bernoulli + süreklilik (C_d düzeltmeli)' : `${std.short} — kütlesel debi denklemi`,
      tex: `q_m = \\frac{C\\,\\varepsilon}{\\sqrt{1-\\beta^4}}\\,\\frac{\\pi}{4}\\,d^2\\sqrt{2\\,\\Delta p\\,\\rho_1}` });
    L.push({ t: 'Çalışma noktasında yerine konmuş değerler', tex: `q_m = \\frac{${n(r.C, 4)}\\cdot${n(r.eps, 5)}}{\\sqrt{1-${n(r.beta, 4)}^4}}\\cdot\\frac{\\pi}{4}(${n(inp.d, 4)})^2\\sqrt{2\\cdot${n(r.dp, 5)}\\cdot${n(fl.rho, 5)}} = ${n(r.qm, 4)}\\ \\mathrm{kg/s}` });
    L.push({ t: 'Boşaltma katsayısı', tex: inp.method === 'bernoulli' ? `C = C_d = ${n(r.C, 4)}\\quad(\\pm${n(m.uC, 3)}\\%)` : `C = ${n(r.C, 4)}\\quad(\\text{${P.TYPES[inp.mfg].name.split(' (')[0]}},\\ \\pm${m.uC}\\%)` });
    if (m.isGas) {
      L.push({ t: 'Genleşme faktörü (ISO 5167-4 Denk. 2)', tex: `\\varepsilon = \\sqrt{\\left(\\frac{\\kappa\\tau^{2/\\kappa}}{\\kappa-1}\\right)\\left(\\frac{1-\\beta^4}{1-\\beta^4\\tau^{2/\\kappa}}\\right)\\left(\\frac{1-\\tau^{(\\kappa-1)/\\kappa}}{1-\\tau}\\right)}` });
      L.push({ t: 'Değerler', tex: `\\tau = \\frac{p_2}{p_1} = ${n(r.tau, 4)},\\ \\kappa = ${n(fl.kappa, 3)} \\Rightarrow \\varepsilon = ${n(r.eps, 5)}` });
    } else {
      L.push({ t: 'Sıkıştırılamaz akışkan & kavitasyon', tex: `\\varepsilon = 1,\\quad \\sigma = \\frac{p_2 - p_v}{\\tfrac12\\rho v_2^2} = \\frac{${n(r.p2, 4)} - ${n(r.cav.pv, 4)}}{${n(0.5 * fl.rho * r.v2 * r.v2, 4)}} = ${n(r.cav.sigma, 3)}` });
    }
    L.push({ t: 'Reynolds sayısı', tex: `Re_D = \\frac{4\\,q_m}{\\pi\\,\\mu\\,D} = \\frac{4\\cdot${n(r.qm, 4)}}{\\pi\\cdot${n(fl.mu, 4)}\\cdot${n(inp.D, 4)}} = ${n(r.Re, 4)}` });
    L.push({ t: 'Kalıcı basınç kaybı (Gibson difüzör korelasyonu)', tex: `\\Delta\\varpi = \\left[k_d(\\varphi)\\,(1-\\beta^2)^2 + K_c\\right]\\tfrac12\\rho v_2^2 = \\left[${n(r.kd, 3)}\\cdot${n(Math.pow(1 - r.beta * r.beta, 2), 4)} + ${P.K_CONV_THROAT}\\right]\\cdot${n(0.5 * fl.rho * r.v2 * r.v2, 4)} = ${n(r.loss, 4)}\\ \\mathrm{Pa}` });
    L.push({ t: 'Geri kazanılan basınç', tex: `\\Delta p_{rec} = \\Delta p - \\Delta\\varpi = ${n(r.dp, 5)} - ${n(r.loss, 4)} = ${n(r.recovered, 4)}\\ \\mathrm{Pa}\\ (${n((1 - r.lossFrac) * 100, 3)}\\%)` });
    L.push({ t: 'Birleşik belirsizlik (ISO 5167-1)', tex: `\\frac{\\delta q_m}{q_m} = \\sqrt{\\left(\\tfrac{\\delta C}{C}\\right)^2+\\left(\\tfrac{\\delta\\varepsilon}{\\varepsilon}\\right)^2+\\left(\\tfrac{2\\beta^4}{1-\\beta^4}\\right)^2\\!\\left(\\tfrac{\\delta D}{D}\\right)^2+\\left(\\tfrac{2}{1-\\beta^4}\\right)^2\\!\\left(\\tfrac{\\delta d}{d}\\right)^2+\\tfrac14\\left(\\tfrac{\\delta \\Delta p}{\\Delta p}\\right)^2+\\tfrac14\\left(\\tfrac{\\delta\\rho_1}{\\rho_1}\\right)^2} = \\pm${n(r.unc.total, 3)}\\%` });
    return L;
  }

  let fxTimer = null, fxSig = '';
  function renderFormulas(r, c) {
    const L = formulaList(r, c);
    $('fxTag').textContent = P.STANDARDS[c.inp.method].name + (r.model.isGas ? ' · Gaz' : ' · Sıvı');
    const sig = L.map(f => f.tex).join('|');
    if (sig === fxSig) return;
    fxSig = sig;
    clearTimeout(fxTimer);
    fxTimer = setTimeout(() => {
      const box = $('formulas');
      const mj = window.MathJax && MathJax.typesetPromise;
      box.innerHTML = L.map(f => `<div class="fx"><div class="t">${esc(f.t)}</div>${mj ? `\\[${f.tex}\\]` : `<div class="raw">${esc(f.tex)}</div>`}</div>`).join('');
      if (mj) {
        MathJax.typesetClear && MathJax.typesetClear([box]);
        MathJax.typesetPromise([box]).catch(err => console.warn('MathJax', err));
      }
    }, 180);
  }

  function renderUncertainty(r) {
    const u = r.unc;
    const max = Math.max(...u.parts.map(p => isFinite(p.contrib) ? p.contrib : 0), 1e-9);
    $('uncertainty').innerHTML = `
      <div class="unc-total"><span>Toplam Belirsizlik <span class="note">(debi, %95)</span></span><b>±%${isFinite(u.total) ? u.total.toFixed(2) : '—'}</b></div>
      <table class="grid"><thead><tr><th>Bileşen</th><th style="text-align:right">u&nbsp;%</th><th style="text-align:right">Katkı&nbsp;%</th><th style="width:70px"></th></tr></thead><tbody>
      ${u.parts.map(p => `<tr><td>${p.name}</td><td class="n">${U.fmt(p.u, 3)}</td><td class="n">${U.fmt(p.contrib, 3)}</td><td><div class="bar" style="width:${isFinite(p.contrib) ? Math.max(2, p.contrib / max * 100) : 0}%"></div></td></tr>`).join('')}
      </tbody></table>`;
  }

  function renderChecks(r) {
    $('checks').innerHTML = r.checks.map(c => `<div class="chk ${c.ok ? 'ok' : 'no'}"><span class="m">${c.ok ? '✓' : '✗'}</span><span>${c.name} <span class="v">[${c.range}]</span></span><span class="v">${c.value}</span></div>`).join('');
  }

  function renderStraight(r, c) {
    const s = r.straight;
    $('straight').innerHTML = `
      <div><div class="k">Memba (giriş)</div><div class="v">≥ ${s.upstreamD.toFixed(1)} D</div><div class="s">= ${D.len(s.upstreamD * c.inp.D)} ${D.lu()}</div></div>
      <div><div class="k">Mansap (çıkış)</div><div class="v">≥ ${s.downstream_d} d</div><div class="s">= ${D.len(s.downstream_d * c.inp.d)} ${D.lu()} (boğaz prizinden)</div></div>`;
  }

  /* ============================================================
   * Canlı telemetri (InfluxDB v1)
   * ============================================================ */
  const live = { running: false, demo: false, timer: null, point: null, trail: [], dp: null, qMeas: null, time: null, mixedShown: false, phase: 0 };

  function log(msg, cls) {
    const el = $('ixLog');
    const line = document.createElement('div');
    if (cls) line.className = cls;
    line.textContent = new Date().toLocaleTimeString('tr-TR') + '  ' + msg;
    el.prepend(line);
    while (el.childNodes.length > 60) el.lastChild.remove();
  }

  function setLed(mode, text) {
    $('liveLed').className = 'led ' + (mode || '');
    $('liveText').textContent = text;
  }

  function bindLiveTab() {
    const bind = (id, get, set) => { const el = $(id); get(el); el.addEventListener(el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input', () => { set(el); save(); checkMixed(); }); };
    $('ixDpUnit').innerHTML = U.units('pressure').map(u => `<option value="${u}">${U.label('pressure', u)}</option>`).join('');
    $('ixQUnit').innerHTML = U.units('flow').map(u => `<option value="${u}">${U.label('flow', u)}</option>`).join('');
    bind('ixUrl', e => e.value = state.influx.url, e => state.influx.url = e.value.trim());
    bind('ixDb', e => e.value = state.influx.db, e => state.influx.db = e.value.trim());
    bind('ixUser', e => e.value = state.influx.user, e => state.influx.user = e.value);
    bind('ixPass', e => e.value = state.influx.pass, e => state.influx.pass = e.value);
    bind('ixMeas', e => e.value = state.influx.measurement, e => state.influx.measurement = e.value.trim());
    bind('ixDpField', e => e.value = state.influx.dp.field, e => state.influx.dp.field = e.value.trim());
    bind('ixDpTagK', e => e.value = state.influx.dp.tagKey, e => state.influx.dp.tagKey = e.value.trim());
    bind('ixDpTagV', e => e.value = state.influx.dp.tagValue, e => state.influx.dp.tagValue = e.value.trim());
    bind('ixDpUnit', e => e.value = state.influx.dp.unit, e => state.influx.dp.unit = e.value);
    bind('ixQOn', e => e.checked = state.influx.q.enabled, e => state.influx.q.enabled = e.checked);
    bind('ixQField', e => e.value = state.influx.q.field, e => state.influx.q.field = e.value.trim());
    bind('ixQTagK', e => e.value = state.influx.q.tagKey, e => state.influx.q.tagKey = e.value.trim());
    bind('ixQTagV', e => e.value = state.influx.q.tagValue, e => state.influx.q.tagValue = e.value.trim());
    bind('ixQUnit', e => e.value = state.influx.q.unit, e => state.influx.q.unit = e.value);
    bind('ixRate', e => e.value = String(state.influx.rate), e => { state.influx.rate = Number(e.value); if (live.running) { clearTimeout(live.timer); schedule(0); } });
    $('lnkGuide').onclick = showMixedGuide;
    $('btnPing').onclick = async () => {
      log('Bağlantı testi: ' + state.influx.url);
      try {
        const ver = await VF.Influx.ping(state.influx);
        log('Ping OK — InfluxDB sürümü ' + ver, 'o');
        if (!/^1\./.test(ver) && ver !== 'bilinmiyor') log('Uyarı: Bu araç InfluxDB v1.x (InfluxQL) için tasarlanmıştır.', 'e');
        const sensors = sensorsList();
        const data = await VF.Influx.fetchLast(state.influx, sensors);
        sensors.forEach(s => log(`${s.key}: ${data[s.key] ? data[s.key].value + ' @ ' + new Date(data[s.key].time).toLocaleString('tr-TR') : 'veri yok'}`, data[s.key] ? 'o' : 'e'));
        UI.toast('InfluxDB bağlantısı başarılı', 'ok');
      } catch (e) { handleErr(e); }
    };
    $('btnLive').onclick = () => live.running && !live.demo ? stopLive() : startLive(false);
    $('btnDemo').onclick = () => live.running && live.demo ? stopLive() : startLive(true);
    checkMixed();
  }

  function sensorsList() {
    const ix = state.influx;
    const s = [{ key: 'dp', field: ix.dp.field, tagKey: ix.dp.tagKey, tagValue: ix.dp.tagValue }];
    if (ix.q.enabled) s.push({ key: 'q', field: ix.q.field, tagKey: ix.q.tagKey, tagValue: ix.q.tagValue });
    return s;
  }

  function checkMixed() {
    $('mixedWarn').classList.toggle('show', VF.Influx.isMixed(state.influx));
  }

  function handleErr(e) {
    log('HATA: ' + e.message, 'e');
    setLed('err', 'Telemetri hatası');
    if (e.kind === 'mixed' || (VF.Influx.isMixed(state.influx) && e.kind === 'network')) {
      if (!live.mixedShown) { live.mixedShown = true; showMixedGuide(); }
      stopLive(true);
    } else if (e.kind === 'network') {
      UI.toast('InfluxDB\'ye ulaşılamadı. URL, ağ ve CORS ayarlarını kontrol edin.', 'err');
    }
  }

  function startLive(demo) {
    stopLive(true);
    live.running = true; live.demo = demo; live.trail = []; live.mixedShown = false;
    $('btnLive').textContent = demo ? '▶ Başlat' : '■ Durdur';
    $('btnDemo').textContent = demo ? '■ Demo Durdur' : 'Demo Modu';
    setLed(demo ? 'demo' : 'on', demo ? 'Demo verisi' : 'Bağlanıyor…');
    log(demo ? 'Demo modu başladı (sentetik veri)' : `Sorgulama başladı · ${state.influx.rate} sn aralık`);
    if (!demo) sensorsList().forEach(s => log('InfluxQL: ' + VF.Influx.sensorQuery(state.influx, s)));
    schedule(0);
  }

  function stopLive(silent) {
    const was = live.running;
    live.running = false;
    clearTimeout(live.timer);
    $('btnLive').textContent = '▶ Başlat';
    $('btnDemo').textContent = 'Demo Modu';
    if (was && !silent) { log('Durduruldu'); setLed('', 'Telemetri kapalı'); }
    if (!silent) { live.point = null; VF.ChartView.updateLive(null, live.trail); }
  }

  function schedule(ms) {
    live.timer = setTimeout(tick, ms);
  }

  async function tick() {
    if (!live.running) return;
    const ix = state.influx;
    const t0 = Date.now();
    try {
      if (live.demo) {
        if (!lastCalc) throw new Error('Geçerli tasarım yok');
        live.phase += 1;
        const { res, c } = lastCalc;
        const base = c.qMax * (0.55 + 0.25 * Math.sin(live.phase / 12));
        const dpTrue = res.model.dpFromFlow(base) * (1 + (Math.random() - 0.5) * 0.02);
        live.dp = dpTrue;
        live.qMeas = ix.q.enabled ? base * (1 + 0.004 + (Math.random() - 0.5) * 0.006) : null;
        live.time = Date.now();
      } else {
        const data = await VF.Influx.fetchLast(ix, sensorsList());
        if (!data.dp) throw new VF.Influx.InfluxError('nodata', 'ΔP sensörü için veri bulunamadı (measurement/field/tag kontrol edin).');
        live.dp = U.toSI('pressure', data.dp.value, ix.dp.unit);
        live.time = data.dp.time;
        live.qMeas = data.q ? U.toSI('flow', data.q.value, ix.q.unit, context().ctx) : null;
        setLed('on', 'Canlı · ' + new Date(live.time).toLocaleTimeString('tr-TR'));
      }
      liveRecompute(true);
    } catch (e) {
      handleErr(e);
    }
    if (live.running) schedule(Math.max(200, ix.rate * 1000 - (Date.now() - t0)));
  }

  /** Canlı ΔP'den debi hesabı + grafikteki kırmızı noktanın konumu */
  function liveRecompute(push) {
    if (!lastCalc || live.dp === null || !live.running) { liveRender(); return; }
    const { res, c } = lastCalc;
    const ctx = c.ctx;
    const qCalc = res.model.flowFromDp(live.dp);
    const qShow = live.qMeas !== null ? live.qMeas : qCalc;
    const pt = {
      x: U.fromSI('flow', qShow, state.units.flow, ctx),
      y: U.fromSI('pressure', live.dp, state.units.pressure)
    };
    live.qCalc = qCalc;
    live.dev = live.qMeas !== null && qCalc > 0 ? (live.qMeas - qCalc) / qCalc * 100 : null;
    pt.label = `${U.fmt(pt.x, 4)} ${D.fu()} · ${U.fmt(pt.y, 4)} ${D.pu()}` + (live.dev !== null ? ` · Δ ${live.dev >= 0 ? '+' : ''}${live.dev.toFixed(2)}%` : '');
    live.point = pt;
    if (push) {
      live.trail.push({ x: pt.x, y: pt.y, qSI: qShow, dpSI: live.dp });
      if (live.trail.length > 40) live.trail.shift();
    } else {
      // birim değişiminde iz noktalarını yeniden ölçekle
      live.trail = live.trail.map(t => ({ ...t, x: U.fromSI('flow', t.qSI, state.units.flow, ctx), y: U.fromSI('pressure', t.dpSI, state.units.pressure) }));
    }
    VF.ChartView.updateLive(pt, live.trail.slice(0, -1));
    liveRender();
  }

  function liveRender() {
    const ctx = lastCalc ? lastCalc.c.ctx : { rho: 1000 };
    const has = live.running && live.dp !== null;
    $('lvDp').textContent = has ? `${D.p(live.dp)} ${D.pu()}` : '—';
    $('lvQc').textContent = has ? `${D.flow(live.qCalc, ctx)} ${D.fu()}` : '—';
    $('lvQm').textContent = has && live.qMeas !== null ? `${D.flow(live.qMeas, ctx)} ${D.fu()}` : '—';
    const dev = $('lvDev');
    if (has && live.dev !== null && lastCalc) {
      const u = lastCalc.res.model ? P.uncertainty(lastCalc.res.model, lastCalc.c.inp, live.dp).total : NaN;
      const ok = Math.abs(live.dev) <= u;
      dev.textContent = `${live.dev >= 0 ? '+' : ''}${live.dev.toFixed(2)}% ${ok ? '✓' : '✗'}`;
      dev.style.color = ok ? 'var(--ok)' : 'var(--bad)';
      dev.title = `Belirsizlik sınırı ±%${u.toFixed(2)}`;
    } else { dev.textContent = '—'; dev.style.color = ''; }
  }

  function showMixedGuide() {
    const origin = location.origin;
    UI.modal({
      title: 'Tarayıcı Güvensiz İçerik (Mixed Content) İzin Rehberi',
      wide: true,
      body: `
        <div class="guide-alert"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4m0 4h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/></svg>
        <div>Bu sayfa <b>HTTPS</b> (<code>${esc(origin)}</code>) üzerinden açıldı; InfluxDB adresi ise <b>HTTP</b> (<code>${esc(state.influx.url)}</code>).
        Tarayıcılar güvenlik nedeniyle HTTPS sayfalardan HTTP isteklerini varsayılan olarak engeller. Aşağıdaki yöntemlerden birini uygulayın.</div></div>
        <h4>Yöntem 1 — Google Chrome / Microsoft Edge (önerilen, site bazlı)</h4>
        <ol>
          <li>Adres çubuğundaki <b>🔒 / ayarlar simgesine</b> tıklayın → <b>Site ayarları</b>.</li>
          <li><b>Güvenli olmayan içerik</b> (Insecure content) satırını <b>İzin ver</b> olarak değiştirin.</li>
          <li>Sayfayı yenileyin (F5) ve <b>Canlı → ▶ Başlat</b> deyin.</li>
          <li>Chrome özel ağ (10.x / 192.168.x) erişimi için ayrıca izin isteyebilir; çıkan istemi onaylayın.</li>
        </ol>
        <p class="note">Doğrudan adres: <code>chrome://settings/content/siteDetails?site=${esc(encodeURIComponent(origin))}</code></p>
        <h4>Yöntem 2 — Mozilla Firefox</h4>
        <ol>
          <li>Adres çubuğundaki <b>kilit simgesine</b> tıklayın → <b>Bağlantı güvenli</b> → <b>Korumayı şimdilik devre dışı bırak</b>.</li>
          <li>Kalıcı çözüm: <code>about:config</code> → <code>security.mixed_content.block_active_content</code> = <b>false</b> (yalnızca güvenilir iç ağ istasyonlarında).</li>
        </ol>
        <h4>Yöntem 3 — Kalıcı ve güvenli çözümler</h4>
        <ul>
          <li>InfluxDB'de HTTPS'i etkinleştirin (<code>[http] https-enabled = true</code>, sertifika yolları) ve URL'yi <code>https://</code> yapın.</li>
          <li>InfluxDB'nin önüne TLS sonlandıran bir ters vekil (Nginx / Caddy) koyun.</li>
          <li>Uygulamayı yerelde HTTP üzerinden çalıştırın: <code>python -m http.server 8080</code> → <code>http://localhost:8080</code>.</li>
        </ul>
        <p class="note">İpucu: İnternete bağlı olmayan test için <b>Demo Modu</b> ile canlı izleme ekranını deneyebilirsiniz.</p>`
    });
  }

  /* ============================================================
   * Yedekleme / PDF / tema / yardım
   * ============================================================ */
  function exportJson() {
    const data = { app: 'VenturiFlow Master', version: 1, exportedAt: new Date().toISOString(), state };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `venturiflow_yedek_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    UI.toast('Yedek dosyası indirildi' + (state.influx.pass ? ' (InfluxDB parolası dosyada bulunuyor!)' : ''), state.influx.pass ? 'warn' : 'ok');
  }

  async function importJson(file) {
    try {
      const data = JSON.parse(await file.text());
      const s = data.state || data;
      if (!s || typeof s !== 'object' || !s.inputs) throw new Error('Geçerli bir VenturiFlow yedeği değil.');
      stopLive(true);
      state = merge(defaults(), s);
      if (!state.fluids.find(f => f.id === state.activeFluid)) state.activeFluid = state.fluids[0].id;
      initUI();
      UI.toast('Yedek geri yüklendi: ' + file.name, 'ok');
    } catch (e) { UI.toast('İçe aktarma hatası: ' + e.message, 'err'); }
  }

  async function makePdf() {
    if (!lastCalc) return UI.toast('Önce geçerli bir tasarım oluşturun.', 'err');
    const btn = $('btnPdf');
    btn.disabled = true; btn.lastChild.textContent = 'Hazırlanıyor…';
    try {
      const { c, res: r, resMax: rm } = lastCalc;
      const ctx = c.ctx;
      const svg = VF.Draw.venturiSVG({
        D: c.inp.D, d: c.inp.d, theta: c.inp.theta, width: 1000, height: 330, theme: 'light',
        fmtLen: v => D.len(v) + ' ' + D.lu(), profile: { p1: c.inp.p1, dp: r.dp, loss: r.loss, fmtP: v => D.p(v) + ' ' + D.pu() }
      });
      const svgPng = await VF.Draw.svgToPng(svg, 1000, 330, 2);
      const chartPng = await VF.ChartView.image(1000, 460);
      const g = P.geometry(c.inp.D, c.inp.d, c.inp.theta);
      const lu = D.lu(), pu = D.pu(), fu = D.fu();
      const fl = c.fl;
      const rowsRes = (label, fn, hl) => [label, fn(r), fn(rm), hl];
      const rep = {
        date: new Date().toLocaleString('tr-TR'),
        method: P.STANDARDS[c.inp.method].name,
        typeName: r.model.typeName,
        fluidName: activeFluid().name,
        svgPng, chartPng,
        geometry: [
          ['Boru iç çapı D', `${D.len(c.inp.D)} ${lu}`], ['Boğaz çapı d', `${D.len(c.inp.d)} ${lu}`],
          ['Çap oranı β', r.beta.toFixed(4)], ['Konvergent açısı / boy', `21° / ${D.len(g.Lc)} ${lu}`],
          ['Boğaz boyu', `${D.len(g.Lt)} ${lu}`], ['Difüzör açısı / boy', `${c.inp.theta}° / ${D.len(g.Ld)} ${lu}`],
          ['Toplam boy (konv.+boğaz+dif.)', `${D.len(g.Lc + g.Lt + g.Ld)} ${lu}`]
        ],
        fluid: [
          ['Akışkan / tip', `${activeFluid().name} / ${fl.type === 'gas' ? 'Gaz' : 'Sıvı'}`],
          ['Sıcaklık T', `${U.fmt(U.fromSI('temperature', c.inp.T, state.units.temperature), 4)} ${U.label('temperature', state.units.temperature)}`],
          ['Giriş basıncı p₁ (mutlak)', `${D.p(c.inp.p1)} ${pu}`],
          ['Yoğunluk ρ', `${U.fmt(fl.rho, 5)} kg/m³`],
          ['Viskozite μ', `${U.fmt(fl.mu * 1000, 4)} cP`],
          fl.type === 'gas' ? ['İzentropik üs κ', fl.kappa.toFixed(3)] : ['Buhar basıncı p_v', `${D.p(fl.pv)} ${pu}`],
          ['Maks. tasarım debisi', `${D.flow(c.qMax, ctx)} ${fu}`]
        ],
        results: [
          rowsRes(`Debi [${fu}]`, x => D.flow(x.qm, ctx)),
          rowsRes('Kütlesel debi [kg/s]', x => U.fmt(x.qm, 4)),
          rowsRes(`Fark basınç ΔP [${pu}]`, x => D.p(x.dp), true),
          rowsRes('Boşaltma katsayısı C', x => x.C.toFixed(4)),
          rowsRes('Genleşme faktörü ε (Y)', x => isFinite(x.eps) ? x.eps.toFixed(5) : '—'),
          rowsRes('Reynolds Re_D', x => isFinite(x.Re) ? x.Re.toExponential(3) : '—'),
          rowsRes('Boğaz hızı v₂ [m/s]', x => U.fmt(x.v2, 4)),
          rowsRes(`Kalıcı basınç kaybı [${pu}]`, x => `${D.p(x.loss)} (%${U.fmt(x.lossFrac * 100, 3)})`, true),
          rowsRes(`Geri kazanılan basınç [${pu}]`, x => D.p(x.recovered), true),
          rowsRes('Toplam belirsizlik', x => `±%${x.unc.total.toFixed(2)}`, true),
          fl.type === 'gas'
            ? rowsRes('Basınç oranı τ', x => isFinite(x.tau) ? x.tau.toFixed(4) : '—')
            : rowsRes('Kavitasyon σ / durum', x => `${U.fmt(x.cav.sigma, 3)} / ${x.cav.level === 'bad' ? 'VAR' : x.cav.level === 'warn' ? 'Yüksek risk' : 'Düşük'}`)
        ],
        unc: r.unc,
        checks: r.checks,
        straight: [
          ['Memba elemanı', r.straight.fittingName],
          ['Memba düz boru', `≥ ${r.straight.upstreamD.toFixed(1)} D = ${D.len(r.straight.upstreamD * c.inp.D)} ${lu}`],
          ['Mansap düz boru (boğaz prizinden)', `≥ ${r.straight.downstream_d} d = ${D.len(r.straight.downstream_d * c.inp.d)} ${lu}`]
        ],
        formulas: formulaList(r, c)
      };
      await VF.Report.generate(rep);
      UI.toast('PDF raporu indirildi', 'ok');
    } catch (e) {
      console.error(e);
      UI.toast('PDF oluşturulamadı: ' + e.message, 'err');
    } finally {
      btn.disabled = false; btn.lastChild.textContent = 'PDF Rapor';
    }
  }

  function applyTheme() {
    document.documentElement.dataset.theme = state.theme;
    $('icoTheme').innerHTML = state.theme === 'dark'
      ? '<path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"/>'
      : '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4l1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4m11.4-11.4l1.4-1.4"/>';
    VF.ChartView.applyTheme();
  }

  function showHelp() {
    UI.modal({
      title: 'VenturiFlow Master — Hızlı Yardım', wide: true,
      body: `<h4>İş akışı</h4><ol>
        <li><b>Tasarım</b> sekmesinde standardı, imalat tipini, boru çapını (kütüphaneden) ve boğaz çapını / β'yı girin.</li>
        <li><b>Akışkan</b> sekmesinde sıvı/gaz seçin; viskozite zorunludur. Sıcaklığa bağlı özellikler için CSV içe aktarın.</li>
        <li>Göstergeler, ölçekli çizim, performans eğrisi ve formül paneli anında güncellenir. <b>What-If</b> kaydırıcısı ile çalışma noktasını değiştirin.</li>
        <li><b>Canlı</b> sekmesinden InfluxDB v1 bağlantısını kurun; ölçülen ΔP grafikte kırmızı nokta olarak görünür. Debi sensörü eklenirse sapma, belirsizlik sınırına göre değerlendirilir.</li>
        <li><b>JSON Yedekle</b> ile tüm ayarları saklayın, <b>PDF Rapor</b> ile A4 raporu indirin.</li></ol>
        <h4>Grafik</h4><ul>
        <li>Kesikli turkuaz çizgiler: debi ölçüm belirsizliği bandı (±U).</li>
        <li>Dikey çizgiler: tasarım maks. debi, kavitasyon başlangıcı (sıvı) veya τ = 0,75 sınırı (gaz).</li></ul>
        <h4>Kısayollar</h4><ul><li><code>Esc</code> — açık pencereyi kapat</li></ul>`
    });
  }

  /* ============================================================
   * Başlatma
   * ============================================================ */
  let bound = false;
  function initUI() {
    applyTheme();
    buildInputs();
    if (!$('selPipe').options.length) buildPipeLib();
    fillInputs();
    syncPipe();
    $('selMethod').value = state.method;
    $('selMfg').value = state.mfg;
    $('slWhatIf').value = state.whatIf;
    $('selFitting').innerHTML = Object.entries(P.FITTINGS).map(([k, f]) => `<option value="${k}">${f.name}</option>`).join('');
    $('selFitting').value = state.fitting;
    buildFluidTab();
    buildUnitsTab();
    if (!bound) { bindOnce(); bound = true; }
    // Canlı sekme alanlarını yeniden doldur
    bindLiveFields();
    selectTab(state.tab);
    fxSig = '';
    recalc();
  }

  let liveBound = false;
  function bindLiveFields() {
    if (!liveBound) { bindLiveTab(); liveBound = true; return; }
    const ix = state.influx;
    const set = (id, v) => { const el = $(id); if (el.type === 'checkbox') el.checked = v; else el.value = v; };
    set('ixUrl', ix.url); set('ixDb', ix.db); set('ixUser', ix.user); set('ixPass', ix.pass); set('ixMeas', ix.measurement);
    set('ixDpField', ix.dp.field); set('ixDpTagK', ix.dp.tagKey); set('ixDpTagV', ix.dp.tagValue); set('ixDpUnit', ix.dp.unit);
    set('ixQOn', ix.q.enabled); set('ixQField', ix.q.field); set('ixQTagK', ix.q.tagKey); set('ixQTagV', ix.q.tagValue); set('ixQUnit', ix.q.unit);
    set('ixRate', String(ix.rate));
    checkMixed();
  }

  // Hata ayıklama için: konsoldan VF.state
  Object.defineProperty(VF, 'state', { get: () => state });
  VF.App = { showMixedGuide, recalc };

  function selectTab(t) {
    state.tab = t;
    document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
    document.querySelectorAll('.tab').forEach(s => s.classList.toggle('on', s.id === 'tab-' + t));
    save();
  }

  function bindOnce() {
    $('tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) selectTab(b.dataset.tab); });
    $('selMethod').addEventListener('change', e => { state.method = e.target.value; recalc(); });
    $('selMfg').addEventListener('change', e => { state.mfg = e.target.value; recalc(); });
    $('selFitting').addEventListener('change', e => { state.fitting = e.target.value; recalc(); });
    $('slWhatIf').addEventListener('input', e => { state.whatIf = Number(e.target.value); recalc(); });
    $('btnTheme').onclick = () => { state.theme = state.theme === 'dark' ? 'light' : 'dark'; applyTheme(); recalc(); };
    $('btnExport').onclick = exportJson;
    $('btnImport').onclick = () => $('fileJson').click();
    $('fileJson').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) importJson(f); });
    $('btnPdf').onclick = makePdf;
    $('btnHelp').onclick = showHelp;
    bindFluidTab();
    let rt = null;
    window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => lastCalc && renderDrawing(lastCalc.res, lastCalc.c), 120); });
  }

  function boot() {
    if (!VF.ChartView.init($('chart'), $('liveDot'), $('liveDotLbl'))) {
      $('chartBox').innerHTML = '<p class="note bad" style="padding:20px">Chart.js yüklenemedi — internet/CDN erişimini kontrol edin.</p>';
    }
    initUI();
    // MathJax asenkron yüklenir; hazır olduğunda formülleri dizgele
    const waitMJ = setInterval(() => {
      if (window.MathJax && MathJax.typesetPromise) { clearInterval(waitMJ); fxSig = ''; lastCalc && renderFormulas(lastCalc.res, lastCalc.c); }
    }, 250);
    setTimeout(() => clearInterval(waitMJ), 20000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window.VF = window.VF || {});
