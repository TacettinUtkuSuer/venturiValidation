/* VenturiFlow Master — Durum yönetimi
 *
 * Yapı:
 *   - Global (tüm venturiler için ortak): akışkan kütüphanesi (fluids).
 *   - Venturi kaydı: VKEYS'teki her şey (tasarım, birimler, InfluxDB, sensörler, kalibrasyon…).
 *     Aktif venturinin verisi "çalışma alanı" olarak state'in üst düzeyinde tutulur;
 *     her kayıtta (save) kaydına yazılır (snapshotVenturi).
 *   - Yerel (bu bilgisayar): tema, açık sekme/görünüm, aktif venturi, InfluxDB parolaları.
 */
(function (VF) {
  'use strict';
  const F = VF.Fluids;
  const STORE_KEY = 'venturiflow.state.v1';
  const clone = o => JSON.parse(JSON.stringify(o));

  /* ---------- Giriş alanı şeması — değerler {v, u} (girilen birimde) saklanır ---------- */
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

  // Venturiye özel alanlar
  const VKEYS = ['method', 'mfg', 'fitting', 'inputs', 'activeFluid', 'measured', 'whatIf', 'calib', 'sensors',
    'units', 'fluidUnits', 'influx', 'conv', 'fluidChart', 'trend'];
  // v1.4'te global olup v1.5'te venturiye taşınanlar
  const MOVED_TO_VENTURI = ['units', 'fluidUnits', 'influx', 'conv', 'fluidChart'];
  // Bu bilgisayara özel (ortak kayda yazılmaz)
  const LOCAL_KEYS = ['theme', 'tab', 'view', 'activeVenturi', 'chartTab'];

  function defaults() {
    const inputs = {};
    for (const k in INPUTS) inputs[k] = { ...INPUTS[k].def };
    return {
      v: 2,
      theme: 'dark', tab: 'design', view: 'main', chartTab: 'curve',
      fluids: clone(F.BUILTIN),
      venturis: [], activeVenturi: null,
      // ---- venturiye özel (çalışma alanı) ----
      method: 'iso', mfg: 'machined', fitting: 'bend90',
      inputs,
      units: { flow: 'm3/h', pressure: 'mbar', length: 'mm', temperature: 'C', density: 'kg/m3', viscosity: 'cP' },
      fluidUnits: { rho: 'kg/m3', mu: 'cP', pv: 'kPa' },
      activeFluid: 'water',
      measured: [],
      whatIf: 70,
      influx: {
        url: 'http://10.10.2.6:8086', db: 'lc_100', user: '', pass: '', measurement: 'telemetry',
        rateMs: 1000, windowMin: 5,
        nameMode: 'field', tagKey: 'name', valueField: 'value',
        newOnly: true
      },
      sensors: defaultSensors(),
      conv: { dim: 'flow', v: 1, from: 'm3/h' },
      fluidChart: { prop: 'rho' },
      trend: { minutes: 10 },
      calib: {
        rows: [],
        units: { q: 'kg/h', dp: 'mbar', T: 'C', rho: 'kg/m3', p1: 'bar' },
        TminK: 283.15, TmaxK: 353.15,
        refAcc: 0.1,
        model: 'auto',
        apply: false,
        codeTab: 'tc',
        plc: { name: 'FB_VenturiFlow', dpUnit: 'mbar', p1Unit: 'bar', lowCut: 3 },
        hist: { hours: 6, groupSec: 10, stableSec: 120, cvQ: 0.5, cvDp: 1.0, minFlowPct: 5 }
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

  const pickV = s => { const o = {}; VKEYS.forEach(k => { o[k] = clone(s[k]); }); return o; };

  /** Venturi kaydındaki veriyi çalışma alanına yükler (eksikler varsayılandan) */
  function loadVData(s, data) {
    const d = defaults();
    VKEYS.forEach(k => { s[k] = merge(d[k], data ? clone(data[k]) : undefined); });
    if (!s.fluids.find(f => f.id === s.activeFluid)) s.activeFluid = s.fluids[0].id;
  }

  /** Eski sürüm kayıtlarını yeni yapıya taşır ve venturi listesini garanti eder.
   *  s: merge(defaults(), raw) — raw: ham kayıt */
  function migrate(s, raw) {
    raw = raw || {};
    const ix = raw.influx || {};
    // v1.3 → v1.4: InfluxDB ve sensör ayarları
    if (ix.rate && !ix.rateMs) s.influx.rateMs = ix.rate * 1000;
    if (ix.db === 'db') s.influx.db = 'lc_100';
    if (ix.measurement === 'venturi') s.influx.measurement = 'telemetry';
    ['dp', 'q', 'T', 'rho', 'avg', 'rate'].forEach(k => delete s.influx[k]);
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
    // ≤ v1.3: venturi listesi yok → tek venturi
    if (!Array.isArray(s.venturis) || !s.venturis.length) {
      const id = 'v' + Date.now().toString(36);
      const now = new Date().toISOString();
      s.venturis = [{ id, name: 'Venturi 1', note: '', created: now, updated: now, data: pickV(s) }];
      s.activeVenturi = id;
    }
    // v1.4 → v1.5: global birimler / InfluxDB / dönüştürücü / grafik → her venturiye
    s.venturis.forEach(v => {
      v.data = v.data || {};
      MOVED_TO_VENTURI.forEach(k => { if (v.data[k] === undefined) v.data[k] = clone(s[k]); });
    });
    if (!s.venturis.find(v => v.id === s.activeVenturi)) s.activeVenturi = s.venturis[0].id;
    loadVData(s, s.venturis.find(v => v.id === s.activeVenturi).data);
    return s;
  }

  /* ---------- Durum ---------- */
  let state;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    state = migrate(merge(defaults(), parsed || {}), parsed);
  } catch (e) { console.warn('Kayıtlı durum okunamadı', e); state = migrate(defaults()); }

  // Uygulamanın bağladığı geri çağrılar
  const hooks = { reload() {}, beforeReload() {}, listChanged() {}, saved() {}, toast() {} };

  const activeVenturi = () => state.venturis.find(v => v.id === state.activeVenturi);
  const activeFluid = () => state.fluids.find(f => f.id === state.activeFluid) || state.fluids[0];

  /** Çalışma alanını aktif venturi kaydına yazar */
  function snapshotVenturi() {
    const rec = activeVenturi();
    if (!rec) return;
    const data = pickV(state);
    if (JSON.stringify(data) !== JSON.stringify(rec.data)) { rec.data = data; rec.updated = new Date().toISOString(); }
  }

  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 300);
  }
  function saveNow() {
    clearTimeout(saveTimer);
    snapshotVenturi();
    let ok = true;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { ok = false; }
    hooks.saved(ok);
    if (VF.Sync) VF.Sync.notifyChange();
  }

  /* ---------- Ortak kayıt (GitHub) için paylaşılan durum ---------- */
  /** Ortak dosyaya gidecek nesne: akışkanlar + venturiler (parolasız) */
  function getSharedState() {
    snapshotVenturi();
    const s = clone(state);
    LOCAL_KEYS.concat(VKEYS).forEach(k => delete s[k]);
    s.venturis.forEach(v => { if (v.data && v.data.influx) v.data.influx.pass = ''; });
    return s;
  }
  const getSharedJson = () => JSON.stringify(getSharedState());

  /** Ortak kaydı uygular (yerel ayarlar ve InfluxDB parolaları korunur).
   *  mergeLocal: bu bilgisayarın düzenlenmiş venturileri ortak listede yoksa eklenir. */
  function applyShared(remote, mergeLocal) {
    snapshotVenturi();
    const blank = JSON.stringify(pickV(defaults()));
    const localV = mergeLocal ? clone(state.venturis.filter(v => JSON.stringify(v.data) !== blank)) : [];
    const passes = {};
    state.venturis.forEach(v => { if (v.data && v.data.influx && v.data.influx.pass) passes[v.id] = v.data.influx.pass; });
    const keep = {};
    LOCAL_KEYS.forEach(k => { keep[k] = state[k]; });
    const beforeActive = JSON.stringify(activeVenturi() ? activeVenturi().data : null);
    const beforeFluids = JSON.stringify(state.fluids);

    const s = merge(defaults(), remote);
    LOCAL_KEYS.forEach(k => { if (keep[k] !== undefined) s[k] = keep[k]; });
    s.venturis = (s.venturis || []).map(v => {
      if (v.data && v.data.influx && passes[v.id]) v.data.influx.pass = passes[v.id];
      return v;
    });
    const next = migrate(s, remote);
    let added = 0;
    localV.forEach(v => {
      if (next.venturis.some(x => x.id === v.id)) return;
      v.name = uniqueName(v.name, next.venturis);
      next.venturis.push(v); added++;
    });
    const afterActive = JSON.stringify(next.venturis.find(v => v.id === next.activeVenturi).data);
    const needReload = beforeActive !== afterActive || beforeFluids !== JSON.stringify(next.fluids) || keep.activeVenturi !== next.activeVenturi;
    if (needReload) hooks.beforeReload();
    state = next;
    if (needReload) hooks.reload(); else hooks.listChanged();
    return added;
  }

  /** Hiç dokunulmamış varsayılan venturi mi? (ilk ortak eşitlemede taşınmaz) */
  function isBlankVenturi(v) {
    const a = clone(v.data || {}), b = pickV(defaults());
    [a, b].forEach(x => { if (x.influx) x.influx.pass = ''; });
    return JSON.stringify(a) === JSON.stringify(b);
  }

  /* ---------- Çoklu venturi ---------- */
  const vid = () => 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

  function uniqueName(base, list) {
    const names = new Set((list || state.venturis).map(v => v.name));
    if (!names.has(base)) return base;
    for (let i = 2; ; i++) if (!names.has(`${base} (${i})`)) return `${base} (${i})`;
  }

  function open(rec, msg) {
    hooks.beforeReload();
    state.activeVenturi = rec.id;
    loadVData(state, rec.data);
    hooks.reload();
    saveNow();
    if (msg) hooks.toast(msg, 'ok');
  }

  function switchVenturi(id) {
    if (id === state.activeVenturi) return;
    const rec = state.venturis.find(v => v.id === id);
    if (!rec) return;
    snapshotVenturi();
    open(rec, `"${rec.name}" açıldı`);
  }

  /** Yeni venturi: copyFromId verilirse onun kopyası, yoksa varsayılan değerler */
  function newVenturi(copyFromId, name) {
    snapshotVenturi();
    const src = copyFromId && state.venturis.find(v => v.id === copyFromId);
    const now = new Date().toISOString();
    const data = src ? clone(src.data) : pickV(defaults());
    if (!src) {
      // Yeni venturi, açık olanın bağlantı ve gösterim ayarlarını devralır (sensör adları hariç)
      ['units', 'fluidUnits', 'influx'].forEach(k => { data[k] = clone(state[k]); });
    }
    const rec = {
      id: vid(),
      name: uniqueName(name || (src ? src.name + ' — kopya' : `Venturi ${state.venturis.length + 1}`)),
      note: src ? src.note : '', created: now, updated: now, data
    };
    state.venturis.push(rec);
    open(rec, src ? `Kopya oluşturuldu: "${rec.name}"` : `Yeni venturi: "${rec.name}"`);
    return rec;
  }

  function deleteVenturi(id) {
    if (state.venturis.length <= 1) { hooks.toast('Son venturi silinemez.', 'err'); return false; }
    const i = state.venturis.findIndex(v => v.id === id);
    if (i < 0) return false;
    state.venturis.splice(i, 1);
    if (id === state.activeVenturi) open(state.venturis[Math.max(0, i - 1)]);
    else { hooks.listChanged(); saveNow(); }
    return true;
  }

  function updateVenturiMeta(id, patch) {
    const rec = state.venturis.find(v => v.id === id);
    if (!rec) return;
    if (patch.name !== undefined) rec.name = patch.name.trim() || rec.name;
    if (patch.note !== undefined) rec.note = patch.note;
    rec.updated = new Date().toISOString();
    hooks.listChanged(); save();
  }

  /** Tek venturi (kullandığı akışkanla) — dışa aktarma nesnesi */
  function exportVenturiObj(id) {
    snapshotVenturi();
    const rec = state.venturis.find(v => v.id === id);
    if (!rec) return null;
    const out = clone(rec);
    if (out.data.influx) out.data.influx.pass = '';
    const fluid = state.fluids.find(f => f.id === rec.data.activeFluid);
    return { app: 'VenturiFlow Master', kind: 'venturi', version: 3, exportedAt: new Date().toISOString(), venturi: out, fluid: fluid || null };
  }

  /** Tek venturi dosyasını yeni bir kayıt olarak ekler */
  function importVenturi(obj) {
    const rec = clone(obj.venturi);
    if (!rec || !rec.data) throw new Error('Venturi verisi bulunamadı.');
    if (obj.fluid && !state.fluids.find(f => f.id === obj.fluid.id)) state.fluids.push(clone(obj.fluid));
    snapshotVenturi();
    MOVED_TO_VENTURI.forEach(k => { if (rec.data[k] === undefined) rec.data[k] = clone(state[k]); });
    rec.id = vid();
    rec.name = uniqueName(rec.name || 'İçe aktarılan venturi');
    rec.updated = new Date().toISOString();
    state.venturis.push(rec);
    open(rec, `"${rec.name}" içe aktarıldı`);
  }

  /** Tam yedeği (tüm venturiler + akışkanlar) yükler */
  function importFull(s) {
    hooks.beforeReload();
    const keep = {};
    LOCAL_KEYS.forEach(k => { keep[k] = state[k]; });
    state = migrate(merge(defaults(), s), s);
    ['theme'].forEach(k => { state[k] = keep[k]; });
    hooks.reload();
    saveNow();
  }

  function fullBackup() {
    snapshotVenturi();
    return { app: 'VenturiFlow Master', kind: 'full', version: 3, exportedAt: new Date().toISOString(), state };
  }

  VF.Store = {
    get state() { return state; },
    INPUTS, VKEYS, LOCAL_KEYS, hooks, clone, merge, defaults,
    save, saveNow, snapshotVenturi, activeVenturi, activeFluid,
    getSharedState, getSharedJson, applyShared, isBlankVenturi,
    switchVenturi, newVenturi, deleteVenturi, updateVenturiMeta, exportVenturiObj, importVenturi, importFull, fullBackup, uniqueName
  };
  // Hata ayıklama için: konsoldan VF.state
  Object.defineProperty(VF, 'state', { get: () => state, configurable: true });
})(window.VF = window.VF || {});
