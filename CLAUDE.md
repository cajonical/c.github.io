# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

A single-file (`index.html`, ~4378 lines) image and video comparison web app served via GitHub Pages and used on iOS mobile. There is no build system, no package manager, and no compilation step — editing and pushing to `master` deploys immediately.

## Deployment

```bash
git add index.html
git commit -m "..."
git push origin master
```

The live site is served directly from `index.html` by GitHub Pages.

## Architecture

Everything lives in one file in three sections:

1. **CSS** (lines ~22–880) — all styles inlined, including dark-mode variables and view-specific layout rules.
2. **Bundled third-party libraries** (lines ~880–2320, inlined as `<script>` blocks):
   - **UTIF** — TIFF decoder
   - **pako** — zlib/inflate (used by UTIF and JSZip)
   - **heic2any** — HEIC/HEIF → PNG converter
   - **JSZip** — ZIP extraction (used for iOS folder-as-zip workflow)
3. **Application code** (lines ~2320–4378) — vanilla JS, no framework.

### Application state

The core state lives in `slots[]` (up to 4 entries, one per panel). Each slot holds `{ panel, img, video, fileInput, file, name, res, size, type, upscale, mediaType, duration, sourceUrl, labelInput }`. Global scalars: `view`, `imageCount`, `mediaMode`, `fitScale`, `folderSides[2]`, `folderPairs[]`, `currentPairIdx`.

### View system

CSS classes on `.compare-box` drive layout: `view-split`, `view-slider`, `view-slider-v`, `view-peek`, `view-horizontal`, `view-vertical`, `view-mix`. CSS custom properties `--slider-pct`, `--slider-pct-v`, `--img-scale`, `--img-tx`, `--img-ty` on `.compare-box` control the slider position and pan/zoom transform applied to all panels simultaneously.

### Key sections (by line comment)

| Section | Approx. line |
|---|---|
| State / slot init | 2346 |
| Media loading (`addMedia`, `loadMediaFromUrl`) | 2418 |
| Mode & panel visibility (`updateMode`) | 2670 |
| View switching (`setView`) | 2700 |
| Media sizing (`sizeImages`) | 2726 |
| Image quality metrics (PSNR / SSIM) | 2859 |
| Snapshot | 2982 |
| Folder comparison | 3641 |
| ZIP extraction (iOS workflow) | 3730 |
| Touch / pinch-to-zoom | 3483 |
| Video sync engine | 4096 |
| Keyboard shortcuts | 4218 |
| Electron integration | 4281 |
| Auto-load default folders on startup | 4306 |
| Screen recording | 4492 |
| Auth0 / profile modal | 4219 |

### iOS / mobile notes

- The app targets iOS Safari via `user-scalable=no` and `100dvh`.
- Folder comparison on iOS uses the ZIP workaround: zip a folder, then drop/select the `.zip` file (handled by the JSZip section at line ~3730).
- Touch events handle single-finger pan and two-finger pinch-zoom; Safari trackpad gestures use `gesturestart/change/end`.

### Default folders (auto-load on startup)

`DEFAULT_FOLDERS` at line ~2346 sets paths for the left and right panels to pre-populate on load. Set entries to `''` to disable. These paths are resolved via `file://` fetch (works in Electron; no-op in a plain browser).

### External API endpoints

`/api/config` is fetched on startup to retrieve Auth0 configuration. This is the only remaining backend dependency — not part of this repo. In a plain GitHub Pages context it will 404 (auth is silently skipped).
