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
// A press that moves more than a few pixels, or lasts long, is not a click.

const CLICK_SLOP = 5; // px
const CLICK_TIME = 600; // ms
const DRAG_START = 3; // px before a press on a handle becomes a drag

export function setupInteraction({ stage, viewer, picker, view, model, engine, regions, tool }) {
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

  window.addEventListener('pointermove', (e) => {
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
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > CLICK_SLOP) return;
    if (performance.now() - p.time > CLICK_TIME) return;
    if (tool.active) {
      tool.click(e.clientX, e.clientY).catch((err) => console.error(err));
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
    if (press?.handle) release();
    if (press?.dragging) regions.resume();
    press = null;
  });
}
