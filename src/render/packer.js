// Turns live particle layers into the renderer's per-frame draw items: billboard
// instances, ribbon triangles and mesh instances. Renderer fields prefixed `_` (_tex,
// _atlas, _remap, _kind, _soft, _geom, _lit) are attached by the viewer at load time.
import { FLOATS_PER_INSTANCE, RIBBON_FLOATS_PER_VERT, MESH_FLOATS_PER_INSTANCE } from './renderer.js';
import { IDENT3, add, axisAngle, basisFromForwardUp, cross, dist, eulerDeg, eulerRad, mat3mul, mul, norm, sub } from './mat3.js';

const WHITE = [1, 1, 1, 1];

// the engine stores vertex colours as RGBA8, so every channel saturates at 0..1
const sat = (x) => (x > 1 ? 1 : x < 0 ? 0 : x);

/* BillboardingMaterial -> blend kind (0 alpha, 1 additive, 2 alphablend+additive,
   3 additive-noalpha, 4 alpha-weighted add). Trove's D3D11 and GL renderers agree on
   AlphaBlend_Additive*: billboards draw it SRC_ALPHA,ONE with no premultiply flag,
   ribbons ONE,INV_SRC_ALPHA. */
export function blendKind(material, ribbon) {
  if (/Additive_NoAlpha/i.test(material)) return 3;
  if (/^AlphaBlend_Additive/i.test(material)) return ribbon ? 2 : 4;
  if (/^Additive/i.test(material)) return 1;
  return 0;
}

/* Draw order within one billboard batch. Particles composite in the order they are
   written, so an alpha-blended layer has to run back-to-front or nearer particles
   wrongly occlude the ones behind them; additive blending is commutative and needs
   no sort at all. Returns null to keep simulation order. The scratch buffers are
   module-level because this runs per layer per frame over every live particle. */
let sortIdx = new Int32Array(0), sortKey = new Float32Array(0);
export function billboardOrder(ls, r, n, eye) {
  if (r._kind === 1 || r._kind === 3 || r._kind === 4) return null;   // additive: order-free
  // Every field-sort in the corpus keys on LifeRatio, which is virtual (Age/Life)
  // rather than a stored field, so resolve it the way the script context does. A
  // field we cannot resolve falls back to camera distance, not to no sort at all.
  let field = /^Field/.test(r.sortMode) ? r.sortField : null;
  if (field && field !== 'LifeRatio' && !ls.field(field)) field = null;
  if (!field && r.sortMode !== 'CameraDistance' && !/^Field/.test(r.sortMode)) return null;
  if (sortIdx.length < n) { sortIdx = new Int32Array(n); sortKey = new Float32Array(n); }
  for (let i = 0; i < n; i++) {
    sortIdx[i] = i;
    if (field === 'LifeRatio') sortKey[i] = ls.getAt(i, 'Age')[0] / (ls.getAt(i, 'Life')[0] || 1);
    else if (field) sortKey[i] = ls.getAt(i, field)[0] || 0;
    else {
      const p = ls.getAt(i, r.positionField);
      const dx = p[0] - eye[0], dy = p[1] - eye[1], dz = p[2] - eye[2];
      sortKey[i] = dx * dx + dy * dy + dz * dz;
    }
  }
  const order = sortIdx.subarray(0, n);
  // camera distance draws farthest first; an explicit field sort follows its name
  if (field && r.sortMode === 'FieldAscending') order.sort((a, b) => sortKey[a] - sortKey[b]);
  else order.sort((a, b) => sortKey[b] - sortKey[a]);
  return order;
}

// Centre of a layer's particle bounds: the batch position the engine sorts draws by.
function boundsCenter(ls, field) {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < ls.count; i++) {
    const p = ls.getAt(i, field);
    if (!isFinite(p[0] + p[1] + p[2])) continue;
    if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
    if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
    if (p[2] < z0) z0 = p[2]; if (p[2] > z1) z1 = p[2];
  }
  return x0 <= x1 ? [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2] : [0, 0, 0];
}

// TextureID -> atlas frame, clamped the way CBillboarder::FillTexcoordsFromAtlas does
function atlasFrame(tid, alen) {
  let f = Math.abs(tid); if (!isFinite(f)) f = 0;
  return Math.min(f, alen - 1);
}
function frameRect(r, f, alen) {
  // atlas rects are [u0,v0,u1,v1]; VFlipUVs mirrors v
  const rc = r._atlas[Math.min(f | 0, alen - 1)];
  if (r.vflip) return [rc[0], rc[3], rc[2] - rc[0], rc[1] - rc[3]];
  return [rc[0], rc[1], rc[2] - rc[0], rc[3] - rc[1]];
}

/* Mesh orientation, composed as SMatrixBuilder::BuildWorldMatrix does:
   world = Forward * AxisAngle * Euler * StaticOrientation * scale, the static position
   offset rotated but not scaled. Writes the scaled basis to `out`, the unscaled
   rotation to `rot`. */
function meshBasis(ls, i, r, out, rot) {
  let m = IDENT3;
  if (r.forwardAxisField && ls.field(r.forwardAxisField)) {
    const f = ls.getAt(i, r.forwardAxisField);
    const up = r.upAxisField && ls.field(r.upAxisField) ? ls.getAt(i, r.upAxisField) : [0, 1, 0];
    m = basisFromForwardUp(f, up);
  }
  const axis = r.rotationAxisField && ls.field(r.rotationAxisField) ? ls.getAt(i, r.rotationAxisField) : r.staticRotationAxis;
  if (axis && (axis[0] || axis[1] || axis[2])) {
    const ang = r.rotationAxisAngleField && ls.field(r.rotationAxisAngleField)
      ? (ls.getAt(i, r.rotationAxisAngleField)[0] || 0)
      : (ls.getAt(i, 'Rotation')[0] || 0);
    m = mat3mul(m, axisAngle(axis, ang));
  }
  if (r.eulerRotationField && ls.field(r.eulerRotationField)) {
    m = mat3mul(m, eulerRad(ls.getAt(i, r.eulerRotationField))); // scripts write radians
  }
  if (r.staticOrientation) m = mat3mul(m, eulerDeg(r.staticOrientation));
  for (let k = 0; k < 9; k++) rot[k] = m[k];
  let sx = r.scale[0], sy = r.scale[1], sz = r.scale[2];
  if (r.scaleField && ls.field(r.scaleField)) {
    const s = ls.getAt(i, r.scaleField);
    const s0 = s[0] ?? 1;
    sx *= s0; sy *= s[1] ?? s0; sz *= s[2] ?? s0;
  }
  out[0] = m[0] * sx; out[1] = m[3] * sx; out[2] = m[6] * sx;
  out[3] = m[1] * sy; out[4] = m[4] * sy; out[5] = m[7] * sy;
  out[6] = m[2] * sz; out[7] = m[5] * sz; out[8] = m[8] * sz;
}

/* Ribbons (CRibbonBillboarder): one strip per spawner instance / parent particle,
   linked newest first. The width is a half width. Without a TextureUField the texture
   tiles once per segment; with one, U is that field's raw value. */
const RIB_CORNER = [[0, 1], [1, 1], [1, 0], [0, 0]];
const RIB_ROWS = [[3, 0, 2, 1], [2, 1, 3, 0], [0, 3, 1, 2], [1, 2, 0, 3], [0, 1, 3, 2], [3, 2, 0, 1], [1, 0, 2, 3], [2, 3, 1, 0]];
const ONE4 = [1, 1, 1, 1], ID_SO = [1, 1, 0, 0];
// quad-local corners for the per-vertex UVFactors / UVScaleAndOffset (CorrectDeformation)
const QUV = [[0, 0], [0, 1], [1, 0], [1, 1]];
const ratio = (a, b) => { const x = a / b; return isFinite(x) && x > 0 ? x : 1; };

export class FramePacker {
  constructor({ maxBillboards = 20000, maxRibbonVertices = 60000, maxMeshes = 4000 } = {}) {
    this.inst = new Float32Array(maxBillboards * FLOATS_PER_INSTANCE);
    this.rib = new Float32Array(maxRibbonVertices * RIBBON_FLOATS_PER_VERT);
    this.mbuf = new Float32Array(maxMeshes * MESH_FLOATS_PER_INSTANCE);
    this._basis = new Float32Array(9);
    this._rot = new Float32Array(9);
  }

  billboards(ls, r, eye, items) {
    const n = ls.count; if (!n) return;
    const inst = this.inst;
    let o = 0; const alen = r._atlas ? r._atlas.length : 0;
    const mode = r.mode;
    const order = billboardOrder(ls, r, n, eye);
    for (let k = 0; k < n && o + FLOATS_PER_INSTANCE <= inst.length; k++) {
      const i = order ? order[k] : k;
      const p = ls.getAt(i, r.positionField);
      if (!isFinite(p[0]) || !isFinite(p[1]) || !isFinite(p[2])) continue;
      const sz = r.constantRadius > 0 ? [r.constantRadius, r.constantRadius] : ls.getAt(i, r.sizeField);
      const col = ls.field(r.colorField) ? ls.getAt(i, r.colorField) : WHITE;   // unresolved Color draws white
      const rot = ls.getAt(i, r.rotationField)[0] || 0;
      let u0 = 0, v0 = r.vflip ? 1 : 0, du = 1, dv = r.vflip ? -1 : 1;
      let u02 = u0, v02 = v0, du2 = du, dv2 = dv, blend = 0;
      if (alen) {
        const t = atlasFrame(ls.getAt(i, r.textureIDField)[0] || 0, alen), fa = t | 0;
        [u0, v0, du, dv] = frameRect(r, fa, alen);
        if (r.softAnim) {
          [u02, v02, du2, dv2] = frameRect(r, Math.min(fa + 1, alen - 1), alen);
          blend = t - fa;
        } else { u02 = u0; v02 = v0; du2 = du; dv2 = dv; }
      }
      // stretch axis: the axis-aligned modes stretch along AxisField, planar uses both axis fields
      let ax = 0, ay = 0, az = 0, bx = 0, by = 1, bz = 0, sxScale = 1;
      if (mode === 2 || mode === 3 || mode === 5) {
        /* BillboardMode picks the billboarder; AxisField picks the data it stretches along,
           and Velocity is only its default. Forcing Velocity whenever the mode name started
           with "Velocity" threw away 2,307 authored AxisFields - and those layers usually have
           no velocity at all, so the axis came out zero. */
        const src = r.axisField && ls.field(r.axisField) ? ls.getAt(i, r.axisField) : ls.getAt(i, 'Velocity');
        ax = (src[0] || 0) * r.axisScale; ay = (src[1] || 0) * r.axisScale; az = (src[2] || 0) * r.axisScale;
      } else if (mode === 4) {
        const a1 = r.axisField && ls.field(r.axisField) ? ls.getAt(i, r.axisField) : [1, 0, 0];
        const a2 = r.axis2Field && ls.field(r.axis2Field) ? ls.getAt(i, r.axis2Field) : [0, 1, 0];
        ax = a1[0] || 0; ay = a1[1] || 0; az = a1[2] || 0;
        bx = a2[0] || 0; by = a2[1] || 0; bz = a2[2] || 0;
        if (!ax && !ay && !az) ax = 1;
        if (!bx && !by && !bz) by = 1;
        /* The planar worker scales its X basis by 0.5*AxisScale and its Y by a flat 0.5
           (billboarding request +0xac/+0xb0; AxisScale is the property at renderer+0x150), so
           AxisScale is the quad's width-to-height ratio here, not a stretch of the axis vector
           the way the velocity modes use it. 459 corpus effects set it, the portal ring at 0.5.
           X is the cross-axis direction - see the mode 4 branch in renderer.js. */
        sxScale = r.axisScale;
      }
      let cursor = 0;
      if (r._remap) {
        cursor = r.alphaCursorField && ls.field(r.alphaCursorField)
          ? (ls.getAt(i, r.alphaCursorField)[0] || 0)
          : (ls.getAt(i, 'Age')[0] / (ls.getAt(i, 'Life')[0] || 1));
      }
      inst[o++] = p[0]; inst[o++] = p[1]; inst[o++] = p[2];
      // AspectRatio only shapes screen-aligned quads: a <= 1 narrows X, a > 1 shortens Y
      let ar = 1, br = 1;
      if (mode === 0) { const a = Math.max(r.aspect, 0); if (a <= 1) ar = a; else br = 1 / a; }
      inst[o++] = (sz[0] ?? 1) * sxScale * ar; inst[o++] = (sz[1] ?? sz[0] ?? 1) * br;
      /* Saturate to 0..1. CBillboarder::FillColors packs the vertex colour to RGBA8
         with a saturating byte pack, so the engine can never see a channel above 1.
         Scripts and curves routinely produce more - the portals carry alpha 1.26 and
         red 1.44 - and passing that through float attributes multiplied every texel's
         alpha by 1.26, turning soft sprites into hard discs. */
      inst[o++] = sat(col[0] ?? 1); inst[o++] = sat(col[1] ?? 1); inst[o++] = sat(col[2] ?? 1); inst[o++] = sat(col[3] ?? 1);
      inst[o++] = rot;
      inst[o++] = u0; inst[o++] = v0; inst[o++] = du; inst[o++] = dv;
      inst[o++] = u02; inst[o++] = v02; inst[o++] = du2; inst[o++] = dv2;
      inst[o++] = blend;
      inst[o++] = ax; inst[o++] = ay; inst[o++] = az;
      inst[o++] = bx; inst[o++] = by; inst[o++] = bz;
      inst[o++] = cursor;
    }
    const count = o / FLOATS_PER_INSTANCE;
    if (!count) return;
    items.push({ type: 'billboard', texture: r._tex, remapTexture: r._remap, kind: r._kind, mode, instances: inst.slice(0, o), count, drawOrder: r.drawOrder, soft: r._soft, dissolve: r.dissolve, center: boundsCenter(ls, r.positionField) });
  }

  mesh(ls, r, items) {
    const n = ls.count; if (!n) return;
    const mbuf = this.mbuf, BASIS = this._basis, ROT = this._rot;
    let o = 0;
    for (let i = 0; i < n && o + MESH_FLOATS_PER_INSTANCE <= mbuf.length; i++) {
      const p = ls.getAt(i, r.positionField);
      if (!isFinite(p[0]) || !isFinite(p[1]) || !isFinite(p[2])) continue;
      meshBasis(ls, i, r, BASIS, ROT);
      const col = r.colorField && ls.field(r.colorField) ? ls.getAt(i, r.colorField) : WHITE;
      let px = p[0], py = p[1], pz = p[2];
      if (r.staticPosition) {
        const [a, b, c] = r.staticPosition;
        px += ROT[0] * a + ROT[1] * b + ROT[2] * c;
        py += ROT[3] * a + ROT[4] * b + ROT[5] * c;
        pz += ROT[6] * a + ROT[7] * b + ROT[8] * c;
      }
      for (let k = 0; k < 9; k++) mbuf[o++] = BASIS[k];
      mbuf[o++] = px; mbuf[o++] = py; mbuf[o++] = pz;
      mbuf[o++] = (col[0] ?? 1) * r.diffuseColor[0]; mbuf[o++] = (col[1] ?? 1) * r.diffuseColor[1];
      mbuf[o++] = (col[2] ?? 1) * r.diffuseColor[2]; mbuf[o++] = sat(col[3] ?? 1);
    }
    const count = o / MESH_FLOATS_PER_INSTANCE;
    if (!count) return;
    items.push({ type: 'mesh', geom: r._geom, texture: r._tex, lit: r._lit, kind: r._kind, instances: mbuf.slice(0, o), count, drawOrder: r.drawOrder, center: boundsCenter(ls, r.positionField) });
  }

  ribbon(ls, r, eye, items) {
    const n = ls.count; if (n < 2) return;
    const rib = this.rib;
    const groups = new Map();
    for (let i = 0; i < n; i++) {
      const g = ls.getAt(i, '__grp')[0];
      let list = groups.get(g); if (!list) groups.set(g, list = []);
      list.push(i);
    }
    const alen = r._atlas ? r._atlas.length : 0;
    const row = RIB_ROWS[(r.flipU ? 1 : 0) + (r.flipV ? 2 : 0) + (r.rotateTexture ? 4 : 0)];
    const lifeRatio = (i) => ls.getAt(i, 'Age')[0] / (ls.getAt(i, 'Life')[0] || 1);
    const readU = r.textureUField === 'LifeRatio' ? lifeRatio
      : r.textureUField && ls.field(r.textureUField) ? (i) => ls.getAt(i, r.textureUField)[0] : null;
    const axisOk = r.axisField && ls.field(r.axisField);
    let o = 0;
    const cap = rib.length - 6 * RIBBON_FLOATS_PER_VERT;
    let fac = null, so = null;
    const push = (p, u, v, c, cur, rc, q) => {
      if (rc) { u = rc[0] + u * (rc[2] - rc[0]); v = rc[1] + v * (rc[3] - rc[1]); }
      rib[o++] = p[0]; rib[o++] = p[1]; rib[o++] = p[2]; rib[o++] = u; rib[o++] = v;
      rib[o++] = sat(c[0] ?? 1); rib[o++] = sat(c[1] ?? 1); rib[o++] = sat(c[2] ?? 1); rib[o++] = sat(c[3] ?? 1);
      rib[o++] = cur;
      rib[o++] = QUV[q][0]; rib[o++] = QUV[q][1];
      const f = fac ? fac[q] : ONE4;
      rib[o++] = f[0]; rib[o++] = f[1]; rib[o++] = f[2]; rib[o++] = f[3];
      const s = so || ID_SO;
      rib[o++] = s[0]; rib[o++] = s[1]; rib[o++] = s[2]; rib[o++] = s[3];
    };
    const sU = r.flipU ? -1 : 1, oU = r.flipU ? 1 : 0;
    const vf = r.flipV !== r.rotateTexture, sV = vf ? -1 : 1, oV = vf ? 1 : 0;
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      list.sort((a, b) => ls.getAt(b, '__sid')[0] - ls.getAt(a, '__sid')[0]);
      const C = list.map((i) => ls.getAt(i, r.positionField));
      const E = list.map((i, k) => {
        const c = C[k], tan = sub(C[k + 1] || c, C[k - 1] || c);
        const w = r.widthField ? (ls.getAt(i, r.widthField)[0] || 0) : r.width;
        let side;
        if (r.mode === 'SideAxisAligned' && axisOk) side = norm(ls.getAt(i, r.axisField));
        else if (r.mode === 'NormalAxisAligned' && axisOk) side = norm(cross(tan, ls.getAt(i, r.axisField)));
        else side = norm(cross(sub(c, eye), tan));
        if (!isFinite(side[0])) side = [1, 0, 0];
        const cur = r._remap
          ? (r.alphaCursorField && ls.field(r.alphaCursorField) ? ls.getAt(i, r.alphaCursorField)[0] : lifeRatio(i))
          : 0;
        let rc = null;
        if (alen) {
          const tid = r.textureIDField && ls.field(r.textureIDField) ? ls.getAt(i, r.textureIDField)[0] : r.textureID;
          rc = r._atlas[atlasFrame(tid || 0, alen) | 0];
        }
        return { P: add(c, mul(side, w)), M: sub(c, mul(side, w)), col: ls.field(r.colorField) ? ls.getAt(i, r.colorField) : WHITE, cur, rc, t: readU ? readU(i) : 0 };
      });
      for (let k = 0; k + 1 < E.length && o < cap; k++) {
        const a = E[k], b = E[k + 1];
        let uv;
        if (readU) {
          // [a+, a-, b+, b-]
          const f = (t) => (r.flipU ? 1 - t : t);
          const v0 = r.flipV ? 1 : 0, v1 = 1 - v0;
          uv = r.rotateTexture
            ? [[0, 1 - a.t], [1, 1 - a.t], [0, 1 - b.t], [1, 1 - b.t]]
            : [[f(a.t), v0], [f(a.t), v1], [f(b.t), v0], [f(b.t), v1]];
        } else uv = row.map((j) => RIB_CORNER[j]);
        if (r.correct) {
          /* CRibbonBillboarder UVFactors (FUN_1808abff0) over v0 a+, v1 a-, v2 b+, v3 b-:
             f0 = |v3-v1| / |v2-v0|, f1 = |v3-v2| / |v1-v0|; and the UV remap job's
             per-quad scale/offset (FUN_1808ab5e0 / FUN_1808ab850), atlas folded in. */
          const f0 = ratio(dist(b.M, a.M), dist(b.P, a.P)), f1 = ratio(dist(b.M, b.P), dist(a.M, a.P));
          fac = [ONE4, [f0, 1, 1, 1 / f1], [1, f1, 1 / f0, 1], ONE4];
          let s;
          if (readU) {
            const d = b.t - a.t;
            s = r.rotateTexture ? [sU, d * sV, oU, a.t * sV + oV] : [d * sU, sV, a.t * sU + oU, oV];
          } else s = [sU, sV, oU, oV];
          const rc = a.rc;
          so = rc ? [s[0] * (rc[2] - rc[0]), s[1] * (rc[3] - rc[1]), rc[0] + s[2] * (rc[2] - rc[0]), rc[1] + s[3] * (rc[3] - rc[1])] : s;
        }
        push(a.P, uv[0][0], uv[0][1], a.col, a.cur, a.rc, 0); push(a.M, uv[1][0], uv[1][1], a.col, a.cur, a.rc, 1); push(b.P, uv[2][0], uv[2][1], b.col, b.cur, a.rc, 2);
        push(a.M, uv[1][0], uv[1][1], a.col, a.cur, a.rc, 1); push(b.M, uv[3][0], uv[3][1], b.col, b.cur, a.rc, 3); push(b.P, uv[2][0], uv[2][1], b.col, b.cur, a.rc, 2);
      }
    }
    if (!o) return;
    items.push({ type: 'ribbon', texture: r._tex, remapTexture: r._remap, kind: r._kind, soft: r._soft, repeat: r.repeat, correct: r.correct, rotate: r.rotateTexture, vertices: rib.slice(0, o), count: o / RIBBON_FLOATS_PER_VERT, drawOrder: r.drawOrder, center: boundsCenter(ls, r.positionField) });
  }
}
