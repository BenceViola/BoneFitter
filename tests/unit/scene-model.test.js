import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SceneModel } from '../../js/scene-model.js';

// A model with two meshes; the first has a folder of two points.
function sample() {
  const model = new SceneModel();
  const femur = model.add('mesh', { name: 'Femur', file: 'femur.ply' });
  const pelvis = model.add('mesh', { name: 'Pelvis', file: 'pelvis.ply' });
  const folder = model.add('group', { name: 'Landmarks', parent: femur.id });
  const [a, b] = model.addMany([
    ['point', { name: 'A', parent: folder.id, position: [1, 2, 3] }],
    ['point', { name: 'B', parent: folder.id, position: null }],
  ]);
  return { model, femur, pelvis, folder, a, b };
}

const events = (model) => {
  const seen = [];
  model.addEventListener('change', (e) => seen.push(e.detail));
  return seen;
};

describe('the object tree', () => {
  test('ids are stable codes by kind, and every node starts visible with no template link', () => {
    const { femur, pelvis, folder, a, b } = sample();
    assert.deepEqual([femur.id, pelvis.id, folder.id, a.id, b.id], ['m1', 'm2', 'g1', 'p1', 'p2']);
    assert.equal(a.visible, true);
    assert.equal(a.template_id, null, 'the slot a guiding template will use');
  });

  test('children are listed per parent, in the order added', () => {
    const { model, femur, pelvis, folder, a, b } = sample();
    assert.deepEqual(model.children(null), [femur, pelvis]);
    assert.deepEqual(model.children(femur.id), [folder]);
    assert.deepEqual(model.children(folder.id), [a, b]);
    assert.deepEqual(model.descendants(femur.id), [folder, a, b]);
    assert.deepEqual(model.meshes(), [femur, pelvis]);
  });

  test('meshOf finds the mesh something is attached to; a global object has none', () => {
    const { model, femur, a } = sample();
    assert.equal(model.meshOf(a.id), femur);
    assert.equal(model.meshOf(femur.id), femur);
    const free = model.add('point', { name: 'Origin', position: [0, 0, 0] });
    assert.equal(free.parent, null);
    assert.equal(model.meshOf(free.id), null);
  });

  test('a mesh cannot be attached to anything, and a parent must exist', () => {
    const { model, femur } = sample();
    assert.throws(() => model.add('mesh', { parent: femur.id }), /cannot be attached/);
    assert.throws(() => model.add('point', { parent: 'nope' }), /No object nope/);
    assert.throws(() => model.add('banana'), /Unknown kind/);
  });

  test('hiding a mesh hides what is attached to it, without changing their own switches', () => {
    const { model, femur, folder, a } = sample();
    model.setVisible(femur.id, false);
    assert.equal(model.isShown(a.id), false);
    assert.equal(a.visible, true, 'its own switch is untouched');
    model.setVisible(femur.id, true);
    model.setVisible(folder.id, false);
    assert.equal(model.isShown(a.id), false);
    assert.equal(model.isShown(femur.id), true);
    assert.equal(model.isShown('gone'), false);
  });

  test('removing a mesh removes everything attached to it and clears the selection', () => {
    const { model, femur, pelvis, a } = sample();
    model.select(a.id);
    const seen = events(model);
    const gone = model.remove(femur.id);
    assert.deepEqual(gone.map((n) => n.id), ['m1', 'g1', 'p1', 'p2']);
    assert.deepEqual(model.children(null), [pelvis]);
    assert.equal(model.selectedId, null);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].kind, 'remove');
    assert.deepEqual(seen[0].removed, gone, 'listeners get the removed nodes to clean up after');
    assert.deepEqual(model.remove('gone'), []);
  });

  test('ids are not reused after a removal', () => {
    const { model, pelvis } = sample();
    model.remove(pelvis.id);
    assert.equal(model.add('mesh', { name: 'Tibia' }).id, 'm3');
  });

  test('an object without a name is called after its kind and number', () => {
    const { model, femur } = sample();
    assert.equal(model.add('curve', { parent: femur.id }).name, 'Curve 1');
    assert.equal(model.add('curve', { parent: femur.id, name: 'Rim' }).name, 'Rim');
    assert.equal(model.add('curve', { parent: femur.id }).name, 'Curve 3');
  });

  test('update changes fields and announces it, but never what a node is or hangs under', () => {
    const { model, femur, pelvis } = sample();
    const c = model.add('curve', { parent: femur.id, closed: false });
    const seen = events(model);
    model.update(c.id, { closed: true, length: 12.5, id: 'x', kind: 'mesh', parent: pelvis.id });
    assert.equal(c.closed, true);
    assert.equal(c.length, 12.5);
    assert.deepEqual([c.id, c.kind, c.parent], ['c1', 'curve', femur.id]);
    assert.deepEqual(seen.map((e) => [e.kind, e.ids]), [['update', ['c1']]]);
    model.update('gone', { closed: true });
    assert.equal(seen.length, 1);
  });

  test('rename trims, and ignores an empty or unchanged name', () => {
    const { model, femur } = sample();
    const seen = events(model);
    model.rename(femur.id, '  Left femur ');
    assert.equal(femur.name, 'Left femur');
    model.rename(femur.id, '   ');
    model.rename(femur.id, 'Left femur');
    assert.equal(femur.name, 'Left femur');
    assert.equal(seen.length, 1);
  });

  test('select announces a change once, and an unknown id selects nothing', () => {
    const { model, femur } = sample();
    const seen = events(model);
    model.select(femur.id);
    model.select(femur.id);
    assert.equal(model.selected, femur);
    assert.equal(seen.length, 1);
    model.select('gone');
    assert.equal(model.selectedId, null);
  });

  test('addMany announces all its nodes as one change', () => {
    const { model, folder } = sample();
    const seen = events(model);
    model.addMany([['point', { parent: folder.id }], ['point', { parent: folder.id }]]);
    assert.equal(seen.length, 1);
    assert.deepEqual(seen[0].ids, ['p3', 'p4']);
  });
});
