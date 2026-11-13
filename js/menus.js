// The menus above the 3D view: one per kind of object, each listing the
// ways to make it (commands.js). Choosing one calls `run(commandId)`.
// `bar` is the whole toolbar: other menus written into the page there (View)
// open, close and walk with the keyboard the same way.

const ICONS = {
  point: '<circle cx="8" cy="8" r="2.6" fill="currentColor" stroke="none"/><path d="M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3"/>',
  line: '<path d="M2.5 13.5 13.5 2.5M9.5 2.5h4v4"/>',
  frame: '<path d="M3 13V3M3 13h10M3 13l6-4"/>',
  orient: '<path d="M13.5 8A5.5 5.5 0 1 1 8 2.5"/><path d="M8 0.5v4l2.5-2z" fill="currentColor"/>',
  measure: '<path d="M1.5 10.5 10.5 1.5l4 4-9 9z"/><path d="M4.5 7.5l1.5 1.5M6.5 5.5l1.5 1.5M8.5 3.5l1.5 1.5"/>',
  region: '<path d="M3 6c1-3 6-4 9-2s2 7-1 8-9-2-8-6z"/>',
  sphere: '<circle cx="8" cy="8" r="6"/><ellipse cx="8" cy="8" rx="6" ry="2.2"/>',
  cylinder: '<ellipse cx="8" cy="3.5" rx="4.5" ry="1.8"/><path d="M3.5 3.5v9c0 1 2 1.8 4.5 1.8s4.5-.8 4.5-1.8v-9"/>',
  plane: '<path d="M1.5 11 5 5h9.5L11 11z"/>',
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function setupMenus(bar, el, menus, run) {
  el.innerHTML = menus
    .map(
      (m) => `
      <div class="menu">
        <button type="button" class="btn tool menu-btn" id="${m.kind}-menu" aria-haspopup="menu" aria-expanded="false" title="Make a ${m.kind}: choose how">
          <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">${ICONS[m.kind] ?? ''}</svg>${esc(m.label)}
          <svg class="icon caret" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5 5 6.5 8 3.5"/></svg>
        </button>
        <div class="menu-list" role="menu" aria-label="${esc(m.label)}" hidden>
          ${m.commands.map((c) => `<button type="button" role="menuitem" data-command="${c.id}" title="${esc(c.title)}">${esc(c.label)}</button>`).join('')}
        </div>
      </div>`
    )
    .join('');

  const openButton = () => bar.querySelector('.menu-btn[aria-expanded="true"]');

  function close(refocus = false) {
    const btn = openButton();
    if (!btn) return;
    btn.setAttribute('aria-expanded', 'false');
    btn.nextElementSibling.hidden = true;
    if (refocus) btn.focus();
  }

  function open(btn, focusFirst) {
    close();
    btn.setAttribute('aria-expanded', 'true');
    btn.nextElementSibling.hidden = false;
    if (focusFirst) btn.nextElementSibling.querySelector('button')?.focus();
  }

  bar.addEventListener('click', (e) => {
    const item = e.target.closest('[data-command]');
    if (item) {
      close();
      item.blur();
      run(item.dataset.command);
      return;
    }
    // Any other button in an open menu (a view) does its own thing, then the menu closes.
    if (e.target.closest('.menu-list button')) {
      close();
      return;
    }
    const btn = e.target.closest('.menu-btn');
    if (!btn) return;
    if (btn.getAttribute('aria-expanded') === 'true') close();
    else open(btn, e.detail === 0); // opened from the keyboard: go to the first way
  });

  // Esc and a click anywhere else close the menu; the arrow keys walk through it.
  bar.addEventListener('keydown', (e) => {
    const btn = openButton();
    if (!btn) return;
    const items = [...btn.nextElementSibling.querySelectorAll('button')];
    const at = items.indexOf(document.activeElement);
    if (e.key === 'Escape') {
      close(true);
    } else if (e.key === 'ArrowDown') {
      items[(at + 1) % items.length].focus();
    } else if (e.key === 'ArrowUp') {
      items[(at - 1 + items.length) % items.length].focus();
    } else {
      return;
    }
    e.preventDefault();
    e.stopPropagation(); // Esc here closes the menu and nothing else
  });
  document.addEventListener('pointerdown', (e) => {
    if (!bar.contains(e.target)) close();
  }, true);
  window.addEventListener('blur', () => close());

  return { close };
}
