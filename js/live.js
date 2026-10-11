/* VenturiFlow Master — Canlı telemetri (InfluxDB v1): sensörler, a·x+b düzeltme,
 * sensör başına hareketli ortalama, ΔP sıfırlama, canlı nokta ve trend verisi */
(function (VF) {
  'use strict';
  const U = VF.Units, P = VF.Physics, F = VF.Fluids;
  const $ = id => document.getElementById(id);
  const esc = s => VF.CSV.esc(s);
  const st = () => VF.Store.state;
  const A = () => VF.App;

  /* ============================================================
   * Canlı telemetri (InfluxDB v1)
   * ============================================================ */
  const live = { running: false, demo: false, timer: null, point: null, trail: [], mixedShown: false, phase: 0, buf: {}, lastTs: {}, raw: {}, val: {}, time: null, stale: {}, hist: [] };
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
  const SL = () => st().sensors.list;
  /** Sensör kullanılıyor mu? (ΔP moduna göre zorunlu olanlar her zaman açık) */
  function sensorOn(key) {
    const m = st().sensors.dpMode;
    if (key === 'dp') return m === 'direct';
    if (key === 'p2') return m === 'diff';
    if (key === 'p1' && m === 'diff') return true;
    return !!SL()[key].enabled;
  }
  const sensorReq = key => (key === 'dp' && st().sensors.dpMode === 'direct') || ((key === 'p1' || key === 'p2') && st().sensors.dpMode === 'diff');

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
    $('dpModeSeg').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === st().sensors.dpMode));
    $('pGaugeSeg').querySelectorAll('button').forEach(b => b.classList.toggle('on', (b.dataset.v === '1') === !!st().sensors.pGauge));
    $('ixSensors').innerHTML = SENSORS.map(s => {
      const c = L[s.key], on = sensorOn(s.key), req = sensorReq(s.key);
      const hidden = (s.key === 'dp' && st().sensors.dpMode === 'diff') || (s.key === 'p2' && st().sensors.dpMode === 'direct');
      if (hidden) return '';
      const mv = maValue(c.avg);
      return `<div class="sensor ${on ? '' : 'off'}" data-s="${s.key}">
        <label class="sh">${req ? '<input type="checkbox" checked disabled>' : `<input type="checkbox" data-f="enabled" ${c.enabled ? 'checked' : ''}>`} ${s.name}${req ? ' <span class="req">*</span>' : ''}
          ${s.key === 'p1' && !req ? '<span class="hint">canlı p₁ için</span>' : ''}
          ${zeroable(s.key) ? `<button class="btn sm zero" data-zero="${s.key}" title="Akış yokken ΔP'yi sıfırlar: ofset (b) otomatik hesaplanır">⊘ ΔP sıfırla</button>` : ''}</label>
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

  /** Sıfırlama düğmesi: doğrudan modda ΔP kartında, P1−P2 modunda P2 kartında */
  const zeroable = key => (key === 'dp' && st().sensors.dpMode === 'direct') || (key === 'p2' && st().sensors.dpMode === 'diff');

  /** Akış yokken ΔP sıfır olacak şekilde ofseti (b) ayarlar */
  function zeroDp() {
    const v = live.val, L = SL();
    const diff = st().sensors.dpMode === 'diff';
    const need = diff ? ['p1', 'p2'] : ['dp'];
    if (!live.running || need.some(k => !isFinite(v[k]))) return VF.UI.toast('Sıfırlama için canlı veri gerekli (önce ▶ Başlat veya Demo).', 'err');
    const n = Math.min(...need.map(avgCount));
    const dpNow = diff ? v.p1 - v.p2 : v.dp;
    const key = diff ? 'p2' : 'dp';
    const c = L[key];
    const shift = U.fromSI('pressure', dpNow, c.unit);   // basınç birimleri ofsetsiz → fark doğrudan çevrilir
    const msg = `Şu anki ΔP = ${A().D.p(dpNow)} ${A().D.pu()} (ortalama ${n} veri).\n\nAkış GERÇEKTEN DURMUŞ mu? Onaylarsanız ${diff ? 'P2' : 'ΔP'} sensörünün ofseti b = ${U.fmt(c.b, 5)} → ${U.fmt(diff ? c.b + shift : c.b - shift, 5)} ${U.label('pressure', c.unit)} yapılacak.`;
    if (!confirm(msg)) return;
    c.b = diff ? c.b + shift : c.b - shift;
    resetAvg(key);
    renderSensors(); VF.Store.save(); liveRender();
    log(`ΔP sıfırlandı: ${key.toUpperCase()} b = ${U.fmt(c.b, 6)} ${U.label('pressure', c.unit)}`, 'o');
    VF.UI.toast('ΔP sıfırlandı. Yeni ofset kaydedildi.', 'ok');
  }

  function bindLiveTab() {
    const ix = () => st().influx;
    const bind = (id, get, set) => { const el = $(id); get(el); el.addEventListener(el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input', () => { set(el); VF.Store.save(); checkMixed(); }); };
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
    $('dpModeSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; st().sensors.dpMode = b.dataset.v; resetAvg(); renderSensors(); VF.Store.save(); liveRecompute(false); });
    $('pGaugeSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; st().sensors.pGauge = b.dataset.v === '1'; renderSensors(); VF.Store.save(); liveRecompute(false); });
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
      VF.Store.save(); liveRecompute(false);
    };
    $('ixSensors').addEventListener('input', e => { if (e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') onSensor(e); });
    $('ixSensors').addEventListener('click', e => { if (e.target.closest('[data-zero]')) { e.preventDefault(); zeroDp(); } });
    $('ixSensors').addEventListener('change', e => { if (e.target.tagName === 'SELECT' || e.target.type === 'checkbox') onSensor(e); });
    $('maReset').onclick = () => { resetAvg(); liveRecompute(false); VF.UI.toast('Ortalama tamponları sıfırlandı', 'ok'); };
    $('btnToCal').onclick = () => {
      const v = currentValues();
      if (!live.running || !(v.dp > 0) || !(v.q > 0)) return VF.UI.toast('Kalibrasyon noktası için ΔP ve Coriolis debi sensörlerinden canlı veri gerekli.', 'err');
      VF.CalibUI.addFromLive({ qm: v.q, dp: v.dp, T: v.T, rho: v.rho, p1: v.p1 });
      VF.UI.toast(`Kalibrasyona eklendi: ${A().D.flow(v.q, { rho: v.rho || 1000 })} ${A().D.fu()} · ${A().D.p(v.dp)} ${A().D.pu()}`, 'ok');
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
        VF.UI.toast('InfluxDB bağlantısı başarılı', 'ok');
      } catch (e) { handleErr(e); }
    };
    $('btnLive').onclick = () => live.running && !live.demo ? stopLive() : startLive(false);
    $('btnDemo').onclick = () => live.running && live.demo ? stopLive() : startLive(true);
    checkMixed();
  }

  /** Sorgulanacak sensörler → InfluxQL parametreleri */
  function sensorsList() {
    const ix = st().influx;
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
    if (!(st().influx.newOnly && ts !== undefined && live.lastTs[key] === ts && b.length)) b.push(v);
    live.lastTs[key] = ts;
    trimAvg(key);
  }
  /** Ham sensör değeri → a·x+b → SI (geçmiş veri için de kullanılır) */
  function rawToSI(key, rawUnit, ctx) {
    const c = SL()[key], s = SENSORS.find(x => x.key === key);
    return U.toSI(s.dim, c.a * rawUnit + c.b, c.unit, ctx);
  }

  /** Demo için: SI değerden sensörün ham çıkışını üretir (a·x+b'nin tersi) */
  function rawFromSI(key, v, ctx) {
    const c = SL()[key], s = SENSORS.find(x => x.key === key);
    return (U.fromSI(s.dim, v, c.unit, ctx) - c.b) / (c.a || 1);
  }
  const avgCount = k => (live.buf[k] || []).length;
  const pAbs = v => v + (st().sensors.pGauge ? PATM : 0);

  /** Ortalaması alınmış güncel değerler (SI) */
  function currentValues() {
    const v = live.val;
    const dp = st().sensors.dpMode === 'diff'
      ? (isFinite(v.p1) && isFinite(v.p2) ? v.p1 - v.p2 : undefined)
      : v.dp;
    return {
      dp, p1: sensorOn('p1') && isFinite(v.p1) ? pAbs(v.p1) : undefined,
      q: sensorOn('q') ? v.q : undefined, T: sensorOn('T') ? v.T : undefined, rho: sensorOn('rho') ? v.rho : undefined
    };
  }

  function checkMixed() {
    $('mixedWarn').classList.toggle('show', VF.Influx.isMixed(st().influx));
  }

  function handleErr(e) {
    log('HATA: ' + e.message, 'e');
    setLed('err', 'Telemetri hatası');
    if (e.kind === 'mixed' || (VF.Influx.isMixed(st().influx) && e.kind === 'network')) {
      if (!live.mixedShown) { live.mixedShown = true; showMixedGuide(); }
      stopLive(true);
    } else if (e.kind === 'network') {
      VF.UI.toast('InfluxDB\'ye ulaşılamadı. URL, ağ ve CORS ayarlarını kontrol edin.', 'err');
    }
  }

  function startLive(demo) {
    stopLive(true);
    live.running = true; live.demo = demo; live.trail = []; live.mixedShown = false;
    resetAvg();
    $('btnLive').textContent = demo ? '▶ Başlat' : '■ Durdur';
    $('btnDemo').textContent = demo ? '■ Demo Durdur' : 'Demo Modu';
    setLed(demo ? 'demo' : 'on', demo ? 'Demo verisi' : 'Bağlanıyor…');
    log(demo ? 'Demo modu başladı (sentetik veri)' : `Sorgulama başladı · ${st().influx.rateMs} ms aralık`);
    if (!demo) sensorsList().forEach(s => log('InfluxQL: ' + VF.Influx.sensorQuery(st().influx, s)));
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
        if (!A().lastCalc) throw new Error('Geçerli tasarım yok');
        // Zaman tabanlı yavaş değişim (yenileme periyodundan bağımsız)
        live.phase = Date.now() / 1000;
        const { res, c } = A().lastCalc;
        const base = c.qMax * (0.55 + 0.25 * Math.sin(live.phase / 45));
        const T = c.inp.T + 15 * Math.sin(live.phase / 180);
        const pr = F.resolve(VF.Store.activeFluid(), T, c.inp.p1);
        const ctx = { rho: pr.rho };
        let dp = res.model.dpFromFlow(base) * (pr.rho > 0 ? c.fl.rho / pr.rho : 1);
        if (VF.CalibUI.active()) {
          for (let k = 0; k < 6; k++) { const q = VF.CalibUI.predict(dp, pr.rho, pr.mu, c.inp.p1); if (q > 0) dp *= Math.pow(base / q, 2); }
        }
        dp *= 1 + (Math.random() - 0.5) * 0.02;
        const ts = Date.now();
        const p1g = c.inp.p1 - (st().sensors.pGauge ? PATM : 0);
        if (sensorOn('dp')) feed('dp', rawFromSI('dp', dp, ctx), ts, ctx);
        if (sensorOn('p1')) feed('p1', rawFromSI('p1', p1g * (1 + (Math.random() - 0.5) * 0.001), ctx), ts, ctx);
        if (sensorOn('p2')) feed('p2', rawFromSI('p2', p1g - dp, ctx), ts, ctx);
        if (sensorOn('q')) feed('q', rawFromSI('q', base * (1 + 0.004 + (Math.random() - 0.5) * 0.006), ctx), ts, ctx);
        if (sensorOn('T')) feed('T', rawFromSI('T', T + (Math.random() - 0.5) * 0.2, ctx), ts, ctx);
        if (sensorOn('rho')) feed('rho', rawFromSI('rho', pr.rho * (1 + (Math.random() - 0.5) * 0.0004), ctx), ts, ctx);
        live.time = ts;
      } else {
        const data = await VF.Influx.fetchLast(st().influx, sensorsList());
        live.stale = {};
        sensorsList().forEach(s => { if (!data[s.key]) live.stale[s.key] = true; });
        const need = st().sensors.dpMode === 'diff' ? ['p1', 'p2'] : ['dp'];
        const miss = need.filter(k => !data[k]);
        if (miss.length) throw new VF.Influx.InfluxError('nodata', `${miss.map(k => SL()[k].name).join(', ')} için son ${st().influx.windowMin} dk içinde veri yok (sensör adını / measurement'ı kontrol edin).`);
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
    if (live.running) schedule(Math.max(250, st().influx.rateMs - (Date.now() - t0)));
  }

  /** Canlı sıcaklık/yoğunluk/basınca göre akışkan özellikleri */
  function liveProps() {
    const c = A().lastCalc ? A().lastCalc.c : A().context();
    const v = currentValues();
    const T = v.T > 0 ? v.T : c.inp.T;
    const p1 = v.p1 > 0 ? v.p1 : c.inp.p1;
    const pr = F.resolve(VF.Store.activeFluid(), T, p1);
    const rho = v.rho > 0 ? v.rho : pr.rho;
    return { T, p1, rho, mu: pr.mu, pv: pr.pv };
  }

  /** Canlı (ortalama) ΔP'den debi hesabı + grafikteki kırmızı noktanın konumu */
  function liveRecompute(push) {
    const v = currentValues();
    const dp = v.dp;
    if (!A().lastCalc || !(dp > 0) || !live.running) { liveRender(); return; }
    const { c } = A().lastCalc;
    const ctx = c.ctx;
    const pp = liveProps();
    const mTheory = P.model({ ...c.inp, p1: pp.p1, fluid: { ...c.fl, rho: pp.rho, mu: pp.mu } });
    live.qTheory = mTheory.flowFromDp(dp);
    const qCal = VF.CalibUI.predict(dp, pp.rho, pp.mu, pp.p1);
    live.calibrated = qCal !== null;
    live.qCalc = live.calibrated ? qCal : live.qTheory;
    live.qMeas = v.q > 0 ? v.q : null;
    live.cav = c.fl.type === 'liquid' ? pp.p1 - dp - pp.pv : null;
    const qShow = live.qMeas !== null ? live.qMeas : live.qCalc;
    const pt = { x: U.fromSI('flow', qShow, st().units.flow, ctx), y: U.fromSI('pressure', dp, st().units.pressure) };
    live.dev = live.qMeas !== null && live.qCalc > 0 ? (live.qMeas - live.qCalc) / live.qCalc * 100 : null;
    pt.label = `${U.fmt(pt.x, 4)} ${A().D.fu()} · ${U.fmt(pt.y, 4)} ${A().D.pu()}` + (live.dev !== null ? ` · Δ ${live.dev >= 0 ? '+' : ''}${live.dev.toFixed(2)}%` : '');
    live.point = pt;
    if (push) {
      live.trail.push({ x: pt.x, y: pt.y, qSI: qShow, dpSI: dp });
      if (live.trail.length > 40) live.trail.shift();
      // Zaman trendi için geçmiş (en fazla ~20 000 okuma)
      live.hist.push({ t: live.demo ? Date.now() : (live.time || Date.now()), dp, qCalc: live.qCalc, qTheory: live.qTheory, qMeas: live.qMeas, T: pp.T, dev: live.dev });
      if (live.hist.length > 20000) live.hist.splice(0, live.hist.length - 20000);
      if (VF.Trend) VF.Trend.onData();
    } else {
      live.trail = live.trail.map(t => ({ ...t, x: U.fromSI('flow', t.qSI, st().units.flow, ctx), y: U.fromSI('pressure', t.dpSI, st().units.pressure) }));
    }
    VF.ChartView.updateLive(pt, live.trail.slice(0, -1));
    liveRender();
  }

  function liveRender() {
    const box = $('liveVals');
    if (!box) return;
    const ctx = A().lastCalc ? A().lastCalc.c.ctx : { rho: 1000 };
    const v = currentValues();
    const has = live.running && v.dp > 0;
    // Her sensör kartının altında ham / düzeltilmiş / ortalama değer
    SENSORS.forEach(s => {
      const el = document.querySelector(`[data-sv="${s.key}"]`);
      if (!el) return;
      const c = SL()[s.key];
      if (!live.running || !sensorOn(s.key)) { el.textContent = ''; return; }
      if (live.stale[s.key]) { el.innerHTML = `<span class="badv">veri yok (son ${st().influx.windowMin} dk)</span>`; return; }
      const raw = live.raw[s.key];
      if (raw === undefined) { el.textContent = 'bekleniyor…'; return; }
      const avg = live.val[s.key];
      const ul = U.label(s.dim, c.unit);
      const avgU = avg !== undefined ? U.fromSI(s.dim, avg, c.unit, { rho: v.rho || ctx.rho }) : NaN;
      el.innerHTML = `ham <b>${U.fmt(raw, 5)}</b>${c.a !== 1 || c.b !== 0 ? ` → düz. <b>${U.fmt(c.a * raw + c.b, 5)}</b>` : ''} · ort. <b>${U.fmt(avgU, 5)}</b> ${ul} <span class="hint">(${avgCount(s.key)}/${c.avg.mode === 'all' ? '∞' : avgWindow(s.key)})</span>`;
    });
    const cell = (k, val, sub, cls, title) => `<div ${title ? `title="${esc(title)}"` : ''}><div class="k">${k}</div><div class="v ${cls || ''}">${val}</div>${sub ? `<div class="raw">${sub}</div>` : ''}</div>`;
    const fp = x => `${A().D.p(x)} ${A().D.pu()}`;
    const ft = x => `${U.fmt(U.fromSI('temperature', x, st().units.temperature), 4)} ${U.label('temperature', st().units.temperature)}`;
    const fr = x => `${U.fmt(U.fromSI('density', x, st().units.density), 5)} ${U.label('density', st().units.density)}`;
    const ff = x => `${A().D.flow(x, ctx)} ${A().D.fu()}`;
    const pp = has ? liveProps() : null;
    let devCell = cell('Sapma', '—');
    if (has && live.dev !== null && A().lastCalc) {
      const u = live.calibrated ? VF.CalibUI.uncertainty() : P.uncertainty(A().lastCalc.res.model, A().lastCalc.c.inp, v.dp).total;
      const ok = Math.abs(live.dev) <= u;
      devCell = cell('Sapma (Coriolis − hesap)', `${live.dev >= 0 ? '+' : ''}${live.dev.toFixed(2)}% ${ok ? '✓' : '✗'}`, `sınır ±%${u.toFixed(2)} (${live.calibrated ? 'kalibre' : 'teorik'})`, ok ? 'okv' : 'badv');
    }
    box.innerHTML = [
      cell(st().sensors.dpMode === 'diff' ? 'ΔP = P1 − P2' : 'ΔP (ortalama)', has ? fp(v.dp) : '—', '', 'red'),
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
    VF.UI.modal({
      title: 'Tarayıcı Güvensiz İçerik (Mixed Content) İzin Rehberi',
      wide: true,
      body: `
        <div class="guide-alert"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4m0 4h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/></svg>
        <div>Bu sayfa <b>HTTPS</b> (<code>${esc(origin)}</code>) üzerinden açıldı; InfluxDB adresi ise <b>HTTP</b> (<code>${esc(st().influx.url)}</code>).
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


  let liveBound = false;
  function bindLiveFields() {
    if (!liveBound) { bindLiveTab(); liveBound = true; return; }
    const ix = st().influx;
    const set = (id, v) => { const el = $(id); if (el.type === 'checkbox') el.checked = !!v; else el.value = v; };
    set('ixUrl', ix.url); set('ixDb', ix.db); set('ixUser', ix.user); set('ixPass', ix.pass); set('ixMeas', ix.measurement);
    set('ixNameMode', ix.nameMode); set('ixTagKey', ix.tagKey); set('ixValueField', ix.valueField);
    set('ixRateMs', ix.rateMs); set('ixWindow', ix.windowMin); set('maNewOnly', ix.newOnly);
    $('ixTagOpts').hidden = ix.nameMode !== 'tag';
    renderSensors();
    checkMixed();
  }


  VF.Live = {
    bindFields: bindLiveFields, recompute: liveRecompute, render: liveRender, stop: stopLive, resetAvg,
    showMixedGuide, currentValues, liveProps, sensorOn, sensorsList, rawToSI, PATM,
    get point() { return live.point; }, get trail() { return live.trail; }, get hist() { return live.hist; },
    get running() { return live.running; },
    clearTrail() { live.trail = []; live.point = null; live.hist = []; }
  };
})(window.VF = window.VF || {});
