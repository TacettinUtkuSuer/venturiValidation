/* VenturiFlow Master — InfluxDB v1.x (InfluxQL) telemetri istemcisi (MODÜL 5) */
(function (VF) {
  'use strict';

  const qi = s => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  const qs = s => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";

  /** Tek sensör için InfluxQL: son değer */
  function sensorQuery(cfg, s) {
    let q = `SELECT last(${qi(s.field)}) FROM ${qi(s.measurement || cfg.measurement)}`;
    if (s.tagKey && s.tagValue) q += ` WHERE ${qi(s.tagKey)} = ${qs(s.tagValue)}`;
    return q;
  }

  function baseUrl(cfg) {
    return String(cfg.url || '').trim().replace(/\/+$/, '');
  }

  /** HTTPS sayfadan HTTP kaynağa istek → tarayıcı "mixed content" olarak engeller */
  function isMixed(cfg) {
    return location.protocol === 'https:' && /^http:\/\//i.test(baseUrl(cfg));
  }

  class InfluxError extends Error {
    constructor(kind, message) { super(message); this.kind = kind; }
  }

  async function request(cfg, path, params) {
    const url = new URL(baseUrl(cfg) + path);
    for (const k in params) url.searchParams.set(k, params[k]);
    if (cfg.user) { url.searchParams.set('u', cfg.user); url.searchParams.set('p', cfg.pass || ''); }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    let res;
    try {
      res = await fetch(url.toString(), { method: 'GET', signal: ctrl.signal, cache: 'no-store' });
    } catch (e) {
      if (e.name === 'AbortError') throw new InfluxError('timeout', 'Zaman aşımı (5 sn) — sunucuya ulaşılamıyor.');
      if (isMixed(cfg)) throw new InfluxError('mixed', 'Tarayıcı HTTPS sayfadan HTTP isteğini engelledi (Mixed Content).');
      throw new InfluxError('network', 'Ağ hatası / CORS engeli: ' + e.message);
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 401 || res.status === 403) throw new InfluxError('auth', 'Kimlik doğrulama hatası (HTTP ' + res.status + ').');
    return res;
  }

  async function ping(cfg) {
    const res = await request(cfg, '/ping', {});
    if (res.status !== 204 && res.status !== 200) throw new InfluxError('http', 'Ping başarısız: HTTP ' + res.status);
    return res.headers.get('X-Influxdb-Version') || 'bilinmiyor';
  }

  /**
   * sensors: [{key, field, tagKey, tagValue}] — tek istekte çoklu ifade.
   * Dönüş: { key: {time, value} | null }
   */
  async function fetchLast(cfg, sensors) {
    const q = sensors.map(s => sensorQuery(cfg, s)).join('; ');
    const res = await request(cfg, '/query', { db: cfg.db, q, epoch: 'ms' });
    let json;
    try { json = await res.json(); } catch (e) { throw new InfluxError('http', 'Geçersiz yanıt: HTTP ' + res.status); }
    if (json.error) throw new InfluxError('query', json.error);
    const out = {};
    sensors.forEach((s, i) => {
      const r = (json.results || [])[i] || {};
      if (r.error) throw new InfluxError('query', r.error);
      const v = r.series && r.series[0] && r.series[0].values && r.series[0].values[0];
      out[s.key] = v ? { time: v[0], value: Number(v[1]) } : null;
    });
    return out;
  }

  VF.Influx = { sensorQuery, isMixed, ping, fetchLast, InfluxError };
})(window.VF = window.VF || {});
