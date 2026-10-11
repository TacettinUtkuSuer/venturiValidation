/* VenturiFlow Master — Chart.js performans eğrisi (MODÜL 4 & 5) */
(function (VF) {
  'use strict';

  let chart = null, dotEl = null, dotLbl = null, last = null;

  const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  function themeColors(light) {
    if (light) return { accent: '#0e7490', amber: '#b45309', grid: 'rgba(71,85,105,0.18)', text: '#334155', whatif: '#7c3aed', bad: '#dc2626', warn: '#b45309' };
    return { accent: css('--accent'), amber: css('--amber'), grid: css('--chart-grid'), text: css('--chart-text'), whatif: '#a78bfa', bad: css('--bad'), warn: css('--warn') };
  }

  // Dikey sınır çizgileri (kavitasyon başlangıcı, τ = 0,75, tasarım maks.)
  const limitPlugin = {
    id: 'vfLimits',
    afterDatasetsDraw(c) {
      const lims = c.options.plugins.vfLimits && c.options.plugins.vfLimits.lines;
      if (!lims) return;
      const { ctx, chartArea: a, scales: { x } } = c;
      ctx.save();
      for (const l of lims) {
        if (!(l.x >= x.min && l.x <= x.max)) continue;
        const px = x.getPixelForValue(l.x);
        ctx.strokeStyle = l.color; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(px, a.top); ctx.lineTo(px, a.bottom); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = l.color; ctx.font = '600 12.5px Inter, Segoe UI, sans-serif';
        ctx.textAlign = 'right';
        ctx.save(); ctx.translate(px - 4, a.top + 4); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'right'; ctx.fillText(l.label, 0, 0); ctx.restore();
      }
      ctx.restore();
    }
  };

  // Canlı kırmızı noktayı (HTML, CSS animasyonlu) grafik koordinatına taşır
  const dotPlugin = {
    id: 'vfDot',
    afterRender(c) {
      if (!dotEl || c !== chart) return;
      const live = c.options.plugins.vfDot && c.options.plugins.vfDot.point;
      if (!live || !isFinite(live.x) || !isFinite(live.y)) { dotEl.style.display = 'none'; return; }
      const px = c.scales.x.getPixelForValue(live.x), py = c.scales.y.getPixelForValue(live.y);
      const a = c.chartArea;
      const inside = px >= a.left - 1 && px <= a.right + 1 && py >= a.top - 1 && py <= a.bottom + 1;
      dotEl.style.display = 'block';
      dotEl.style.left = Math.min(Math.max(px, a.left), a.right) + 'px';
      dotEl.style.top = Math.min(Math.max(py, a.top), a.bottom) + 'px';
      dotEl.style.opacity = inside ? 1 : 0.55;
      dotLbl.textContent = live.label || '';
      dotLbl.style.left = px > (a.left + a.right) / 2 ? 'auto' : '16px';
      dotLbl.style.right = px > (a.left + a.right) / 2 ? '16px' : 'auto';
    }
  };

  function config(data, light) {
    const c = themeColors(light);
    return {
      type: 'scatter',
      data: {
        datasets: [
          { label: 'Teorik eğri', data: data.curve, showLine: true, borderColor: c.accent, backgroundColor: c.accent, borderWidth: 2.2, pointRadius: 0, tension: 0.25, order: 5 },
          { label: 'Belirsizlik bandı (+)', data: data.bandHi, showLine: true, borderColor: c.accent, borderWidth: 1, borderDash: [3, 3], pointRadius: 0, fill: false, order: 6 },
          { label: 'Belirsizlik bandı (−)', data: data.bandLo, showLine: true, borderColor: c.accent, borderWidth: 1, borderDash: [3, 3], pointRadius: 0, fill: false, order: 6 },
          { label: 'Ölçüm (CSV)', data: data.measured, borderColor: c.amber, backgroundColor: c.amber + '99', pointRadius: 3.5, pointStyle: 'rectRot', order: 3 },
          { label: 'What-If', data: data.whatIf ? [data.whatIf] : [], borderColor: '#fff', backgroundColor: c.whatif, borderWidth: 2, pointRadius: 7, pointHoverRadius: 8, order: 1 },
          { label: 'Canlı iz', data: data.trail || [], backgroundColor: 'rgba(255,45,45,0.30)', borderColor: 'rgba(255,45,45,0.5)', pointRadius: 2.5, order: 2 },
          { label: 'Canlı', data: data.live ? [data.live] : [], backgroundColor: '#ff2d2d', borderColor: '#ff2d2d', pointRadius: light ? 6 : 0, order: 0 },
          { label: 'Kalibre eğri', data: data.calib || [], showLine: true, borderColor: light ? '#be185d' : '#f472b6', backgroundColor: light ? '#be185d' : '#f472b6', borderWidth: 2.2, borderDash: [7, 4], pointRadius: 0, tension: 0.2, order: 4 }
        ]
      },
      options: {
        animation: false,
        responsive: !light, maintainAspectRatio: false,
        parsing: false, normalized: true,
        interaction: { mode: 'nearest', intersect: false },
        scales: {
          x: { type: 'linear', min: 0, max: data.xMax, title: { display: true, text: data.xLabel, color: c.text, font: { size: 13.5, weight: '600' } }, grid: { color: c.grid }, ticks: { color: c.text, font: { size: 12.5 } } },
          y: { type: 'linear', min: 0, max: data.yMax, title: { display: true, text: data.yLabel, color: c.text, font: { size: 13.5, weight: '600' } }, grid: { color: c.grid }, ticks: { color: c.text, font: { size: 12.5 } } }
        },
        plugins: {
          legend: { display: !!light, labels: { color: c.text, boxWidth: 10, font: { size: 10 }, filter: i => !/bandı \(−\)|Canlı iz/.test(i.text) } },
          tooltip: {
            filter: i => i.datasetIndex !== 1 && i.datasetIndex !== 2,
            callbacks: { label: i => `${i.dataset.label}: ${VF.Units.fmt(i.parsed.x, 4)} ${data.xUnit} · ${VF.Units.fmt(i.parsed.y, 4)} ${data.yUnit}` }
          },
          vfLimits: { lines: data.limits.map(l => ({ ...l, color: c[l.colorKey] || l.color })) },
          vfDot: { point: light ? null : data.live }
        }
      },
      plugins: [limitPlugin, dotPlugin]
    };
  }

  function init(canvas, dot, lbl) {
    dotEl = dot; dotLbl = lbl;
    if (typeof Chart === 'undefined') return false;
    Chart.defaults.font.size = 13;
    chart = new Chart(canvas.getContext('2d'), config({ curve: [], bandHi: [], bandLo: [], measured: [], limits: [], calib: [], xLabel: '', yLabel: '' }, false));
    return true;
  }

  function update(data) {
    last = data;
    if (!chart) return;
    const cfg = config(data, false);
    chart.data.datasets.forEach((ds, i) => { ds.data = cfg.data.datasets[i].data; });
    chart.options.scales = cfg.options.scales;
    chart.options.plugins.vfLimits = cfg.options.plugins.vfLimits;
    chart.options.plugins.vfDot = cfg.options.plugins.vfDot;
    chart.options.plugins.tooltip = cfg.options.plugins.tooltip;
    chart.update();
  }

  /** Yalnızca canlı nokta/iz güncellemesi (hafif) */
  function updateLive(live, trail) {
    if (!chart || !last) return;
    last.live = live; last.trail = trail;
    chart.data.datasets[5].data = trail || [];
    chart.data.datasets[6].data = live ? [live] : [];
    chart.options.plugins.vfDot = { point: live };
    chart.update();
  }

  function applyTheme() {
    if (!chart || !last) return;
    const cfg = config(last, false);
    chart.data.datasets.forEach((ds, i) => Object.assign(ds, cfg.data.datasets[i]));
    chart.options = cfg.options;
    chart.update();
  }

  /** Rapor için açık temalı, animasyonsuz PNG */
  function image(w, h) {
    if (typeof Chart === 'undefined' || !last) return Promise.resolve(null);
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    cv.style.cssText = `position:fixed;left:-${w + 100}px;top:0;width:${w}px;height:${h}px`;
    document.body.appendChild(cv);
    const cfg = config(last, true);
    cfg.options.devicePixelRatio = 2;
    cfg.plugins = [limitPlugin, { id: 'bg', beforeDraw: c => { const x = c.ctx; x.save(); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.restore(); } }];
    const ch = new Chart(cv.getContext('2d'), cfg);
    const url = ch.toBase64Image('image/png');
    ch.destroy(); cv.remove();
    return Promise.resolve(url);
  }

  VF.ChartView = { init, update, updateLive, applyTheme, image, get chart() { return chart; } };
})(window.VF = window.VF || {});
