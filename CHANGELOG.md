# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-09-27

### Added

- A standalone viewer for PopcornFX 1.13.5 effects: the parser, simulation and WebGL 2 renderer from the KiwiAPI VFX preview, extracted into their own project.
- Opening packs from a folder, individual files, drag and drop, or a hosted URL (`?pack=`), with PopcornFX's pack-root reference resolution.
- A virtualized, filterable effect browser with editor thumbnails and keyboard navigation.
- An inspector covering the version header, layers with live counts, asset resolution, and unreproduced features and script diagnostics.
- Playback controls: pause, step, restart, speed, ground plane, camera reset and PNG export.
- A built-in demo effect with textures generated at runtime.
- A corpus check (`npm run corpus`) and pack indexer (`npm run index-pack`).
