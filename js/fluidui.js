/* VenturiFlow Master — Akışkan sekmesi: kütüphane, tanım, çalışma koşullarındaki özellikler,
 * sıcaklığa bağlı özellik grafiği ve CSV içe aktarma */
(function (VF) {
  'use strict';
  const U = VF.Units, F = VF.Fluids;
  const $ = id => document.getElementById(id);
  const esc = s => VF.CSV.esc(s);
  const st = () => VF.Store.state;
  const A = () => VF.App;

  const FLUID_FIELDS = {
    rho:   { label: 'Yoğunluk ρ', dim: 'density', unitKey: 'rho', req: true },
    mu:    { label: 'Dinamik viskozite μ', dim: 'viscosity', unitKey: 'mu', req: true },
    pv:    { label: 'Buhar basıncı p<sub>v</sub>', dim: 'pressure', unitKey: 'pv', only: 'liquid' },
    kappa: { label: 'İzentropik üs κ', dim: 'none', only: 'gas', req: true },
    M:     { label: 'Molar kütle M <span class="hint">(g/mol, ops.)</span>', dim: 'none', only: 'gas' },
    Z:     { label: 'Sıkıştırılabilirlik Z', dim: 'none', only: 'gas' }
  };

  /* ============================================================
   * Akışkan sekmesi
   * ============================================================ */
  function buildFluidTab() {
    const sel = $('selFluid');
    sel.innerHTML = st().fluids.map(f => `<option value="${esc(f.id)}">${esc(f.name)} (${f.type === 'gas' ? 'Gaz' : 'Sıvı'})</option>`).join('');
    sel.value = st().activeFluid;
    const f = VF.Store.activeFluid();
    $('fName').value = f.name;
    $('fType').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === f.type));
    const hasTable = f.table && f.table.length;
    const ctx = { rho: f.rho };
    $('fluidFields').innerHTML = Object.entries(FLUID_FIELDS).filter(([, d]) => !d.only || d.only === f.type).map(([k, d]) => {
      const unit = d.unitKey ? st().fluidUnits[d.unitKey] : null;
      const val = d.unitKey ? U.fromSI(d.dim, f[k], unit, ctx) : f[k];
      const fromTable = hasTable && ['rho', 'mu', 'pv'].includes(k);
      const fromGas = k === 'rho' && f.type === 'gas' && f.M > 0;
      return `<label class="row"><span>${d.label}${d.req ? ' <span class="req">*</span>' : ''}</span>
        <div class="inp"><input type="number" step="any" data-fl="${k}" value="${fromTable || fromGas || !isFinite(val) ? '' : A().round(val)}" placeholder="${fromGas ? 'ρ = p₁M/ZRT' : fromTable ? 'tablodan T\'ye göre' : ''}" ${fromTable || fromGas ? 'disabled title="' + (fromGas ? 'İdeal gaz denkleminden hesaplanıyor' : 'Tablodan interpole ediliyor') + '"' : ''}>
        ${d.unitKey ? A().unitSelect(d.dim, unit, `data-flu="${d.unitKey}"`) : '<span class="unit-static">–</span>'}</div></label>`;
    }).join('');

    $('fluidFields').querySelectorAll('[data-fl]').forEach(el => el.addEventListener('input', () => {
      const k = el.dataset.fl, d = FLUID_FIELDS[k], v = parseFloat(el.value);
      const bad = !isFinite(v) || (d.req && v <= 0);
      el.classList.toggle('invalid', bad);
      if (!isFinite(v)) return;
      const fl = VF.Store.activeFluid();
      fl[k] = d.unitKey ? U.toSI(d.dim, v, st().fluidUnits[d.unitKey], { rho: fl.rho }) : v;
      if (k === 'M') buildFluidTab();
      A().recalc();
    }));
    $('fluidFields').querySelectorAll('[data-flu]').forEach(el => el.addEventListener('change', () => {
      st().fluidUnits[el.dataset.flu] = el.value;
      buildFluidTab(); VF.Store.save();
    }));

    const ti = $('fluidTableInfo');
    if (hasTable) {
      const tb = f.table;
      ti.innerHTML = `📈 Özellik tablosu: <b>${tb.length}</b> nokta (${U.fmt(U.fromSI('temperature', tb[0].T, st().units.temperature), 3)} … ${U.fmt(U.fromSI('temperature', tb[tb.length - 1].T, st().units.temperature), 3)} ${U.label('temperature', st().units.temperature)}), ρ/μ/p<sub>v</sub> T'ye göre interpole edilir.
        <a href="#" id="lnkTblView">Görüntüle</a> · <a href="#" id="lnkTblDel">Tabloyu kaldır</a>`;
      $('lnkTblView').onclick = e => { e.preventDefault(); showTable(f); };
      $('lnkTblDel').onclick = e => {
        e.preventDefault();
        const r = F.resolve(f, A().si('T'), A().si('p1'));
        f.rho = r.rho; f.mu = r.mu; f.pv = r.pv; f.table = null;
        buildFluidTab(); A().recalc(); VF.UI.toast('Tablo kaldırıldı; mevcut T değerindeki özellikler sabit değer olarak atandı.', 'ok');
      };
    } else {
      ti.innerHTML = f.type === 'gas' ? 'Gazlarda M girilirse yoğunluk p₁ ve T\'den ideal gaz denklemiyle (ρ = p₁M/ZRT) hesaplanır.' : 'Sabit özellikler kullanılıyor. Sıcaklığa bağlı tablo için CSV içe aktarın.';
    }
    $('btnFluidDel').disabled = st().fluids.length <= 1;
  }

  function showTable(f) {
    const tu = st().units.temperature, ru = st().fluidUnits.rho, mu = st().fluidUnits.mu, pu = st().fluidUnits.pv;
    VF.UI.modal({
      title: f.name + ' — Özellik Tablosu',
      body: `<table class="grid"><thead><tr><th>T [${U.label('temperature', tu)}]</th><th>ρ [${U.label('density', ru)}]</th><th>μ [${U.label('viscosity', mu)}]</th><th>p<sub>v</sub> [${U.label('pressure', pu)}]</th></tr></thead><tbody>
        ${f.table.map(r => `<tr><td class="n">${U.fmt(U.fromSI('temperature', r.T, tu), 4)}</td><td class="n">${U.fmt(U.fromSI('density', r.rho, ru), 5)}</td><td class="n">${U.fmt(U.fromSI('viscosity', r.mu, mu, { rho: r.rho }), 4)}</td><td class="n">${isFinite(r.pv) ? U.fmt(U.fromSI('pressure', r.pv, pu), 4) : '—'}</td></tr>`).join('')}
        </tbody></table>`
    });
  }

  function bindFluidTab() {
    $('fcProp').addEventListener('change', e => { st().fluidChart.prop = e.target.value; VF.Store.save(); if (A().lastCalc) renderFluidChart(A().lastCalc.c); });
    $('selFluid').addEventListener('change', e => { st().activeFluid = e.target.value; buildFluidTab(); A().recalc(); });
    $('fName').addEventListener('input', e => {
      VF.Store.activeFluid().name = e.target.value || 'Adsız';
      const o = $('selFluid').selectedOptions[0];
      if (o) o.textContent = `${VF.Store.activeFluid().name} (${VF.Store.activeFluid().type === 'gas' ? 'Gaz' : 'Sıvı'})`;
      VF.Store.save();
    });
    $('fType').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      const f = VF.Store.activeFluid();
      f.type = b.dataset.v;
      if (f.type === 'gas' && !(f.kappa > 1)) f.kappa = 1.4;
      buildFluidTab(); A().recalc();
    });
    $('btnFluidNew').onclick = () => {
      const f = { id: F.uid(), name: 'Yeni Akışkan', type: 'liquid', rho: 1000, mu: 1e-3, pv: 2339, kappa: 1.4, M: 0, Z: 1, table: null };
      st().fluids.push(f); st().activeFluid = f.id; buildFluidTab(); A().recalc();
      $('fName').focus(); $('fName').select();
    };
    $('btnFluidDup').onclick = () => {
      const f = JSON.parse(JSON.stringify(VF.Store.activeFluid()));
      f.id = F.uid(); f.name += ' (kopya)'; delete f.builtin;
      st().fluids.push(f); st().activeFluid = f.id; buildFluidTab(); A().recalc();
    };
    $('btnFluidDel').onclick = () => {
      if (st().fluids.length <= 1) return;
      const f = VF.Store.activeFluid();
      if (!confirm(`"${f.name}" silinsin mi?`)) return;
      st().fluids = st().fluids.filter(x => x.id !== f.id);
      st().activeFluid = st().fluids[0].id; buildFluidTab(); A().recalc();
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
            st().fluids.push(f); st().activeFluid = f.id;
            buildFluidTab();
            VF.UI.toast(`"${f.name}" eklendi: ${res.rows.length} satır${res.skipped ? `, ${res.skipped} satır atlandı` : ''}.`, 'ok');
          } else {
            st().measured = res.rows;
            VF.UI.toast(`${res.rows.length} ölçüm noktası grafiğe eklendi${res.skipped ? ` (${res.skipped} satır atlandı)` : ''}.`, 'ok');
          }
          A().recalc();
        }
      });
    });
  }

  function renderResolved(c) {
    const fl = c.fl, ctx = c.ctx;
    const src = k => fl.source[k] ? `<span class="src">(${fl.source[k]})</span>` : '';
    const rows = [
      ['Yoğunluk ρ', U.fmt(U.fromSI('density', fl.rho, st().units.density), 5) + ' ' + U.label('density', st().units.density), src('rho')],
      ['Viskozite μ', U.fmt(U.fromSI('viscosity', fl.mu, st().units.viscosity, ctx), 4) + ' ' + U.label('viscosity', st().units.viscosity), src('mu')],
      ['Kinematik viskozite ν', U.fmt(fl.mu / fl.rho * 1e6, 4) + ' cSt', '']
    ];
    if (fl.type === 'liquid') rows.push(['Buhar basıncı p_v', U.fmt(U.fromSI('pressure', fl.pv, st().units.pressure), 4) + ' ' + A().D.pu(), src('pv')]);
    else rows.push(['İzentropik üs κ', fl.kappa.toFixed(3), '']);
    $('fResolved').innerHTML = `<table>${rows.map(r => `<tr><td>${r[0]} ${r[2]}</td><td>${r[1]}</td></tr>`).join('')}</table>` +
      (fl.outOfTable ? '<div class="note warn">⚠ T, tablo aralığı dışında — uç değer kullanılıyor.</div>' : '');
    $('fCond').textContent = `T = ${U.fmt(U.fromSI('temperature', c.inp.T, st().units.temperature), 4)} ${U.label('temperature', st().units.temperature)} · p₁ = ${A().D.p(c.inp.p1)} ${A().D.pu()}`;
    $('measInfo').innerHTML = st().measured.length
      ? `Ölçüm verisi: <b>${st().measured.length}</b> nokta grafikte gösteriliyor. <a href="#" id="lnkMeasClr">Temizle</a>`
      : 'Ölçüm verisi yüklenmedi.';
    const l = $('lnkMeasClr');
    if (l) l.onclick = e => { e.preventDefault(); st().measured = []; A().recalc(); };
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
    if (!cv || typeof Chart === 'undefined' || st().tab !== 'fluid') return;
    const f = VF.Store.activeFluid();
    let prop = st().fluidChart.prop;
    if (FPROPS[prop].liquid && f.type !== 'liquid') prop = 'rho';
    $('fcProp').value = prop;
    const P0 = FPROPS[prop];
    const tb = f.table && f.table.length ? f.table : null;
    const Tlo = tb ? tb[0].T : c.inp.T - 40, Thi = tb ? tb[tb.length - 1].T : c.inp.T + 40;
    const tu = st().units.temperature;
    const yu = P0.dim ? st().units[P0.dim] : null;
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


  VF.FluidUI = {
    build: buildFluidTab, bind: bindFluidTab, renderResolved, renderChart: renderFluidChart,
    destroyChart() { if (fluidChart) { fluidChart.destroy(); fluidChart = null; } }
  };
})(window.VF = window.VF || {});
