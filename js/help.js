/* VenturiFlow Master — Yardım: README'yi (gömülü kopya) içindekiler listesiyle gösterir */
(function (VF) {
  'use strict';

  const slug = t => t.toLowerCase().trim()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s/g, '-');

  /** Markdown → HTML; $$…$$ formülleri marked'dan korunur, MathJax ile dizilir */
  function render(md) {
    const math = [];
    const safe = md.replace(/\$\$([\s\S]+?)\$\$/g, (m, tex) => `@@MATH${math.push(tex) - 1}@@`);
    let html = window.marked ? marked.parse(safe, { gfm: true }) : `<pre>${VF.CSV.esc(md)}</pre>`;
    html = html.replace(/@@MATH(\d+)@@/g, (m, i) => `\\[${VF.CSV.esc(math[+i])}\\]`);
    return html;
  }

  function open() {
    const md = window.VF_README || '# Yardım bulunamadı';
    const body = document.createElement('div');
    body.className = 'help';
    body.innerHTML = `<nav class="help-toc"><input type="search" class="help-q" placeholder="Başlıklarda ara…"><div class="help-list"></div></nav>
      <article class="help-doc">${render(md)}</article>`;
    const doc = body.querySelector('.help-doc');
    const list = body.querySelector('.help-list');
    // Başlıklara kimlik ver, içindekiler listesini oluştur
    const heads = [...doc.querySelectorAll('h1, h2, h3')];
    heads.forEach(h => { h.id = slug(h.textContent); });
    list.innerHTML = heads.filter(h => h.tagName !== 'H1').map(h =>
      `<a href="#${h.id}" class="lvl-${h.tagName.toLowerCase()}" data-t="${VF.CSV.esc(h.textContent.toLowerCase())}">${VF.CSV.esc(h.textContent)}</a>`).join('');
    // Belge içi bağlantılar (README'deki [x](#başlık)) ve içindekiler
    body.addEventListener('click', e => {
      const a = e.target.closest('a[href^="#"]');
      if (!a) return;
      e.preventDefault();
      const id = decodeURIComponent(a.getAttribute('href').slice(1));
      const t = doc.querySelector(`[id="${CSS.escape(id)}"]`) || heads.find(h => h.id === slug(id));
      if (t) doc.scrollTo({ top: t.offsetTop - doc.offsetTop - 8, behavior: 'smooth' });
    });
    doc.querySelectorAll('a[href^="http"]').forEach(a => { a.target = '_blank'; a.rel = 'noopener'; });
    body.querySelector('.help-q').addEventListener('input', e => {
      const q = e.target.value.toLowerCase().trim();
      list.querySelectorAll('a').forEach(a => { a.hidden = q && !a.dataset.t.includes(q); });
    });
    // Aktif başlığı vurgula
    doc.addEventListener('scroll', () => {
      let cur = null;
      for (const h of heads) { if (h.offsetTop - doc.offsetTop - doc.scrollTop <= 30) cur = h; else break; }
      list.querySelectorAll('a').forEach(a => a.classList.toggle('on', cur && a.getAttribute('href') === '#' + cur.id));
    });
    VF.UI.modal({ title: 'VenturiFlow Master — Kullanım Kılavuzu (README)', body, wide: true });
    if (window.MathJax && MathJax.typesetPromise) MathJax.typesetPromise([doc]).catch(() => {});
  }

  VF.Help = { open, render };
})(window.VF = window.VF || {});
