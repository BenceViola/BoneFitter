// A cross-section as a picture (SVG) and as a table of its outline points.
// No page, no three.js: sectionSVG gives the SVG text; main.js turns it
// into a PNG when asked.
//
// The picture is drawn in the plane's own axes (u to the right, v up),
// seen from the side the plane's normal points to, at true shape: one unit
// is the same length across and up. A scale bar gives the size.

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (n, d = 3) => Number(n).toFixed(d);

// The outline's points in the plane's axes: [[u, v]…] per loop.
export function flatLoops(node) {
  const o = node.origin;
  return (node.loops ?? []).map((l) => l.points.map((p) => {
    const r = [p[0] - o[0], p[1] - o[1], p[2] - o[2]];
    return [dot(r, node.u), dot(r, node.v)];
  }));
}

// A round length near `target`: 1, 2 or 5 times a power of ten.
export function roundLength(target) {
  if (!(target > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(target));
  const m = target / p;
  return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * p;
}

/**
 * The section as an SVG document. `opts`: { title, units ('mm'), lines
 * (extra text lines under the title), width (px of the drawing, 800) }.
 */
export function sectionSVG(node, opts = {}) {
  const units = opts.units ?? 'mm';
  const W = opts.width ?? 800;
  const pad = 40;
  const loops = flatLoops(node);
  const all = loops.flat();
  if (!all.length) return null;
  const us = all.map((p) => p[0]);
  const vs = all.map((p) => p[1]);
  const box = { u0: Math.min(...us), u1: Math.max(...us), v0: Math.min(...vs), v1: Math.max(...vs) };
  const span = Math.max(box.u1 - box.u0, box.v1 - box.v0, 1e-9);
  const k = (W - 2 * pad) / span; // pixels per unit
  const dw = (box.u1 - box.u0) * k;
  const dh = (box.v1 - box.v0) * k;
  const textLines = [opts.title ?? node.name, ...(opts.lines ?? [])];
  const head = 26 + 18 * (textLines.length - 1) + 16;
  const foot = 56;
  const width = W;
  const height = Math.round(head + dh + 2 * pad + foot);
  const left = (W - dw) / 2;
  const top = head + pad;
  // u to the right, v up.
  const X = (u) => left + (u - box.u0) * k;
  const Y = (v) => top + (box.v1 - v) * k;
  const path = (pts, close) => `M${pts.map(([u, v]) => `${fmt(X(u), 2)} ${fmt(Y(v), 2)}`).join('L')}${close ? 'Z' : ''}`;

  const closed = node.loops.map((l, i) => (l.closed ? path(loops[i], true) : null)).filter(Boolean);
  const open = node.loops.map((l, i) => (!l.closed ? path(loops[i], false) : null)).filter(Boolean);
  const parts = [];
  parts.push(`<rect width="${width}" height="${height}" fill="#ffffff"/>`);
  textLines.forEach((t, i) => {
    parts.push(`<text x="${pad / 2}" y="${26 + 18 * i}" font-size="${i ? 13 : 17}" fill="${i ? '#444' : '#111'}"${i ? '' : ' font-weight="600"'}>${esc(t)}</text>`);
  });
  if (closed.length) parts.push(`<path d="${closed.join(' ')}" fill="#d9e4ef" fill-rule="evenodd" stroke="#1b3a5c" stroke-width="1.5" stroke-linejoin="round"/>`);
  if (open.length) parts.push(`<path d="${open.join(' ')}" fill="none" stroke="#b5562b" stroke-width="1.5" stroke-dasharray="5 3" stroke-linejoin="round"/>`);

  // The centroid, and the principal axes through it (Imax solid, Imin dashed).
  if (node.centroid && node.moments) {
    const r = [node.centroid[0] - node.origin[0], node.centroid[1] - node.origin[1], node.centroid[2] - node.origin[2]];
    const cu = dot(r, node.u);
    const cv = dot(r, node.v);
    const cx = X(cu);
    const cy = Y(cv);
    const a = (node.moments.angle * Math.PI) / 180;
    const L = 0.6 * Math.max(dw, dh) / 2;
    const axis = (ang, dash, label) => {
      const dx = Math.cos(ang) * L;
      const dy = -Math.sin(ang) * L;
      parts.push(`<line x1="${fmt(cx - dx, 2)}" y1="${fmt(cy - dy, 2)}" x2="${fmt(cx + dx, 2)}" y2="${fmt(cy + dy, 2)}" stroke="#7a3fb0" stroke-width="1"${dash ? ' stroke-dasharray="4 3"' : ''}/>`);
      parts.push(`<text x="${fmt(cx + dx * 1.04, 2)}" y="${fmt(cy + dy * 1.04, 2)}" font-size="11" fill="#7a3fb0">${label}</text>`);
    };
    axis(a, false, 'Imax');
    axis(a + Math.PI / 2, true, 'Imin');
    parts.push(`<path d="M${fmt(cx - 6, 2)} ${fmt(cy, 2)}h12M${fmt(cx, 2)} ${fmt(cy - 6, 2)}v12" stroke="#c0392b" stroke-width="2"/>`);
  }

  // Scale bar, and the axes of the picture.
  const bar = roundLength(span / 3);
  const by = height - 24;
  parts.push(`<path d="M${pad} ${by}h${fmt(bar * k, 2)}M${pad} ${by - 5}v10M${fmt(pad + bar * k, 2)} ${by - 5}v10" stroke="#111" stroke-width="2"/>`);
  parts.push(`<text x="${pad}" y="${by - 9}" font-size="12" fill="#111">${bar} ${esc(units)}</text>`);
  const ax = width - pad - 40;
  parts.push(`<path d="M${ax} ${by}h30M${ax} ${by}v-30" stroke="#666" stroke-width="1.2" fill="none"/>`);
  parts.push(`<text x="${ax + 33}" y="${by + 4}" font-size="11" fill="#666">u</text><text x="${ax - 3}" y="${by - 34}" font-size="11" fill="#666">v</text>`);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="system-ui, -apple-system, Segoe UI, sans-serif">${parts.join('')}</svg>`;
}

// The outline's points as comma-separated text: one row per point.
export function outlineCSV(node) {
  const flat = flatLoops(node);
  const rows = ['outline,closed,hole,u,v,x,y,z'];
  (node.loops ?? []).forEach((l, i) => {
    l.points.forEach((p, j) => {
      rows.push([i + 1, l.closed ? 1 : 0, l.hole ? 1 : 0, flat[i][j][0], flat[i][j][1], ...p].join(','));
    });
  });
  return rows.join('\n');
}
