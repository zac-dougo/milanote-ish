# Milanote-ish

A local Mac app for storyboarding and collecting references on freeform boards.

Built with Tauri, React, TypeScript, and SQLite. The interface uses a colour-block design. No accounts, cloud dependency, or subscription limits.

## Current build

The current build supports freely positioned main and nested boards, breadcrumbs, freely positioned cards, stacked headings, formatted text, quotes, links, checklists, images, and copied file attachments, block reordering, card colours, saved front/back ordering, width resizing, canvas pan/zoom, connectors between cards and nested-board tiles, image picker/drop/paste, recoverable card and board-subtree deletion through Trash, and automatic SQLite saving. Imported originals and thumbnails live in the local library.

The planned v1 editing features are implemented, including multi-selection, independent duplication, cross-board moves, session undo/redo, permanent deletion, and whole-library backup/restore. Hands-on interaction, larger-board performance, and wider macOS compatibility still need testing. Drawing and plugins remain outside v1.

## Run locally

Requires Node.js 24 or newer, Rust, and macOS command-line developer tools.

```sh
npm ci
npm run tauri -- dev
```

Create a board, name it, then add content from the left rail. The Board tool creates a child inside the current board, or a main board on Home. Use breadcrumbs to return to a parent. Boards appear as compact coloured icons with a name and item count. Drag their icon and open them with double-click, Return, or Open. The labelled Board path at the top shows Home and each parent. Drag a card using its top strip. Select it to add/reorder content, change colour, or delete it. The Mac Delete key also removes a selected card; Trash restores it. Resize its width with the lower-right handle. Scroll to pan, pinch to zoom, or use the header controls. Double-click an image for its original-size preview.

Select an item and drag its round connector handle onto another card or board tile. The Connector tool also offers source/target pickers. Select a line to change its endpoints, arrow, or colour, or delete it. Lines follow movement and resizing; Trash restores deleted lines when both endpoints are available.

Text blocks have bold, italic, underline, strikethrough, lists, and HTTP/HTTPS hyperlinks. Select text and use the formatting controls. Cmd-click a text hyperlink to open it. Formatted paste keeps the supported formatting subset. Link cards have an explicit Open link button, optional title, and editable URL. Quote attribution is optional. Checklist Return adds the next item; arrows reorder items. File imports copy the source into the library, then offer Open file and Show in Finder. Finder drops add supported images inline and other files as attachments. Any selected card can combine these blocks.

Shift-click toggles selection, drag empty canvas space to select a group, and Cmd-A selects every item on the canvas. Drag a selected grip/icon or use arrow keys to move the group; Shift-arrow moves by ten units. The selection strip provides Duplicate, Move to, and Delete selected. Cmd-D duplicates. Cmd-C/Cmd-V copy and paste independent items, including board subtrees and connectors internal to the copied group. Cards need a destination board; board icons can move to Home. Connections to items left behind go to Trash when a group moves to another board.

Cmd-Z and Shift-Cmd-Z undo/redo across boards. The session holds up to 100 actions, combines a typing burst, and treats a group drag, resize, import, move, or deletion as one action. Navigation and zoom do not enter history. Escape finishes text editing or cancels a canvas gesture. Toolbar presets can be dragged onto the canvas; blocks can be reordered by their grip or arrow buttons. Right-click an item for front/back ordering. A card's Paste image action lets the next Cmd-V append an image to that card explicitly.

Backup writes one `.milanote` archive containing a versioned manifest, structured metadata, original asset bytes, hashes, and Trash. Thumbnails are rebuilt on restore. Restore validates before showing counts and requesting replacement confirmation, then creates a recovery archive beside the active library. The replaced directory is retained as another recovery copy. The archive uses the app's own uncompressed format; it is not a ZIP file. Backups need space for all originals, and restore needs space for staging plus the recovery copy. Native library commands are serialized during replacement.

Trash restores items, and Delete permanently/Empty Trash ask for confirmation. Permanent deletion also clears session history and copied-item state, then reclaims only assets with no remaining live/Trash references. Opening a file or showing it in Finder creates a temporary copy with its original filename, preserving the immutable library original.

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
