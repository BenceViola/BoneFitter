// The Properties panel: the facts and numbers of the selected object, with
// a button to copy them (tab-separated, so they paste into a spreadsheet).
//
// `describe(model, id)` is pure, so the rows can be tested without a page.

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const int = (n) => Number(n).toLocaleString('en-US');
const num = (n) => Number(n).toFixed(3);
const KIND = { mesh: 'Mesh', group: 'Landmark file', point: 'Point', curve: 'Curve', region: 'Region' };

// Why curves give no region, for the person looking at it.
const REGION_PROBLEMS = {
  small: 'The curve is no bigger than a few triangles, too small to enclose a region.',
  apart: 'Part of the curve jumps between separate pieces of the mesh, so it does not close off an area.',
  open: 'The curve does not divide the surface in two, so it has no inside. This happens on a surface with holes, or with a ring round a bar of bone that is joined up at both ends.',
  crossing: 'The curve crosses itself or another boundary, so it is not clear what it encloses. Move its points until nothing crosses.',
  'no-common': 'No part of the surface lies between all of these curves.',
  'not-closed': 'A boundary has to be a closed loop.',
  'no-curve': 'Its boundary curve is gone.',
};

/**
 * What the panel shows for a node: { title, kind, rows: [[label, value,
 * mono?]], copy } where `copy` is the text the Copy button puts on the
 * clipboard (null when there is nothing worth copying).
 */
export function describe(model, id) {
  const node = model.get(id);
  if (!node) return null;
  const mesh = model.meshOf(id);
  const rows = [];
  let copy = null;
  // Coordinates of something attached to a mesh are the mesh file's own.
  const space = mesh ? `as in ${mesh.file}` : 'of the scene';

  if (node.kind === 'mesh') {
    const size = node.box ? node.box.max.map((v, i) => v - node.box.min[i]) : null;
    rows.push(['File', node.file]);
    rows.push(['Format', node.format]);
    rows.push(['Triangles', int(node.faceCount), true]);
    rows.push(['Vertices', int(node.vertexCount), true]);
    if (size) rows.push(['Size (x × y × z)', size.map(num).join(' × '), true]);
    if (node.sha256) rows.push(['SHA-256', `${node.sha256.slice(0, 12)}…`, true]);
  } else if (node.kind === 'group') {
    const points = model.children(id).filter((n) => n.kind === 'point');
    const missing = points.filter((p) => !p.position).length;
    rows.push(['File', node.file]);
    if (node.specimenId) rows.push(['Specimen', node.specimenId]);
    if (node.templateName) rows.push(['Template', node.templateName]);
    if (node.operator) rows.push(['Operator', node.operator]);
    rows.push(['Landmarks', missing ? `${points.length - missing} placed, ${missing} missing` : String(points.length)]);
    rows.push(['Coordinates', space]);
    copy = ['id\tname\tstatus\tx\ty\tz', ...points.map(pointLine)].join('\n');
  } else if (node.kind === 'point') {
    if (node.code) rows.push(['ID', node.code, true]);
    if (node.status) rows.push(['Status', node.status]);
    if (node.position) {
      ['x', 'y', 'z'].forEach((axis, i) => rows.push([axis, num(node.position[i]), true]));
      rows.push(['Coordinates', space]);
      copy = pointLine(node);
    } else {
      rows.push(['Position', 'none (missing)']);
    }
    if (node.note) rows.push(['Note', node.note]);
  } else if (node.kind === 'curve') {
    rows.push(['Shape', node.drawing ? 'being drawn' : node.closed ? 'closed loop' : 'open curve']);
    rows.push(['Clicked points', String(node.control_points?.length ?? 0), true]);
    rows.push(['Path', node.used === 'euclidean' ? 'straight between the points' : 'shortest across the surface']);
    rows.push(['Length', num(node.length ?? 0), true]);
    if (node.centroid) {
      ['x', 'y', 'z'].forEach((axis, i) => rows.push([`Centroid ${axis}`, num(node.centroid[i]), true]));
      rows.push(['Coordinates', space]);
      copy = [
        'name\tshape\tclicked_points\tlength\tcentroid_x\tcentroid_y\tcentroid_z',
        [node.name, node.closed ? 'closed' : 'open', node.control_points.length, node.length, ...node.centroid].join('\t'),
      ].join('\n');
    }
    if (node.warning === 'apart') {
      rows.push(['Note', 'Some of its points are on separate pieces of the mesh. The curve is straight between those.']);
    }
  } else if (node.kind === 'region') {
    const boundary = node.boundary.map((id) => model.get(id)?.name ?? '?').join(', ');
    const side = node.flipped ? 'the other side' : node.boundary.length > 1 ? 'between its curves' : 'inside the curve';
    rows.push(['Boundary', boundary]);
    rows.push(['Side', side]);
    if (node.error) {
      rows.push(['Problem', REGION_PROBLEMS[node.error] ?? 'These curves enclose no region.']);
    } else {
      rows.push(['Triangles', int(node.faceCount), true]);
      rows.push(['Area', num(node.area), true]);
      ['x', 'y', 'z'].forEach((axis, i) => rows.push([`Centroid ${axis}`, num(node.centroid[i]), true]));
      rows.push(['Coordinates', space]);
      copy = [
        'name\tboundary\tside\ttriangles\tarea\tcentroid_x\tcentroid_y\tcentroid_z',
        [node.name, boundary, node.flipped ? 'other' : node.boundary.length > 1 ? 'between' : 'inside', node.faceCount, node.area, ...node.centroid].join('\t'),
      ].join('\n');
    }
  }
  return { title: node.name, kind: KIND[node.kind], rows, copy };
}

// Full precision goes on the clipboard; the panel shows three decimals.
function pointLine(p) {
  const xyz = p.position ? p.position.join('\t') : 'NA\tNA\tNA';
  return `${p.code ?? p.id}\t${p.name}\t${p.status ?? ''}\t${xyz}`;
}

// `app.regions` (the region engine) is looked up when a button is pressed: it is made after this panel.
export function setupProperties(el, { model, copyText, app }) {
  function render() {
    const d = describe(model, model.selectedId);
    if (!d) {
      el.innerHTML = '<p class="props-empty">Select an object in the list or in the 3D view to see its numbers.</p>';
      return;
    }
    const node = model.selected;
    // A region can take further closed curves of its mesh as boundaries.
    const others = node.kind === 'region' ? (app.regions?.candidates(node.id) ?? []) : [];
    const more = others.length
      ? `<label class="props-more">Add a boundary (a hole in the region, or the other end of a band)
          <select id="prop-add-boundary">
            <option value="">Choose a closed curve…</option>
            ${others.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}
          </select>
        </label>`
      : '';
    el.innerHTML = `
      <div class="props-head">
        <input type="text" id="prop-name" aria-label="Name" value="${esc(d.title)}">
      </div>
      <div class="props-kind">${d.kind}</div>
      <dl class="props-list">
        ${d.rows.map(([k, v, mono]) => (k === 'Problem' ? `<dd class="problem" style="grid-column: 1 / -1">${esc(v)}</dd>` : `<dt>${esc(k)}</dt><dd${mono ? ' class="mono"' : ''}>${esc(v)}</dd>`)).join('')}
      </dl>
      <div class="props-actions">
        ${d.copy ? '<button type="button" class="btn small" id="prop-copy">Copy numbers</button>' : ''}
        ${node.kind === 'region' ? '<button type="button" class="btn small" id="prop-flip" title="Take the part on the other side of the boundary instead">Use the other side</button>' : ''}
        <button type="button" class="btn small" id="prop-remove">Remove</button>
      </div>
      ${more}`;
  }

  el.addEventListener('change', (e) => {
    if (e.target.id === 'prop-add-boundary' && e.target.value) {
      app.regions.addBoundary(model.selectedId, e.target.value);
      return;
    }
    if (e.target.id !== 'prop-name') return;
    const id = model.selectedId;
    model.rename(id, e.target.value);
    e.target.value = model.get(id)?.name ?? ''; // an empty name is not taken
  });

  el.addEventListener('click', async (e) => {
    const id = model.selectedId;
    if (e.target.id === 'prop-remove') {
      model.remove(id);
    } else if (e.target.id === 'prop-flip') {
      app.regions.set(id, { flipped: !model.get(id).flipped });
    } else if (e.target.id === 'prop-copy') {
      const ok = await copyText(describe(model, id).copy);
      e.target.textContent = ok ? 'Copied' : 'Could not copy';
      setTimeout(() => {
        if (e.target.isConnected) e.target.textContent = 'Copy numbers';
      }, 1500);
    }
  });

  model.addEventListener('change', (e) => {
    // Names are only changed in this panel's own box, which already shows the
    // new one. Rebuilding the panel here would swallow a click that is under way.
    if (e.detail.kind === 'rename') return;
    render();
  });

  render();
  return { render };
}
