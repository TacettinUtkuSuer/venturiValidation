/* VenturiFlow Master — A4 PDF raporu (html2pdf.js) (MODÜL 6) */
(function (VF) {
  'use strict';
  const esc = s => VF.CSV.esc(s);

  /** MathJax TeX → PNG dataURL (rapora gömmek için) */
  async function texToPng(tex) {
    if (!window.MathJax || !MathJax.tex2svg) return null;
    const node = MathJax.tex2svg(tex, { display: true });
    const svg = node.querySelector('svg');
    if (!svg) return null;
    const EX = 8; // 1ex ≈ 8px (16px yazı tipinde)
    const w = Math.ceil(parseFloat(svg.getAttribute('width')) * EX);
    const h = Math.ceil(parseFloat(svg.getAttribute('height')) * EX);
    svg.setAttribute('width', w); svg.setAttribute('height', h);
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.setAttribute('color', '#111827');
    svg.removeAttribute('style');
    const text = new XMLSerializer().serializeToString(svg).replace(/currentColor/g, '#111827');
    try {
      const url = await VF.Draw.svgToPng(text, w, h, 2);
      return { url, w, h };
    } catch (e) { return null; }
  }

  function table(rows) {
    return `<table>${rows.map(r => `<tr class="${r[2] ? 'hl' : ''}"><td>${esc(r[0])}</td><td class="n">${esc(r[1])}</td></tr>`).join('')}</table>`;
  }

  async function build(rep) {
    const el = document.createElement('div');
    el.className = 'report';
    const fx = [];
    for (const f of rep.formulas) {
      const img = await texToPng(f.tex);
      fx.push(`<div class="fx avoid"><div class="meta">${esc(f.t)}</div>${img ? `<img src="${img.url}" style="width:${img.w * 0.72}px">` : `<code>${esc(f.tex)}</code>`}</div>`);
    }
    el.innerHTML = `
      <h1>VenturiFlow Master — Venturi Tasarım &amp; Doğrulama Raporu</h1>
      <div class="meta">Tarih: ${esc(rep.date)} · Metot: <b>${esc(rep.method)}</b> · ${esc(rep.typeName)} · Akışkan: <b>${esc(rep.fluidName)}</b></div>

      <div class="avoid"><h2>1. Ölçekli Venturi Kesiti</h2>
      ${rep.svgPng ? `<img src="${rep.svgPng}">` : ''}</div>

      <div class="cols avoid">
        <div><h2>2. Geometri</h2>${table(rep.geometry)}</div>
        <div><h2>3. Akışkan &amp; İşletme</h2>${table(rep.fluid)}</div>
      </div>

      <div class="avoid"><h2>4. Hesap Sonuçları</h2>
      <table>
        <tr><th>Büyüklük</th><th>Çalışma noktası (What-If)</th><th>Maks. tasarım debisi</th></tr>
        ${rep.results.map(r => `<tr class="${r[3] ? 'hl' : ''}"><td>${esc(r[0])}</td><td class="n">${esc(r[1])}</td><td class="n">${esc(r[2])}</td></tr>`).join('')}
      </table></div>

      <div class="avoid"><h2>5. Performans Eğrisi (Debi – ΔP)</h2>
      ${rep.chartPng ? `<img src="${rep.chartPng}">` : '<p>Grafik oluşturulamadı.</p>'}</div>

      <div class="cols avoid">
        <div>
          <h2>6. Belirsizlik Bütçesi (çalışma noktası)</h2>
          <table><tr><th>Bileşen</th><th>Duyarlılık</th><th>u (%)</th><th>Katkı (%)</th></tr>
            ${rep.unc.parts.map(p => `<tr><td>${esc(p.name)}</td><td class="n">${p.sens.toFixed(3)}</td><td class="n">${VF.Units.fmt(p.u, 3)}</td><td class="n">${VF.Units.fmt(p.contrib, 3)}</td></tr>`).join('')}
            <tr class="hl"><td colspan="3">Toplam Belirsizlik (k≈2, %95)</td><td class="n">±%${rep.unc.total.toFixed(2)}</td></tr>
          </table>
        </div>
        <div>
          <h2>7. Uygunluk Kontrolleri</h2>
          <table><tr><th>Kontrol</th><th>Değer</th><th>Aralık</th><th></th></tr>
            ${rep.checks.map(c => `<tr><td>${esc(c.name)}</td><td class="n">${esc(c.value)}</td><td>${esc(c.range)}</td><td class="${c.ok ? 'ok' : 'no'}">${c.ok ? '✓' : '✗'}</td></tr>`).join('')}
          </table>
          <h2>8. Düz Boru Mesafeleri</h2>
          ${table(rep.straight)}
        </div>
      </div>

      <h2>9. Kullanılan Denklemler</h2>
      ${fx.join('')}

      <div class="foot">Bu rapor VenturiFlow Master tarafından ${esc(rep.date)} tarihinde oluşturulmuştur. Hesaplar ${esc(rep.method)} esaslıdır;
      kalıcı basınç kaybı Gibson difüzör korelasyonu ile tahmin edilmiştir. Kritik uygulamalarda sonuçları ilgili standardın güncel baskısıyla doğrulayınız.</div>`;
    return el;
  }

  async function generate(rep) {
    if (typeof html2pdf === 'undefined') throw new Error('html2pdf.js yüklenemedi (CDN erişimini kontrol edin).');
    const el = await build(rep);
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
    await html2pdf().set({
      margin: [10, 10, 12, 10],
      filename: `VenturiFlow_Rapor_${stamp}.pdf`,
      image: { type: 'jpeg', quality: 0.95 },
      html2canvas: { scale: 2, backgroundColor: '#ffffff', useCORS: true },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['css', 'legacy'], avoid: '.avoid' }
    }).from(el).save();
  }

  VF.Report = { generate, build, texToPng };
})(window.VF = window.VF || {});
