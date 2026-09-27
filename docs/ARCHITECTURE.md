# Architecture

PopcornFX-Web turns a `.pkfx` file into moving pixels in five stages. Every stage is plain ES modules with no runtime dependencies. Everything below `src/viewer/` runs in Node, which is how the tests and the corpus check work.

```
.pkfx text ──parse──▶ document ──build──▶ effect ──simulate──▶ live particles ──pack──▶ draw items ──render──▶ WebGL 2
             engine/parser   engine/model        engine/sim              render/packer          render/renderer
```

## Source layout

| Path | Role |
| --- | --- |
| `src/engine/parser.js` | Tokenizes the PopcornFX v1 text serialization into objects keyed by `$LOCAL$/id`. Values stay lossless: numbers (including MSVC `1.#INF` forms), strings, symbols, constructors like `float3(…)`, and lists. |
| `src/engine/model.js` | Normalizes the object graph into an effect: layers with their fields, samplers, compiled scripts, evolver pipeline, spawn specs, events and renderers. Serialization omits default values, so this is where defaults live. |
| `src/engine/script.js` | Compiler and interpreter for the particle script language (HLSL-like, 1 to 4 component vectors, int and float semantics). |
| `src/engine/curves.js` | Curve, double-curve, shape, turbulence and animation-track samplers. |
| `src/engine/turbulence.js` | The engine's procedural noise, with its SFMT seeding and float32 operation order. |
| `src/engine/sim.js` | CPU simulation. One struct-of-arrays buffer per layer, spawning (bursts, streams, flux curves, events, trails), then the evolver pipeline each frame. |
| `src/formats/` | Decoders for DDS textures (BC1/2/3/7 and uncompressed), `.pkmm` meshes and `.pkat` atlases, plus asset-reference extraction. |
| `src/render/packer.js` | Converts live particles into instance buffers per renderer: billboard corners and UVs, ribbon strips, mesh bases. It also owns draw sorting. |
| `src/render/renderer.js` | WebGL 2 programs for billboards, ribbons, meshes and the optional ground, plus the blend state for each material kind. |
| `src/io/pack.js` | The file set an effect reads from, and the lookup rules for references. |
| `src/io/sources.js` | Builds a pack from a folder or file input, drag and drop, a `.zip`, or a URL. |
| `src/io/bundle.js` | Collects an effect and its dependencies (following child effects) into a standalone bundle. |
| `src/formats/zip.js` | ZIP reading and writing on the platform's deflate streams, shared by the app and the CLI. |
| `src/viewer/viewer.js` | Ties it together: loads an effect and its assets, runs the frame loop, handles camera controls and produces the inspector report. |
| `src/app/` | The application UI: effect list, inspector, transport controls, demo. |
| `src/version.js` | The targeted PopcornFX release and version-header comparison. |

## Asset resolution

A reference such as `Textures/fx_glow.dds` is resolved against the pack root of the effect that names it. The pack root is the nearest folder above the effect that contains `popcornproject.xml`. `Pack.resolve()` tries, in order:

1. `<pack root>/<ref>`, reported as `pack`
2. `<ref>` from the top of the opened files, reported as `path`
3. any file with the same name, reported as `name` (how loose files and mod bundles resolve)

All matching ignores case, like the Windows filesystem the editor and games run on. Trove's own effects depend on this; for example, `VFX_circle_10.dds` ships as `vfx_circle_10.dds`. The inspector shows which rule matched each asset, and `name` matches are flagged because they might pick the wrong file.

A bundle stores each dependency at the path the effect writes, not where it was found, so every reference in a bundle resolves by the `pack` rule. Its `pkfx-bundle.json` names the effect to open first.

A missing sprite texture draws as a soft dot rather than white, so a partial effect still reads; the inspector lists what is missing. A missing alpha remapper means no remapping.

Decoded textures, atlases and meshes are cached by resolved file, so an asset shared by several effects decodes once. When the cache passes 256 entries, assets the current effect doesn't use are released from the GPU.

## Fidelity

The goal is to match the game, not to look nice. Behaviours were reverse-engineered from the PopcornFX 1.13.5 runtime (`HH-Bridge_r.dll`) and from the particle shaders Trove compiles into its executable. Comments cite the function or shader behind each rule where it isn't obvious. A few consequences that look like bugs but aren't:

- Vertex colours saturate to 0..1 before drawing, because the engine packs them into RGBA8.
- A billboard without a diffuse texture draws nothing, because the game would show a debug sprite it never ships.
- Additive materials are unsorted, and alpha-blended ones sort back to front, following the engine's render-list keys.
- `Additive_NoAlpha` ignores texture alpha entirely.

When changing behaviour, cite the source (a decompiled function, a shader, or an editor comparison) next to the change, and run `npm run corpus` against a real pack to catch regressions across thousands of effects.

## Adding support for something

- **A new evolver:** add a case in `addEvolver` (`model.js`) that produces a spec, then a matching case in `LayerSim.runEvolver` (`sim.js`). Until then, unknown evolvers are recorded as `unsupported`, and the inspector lists them.
- **A new renderer:** extend `collectRenderers` (`model.js`) and `declareRendererFields`, add a packing method to `FramePacker`, and teach `Renderer.draw` the new item type.
- **A new texture format:** extend `decodeDDS`, or branch on the extension in `Viewer._texture`.
- **Another PopcornFX major version:** create a new branch named after that release. Version 2 is a different format, and this branch stays faithful to 1.13.5.
