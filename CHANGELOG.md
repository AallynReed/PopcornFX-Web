# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

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
