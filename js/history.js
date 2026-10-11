/* VenturiFlow Master — Geçmiş veriden kalibrasyon
 * InfluxDB'den bir zaman aralığı (gruplanmış ortalamalar) çekilir, debi ve ΔP'nin kararlı
 * olduğu bölümler bulunur, her bölümün ortalaması aday test noktası olarak sunulur. */
(function (VF) {
  'use strict';
  const U = VF.Units, F = VF.Fluids;
  const $ = id => document.getElementById(id);
  const esc = s => VF.CSV.esc(s);
  const st = () => VF.Store.state;
  let chart = null;

  const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
  const cv = a => { const m = mean(a); return m ? Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / a.length) / Math.abs(m) * 100 : Infinity; };

  /** Sensör serilerini zaman damgasına göre birleştirir, düzeltme/birim uygular → SI satırları */
  function buildRows(series) {
    const S = st().sensors, L = VF.Live;
    const diff = S.dpMode === 'diff';
    const c = VF.App.context();
    const byT = new Map();
    for (const key in series) for (const [t, v] of series[key]) {
      if (!byT.has(t)) byT.set(t, {});
      byT.get(t)[key] = v;
    }
    const rows = [];
    [...byT.keys()].sort((a, b) => a - b).forEach(t => {
      const r = byT.get(t);
      if (r.q === undefined || (diff ? (r.p1 === undefined || r.p2 === undefined) : r.dp === undefined)) return;
      const T = r.T !== undefined ? L.rawToSI('T', r.T) : null;
      const p1abs = r.p1 !== undefined ? L.rawToSI('p1', r.p1) + (S.pGauge ? L.PATM : 0) : null;
      const rhoM = r.rho !== undefined ? L.rawToSI('rho', r.rho) : null;
      const dp = diff ? L.rawToSI('p1', r.p1) - L.rawToSI('p2', r.p2) : L.rawToSI('dp', r.dp);
      const rhoCtx = rhoM > 0 ? rhoM : F.resolve(VF.Store.activeFluid(), T > 0 ? T : c.inp.T, p1abs > 0 ? p1abs : c.inp.p1).rho;
      const q = L.rawToSI('q', r.q, { rho: rhoCtx });
      if (isFinite(q) && isFinite(dp)) rows.push({ t, q, dp, T, p1: p1abs, rho: rhoM });
    });
    return rows;
  }

  /** Kararlı bölümler: pencere boyunca debi ve ΔP'nin değişim katsayısı eşik altında */
  function findSegments(rows, o) {
    const n = Math.max(3, Math.round(o.stableSec / o.groupSec));
    const qMax = Math.max(...rows.map(r => r.q));
    const gapMs = o.groupSec * 1000 * 2.5;
    const stable = new Array(rows.length).fill(false);
    for (let i = 0; i + n <= rows.length; i++) {
      const w = rows.slice(i, i + n);
      if (w[w.length - 1].t - w[0].t > (n - 1) * gapMs) continue;     // arada boşluk var
      if (mean(w.map(r => r.q)) < qMax * o.minFlowPct / 100) continue;
      if (cv(w.map(r => r.q)) <= o.cvQ && cv(w.map(r => r.dp)) <= o.cvDp) for (let k = i; k < i + n; k++) stable[k] = true;
    }
    const segs = [];
    let cur = null;
    rows.forEach((r, i) => {
      const cont = cur && stable[i] && r.t - rows[i - 1].t <= gapMs;
      if (stable[i] && !cont) { cur = [r]; segs.push(cur); }
      else if (cont) cur.push(r);
      else cur = null;
    });
    const avg = (s, k) => { const v = s.map(r => r[k]).filter(x => x !== null && isFinite(x)); return v.length ? mean(v) : null; };
    return segs.filter(s => s.length >= n).map(s => ({
      t0: s[0].t, t1: s[s.length - 1].t, n: s.length,
      q: avg(s, 'q'), dp: avg(s, 'dp'), T: avg(s, 'T'), p1: avg(s, 'p1'), rho: avg(s, 'rho'),
      cvQ: cv(s.map(r => r.q)), cvDp: cv(s.map(r => r.dp)), sel: true
    }));
  }

  function open() {
    const S = st();
    if (!VF.Live.sensorOn('q')) return VF.UI.toast('Geçmiş veriden kalibrasyon için Canlı sekmesinde Coriolis debi sensörünü açın ve adını girin.', 'err');
    const h = S.calib.hist;
    const fmtLocal = t => { const d = new Date(t - new Date().getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };
    const now = Date.now();
    const body = document.createElement('div');
    body.className = 'hist';
    body.innerHTML = `
      <p class="note">Coriolis debi ve ΔP ${S.sensors.dpMode === 'diff' ? '(P1 − P2)' : ''} için InfluxDB'deki geçmiş veriden <b>debinin kararlı olduğu bölümler</b> bulunur; her bölümün ortalaması aday test noktası olur. Sensör adları, düzeltmeler (a·x+b) ve birimler Canlı sekmesinden alınır.</p>
      <div class="hist-opts">
        <label>Başlangıç <input type="datetime-local" data-h="start" value="${fmtLocal(now - h.hours * 3600000)}"></label>
        <label>Bitiş <input type="datetime-local" data-h="end" value="${fmtLocal(now)}"></label>
        <label>Gruplama <span class="inp"><input type="number" data-h="groupSec" min="1" value="${h.groupSec}"><span class="unit-static">sn</span></span></label>
        <label>Kararlılık süresi <span class="inp"><input type="number" data-h="stableSec" min="10" value="${h.stableSec}"><span class="unit-static">sn</span></span></label>
        <label>Debi dalgalanması ≤ <span class="inp"><input type="number" data-h="cvQ" min="0.01" step="0.1" value="${h.cvQ}"><span class="unit-static">%</span></span></label>
        <label>ΔP dalgalanması ≤ <span class="inp"><input type="number" data-h="cvDp" min="0.01" step="0.1" value="${h.cvDp}"><span class="unit-static">%</span></span></label>
        <label>En düşük debi <span class="inp"><input type="number" data-h="minFlowPct" min="0" step="1" value="${h.minFlowPct}"><span class="unit-static">% maks</span></span></label>
        <button class="btn primary" data-act="run">Verileri Getir ve Bölümleri Bul</button>
      </div>
      <div class="hist-msg note"></div>
      <div class="hist-chart" hidden><canvas></canvas></div>
      <div class="hist-table"></div>`;
    const msg = t => { body.querySelector('.hist-msg').innerHTML = t; };
    let segs = [];
    const opts = () => {
      const o = {};
      body.querySelectorAll('[data-h]').forEach(el => { o[el.dataset.h] = el.type === 'datetime-local' ? new Date(el.value).getTime() : Number(el.value); });
      return o;
    };

    function renderTable() {
      const un = S.units, ctx = { rho: 1000 };
      const ft = t => new Date(t).toLocaleString('tr-TR');
      body.querySelector('.hist-table').innerHTML = segs.length ? `
        <div class="btnrow"><b>${segs.length} kararlı bölüm</b><span class="note">${segs.filter(s => s.sel).length} seçili</span>
          <button class="btn sm" data-act="all">Tümünü seç</button><button class="btn sm" data-act="none">Hiçbiri</button></div>
        <div class="vm-wrap"><table class="grid"><thead><tr><th>✓</th><th>Başlangıç</th><th>Süre</th><th class="r">Debi</th><th class="r">ΔP</th><th class="r">T</th>${segs.some(s => s.p1) ? '<th class="r">P1 (mutlak)</th>' : ''}<th class="r">Dalg. Q / ΔP</th></tr></thead><tbody>
        ${segs.map((s, i) => `<tr><td><input type="checkbox" data-sel="${i}" ${s.sel ? 'checked' : ''}></td><td>${ft(s.t0)}</td><td>${Math.round((s.t1 - s.t0) / 1000)} sn</td>
          <td class="n">${U.fmt(U.fromSI('flow', s.q, S.calib.units.q, { rho: s.rho || ctx.rho }), 5)} ${U.label('flow', S.calib.units.q)}</td>
          <td class="n">${U.fmt(U.fromSI('pressure', s.dp, S.calib.units.dp), 5)} ${U.label('pressure', S.calib.units.dp)}</td>
          <td class="n">${s.T ? U.fmt(U.fromSI('temperature', s.T, un.temperature), 4) + ' ' + U.label('temperature', un.temperature) : '—'}</td>
          ${segs.some(x => x.p1) ? `<td class="n">${s.p1 ? U.fmt(U.fromSI('pressure', s.p1, 'bar'), 5) + ' bar' : '—'}</td>` : ''}
          <td class="n">%${s.cvQ.toFixed(2)} / %${s.cvDp.toFixed(2)}</td></tr>`).join('')}
        </tbody></table></div>` : '';
    }

    function renderChart(rows) {
      const box = body.querySelector('.hist-chart');
      box.hidden = !rows.length;
      if (!rows.length || typeof Chart === 'undefined') return;
      const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
      const fq = r => U.fromSI('flow', r.q, S.units.flow, { rho: r.rho || 1000 });
      const inSeg = r => segs.some(s => r.t >= s.t0 && r.t <= s.t1);
      const ds = [
        { label: 'Debi (Coriolis)', data: rows.map(r => ({ x: r.t, y: fq(r) })), borderColor: css('--muted'), borderWidth: 1, pointRadius: 0, showLine: true },
        { label: 'Kararlı bölümler', data: rows.filter(inSeg).map(r => ({ x: r.t, y: fq(r) })), backgroundColor: css('--accent'), borderColor: css('--accent'), pointRadius: 2.5 }
      ];
      const tx = css('--chart-text'), gr = css('--chart-grid');
      const o = {
        animation: false, responsive: true, maintainAspectRatio: false, parsing: false,
        scales: { x: { type: 'linear', ticks: { color: tx, maxTicksLimit: 8, callback: v => new Date(v).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) }, grid: { color: gr } },
          y: { title: { display: true, text: `Debi [${U.label('flow', S.units.flow)}]`, color: tx }, ticks: { color: tx }, grid: { color: gr } } },
        plugins: { legend: { labels: { color: tx, boxWidth: 10 } } }
      };
      if (chart) chart.destroy();
      chart = new Chart(box.querySelector('canvas'), { type: 'scatter', data: { datasets: ds }, options: o });
    }

    async function run() {
      const o = opts();
      if (!(o.end > o.start)) return msg('<span class="badv">Bitiş, başlangıçtan sonra olmalı.</span>');
      Object.assign(S.calib.hist, { groupSec: o.groupSec, stableSec: o.stableSec, cvQ: o.cvQ, cvDp: o.cvDp, minFlowPct: o.minFlowPct, hours: Math.max(0.1, (o.end - o.start) / 3600000) });
      VF.Store.save();
      const sensors = VF.Live.sensorsList();
      msg(`InfluxDB sorgulanıyor… (${sensors.length} sensör, ${o.groupSec} sn gruplama)`);
      try {
        const series = await VF.Influx.fetchSeries(S.influx, sensors, o.start, o.end, o.groupSec);
        const rows = buildRows(series);
        if (!rows.length) { segs = []; renderTable(); renderChart([]); return msg('<span class="badv">Bu aralıkta debi ve ΔP verisi birlikte bulunamadı. Sensör adlarını ve aralığı kontrol edin.</span>'); }
        segs = findSegments(rows, o);
        msg(`${rows.length} zaman noktası okundu (${new Date(rows[0].t).toLocaleString('tr-TR')} – ${new Date(rows[rows.length - 1].t).toLocaleString('tr-TR')}). ` +
          (segs.length ? 'Eklemek istediğiniz bölümleri seçin.' : '<b>Kararlı bölüm bulunamadı</b> — dalgalanma eşiklerini artırın veya kararlılık süresini kısaltın.'));
        renderTable(); renderChart(rows);
      } catch (e) {
        msg(`<span class="badv">Hata: ${esc(e.message)}</span>`);
        if (e.kind === 'mixed') VF.Live.showMixedGuide();
      }
    }

    body.addEventListener('click', e => {
      const a = e.target.closest('[data-act]');
      if (!a) return;
      if (a.dataset.act === 'run') run();
      if (a.dataset.act === 'all' || a.dataset.act === 'none') { segs.forEach(s => { s.sel = a.dataset.act === 'all'; }); renderTable(); }
    });
    body.addEventListener('change', e => { if (e.target.dataset.sel !== undefined) { segs[+e.target.dataset.sel].sel = e.target.checked; renderTable(); } });

    VF.UI.modal({
      title: 'Geçmiş Veriden Kalibrasyon Noktası Bul', wide: true, body,
      buttons: [
        { label: 'Kapat' },
        { label: 'Seçilenleri kalibrasyona ekle', primary: true, action: () => {
          const pick = segs.filter(s => s.sel);
          if (!pick.length) { VF.UI.toast('Seçili bölüm yok.', 'err'); return false; }
          pick.forEach(s => VF.CalibUI.addFromLive({ qm: s.q, dp: s.dp, T: s.T, rho: s.rho, p1: s.p1, src: 'geçmiş' }));
          VF.UI.toast(`${pick.length} test noktası geçmiş veriden eklendi.`, 'ok');
        } }
      ]
    });
  }

  function init() {
    const b = $('calHist');
    if (b) b.onclick = open;
  }

  VF.History = { init, open, findSegments };
})(window.VF = window.VF || {});
