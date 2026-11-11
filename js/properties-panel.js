// The Properties panel: the facts and numbers of the selected object, with
// a button to copy them (tab-separated, so they paste into a spreadsheet).
//
// `describe(model, id)` is pure, so the rows can be tested without a page.

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const int = (n) => Number(n).toLocaleString('en-US');
const num = (n) => Number(n).toFixed(3);
const KIND = { mesh: 'Mesh', group: 'Landmark file', point: 'Point' };

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
  }
  return { title: node.name, kind: KIND[node.kind], rows, copy };
}

// Full precision goes on the clipboard; the panel shows three decimals.
function pointLine(p) {
  const xyz = p.position ? p.position.join('\t') : 'NA\tNA\tNA';
  return `${p.code ?? p.id}\t${p.name}\t${p.status ?? ''}\t${xyz}`;
}

export function setupProperties(el, { model, copyText }) {
  function render() {
    const d = describe(model, model.selectedId);
    if (!d) {
      el.innerHTML = '<p class="props-empty">Select an object in the list or in the 3D view to see its numbers.</p>';
      return;
    }
    el.innerHTML = `
      <div class="props-head">
        <input type="text" id="prop-name" aria-label="Name" value="${esc(d.title)}">
      </div>
      <div class="props-kind">${d.kind}</div>
      <dl class="props-list">
        ${d.rows.map(([k, v, mono]) => `<dt>${esc(k)}</dt><dd${mono ? ' class="mono"' : ''}>${esc(v)}</dd>`).join('')}
      </dl>
      <div class="props-actions">
        ${d.copy ? '<button type="button" class="btn small" id="prop-copy">Copy numbers</button>' : ''}
        <button type="button" class="btn small" id="prop-remove">Remove</button>
      </div>`;
  }

  el.addEventListener('change', (e) => {
    if (e.target.id !== 'prop-name') return;
    const id = model.selectedId;
    model.rename(id, e.target.value);
    e.target.value = model.get(id)?.name ?? ''; // an empty name is not taken
  });

  el.addEventListener('click', async (e) => {
    const id = model.selectedId;
    if (e.target.id === 'prop-remove') {
      model.remove(id);
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
