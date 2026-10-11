/* VenturiFlow Master — Zaman trendi: canlı okumaların (ortalama) zamana göre grafiği.
 * Performans eğrisi kartında ikinci sekme olarak gösterilir. */
(function (VF) {
  'use strict';
  const U = VF.Units;
  const $ = id => document.getElementById(id);
  const st = () => VF.Store.state;
  let chart = null, lastDraw = 0, timer = null;

  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const hhmmss = t => new Date(t).toLocaleTimeString('tr-TR');

  function visible() { return st().chartTab === 'trend' && !$('viewMain').hidden; }

  function data() {
    const hist = VF.Live.hist;
    const min = Number(st().trend.minutes) || 0;
    const t0 = min > 0 && hist.length ? hist[hist.length - 1].t - min * 60000 : -Infinity;
    const rows = hist.filter(h => h.t >= t0);
    const ctx = VF.App.lastCalc ? VF.App.lastCalc.c.ctx : { rho: 1000 };
    const fu = st().units.flow, pu = st().units.pressure;
    const f = v => v > 0 ? U.fromSI('flow', v, fu, ctx) : null;
    return {
      fu: U.label('flow', fu), pu: U.label('pressure', pu),
      qCalc: rows.map(h => ({ x: h.t, y: f(h.qCalc) })),
      qMeas: rows.filter(h => h.qMeas > 0).map(h => ({ x: h.t, y: f(h.qMeas) })),
      dp: rows.map(h => ({ x: h.t, y: U.fromSI('pressure', h.dp, pu) })),
      dev: rows.filter(h => h.dev !== null && isFinite(h.dev)).map(h => ({ x: h.t, y: h.dev })),
      n: rows.length
    };
  }

  function options(d) {
    const tx = css('--chart-text'), gr = css('--chart-grid');
    return {
      animation: false, responsive: true, maintainAspectRatio: false, parsing: false, normalized: true,
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      scales: {
        x: { type: 'linear', grid: { color: gr }, ticks: { color: tx, maxTicksLimit: 8, callback: v => hhmmss(v) } },
        yQ: { position: 'left', title: { display: true, text: `Debi [${d.fu}]`, color: tx }, grid: { color: gr }, ticks: { color: tx } },
        yP: { position: 'right', title: { display: true, text: `ΔP [${d.pu}]`, color: tx }, grid: { drawOnChartArea: false }, ticks: { color: tx } },
        yD: { position: 'right', display: 'auto', title: { display: true, text: 'Sapma [%]', color: tx }, grid: { drawOnChartArea: false }, ticks: { color: tx } }
      },
      plugins: {
        legend: { labels: { color: tx, boxWidth: 10 } },
        tooltip: { callbacks: { title: it => it.length ? hhmmss(it[0].parsed.x) : '' } }
      }
    };
  }

  function datasets(d) {
    return [
      { label: 'Debi (hesap)', data: d.qCalc, yAxisID: 'yQ', borderColor: css('--accent'), backgroundColor: css('--accent'), borderWidth: 2, pointRadius: 0, showLine: true },
      { label: 'Debi (Coriolis)', data: d.qMeas, yAxisID: 'yQ', borderColor: css('--amber'), backgroundColor: css('--amber'), borderWidth: 2, pointRadius: 0, showLine: true },
      { label: 'ΔP', data: d.dp, yAxisID: 'yP', borderColor: '#ff4d4d', backgroundColor: '#ff4d4d', borderWidth: 1.5, borderDash: [5, 3], pointRadius: 0, showLine: true },
      { label: 'Sapma %', data: d.dev, yAxisID: 'yD', borderColor: '#a78bfa', backgroundColor: '#a78bfa', borderWidth: 1.2, pointRadius: 0, showLine: true, hidden: true }
    ];
  }

  function draw() {
    if (!visible() || typeof Chart === 'undefined') return;
    lastDraw = Date.now();
    const d = data();
    $('trendEmpty').hidden = d.n > 0;
    if (!chart) {
      chart = new Chart($('trendChart'), { type: 'scatter', data: { datasets: datasets(d) }, options: options(d) });
    } else {
      const hidden = chart.data.datasets.map((ds, i) => !chart.isDatasetVisible(i));
      const nds = datasets(d);
      chart.data.datasets.forEach((ds, i) => { ds.data = nds[i].data; ds.label = nds[i].label; });
      chart.options.scales.yQ.title.text = `Debi [${d.fu}]`;
      chart.options.scales.yP.title.text = `ΔP [${d.pu}]`;
      hidden.forEach((h, i) => chart.setDatasetVisibility(i, !h));
      chart.update();
    }
    $('trendInfo').textContent = d.n ? `${d.n} okuma` : '';
  }

  /** Yeni canlı veri geldiğinde (en fazla saniyede 2 çizim) */
  function onData() {
    if (!visible()) return;
    const wait = 500 - (Date.now() - lastDraw);
    if (wait <= 0) draw();
    else if (!timer) timer = setTimeout(() => { timer = null; draw(); }, wait);
  }

  function setTab(tab) {
    st().chartTab = tab === 'trend' ? 'trend' : 'curve';
    const tr = st().chartTab === 'trend';
    document.querySelectorAll('#chartTabs button').forEach(b => b.classList.toggle('on', b.dataset.ct === st().chartTab));
    $('chartBox').hidden = tr; $('whatifRow').hidden = tr; $('chartLegend').hidden = tr;
    $('trendBox').hidden = !tr; $('trendBar').hidden = !tr;
    VF.Store.save();
    if (tr) setTimeout(draw, 0);
  }

  function init() {
    $('chartTabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setTab(b.dataset.ct); });
    $('trendMin').addEventListener('change', e => { st().trend.minutes = Number(e.target.value); VF.Store.save(); draw(); });
    $('trendClear').onclick = () => { VF.Live.hist.length = 0; draw(); };
  }

  /** Arayüz yeniden kurulduğunda (venturi geçişi vb.) */
  function refresh() {
    $('trendMin').value = String(st().trend.minutes);
    setTab(st().chartTab);
  }

  function onTheme() { if (chart) { chart.destroy(); chart = null; } if (visible()) draw(); }

  VF.Trend = { init, refresh, onData, onTheme, draw };
})(window.VF = window.VF || {});
