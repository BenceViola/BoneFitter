import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { sectionOf } from '../../js/section.js';
import { sectionSVG, outlineCSV, flatLoops, roundLength } from '../../js/section-image.js';

// A square tube 20 across with a 10 × 10 hole, along Z, as a triangle soup.
function squareTube() {
  const tris = [];
  const quad = (a, b, c, d) => tris.push([a, b, c], [a, c, d]);
  const sq = (h, z) => [[-h, -h, z], [h, -h, z], [h, h, z], [-h, h, z]];
  const o0 = sq(10, 0), o1 = sq(10, 30), i0 = sq(5, 0), i1 = sq(5, 30);
  for (let k = 0; k < 4; k++) {
    const j = (k + 1) % 4;
    quad(o0[k], o0[j], o1[j], o1[k]);
    quad(i0[k], i1[k], i1[j], i0[j]);
    quad(o0[k], i0[k], i0[j], o0[j]);
    quad(o1[k], o1[j], i1[j], i1[k]);
  }
  return new Float32Array(tris.flat(2));
}

describe('a cross-section as a picture and as a table', () => {
  const s = sectionOf(squareTube(), null, { point: [0, 0, 12], normal: [0, 0, 1], d: 12 });
  const node = { name: 'Section 1', ...s };

  test('the outline in the plane\'s own axes', () => {
    assert.equal(s.area, 400 - 100);
    const flat = flatLoops(node);
    assert.equal(flat.length, 2);
    for (const loop of flat) for (const [u, v] of loop) assert.ok(Math.abs(u) <= 10 + 1e-9 && Math.abs(v) <= 10 + 1e-9);
  });

  test('the SVG: the outlines in one even-odd path (the hole stays empty), the centroid, a scale bar and the title', () => {
    const svg = sectionSVG(node, { title: 'Tube cut across', lines: ['Area 300'] });
    assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
    assert.match(svg, /fill-rule="evenodd"/);
    assert.equal((svg.match(/Z/g) ?? []).length >= 2, true, 'two closed outlines');
    assert.match(svg, />Tube cut across</);
    assert.match(svg, />Area 300</);
    assert.match(svg, />5 mm</, 'a scale bar of a round length');
    assert.match(svg, /stroke="#c0392b"/, 'the centroid');
    assert.doesNotMatch(svg, /NaN|undefined/);
    assert.equal(sectionSVG({ name: 'x', loops: [] }), null);
  });

  test('true shape: the outer square is as wide as it is high', () => {
    const svg = sectionSVG(node);
    const path = /<path d="([^"]+)" fill="#d9e4ef"/.exec(svg)[1];
    const nums = path.match(/-?[\d.]+/g).map(Number);
    const xs = nums.filter((_, i) => i % 2 === 0);
    const ys = nums.filter((_, i) => i % 2 === 1);
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...ys) - Math.min(...ys);
    assert.ok(Math.abs(w - h) < 0.05, `${w} × ${h}`);
  });

  test('the outline as comma-separated text, one row per point', () => {
    const csv = outlineCSV(node).split('\n');
    assert.equal(csv[0], 'outline,closed,hole,u,v,x,y,z');
    const n = s.loops.reduce((t, l) => t + l.points.length, 0);
    assert.equal(csv.length, n + 1);
    const holes = csv.slice(1).filter((r) => r.split(',')[2] === '1');
    assert.ok(holes.length > 0 && holes.length < n);
    for (const r of csv.slice(1)) assert.equal(Number(r.split(',')[7]), 12, 'on the plane');
  });

  test('round lengths for the scale bar', () => {
    assert.deepEqual([0.3, 1, 3.7, 8, 12, 45].map(roundLength), [0.2, 1, 2, 5, 10, 20]);
  });
});
