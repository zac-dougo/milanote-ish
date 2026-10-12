# Milanote-ish

A local Mac app for storyboarding and collecting references on freeform boards.

Built with Tauri, React, TypeScript, and SQLite. The interface uses a colour-block design. No accounts, cloud dependency, or subscription limits.

## Working slice

The current build supports freely positioned main and nested boards, breadcrumbs, freely positioned cards, stacked headings/text/images, block reordering, card colours, saved front/back ordering, width resizing, canvas pan/zoom, connectors between cards and nested-board tiles, image picker/drop/paste, recoverable card and board-subtree deletion through Trash, and automatic SQLite saving. Imported originals and thumbnails live in the local library.

Rich text, quotes, links, checklists, file cards, undo/redo, and backup/restore are specified but not yet implemented. This build is for trying the interaction and desktop stack, not storing important work yet.

## Run locally

Requires Node.js 24 or newer, Rust, and macOS command-line developer tools.

```sh
npm ci
npm run tauri -- dev
```

Create a board, name it, then add text or images from the left rail. The Board tool creates a child inside the current board, or a main board on Home. Use breadcrumbs to return to a parent. Board tiles move by their top strip and open with double-click, Return, or Open. Drag a card using its top strip. Select it to add/reorder content, change colour, or delete it. The Mac Delete key also removes a selected card; Trash restores it. Resize its width with the lower-right handle. Scroll to pan, pinch to zoom, or use the header controls. Double-click an image for its original-size preview.

Select an item and drag its round connector handle onto another card or board tile. The Connector tool also offers source/target pickers. Select a line to change its endpoints, arrow, or colour, or delete it. Lines follow movement and resizing; Trash restores deleted lines when both endpoints are available.

The last canvas and its view reopen with the desktop app. Older working-build libraries migrate automatically, with a recovery SQLite copy kept beside the library before migration.

The desktop app saves in `~/Library/Application Support/com.zacdougo.milanoteish/`. The browser-only preview from `npm run dev` is temporary and never writes a library.

## Build and check

```sh
npm run build
npm run test
npm run format:check
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
npm run tauri -- build --bundles app
```

The local Apple Silicon build is produced at `src-tauri/target/release/bundle/macos/Milanote-ish.app`. It uses ad-hoc signing for local use, not Developer ID signing or notarisation for public distribution. Minimum declared macOS version is 13; compatibility is initially tested on the development Mac only.

## Project documents

- [Implementation specification](docs/v1-spec.md)
- [Scope and decisions](docs/product-scope.md)
- [Domain glossary](CONTEXT.md)

User-supplied visual references are kept locally and excluded from the public repository.

See the implementation specification for the full v1 scope and [the measured working-slice report](docs/working-slice-report.md) for verification results when available.
