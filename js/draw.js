/* VenturiFlow Master — Ölçekli 2D Venturi kesiti (SVG) + basınç profili (MODÜL 4) */
(function (VF) {
  'use strict';

  const PALETTES = {
    dark:  { bg: 'transparent', wall: '#7dd3fc', fill: 'rgba(34,211,238,0.10)', hatch: '#334155', axis: '#475569', text: '#cbd5e1', dim: '#94a3b8', tap: '#f59e0b', press: '#f472b6', flow: '#22d3ee' },
    light: { bg: '#ffffff', wall: '#0e7490', fill: 'rgba(14,116,144,0.08)', hatch: '#cbd5e1', axis: '#94a3b8', text: '#1e293b', dim: '#475569', tap: '#b45309', press: '#be185d', flow: '#0e7490' }
  };

  /**
   * opts: { D, d, theta, width, height, theme, fmtLen(m)→string, profile:{p1, dp, loss} | null }
   */
  function venturiSVG(o) {
    const c = PALETTES[o.theme] || PALETTES.dark;
    const W = o.width || 900, H = o.height || 300;
    const g = VF.Physics.geometry(o.D, o.d, o.theta);
    const padX = 40, padTop = 26, profH = o.profile ? 70 : 0;
    const drawH = H - padTop - 46 - profH;
    const s = Math.min((W - 2 * padX) / g.total, drawH / (o.D * 1.25));
    const cx0 = (W - g.total * s) / 2;
    const cy = padTop + drawH / 2 + 4;
    const R = o.D / 2 * s, r = o.d / 2 * s;
    const x = [cx0];
    [g.Lin, g.Lc, g.Lt, g.Ld, g.Lout].forEach(L => x.push(x[x.length - 1] + L * s));
    const wt = Math.max(5, R * 0.12);

    const top = [[x[0], cy - R], [x[1], cy - R], [x[2], cy - r], [x[3], cy - r], [x[4], cy - R], [x[5], cy - R]];
    const bot = top.map(([px, py]) => [px, 2 * cy - py]);
    const path = pts => pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    const wallTop = top.concat(top.slice().reverse().map(([px, py]) => [px, py - wt]));
    const wallBot = bot.concat(bot.slice().reverse().map(([px, py]) => [px, py + wt]));
    const fluid = top.concat(bot.slice().reverse());
    const f = o.fmtLen;

    const dimLine = (x1, x2, y, label) => `
      <line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${c.dim}" stroke-width="1" marker-start="url(#arr)" marker-end="url(#arr)"/>
      <text x="${(x1 + x2) / 2}" y="${y - 4}" fill="${c.dim}" font-size="10.5" text-anchor="middle">${label}</text>`;
    const vDim = (xx, y1, y2, label, rotate) => `
      <line x1="${xx}" y1="${y1}" x2="${xx}" y2="${y2}" stroke="${c.dim}" stroke-width="1" marker-start="url(#arr)" marker-end="url(#arr)"/>
      ${rotate
        ? `<text transform="translate(${xx - 6} ${(y1 + y2) / 2}) rotate(-90)" fill="${c.text}" font-size="12" font-weight="600" text-anchor="middle">${label}</text>`
        : `<text x="${xx + 6}" y="${(y1 + y2) / 2 + 4}" fill="${c.text}" font-size="12" font-weight="600">${label}</text>`}`;

    const yDim = cy + R + wt + 18;
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" height="100%" font-family="Inter, Segoe UI, Arial, sans-serif" preserveAspectRatio="xMidYMid meet">
      <defs>
        <marker id="arr" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="${c.dim}"/></marker>
        <marker id="arrF" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="${c.flow}"/></marker>
        <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="${c.hatch}" stroke-width="2"/></pattern>
      </defs>
      ${c.bg !== 'transparent' ? `<rect width="${W}" height="${H}" fill="${c.bg}"/>` : ''}
      <line x1="${x[0] - 14}" y1="${cy}" x2="${x[5] + 14}" y2="${cy}" stroke="${c.axis}" stroke-dasharray="10 4 2 4" stroke-width="1"/>
      <path d="${path(fluid)} Z" fill="${c.fill}"/>
      <path d="${path(wallTop)} Z" fill="url(#hatch)" stroke="${c.wall}" stroke-width="1.6"/>
      <path d="${path(wallBot)} Z" fill="url(#hatch)" stroke="${c.wall}" stroke-width="1.6"/>
      <line x1="${x[0] + 8}" y1="${cy - R * 0.45}" x2="${x[0] + Math.min(60, g.Lin * s - 10)}" y2="${cy - R * 0.45}" stroke="${c.flow}" stroke-width="2" marker-end="url(#arrF)"/>
    `;
    // Basınç alma noktaları (p₁ girişte D/2, p₂ boğaz ortası)
    const tap = (xx, yy, label) => `<line x1="${xx}" y1="${yy}" x2="${xx}" y2="${yy - wt - 14}" stroke="${c.tap}" stroke-width="2.5"/>
      <circle cx="${xx}" cy="${yy - wt - 16}" r="3.5" fill="${c.tap}"/><text x="${xx}" y="${yy - wt - 23}" fill="${c.tap}" font-size="11" font-weight="700" text-anchor="middle">${label}</text>`;
    svg += tap(x[0] + g.Lin * s * 0.5, cy - R, 'p₁');
    svg += tap((x[2] + x[3]) / 2, cy - r, 'p₂');

    // Ölçüler
    svg += vDim(x[0] - 12, cy - R, cy + R, 'D ' + f(o.D), true);
    svg += vDim((x[2] + x[3]) / 2, cy - r + 2, cy + r - 2, 'd ' + f(o.d));
    svg += dimLine(x[1], x[2], yDim, 'Konvergent ' + f(g.Lc) + ' · 21°');
    svg += dimLine(x[2], x[3], yDim + 16, 'Boğaz ' + f(g.Lt));
    svg += dimLine(x[3], x[4], yDim, 'Difüzör ' + f(g.Ld) + ' · ' + o.theta.toFixed(1) + '°');
    svg += `<text x="${x[5] + 4}" y="${padTop - 8}" fill="${c.dim}" font-size="10.5" text-anchor="end">Toplam boy ≈ ${f(g.Lc + g.Lt + g.Ld)} (giriş/çıkış silindirleri hariç) · ölçekli çizim</text>`;

    // Basınç profili (hidrolik eğim çizgisi)
    if (o.profile && o.profile.dp > 0) {
      const p = o.profile;
      const y0 = H - profH + 8, y1 = H - 14;
      const yOf = v => y0 + (p.p1 - v) / p.dp * (y1 - y0);
      const pts = [[x[0], p.p1], [x[1], p.p1], [x[2], p.p1 - p.dp], [x[3], p.p1 - p.dp], [x[4], p.p1 - p.loss], [x[5], p.p1 - p.loss]];
      svg += `<line x1="${x[0]}" y1="${yOf(p.p1)}" x2="${x[5]}" y2="${yOf(p.p1)}" stroke="${c.axis}" stroke-dasharray="3 3"/>
        <path d="${path(pts.map(([px, pv]) => [px, yOf(pv)]))}" fill="none" stroke="${c.press}" stroke-width="2"/>
        <text x="${x[0]}" y="${y0 - 2}" fill="${c.press}" font-size="10.5">Basınç profili</text>
        <text x="${(x[2] + x[3]) / 2}" y="${yOf(p.p1 - p.dp) - 4}" fill="${c.press}" font-size="10.5" text-anchor="middle">ΔP ${p.fmtP(p.dp)}</text>
        <line x1="${x[5] - 6}" y1="${yOf(p.p1)}" x2="${x[5] - 6}" y2="${yOf(p.p1 - p.loss)}" stroke="${c.tap}" stroke-width="2"/>
        <text x="${x[5] - 10}" y="${yOf(p.p1 - p.loss) + 14}" fill="${c.tap}" font-size="10.5" text-anchor="end">Kalıcı kayıp ${p.fmtP(p.loss)}</text>`;
    }
    svg += '</svg>';
    return svg;
  }

  /** SVG metnini PNG dataURL'e dönüştürür (PDF raporu için) */
  function svgToPng(svgText, w, h, scale) {
    scale = scale || 2;
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const cv = document.createElement('canvas');
        cv.width = w * scale; cv.height = h * scale;
        const ctx = cv.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
        ctx.drawImage(img, 0, 0, cv.width, cv.height);
        resolve(cv.toDataURL('image/png'));
      };
      img.onerror = reject;
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText.replace('width="100%" height="100%"', `width="${w}" height="${h}"`));
    });
  }

  VF.Draw = { venturiSVG, svgToPng };
})(window.VF = window.VF || {});
