/* VenturiFlow Master — InfluxDB v1.x (InfluxQL) telemetri istemcisi (MODÜL 5) */
(function (VF) {
  'use strict';

  const qi = s => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  const qs = s => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";

  /** Tek sensör için InfluxQL: son değer (isteğe bağlı zaman penceresi ve tag filtresi) */
  function sensorQuery(cfg, s) {
    let q = `SELECT last(${qi(s.field)}) FROM ${qi(s.measurement || cfg.measurement)}`;
    const where = [];
    const win = Number(cfg.windowMin);
    if (win > 0) where.push(`time > now() - ${Math.round(win * 60)}s`);
    if (s.tagKey && s.tagValue) where.push(`${qi(s.tagKey)} = ${qs(s.tagValue)}`);
    if (where.length) q += ' WHERE ' + where.join(' AND ');
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

  async function request(cfg, path, params, timeoutMs) {
    const url = new URL(baseUrl(cfg) + path);
    for (const k in params) url.searchParams.set(k, params[k]);
    if (cfg.user) { url.searchParams.set('u', cfg.user); url.searchParams.set('p', cfg.pass || ''); }
    const ctrl = new AbortController();
    const tmo = timeoutMs || 5000;
    const timer = setTimeout(() => ctrl.abort(), tmo);
    let res;
    try {
      res = await fetch(url.toString(), { method: 'GET', signal: ctrl.signal, cache: 'no-store' });
    } catch (e) {
      if (e.name === 'AbortError') throw new InfluxError('timeout', `Zaman aşımı (${Math.round(tmo / 1000)} sn) — sunucuya ulaşılamıyor.`);
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

  /**
   * Zaman aralığı için gruplanmış ortalamalar (geçmiş veriden kalibrasyon).
   * sensors: [{key, field, tagKey, tagValue}] — dönüş: { key: [[t_ms, value], …] }
   */
  async function fetchSeries(cfg, sensors, startMs, endMs, groupSec) {
    const g = Math.max(1, Math.round(groupSec));
    const q = sensors.map(s => {
      let w = `time >= ${Math.floor(startMs)}ms AND time <= ${Math.ceil(endMs)}ms`;
      if (s.tagKey && s.tagValue) w += ` AND ${qi(s.tagKey)} = ${qs(s.tagValue)}`;
      return `SELECT mean(${qi(s.field)}) FROM ${qi(s.measurement || cfg.measurement)} WHERE ${w} GROUP BY time(${g}s) fill(none)`;
    }).join('; ');
    const res = await request(cfg, '/query', { db: cfg.db, q, epoch: 'ms' }, 60000);
    let json;
    try { json = await res.json(); } catch (e) { throw new InfluxError('http', 'Geçersiz yanıt: HTTP ' + res.status); }
    if (json.error) throw new InfluxError('query', json.error);
    const out = {};
    sensors.forEach((s, i) => {
      const r = (json.results || [])[i] || {};
      if (r.error) throw new InfluxError('query', r.error);
      const vals = r.series && r.series[0] && r.series[0].values || [];
      out[s.key] = vals.filter(v => v[1] !== null).map(v => [v[0], Number(v[1])]);
    });
    return out;
  }

  VF.Influx = { sensorQuery, isMixed, ping, fetchLast, fetchSeries, InfluxError };
})(window.VF = window.VF || {});
