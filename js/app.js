/* VenturiFlow Master — Uygulama kontrolcüsü (durum, arayüz, hesap döngüsü) */
(function (VF) {
  'use strict';
  const U = VF.Units, P = VF.Physics, F = VF.Fluids;
  const $ = id => document.getElementById(id);
  const esc = s => VF.CSV.esc(s);
  const S = VF.Store, UI = VF.UI;
  const INPUTS = S.INPUTS;
  const DISP_DIMS = ['flow', 'pressure', 'length', 'temperature', 'density', 'viscosity'];
  // Aktif durum her zaman Store'dan okunur (venturi geçişinde nesne değişir)
  let state = S.state;
  const refreshState = () => { state = S.state; };
  const save = () => S.save();
  const activeFluid = () => S.activeFluid();
  const activeVenturi = () => S.activeVenturi();

  /* ============================================================
   * Hesap bağlamı
   * ============================================================ */
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
   * Birimler sekmesi
   * ============================================================ */
  function buildUnitsTab() {
    $('dispUnits').innerHTML = DISP_DIMS.map(dim => `<label class="row"><span>${U.DIMS[dim].label}</span>
      <select data-disp="${dim}">${U.units(dim).map(u => `<option value="${u}" ${state.units[dim] === u ? 'selected' : ''}>${U.label(dim, u)}</option>`).join('')}</select></label>`).join('');
    $('dispUnits').querySelectorAll('[data-disp]').forEach(el => el.addEventListener('change', () => {
      state.units[el.dataset.disp] = el.value; VF.FluidUI.build(); recalc(); VF.Live.render();
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
    VF.FluidUI.renderResolved(c);
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
    VF.Live.recompute();
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
      live: VF.Live.point, trail: VF.Live.trail,
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
   * Yedekleme / PDF / tema / yardım
   * ============================================================ */
  function exportJson() {
    UI.download(`venturiflow_yedek_${new Date().toISOString().slice(0, 10)}.json`, S.fullBackup());
    const withPass = state.venturis.some(v => v.data && v.data.influx && v.data.influx.pass);
    UI.toast('Yedek dosyası indirildi' + (withPass ? ' (InfluxDB parolası dosyada bulunuyor!)' : ''), withPass ? 'warn' : 'ok');
  }

  async function importJson(file) {
    try {
      const data = JSON.parse(await file.text());
      if (data.kind === 'venturi') return S.importVenturi(data);
      const s = data.state || data;
      if (!s || typeof s !== 'object' || !(s.inputs || s.venturis)) throw new Error('Geçerli bir VenturiFlow yedeği değil.');
      S.importFull(s);
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
    VF.FluidUI.destroyChart();
    if (VF.Trend) VF.Trend.onTheme();
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
    VF.FluidUI.build();
    buildUnitsTab();
    if (!bound) { bindOnce(); bound = true; }
    // Canlı sekme alanlarını yeniden doldur
    VF.Live.bindFields();
    selectTab(state.tab);
    renderVenturiSelect();
    fxSig = '';
    recalc();
    showView(state.view);
    VF.Trend.refresh();
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

  VF.App = {
    get state() { return S.state; },
    get lastCalc() { return lastCalc; },
    D, context, si, recalc, save, activeFluid, activeVenturi, showView, selectTab, unitSelect, round,
    switchVenturi: id => S.switchVenturi(id), newVenturi: (id, n) => S.newVenturi(id, n), deleteVenturi: id => S.deleteVenturi(id),
    updateVenturiMeta: (id, p) => S.updateVenturiMeta(id, p), importVenturi: o => S.importVenturi(o), snapshotVenturi: () => S.snapshotVenturi(),
    exportVenturi(id) {
      const o = S.exportVenturiObj(id);
      if (o) UI.download(`venturi_${o.venturi.name.replace(/[^\wçğıöşüÇĞİÖŞÜ-]+/g, '_')}.json`, o);
    },
    showMixedGuide: () => VF.Live.showMixedGuide(),
    toast: (m, k) => UI.toast(m, k), modal: o => UI.modal(o)
  };

  function selectTab(t) {
    state.tab = t;
    document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
    document.querySelectorAll('.tab').forEach(s => s.classList.toggle('on', s.id === 'tab-' + t));
    if (t === 'fluid' && lastCalc) VF.FluidUI.renderChart(lastCalc.c);
    save();
  }

  function bindOnce() {
    $('tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) selectTab(b.dataset.tab); });
    $('viewSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) showView(b.dataset.view); });
    VF.CalibUI.init(VF.App);
    VF.VenturiUI.init(VF.App);
    VF.Trend.init();
    if (VF.History) VF.History.init();
    $('selMethod').addEventListener('change', e => { state.method = e.target.value; recalc(); });
    $('selMfg').addEventListener('change', e => { state.mfg = e.target.value; recalc(); });
    $('selFitting').addEventListener('change', e => { state.fitting = e.target.value; recalc(); });
    $('slWhatIf').addEventListener('input', e => { state.whatIf = Number(e.target.value); recalc(); });
    $('btnTheme').onclick = () => { state.theme = state.theme === 'dark' ? 'light' : 'dark'; applyTheme(); recalc(); };
    $('btnExport').onclick = exportJson;
    $('btnImport').onclick = () => $('fileJson').click();
    $('fileJson').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) importJson(f); });
    $('btnPdf').onclick = makePdf;
    $('btnHelp').onclick = () => VF.Help.open();
    VF.FluidUI.bind();
    let rt = null;
    window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => lastCalc && renderDrawing(lastCalc.res, lastCalc.c), 120); });
  }

  // Store geri çağrıları: venturi geçişi / ortak kayıt uygulaması / kayıt durumu
  S.hooks.beforeReload = () => { VF.Live.stop(true); VF.Live.resetAvg(); VF.Live.clearTrail(); };
  S.hooks.reload = () => { refreshState(); initUI(); };
  S.hooks.listChanged = () => { refreshState(); renderVenturiSelect(); };
  S.hooks.toast = (m, k) => UI.toast(m, k);
  S.hooks.saved = ok => { $('stSave').textContent = ok ? '● Kaydedildi ' + new Date().toLocaleTimeString('tr-TR') : '⚠ Kaydedilemedi (localStorage kapalı)'; };

  function boot() {
    if (!VF.ChartView.init($('chart'), $('liveDot'), $('liveDotLbl'))) {
      $('chartBox').innerHTML = '<p class="note bad" style="padding:20px">Chart.js yüklenemedi — internet/CDN erişimini kontrol edin.</p>';
    }
    initUI();
    if (VF.Sync) VF.Sync.init({ getSharedJson: S.getSharedJson, getSharedState: S.getSharedState, applyShared: S.applyShared, isBlankVenturi: S.isBlankVenturi, toast: UI.toast, modal: UI.modal });
    // MathJax asenkron yüklenir; hazır olduğunda formülleri dizgele
    const waitMJ = setInterval(() => {
      if (window.MathJax && MathJax.typesetPromise) { clearInterval(waitMJ); fxSig = ''; lastCalc && renderFormulas(lastCalc.res, lastCalc.c); }
    }, 250);
    setTimeout(() => clearInterval(waitMJ), 20000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window.VF = window.VF || {});
