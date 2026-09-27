// Plays one effect from a Pack on a WebGL2 canvas: resolves and decodes its assets,
// runs the CPU simulation and draws billboards, ribbons and meshes every frame.
//
// The effect plays in place, the way it does in the PopcornFX editor: nothing moves the
// emitter except a shift-drag (or right-drag), so trails and localspace layers only
// stream when asked to.
import { parsePkfx } from '../engine/parser.js';
import { buildEffect } from '../engine/model.js';
import { System, FLOOR_DROP } from '../engine/sim.js';
import { AnimTrackSampler, ShapeSampler } from '../engine/curves.js';
import { decodeDDS } from '../formats/dds.js';
import { decodePkmm } from '../formats/pkmm.js';
import { parseAtlas } from '../formats/atlas.js';
import { extractRefs } from '../formats/refs.js';
import { Renderer, makeLevelsTexture, makeImageTexture } from '../render/renderer.js';
import { FramePacker, blendKind, mergeMediums } from '../render/packer.js';

const STEP = 1 / 60;
const MAX_STEP = 0.05;            // longest simulation step; slower frames are split
const MEASURE_SECONDS = 1.5;      // opening window used to frame the camera
const CACHE_LIMIT = 256;          // decoded assets kept across effects
const ORBIT = 1, MOVE = 2;

const defaultCamera = () => ({ az: 0.6, el: 0.3, dist: 14, target: [0, 1.5, 0] });
const clamp = (x, a, b) => Math.min(Math.max(x, a), b);

/**
 * @typedef {object} EffectReport
 * @property {string} path
 * @property {string|null} version  the file's `Version` header
 * @property {string|null} generator
 * @property {boolean} empty        a blank file: mods ship these to switch an effect off
 * @property {{name: string, child: boolean, renderers: {kind: string, material: string|null, skipped: string|null}[]}[]} layers
 * @property {{ref: string, rule: import('../io/pack.js').ResolveRule|null, path: string|null}[]} assets
 * @property {string[]} unsupported renderer and evolver classes the viewer does not draw or run
 * @property {string[]} diagnostics  script and asset problems; grows while the effect plays
 */

export class Viewer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @throws {Error} when WebGL2 is unavailable
   */
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new Renderer(canvas);
    this.renderer.cam = defaultCamera();
    this.packer = new FramePacker();
    this.pack = null;
    this.system = null;
    /** @type {EffectReport|null} */
    this.report = null;
    this.playing = true;
    this.speed = 1;
    this.ground = false;
    this.stats = { alive: 0, layers: [], fps: 0 };

    this._assets = new Map();     // key -> Promise<{value, error, used}>
    this._token = 0;
    this._autofit = { active: true, scale: 0, t: 0, floor: null, y1: null };
    this._lastT = 0;
    this._raf = requestAnimationFrame(this._frame);
    this._abort = new AbortController();
    this._bindControls(this._abort.signal);
  }

  /** Use a new file set; decoded assets from the previous one are released. */
  setPack(pack) {
    this._token++;
    this._releaseAssets(() => true);
    this.pack = pack;
    this.system = null;
    this.report = null;
  }

  /**
   * Load and start playing an effect from the current pack.
   * @param {string} path
   * @returns {Promise<EffectReport|null>} null when a newer open() superseded this one
   */
  async open(path) {
    const pack = this.pack;
    if (!pack) throw new Error('no pack loaded');
    const token = ++this._token;
    /** @type {EffectReport} */
    const report = { path, version: null, generator: null, empty: false, layers: [], assets: [], unsupported: [], diagnostics: [] };
    const warn = (message) => { if (!report.diagnostics.includes(message)) report.diagnostics.push(message); };

    const text = await pack.text(path);
    if (token !== this._token) return null;
    if (text == null) throw new Error(`${path} could not be read`);
    report.assets = extractRefs(text).map((ref) => {
      const hit = pack.resolve(ref, path);
      return { ref, rule: hit ? hit.rule : null, path: hit ? hit.entry.path : null };
    });
    if (!/\S/.test(text)) {
      report.empty = true;
      this._install(null, report, token);
      return report;
    }

    const doc = parsePkfx(text);
    report.version = doc.version;
    report.generator = doc.generator;
    if (doc.aborted) {
      const { id, value } = doc.aborted;
      warn(`the engine stops reading this file at ${id.replace('$LOCAL$/', '')} (it cannot read the value ${value}), so everything from there on is missing, as in game`);
    }
    const effect = buildEffect(doc, Math.random, { warn });

    const unsupported = new Set();
    const jobs = [];
    for (const layer of effect.layers) {
      for (const r of layer.renderers) jobs.push(this._prepareRenderer(r, path, token, warn, unsupported));
      collectUnsupported(layer.evolvers, unsupported);
    }
    jobs.push(this._loadAnimTracks(effect, path));
    jobs.push(this._loadShapeMeshes(effect, path, token, warn));
    await Promise.all(jobs);
    if (token !== this._token) return null;

    report.unsupported = [...unsupported].sort();
    report.layers = effect.layers.map((l) => ({
      name: l.name,
      child: l.isChild,
      renderers: l.renderers.map((r) => ({
        kind: r.kind === 'unsupported' ? r.cls.replace('CParticleRenderer_', '') : r.kind,
        material: r.material || null,
        skipped: r._skip || null,
      })),
    }));
    this._install(new System(effect, Math.random), report, token);
    return report;
  }

  play() { this.playing = true; }
  pause() { this.playing = false; }

  /** Restart the effect from its first frame, keeping the camera. */
  restart() {
    if (!this.system) return;
    this.system.reset();
    this._simError = false;
  }

  /** Advance one 60 Hz frame (for stepping while paused). */
  step() { this._simulate(STEP); }

  /** Put the camera and the emitter back where the effect started, and reframe. */
  resetView() {
    this.renderer.cam = defaultCamera();
    if (this.system) this.system.emitter.fill(0);
    this._autofit = { active: true, scale: 0, t: 0, floor: null, y1: null };
  }

  /** @returns {Promise<Blob|null>} the current frame as PNG */
  snapshot() {
    this._draw();
    return new Promise((resolve) => this.canvas.toBlob(resolve, 'image/png'));
  }

  dispose() {
    this._token++;
    cancelAnimationFrame(this._raf);
    this._abort.abort();
    this._releaseAssets(() => true);
    const ext = this.renderer.gl.getExtension('WEBGL_lose_context');
    if (ext) ext.loseContext();
    this.system = null;
  }

  // ---- loading ----

  _install(system, report, token) {
    this.system = system;
    this.report = report;
    this._simError = false;
    this.renderer.cam = defaultCamera();
    this._autofit = { active: true, scale: 0, t: 0, floor: null, y1: null };
    if (this._assets.size > CACHE_LIMIT) this._releaseAssets((a) => a.used !== token);
  }

  /* Missing assets: in the game a renderer whose texture, alpha remapper or mesh does not
     load draws nothing (FUN_1402b3480, FUN_1402b78d0), so an effect opened from its pack
     (a folder with popcornproject.xml) does the same. Loose files keep stand-ins - a soft
     dot, a cube - so an effect opened without its assets still reads. */
  async _prepareRenderer(r, from, token, warn, unsupported) {
    const inPack = this.pack.rootFor(from) != null;
    const absent = (ref) => inPack && !this.pack.resolve(ref, from);
    if (r.kind === 'billboard' || r.kind === 'ribbon') {
      // No Diffuse: the engine falls back to a magenta debug sprite the game never shows
      if (!r.diffuse) { r._skip = 'no texture'; return; }
      if (absent(r.diffuse)) { r._skip = 'texture missing from the pack'; return; }
      if (r.alphaRemap && absent(r.alphaRemap)) { r._skip = 'alpha remapper missing from the pack'; return; }
      const ribbon = r.kind === 'ribbon';
      const [tex, atlas, remap] = await Promise.all([
        this._texture(r.diffuse, from, token, warn),
        this._atlas(r.atlas, from, token, warn),
        r.alphaRemap ? this._texture(r.alphaRemap, from, token, warn) : null,
      ]);
      // a missing remapper means no remapping; white would make every texel opaque
      r._tex = tex || this.renderer.placeholder;
      r._atlas = atlas;
      r._remap = remap;
      r._kind = blendKind(r.material, ribbon);
      // a _Soft material fades where it meets opaque geometry; Trove's ribbon shaders never read depth
      r._soft = !ribbon && /_Soft/i.test(r.material) ? Math.max(r.softness, 1e-3) : 0;
    } else if (r.kind === 'mesh') {
      if (r.mesh && absent(r.mesh)) { r._skip = 'mesh missing from the pack'; return; }
      const [geom, tex] = await Promise.all([this._mesh(r.mesh, r.subMesh, from, token, warn), this._texture(r.diffuse, from, token, warn)]);
      if (geom && geom.empty) { r._skip = 'mesh has no geometry'; return; }
      r._geom = geom;
      r._tex = tex || this.renderer.white;   // untextured meshes draw their colour, as an unbound slot does
      r._lit = !/Additive/i.test(r.material);
      r._kind = r._lit ? 0 : 1;
    } else if (r.cls) unsupported.add(r.cls);
  }

  /* AnimTrack samplers hold a motion path that lives in a separate .pkan, so they
     are inert until it is read and parsed. The same sampler can be shared by several
     layers through the effect's global sampler list, so load each one once. */
  async _loadAnimTracks(effect, from) {
    const seen = new Set();
    const jobs = [];
    for (const layer of effect.layers) {
      for (const s of Object.values(layer.samplers)) {
        if (!(s instanceof AnimTrackSampler) || seen.has(s)) continue;
        seen.add(s);
        const ref = s.resourceRef();
        if (!ref) continue;
        jobs.push(this.pack.text(ref, from).then((text) => { if (text) s.load(parsePkfx(text)); }).catch(() => {}));
      }
    }
    await Promise.all(jobs);
  }

  // MESH shapes (inside collections too) sample a .pkmm submesh, so they need its data on
  // the CPU; without it they have no surface to spawn on.
  async _loadShapeMeshes(effect, from, token, warn) {
    const shapes = new Set();
    const visit = (s) => {
      if (!(s instanceof ShapeSampler) || shapes.has(s)) return;
      shapes.add(s);
      for (const sub of s.subs || []) visit(sub);
    };
    for (const layer of effect.layers) for (const s of Object.values(layer.samplers)) visit(s);
    const jobs = [];
    for (const s of shapes) {
      const ref = s.meshResourceRef();
      if (!ref) continue;
      jobs.push(this._asset('meshdata', ref, from, token, warn, async (blob) => decodePkmm(await blob.arrayBuffer()))
        .then((m) => { if (m) s.loadMesh(m); }));
    }
    await Promise.all(jobs);
  }

  // Decoded assets are cached by resolved file, so one texture named two ways decodes once.
  async _asset(kind, ref, from, token, warn, decode) {
    const hit = this.pack.resolve(ref, from);
    if (!hit) return null;
    const key = `${kind}:${hit.entry.path.toLowerCase()}`;
    let slot = this._assets.get(key);
    if (!slot) {
      slot = { kind, used: token, promise: null };
      slot.promise = hit.entry.blob()
        .then(decode)
        .then((value) => ({ value, error: null }), (e) => ({ value: null, error: e && e.message ? e.message : String(e) }));
      this._assets.set(key, slot);
    }
    slot.used = token;
    const { value, error } = await slot.promise;
    if (error) warn(`${ref}: ${error}`);
    return value;
  }

  // null when the texture is missing or unreadable; callers choose the stand-in
  async _texture(ref, from, token, warn) {
    if (!ref) return null;
    const gl = this.renderer.gl;
    return this._asset('tex', ref, from, token, warn, async (blob) => {
      if (/\.dds$/i.test(ref)) {
        return makeLevelsTexture(gl, decodeDDS(await blob.arrayBuffer()).levels);
      }
      const image = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
      try { return makeImageTexture(gl, image); } finally { image.close(); }
    });
  }

  async _atlas(ref, from, token, warn) {
    if (!ref) return null;
    const rects = await this._asset('atlas', ref, from, token, warn, async (blob) => parseAtlas(await blob.text()));
    return rects && rects.length ? rects : null;
  }

  // .pkmm -> uploaded geometry, {empty} for a mesh with no submesh; null draws the cube proxy
  async _mesh(ref, sub, from, token, warn) {
    if (!ref || !/\.pkmm$/i.test(ref)) return null;
    return this._asset(sub >= 0 ? `mesh${sub}` : 'mesh', ref, from, token, warn, async (blob) => {
      const mesh = decodePkmm(await blob.arrayBuffer());
      if (!mesh) throw new Error('mesh layout not recognized; drawn as a cube');
      // SubMeshId picks one submesh; one the file lacks leaves nothing to draw
      const part = sub >= 0 ? mesh.blocks[sub] : mesh;
      return !part || mesh.empty ? { empty: true } : this.renderer.makeMeshGeometry(part);
    });
  }

  _releaseAssets(shouldRelease) {
    for (const [key, slot] of this._assets) {
      if (!shouldRelease(slot)) continue;
      this._assets.delete(key);
      slot.promise.then(({ value }) => {
        if (!value) return;
        if (slot.kind === 'tex') this.renderer.deleteTexture(value);
        else if (/^mesh\d*$/.test(slot.kind)) this.renderer.deleteMeshGeometry(value);
      });
    }
  }

  // ---- frame loop ----

  _frame = (now) => {
    // real elapsed time, so the effect plays at game speed on any refresh rate; capped
    // so a backgrounded tab does not jump ahead when it comes back
    const dt = this._lastT && now > this._lastT ? Math.min((now - this._lastT) / 1000, 0.25) : STEP;
    this._lastT = now;
    this.stats.fps = this.stats.fps ? this.stats.fps * 0.9 + (1 / Math.max(dt, 1e-3)) * 0.1 : 60;
    if (this.playing) this._simulate(Math.min(dt, MAX_STEP) * this.speed);
    this._draw();
    this._raf = requestAnimationFrame(this._frame);
  };

  _simulate(dt) {
    const sys = this.system;
    if (!sys) return;
    const n = Math.max(1, Math.ceil(dt / MAX_STEP - 1e-9));
    for (let k = 0; k < n; k++) {
      sys.camPos = this.renderer.eyePosition();
      sys.camTarget = this.renderer.cam.target;
      try { sys.update(dt / n); } catch (e) {
        if (!this._simError) { this._simError = true; this.report?.diagnostics.push(`simulation error: ${e.message}`); }
      }
    }
    this._autofit.t += dt;
  }

  _draw() {
    const renderer = this.renderer, sys = this.system, fit = this._autofit;
    const measuring = fit.t < MEASURE_SECONDS;
    const eye = renderer.eyePosition();
    const t = renderer.cam.target, vl = Math.hypot(t[0] - eye[0], t[1] - eye[1], t[2] - eye[2]) || 1;
    const viewDir = [(t[0] - eye[0]) / vl, (t[1] - eye[1]) / vl, (t[2] - eye[2]) / vl];
    const items = [];
    let alive = 0, maxR2 = 0, minY = Infinity, maxY = -Infinity;
    const layers = [];
    if (sys) {
      for (const ls of sys.layers) {
        alive += ls.count;
        layers.push(ls.count);
        if (measuring) {
          for (let i = 0; i < ls.count; i++) {
            const p = ls.getAt(i, 'Position');
            if (p[1] < minY && isFinite(p[1])) minY = p[1];
            if (p[1] > maxY && isFinite(p[1])) maxY = p[1];
            const r2 = p[0] * p[0] + p[1] * p[1] + p[2] * p[2]; if (r2 > maxR2 && isFinite(r2)) maxR2 = r2;
          }
        }
        for (const r of ls.L.renderers) {
          if (r._skip) continue;
          if (r.kind === 'billboard') this.packer.billboards(ls, r, eye, viewDir, items);
          else if (r.kind === 'ribbon') this.packer.ribbon(ls, r, eye, items);
          else if (r.kind === 'mesh') this.packer.mesh(ls, r, items);
        }
      }
    }
    this.stats.alive = alive;
    this.stats.layers = layers;

    if (alive && measuring) {
      fit.scale = Math.max(fit.scale, Math.sqrt(maxR2));
      fit.y1 = Math.max(fit.y1 ?? -Infinity, maxY);
      fit.floor = Math.min(fit.floor ?? Infinity, minY);
    }
    /* Framing: during the opening window only, ease toward the middle of the measured
       height range and a distance from the measured extent, then hold still. Following
       the live particles after that made the view bob as sparks rose and fell. */
    if (fit.active && measuring && fit.scale > 0 && isFinite(fit.floor) && isFinite(fit.y1)) {
      renderer.cam.dist += (clamp(fit.scale * 2.2 + 0.6, 2, 60) - renderer.cam.dist) * 0.15;
      renderer.cam.target[1] += ((fit.floor + fit.y1) / 2 - renderer.cam.target[1]) * 0.15;
    }

    /* No ground by default: an effect is authored to be seen against the game world,
       not against a slab we invent. When shown, it sits where the simulation's stand-in
       floor is, so bouncing particles land on it and soft particles fade into it. */
    if (this.ground) {
      const e = sys ? sys.emitter : [0, 0, 0];
      renderer.ground = { centre: [e[0], 0, e[2]], y: e[1] - FLOOR_DROP, size: Math.max(fit.scale * 3, 8) };
    } else renderer.ground = null;

    renderer.draw(mergeMediums(items));
  }

  // ---- controls: drag orbits, shift/right-drag moves the emitter, wheel/pinch zooms ----

  _bindControls(signal) {
    const canvas = this.canvas;
    const pointers = new Map();
    let mode = 0, pinch = 0;
    const pinchDistance = () => {
      const [a, b] = [...pointers.values()];
      return Math.hypot(a[0] - b[0], a[1] - b[1]);
    };
    const zoom = (factor) => {
      this._autofit.active = false;
      this.renderer.cam.dist = clamp(this.renderer.cam.dist * factor, 0.3, 120);
    };
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, [e.clientX, e.clientY]);
      mode = e.shiftKey || e.button === 2 ? MOVE : ORBIT;
      this._autofit.active = false;
      if (pointers.size === 2) pinch = pinchDistance();
    }, { signal });
    canvas.addEventListener('pointermove', (e) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      const dx = e.clientX - prev[0], dy = e.clientY - prev[1];
      pointers.set(e.pointerId, [e.clientX, e.clientY]);
      if (pointers.size >= 2) {
        const d = pinchDistance();
        if (pinch > 0 && d > 0) zoom(pinch / d);
        pinch = d;
        return;
      }
      const cam = this.renderer.cam;
      if (mode === MOVE) {
        if (!this.system) return;
        // screen delta -> world delta across the camera plane (about 1:1 at the orbit target)
        const k = 2 * cam.dist * Math.tan(Math.PI / 6) / Math.max(canvas.clientHeight, 1);
        const right = [Math.cos(cam.az), 0, -Math.sin(cam.az)];
        const up = [-Math.sin(cam.el) * Math.sin(cam.az), Math.cos(cam.el), -Math.sin(cam.el) * Math.cos(cam.az)];
        for (let a = 0; a < 3; a++) this.system.emitter[a] += (right[a] * dx - up[a] * dy) * k;
        return;
      }
      cam.az -= dx * 0.01;
      cam.el = clamp(cam.el + dy * 0.01, -1.5, 1.5);
    }, { signal });
    const release = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = 0;
    };
    canvas.addEventListener('pointerup', release, { signal });
    canvas.addEventListener('pointercancel', release, { signal });
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoom(1 + Math.sign(e.deltaY) * 0.1); }, { signal, passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault(), { signal });   // right-drag is a control
  }
}

function collectUnsupported(evolvers, out) {
  for (const ev of evolvers) {
    if (ev.type === 'unsupported' && ev.cls) out.add(ev.cls);
    if (ev.children) collectUnsupported(ev.children, out);
  }
}
