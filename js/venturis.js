/* VenturiFlow Master — Çoklu venturi yönetimi (seçim, yeni, kopya, yeniden adlandırma, not, sil, dışa/içe aktar) */
(function (VF) {
  'use strict';
  const U = VF.Units;
  const $ = id => document.getElementById(id);
  const esc = s => VF.CSV.esc(s);
  let A = null;

  function summary(rec) {
    const d = rec.data || {};
    const inp = d.inputs || {};
    const len = k => inp[k] ? U.toSI('length', Number(inp[k].v), inp[k].u) : NaN;
    const D = len('D'), dd = len('d');
    const fl = A.state.fluids.find(f => f.id === d.activeFluid);
    const cal = d.calib && d.calib.rows ? d.calib.rows.length : 0;
    const sn = d.sensors && d.sensors.list ? (d.sensors.dpMode === 'diff'
      ? `${d.sensors.list.p1.name} − ${d.sensors.list.p2.name}` : d.sensors.list.dp.name) : '—';
    return {
      geo: isFinite(D) && isFinite(dd) ? `D ${(D * 1000).toFixed(1)} · d ${(dd * 1000).toFixed(1)} mm · β ${(dd / D).toFixed(3)}` : '—',
      fluid: fl ? fl.name : '—',
      cal: cal ? `${cal} nokta${d.calib.apply ? ' · aktif' : ''}` : '—',
      sensor: sn
    };
  }

  function openManager() {
    A.snapshotVenturi();
    const body = document.createElement('div');
    const fileIn = document.createElement('input');
    fileIn.type = 'file'; fileIn.accept = '.json,application/json'; fileIn.hidden = true;

    function render() {
      const st = A.state;
      body.innerHTML = `<p class="note">Her venturinin tasarımı, akışkan seçimi, sensör adları/düzeltmeleri, ölçüm verisi ve kalibrasyonu ayrı saklanır. Akışkan kütüphanesi, birimler ve InfluxDB bağlantısı tüm venturiler için ortaktır. Ad ve not alanları yazdıkça kaydedilir.</p>
        <div class="vm-wrap"><table class="grid vm">
          <thead><tr><th></th><th>Ad</th><th>Not / konum</th><th>Geometri</th><th>Akışkan</th><th>ΔP sensörü</th><th>Kalibrasyon</th><th>Güncellendi</th><th></th></tr></thead>
          <tbody>${st.venturis.map(v => {
            const s = summary(v), act = v.id === st.activeVenturi;
            return `<tr class="${act ? 'act' : ''}" data-id="${esc(v.id)}">
              <td>${act ? '<span class="badge">açık</span>' : ''}</td>
              <td><input type="text" data-k="name" value="${esc(v.name)}"></td>
              <td><input type="text" data-k="note" value="${esc(v.note || '')}" placeholder="ör. Hat 3, pompa çıkışı"></td>
              <td class="mono s">${esc(s.geo)}</td><td>${esc(s.fluid)}</td><td class="mono s">${esc(s.sensor)}</td><td>${esc(s.cal)}</td>
              <td class="s">${v.updated ? new Date(v.updated).toLocaleString('tr-TR') : '—'}</td>
              <td class="acts">
                ${act ? '' : '<button class="btn sm primary" data-a="open">Aç</button>'}
                <button class="btn sm" data-a="copy" title="Kopyasını oluştur ve aç">⧉ Kopyala</button>
                <button class="btn sm" data-a="export" title="Bu venturiyi JSON dosyası olarak indir">⤓</button>
                <button class="btn sm danger" data-a="del" title="Sil">✕</button>
              </td></tr>`;
          }).join('')}</tbody></table></div>`;
    }

    body.addEventListener('input', e => {
      const k = e.target.dataset.k, tr = e.target.closest('tr');
      if (!k || !tr) return;
      A.updateVenturiMeta(tr.dataset.id, { [k]: e.target.value });
    });
    body.addEventListener('click', e => {
      const b = e.target.closest('[data-a]');
      if (!b) return;
      const id = b.closest('tr').dataset.id;
      const rec = A.state.venturis.find(v => v.id === id);
      if (b.dataset.a === 'open') { A.switchVenturi(id); render(); }
      if (b.dataset.a === 'copy') { A.newVenturi(id); render(); }
      if (b.dataset.a === 'export') A.exportVenturi(id);
      if (b.dataset.a === 'del' && confirm(`"${rec.name}" ve tüm verisi (tasarım, sensörler, kalibrasyon) silinsin mi?`)) { A.deleteVenturi(id); render(); }
    });
    fileIn.addEventListener('change', async () => {
      const f = fileIn.files[0]; fileIn.value = '';
      if (!f) return;
      try {
        const obj = JSON.parse(await f.text());
        if (obj.kind !== 'venturi') throw new Error('Bu dosya tek venturi dosyası değil (tüm yedek için üst çubuktaki "JSON Yükle"yi kullanın).');
        A.importVenturi(obj); render();
      } catch (err) { A.toast('İçe aktarma hatası: ' + err.message, 'err'); }
    });
    body.appendChild(fileIn);
    render();
    A.modal({
      title: 'Venturiler', wide: true, body,
      buttons: [
        { label: '⤒ Venturi dosyası içe aktar…', action: () => { fileIn.click(); return false; } },
        { label: '＋ Yeni venturi', action: () => { A.newVenturi(null); render(); return false; } },
        { label: 'Kapat', primary: true }
      ]
    });
  }

  function init(app) {
    A = app;
    $('selVenturi').addEventListener('change', e => A.switchVenturi(e.target.value));
    $('btnVNew').onclick = () => A.newVenturi(null);
    $('btnVCopy').onclick = () => A.newVenturi(A.state.activeVenturi);
    $('btnVManage').onclick = openManager;
  }

  VF.VenturiUI = { init, openManager };
})(window.VF = window.VF || {});
