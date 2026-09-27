import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileScript } from '../src/engine/script.js';

// A particle context backed by a plain map of fields.
function context(fields = {}) {
  const store = new Map(Object.entries(fields));
  const warnings = [];
  return {
    store, warnings, dead: false,
    getField: (n) => (store.has(n) ? store.get(n).slice() : null),
    setField: (n, v) => store.set(n, v.slice()),
    hasField: (n) => store.has(n),
    sampler: () => null,
    attribute: () => null,
    rand: (a) => a,
    vrand: () => [0, 0, 0],
    kill() { this.dead = true; },
    warn: (m) => warnings.push(m),
  };
}

const run = (body, fields) => {
  const ctx = context(fields);
  compileScript(`function void Eval()\n{\n${body}\n}`).run(ctx);
  return ctx;
};
const out = (body, fields) => run(body, fields).store.get('Out');

test('vector arithmetic broadcasts scalars', () => {
  assert.deepEqual(out('Out = float3(1, 2, 3) * 2 + 1;'), [3, 5, 7]);
});

test('integer division truncates, float division does not', () => {
  assert.deepEqual(out('int a = 7 / 2; Out = a;'), [3]);
  assert.deepEqual(out('Out = 7.0 / 2;'), [3.5]);
  assert.deepEqual(out('Out = -7 % 3;'), [-1]);
});

test('swizzles read and write components', () => {
  const ctx = run('Color.rgb = float3(0.5); Out = Color.a + Color.r;', { Color: [1, 1, 1, 0.25] });
  assert.deepEqual(ctx.store.get('Color'), [0.5, 0.5, 0.5, 0.25]);
  assert.deepEqual(ctx.store.get('Out'), [0.75]);
});

test('intrinsics, ternaries and helper functions', () => {
  assert.deepEqual(out('Out = clamp(float2(-1, 5), 0, 1);'), [0, 1]);
  assert.deepEqual(out('Out = lerp(0, 10, 0.25);'), [2.5]);
  assert.deepEqual(out('Out = 3 > 2 ? 1 : 0;'), [1]);
  const ctx = context();
  compileScript('function void Run() { Out = 5; }\nfunction void Eval() { Run(); }').run(ctx);
  assert.deepEqual(ctx.store.get('Out'), [5]);
});

test('kill() and unknown functions', () => {
  assert.equal(run('kill(1 > 0);').dead, true);
  assert.equal(run('kill(0);').dead, false);
  const ctx = run('Out = mystery(1); Out = mystery(2);');
  assert.deepEqual(ctx.store.get('Out'), [0]);
  assert.deepEqual(ctx.warnings, ['unknown script function mystery()']);
});

test('rejects a script that does not parse', () => {
  assert.throws(() => compileScript('function void Eval() { Life = rand(0.5, 1.0; }'));
});
