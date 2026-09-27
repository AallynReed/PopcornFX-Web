# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [0.3.0] - 2026-09-27

A fidelity pass against the PopcornFX 1.13.5 engine and Trove's renderer, checked with the engine's own script compiler.

### Added

- Mesh-shaped emitters sample the mesh surface instead of a sphere (the neon ninja decoy, the tombraiser skeleton).
- The `Containment` evolver, the last engine evolver the port lacked.
- Spawner layer scripts (`Flux`), spawn-script `PostEval` (portal label digits), `LocalSpaceSpawn` trails, trigger orientation axes, and emitter velocity inheritance for root layers.
- `AlphaBlend_Distortion` draws the faint additive glow Trove draws instead of nothing.
- Mesh `SubMeshId`, script `Shape.intersect()`, and textures' own DDS mip levels.

### Changed

- Vertex colours are no longer clamped to 0..1: Trove passes them unclamped, so glows above 1 are as bright as in game.
- Alpha-blended billboards sharing a draw order, material and textures sort together, as one batch, along the view axis.
- Effects opened from their pack draw nothing for a missing texture, alpha remapper or mesh, as in game. Loose files keep the stand-ins.
- Scripts the engine cannot compile (a name the layer lacks, a stray `}`) no longer run, and files holding values the engine cannot read are cut short where the engine stops.

### Fixed

- Ribbon textures were flipped across their width (the bard crowd drew upside down), planar billboards were upside down and ignored the length of `Axis2`, and spheroidal billboards were mirrored.
- Rotated non-square screen and viewpos sprites sheared instead of turning; viewpos sprites without a rotation field had width and height swapped.
- FlipBooks with an empty cursor animated instead of holding their random frame.
- WithRandomChilds events spawned every alternative; folder random delays were rolled per child.
- Physics integration for attractor layers and constant-drag layers, collision death timing, localspace for root layers, mesh orientation with zero axis components, and mesh static offsets.
- An empty mesh file drew an opaque cube inside 14 portal effects.
- A script with a stray `;` inside a call was dropped although the engine compiles it.

## [0.2.0] - 2026-09-27

### Added

- Effect bundles: **Download bundle** (`B`) and `npm run bundle` save an effect with everything it references as one `.zip` that opens anywhere.
- Opening `.zip` bundles by drop, file picker, or `?pack=<url>.zip`.
- Files added while an effect is open now join the open set, and the inspector offers **Add folder** and **Add files** when assets are missing.

### Fixed

- **Open pack folder** did nothing in Chrome and Edge for folders under `Program Files`, where Trove installs, because their File System Access picker refuses those folders. It now uses the standard folder dialog.
- A missing texture drew as a hard white square; sprites now fall back to a soft dot, and a missing alpha remapper no longer makes every texel opaque.

## [0.1.0] - 2026-09-27

### Added

- A standalone viewer for PopcornFX 1.13.5 effects: the parser, simulation and WebGL 2 renderer from the KiwiAPI VFX preview, extracted into their own project.
- Opening packs from a folder, individual files, drag and drop, or a hosted URL (`?pack=`), with PopcornFX's pack-root reference resolution.
- A virtualized, filterable effect browser with editor thumbnails and keyboard navigation.
- An inspector covering the version header, layers with live counts, asset resolution, and unreproduced features and script diagnostics.
- Playback controls: pause, step, restart, speed, ground plane, camera reset and PNG export.
- A built-in demo effect with textures generated at runtime.
- A corpus check (`npm run corpus`) and pack indexer (`npm run index-pack`).
