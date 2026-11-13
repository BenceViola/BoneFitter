// The object list on the left: every mesh with what is attached to it,
// nested as in the scene. Click a name to select it, the eye to hide or
// show it, the arrow to fold it away.

const SVG = (body) => `<svg viewBox="0 0 16 16" aria-hidden="true">${body}</svg>`;
import { measureText } from './properties-panel.js';

const ICONS = {
  mesh: '<path d="M8 1.5 14 5v6l-6 3.5L2 11V5z M2 5l6 3.5L14 5 M8 8.5v6"/>',
  group: '<path d="M1.5 4.5h4l1.5 1.5h7.5v7h-13z"/>',
  point: '<circle cx="8" cy="8" r="3" fill="currentColor" stroke="none"/>',
  line: '<path d="M2.5 13.5 13.5 2.5M9.5 2.5h4v4"/>',
  frame: '<path d="M3 13V3M3 13h10M3 13l6-4"/>',
  orient: '<path d="M13.5 8A5.5 5.5 0 1 1 8 2.5"/><path d="M8 0.5v4l2.5-2z" fill="currentColor"/>',
  measure: '<path d="M1.5 10.5 10.5 1.5l4 4-9 9z"/><path d="M4.5 7.5l1.5 1.5M6.5 5.5l1.5 1.5M8.5 3.5l1.5 1.5"/>',
  section: '<path d="M1.5 6.5h13M1.5 6.5 4 12.5h8l2.5-6"/><ellipse cx="8" cy="6.5" rx="4" ry="1.6"/>',
  curve: '<path d="M2 12c2-8 4-8 6-3s4 4 6-5"/>',
  region: '<path d="M3 6c1-3 6-4 9-2s2 7-1 8-9-2-8-6z"/>',
  sphere: '<circle cx="8" cy="8" r="6"/><ellipse cx="8" cy="8" rx="6" ry="2.2"/>',
  plane: '<path d="M1.5 11 5 5h9.5L11 11z"/>',
  cylinder: '<ellipse cx="8" cy="3.5" rx="4.5" ry="1.8"/><path d="M3.5 3.5v9c0 1 2 1.8 4.5 1.8s4.5-.8 4.5-1.8v-9"/>',
  missing: '<path d="M5 5l6 6M11 5l-6 6"/>',
};
const EYE = SVG('<path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>');
const EYE_OFF = SVG('<path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><path d="M3 2.5l10 11"/>');
const ARROW = SVG('<path d="M6 4l4 4-4 4"/>');

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function setupTree(el, model) {
  const folded = new Set(); // ids whose children are folded away
  const problems = new Set(); // ids shown with a problem mark

  function row(node, depth) {
    const kids = model.children(node.id);
    const open = kids.length > 0 && !folded.has(node.id);
    const name = esc(node.name);
    const icon = node.kind === 'point' && !node.position ? ICONS.missing : ICONS[node.kind];
    const classes = ['tree-row'];
    if (node.id === model.selectedId) classes.push('is-selected');
    if (!model.isShown(node.id)) classes.push('is-off');
    const twist = kids.length
      ? `<button type="button" class="twist" data-act="fold" aria-expanded="${open}" aria-label="${open ? 'Fold' : 'Unfold'} ${name}">${ARROW}</button>`
      : '<span class="twist-gap"></span>';
    // A folder shows how many it holds; a region whose curves enclose nothing is marked.
    const count =
      node.kind === 'group'
        ? `<span class="count">${kids.length}</span>`
        : node.error
          ? '<span class="count problem" title="There is a problem: see Properties">!</span>'
          : node.kind === 'measure' || node.kind === 'section'
            ? `<span class="count value">${measureText(node)}</span>`
            : '';
    return `<li data-id="${node.id}">
      <div class="${classes.join(' ')}" style="--depth:${depth}" data-kind="${node.kind}"${node.status ? ` data-status="${node.status}"` : ''}>
        ${twist}
        <button type="button" class="tree-name" data-act="select" aria-current="${node.id === model.selectedId}" title="${name}">
          <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">${icon}</svg><span class="label">${name}</span>${count}
        </button>
        <button type="button" class="eye" data-act="eye" aria-pressed="${node.visible}" aria-label="Show ${name}" title="${node.visible ? 'Hide' : 'Show'}">${node.visible ? EYE : EYE_OFF}</button>
      </div>
      ${open ? `<ul>${kids.map((k) => row(k, depth + 1)).join('')}</ul>` : ''}
    </li>`;
  }

  function render() {
    // Re-rendering replaces the buttons, so put the keyboard focus back where it was.
    const active = document.activeElement;
    const focus = el.contains(active) ? { id: active.closest('li')?.dataset.id, act: active.dataset.act } : null;

    const top = model.children(null);
    el.innerHTML = top.length
      ? `<ul class="tree">${top.map((n) => row(n, 0)).join('')}</ul>`
      : '<p class="tree-empty">Nothing is open yet.</p>';

    if (focus?.id) el.querySelector(`li[data-id="${focus.id}"] > .tree-row [data-act="${focus.act}"]`)?.focus();
  }

  el.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = btn.closest('li').dataset.id;
    if (btn.dataset.act === 'select') model.select(id);
    else if (btn.dataset.act === 'eye') model.setVisible(id, !model.get(id).visible);
    else {
      if (folded.has(id)) folded.delete(id);
      else folded.add(id);
      render();
    }
  });

  model.addEventListener('change', (e) => {
    const { kind, ids } = e.detail;
    // A curve being drawn or dragged changes many times a second; the list shows
    // none of that, except the mark on an object that gets or loses a problem.
    if (kind === 'update') {
      let changed = false;
      for (const id of ids) {
        const bad = !!model.get(id)?.error;
        if (bad === problems.has(id)) continue;
        if (bad) problems.add(id);
        else problems.delete(id);
        changed = true;
      }
      if (!changed) return;
    }
    // A landmark file can hold many points: its folder starts folded away.
    if (kind === 'add') {
      for (const id of ids) {
        if (model.get(id)?.kind === 'group') folded.add(id);
        if (model.get(id)?.error) problems.add(id);
      }
    }
    // Selecting something (perhaps by clicking it in the 3D view) unfolds what it is inside of.
    if (kind === 'select' && ids.length) {
      for (let n = model.get(model.get(ids[0]).parent); n; n = model.get(n.parent)) folded.delete(n.id);
    }
    render();
    if (kind === 'select' && ids.length) {
      el.querySelector(`li[data-id="${ids[0]}"] > .tree-row`)?.scrollIntoView({ block: 'nearest' });
    }
  });

  render();
  return { render, isFolded: (id) => folded.has(id) };
}
