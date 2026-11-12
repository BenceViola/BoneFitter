// The menus above the 3D view: one per kind of object, each listing the
// ways to make it (commands.js). Choosing one calls `run(commandId)`.

const ICONS = {
  region: '<path d="M3 6c1-3 6-4 9-2s2 7-1 8-9-2-8-6z"/>',
  sphere: '<circle cx="8" cy="8" r="6"/><ellipse cx="8" cy="8" rx="6" ry="2.2"/>',
  cylinder: '<ellipse cx="8" cy="3.5" rx="4.5" ry="1.8"/><path d="M3.5 3.5v9c0 1 2 1.8 4.5 1.8s4.5-.8 4.5-1.8v-9"/>',
  plane: '<path d="M1.5 11 5 5h9.5L11 11z"/>',
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function setupMenus(el, menus, run) {
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

  const openButton = () => el.querySelector('.menu-btn[aria-expanded="true"]');

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

  el.addEventListener('click', (e) => {
    const item = e.target.closest('[data-command]');
    if (item) {
      close();
      item.blur();
      run(item.dataset.command);
      return;
    }
    const btn = e.target.closest('.menu-btn');
    if (!btn) return;
    if (btn.getAttribute('aria-expanded') === 'true') close();
    else open(btn, e.detail === 0); // opened from the keyboard: go to the first way
  });

  // Esc and a click anywhere else close the menu; the arrow keys walk through it.
  el.addEventListener('keydown', (e) => {
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
    if (!el.contains(e.target)) close();
  }, true);
  window.addEventListener('blur', () => close());

  return { close };
}
