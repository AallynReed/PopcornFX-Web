import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePkfx, PkfxParseError, deref, toNums, toSym } from '../src/engine/parser.js';

test('reads headers and objects in file order', () => {
  const doc = parsePkfx('Version = 1.13.5.65444;\nGenerator = EDITOR;\nCParticleEffect\t$LOCAL$/Resource\n{\n\tOnSpawn = "$LOCAL$/Spawner";\n}\nCFoo $LOCAL$/Spawner\n{\n}\n');
  assert.equal(doc.version, '1.13.5.65444');
  assert.equal(doc.generator, 'EDITOR');
  assert.deepEqual(doc.order, ['$LOCAL$/Resource', '$LOCAL$/Spawner']);
  const root = doc.objects['$LOCAL$/Resource'];
  assert.equal(root.className, 'CParticleEffect');
  assert.equal(deref(doc, root.props.OnSpawn).className, 'CFoo');
});

test('decodes every value form', () => {
  const doc = parsePkfx(`CX $LOCAL$/A
{
  N = -2.5000000e+000;
  F = 1000.0f;
  Inf = 1.#INF000e+000;
  NegInf = -1.#INF000e+000;
  B = true;
  Sym = AlphaBlend_Soft;
  V = float3(1.0, -2, 3e-1);
  L = { 1, 2, 3, };
  Refs =
  {
    "$LOCAL$/B",
  };
}`);
  const p = doc.objects['$LOCAL$/A'].props;
  assert.equal(p.N, -2.5);
  assert.equal(p.F, 1000);
  assert.equal(p.Inf, Infinity);
  assert.equal(p.NegInf, -Infinity);
  assert.equal(p.B, true);
  assert.equal(toSym(p.Sym), 'AlphaBlend_Soft');
  assert.deepEqual(toNums(p.V), [1, -2, 0.3]);
  assert.deepEqual(p.L, [1, 2, 3]);
  assert.deepEqual(p.Refs, ['$LOCAL$/B']);
});

test('a value the engine cannot read cuts the file short there, as the engine does', () => {
  const doc = parsePkfx(`CX $LOCAL$/A
{
  N = 1;
}
CX $LOCAL$/B
{
  Soft = Infinity;
}
CX $LOCAL$/C
{
  Ind = -1.#IND000e+000;
}`);
  assert.deepEqual(doc.order, ['$LOCAL$/A']);
  assert.equal(doc.aborted.id, '$LOCAL$/B');
  assert.equal(parsePkfx('CX $LOCAL$/A { Ind = -1.#IND000e+000; }').aborted.value, '-1.#IND000e+000');
});

test('keeps multi-line script strings and their escapes', () => {
  const doc = parsePkfx('CS $LOCAL$/S\n{\n\tExpression = "function void Eval()\n{\n\tName = \\"x\\"; // it\\\'s\n}\n";\n}\n');
  assert.equal(doc.objects['$LOCAL$/S'].props.Expression, 'function void Eval()\n{\n\tName = "x"; // it\'s\n}\n');
});

test('tolerates a UTF-8 byte order mark', () => {
  assert.equal(parsePkfx('﻿Version = 1.9.0.27524;\n').version, '1.9.0.27524');
});

test('reports the position of a syntax error', () => {
  assert.throws(() => parsePkfx('CX $LOCAL$/A\n{\n  N = ;\n}'), (e) => e instanceof PkfxParseError && e.line === 3);
});
