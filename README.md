# PopcornFX-Web

Play PopcornFX 1.13.5 particle effects (`.pkfx`) in the browser. Open a pack folder or drop effect files, and the viewer parses, simulates and renders them with WebGL 2. You don't need the editor, and nothing gets uploaded.

The engine reproduces how effects look in games built on PopcornFX 1.13, down to blend modes, billboarding and turbulence noise, and was checked against the 9,382 effects that ship with Trove. It started as the VFX preview in [KiwiAPI](https://github.com/AallynReed/KiwiAPI) and is now a standalone app.

## Branches and PopcornFX versions

Each branch targets one PopcornFX release and is named after it. This branch, `1.13.5`, targets PopcornFX **1.13.5**, the editor build (1.13.5.65444) behind the newest effects Trove ships.

| Effect saved by | Result |
| --- | --- |
| PopcornFX 1.13.x | Plays. This is the targeted format. |
| PopcornFX 1.8 to 1.12 | Plays. The v1 text format is forward compatible, and Trove still ships effects from 1.8.2 onward. |
| PopcornFX 2.x | Not supported on this branch. The inspector flags these files. |

Every file names its editor build in its `Version = …;` header, and the inspector shows how that compares to 1.13.5.

## Features

- **Opens whole packs.** Open the folder that holds `popcornproject.xml` and every effect in it is listed, searchable and playable. References resolve the way PopcornFX resolves them, relative to the pack root and case-insensitive.
- **Opens loose files too.** Drop `.pkfx` files with their textures (for example, a mod) and references fall back to matching by file name.
- **Browses fast.** The effect list is virtualized, shows the editor's thumbnails when the pack has them, and supports `↑`/`↓` to skim effect by effect.
- **Inspector.** Shows the version header, each layer with live particle counts and renderers, how every referenced asset was found (or that it's missing), and anything the preview doesn't reproduce.
- **Playback controls.** Play, pause, step, restart, speed from 0.1× to 4×, an optional ground plane, camera reset and PNG export.
- **Private.** Files are read lazily from your disk and never leave the machine.

## Quick start

```bash
npm ci
npm run dev
```

Open the printed URL, then choose **Open pack folder**, **Open files**, drag files onto the page, or **Try the demo**.

For Trove, extract the game archives with a Trove modding tool and open the `particles/VFX` folder from the extracted files.

### Browse a local pack while developing

Point the dev server at a pack and it opens automatically on every reload:

```bash
echo "PKFX_PACK_DIR=C:/path/to/particles/VFX" > .env.local
npm run dev
```

The folder is served at `/@pack/` by the dev server only; production builds never include it.

### Host a pack

Any static host can serve a pack. Write its file listing, upload the folder, and link to it:

```bash
npm run index-pack -- path/to/pack
```

Then open `…/index.html?pack=<url of the pack folder>`. Add `&effect=Particles/name.pkfx` to open a specific effect. The address bar keeps that parameter up to date, so links can be shared. The pack host must allow cross-origin requests if it's on a different domain.

## Controls

| Input | Action |
| --- | --- |
| Drag | Orbit the camera |
| Shift-drag or right-drag | Move the emitter, so trails stream |
| Scroll or pinch | Zoom |
| `↑` `↓` | Previous or next effect |
| `/` | Filter effects |
| `Space` | Play or pause |
| `.` | Step one frame |
| `R` | Restart the effect |
| `F` | Reset the camera and emitter |
| `G` | Toggle the ground plane |
| `S` | Save the frame as PNG |
| `I` | Toggle the details panel |
| `?` | Show shortcuts |

## What is reproduced

Billboards (screen, viewpos, velocity-axis, spheroidal, capsule and planar modes, atlases, soft animation blending, alpha remapping, soft particles, Trove's `dissolve` user data), ribbons (including `CorrectDeformation`), mesh particles from `.pkmm`, the particle script language, curves and double curves, shape samplers, procedural turbulence (ported from the 1.13 engine, float32 rounding included), animation tracks from `.pkan`, events, trails, localspace, physics with world collisions, attractors, projection, distance limits, spatial layers and flocking.

Not reproduced:

- Decal and sound renderers, and distortion materials (distortion only bends the scene behind it). The inspector lists these per effect.
- Light renderers, which only light scene geometry and draw nothing themselves.
- `.fbx` and `.tga` assets, which the browser cannot decode. A missing mesh draws as a cube and a missing texture as white.
- Engine inputs a standalone preview doesn't have, such as game-driven attributes (their declared defaults are used) and real scene geometry (a stand-in floor sits 1 unit below the emitter).

## Development

| Script | Purpose |
| --- | --- |
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Production build into `dist/`, deployable to any static host |
| `npm test` | Unit tests (Node's built-in runner) |
| `npm run lint` | ESLint |
| `npm run check` | Lint, test and build, as CI does |
| `npm run corpus -- <folder>` | Parse, build and simulate every `.pkfx` under a folder and report failures |
| `npm run index-pack -- <folder>` | Write the `index.json` a hosted pack needs |

Node.js 22.13 or newer is required. Run `npm run corpus` against a real game pack after changing anything in `src/engine/`. On Trove's live pack it currently reports 0 parse, build or simulation failures across 9,382 effects.

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) explains how the pieces fit together.

### Browser support

Current Chrome, Edge, Firefox and Safari. WebGL 2 is required. Chromium browsers use the File System Access API for **Open pack folder**; others fall back to a folder upload dialog, which still reads files locally.

## Trademarks

PopcornFX is a trademark of Persistant Studios, and Trove is a trademark of its owner. This project is not affiliated with or endorsed by either, and it ships none of their content. The demo effect and its textures were made for this project.
