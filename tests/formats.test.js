import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeDDS } from '../src/formats/dds.js';
import { parseAtlas } from '../src/formats/atlas.js';
import { POPCORNFX_VERSION, versionSupport } from '../src/version.js';

// 128-byte DDS header followed by `data`
function dds({ width, height, fourCC = null, bits = 32, masks = [0xff0000, 0xff00, 0xff, 0xff000000] }, data) {
  const buf = new ArrayBuffer(128 + data.length);
  const v = new DataView(buf);
  v.setUint32(0, 0x20534444, true);   // 'DDS '
  v.setUint32(4, 124, true);
  v.setUint32(12, height, true);
  v.setUint32(16, width, true);
  if (fourCC) {
    v.setUint32(80, 0x4, true);
    v.setUint32(84, fourCC.split('').reduce((acc, c, i) => acc | (c.charCodeAt(0) << (8 * i)), 0), true);
  } else {
    v.setUint32(80, 0x41, true);
    v.setUint32(88, bits, true);
    masks.forEach((m, i) => v.setUint32(92 + 4 * i, m, true));
  }
  new Uint8Array(buf, 128).set(data);
  return buf;
}

test('decodes uncompressed BGRA', () => {
  const { width, height, rgba } = decodeDDS(dds({ width: 2, height: 1 }, [0x30, 0x20, 0x10, 0xff, 0x00, 0x00, 0xff, 0x80]));
  assert.equal(width, 2);
  assert.equal(height, 1);
  assert.deepEqual([...rgba], [0x10, 0x20, 0x30, 0xff, 0xff, 0x00, 0x00, 0x80]);
});

test('decodes a DXT1 block with punch-through alpha', () => {
  // c0 <= c1 selects 3-colour mode, where index 3 is transparent black
  const block = [0x00, 0x00, 0xff, 0xff, 0b11100100, 0, 0, 0];
  const { rgba } = decodeDDS(dds({ width: 4, height: 4, fourCC: 'DXT1' }, block));
  // black, white, their midpoint (127.5 stored as 128), transparent
  assert.deepEqual([...rgba.slice(0, 16)], [0, 0, 0, 255, 255, 255, 255, 255, 128, 128, 128, 255, 0, 0, 0, 0]);
});

test('rejects files that are not DDS', () => {
  assert.throws(() => decodeDDS(new ArrayBuffer(128)), /not a DDS/);
});

test('parses atlas rects, normalizing reversed ones', () => {
  assert.deepEqual(parseAtlas('0, 0, 0.5, 0.5\r\n1, 1, 0.5, 0.5\n\n'), [[0, 0, 0.5, 0.5], [0.5, 0.5, 1, 1]]);
});

test('classifies version headers against the targeted release', () => {
  assert.equal(POPCORNFX_VERSION, '1.13.5');
  assert.equal(versionSupport('1.13.5.65444'), 'match');
  assert.equal(versionSupport('1.13.1.45791'), 'match');
  assert.equal(versionSupport('1.9.0.27524'), 'older');
  assert.equal(versionSupport('2.1.0.1234'), 'newer');
  assert.equal(versionSupport(null), 'unknown');
});
