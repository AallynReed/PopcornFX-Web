import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Pack, normalizePath } from '../src/io/pack.js';
import { extractRefs } from '../src/formats/refs.js';
import { fixture } from './helpers.js';

const files = (...paths) => paths.map((path) => ({ path, blob: async () => new Blob([path]) }));

test('normalizes separators and leading dots', () => {
  assert.equal(normalizePath('.\\Textures\\\\fx.dds'), 'Textures/fx.dds');
  assert.equal(normalizePath('/Particles/a.pkfx'), 'Particles/a.pkfx');
});

test('resolves against the pack root, case-insensitively', () => {
  const pack = new Pack(files(
    'extracted/particles/VFX/popcornproject.xml',
    'extracted/particles/VFX/Particles/fire.pkfx',
    'extracted/particles/VFX/Textures/vfx_circle_10.dds',
    'extracted/particles/VFX/Editor/Thumbnails/Particles/fire.pkfx.png',
  ));
  const from = 'extracted/particles/VFX/Particles/fire.pkfx';
  assert.deepEqual(pack.roots, ['extracted/particles/vfx/']);
  const hit = pack.resolve('Textures/VFX_circle_10.dds', from);
  assert.equal(hit.rule, 'pack');
  assert.equal(hit.entry.path, 'extracted/particles/VFX/Textures/vfx_circle_10.dds');
  assert.equal(pack.relative(from), 'Particles/fire.pkfx');
  assert.equal(pack.thumbnail(from).path, 'extracted/particles/VFX/Editor/Thumbnails/Particles/fire.pkfx.png');
  assert.equal(pack.resolve('Textures/absent.dds', from), null);
});

test('a project file at the top level makes the whole set the pack', () => {
  const pack = new Pack(files('popcornproject.xml', 'Particles/a.pkfx', 'Textures/t.dds'));
  assert.deepEqual(pack.roots, ['']);
  assert.equal(pack.resolve('textures/T.dds', 'Particles/a.pkfx').rule, 'pack');
  assert.equal(pack.relative('Particles/a.pkfx'), 'Particles/a.pkfx');
});

test('falls back to full paths, then to file names', () => {
  const pack = new Pack(files('mod/fire.pkfx', 'mod/stuff/glow.dds', 'Textures/exact.dds'));
  assert.equal(pack.resolve('Textures/exact.dds').rule, 'path');
  const byName = pack.resolve('Textures/Glow.dds', 'mod/fire.pkfx');
  assert.equal(byName.rule, 'name');
  assert.equal(byName.entry.path, 'mod/stuff/glow.dds');
});

test('binds each effect to its nearest pack root', () => {
  const pack = new Pack(files(
    'Live/VFX/popcornproject.xml', 'Live/VFX/Particles/a.pkfx', 'Live/VFX/Textures/t.dds',
    'PTS/VFX/popcornproject.xml', 'PTS/VFX/Particles/a.pkfx', 'PTS/VFX/Textures/t.dds',
  ));
  assert.equal(pack.resolve('Textures/t.dds', 'PTS/VFX/Particles/a.pkfx').entry.path, 'PTS/VFX/Textures/t.dds');
  assert.equal(pack.resolve('Textures/t.dds', 'Live/VFX/Particles/a.pkfx').entry.path, 'Live/VFX/Textures/t.dds');
});

test('lists effects by name and reads files', async () => {
  const pack = new Pack(files('b/Zed.pkfx', 'a/alpha.pkfx', 'a/notes.txt'));
  assert.deepEqual(pack.effects.map((e) => e.name), ['alpha.pkfx', 'Zed.pkfx']);
  assert.equal(await pack.text('a/notes.txt'), 'a/notes.txt');
  assert.equal(await pack.text('nope.txt'), null);
});

test('extracts render dependencies, skipping editor-only objects', () => {
  assert.deepEqual(extractRefs(fixture('events.pkfx')), ['Textures/Parent.dds', 'Textures/child.dds', 'AtlasDefinitions/atlasDef_2x2.pkat']);
  assert.deepEqual(extractRefs(fixture('random-children.pkfx')), []);
  assert.deepEqual(extractRefs('CParticleSamplerAnimTrack\t$LOCAL$/A\n{\n\tAnimResource = "Meshes/path.fbx";\n}\n'), ['Meshes/path.pkan']);
  assert.deepEqual(extractRefs('CX\t$LOCAL$/A\n{\n\tA = "T/x.dds";\n\tB = "t/X.DDS";\n}\n'), ['T/x.dds']);
});
