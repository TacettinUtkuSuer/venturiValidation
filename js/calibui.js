/* VenturiFlow Master — Kalibrasyon ekranı (test verisi → model → PLC katsayıları) */
(function (VF) {
  'use strict';
  const U = VF.Units, C = VF.Calib, F = VF.Fluids;
  const $ = id => document.getElementById(id);
  const esc = s => VF.CSV.esc(s);

  let A = null;              // VF.App
  let an = null;             // son analiz
  let anKey = '';
  let charts = { err: null, cre: null };
  let renderTimer = null;

  const cs = () => A.state.calib;

  /* ---------------- Analiz ---------------- */
  function calibCtx() {
    const c = A.context();
    const m = VF.Physics.model(c.inp);
    return { fluid: A.activeFluid(), p1: c.inp.p1, Tdesign: c.inp.T, D: c.inp.D, d: c.inp.d, Cstd: m.C };
  }

  function analysis() {
    const ctx = calibCtx();
    const key = JSON.stringify([cs().rows, cs().TminK, cs().TmaxK, ctx.D, ctx.d, ctx.p1, ctx.Tdesign, ctx.Cstd, A.activeFluid()]);
    if (key !== anKey) {
      anKey = key;
      an = cs().rows.length ? C.analyze(cs().rows, ctx, { TminK: cs().TminK, TmaxK: cs().TmaxK }) : null;
    }
    return an;
  }

  /** Seçili model sonucu (otomatik → öneri) */
  function selected() {
    const a = analysis();
    if (!a) return null;
    const id = cs().model === 'auto' ? (a.rec && a.rec.model.id) : cs().model;
    const r = a.results.find(x => x.model.id === id);
    return r && r.ok ? r : (a.rec || null);
  }

  /** Canlı izleme / grafik için: kalibre model aktifse debi tahmini */
  function active() {
    if (!cs().apply) return null;
    const r = selected();
    return r ? { r, geo: analysis().geo } : null;
  }

  function predict(dp, rho, mu, p1) {
    const s = active();
    if (!s) return null;
    return C.predict(s.r.model.id, s.r.params, s.geo, dp, rho, mu, p1 > 0 ? p1 : A.context().inp.p1);
  }

  /** Kalibre debi belirsizliği tahmini (%95): referans + model doğrulama saçılması */
  function uncertainty() {
    const r = selected();
    if (!r) return null;
    const rms = r.loo ? r.loo.rms : r.fit.rms;
    return Math.sqrt(Math.pow(cs().refAcc, 2) + Math.pow(2 * rms, 2));
  }

  /* ---------------- Test tablosu ---------------- */
  const COLS = [
    { k: 'qm', dim: 'flow', uk: 'q', name: 'Referans debi', req: true },
    { k: 'dp', dim: 'pressure', uk: 'dp', name: 'ΔP', req: true },
    { k: 'T', dim: 'temperature', uk: 'T', name: 'Sıcaklık' },
    { k: 'rho', dim: 'density', uk: 'rho', name: 'Yoğunluk (ops.)' },
    { k: 'p1', dim: 'pressure', uk: 'p1', name: 'P1 mutlak (gaz)', gas: true }
  ];
  const isGas = () => A.activeFluid().type === 'gas';
  const cols = () => COLS.filter(c => !c.gas || isGas());

  // Satır için yoğunluk bağlamı (hacimsel debi birimleri için)
  function rowRho(r) {
    if (r.rho > 0) return r.rho;
    const c = A.context();
    return F.resolve(A.activeFluid(), r.T > 0 ? r.T : c.inp.T, r.p1 > 0 ? r.p1 : c.inp.p1).rho;
  }

  function cellVal(r, col) {
    const v = r[col.k];
    if (v === null || v === undefined || !(col.k === 'T' ? v > 0 : v > 0)) return '';
    const u = cs().units[col.uk];
    return +U.fromSI(col.dim, v, u, { rho: rowRho(r) }).toPrecision(6);
  }

  function renderTable() {
    const un = cs().units;
    const head = cols().map(col => `<th>${col.name}${col.req ? ' <span class="req">*</span>' : ''}<br>
      <select data-cu="${col.uk}" data-dim="${col.dim}">${U.units(col.dim).map(u => `<option value="${u}" ${un[col.uk] === u ? 'selected' : ''}>${U.label(col.dim, u)}</option>`).join('')}</select></th>`).join('');
    $('calTable').innerHTML = `<thead><tr><th title="Hesaba kat">✓</th><th>#</th>${head}<th>Kaynak</th><th></th></tr></thead>
      <tbody>${cs().rows.map((r, i) => `<tr class="${r.on ? '' : 'off'}" data-row="${i}">
        <td><input type="checkbox" data-on="${i}" ${r.on ? 'checked' : ''}></td>
        <td class="n">${i + 1}</td>
        ${cols().map(col => `<td><input type="number" step="any" data-r="${i}" data-k="${col.k}" value="${cellVal(r, col)}" placeholder="${col.k === 'T' ? 'tasarım T' : col.k === 'rho' ? (isGas() ? 'pM/ZRT' : 'ρ(T)') : col.k === 'p1' ? 'tasarım p₁' : ''}"></td>`).join('')}
        <td class="src">${esc(r.src || 'elle')}</td>
        <td><button class="btn sm icon danger" data-del="${i}" title="Satırı sil">✕</button></td></tr>`).join('')}
      </tbody>`;
    $('calCount').textContent = `${cs().rows.filter(r => r.on).length} / ${cs().rows.length} nokta`;
  }

  function bindTable() {
    const t = $('calTable');
    t.addEventListener('input', e => {
      const el = e.target;
      if (el.dataset.r === undefined) return;
      const r = cs().rows[+el.dataset.r];
      const col = COLS.find(c => c.k === el.dataset.k);
      const v = parseFloat(el.value);
      if (el.value.trim() === '' && !col.req) { r[col.k] = null; }
      else if (isFinite(v)) {
        r[col.k] = U.toSI(col.dim, v, cs().units[col.uk], { rho: rowRho(r) });
        if (col.k === 'qm' || col.k === 'dp') el.classList.toggle('invalid', !(r[col.k] > 0));
      } else { el.classList.add('invalid'); return; }
      el.classList.remove('invalid');
      changed(false);
    });
    t.addEventListener('change', e => {
      const el = e.target;
      if (el.dataset.on !== undefined) { cs().rows[+el.dataset.on].on = el.checked; el.closest('tr').classList.toggle('off', !el.checked); changed(false); }
      if (el.dataset.cu) { cs().units[el.dataset.cu] = el.value; renderTable(); changed(false); }
    });
    t.addEventListener('click', e => {
      const b = e.target.closest('[data-del]');
      if (!b) return;
      cs().rows.splice(+b.dataset.del, 1);
      renderTable(); changed(false);
    });
    // Enter → bir alttaki satır
    t.addEventListener('keydown', e => {
      if (e.key !== 'Enter' || e.target.dataset.r === undefined) return;
      e.preventDefault();
      const nxt = t.querySelector(`[data-r="${+e.target.dataset.r + 1}"][data-k="${e.target.dataset.k}"]`);
      if (nxt) nxt.focus(); else { addRow(); setTimeout(() => { const n = t.querySelector(`[data-r="${cs().rows.length - 1}"][data-k="${e.target.dataset.k}"]`); n && n.focus(); }, 0); }
    });
  }

  function addRow(row) {
    cs().rows.push(Object.assign({ qm: null, dp: null, T: null, rho: null, src: 'elle', on: true }, row || {}));
    renderTable();
    changed(false);
  }

  function changed(full) {
    A.save();
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => { renderResults(); if (full) renderTable(); A.recalc(); }, 120);
  }

  /* ---------------- Ayarlar ---------------- */
  function renderSettings() {
    const tu = cs().units.T;
    const tv = K => +U.fromSI('temperature', K, tu).toFixed(2);
    $('calSettings').innerHTML = `
      <label class="row"><span>Akışkan</span><span class="mono">${esc(A.activeFluid().name)} <a href="#" data-goto-fluid>değiştir</a></span></label>
      <label class="row"><span>İşletme sıcaklığı min</span><div class="inp"><input type="number" step="any" id="calTmin" value="${tv(cs().TminK)}"><span class="unit-static">${U.label('temperature', tu)}</span></div></label>
      <label class="row"><span>İşletme sıcaklığı maks</span><div class="inp"><input type="number" step="any" id="calTmax" value="${tv(cs().TmaxK)}"><span class="unit-static">${U.label('temperature', tu)}</span></div></label>
      <label class="row"><span>Referans (Coriolis) doğruluğu</span><div class="inp"><input type="number" step="0.01" min="0" id="calRef" value="${cs().refAcc}"><span class="unit-static">% okuma</span></div></label>`;
    const onT = (id, key) => $(id).addEventListener('input', e => {
      const v = parseFloat(e.target.value);
      if (!isFinite(v)) return;
      cs()[key] = U.toSI('temperature', v, cs().units.T);
      changed(false);
    });
    onT('calTmin', 'TminK'); onT('calTmax', 'TmaxK');
    $('calRef').addEventListener('input', e => { const v = parseFloat(e.target.value); if (v >= 0) { cs().refAcc = v; changed(false); } });
    $('calSettings').querySelector('[data-goto-fluid]').onclick = e => { e.preventDefault(); A.showView('main'); A.selectTab('fluid'); };
  }

  /* ---------------- Sonuçlar ---------------- */
  const pct = (v, d) => isFinite(v) ? (v >= 0 ? '' : '') + v.toFixed(d === undefined ? 2 : d) : '—';

  function renderResults() {
    const a = analysis();
    const sel = selected();
    renderQuality(a);
    if (!a || !a.pts.length) {
      $('calModels').innerHTML = '<p class="note">Model karşılaştırması için test noktası girin (en az 2–3 nokta; önerilen 8–12 nokta, %10–100 debi aralığı, düşük debide daha sık).</p>';
      $('calRec').innerHTML = '';
      renderCode(null, a);
      renderCharts(a, null);
      return;
    }
    const u = uncertainty();
    $('calRec').innerHTML = a.rec ? `<div class="rec"><div><b>Önerilen model: ${esc(a.rec.model.name)}</b><br><span>${esc(a.reason)}</span></div>
      <div class="rec-n"><small>Tahmini kalibre belirsizlik (%95)</small><b>±%${u !== null ? u.toFixed(2) : '—'}</b></div></div>` : '';
    const theoryMax = Math.max(...a.theory.map(Math.abs));
    $('calModels').innerHTML = `<table class="grid models">
      <thead><tr><th></th><th>Model</th><th>Formül</th><th class="r">Uydurma maks</th><th class="r">Uydurma RMS</th><th class="r" title="Birini dışarıda bırak çapraz doğrulaması: her nokta, o nokta hariç uydurulan modelle tahmin edilir">Doğrulama (LOO) maks</th><th class="r">LOO RMS</th><th>Viskozite komp.</th></tr></thead>
      <tbody>
      <tr class="${cs().model === 'auto' ? 'on' : ''}"><td><input type="radio" name="calModel" value="auto" ${cs().model === 'auto' ? 'checked' : ''}></td><td colspan="7"><b>Otomatik</b> — önerilen modeli kullan${a.rec ? ` (${esc(a.rec.model.name)})` : ''}</td></tr>
      ${a.results.map(r => `<tr class="${sel && sel.model.id === r.model.id ? 'sel' : ''} ${r.ok ? '' : 'na'}">
        <td><input type="radio" name="calModel" value="${r.model.id}" ${cs().model === r.model.id ? 'checked' : ''} ${r.ok ? '' : 'disabled'}></td>
        <td>${esc(r.model.name)}${a.rec && a.rec.model.id === r.model.id ? ' <span class="badge">öneri</span>' : ''}</td>
        <td class="f">${esc(r.model.formula.split(',')[0])}</td>
        ${r.ok ? `<td class="n">±${pct(r.fit.maxAbs)}%</td><td class="n">${pct(r.fit.rms)}%</td>
          <td class="n ${r.loo ? cls(r.loo.maxAbs) : ''}">${r.loo ? '±' + pct(r.loo.maxAbs) + '%' : '—'}</td><td class="n">${r.loo ? pct(r.loo.rms) + '%' : '—'}</td>`
          : `<td colspan="4" class="note">${esc(r.reason)}</td>`}
        <td>${r.model.visc ? '<span class="ok">✓ ρ + μ(T)</span>' : '<span class="note">yalnız ρ(T)</span>'}</td></tr>`).join('')}
      <tr class="ref"><td></td><td>Teorik (${esc(VF.Physics.STANDARDS[A.state.method].short)}, kalibrasyonsuz)</td><td class="f">C = ${a.Cstd.toFixed(4)}</td><td class="n">±${pct(theoryMax)}%</td><td class="n">${pct(Math.sqrt(a.theory.reduce((s, e) => s + e * e, 0) / a.theory.length))}%</td><td colspan="3" class="note">karşılaştırma için</td></tr>
      </tbody></table>`;
    $('calModels').querySelectorAll('input[name=calModel]').forEach(el => el.onchange = () => { cs().model = el.value; changed(false); });
    renderCode(sel, a);
    renderCharts(a, sel);
  }

  const cls = v => v <= 0.5 ? 'good' : v <= 1.5 ? 'mid' : 'badv';

  function renderQuality(a) {
    const el = $('calQuality');
    if (!a || !a.pts.length) { el.innerHTML = '<p class="note">Henüz veri yok.</p>'; return; }
    const pts = a.pts, un = cs().units;
    const qs = pts.map(p => p.qm), dps = pts.map(p => p.dp), Ts = pts.map(p => p.T);
    const ctx = { rho: pts[0].rho };
    const qf = v => U.fmt(U.fromSI('flow', v, un.q, ctx), 4) + ' ' + U.label('flow', un.q);
    const tf = v => U.fmt(U.fromSI('temperature', v, un.T), 3) + ' ' + U.label('temperature', un.T);
    const warn = [];
    const span = Math.min(...qs) / Math.max(...qs);
    if (pts.length < 6) warn.push(['warn', `Sadece ${pts.length} nokta var; güvenilir bir eğri için 8–12 nokta önerilir.`]);
    if (span > 0.3) warn.push(['warn', `Test aralığı dar: en düşük debi, en yüksek debinin %${(span * 100).toFixed(0)}'i. %10'a kadar inen noktalar ekleyin.`]);
    if (a.rep.level === 'bad') warn.push(['bad', `Tekrarlanabilirlik kötü (±%${a.rep.worst.toFixed(2)}): aynı debide ΔP oynuyor. Bu, dirsek/girdap kaynaklı kararsızlık olabilir; hiçbir katsayı bunu düzeltemez. Düz boru veya akış düzenleyici gerekebilir.`]);
    else if (a.rep.level === 'warn') warn.push(['warn', `Tekrarlanabilirlik orta (±%${a.rep.worst.toFixed(2)}). Ölçüm ortalama süresini artırın.`]);
    else if (a.rep.level === 'none') warn.push(['note', 'Tekrarlanabilirlik için aynı debide en az iki ölçüm (artan + azalan yönde) alın.']);
    if (a.viscSensitive && a.testTspan < 10) warn.push(['warn', `İşletmede viskozite ${a.pf.muRatio.toFixed(1)} kat değişiyor ama testler dar bir sıcaklık aralığında (${a.testTspan.toFixed(1)} K). C(Re) modelleri Reynolds üzerinden kompanze eder; yine de farklı sıcaklıklarda da nokta almanız doğrulamayı güçlendirir.`]);
    if (isGas()) {
      const f = A.activeFluid();
      if (!(f.M > 0) && !a.pts.some(p => cs().rows[p.idx] && cs().rows[p.idx].rho > 0)) warn.push(['bad', 'Gaz için molar kütle (M) tanımlı değil ve yoğunluk ölçümü yok: yoğunluk sabit kabul ediliyor. Akışkan sekmesinde M (ve Z) girin ya da yoğunluk sütununu doldurun.']);
      if (a.pts.some(p => cs().rows[p.idx] && !(cs().rows[p.idx].p1 > 0))) warn.push(['warn', 'Bazı noktalarda P1 (mutlak) boş; tasarım p₁ kullanılıyor. Gazda ε ve yoğunluk P1\'e bağlıdır — mümkünse her noktada P1 girin.']);
      const tauMin = Math.min(...a.pts.map(p => (p.p1 - p.dp) / p.p1));
      if (tauMin < 0.75) warn.push(['warn', `En düşük basınç oranı τ = ${tauMin.toFixed(3)} < 0,75 (ISO 5167-4 sınırı dışında).`]);
    }
    if (!a.pf.hasTable) warn.push(['bad', 'Akışkanın sıcaklığa bağlı özellik tablosu yok: ρ(T) ve μ(T) sabit kabul ediliyor, sıcaklık kompanzasyonu çalışmaz. Akışkan sekmesinden tablo yükleyin (su için hazır).']);
    if (a.pf.muErr > 3) warn.push(['warn', `μ(T) PLC yaklaşımının hatası %${a.pf.muErr.toFixed(1)}; işletme sıcaklık aralığını daraltmak doğruluğu artırır.`]);
    el.innerHTML = `<table class="grid kv">
        <tr><td>Kullanılan nokta</td><td class="n">${pts.length}</td></tr>
        <tr><td>Debi aralığı</td><td class="n">${qf(Math.min(...qs))} … ${qf(Math.max(...qs))}</td></tr>
        <tr><td>ΔP aralığı</td><td class="n">${U.fmt(U.fromSI('pressure', Math.min(...dps), un.dp), 4)} … ${U.fmt(U.fromSI('pressure', Math.max(...dps), un.dp), 4)} ${U.label('pressure', un.dp)}</td></tr>
        <tr><td>Test sıcaklıkları</td><td class="n">${tf(Math.min(...Ts))} … ${tf(Math.max(...Ts))}</td></tr>
        <tr><td>Re aralığı</td><td class="n">${Math.min(...pts.map(p => p.Re)).toExponential(2)} … ${Math.max(...pts.map(p => p.Re)).toExponential(2)}</td></tr>
        <tr><td>Tekrarlanabilirlik</td><td class="n">${a.rep.worst === null ? '—' : '±%' + a.rep.worst.toFixed(2)}</td></tr>
        <tr><td>İşletmede μ değişimi</td><td class="n">${a.pf.muRatio.toFixed(2)} kat</td></tr>
      </table>
      ${warn.map(([k, t]) => `<div class="qmsg ${k}">${k === 'bad' ? '⛔' : k === 'warn' ? '⚠' : 'ℹ'} ${esc(t)}</div>`).join('')}`;
  }

  /* ---------------- PLC kodu ---------------- */
  function codeInput(sel, a) {
    const pts = a.pts;
    return {
      modelId: sel.model.id, params: sel.params, geo: a.geo, pf: a.pf,
      dpUnit: cs().plc.dpUnit, p1Unit: cs().plc.p1Unit || 'bar', lowCutPct: cs().plc.lowCut, name: cs().plc.name || 'FB_VenturiFlow',
      gasM: isGas() ? A.activeFluid().M : 0, gasZ: isGas() ? A.activeFluid().Z : 1,
      ranges: { dpMin: Math.min(...pts.map(p => p.dp)), dpMax: Math.max(...pts.map(p => p.dp)), Tmin: cs().TminK, Tmax: cs().TmaxK },
      meta: { date: new Date().toLocaleString('tr-TR'), n: pts.length, fit: sel.fit, loo: sel.loo, fluid: A.activeFluid().name }
    };
  }

  function renderCode(sel, a) {
    const box = $('calCode');
    document.querySelectorAll('#calCodeTabs button').forEach(b => b.classList.toggle('on', b.dataset.ct === cs().codeTab));
    if (!sel || !a) { box.innerHTML = '<p class="note">Kod üretimi için en az bir modelin uydurulabilmesi gerekir.</p>'; return; }
    const g = codeInput(sel, a);
    const block = (title, id, text, hint) => `<div class="codeblk"><div class="codeh"><b>${title}</b>${hint ? `<span class="note">${hint}</span>` : ''}
      <button class="btn sm" data-copy="${id}">Kopyala</button></div><pre id="${id}">${esc(text)}</pre></div>`;
    if (cs().codeTab === 'tc') {
      const o = C.plcCode(g, 'twincat');
      box.innerHTML = `<div class="note">TwinCAT 3: <b>PLC projesi → POUs → Add → POU → Function Block (ST)</b>, adı <code>${esc(g.name)}</code>. Aşağıdaki iki parçayı editörün üst (bildirim) ve alt (kod) paneline yapıştırın.</div>` +
        block('1 · Bildirim (üst panel)', 'codeDecl', o.decl) +
        block('2 · Uygulama (alt panel)', 'codeImpl', o.impl) +
        block('3 · Kullanım örneği (MAIN)', 'codeMain', mainExample(g));
    } else if (cs().codeTab === 'iec') {
      box.innerHTML = block('IEC 61131-3 Structured Text (CODESYS, Schneider, Omron, ABB vb.)', 'codeIec', C.plcCode(g, 'iec'), 'tek dosya');
    } else {
      box.innerHTML = block('Katsayılar ve formüller (HMI / diğer PLC)', 'codeTxt', C.coefText(g));
    }
    box.querySelectorAll('[data-copy]').forEach(b => b.onclick = () => {
      const t = $(b.dataset.copy).textContent;
      (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => A.toast('Panoya kopyalandı', 'ok')).catch(() => {
        const r = document.createRange(); r.selectNodeContents($(b.dataset.copy));
        const s = getSelection(); s.removeAllRanges(); s.addRange(r); A.toast('Metin seçildi — Ctrl+C ile kopyalayın', 'warn');
      });
    });
  }

  function mainExample(g) {
    return `(* Bildirim *)
PROGRAM MAIN
VAR
    fbVenturi : ${g.name};
    fDp_${g.dpUnit}  : LREAL;   (* DP transmitterden, olceklenmis *)
    fTemp_C   : LREAL;   (* Sicaklik transmitterden *)
    fRho      : LREAL;   (* Coriolis yogunlugu; yoksa 0 *)${g.geo.gas ? `
    fP1_${g.p1Unit}abs : LREAL;   (* Giris basinci, MUTLAK *)` : ''}
    fFlow_kgh : LREAL;
END_VAR

(* Kod *)
fbVenturi(fDp := fDp_${g.dpUnit}, fTemp := fTemp_C, ${g.geo.gas ? `fP1 := fP1_${g.p1Unit}abs, ` : ''}fDensityIn := fRho);
fFlow_kgh := fbVenturi.fMassFlow;
IF fbVenturi.bOutOfRange THEN
    ; (* Kalibrasyon araligi disi: alarm / uyari *)
END_IF`;
  }

  function download() {
    const sel = selected(), a = analysis();
    if (!sel) return A.toast('Önce bir model seçin.', 'err');
    const g = codeInput(sel, a);
    let text, name;
    if (cs().codeTab === 'tc') { const o = C.plcCode(g, 'twincat'); text = `(* ===== BILDIRIM ===== *)\n${o.decl}\n\n(* ===== UYGULAMA ===== *)\n${o.impl}\n`; name = g.name + '_TwinCAT.st'; }
    else if (cs().codeTab === 'iec') { text = C.plcCode(g, 'iec'); name = g.name + '.st'; }
    else { text = C.coefText(g); name = 'venturi_katsayilar.txt'; }
    const a2 = document.createElement('a');
    a2.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    a2.download = name; a2.click();
    setTimeout(() => URL.revokeObjectURL(a2.href), 1000);
  }

  /* ---------------- Grafikler ---------------- */
  function chartColors() {
    const s = getComputedStyle(document.documentElement);
    return { text: s.getPropertyValue('--chart-text').trim(), grid: s.getPropertyValue('--chart-grid').trim(), accent: s.getPropertyValue('--accent').trim(), amber: s.getPropertyValue('--amber').trim(), muted: s.getPropertyValue('--muted').trim() };
  }

  function baseOpts(xTitle, yTitle, xLog) {
    const c = chartColors();
    return {
      animation: false, responsive: true, maintainAspectRatio: false, parsing: false,
      scales: {
        x: { type: xLog ? 'logarithmic' : 'linear', title: { display: true, text: xTitle, color: c.text }, grid: { color: c.grid }, ticks: { color: c.text } },
        y: { type: 'linear', title: { display: true, text: yTitle, color: c.text }, grid: { color: c.grid }, ticks: { color: c.text } }
      },
      plugins: { legend: { labels: { color: c.text, boxWidth: 10 } } }
    };
  }

  function renderCharts(a, sel) {
    if (typeof Chart === 'undefined' || $('viewCalib').hidden) return;
    const c = chartColors();
    const un = cs().units;
    const qx = p => U.fromSI('flow', p.qm, un.q, { rho: p.rho });
    const pts = a ? a.pts : [];
    const dsErr = [
      { label: 'Teorik (kalibrasyonsuz)', data: pts.map((p, i) => ({ x: qx(p), y: a.theory[i] })), backgroundColor: c.muted, borderColor: c.muted, pointStyle: 'rect', pointRadius: 4 },
      { label: sel ? `${sel.model.name} — uydurma` : 'Model', data: sel ? pts.map((p, i) => ({ x: qx(p), y: sel.err[i] })) : [], backgroundColor: c.accent, borderColor: c.accent, pointRadius: 5 },
      { label: 'Çapraz doğrulama (LOO)', data: sel && sel.looErr ? pts.map((p, i) => ({ x: qx(p), y: sel.looErr[i] })) : [], backgroundColor: 'transparent', borderColor: c.amber, borderWidth: 2, pointStyle: 'triangle', pointRadius: 6 },
      { label: `Referans ±%${cs().refAcc}`, data: pts.length ? [{ x: Math.min(...pts.map(qx)), y: cs().refAcc }, { x: Math.max(...pts.map(qx)), y: cs().refAcc }] : [], showLine: true, borderColor: c.grid, borderDash: [4, 4], pointRadius: 0 },
      { label: '', data: pts.length ? [{ x: Math.min(...pts.map(qx)), y: -cs().refAcc }, { x: Math.max(...pts.map(qx)), y: -cs().refAcc }] : [], showLine: true, borderColor: c.grid, borderDash: [4, 4], pointRadius: 0 }
    ];
    const o1 = baseOpts(`Referans debi [${U.label('flow', un.q)}]`, 'Sapma [%]');
    o1.plugins.legend.labels.filter = i => i.text !== '';
    if (!charts.err) charts.err = new Chart($('calChartErr'), { type: 'scatter', data: { datasets: dsErr }, options: o1 });
    else { charts.err.data.datasets = dsErr; charts.err.options = o1; charts.err.update('none'); }

    const dsC = [{ label: 'Etkin C (test)', data: pts.map(p => ({ x: p.Re, y: p.C })), backgroundColor: c.accent, borderColor: c.accent, pointRadius: 5 }];
    if (a && pts.length) {
      const Re0 = Math.min(...pts.map(p => p.Re)), Re1 = Math.max(...pts.map(p => p.Re));
      dsC.push({ label: `Standart C = ${a.Cstd.toFixed(3)}`, data: [{ x: Re0, y: a.Cstd }, { x: Re1, y: a.Cstd }], showLine: true, borderColor: c.muted, borderDash: [5, 4], pointRadius: 0 });
      const cre = a.results.find(r => r.model.id === 'cre');
      if (cre && cre.ok) {
        const curve = Array.from({ length: 40 }, (_, i) => { const L = cre.params.Lmin + (cre.params.Lmax - cre.params.Lmin) * i / 39; return { x: Math.pow(10, L), y: cre.params.c[0] + cre.params.c[1] * L + cre.params.c[2] * L * L }; });
        dsC.push({ label: 'C(Re) polinom', data: curve, showLine: true, borderColor: c.amber, borderWidth: 2, pointRadius: 0 });
      }
    }
    const o2 = baseOpts('Reynolds sayısı Re_D', 'Etkin boşaltma katsayısı C', true);
    if (!charts.cre) charts.cre = new Chart($('calChartC'), { type: 'scatter', data: { datasets: dsC }, options: o2 });
    else { charts.cre.data.datasets = dsC; charts.cre.options = o2; charts.cre.update('none'); }
  }

  /* ---------------- CSV / örnek / canlı ---------------- */
  function importCsv(file) {
    file.text().then(text => VF.CSV.openMapping(text, file.name, {
      mode: 'measure',
      onDone: res => {
        if (res.mode !== 'measure') return A.toast('Kalibrasyon için "Ölçüm Verisi" modunu seçin.', 'err');
        res.rows.forEach(r => {
          const row = { dp: r.dp, T: r.T > 0 ? r.T : null, rho: r.rho > 0 ? r.rho : null, p1: r.p1 > 0 ? r.p1 : null, src: 'CSV', on: true };
          row.qm = U.toSI('flow', r.qv, r.qu, { rho: rowRho(row) });
          cs().rows.push(row);
        });
        renderTable(); changed(false);
        A.toast(`${res.rows.length} test noktası eklendi${res.skipped ? ` (${res.skipped} satır atlandı)` : ''}.`, 'ok');
      }
    }));
  }

  /** Örnek veri: kötü imalatlı bir venturi (C düşük ve Re'ye bağlı), 3 sıcaklıkta */
  function sample() {
    const c = A.context();
    const fl = A.activeFluid();
    const gas = fl.type === 'gas';
    const D = c.inp.D, d = c.inp.d, beta = d / D;
    const E = 1 / Math.sqrt(1 - Math.pow(beta, 4)), A2 = Math.PI * d * d / 4;
    const qMax = c.qMax;
    let seed = 11; const rnd = () => (seed = seed * 16807 % 2147483647) / 2147483647;
    const rows = [];
    for (const tC of [15, 45, 75]) for (const f of [0.12, 0.25, 0.4, 0.55, 0.7, 0.85, 1.0]) {
      const T = tC + 273.15;
      const p1 = c.inp.p1 * (gas ? 1 + (rnd() - 0.5) * 0.1 : 1);
      const pr = F.resolve(fl, T, p1);
      const qm = qMax * f;
      const Re = 4 * qm / (Math.PI * pr.mu * D);
      const Ct = 0.957 + 0.011 * Math.log10(Re / 1e5) - 0.004 * Math.exp(-f * 6);
      // gazda ε, ΔP'ye bağlı → sabit nokta iterasyonu
      let dp = Math.pow(qm / (Ct * E * A2), 2) / (2 * pr.rho);
      for (let k = 0; gas && k < 30; k++) {
        const eps = VF.Physics.expansibility(beta, (p1 - dp) / p1, fl.kappa || 1.4);
        dp = Math.pow(qm / (Ct * eps * E * A2), 2) / (2 * pr.rho);
      }
      if (!(dp < p1 * 0.5)) continue;
      dp *= 1 + (rnd() - 0.5) * 0.004;
      rows.push({ qm: qm * (1 + (rnd() - 0.5) * 0.001), dp, T: T + (rnd() - 0.5) * 0.4, rho: null, p1: gas ? p1 : null, src: 'örnek', on: true });
    }
    cs().rows = cs().rows.concat(rows);
    renderTable(); changed(false);
    A.toast(`${rows.length} örnek test noktası eklendi (sentetik — gerçek testlerinizle değiştirin).`, 'warn');
  }

  /** Canlı panelden anlık (ortalama) değeri test noktası olarak ekler */
  function addFromLive(v) {
    cs().rows.push({ qm: v.qm, dp: v.dp, T: v.T || null, rho: v.rho || null, p1: v.p1 || null, src: v.src || 'canlı', on: true });
    if (!$('viewCalib').hidden) renderTable();
    changed(false);
    $('calCount') && ($('calCount').textContent = `${cs().rows.filter(r => r.on).length} / ${cs().rows.length} nokta`);
  }

  /* ---------------- Başlatma ---------------- */
  function render() {
    renderSettings();
    renderTable();
    $('plcName').value = cs().plc.name;
    $('plcDpUnit').value = cs().plc.dpUnit;
    $('plcP1Unit').value = cs().plc.p1Unit || 'bar';
    $('plcP1Wrap').hidden = !isGas();
    $('plcLowCut').value = cs().plc.lowCut;
    $('calApply').checked = !!cs().apply;
    renderResults();
  }

  function init(app) {
    A = app;
    $('plcDpUnit').innerHTML = Object.keys(C.DP_TO_PA).map(u => `<option value="${u}">${U.label('pressure', u)}</option>`).join('');
    $('plcP1Unit').innerHTML = $('plcDpUnit').innerHTML;
    bindTable();
    $('calAdd').onclick = () => addRow();
    $('calSample').onclick = sample;
    $('calClear').onclick = () => { if (cs().rows.length && confirm('Tüm test noktaları silinsin mi?')) { cs().rows = []; renderTable(); changed(false); } };
    $('calCsv').onclick = () => $('calCsvFile').click();
    $('calCsvFile').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) importCsv(f); };
    $('calApply').onchange = e => { cs().apply = e.target.checked; changed(false); A.toast(e.target.checked ? 'Kalibre model canlı izleme ve grafikte kullanılıyor.' : 'Teorik modele dönüldü.', 'ok'); };
    $('calCodeTabs').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; cs().codeTab = b.dataset.ct; A.save(); renderResults(); });
    $('plcName').addEventListener('input', e => { cs().plc.name = e.target.value.replace(/[^A-Za-z0-9_]/g, '') || 'FB_VenturiFlow'; changed(false); });
    $('plcDpUnit').addEventListener('change', e => { cs().plc.dpUnit = e.target.value; changed(false); });
    $('plcP1Unit').addEventListener('change', e => { cs().plc.p1Unit = e.target.value; changed(false); });
    $('plcLowCut').addEventListener('input', e => { const v = parseFloat(e.target.value); if (v >= 0 && v < 50) { cs().plc.lowCut = v; changed(false); } });
    $('calDownload').onclick = download;
  }

  function onShow() {
    render();
    setTimeout(() => renderCharts(analysis(), selected()), 0);
  }

  function onThemeChange() {
    if (charts.err) { charts.err.destroy(); charts.err = null; }
    if (charts.cre) { charts.cre.destroy(); charts.cre = null; }
    if (!$('viewCalib').hidden) renderCharts(analysis(), selected());
  }

  /** Ana grafikte gösterilecek kalibre eğri: ΔP → q (tasarım sıcaklığında) */
  function curve(c, dpMax, n) {
    const s = active();
    if (!s) return null;
    const pr = F.resolve(A.activeFluid(), c.inp.T, c.inp.p1);
    const out = [];
    for (let i = 1; i <= n; i++) {
      const dp = dpMax * Math.pow(i / n, 2);
      out.push({ dp, qm: C.predict(s.r.model.id, s.r.params, s.geo, dp, pr.rho, pr.mu, c.inp.p1) });
    }
    return out;
  }

  /** PDF raporu için kalibrasyon özeti */
  function reportData() {
    const sel = selected(), a = analysis();
    if (!sel || !a) return null;
    return { name: sel.model.name, fit: sel.fit, loo: sel.loo, u: uncertainty(), n: a.pts.length, applied: !!cs().apply, text: C.coefText(codeInput(sel, a)) };
  }

  VF.CalibUI = { reportData, init, onShow, onThemeChange, refresh: () => { if (!$('viewCalib').hidden) renderResults(); }, render, predict, active, selected, uncertainty, curve, addFromLive, analysis };
})(window.VF = window.VF || {});
