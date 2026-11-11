import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseLandmarkFile, meshMatches, LandmarkFileError, FORMAT } from '../../js/landmark-file.js';
import { landmarkFile } from '../fixtures.js';

const MESH = { file: 'FEMUR_007.ply', sha256: 'ab'.repeat(32), faceCount: 496222, vertexCount: 248113 };
const parse = (doc, name = 'FEMUR_007.lmk.json') => parseLandmarkFile(JSON.stringify(doc), name);
const refused = (doc, pattern) =>
  assert.throws(() => parse(doc), (err) => err instanceof LandmarkFileError && pattern.test(err.message));

describe('reading landmark files', () => {
  test('a file as Landmarker3D writes it: points with names, statuses and positions', () => {
    const r = parse(landmarkFile(MESH));
    assert.deepEqual(r.warnings, []);
    assert.equal(r.specimen.id, 'FEMUR_007');
    assert.deepEqual(r.points.map((p) => [p.id, p.name, p.status, p.position]), [
      ['LM01', 'Head, top', 'placed', [1.5, 2.25, 3]],
      ['LM02', 'Condyle L', 'estimated', [-4, 5, 6.125]],
      ['LM03', 'Condyle R', 'missing', null],
    ]);
    assert.equal(r.points[1].note, 'worn');
    assert.deepEqual(r.points[0].anchor, { face: 0, bary: [0.2, 0.3, 0.5] }, 'fields this app does not use are kept');
  });

  test('the template is read whole and is a separate copy', () => {
    const doc = landmarkFile(MESH);
    const r = parse(doc);
    assert.equal(r.template.name, 'Tiny set');
    assert.equal(r.template.landmarks[1].bilateral_pair, 'LM03');
    assert.notEqual(r.template, r.doc.template);
  });

  test('a point\'s own label wins over the template name; an ad hoc point is named by its id', () => {
    const doc = landmarkFile(MESH);
    doc.landmarks[0].label = 'Fovea';
    doc.landmarks.push({ id: 'X1', template_id: null, status: 'placed', position: [0, 0, 0] });
    doc.landmarks.push({ id: 'X2', template_id: 'LM99', status: 'placed', position: [1, 1, 1] });
    const r = parse(doc);
    assert.equal(r.points[0].name, 'Fovea');
    assert.equal(r.points[3].name, 'X1');
    assert.equal(r.points[4].template_id, null, 'a link to a landmark the template lacks is dropped');
  });

  test('a missing landmark never carries a position, whatever the file says', () => {
    const doc = landmarkFile(MESH);
    doc.landmarks[2].position = [9, 9, 9];
    assert.equal(parse(doc).points[2].position, null);
  });

  test('unreadable entries are left out and counted', () => {
    const doc = landmarkFile(MESH);
    doc.landmarks.push({ id: 'LM01', status: 'placed', position: [0, 0, 0] }); // repeated id
    doc.landmarks.push({ id: 'B', status: 'placed', position: [0, 0] }); // two numbers
    doc.landmarks.push({ id: 'C', status: 'nearly', position: [0, 0, 0] }); // unknown status
    doc.landmarks.push({ id: 'D', status: 'placed', position: [0, null, 0] });
    const r = parse(doc);
    assert.equal(r.points.length, 3);
    assert.match(r.warnings[0], /4 landmark entries were unreadable/);
  });

  test('a newer minor version is read with a note; another major version is refused', () => {
    const [major, minor] = FORMAT.readVersion.split('.').map(Number);
    const newer = parse(landmarkFile(MESH, { version: `${major}.${minor + 1}.0` }));
    assert.match(newer.warnings[0], /newer format version/);
    refused(landmarkFile(MESH, { version: `${major + 1}.0.0` }), /can’t read safely/);
    refused(landmarkFile(MESH, { version: 'soon' }), /no readable format version/);
  });

  test('files up to the newest known version give no note about versions', () => {
    for (const version of ['0.1.0', '0.2.0', '0.3.0', FORMAT.readVersion]) {
      assert.deepEqual(parse(landmarkFile(MESH, { version })).warnings, [], version);
    }
  });

  test('curves are not read yet, and the file says so', () => {
    const r = parse(landmarkFile(MESH, { curves: [{ id: 'C01' }, { id: 'C02' }] }));
    assert.match(r.warnings[0], /2 curves are not shown/);
  });

  test('what is not a 3D landmark file is refused with the reason', () => {
    assert.throws(() => parseLandmarkFile('{ nope', 'broken.json'), /isn’t valid JSON/);
    refused({ format: 'something-else' }, /not a landmark file/);
    refused([1, 2], /not a landmark file/);
    const image = landmarkFile(MESH);
    image.specimen = { id: 'X', image: { file: 'a.jpg' } };
    refused(image, /2D landmarks on an image/);
    refused(landmarkFile(MESH, { specimen: { id: 'X' } }), /doesn’t say which mesh/);
    refused(landmarkFile(MESH, { template: { ref: 'cranium.template.json' } }), /separate template file/);
    refused(landmarkFile(MESH, { template: undefined }), /has no template/);
    refused(landmarkFile(MESH, { template: { id: 't', dimensions: 2, landmarks: [] } }), /2D images/);
    refused(landmarkFile(MESH, { template: { id: 't', landmarks: [{ id: 'A' }, { id: 'A' }] } }), /missing or repeated ID/);
  });
});

describe('matching a landmark file to a mesh', () => {
  const fileMesh = { file: 'FEMUR_007.ply', sha256: 'AB'.repeat(32), face_count: 496222 };

  test('by SHA-256 when both have one, whatever the letter case or file name', () => {
    assert.equal(meshMatches(fileMesh, { ...MESH, file: 'renamed.ply' }), true);
    assert.equal(meshMatches(fileMesh, { ...MESH, sha256: 'cd'.repeat(32) }), false, 'same name, different contents');
  });

  test('by file name and triangle count when a hash is lacking', () => {
    const noHash = { ...fileMesh, sha256: null };
    assert.equal(meshMatches(noHash, MESH), true);
    assert.equal(meshMatches(noHash, { ...MESH, faceCount: 10 }), false);
    assert.equal(meshMatches(null, MESH), false);
  });
});
