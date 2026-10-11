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

  function sensor(name, unit, enabled) {
    return { enabled: !!enabled, name, unit, a: 1, b: 0, avg: { mode: 'n', n: 5 } };
  }
  function defaultSensors() {
    return {
      dpMode: 'direct',   // 'direct' = ΔP transmitteri, 'diff' = P1 − P2
      pGauge: true,       // P1/P2 gösterge (gauge) basıncı mı?
      list: {
        dp: sensor('DP1', 'mbar', true),
        p1: sensor('P1', 'bar', false),
        p2: sensor('P2', 'bar', false),
        q: sensor('Q1', 'kg/h', false),
        T: sensor('T1', 'C', false),
        rho: sensor('RHO1', 'kg/m3', false)
      }
    };
  }

  // Her venturiye özel alanlar (geri kalanı ortak)
  const VKEYS = ['method', 'mfg', 'fitting', 'inputs', 'activeFluid', 'measured', 'whatIf', 'calib', 'sensors'];
  const clone = o => JSON.parse(JSON.stringify(o));

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
      // InfluxDB bağlantısı — tüm venturiler için ortak
      influx: {
        url: 'http://10.10.2.6:8086', db: 'lc_100', user: '', pass: '', measurement: 'telemetry',
        rateMs: 1000, windowMin: 5,
        nameMode: 'field', tagKey: 'name', valueField: 'value',
        newOnly: true
      },
      // Sensörler — her venturiye özel (ad, birim, ax+b kalibrasyonu, hareketli ortalama)
      sensors: defaultSensors(),
      view: 'main',
      conv: { dim: 'flow', v: 1, from: 'm3/h' },
      fluidChart: { prop: 'rho' },
      venturis: [],
      activeVenturi: null,
      calib: {
        rows: [],
        units: { q: 'kg/h', dp: 'mbar', T: 'C', rho: 'kg/m3' },
        TminK: 283.15, TmaxK: 353.15,
        refAcc: 0.1,
        model: 'auto',
        apply: false,
        codeTab: 'tc',
        plc: { name: 'FB_VenturiFlow', dpUnit: 'mbar', lowCut: 3 }
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

  /** Eski sürüm kayıtlarını yeni yapıya taşır ve venturi listesini garanti eder */
  function migrate(s, raw) {
    raw = raw || {};
    const ix = raw.influx || {};
    if (ix.rate && !ix.rateMs) s.influx.rateMs = ix.rate * 1000;
    if (ix.db === 'db') s.influx.db = 'lc_100';
    if (ix.measurement === 'venturi') s.influx.measurement = 'telemetry';
    ['dp', 'q', 'T', 'rho', 'avg', 'rate'].forEach(k => delete s.influx[k]);
    // v1.3 sensör tanımları (field/tag) → yeni sensör listesi
    ['dp', 'q', 'T', 'rho'].forEach(k => {
      const o = ix[k];
      if (o && !raw.sensors) {
        const t = s.sensors.list[k];
        t.enabled = k === 'dp' ? true : !!o.enabled;
        if (o.unit) t.unit = o.unit;
        if (o.field && o.field !== 'value') t.name = o.field;
      }
    });
    if (ix.avg && !raw.sensors) Object.values(s.sensors.list).forEach(t => { t.avg = { mode: ix.avg.mode, n: ix.avg.n }; });
    if (!s.fluids.length) s.fluids = clone(F.BUILTIN);
    if (!Array.isArray(s.venturis) || !s.venturis.length) {
      const id = 'v' + Date.now().toString(36);
      s.venturis = [{ id, name: 'Venturi 1', note: '', created: new Date().toISOString(), updated: new Date().toISOString(), data: pickV(s) }];
      s.activeVenturi = id;
    }
    if (!s.venturis.find(v => v.id === s.activeVenturi)) s.activeVenturi = s.venturis[0].id;
    loadVData(s, s.venturis.find(v => v.id === s.activeVenturi).data);
    return s;
  }

  const pickV = s => { const o = {}; VKEYS.forEach(k => { o[k] = clone(s[k]); }); return o; };
  /** Venturi kaydındaki veriyi çalışma alanına yükler (eksikler varsayılandan) */
  function loadVData(s, data) {
    const d = defaults();
    VKEYS.forEach(k => { s[k] = merge(d[k], data ? clone(data[k]) : undefined); });
    if (!s.fluids.find(f => f.id === s.activeFluid)) s.activeFluid = s.fluids[0].id;
  }

  let state = defaults();
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    state = migrate(merge(defaults(), parsed || {}), parsed);
  } catch (e) { console.warn('Kayıtlı durum okunamadı', e); state = migrate(defaults()); }

  /** Çalışma alanını aktif venturi kaydına yazar */
  function snapshotVenturi() {
    const rec = state.venturis.find(v => v.id === state.activeVenturi);
    if (!rec) return;
    const data = pickV(state);
    if (JSON.stringify(data) !== JSON.stringify(rec.data)) { rec.data = data; rec.updated = new Date().toISOString(); }
  }

  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      snapshotVenturi();
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(state));
        $('stSave').textContent = '● Kaydedildi ' + new Date().toLocaleTimeString('tr-TR');
      } catch (e) {
        $('stSave').textContent = '⚠ Kaydedilemedi (localStorage kapalı)';
      }
      if (VF.Sync) VF.Sync.notifyChange();
    }, 300);
  }

  /* ---------- Ortak kayıt (GitHub) için paylaşılan durum ----------
   * Tema, açık sekme ve InfluxDB parolası her bilgisayarda yerel kalır.
   * Aktif venturi seçimi de yereldir: her bilgisayar farklı venturiye bakabilir.
   * Venturiye özel alanlar ortak dosyada yalnızca venturi kayıtlarının içinde bulunur. */
  const LOCAL_KEYS = ['theme', 'tab', 'view', 'activeVenturi', 'conv', 'fluidChart'];

  function getSharedJson() {
    snapshotVenturi();
    const s = clone(state);
    LOCAL_KEYS.concat(VKEYS).forEach(k => delete s[k]);
    s.influx.pass = '';
    return JSON.stringify(s);
  }

  /** Ortak kaydı uygular. mergeLocal: bu bilgisayarın düzenlenmiş (varsayılan olmayan)
   *  venturileri ortak listede yoksa eklenir; eklenen sayısı döner. */
  function applyShared(remote, mergeLocal) {
    snapshotVenturi();
    const blank = JSON.stringify(pickV(defaults()));
    const localV = mergeLocal ? clone(state.venturis.filter(v => JSON.stringify(v.data) !== blank)) : [];
    const keep = {};
    LOCAL_KEYS.forEach(k => { keep[k] = state[k]; });
    const pass = state.influx.pass;
    const s = merge(defaults(), remote);
    LOCAL_KEYS.forEach(k => { if (keep[k] !== undefined) s[k] = keep[k]; });
    s.influx.pass = pass;
    stopLive(true);
    state = migrate(s, remote);
    let added = 0;
    localV.forEach(v => {
      if (state.venturis.some(x => x.id === v.id)) return;
      v.name = uniqueName(v.name);
      state.venturis.push(v); added++;
    });
    initUI();
    return added;
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
    $('fcProp').addEventListener('change', e => { state.fluidChart.prop = e.target.value; save(); if (lastCalc) renderFluidChart(lastCalc.c); });
    $('selFluid').addEventListener('change', e => { state.activeFluid = e.target.value; buildFluidTab(); recalc(); });
    $('fName').addEventListener('input', e => {
      activeFluid().name = e.target.value || 'Adsız';
      const o = $('selFluid').selectedOptions[0];
      if (o) o.textContent = `${activeFluid().name} (${activeFluid().type === 'gas' ? 'Gaz' : 'Sıvı'})`;
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
    renderFluidChart(c);
  }

  /* ---------- Akışkan özelliklerinin sıcaklığa bağlı grafiği ---------- */
  let fluidChart = null;
  const FPROPS = {
    rho: { label: 'Yoğunluk ρ', dim: 'density', get: r => r.rho },
    mu: { label: 'Dinamik viskozite μ', dim: 'viscosity', get: r => r.mu },
    nu: { label: 'Kinematik viskozite ν', dim: null, unit: 'cSt', get: r => r.mu / r.rho * 1e6 },
    pv: { label: 'Buhar basıncı pᵥ', dim: 'pressure', get: r => r.pv, liquid: true }
  };
  function renderFluidChart(c) {
    const cv = $('fluidChart');
    if (!cv || typeof Chart === 'undefined' || state.tab !== 'fluid') return;
    const f = activeFluid();
    let prop = state.fluidChart.prop;
    if (FPROPS[prop].liquid && f.type !== 'liquid') prop = 'rho';
    $('fcProp').value = prop;
    const P0 = FPROPS[prop];
    const tb = f.table && f.table.length ? f.table : null;
    const Tlo = tb ? tb[0].T : c.inp.T - 40, Thi = tb ? tb[tb.length - 1].T : c.inp.T + 40;
    const tu = state.units.temperature;
    const yu = P0.dim ? state.units[P0.dim] : null;
    const conv = (r, v) => P0.dim ? U.fromSI(P0.dim, v, yu, { rho: r.rho }) : v;
    const pts = Array.from({ length: 61 }, (_, i) => {
      const T = Tlo + (Thi - Tlo) * i / 60;
      const r = F.resolve(f, T, c.inp.p1);
      return { x: U.fromSI('temperature', T, tu), y: conv(r, P0.get(r)) };
    });
    const tpts = tb ? tb.map(r => ({ x: U.fromSI('temperature', r.T, tu), y: conv({ rho: r.rho, mu: r.mu }, P0.get({ rho: r.rho, mu: r.mu, pv: r.pv })) })).filter(p => isFinite(p.y)) : [];
    const rNow = F.resolve(f, c.inp.T, c.inp.p1);
    const now = [{ x: U.fromSI('temperature', c.inp.T, tu), y: conv(rNow, P0.get(rNow)) }];
    const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    const unitLbl = P0.dim ? U.label(P0.dim, yu) : P0.unit;
    const ds = [
      { label: tb ? 'İnterpolasyon' : 'Sabit (tablo yok)', data: pts, showLine: true, borderColor: css('--accent'), borderWidth: 2, pointRadius: 0 },
      { label: 'Tablo noktaları', data: tpts, backgroundColor: css('--amber'), borderColor: css('--amber'), pointRadius: 3.5 },
      { label: 'İşletme T', data: now, backgroundColor: '#ff2d2d', borderColor: '#fff', borderWidth: 1.5, pointRadius: 6 }
    ];
    const opts = {
      animation: false, responsive: true, maintainAspectRatio: false, parsing: false,
      scales: {
        x: { type: 'linear', title: { display: true, text: `Sıcaklık [${U.label('temperature', tu)}]`, color: css('--chart-text') }, grid: { color: css('--chart-grid') }, ticks: { color: css('--chart-text') } },
        y: { type: prop === 'pv' ? 'logarithmic' : 'linear', title: { display: true, text: `${P0.label} [${unitLbl}]`, color: css('--chart-text') }, grid: { color: css('--chart-grid') }, ticks: { color: css('--chart-text') } }
      },
      plugins: { legend: { labels: { color: css('--chart-text'), boxWidth: 10 } } }
    };
    if (prop === 'pv' && !(tpts.length || pts.some(p => p.y > 0))) opts.scales.y.type = 'linear';
    if (!fluidChart) fluidChart = new Chart(cv, { type: 'scatter', data: { datasets: ds }, options: opts });
    else { fluidChart.data.datasets = ds; fluidChart.options = opts; fluidChart.update(); }
    $('fcNote').textContent = tb ? `Tablo aralığı ${U.fmt(U.fromSI('temperature', Tlo, tu), 3)} … ${U.fmt(U.fromSI('temperature', Thi, tu), 3)} ${U.label('temperature', tu)}; dışında uç değer kullanılır.` : 'Bu akışkanın sıcaklık tablosu yok; özellikler sabit kabul edilir. CSV ile tablo yükleyebilirsiniz.';
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
    const cv = state.conv;
    $('cvDim').innerHTML = DISP_DIMS.map(d => `<option value="${d}">${U.DIMS[d].label}</option>`).join('');
    $('cvDim').value = DISP_DIMS.includes(cv.dim) ? cv.dim : 'flow';
    const fillFrom = () => { const d = $('cvDim').value; $('cvFrom').innerHTML = U.units(d).map(u => `<option value="${u}">${U.label(d, u)}</option>`).join(''); };
    fillFrom();
    if (U.units($('cvDim').value).includes(cv.from)) $('cvFrom').value = cv.from;
    $('cvVal').value = cv.v;
    const store = () => { state.conv = { dim: $('cvDim').value, v: parseFloat($('cvVal').value), from: $('cvFrom').value }; save(); };
    $('cvDim').onchange = () => { fillFrom(); store(); convRender(); };
    $('cvFrom').onchange = () => { store(); convRender(); };
    $('cvVal').oninput = () => { store(); convRender(); };
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
    VF.CalibUI.refresh();
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
      live: live.point, trail: live.trail,
      calib: calibCurve(c, curve.length ? U.toSI('pressure', curve[curve.length - 1].y, state.units.pressure) : 0)
    };
  }

  function calibCurve(c, dpMax) {
    const pts = dpMax > 0 ? VF.CalibUI.curve(c, dpMax, 60) : null;
    $('lgCal').hidden = !pts;
    if (!pts) return [];
    return [{ x: 0, y: 0 }].concat(pts.map(p => ({ x: U.fromSI('flow', p.qm, state.units.flow, c.ctx), y: U.fromSI('pressure', p.dp, state.units.pressure) })));
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
  const live = { running: false, demo: false, timer: null, point: null, trail: [], mixedShown: false, phase: 0, buf: {}, lastTs: {}, raw: {}, val: {}, time: null, stale: {} };
  const PATM = 101325;

  // InfluxDB sensörleri (venturiye özel). ΔP: doğrudan transmitter veya P1 − P2
  const SENSORS = [
    { key: 'dp', name: 'Fark basınç ΔP', dim: 'pressure' },
    { key: 'p1', name: 'Giriş basıncı P1', dim: 'pressure' },
    { key: 'p2', name: 'Boğaz basıncı P2', dim: 'pressure' },
    { key: 'q', name: 'Debi (Coriolis)', dim: 'flow' },
    { key: 'T', name: 'Sıcaklık', dim: 'temperature' },
    { key: 'rho', name: 'Yoğunluk (Coriolis)', dim: 'density' }
  ];
  const SL = () => state.sensors.list;
  /** Sensör kullanılıyor mu? (ΔP moduna göre zorunlu olanlar her zaman açık) */
  function sensorOn(key) {
    const m = state.sensors.dpMode;
    if (key === 'dp') return m === 'direct';
    if (key === 'p2') return m === 'diff';
    if (key === 'p1' && m === 'diff') return true;
    return !!SL()[key].enabled;
  }
  const sensorReq = key => (key === 'dp' && state.sensors.dpMode === 'direct') || ((key === 'p1' || key === 'p2') && state.sensors.dpMode === 'diff');

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

  const MA_OPTS = [['off', 'Ham'], ['3', '3'], ['5', '5'], ['6', '6'], ['10', '10'], ['12', '12'], ['20', '20'], ['30', '30'], ['custom', 'Özel'], ['all', 'Tümü']];
  function maValue(a) { return a.mode === 'n' ? ([3, 5, 6, 10, 12, 20, 30].includes(a.n) ? String(a.n) : 'custom') : a.mode; }

  function renderSensors() {
    const L = SL();
    $('dpModeSeg').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === state.sensors.dpMode));
    $('pGaugeSeg').querySelectorAll('button').forEach(b => b.classList.toggle('on', (b.dataset.v === '1') === !!state.sensors.pGauge));
    $('ixSensors').innerHTML = SENSORS.map(s => {
      const c = L[s.key], on = sensorOn(s.key), req = sensorReq(s.key);
      const hidden = (s.key === 'dp' && state.sensors.dpMode === 'diff') || (s.key === 'p2' && state.sensors.dpMode === 'direct');
      if (hidden) return '';
      const mv = maValue(c.avg);
      return `<div class="sensor ${on ? '' : 'off'}" data-s="${s.key}">
        <label class="sh">${req ? '<input type="checkbox" checked disabled>' : `<input type="checkbox" data-f="enabled" ${c.enabled ? 'checked' : ''}>`} ${s.name}${req ? ' <span class="req">*</span>' : ''}
          ${s.key === 'p1' && !req ? '<span class="hint">canlı p₁ için</span>' : ''}</label>
        <div class="sg">
          <label class="fl"><span>Sensör adı</span><input type="text" data-f="name" value="${esc(c.name)}" placeholder="ör. P1"></label>
          <label class="fl"><span>Birim</span><select data-f="unit">${U.units(s.dim).map(u => `<option value="${u}" ${c.unit === u ? 'selected' : ''}>${U.label(s.dim, u)}</option>`).join('')}</select></label>
        </div>
        <div class="sg3">
          <label class="fl"><span>a (çarpan)</span><input type="number" step="any" data-f="a" value="${c.a}"></label>
          <label class="fl"><span>b (ofset)</span><input type="number" step="any" data-f="b" value="${c.b}"></label>
          <label class="fl"><span>Ort. (veri)</span><span class="ma"><select data-f="avg">${MA_OPTS.map(([v, t]) => `<option value="${v}" ${mv === v ? 'selected' : ''}>${t}</option>`).join('')}</select>
            <input type="number" data-f="avgn" min="1" step="1" value="${c.avg.n}" style="${mv === 'custom' ? '' : 'display:none'}"></span></label>
        </div>
        <div class="sv" data-sv="${s.key}"></div></div>`;
    }).join('');
  }

  function bindLiveTab() {
    const ix = () => state.influx;
    const bind = (id, get, set) => { const el = $(id); get(el); el.addEventListener(el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input', () => { set(el); save(); checkMixed(); }); };
    bind('ixUrl', e => e.value = ix().url, e => ix().url = e.value.trim());
    bind('ixDb', e => e.value = ix().db, e => ix().db = e.value.trim());
    bind('ixUser', e => e.value = ix().user, e => ix().user = e.value);
    bind('ixPass', e => e.value = ix().pass, e => ix().pass = e.value);
    bind('ixMeas', e => e.value = ix().measurement, e => ix().measurement = e.value.trim());
    bind('ixNameMode', e => e.value = ix().nameMode, e => { ix().nameMode = e.value; $('ixTagOpts').hidden = e.value !== 'tag'; });
    bind('ixTagKey', e => e.value = ix().tagKey, e => ix().tagKey = e.value.trim());
    bind('ixValueField', e => e.value = ix().valueField, e => ix().valueField = e.value.trim());
    bind('ixRateMs', e => e.value = ix().rateMs, e => { const v = Number(e.value); if (v >= 250) { ix().rateMs = v; e.classList.remove('invalid'); if (live.running) { clearTimeout(live.timer); schedule(0); } } else e.classList.add('invalid'); });
    bind('ixWindow', e => e.value = ix().windowMin, e => { const v = Number(e.value); if (v >= 0) ix().windowMin = v; });
    bind('maNewOnly', e => e.checked = !!ix().newOnly, e => ix().newOnly = e.checked);
    $('ixTagOpts').hidden = ix().nameMode !== 'tag';
    renderSensors();
    $('dpModeSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; state.sensors.dpMode = b.dataset.v; resetAvg(); renderSensors(); save(); liveRecompute(false); });
    $('pGaugeSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; state.sensors.pGauge = b.dataset.v === '1'; renderSensors(); save(); liveRecompute(false); });
    const onSensor = e => {
      const box = e.target.closest('[data-s]'); const f = e.target.dataset.f;
      if (!box || !f) return;
      const key = box.dataset.s, c = SL()[key];
      if (f === 'enabled') { c.enabled = e.target.checked; box.classList.toggle('off', !e.target.checked); resetAvg(key); }
      else if (f === 'name') c.name = e.target.value.trim();
      else if (f === 'unit') { c.unit = e.target.value; resetAvg(key); }
      else if (f === 'a' || f === 'b') { const v = parseFloat(e.target.value); if (!isFinite(v)) return e.target.classList.add('invalid'); e.target.classList.remove('invalid'); c[f] = v; resetAvg(key); }
      else if (f === 'avg') {
        const v = e.target.value;
        if (v === 'off' || v === 'all') c.avg.mode = v; else { c.avg.mode = 'n'; if (v !== 'custom') c.avg.n = Number(v); }
        box.querySelector('[data-f=avgn]').style.display = v === 'custom' ? '' : 'none';
        trimAvg(key);
      } else if (f === 'avgn') { const n = Math.round(Number(e.target.value)); if (n >= 1) { c.avg.n = n; trimAvg(key); } }
      save(); liveRecompute(false);
    };
    $('ixSensors').addEventListener('input', e => { if (e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') onSensor(e); });
    $('ixSensors').addEventListener('change', e => { if (e.target.tagName === 'SELECT' || e.target.type === 'checkbox') onSensor(e); });
    $('maReset').onclick = () => { resetAvg(); liveRecompute(false); UI.toast('Ortalama tamponları sıfırlandı', 'ok'); };
    $('btnToCal').onclick = () => {
      const v = currentValues();
      if (!live.running || !(v.dp > 0) || !(v.q > 0)) return UI.toast('Kalibrasyon noktası için ΔP ve Coriolis debi sensörlerinden canlı veri gerekli.', 'err');
      VF.CalibUI.addFromLive({ qm: v.q, dp: v.dp, T: v.T, rho: v.rho });
      UI.toast(`Kalibrasyona eklendi: ${D.flow(v.q, { rho: v.rho || 1000 })} ${D.fu()} · ${D.p(v.dp)} ${D.pu()}`, 'ok');
    };
    $('lnkGuide').onclick = showMixedGuide;
    $('btnPing').onclick = async () => {
      log('Bağlantı testi: ' + ix().url + ' · db=' + ix().db);
      try {
        const ver = await VF.Influx.ping(ix());
        log('Ping OK — InfluxDB sürümü ' + ver, 'o');
        if (!/^1\./.test(ver) && ver !== 'bilinmiyor') log('Uyarı: Bu araç InfluxDB v1.x (InfluxQL) için tasarlanmıştır.', 'e');
        const sensors = sensorsList();
        const data = await VF.Influx.fetchLast(ix(), sensors);
        sensors.forEach(s => log(`${SL()[s.key].name}: ${data[s.key] ? data[s.key].value + ' @ ' + new Date(data[s.key].time).toLocaleString('tr-TR') : 'veri yok (son ' + ix().windowMin + ' dk)'}`, data[s.key] ? 'o' : 'e'));
        UI.toast('InfluxDB bağlantısı başarılı', 'ok');
      } catch (e) { handleErr(e); }
    };
    $('btnLive').onclick = () => live.running && !live.demo ? stopLive() : startLive(false);
    $('btnDemo').onclick = () => live.running && live.demo ? stopLive() : startLive(true);
    checkMixed();
  }

  /** Sorgulanacak sensörler → InfluxQL parametreleri */
  function sensorsList() {
    const ix = state.influx;
    return SENSORS.filter(s => sensorOn(s.key) && SL()[s.key].name).map(s => {
      const name = SL()[s.key].name;
      return ix.nameMode === 'tag'
        ? { key: s.key, field: ix.valueField || 'value', tagKey: ix.tagKey, tagValue: name }
        : { key: s.key, field: name };
    });
  }

  /* ---------- Sensör başına düzeltme (a·x+b) ve hareketli ortalama ---------- */
  function avgWindow(key) {
    const a = SL()[key].avg;
    return a.mode === 'off' ? 1 : a.mode === 'all' ? 100000 : Math.max(1, a.n | 0);
  }
  function resetAvg(key) {
    const keys = key ? [key] : Object.keys(SL());
    keys.forEach(k => { delete live.buf[k]; delete live.lastTs[k]; delete live.val[k]; delete live.raw[k]; });
  }
  function trimAvg(key) {
    const b = live.buf[key];
    if (!b) return;
    const n = avgWindow(key);
    if (b.length > n) b.splice(0, b.length - n);
    live.val[key] = b.length ? b.reduce((s, x) => s + x, 0) / b.length : undefined;
  }
  /** Ham sensör değeri (sensör biriminde) → a·x+b → SI → ortalama tamponu */
  function feed(key, rawUnit, ts, ctx) {
    const c = SL()[key], s = SENSORS.find(x => x.key === key);
    live.raw[key] = rawUnit;
    if (rawUnit === null || rawUnit === undefined || !isFinite(rawUnit)) return;
    const corr = c.a * rawUnit + c.b;
    const v = U.toSI(s.dim, corr, c.unit, ctx);
    if (!isFinite(v)) return;
    const b = live.buf[key] = live.buf[key] || [];
    if (!(state.influx.newOnly && ts !== undefined && live.lastTs[key] === ts && b.length)) b.push(v);
    live.lastTs[key] = ts;
    trimAvg(key);
  }
  /** Demo için: SI değerden sensörün ham çıkışını üretir (a·x+b'nin tersi) */
  function rawFromSI(key, v, ctx) {
    const c = SL()[key], s = SENSORS.find(x => x.key === key);
    return (U.fromSI(s.dim, v, c.unit, ctx) - c.b) / (c.a || 1);
  }
  const avgCount = k => (live.buf[k] || []).length;
  const pAbs = v => v + (state.sensors.pGauge ? PATM : 0);

  /** Ortalaması alınmış güncel değerler (SI) */
  function currentValues() {
    const v = live.val;
    const dp = state.sensors.dpMode === 'diff'
      ? (isFinite(v.p1) && isFinite(v.p2) ? v.p1 - v.p2 : undefined)
      : v.dp;
    return {
      dp, p1: sensorOn('p1') && isFinite(v.p1) ? pAbs(v.p1) : undefined,
      q: sensorOn('q') ? v.q : undefined, T: sensorOn('T') ? v.T : undefined, rho: sensorOn('rho') ? v.rho : undefined
    };
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
    resetAvg();
    $('btnLive').textContent = demo ? '▶ Başlat' : '■ Durdur';
    $('btnDemo').textContent = demo ? '■ Demo Durdur' : 'Demo Modu';
    setLed(demo ? 'demo' : 'on', demo ? 'Demo verisi' : 'Bağlanıyor…');
    log(demo ? 'Demo modu başladı (sentetik veri)' : `Sorgulama başladı · ${state.influx.rateMs} ms aralık`);
    if (!demo) sensorsList().forEach(s => log('InfluxQL: ' + VF.Influx.sensorQuery(state.influx, s)));
    schedule(0);
  }

  function stopLive(silent) {
    const was = live.running;
    live.running = false;
    clearTimeout(live.timer);
    if (!$('btnLive')) return;
    $('btnLive').textContent = '▶ Başlat';
    $('btnDemo').textContent = 'Demo Modu';
    if (was && !silent) { log('Durduruldu'); setLed('', 'Telemetri kapalı'); }
    if (!silent) { live.point = null; VF.ChartView.updateLive(null, live.trail); liveRender(); }
    if (silent && was) setLed('', 'Telemetri kapalı');
  }

  function schedule(ms) {
    live.timer = setTimeout(tick, ms);
  }

  async function tick() {
    if (!live.running) return;
    const t0 = Date.now();
    try {
      if (live.demo) {
        if (!lastCalc) throw new Error('Geçerli tasarım yok');
        // Zaman tabanlı yavaş değişim (yenileme periyodundan bağımsız)
        live.phase = Date.now() / 1000;
        const { res, c } = lastCalc;
        const base = c.qMax * (0.55 + 0.25 * Math.sin(live.phase / 45));
        const T = c.inp.T + 15 * Math.sin(live.phase / 180);
        const pr = F.resolve(activeFluid(), T, c.inp.p1);
        const ctx = { rho: pr.rho };
        let dp = res.model.dpFromFlow(base) * (pr.rho > 0 ? c.fl.rho / pr.rho : 1);
        if (VF.CalibUI.active()) {
          for (let k = 0; k < 6; k++) { const q = VF.CalibUI.predict(dp, pr.rho, pr.mu); if (q > 0) dp *= Math.pow(base / q, 2); }
        }
        dp *= 1 + (Math.random() - 0.5) * 0.02;
        const ts = Date.now();
        const p1g = c.inp.p1 - (state.sensors.pGauge ? PATM : 0);
        if (sensorOn('dp')) feed('dp', rawFromSI('dp', dp, ctx), ts, ctx);
        if (sensorOn('p1')) feed('p1', rawFromSI('p1', p1g * (1 + (Math.random() - 0.5) * 0.001), ctx), ts, ctx);
        if (sensorOn('p2')) feed('p2', rawFromSI('p2', p1g - dp, ctx), ts, ctx);
        if (sensorOn('q')) feed('q', rawFromSI('q', base * (1 + 0.004 + (Math.random() - 0.5) * 0.006), ctx), ts, ctx);
        if (sensorOn('T')) feed('T', rawFromSI('T', T + (Math.random() - 0.5) * 0.2, ctx), ts, ctx);
        if (sensorOn('rho')) feed('rho', rawFromSI('rho', pr.rho * (1 + (Math.random() - 0.5) * 0.0004), ctx), ts, ctx);
        live.time = ts;
      } else {
        const data = await VF.Influx.fetchLast(state.influx, sensorsList());
        live.stale = {};
        sensorsList().forEach(s => { if (!data[s.key]) live.stale[s.key] = true; });
        const need = state.sensors.dpMode === 'diff' ? ['p1', 'p2'] : ['dp'];
        const miss = need.filter(k => !data[k]);
        if (miss.length) throw new VF.Influx.InfluxError('nodata', `${miss.map(k => SL()[k].name).join(', ')} için son ${state.influx.windowMin} dk içinde veri yok (sensör adını / measurement'ı kontrol edin).`);
        // Sıralama: önce T ve ρ (hacimsel debi dönüşümü yoğunluğa bağlı)
        ['T', 'rho', 'dp', 'p1', 'p2'].forEach(k => { if (data[k]) feed(k, data[k].value, data[k].time); });
        if (data.q) {
          const rho = live.val.rho > 0 ? live.val.rho : liveProps().rho;
          feed('q', data.q.value, data.q.time, { rho });
        }
        const t = data[need[0]].time;
        live.time = t;
        const age = (Date.now() - t) / 1000;
        setLed(age > 30 ? 'err' : 'on', (age > 30 ? 'Eski veri · ' : 'Canlı · ') + new Date(t).toLocaleTimeString('tr-TR'));
      }
      liveRecompute(true);
    } catch (e) {
      handleErr(e);
    }
    if (live.running) schedule(Math.max(250, state.influx.rateMs - (Date.now() - t0)));
  }

  /** Canlı sıcaklık/yoğunluk/basınca göre akışkan özellikleri */
  function liveProps() {
    const c = lastCalc ? lastCalc.c : context();
    const v = currentValues();
    const T = v.T > 0 ? v.T : c.inp.T;
    const p1 = v.p1 > 0 ? v.p1 : c.inp.p1;
    const pr = F.resolve(activeFluid(), T, p1);
    const rho = v.rho > 0 ? v.rho : pr.rho;
    return { T, p1, rho, mu: pr.mu, pv: pr.pv };
  }

  /** Canlı (ortalama) ΔP'den debi hesabı + grafikteki kırmızı noktanın konumu */
  function liveRecompute(push) {
    const v = currentValues();
    const dp = v.dp;
    if (!lastCalc || !(dp > 0) || !live.running) { liveRender(); return; }
    const { c } = lastCalc;
    const ctx = c.ctx;
    const pp = liveProps();
    const mTheory = P.model({ ...c.inp, p1: pp.p1, fluid: { ...c.fl, rho: pp.rho, mu: pp.mu } });
    live.qTheory = mTheory.flowFromDp(dp);
    const qCal = VF.CalibUI.predict(dp, pp.rho, pp.mu);
    live.calibrated = qCal !== null;
    live.qCalc = live.calibrated ? qCal : live.qTheory;
    live.qMeas = v.q > 0 ? v.q : null;
    live.cav = c.fl.type === 'liquid' ? pp.p1 - dp - pp.pv : null;
    const qShow = live.qMeas !== null ? live.qMeas : live.qCalc;
    const pt = { x: U.fromSI('flow', qShow, state.units.flow, ctx), y: U.fromSI('pressure', dp, state.units.pressure) };
    live.dev = live.qMeas !== null && live.qCalc > 0 ? (live.qMeas - live.qCalc) / live.qCalc * 100 : null;
    pt.label = `${U.fmt(pt.x, 4)} ${D.fu()} · ${U.fmt(pt.y, 4)} ${D.pu()}` + (live.dev !== null ? ` · Δ ${live.dev >= 0 ? '+' : ''}${live.dev.toFixed(2)}%` : '');
    live.point = pt;
    if (push) {
      live.trail.push({ x: pt.x, y: pt.y, qSI: qShow, dpSI: dp });
      if (live.trail.length > 40) live.trail.shift();
    } else {
      live.trail = live.trail.map(t => ({ ...t, x: U.fromSI('flow', t.qSI, state.units.flow, ctx), y: U.fromSI('pressure', t.dpSI, state.units.pressure) }));
    }
    VF.ChartView.updateLive(pt, live.trail.slice(0, -1));
    liveRender();
  }

  function liveRender() {
    const box = $('liveVals');
    if (!box) return;
    const ctx = lastCalc ? lastCalc.c.ctx : { rho: 1000 };
    const v = currentValues();
    const has = live.running && v.dp > 0;
    // Her sensör kartının altında ham / düzeltilmiş / ortalama değer
    SENSORS.forEach(s => {
      const el = document.querySelector(`[data-sv="${s.key}"]`);
      if (!el) return;
      const c = SL()[s.key];
      if (!live.running || !sensorOn(s.key)) { el.textContent = ''; return; }
      if (live.stale[s.key]) { el.innerHTML = `<span class="badv">veri yok (son ${state.influx.windowMin} dk)</span>`; return; }
      const raw = live.raw[s.key];
      if (raw === undefined) { el.textContent = 'bekleniyor…'; return; }
      const avg = live.val[s.key];
      const ul = U.label(s.dim, c.unit);
      const avgU = avg !== undefined ? U.fromSI(s.dim, avg, c.unit, { rho: v.rho || ctx.rho }) : NaN;
      el.innerHTML = `ham <b>${U.fmt(raw, 5)}</b>${c.a !== 1 || c.b !== 0 ? ` → düz. <b>${U.fmt(c.a * raw + c.b, 5)}</b>` : ''} · ort. <b>${U.fmt(avgU, 5)}</b> ${ul} <span class="hint">(${avgCount(s.key)}/${c.avg.mode === 'all' ? '∞' : avgWindow(s.key)})</span>`;
    });
    const cell = (k, val, sub, cls, title) => `<div ${title ? `title="${esc(title)}"` : ''}><div class="k">${k}</div><div class="v ${cls || ''}">${val}</div>${sub ? `<div class="raw">${sub}</div>` : ''}</div>`;
    const fp = x => `${D.p(x)} ${D.pu()}`;
    const ft = x => `${U.fmt(U.fromSI('temperature', x, state.units.temperature), 4)} ${U.label('temperature', state.units.temperature)}`;
    const fr = x => `${U.fmt(U.fromSI('density', x, state.units.density), 5)} ${U.label('density', state.units.density)}`;
    const ff = x => `${D.flow(x, ctx)} ${D.fu()}`;
    const pp = has ? liveProps() : null;
    let devCell = cell('Sapma', '—');
    if (has && live.dev !== null && lastCalc) {
      const u = live.calibrated ? VF.CalibUI.uncertainty() : P.uncertainty(lastCalc.res.model, lastCalc.c.inp, v.dp).total;
      const ok = Math.abs(live.dev) <= u;
      devCell = cell('Sapma (Coriolis − hesap)', `${live.dev >= 0 ? '+' : ''}${live.dev.toFixed(2)}% ${ok ? '✓' : '✗'}`, `sınır ±%${u.toFixed(2)} (${live.calibrated ? 'kalibre' : 'teorik'})`, ok ? 'okv' : 'badv');
    }
    box.innerHTML = [
      cell(state.sensors.dpMode === 'diff' ? 'ΔP = P1 − P2' : 'ΔP (ortalama)', has ? fp(v.dp) : '—', '', 'red'),
      cell('Giriş basıncı p₁ (mutlak)', pp ? fp(pp.p1) : '—', pp ? (v.p1 > 0 ? 'canlı P1' : 'tasarım değeri') : ''),
      cell('Sıcaklık', pp ? ft(pp.T) : '—', pp ? (v.T > 0 ? 'canlı' : 'tasarım değeri') : ''),
      cell('Yoğunluk', pp ? fr(pp.rho) : '—', pp ? (v.rho > 0 ? 'canlı (Coriolis)' : 'ρ(T) tablodan') : ''),
      cell(`Debi (hesap · ${live.calibrated ? 'kalibre' : 'teorik'})`, has ? ff(live.qCalc) : '—', has && live.calibrated ? 'teorik: ' + ff(live.qTheory) : ''),
      cell('Debi (Coriolis)', has && live.qMeas !== null ? ff(live.qMeas) : '—', sensorOn('q') ? '' : 'sensör kapalı'),
      devCell,
      cell('Kavitasyon payı p₂ − pᵥ', has && live.cav !== null ? fp(live.cav) : '—', has && live.cav !== null ? (live.cav <= 0 ? 'KAVİTASYON!' : 'güvenli') : '', has && live.cav !== null && live.cav <= 0 ? 'badv' : '')
    ].join('');
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
    snapshotVenturi();
    download(`venturiflow_yedek_${new Date().toISOString().slice(0, 10)}.json`,
      { app: 'VenturiFlow Master', kind: 'full', version: 2, exportedAt: new Date().toISOString(), state });
    UI.toast('Yedek dosyası indirildi' + (state.influx.pass ? ' (InfluxDB parolası dosyada bulunuyor!)' : ''), state.influx.pass ? 'warn' : 'ok');
  }

  async function importJson(file) {
    try {
      const data = JSON.parse(await file.text());
      if (data.kind === 'venturi') return importVenturi(data);
      const s = data.state || data;
      if (!s || typeof s !== 'object' || !(s.inputs || s.venturis)) throw new Error('Geçerli bir VenturiFlow yedeği değil.');
      stopLive(true);
      state = migrate(merge(defaults(), s), s);
      initUI();
      save();
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
        venturiName: activeVenturi() ? activeVenturi().name + (activeVenturi().note ? ' — ' + activeVenturi().note : '') : '',
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
        formulas: formulaList(r, c),
        calib: VF.CalibUI.reportData()
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
    VF.CalibUI.onThemeChange();
    if (fluidChart) { fluidChart.destroy(); fluidChart = null; }
  }

  function showHelp() {
    UI.modal({
      title: 'VenturiFlow Master — Hızlı Yardım', wide: true,
      body: `<h4>İş akışı</h4><ol>
        <li><b>Tasarım</b> sekmesinde standardı, imalat tipini, boru çapını (kütüphaneden) ve boğaz çapını / β'yı girin.</li>
        <li><b>Akışkan</b> sekmesinde sıvı/gaz seçin; viskozite zorunludur. Sıcaklığa bağlı özellikler için CSV içe aktarın.</li>
        <li>Göstergeler, ölçekli çizim, performans eğrisi ve formül paneli anında güncellenir. <b>What-If</b> kaydırıcısı ile çalışma noktasını değiştirin.</li>
        <li><b>Canlı</b> sekmesinden InfluxDB v1 bağlantısını kurun; ölçülen ΔP grafikte kırmızı nokta olarak görünür. Debi sensörü eklenirse sapma, belirsizlik sınırına göre değerlendirilir.</li>
        <li><b>JSON Yedekle</b> ile tüm ayarları saklayın, <b>PDF Rapor</b> ile A4 raporu indirin.</li>
        <li><b>Venturi</b> seçici (üst çubuk): Her venturinin verisi ayrı saklanır. <b>＋</b> yeni venturi, <b>⧉</b> mevcut venturinin kopyası, <b>☰ Venturiler</b> listeleme, yeniden adlandırma, not, silme ve tek venturi dışa/içe aktarma.</li>
        <li><b>Kalibrasyon &amp; PLC</b> ekranı: Coriolis referanslı test noktalarından 6 farklı model uydurulur, çapraz doğrulamayla en uygunu önerilir ve TwinCAT 3 / IEC ST kodu üretilir.</li>
        <li><b>☁ Ortak</b> düğmesi: ortak parola bir kez girildiğinde tasarımlar GitHub üzerinden tüm bilgisayarlarla otomatik eşitlenir. Parolası olmayan bilgisayarlar salt okunur çalışır.</li></ol>
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
    renderVenturiSelect();
    fxSig = '';
    recalc();
    showView(state.view);
  }

  let liveBound = false;
  function bindLiveFields() {
    if (!liveBound) { bindLiveTab(); liveBound = true; return; }
    const ix = state.influx;
    const set = (id, v) => { const el = $(id); if (el.type === 'checkbox') el.checked = !!v; else el.value = v; };
    set('ixUrl', ix.url); set('ixDb', ix.db); set('ixUser', ix.user); set('ixPass', ix.pass); set('ixMeas', ix.measurement);
    set('ixNameMode', ix.nameMode); set('ixTagKey', ix.tagKey); set('ixValueField', ix.valueField);
    set('ixRateMs', ix.rateMs); set('ixWindow', ix.windowMin); set('maNewOnly', ix.newOnly);
    $('ixTagOpts').hidden = ix.nameMode !== 'tag';
    renderSensors();
    checkMixed();
  }

  /* ---------- Çoklu venturi ---------- */
  const vid = () => 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const activeVenturi = () => state.venturis.find(v => v.id === state.activeVenturi);

  function uniqueName(base) {
    const names = new Set(state.venturis.map(v => v.name));
    if (!names.has(base)) return base;
    for (let i = 2; ; i++) if (!names.has(`${base} (${i})`)) return `${base} (${i})`;
  }

  /** Başka bir venturiye geçer: mevcut çalışma alanı kaydedilir, seçilenin verisi yüklenir */
  function switchVenturi(id) {
    if (id === state.activeVenturi) return;
    const rec = state.venturis.find(v => v.id === id);
    if (!rec) return;
    snapshotVenturi();
    stopLive(true);
    resetAvg();
    live.trail = []; live.point = null;
    state.activeVenturi = id;
    loadVData(state, rec.data);
    initUI();
    save();
    UI.toast(`"${rec.name}" açıldı`, 'ok');
  }

  /** Yeni venturi: copyFromId verilirse onun kopyası, yoksa varsayılan değerler */
  function newVenturi(copyFromId, name) {
    snapshotVenturi();
    const src = copyFromId && state.venturis.find(v => v.id === copyFromId);
    const now = new Date().toISOString();
    const rec = {
      id: vid(),
      name: uniqueName(name || (src ? src.name + ' — kopya' : `Venturi ${state.venturis.length + 1}`)),
      note: src ? src.note : '',
      created: now, updated: now,
      data: src ? clone(src.data) : pickV(defaults())
    };
    state.venturis.push(rec);
    state.activeVenturi = rec.id;
    loadVData(state, rec.data);
    stopLive(true); resetAvg();
    initUI(); save();
    UI.toast(src ? `Kopya oluşturuldu: "${rec.name}"` : `Yeni venturi: "${rec.name}"`, 'ok');
    return rec;
  }

  function deleteVenturi(id) {
    if (state.venturis.length <= 1) { UI.toast('Son venturi silinemez.', 'err'); return false; }
    const i = state.venturis.findIndex(v => v.id === id);
    if (i < 0) return false;
    state.venturis.splice(i, 1);
    if (id === state.activeVenturi) {
      state.activeVenturi = state.venturis[Math.max(0, i - 1)].id;
      loadVData(state, activeVenturi().data);
      stopLive(true); resetAvg();
      initUI();
    } else renderVenturiSelect();
    save();
    return true;
  }

  function updateVenturiMeta(id, patch) {
    const rec = state.venturis.find(v => v.id === id);
    if (!rec) return;
    if (patch.name !== undefined) rec.name = patch.name.trim() || rec.name;
    if (patch.note !== undefined) rec.note = patch.note;
    rec.updated = new Date().toISOString();
    renderVenturiSelect(); save();
  }

  /** Tek venturiyi (kullandığı akışkan tanımıyla birlikte) JSON dosyası olarak indirir */
  function exportVenturi(id) {
    snapshotVenturi();
    const rec = state.venturis.find(v => v.id === id);
    if (!rec) return;
    const fluid = state.fluids.find(f => f.id === rec.data.activeFluid);
    download(`venturi_${rec.name.replace(/[^\wçğıöşüÇĞİÖŞÜ-]+/g, '_')}.json`,
      { app: 'VenturiFlow Master', kind: 'venturi', version: 2, exportedAt: new Date().toISOString(), venturi: rec, fluid: fluid || null });
  }

  /** Tek venturi dosyasını yeni bir kayıt olarak ekler */
  function importVenturi(obj) {
    const rec = clone(obj.venturi);
    if (!rec || !rec.data) throw new Error('Venturi verisi bulunamadı.');
    if (obj.fluid && !state.fluids.find(f => f.id === obj.fluid.id)) state.fluids.push(clone(obj.fluid));
    snapshotVenturi();
    rec.id = vid();
    rec.name = uniqueName(rec.name || 'İçe aktarılan venturi');
    rec.updated = new Date().toISOString();
    state.venturis.push(rec);
    state.activeVenturi = rec.id;
    loadVData(state, rec.data);
    stopLive(true); resetAvg();
    initUI(); save();
    UI.toast(`"${rec.name}" içe aktarıldı`, 'ok');
  }

  function download(name, obj) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function renderVenturiSelect() {
    const sel = $('selVenturi');
    if (!sel) return;
    sel.innerHTML = state.venturis.map(v => `<option value="${esc(v.id)}">${esc(v.name)}</option>`).join('');
    sel.value = state.activeVenturi;
    const rec = activeVenturi();
    $('stVenturi').textContent = rec ? 'Venturi: ' + rec.name : '';
  }

  /* ---------- Görünüm: Tasarım & İzleme / Kalibrasyon & PLC ---------- */
  function showView(v) {
    state.view = v === 'calib' ? 'calib' : 'main';
    $('viewMain').hidden = state.view !== 'main';
    $('viewCalib').hidden = state.view !== 'calib';
    document.querySelectorAll('#viewSeg button').forEach(b => b.classList.toggle('on', b.dataset.view === state.view));
    save();
    if (state.view === 'calib') VF.CalibUI.onShow();
    else if (lastCalc) renderDrawing(lastCalc.res, lastCalc.c);
  }

  // Hata ayıklama için: konsoldan VF.state
  Object.defineProperty(VF, 'state', { get: () => state });
  VF.App = {
    get state() { return state; },
    switchVenturi, newVenturi, deleteVenturi, updateVenturiMeta, exportVenturi, importVenturi, snapshotVenturi, activeVenturi,
    showMixedGuide, recalc, save, context, activeFluid, showView, selectTab,
    toast: (m, k) => UI.toast(m, k), modal: o => UI.modal(o)
  };

  function selectTab(t) {
    state.tab = t;
    document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
    document.querySelectorAll('.tab').forEach(s => s.classList.toggle('on', s.id === 'tab-' + t));
    if (t === 'fluid' && lastCalc) renderFluidChart(lastCalc.c);
    save();
  }

  function bindOnce() {
    $('tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) selectTab(b.dataset.tab); });
    $('viewSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) showView(b.dataset.view); });
    VF.CalibUI.init(VF.App);
    VF.VenturiUI.init(VF.App);
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
    if (VF.Sync) VF.Sync.init({ getSharedJson, applyShared, toast: UI.toast, modal: UI.modal });
    // MathJax asenkron yüklenir; hazır olduğunda formülleri dizgele
    const waitMJ = setInterval(() => {
      if (window.MathJax && MathJax.typesetPromise) { clearInterval(waitMJ); fxSig = ''; lastCalc && renderFormulas(lastCalc.res, lastCalc.c); }
    }, 250);
    setTimeout(() => clearInterval(waitMJ), 20000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window.VF = window.VF || {});
