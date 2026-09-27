// Minimal ZIP reading and writing on the platform's own deflate streams (browsers and
// Node 22+). Stored and deflated entries, UTF-8 names; no ZIP64, encryption or spanning.

const LOCAL = 0x04034b50, CENTRAL = 0x02014b50, END = 0x06054b50;
const UTF8_FLAG = 0x0800;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const pipe = async (bytes, stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());

/**
 * List a ZIP archive's files; each entry decompresses on demand.
 * @param {ArrayBuffer} buffer
 * @returns {{path: string, size: number, blob: () => Promise<Blob>}[]}
 */
export function readZip(buffer) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === END) { end = i; break; }
  }
  if (end < 0) throw new Error('not a ZIP archive');
  const count = view.getUint16(end + 10, true);
  let p = view.getUint32(end + 16, true);
  if (p === 0xffffffff || count === 0xffff) throw new Error('ZIP64 archives are not supported');
  const utf8 = new TextDecoder('utf-8');
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== CENTRAL) throw new Error('corrupt ZIP central directory');
    const method = view.getUint16(p + 10, true);
    const packed = view.getUint32(p + 20, true);
    const size = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true), extraLen = view.getUint16(p + 30, true), commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const path = utf8.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (path.endsWith('/')) continue;   // directory record
    if (method !== 0 && method !== 8) throw new Error(`${path}: unsupported compression method ${method}`);
    entries.push({
      path, size,
      blob: async () => {
        if (view.getUint32(local, true) !== LOCAL) throw new Error(`${path}: corrupt local header`);
        const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
        const data = bytes.subarray(start, start + packed);
        return new Blob([method === 0 ? data : await pipe(data, new DecompressionStream('deflate-raw'))]);
      },
    });
  }
  return entries;
}

function dosTime(date) {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    day: ((Math.max(date.getFullYear(), 1980) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/**
 * Build a ZIP archive. Each file is deflated unless storing it is smaller.
 * @param {{path: string, data: Uint8Array}[]} files
 * @param {Date} [date] timestamp written for every entry
 * @returns {Promise<Blob>}
 */
export async function writeZip(files, date = new Date()) {
  const enc = new TextEncoder();
  const { time, day } = dosTime(date);
  const parts = [];
  const central = [];
  let offset = 0;
  for (const { path, data } of files) {
    const name = enc.encode(path);
    const deflated = await pipe(data, new CompressionStream('deflate-raw'));
    const stored = deflated.length >= data.length;
    const body = stored ? data : deflated;
    const crc = crc32(data);
    const head = new DataView(new ArrayBuffer(30));
    head.setUint32(0, LOCAL, true);
    head.setUint16(4, 20, true);
    head.setUint16(6, UTF8_FLAG, true);
    head.setUint16(8, stored ? 0 : 8, true);
    head.setUint16(10, time, true);
    head.setUint16(12, day, true);
    head.setUint32(14, crc, true);
    head.setUint32(18, body.length, true);
    head.setUint32(22, data.length, true);
    head.setUint16(26, name.length, true);
    parts.push(head, name, body);

    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, CENTRAL, true);
    dir.setUint16(4, 20, true);
    dir.setUint16(6, 20, true);
    dir.setUint16(8, UTF8_FLAG, true);
    dir.setUint16(10, stored ? 0 : 8, true);
    dir.setUint16(12, time, true);
    dir.setUint16(14, day, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, body.length, true);
    dir.setUint32(24, data.length, true);
    dir.setUint16(28, name.length, true);
    dir.setUint32(42, offset, true);
    central.push(dir, name);
    offset += 30 + name.length + body.length;
  }
  const dirSize = central.reduce((n, part) => n + part.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, END, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, dirSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}
