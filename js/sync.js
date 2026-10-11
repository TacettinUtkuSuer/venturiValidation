/* VenturiFlow Master — Ortak kayıt: GitHub deposu üzerinden otomatik eşitleme
 *
 * - Veri, GitHub Contents API ile tek bir JSON dosyasında tutulur; her kayıt bir commit'tir.
 * - Yazma anahtarı (fine-grained token) koda ŞİFRELİ gömülür (PBKDF2 + AES-GCM).
 *   Kullanıcı ortak parolayı bir kez girer; çözülen anahtar bu tarayıcıda saklanır.
 * - Parolası olmayan bilgisayarlar (depo public ise) sadece okur.
 * - Çakışma: GitHub dosyanın sha değerini kontrol eder; araya başka kayıt girdiyse kullanıcıya sorulur.
 */
(function (VF) {
  'use strict';

  const API = 'https://api.github.com';
  const K = { token: 'venturiflow.sync.token', name: 'venturiflow.sync.name', meta: 'venturiflow.sync.meta', asked: 'venturiflow.sync.asked' };
  const ITER = 250000;
  const PUSH_DELAY = 5000;

  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* yok say */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* yok say */ } }
  };

  /* ---------------- Base64 (UTF-8 güvenli) ---------------- */
  function bytesToB64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  const b64ToBytes = b64 => Uint8Array.from(atob(b64.replace(/\s/g, '')), c => c.charCodeAt(0));
  const textToB64 = t => bytesToB64(new TextEncoder().encode(t));
  const b64ToText = b => new TextDecoder().decode(b64ToBytes(b));

  /* ---------------- Şifreleme ---------------- */
  async function deriveKey(pass, salt, iter) {
    if (!(window.crypto && crypto.subtle)) throw new Error('Tarayıcı WebCrypto desteklemiyor (HTTPS, localhost veya dosya olarak açın).');
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  async function encrypt(secret, pass) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(pass, salt, ITER);
    const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(secret)));
    return { v: 1, iter: ITER, salt: bytesToB64(salt), iv: bytesToB64(iv), data: bytesToB64(data) };
  }

  async function decrypt(c, pass) {
    const key = await deriveKey(pass, b64ToBytes(c.salt), c.iter || ITER);
    try {
      const out = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(c.iv) }, key, b64ToBytes(c.data));
      return new TextDecoder().decode(out);
    } catch (e) { throw new Error('Parola yanlış.'); }
  }

  /* ---------------- GitHub API ---------------- */
  class SyncError extends Error { constructor(kind, msg) { super(msg); this.kind = kind; } }

  async function gh(method, url, token, body) {
    const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    if (token) headers.Authorization = 'Bearer ' + token;
    if (body) headers['Content-Type'] = 'application/json';
    let res;
    try {
      res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
    } catch (e) { throw new SyncError('network', 'GitHub\'a ulaşılamadı (internet bağlantısı?)'); }
    return res;
  }

  async function failure(res, ctx) {
    let msg = '';
    try { msg = (await res.json()).message || ''; } catch (e) { /* boş */ }
    if (res.status === 401) return new SyncError('auth', 'Anahtar geçersiz veya süresi dolmuş.');
    if (res.status === 403 && /rate limit/i.test(msg)) return new SyncError('rate', 'GitHub istek limiti doldu, biraz sonra tekrar denenecek.');
    if (res.status === 403) return new SyncError('auth', 'Anahtarın bu depoya yazma izni yok.');
    if (res.status === 404) return new SyncError('notfound', ctx === 'write' ? 'Depo bulunamadı veya anahtarın erişimi yok.' : 'Depo bulunamadı (private ise parola gerekli).');
    if (res.status === 409 || res.status === 422) return new SyncError('conflict', 'Dosya başka bir bilgisayardan değiştirildi.');
    return new SyncError('http', `GitHub hatası (HTTP ${res.status}) ${msg}`);
  }

  function fileUrl() {
    const c = cfg();
    return `${API}/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/${c.path.split('/').map(encodeURIComponent).join('/')}`;
  }

  async function readRemote() {
    const res = await gh('GET', fileUrl(), token());
    if (res.status === 404) {
      // Dosya mı yok, depo mu? Depoyu kontrol et.
      const c = cfg();
      const rr = await gh('GET', `${API}/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}`, token());
      if (rr.ok) return null;
      throw await failure(rr, 'read');
    }
    if (!res.ok) throw await failure(res, 'read');
    const j = await res.json();
    let b64 = j.content;
    if (!b64 && j.size > 0) {
      // 1 MB üzeri dosyalar için blob API
      const c = cfg();
      const br = await gh('GET', `${API}/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/git/blobs/${j.sha}`, token());
      if (!br.ok) throw await failure(br, 'read');
      b64 = (await br.json()).content;
    }
    let data;
    try { data = JSON.parse(b64ToText(b64 || '')); } catch (e) { throw new SyncError('parse', 'Ortak dosya okunamadı (geçersiz JSON).'); }
    return { sha: j.sha, data };
  }

  async function writeRemote(data, sha) {
    const body = {
      message: `VenturiFlow kaydı — ${data.savedBy} — ${new Date(data.savedAt).toLocaleString('tr-TR')}`,
      content: textToB64(JSON.stringify(data, null, 1))
    };
    if (sha) body.sha = sha;
    const res = await gh('PUT', fileUrl(), token(), body);
    if (!res.ok) throw await failure(res, 'write');
    return (await res.json()).content.sha;
  }

  /* ---------------- Durum ---------------- */
  let app = null;            // { getSharedJson, getSharedState, applyShared, isBlankVenturi, toast, modal }
  let status = { kind: 'off', text: 'Ortak kayıt kapalı' };
  let pushTimer = null, pollTimer = null, chain = Promise.resolve();
  let conflictOpen = false, lastPullAt = 0, lastError = '';

  const cfg = () => window.VF_SYNC_CONFIG || {};
  const enabled = () => !!(cfg().owner && cfg().repo && cfg().path);
  const token = () => ls.get(K.token);
  const canWrite = () => enabled() && !!token();
  const deviceName = () => ls.get(K.name) || 'Adsız bilgisayar';

  function meta() { try { return JSON.parse(ls.get(K.meta) || '{}'); } catch (e) { return {}; } }
  function setMeta(m) { ls.set(K.meta, JSON.stringify(m)); }

  // FNV-1a — yerel/ortak içerik karşılaştırması için kısa özet
  function hash(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(16) + ':' + s.length;
  }
  const dirty = () => hash(app.getSharedJson()) !== meta().hash;

  function setStatus(kind, text) {
    status = { kind, text };
    const b = document.getElementById('btnSync');
    if (b) {
      b.dataset.state = kind;
      b.querySelector('.lbl').textContent = text;
      const m = meta();
      b.title = m.savedAt ? `Son ortak kayıt: ${m.savedBy || '?'} · ${new Date(m.savedAt).toLocaleString('tr-TR')}` : 'Ortak kayıt (GitHub)';
    }
  }

  function idleStatus() {
    if (!enabled()) return setStatus('off', 'Ortak kapalı');
    if (lastError && !cfg().cipher) return setStatus('off', 'Ortak kapalı'); // henüz kurulmamış
    if (lastError) return setStatus('err', 'Ortak: hata');
    if (!canWrite()) return setStatus('ro', 'Ortak: salt okunur');
    return setStatus(dirty() ? 'pending' : 'ok', dirty() ? 'Ortak: bekliyor' : 'Ortak: eşit');
  }

  // İşlemleri sıraya al (aynı anda tek okuma/yazma)
  function queue(fn) {
    chain = chain.then(fn, fn).catch(e => handleError(e));
    return chain;
  }

  function handleError(e) {
    if (!e) return;
    console.warn('Sync', e);
    lastError = e.message;
    if (e.kind === 'auth' && token()) {
      ls.del(K.token);
      app.toast('Ortak kayıt anahtarı geçersiz; bu bilgisayar salt okunur moda geçti. Parolayı yeniden girin.', 'err');
    }
    idleStatus();
  }

  /* ---------------- Eşitleme (venturi bazında üç yollu birleştirme) ----------------
   * meta.base: son eşitleme anındaki her venturinin / akışkanın özeti.
   * Ortak dosya değiştiğinde öğe öğe karşılaştırılır: yalnız bir tarafta değişen alınır,
   * yeni eklenenler korunur, silinenler silinir; yalnızca AYNI öğe iki tarafta da
   * değiştiyse kullanıcıya sorulur. */
  const LISTS = [['venturis', 'v', 'Venturi'], ['fluids', 'f', 'Akışkan']];
  const itemHash = x => hash(JSON.stringify(x));
  function baseOf(sharedState) {
    const b = {};
    LISTS.forEach(([k, s]) => { b[s] = {}; (sharedState[k] || []).forEach(x => { b[s][x.id] = itemHash(x); }); });
    return b;
  }

  function apply(remote, silent) {
    app.applyShared(remote.data.state || {}, false);
    setMeta({ sha: remote.sha, hash: hash(app.getSharedJson()), base: baseOf(remote.data.state || {}), savedAt: remote.data.savedAt, savedBy: remote.data.savedBy });
    if (!silent) app.toast(`Ortak sürüm yüklendi — ${remote.data.savedBy || '?'}, ${new Date(remote.data.savedAt).toLocaleString('tr-TR')}`, 'ok');
  }

  /** local, remote: paylaşılan durum nesneleri; base: meta.base; first: ilk eşitleme */
  function merge3(local, remote, base, first) {
    const out = JSON.parse(JSON.stringify(remote));
    const conflicts = [];
    let localWins = 0;
    LISTS.forEach(([key, s, label]) => {
      const b = (base && base[s]) || {};
      let L = local[key] || [];
      if (first && key === 'venturis') L = L.filter(v => !app.isBlankVenturi(v));   // dokunulmamış varsayılan venturi taşınmaz
      const R = remote[key] || [];
      const lm = new Map(L.map(x => [x.id, x])), rm = new Map(R.map(x => [x.id, x]));
      const ids = R.map(x => x.id).concat(L.map(x => x.id).filter(id => !rm.has(id)));
      const res = [];
      ids.forEach(id => {
        const l = lm.get(id), r = rm.get(id), bh = b[id];
        if (l && r) {
          const hl = itemHash(l), hr = itemHash(r);
          if (hl === hr) return res.push(r);
          const lc = hl !== bh, rc = hr !== bh;
          if (lc && !rc) { localWins++; return res.push(l); }
          if (!lc && rc) return res.push(r);
          conflicts.push({ key, label, id, l, r, pos: res.length });
          return res.push(r);                       // çözüm sonrası değiştirilir
        }
        if (l && !r) {                               // yalnız bu bilgisayarda
          if (bh === undefined || itemHash(l) !== bh) { localWins++; res.push(l); }   // yeni ya da burada değişmiş → koru
          return;                                    // ortakta silinmiş ve burada değişmemiş → sil
        }
        if (!l && r) {                               // yalnız ortakta
          if (bh === undefined || itemHash(r) !== bh) res.push(r);   // yeni ya da orada değişmiş → al
          else if (first) res.push(r);               // ilk eşitleme: hepsini al
        }
      });
      out[key] = res;
    });
    return { merged: out, conflicts, localWins };
  }

  /** Gerçek çakışmalar için kullanıcıya sorar → çözülmüş durum */
  function resolve(merged, conflicts, remote) {
    if (!conflicts.length) return Promise.resolve(merged);
    conflictOpen = true;
    setStatus('conflict', 'Ortak: çakışma');
    return new Promise(done => {
      const name = x => VF.CSV.esc(x.name || x.id);
      const when = x => x.updated ? new Date(x.updated).toLocaleString('tr-TR') : '—';
      const body = document.createElement('div');
      body.innerHTML = `<p>Aşağıdaki öğeler hem bu bilgisayarda hem de ortak kayıtta (<b>${VF.CSV.esc(remote.data.savedBy || '?')}</b>) değiştirilmiş. Diğer tüm değişiklikler otomatik birleştirildi.</p>
        <table class="grid"><thead><tr><th>Tür</th><th>Bu bilgisayar</th><th>Ortak kayıt</th><th>Seçim</th></tr></thead><tbody>
        ${conflicts.map((c, i) => `<tr><td>${c.label}</td><td>${name(c.l)}<br><span class="note">${when(c.l)}</span></td><td>${name(c.r)}<br><span class="note">${when(c.r)}</span></td>
          <td><select data-c="${i}"><option value="both">İkisini de tut</option><option value="mine">Benimki</option><option value="theirs">Ortaktaki</option></select></td></tr>`).join('')}
        </tbody></table><p class="note">"İkisini de tut": ortaktaki aynen kalır, sizinki "(bu bilgisayar)" ekiyle ayrı bir kayıt olarak eklenir.</p>`;
      const finish = () => {
        conflictOpen = false;
        const picks = [...body.querySelectorAll('[data-c]')].map(el => el.value);
        conflicts.forEach((c, i) => {
          const list = merged[c.key];
          const idx = list.findIndex(x => x.id === c.id);
          if (picks[i] === 'mine') list[idx] = c.l;
          if (picks[i] === 'both') {
            const copy = JSON.parse(JSON.stringify(c.l));
            copy.id = (c.key === 'venturis' ? 'v' : 'f') + Date.now().toString(36) + Math.random().toString(36).slice(2, 5) + i;
            copy.name = (copy.name || '') + ' (bu bilgisayar)';
            list.splice(idx + 1, 0, copy);
          }
        });
        done(merged);
      };
      app.modal({ title: 'Ortak kayıt: aynı öğe iki yerde değişti', body, buttons: [{ label: 'Uygula', primary: true, action: finish }] });
      // pencere ✕/Esc ile kapanırsa varsayılan: ikisini de tut
      const obs = new MutationObserver(() => { if (!document.body.contains(body)) { obs.disconnect(); if (conflictOpen) finish(); } });
      obs.observe(document.body, { childList: true });
    });
  }

  /** Ortak dosya değişti ve burada da yazılmamış değişiklik var → birleştir */
  async function mergeWith(remote, first) {
    const m = meta();
    const local = app.getSharedState();
    const { merged, conflicts, localWins } = merge3(local, remote.data.state || {}, m.base, first);
    const final = await resolve(merged, conflicts, remote);
    const same = JSON.stringify(final) === JSON.stringify(remote.data.state || {});
    app.applyShared(final, false);
    // Ortak dosyadan farklıysa "kirli" kalır → yazılır (yazabiliyorsa)
    setMeta({ sha: remote.sha, base: baseOf(remote.data.state || {}), hash: same ? hash(app.getSharedJson()) : 'merged', savedAt: remote.data.savedAt, savedBy: remote.data.savedBy });
    const n = (conflicts.length ? `${conflicts.length} çakışma çözüldü · ` : '') + (localWins ? `bu bilgisayardan ${localWins} değişiklik korundu` : 'ortak değişiklikler alındı');
    app.toast(`Ortak kayıt birleştirildi (${remote.data.savedBy || '?'}): ${n}`, 'ok');
    if (canWrite() && dirty()) schedulePush(800);
  }

  function pull() {
    if (!enabled()) return Promise.resolve();
    return queue(async () => {
      if (conflictOpen) return;
      lastPullAt = Date.now();
      const remote = await readRemote();
      lastError = '';
      const m = meta();
      if (!remote) {
        if (canWrite()) await doPush(true);
        else setStatus('ro', 'Ortak: henüz kayıt yok');
        return;
      }
      if (remote.sha === m.sha) {
        if (dirty() && canWrite()) schedulePush(500);
        return idleStatus();
      }
      const first = !m.sha && !m.hash;
      if (!first && !dirty()) { apply(remote); return idleStatus(); }   // burada değişiklik yok → doğrudan al
      await mergeWith(remote, first);
      idleStatus();
    });
  }

  async function doPush(force, depth) {
    if (!canWrite()) return idleStatus();
    const shared = app.getSharedState();
    const json = JSON.stringify(shared);
    const h = hash(json);
    if (!force && h === meta().hash) return idleStatus();
    setStatus('saving', 'Ortak: kaydediliyor…');
    const data = { app: 'VenturiFlow Master', version: 2, savedAt: new Date().toISOString(), savedBy: deviceName(), state: shared };
    try {
      const sha = await writeRemote(data, meta().sha);
      lastError = '';
      setMeta({ sha, hash: h, base: baseOf(shared), savedAt: data.savedAt, savedBy: data.savedBy });
      idleStatus();
    } catch (e) {
      if (e.kind !== 'conflict' || (depth || 0) > 2) throw e;
      // Araya başka bir kayıt girdi → birleştir ve tekrar dene
      const remote = await readRemote();
      if (!remote) { setMeta({ ...meta(), sha: undefined }); return doPush(true, (depth || 0) + 1); }
      await mergeWith(remote, false);
      clearTimeout(pushTimer);
      return doPush(true, (depth || 0) + 1);
    }
  }

  function push(force) { return queue(() => doPush(force)); }

  function schedulePush(ms) {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => push(false), ms === undefined ? PUSH_DELAY : ms);
  }

  function schedulePoll() {
    clearTimeout(pollTimer);
    if (!enabled()) return;
    pollTimer = setTimeout(() => { if (!document.hidden) pull(); schedulePoll(); }, canWrite() ? 60000 : 180000);
  }

  /* ---------------- Arayüz ---------------- */
  async function unlock(pass, name) {
    const c = cfg().cipher;
    if (!c) throw new Error('Bu kurulumda şifreli anahtar tanımlı değil (js/sync-config.js → cipher).');
    const t = await decrypt(c, pass);
    const rr = await gh('GET', `${API}/repos/${encodeURIComponent(cfg().owner)}/${encodeURIComponent(cfg().repo)}`, t);
    if (!rr.ok) throw await failure(rr, 'write');
    ls.set(K.token, t);
    if (name) ls.set(K.name, name.trim());
    lastError = '';
    schedulePoll();
    await pull();
    await chain;
    if (!lastError) app.toast('Ortak kayıt açıldı: değişiklikler otomatik kaydedilecek.', 'ok');
  }

  function openPanel(first) {
    const c = cfg();
    const m = meta();
    const body = document.createElement('div');
    if (!enabled()) {
      body.innerHTML = `<p>Ortak kayıt yapılandırılmamış. <code>js/sync-config.js</code> dosyasında depo bilgilerini girin.</p>`;
      return app.modal({ title: 'Ortak Kayıt (GitHub)', body });
    }
    const repoLink = `https://github.com/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}`;
    body.innerHTML = `
      ${first ? '<p>Bu bilgisayarda tasarımların tüm bilgisayarlarla otomatik paylaşılması için ortak parolayı bir kez girin.</p>' : ''}
      <div class="infobox"><table>
        <tr><td>Depo</td><td><a href="${repoLink}" target="_blank" rel="noopener">${VF.CSV.esc(c.owner + '/' + c.repo)}</a></td></tr>
        <tr><td>Dosya</td><td>${VF.CSV.esc(c.path)}</td></tr>
        <tr><td>Bu bilgisayar</td><td>${canWrite() ? 'Yazabilir (otomatik kayıt açık)' : 'Salt okunur'}</td></tr>
        <tr><td>Son ortak kayıt</td><td>${m.savedAt ? VF.CSV.esc((m.savedBy || '?') + ' · ' + new Date(m.savedAt).toLocaleString('tr-TR')) : '—'}</td></tr>
        <tr><td>Durum</td><td>${VF.CSV.esc(lastError || status.text)}</td></tr>
      </table></div>
      ${canWrite() ? '' : c.cipher ? `
        <label class="row"><span>Ortak parola</span><input type="password" data-pass autocomplete="off"></label>
        <label class="row"><span>Bilgisayar adı <span class="hint">(commit'te görünür)</span></span><input type="text" data-name value="${VF.CSV.esc(ls.get(K.name) || '')}" placeholder="ör. Kontrol Odası PC"></label>
        <div class="csv-err" data-err></div>` : '<p class="note">Şifreli anahtar tanımlı değil; tüm bilgisayarlar salt okunur. Kurulum için README → “Ortak Kayıt” bölümüne bakın.</p>'}`;
    const buttons = [];
    if (canWrite()) {
      buttons.push({ label: 'Anahtarı bu bilgisayarda unut', action: () => { ls.del(K.token); idleStatus(); schedulePoll(); app.toast('Bu bilgisayar salt okunur moda geçti.', 'ok'); } });
      buttons.push({ label: 'Şimdi eşitle', primary: true, action: () => { pull().then(() => push(false)); } });
    } else {
      buttons.push({ label: first ? 'Sadece okuma' : 'Kapat' });
      buttons.push({ label: 'Şimdi yükle', action: () => { pull(); } });
      if (c.cipher) buttons.push({ label: 'Kilidi Aç', primary: true, action: () => {
        const pass = body.querySelector('[data-pass]').value;
        const err = body.querySelector('[data-err]');
        if (!pass) { err.textContent = 'Parola girin.'; return false; }
        err.textContent = 'Kontrol ediliyor…';
        unlock(pass, body.querySelector('[data-name]').value)
          .then(() => dlg.close())
          .catch(e => { err.textContent = e.message; });
        return false;
      } });
    }
    const dlg = app.modal({ title: 'Ortak Kayıt (GitHub)', body, buttons });
    const p = body.querySelector('[data-pass]');
    if (p) {
      p.focus();
      p.addEventListener('keydown', e => { if (e.key === 'Enter') dlg.el.querySelector('.modal-f .btn.primary').click(); });
    }
    return dlg;
  }

  /** app: { getSharedJson(), applyShared(state), toast(), modal() } */
  function init(a) {
    app = a;
    const b = document.getElementById('btnSync');
    if (b) b.onclick = () => openPanel(false);
    if (!enabled()) return idleStatus();
    idleStatus();
    pull().then(() => {
      if (cfg().cipher && !token() && !ls.get(K.asked)) { ls.set(K.asked, '1'); openPanel(true); }
    });
    schedulePoll();
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && Date.now() - lastPullAt > 20000) pull();
    });
  }

  /** Yerel her kayıttan sonra çağrılır */
  function notifyChange() {
    if (!app || !enabled()) return;
    if (canWrite()) { if (dirty()) { setStatus('pending', 'Ortak: bekliyor'); schedulePush(); } }
    else idleStatus();
  }

  VF.Sync = { init, notifyChange, openPanel, pull, push, encrypt, decrypt, get status() { return status; } };
})(window.VF = window.VF || {});
