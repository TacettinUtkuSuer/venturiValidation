/* VenturiFlow Master — Arayüz yardımcıları: pencere (modal), bildirim (toast), dosya indirme */
(function (VF) {
  'use strict';
  const $ = id => document.getElementById(id);

  const UI = {
    /** { title, body (string|Element), buttons:[{label, primary, action → false ise açık kalır}], wide } */
    modal({ title, body, buttons, wide }) {
      const bg = document.createElement('div');
      bg.className = 'modal-bg';
      bg.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
        <div class="modal-h"><span></span><button class="btn icon sm x" aria-label="Kapat">✕</button></div>
        <div class="modal-b"></div><div class="modal-f"></div></div>`;
      bg.querySelector('.modal-h span').textContent = title;
      const b = bg.querySelector('.modal-b');
      if (typeof body === 'string') b.innerHTML = body; else b.appendChild(body);
      const close = () => { bg.remove(); document.removeEventListener('keydown', onKey); };
      const onKey = e => { const all = document.querySelectorAll('.modal-bg'); if (e.key === 'Escape' && all[all.length - 1] === bg) close(); };
      document.addEventListener('keydown', onKey);
      bg.querySelector('.x').onclick = close;
      bg.addEventListener('mousedown', e => { if (e.target === bg) close(); });
      const f = bg.querySelector('.modal-f');
      (buttons || [{ label: 'Kapat', primary: true }]).forEach(btn => {
        const el = document.createElement('button');
        el.className = 'btn' + (btn.primary ? ' primary' : '');
        el.textContent = btn.label;
        el.onclick = () => { if (!btn.action || btn.action() !== false) close(); };
        f.appendChild(el);
      });
      document.body.appendChild(bg);
      return { close, el: bg };
    },

    toast(msg, kind) {
      const t = document.createElement('div');
      t.className = 'toast ' + (kind || '');
      t.textContent = msg;
      $('toasts').appendChild(t);
      setTimeout(() => t.remove(), 4200);
    },

    /** Nesneyi JSON (veya metni) dosya olarak indirir */
    download(name, obj, type) {
      const text = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
      const blob = new Blob([text], { type: type || 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
  };

  VF.UI = UI;
})(window.VF = window.VF || {});
