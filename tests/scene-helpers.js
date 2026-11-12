// A scene without a browser, for unit tests of what happens in the 3D view:
// the real model, picker, view and curve code on a fake 100 × 100 px canvas.

import * as THREE from 'three';
import { SceneModel } from '../js/scene-model.js';
import { SceneView } from '../js/scene-view.js';
import { Picker } from '../js/picking.js';
import { CurveEngine } from '../js/curve-engine.js';
import { CurveTool } from '../js/curve-tool.js';
import { RegionEngine } from '../js/region-engine.js';
import { FitEngine } from '../js/fit-engine.js';
import { SelectTool } from '../js/select-tool.js';
import { CommandRunner } from '../js/command-runner.js';
import { ConstructionEngine } from '../js/construction-engine.js';

export function fakeViewer(cameraPos = [0, 0, 60], target = [0, 0, 0]) {
  const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 1000);
  camera.position.set(...cameraPos);
  camera.lookAt(...target);
  camera.updateMatrixWorld(true);
  return {
    scene: new THREE.Scene(),
    camera,
    renderer: { domElement: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) } },
    box: null,
    setContentBox(box) { this.box = box && !box.isEmpty() ? box.clone() : null; },
    get diagonal() { return this.box ? this.box.min.distanceTo(this.box.max) : 1; },
  };
}

// A ball as an STL-style triangle soup (every triangle has its own corners).
export function ball(radius, x = 0, segments = 48) {
  const g = new THREE.SphereGeometry(radius, segments, segments / 2).toNonIndexed();
  g.translate(x, 0, 0);
  return g;
}

// Where a point of the scene is on the fake canvas.
export function screenOf(viewer, point) {
  const v = new THREE.Vector3(...point).project(viewer.camera);
  return [((v.x + 1) / 2) * 100, ((1 - v.y) / 2) * 100];
}

// Model, picker, view, the curve and region engines and the curve tool, wired as in the app.
export function scene(cameraPos, target) {
  const viewer = fakeViewer(cameraPos, target);
  const model = new SceneModel();
  const picker = new Picker(viewer);
  const view = new SceneView(viewer, picker, model);
  const engine = new CurveEngine(model, picker, (id) => view.sources.get(id) || null);
  const regions = new RegionEngine(model, picker, engine);
  const fits = new FitEngine(model, (id) => view.sources.get(id) || null);
  const busy = [];
  const ui = { setBusy: (t) => busy.push(t), nextFrame: async () => {} };
  const tool = new CurveTool({ model, picker, engine, view, ui });
  const select = new SelectTool({ model, picker, view, viewer, regions, ui });
  const constructs = new ConstructionEngine(model);
  const runner = new CommandRunner({ model, regions, fits, constructs });
  const addMesh = (name, geometry) => {
    const node = model.add('mesh', { name, file: `${name}.stl`, faceCount: geometry.attributes.position.count / 3 });
    view.addMesh(node, geometry);
    return node;
  };
  // A clicked point as the picker gives it, for the surface point nearest `p`.
  const cp = (meshId, p) => {
    const { position, anchor } = picker.snap(meshId, p).fields;
    return { position, anchor };
  };
  const clickOn = (point) => tool.click(...screenOf(viewer, point));
  // A finished curve through the given points (each put on the surface first).
  const addCurve = (meshId, points, fields = {}) => {
    const node = model.add('curve', { parent: meshId, path: 'geodesic', closed: true, control_points: points.map((p) => cp(meshId, p)), ...fields });
    engine.refresh(node.id);
    return node;
  };
  return { viewer, model, picker, view, engine, regions, fits, constructs, tool, select, runner, ui, busy, addMesh, cp, clickOn, addCurve };
}

export const events = (target) => {
  const seen = [];
  target.addEventListener('change', (e) => seen.push(e.detail));
  return seen;
};
