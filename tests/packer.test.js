import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FramePacker, billboardOrder, blendKind } from '../src/render/packer.js';
import { FLOATS_PER_INSTANCE } from '../src/render/renderer.js';

// Minimal stand-in for a simulated layer: a list of particles as field maps.
function layer(particles) {
  return {
    count: particles.length,
    field: (name) => particles.some((p) => name in p),
    getAt: (i, name) => (particles[i][name] ?? [0]).slice(),
  };
}
const billboard = (over = {}) => ({
  kind: 'billboard', mode: 0, _kind: 0, sortMode: 'CameraDistance', sortField: null,
  positionField: 'Position', sizeField: 'Size', colorField: 'Color', rotationField: 'Rotation', textureIDField: 'TextureID',
  constantRadius: 0, axisScale: 0.1, aspect: 1, vflip: false, softAnim: false, drawOrder: 0, dissolve: 0, ...over,
});

test('maps materials to blend kinds', () => {
  assert.equal(blendKind('AlphaBlend'), 0);
  assert.equal(blendKind('Additive'), 1);
  assert.equal(blendKind('Additive_Soft'), 1);
  assert.equal(blendKind('AlphaBlend_Additive_Soft'), 4);
  assert.equal(blendKind('AlphaBlend_Additive_Soft', true), 2);
  assert.equal(blendKind('Additive_NoAlpha'), 3);
});

test('alpha-blended billboards draw back to front; additive ones keep their order', () => {
  const ls = layer([{ Position: [0, 0, 1] }, { Position: [0, 0, 9] }, { Position: [0, 0, 5] }]);
  assert.deepEqual([...billboardOrder(ls, billboard(), 3, [0, 0, 0])], [1, 2, 0]);
  assert.equal(billboardOrder(ls, billboard({ _kind: 1 }), 3, [0, 0, 0]), null);
});

test('field sorts use LifeRatio even though it is not stored', () => {
  const ls = layer([{ Age: [0.5], Life: [1] }, { Age: [0.1], Life: [1] }, { Age: [0.9], Life: [1] }]);
  const r = billboard({ sortMode: 'FieldAscending', sortField: 'LifeRatio' });
  assert.deepEqual([...billboardOrder(ls, r, 3, [0, 0, 0])], [1, 0, 2]);
});

test('packs one instance per finite particle with saturated colour', () => {
  const ls = layer([
    { Position: [1, 2, 3], Size: [0.5, 0.5], Color: [2, 0.5, -1, 1.26], Rotation: [0.3] },
    { Position: [NaN, 0, 0], Size: [1, 1], Color: [1, 1, 1, 1] },
  ]);
  const items = [];
  new FramePacker().billboards(ls, billboard({ _kind: 1 }), [0, 0, 10], items);
  assert.equal(items.length, 1);
  const [item] = items;
  assert.equal(item.count, 1);
  assert.equal(item.instances.length, FLOATS_PER_INSTANCE);
  assert.deepEqual([...item.instances.slice(0, 10)].map((x) => Math.round(x * 100) / 100), [1, 2, 3, 0.5, 0.5, 1, 0.5, 0, 1, 0.3]);
});
