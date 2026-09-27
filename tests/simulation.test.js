import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePkfx } from '../src/engine/parser.js';
import { buildEffect } from '../src/engine/model.js';
import { System, FLOOR_DROP } from '../src/engine/sim.js';
import { ShapeSampler } from '../src/engine/curves.js';
import { demoEffect, fixture, seededRandom } from './helpers.js';

const load = (text, seed = 7) => {
  const warnings = [];
  const rng = seededRandom(seed);
  const effect = buildEffect(parsePkfx(text), rng, { warn: (m) => warnings.push(m) });
  return { effect, warnings, system: new System(effect, rng) };
};
const run = (system, seconds) => { for (let t = 0; t < seconds * 60; t++) system.update(1 / 60); };

test('an instant burst spawns its count, and OnDeath spawns into the child layer', () => {
  const { effect, system } = load(fixture('events.pkfx'));
  assert.deepEqual(effect.layers.map((l) => [l.name, l.isChild]), [['Spawner', false], ['Child', true]]);
  system.update(1 / 60);
  assert.equal(system.layers[0].count, 5);
  run(system, 0.2);
  assert.equal(system.layers[0].count, 0, 'parents live 0.1 s');
  assert.equal(system.layers[1].count, 10, 'each death spawns two children');
});

test('child spawn scripts read the parent snapshot', () => {
  const { system } = load(fixture('events.pkfx'));
  run(system, 0.2);
  const child = system.layers[1];
  assert.ok(Math.abs(child.getAt(0, 'Size')[0] - 0.1) < 1e-6);   // fields are float32
});

test('random children pick one weighted alternative per start', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const { system } = load(fixture('random-children.pkfx'), seed);
    system.update(1 / 60);
    assert.equal(system.layers[0].count, 0, 'weight 0 never spawns');
    assert.equal(system.layers[1].count, 3);
  }
});

test('script problems are reported and the effect keeps playing', () => {
  const { effect, warnings, system } = load(fixture('broken-script.pkfx'));
  run(system, 1);
  assert.ok(system.layers[0].count > 0);
  assert.ok(warnings.some((w) => /Spawn failed to compile/.test(w)), warnings.join('\n'));
  assert.ok(warnings.some((w) => /unknown script function notAFunction\(\)/.test(w)), warnings.join('\n'));
  // a name the layer lacks fails to compile, as in the engine: that evolver is dropped
  assert.ok(warnings.some((w) => /UnresolvedScript does not compile: unresolved symbol "NotDeclared"/.test(w)), warnings.join('\n'));
  assert.equal(effect.layers[0].evolvers.filter((e) => e.type === 'script').length, 1);
  assert.ok(effect.layers[0].evolvers.some((e) => e.type === 'unsupported' && e.cls === 'CParticleEvolver_Mystery'));
});

test('the demo effect runs cleanly, with sparks bouncing on the preview floor', () => {
  const { effect, warnings, system } = load(demoEffect());
  assert.deepEqual(effect.layers.map((l) => l.renderers.map((r) => r.kind)), [['billboard'], ['billboard'], ['ribbon']]);
  let lowest = Infinity;
  for (let f = 0; f < 180; f++) {
    system.update(1 / 60);
    const sparks = system.layers[1];
    for (let i = 0; i < sparks.count; i++) lowest = Math.min(lowest, sparks.getAt(i, 'Position')[1]);
  }
  assert.deepEqual(warnings, []);
  for (const layer of system.layers) assert.ok(layer.count > 0, `${layer.L.name} is alive`);
  assert.ok(lowest >= -FLOOR_DROP - 1e-3, `sparks stay above the floor (lowest ${lowest})`);
});

test('a MESH shape samples its submesh surface, scaled by MeshScale', () => {
  const shape = { className: 'CShapeDescriptor', props: { ShapeType: { sym: 'MESH' }, MeshResource: 'Meshes/tri.fbx', MeshScale: { ctor: 'float3', args: [2, 2, 2] } } };
  const s = new ShapeSampler(shape, seededRandom(3), null);
  assert.equal(s.meshResourceRef(), 'Meshes/tri.pkmm');
  s.loadMesh({ blocks: [{ positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), normals: null, indices: new Uint16Array([0, 1, 2]) }] });
  for (let k = 0; k < 50; k++) {
    const [x, y, z] = s.samplePosition();
    assert.ok(x >= 0 && y >= 0 && x + y <= 2 + 1e-6 && z === 0, `${x},${y},${z}`);
  }
});

test('the same pcoords land on the same point of a shape collection', () => {
  const doc = parsePkfx(`CShapeDescriptorCollection $LOCAL$/C
{
  SubShapes = { "$LOCAL$/A", "$LOCAL$/B", };
}
CShapeDescriptor $LOCAL$/A
{
  ShapeType = SPHERE;
}
CShapeDescriptor $LOCAL$/B
{
  ShapeType = BOX;
  Position = float3(5, 0, 0);
}`);
  const s = new ShapeSampler(doc.objects['$LOCAL$/C'], seededRandom(7), doc);
  for (let k = 0; k < 20; k++) {
    const pc = s.samplePCoords();
    assert.deepEqual(s.samplePosition(pc), s.samplePosition(pc));
    const p = s.samplePosition(pc), n = s.sampleNormal(pc);
    // sphere points sit along their normal; box points are 5 units out
    if (Math.abs(p[0]) < 2) assert.ok(Math.abs(p[0] - n[0]) < 1e-6 && Math.abs(p[1] - n[1]) < 1e-6);
  }
});
