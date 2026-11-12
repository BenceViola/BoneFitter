// Mouse and touch in the 3D view.
//
//   click                  select what is under the cursor: a point, a
//                          fitted sphere's centre, a curve, a region, a mesh,
//                          or nothing. With the Curve tool on, the
//                          click goes to the tool instead (curve-tool.js).
//   drag a curve's handle  move that clicked point over its mesh; the curve
//                          is recomputed as it moves
//   drag anywhere else     rotate / pan / zoom (TrackballControls)
//
// While a command asks for an object ("click a region"), a click selects
// the thing under the cursor that the command can use.
//
// A press that moves more than a few pixels, or lasts long, is not a click.

const CLICK_SLOP = 5; // px
const CLICK_TIME = 600; // ms
const DRAG_START = 3; // px before a press on a handle becomes a drag

export function setupInteraction({ stage, viewer, picker, view, model, engine, regions, tool, select, commands, overlay }) {
  const canvas = viewer.renderer.domElement;
  let press = null;
  let frame = 0;
  let latest = null;

  // Put the handle on the surface point under the cursor, if that is on the curve's own mesh.
  function moveHandle(handle, x, y) {
    const node = model.get(handle.id);
    const hit = picker.pickAt(x, y);
    if (!node || !hit || hit.id !== node.parent) return;
    const points = node.control_points.slice();
    points[handle.index] = { position: hit.position, anchor: hit.anchor };
    engine.set(node.id, { control_points: points });
  }

  // Listening on the stage in the capture phase runs before the camera
  // controls' own listener on the canvas, so a press on a handle can switch
  // them off for the drag.
  stage.addEventListener(
    'pointerdown',
    (e) => {
      press = null;
      if (e.target !== canvas || !e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
      // A button pressed just before (Curve, say) must not keep the keyboard:
      // Enter is then meant for the 3D view, not for that button again.
      if (!stage.contains(document.activeElement)) document.activeElement?.blur?.();
      press = { id: e.pointerId, x: e.clientX, y: e.clientY, time: performance.now(), handle: null, dragging: false };
      // With Lasso or Box on, a drag draws the outline (the camera doesn't turn: see main.js).
      if (select?.drawing) {
        press.draw = { type: select.mode, points: [[e.clientX, e.clientY]] };
        press.combine = e.shiftKey ? 'add' : e.altKey ? 'remove' : 'new';
        canvas.setPointerCapture?.(e.pointerId);
        return;
      }
      // While a curve is being drawn, a click on a handle closes or finishes it instead.
      const handle = tool.draft ? null : view.handleAt(e.clientX, e.clientY);
      if (handle) {
        press.handle = handle;
        viewer.controls.enabled = false;
        canvas.setPointerCapture?.(e.pointerId);
      }
    },
    { capture: true }
  );

  // The outline being drawn, in page coordinates, shown over the 3D view.
  function drawOutline(d) {
    const rect = stage.getBoundingClientRect();
    const pts = d.points.map(([x, y]) => [x - rect.left, y - rect.top]);
    let path;
    if (d.type === 'box') {
      const [[x0, y0], [x1, y1]] = [pts[0], pts.at(-1)];
      path = `M${x0} ${y0}H${x1}V${y1}H${x0}Z`;
    } else {
      path = `M${pts.map((p) => p.join(' ')).join('L')}Z`;
    }
    overlay.querySelector('path').setAttribute('d', path);
    // An SVG element has no `hidden` property: the attribute itself must change.
    overlay.removeAttribute('hidden');
  }

  // The outline as select.apply() takes it: screen coordinates from −1 to 1, y up.
  function toShape(d) {
    const rect = canvas.getBoundingClientRect();
    const ndc = ([x, y]) => [((x - rect.left) / rect.width) * 2 - 1, 1 - ((y - rect.top) / rect.height) * 2];
    if (d.type === 'box') {
      const [a, b] = [ndc(d.points[0]), ndc(d.points.at(-1))];
      return { type: 'box', min: [Math.min(a[0], b[0]), Math.min(a[1], b[1])], max: [Math.max(a[0], b[0]), Math.max(a[1], b[1])] };
    }
    return { type: 'lasso', points: d.points.map(ndc) };
  }

  window.addEventListener('pointermove', (e) => {
    if (press?.draw && e.pointerId === press.id) {
      const last = press.draw.points.at(-1);
      if (Math.hypot(e.clientX - last[0], e.clientY - last[1]) < 3) return;
      if (press.draw.type === 'box') press.draw.points[1] = [e.clientX, e.clientY];
      else press.draw.points.push([e.clientX, e.clientY]);
      drawOutline(press.draw);
      return;
    }
    if (!press?.handle || e.pointerId !== press.id) return;
    if (!press.dragging && Math.hypot(e.clientX - press.x, e.clientY - press.y) > DRAG_START) {
      press.dragging = true;
      regions.pause(); // on a large mesh, the curve's regions wait for the end of the drag
    }
    if (!press.dragging) return;
    latest = { handle: press.handle, x: e.clientX, y: e.clientY };
    // At most one recomputation per frame, with the newest position.
    frame ||= requestAnimationFrame(() => {
      frame = 0;
      if (latest) moveHandle(latest.handle, latest.x, latest.y);
      latest = null;
    });
  });

  function release() {
    viewer.controls.enabled = true;
    cancelAnimationFrame(frame);
    frame = 0;
    latest = null;
  }

  window.addEventListener('pointerup', (e) => {
    if (!press || e.pointerId !== press.id) return;
    const p = press;
    press = null;
    if (p.handle) {
      release();
      if (p.dragging) {
        moveHandle(p.handle, e.clientX, e.clientY);
        regions.resume();
        return;
      }
    }
    if (p.draw) {
      overlay.setAttribute('hidden', '');
      if (p.draw.type === 'box') p.draw.points[1] = [e.clientX, e.clientY];
      else p.draw.points.push([e.clientX, e.clientY]);
      const xs = p.draw.points.map((q) => q[0]);
      const ys = p.draw.points.map((q) => q[1]);
      const big = Math.max(...xs) - Math.min(...xs) > CLICK_SLOP && Math.max(...ys) - Math.min(...ys) > CLICK_SLOP;
      // A real outline selects; a click (or a line) falls through to selecting what is under the cursor.
      if (big && (p.draw.type === 'box' || p.draw.points.length >= 3)) {
        select.apply(toShape(p.draw), p.combine).catch((err) => console.error(err));
        return;
      }
    }
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > CLICK_SLOP) return;
    if (performance.now() - p.time > CLICK_TIME) return;
    if (tool.active) {
      tool.click(e.clientX, e.clientY).catch((err) => console.error(err));
      return;
    }
    // A command is asking for an object: of the things under the click, take
    // the one it can use (a region under a curve, say), and offer it.
    if (commands?.active) {
      const at = [view.pointAt, view.fitAt, view.curveAt, view.regionAt].map((f) => f.call(view, e.clientX, e.clientY));
      const id = commands.prefer([...at, picker.pickAt(e.clientX, e.clientY)?.id].filter(Boolean));
      model.select(id);
      if (id) commands.offer(id);
      return;
    }
    // What is drawn on a surface wins over the surface; empty space selects nothing.
    model.select(
      view.pointAt(e.clientX, e.clientY) ??
        view.fitAt(e.clientX, e.clientY) ??
        view.curveAt(e.clientX, e.clientY) ??
        view.regionAt(e.clientX, e.clientY) ??
        picker.pickAt(e.clientX, e.clientY)?.id ??
        null
    );
  });

  window.addEventListener('pointercancel', () => {
    if (press?.draw) overlay.setAttribute('hidden', '');
    if (press?.handle) release();
    if (press?.dragging) regions.resume();
    press = null;
  });
}
