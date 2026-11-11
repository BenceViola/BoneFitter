import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SceneModel } from '../../js/scene-model.js';
import { SceneView } from '../../js/scene-view.js';
import { Picker } from '../../js/picking.js';

// Enough of a viewer for SceneView and Picker: a scene, a camera, a fake
// 100 × 100 px canvas, and the box it was last asked to frame.
function fakeViewer(cameraPos = [0, 0, 60], target = [0, 0, 0]) {
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

const ball = (radius, x = 0) => {
  const g = new THREE.SphereGeometry(radius, 24, 16).toNonIndexed();
  g.translate(x, 0, 0);
  return g;
};

function setup() {
  const viewer = fakeViewer();
  const model = new SceneModel();
  const picker = new Picker(viewer);
  const view = new SceneView(viewer, picker, model);
  const addMesh = (name, geometry) => {
    const node = model.add('mesh', { name });
    view.addMesh(node, geometry);
    return node;
  };
  return { viewer, model, picker, view, addMesh };
}

describe('drawing the object tree', () => {
  test('the source geometry of a mesh is left exactly as it was', () => {
    const { addMesh, view } = setup();
    const g = ball(5);
    const before = g.attributes.position.array.slice();
    const node = addMesh('A', g);
    assert.equal(g.index, null);
    assert.deepEqual(g.attributes.position.array, before);
    const drawn = view.objectOf(node.id).getObjectByName('surface').geometry;
    assert.notEqual(drawn, g, 'what is drawn is a separate copy');
    assert.ok(drawn.index, 'the copy has merged vertices for smooth shading');
    assert.equal(drawn.index.count / 3, g.attributes.position.count / 3, 'with the same triangles in the same order');
  });

  test('the framed box covers every mesh that is shown, and only those', () => {
    const { addMesh, model, viewer } = setup();
    const a = addMesh('A', ball(5, 0));
    addMesh('B', ball(5, 100));
    assert.ok(Math.abs(viewer.box.min.x + 5) < 1e-3 && Math.abs(viewer.box.max.x - 105) < 1e-3);
    model.setVisible(a.id, false);
    assert.ok(Math.abs(viewer.box.min.x - 95) < 1e-3, 'a hidden mesh is left out');
    model.remove('m2');
    assert.equal(viewer.box, null, 'nothing shown: nothing to frame');
  });

  test('what is attached to a mesh is nested under it and hidden with it', () => {
    const { addMesh, model, view } = setup();
    const a = addMesh('A', ball(5));
    const folder = model.add('group', { name: 'Landmarks', parent: a.id });
    const [p, missing] = model.addMany([
      ['point', { parent: folder.id, position: [5, 0, 0], status: 'placed' }],
      ['point', { parent: folder.id, position: null, status: 'missing' }],
    ]);
    const marker = view.objectOf(p.id);
    assert.equal(marker.parent, view.objectOf(folder.id));
    assert.equal(marker.parent.parent, view.objectOf(a.id));
    assert.deepEqual(marker.position.toArray(), [5, 0, 0], 'placed at its coordinates in the mesh');
    assert.equal(view.objectOf(missing.id).visible, false, 'a missing landmark has nothing to draw');

    model.setVisible(a.id, false);
    assert.equal(view.objectOf(a.id).visible, false);
    assert.equal(marker.visible, true, 'its own switch is untouched; three.js hides it with its parent');
    model.setVisible(missing.id, false);
    model.setVisible(missing.id, true);
    assert.equal(view.objectOf(missing.id).visible, false, 'switching a missing landmark on still draws nothing');
  });

  test('removing a mesh takes its objects out of the scene and out of picking', () => {
    const { addMesh, model, view, picker } = setup();
    const a = addMesh('A', ball(5));
    const p = model.add('point', { parent: a.id, position: [5, 0, 0] });
    model.remove(a.id);
    assert.equal(view.objectOf(a.id), null);
    assert.equal(view.objectOf(p.id), null);
    assert.equal(view.root.children.length, 0);
    assert.equal(picker.has(a.id), false);
  });

  test('markers are sized to the scene; the selected one is larger and recoloured', () => {
    const { addMesh, model, view, viewer } = setup();
    const a = addMesh('A', ball(5));
    const p = model.add('point', { parent: a.id, position: [0, 0, 5], status: 'placed' });
    const marker = view.objectOf(p.id);
    const r = viewer.diagonal * 0.006;
    assert.ok(Math.abs(marker.scale.x - r) < 1e-9);
    const plain = marker.material.color.getHex();
    model.select(p.id);
    assert.ok(Math.abs(marker.scale.x - 1.5 * r) < 1e-9);
    assert.notEqual(marker.material.color.getHex(), plain);
    model.select(a.id);
    assert.equal(marker.material.color.getHex(), plain, 'back to its own colour');
    assert.notEqual(view.objectOf(a.id).getObjectByName('surface').material.emissive.getHex(), 0, 'the selected mesh is tinted');
  });

  test('pointAt finds a marker under the cursor, but not one hidden behind the surface', () => {
    // Camera on +Z looking at a ball of radius 5: (0,0,5) faces it, (0,0,-5) is on the far side.
    const { addMesh, model, view } = setup();
    const a = addMesh('A', ball(5));
    const front = model.add('point', { parent: a.id, position: [0, 0, 5] });
    assert.equal(view.pointAt(50, 50), front.id);
    assert.equal(view.pointAt(5, 5), null, 'nothing there');
    model.remove(front.id);
    model.add('point', { parent: a.id, position: [0, 0, -5] });
    assert.equal(view.pointAt(50, 50), null, 'the ball is in the way');
    model.setVisible(a.id, false);
    assert.equal(view.pointAt(50, 50), null, 'hidden with its mesh');
  });
});
