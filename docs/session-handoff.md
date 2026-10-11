# Session handoff

Updated: 12 October 2026, Australia/Melbourne.

The user is finishing for now. Stop implementation and verification after saving this checkpoint. Resume from these notes when requested.

## Repository

- Public GitHub repository: https://github.com/zac-dougo/milanote-ish
- Local checkout: `/Users/zacdouglas/Documents/ChatGPT/milanote-ish`
- Default branch: `main`, containing the initial specification.
- Working branch: `codex/working-slice`, containing the initial app.
- User reference screenshots remain local in `docs/references/`, excluded from Git. Automatic approval review rejected publishing their potentially private board content; the public initial commit was amended before its first push to exclude them.

## Confirmed direction

Use [v1-spec.md](v1-spec.md) and [product-scope.md](product-scope.md) for requirements, and [../CONTEXT.md](../CONTEXT.md) for terminology.

- Mac-only, local/offline, no accounts or subscription quotas.
- Lightweight operation is a priority. Stack confirmed as Tauri + React/TypeScript + custom CSS + SQLite.
- Colour-block design with solid surfaces, restrained borders, and compact controls. User screenshots guide interactions, not every feature or exact styling.
- Free placement of cards. Mixed-content cards with reorderable stacks and multiple images/links.
- Main boards and single-parent nested boards, opened full canvas with breadcrumbs.
- Images, text, quotes, links, checklists, files, and connectors in full v1.
- Copy imported images and save automatically to a local library.
- Start fresh; no Milanote migration. Drawing, plugins, advanced layouts, and automatic link previews are outside v1.

## Implemented working slice

- Tauri 2 desktop shell; React/TypeScript/Vite frontend; Rust host and bundled SQLite.
- Colour-block Home, tool rail, header, editable board title, save status, and zoom controls.
- Create and open main boards. Home currently uses a tile grid, not a free-placement canvas.
- Text and image cards; add heading/text/image blocks, reorder/remove blocks, change card colours.
- Drag cards by their grip; width resizing with content-driven height; keyboard width resizing and positioning.
- Canvas scroll/pan, zoom controls and wheel/pinch handling, Fit content.
- Native image picker, file-drop handler, and clipboard image/text handlers. PNG/JPEG/WebP/GIF support; full-image preview on double-click.
- Copy originals into library-owned assets, generate local thumbnails off the UI thread, and use thumbnails on the canvas.
- SQLite saves individual cards and board metadata, plus board camera state. Foreign ownership, invalid asset paths, and missing images are rejected.
- Autosave queue coalesces edits per item, preserves edits arriving during a save, and retains failed writes for retry. Blur, window close, and native Cmd-Q flush saves.
- Recoverable card deletion via a visible Delete card button and Delete/Backspace outside text editing. Trash restores cards. Deletion state is persisted; permanent deletion is not implemented.
- Single-instance desktop plugin to avoid concurrent writers.
- Locally signed Apple Silicon release `.app`; no Developer ID signing or notarisation. Declared minimum macOS 13; only the development Mac has been exercised.

The user reported that notes could not be deleted while trying the preview. Deletion controls and keyboard handling were added during this session and directly verified. Selecting a grip transfers keyboard focus away from text editing, so Delete removes the selected card rather than text in a previously focused textarea.

## Verification completed

- `npm run build`: TypeScript and production frontend build passed.
- `npm run test`: all five save-queue tests passed, including empty flush, concurrent edit, failed retry, typing coalescing, and synchronous failure.
- `npm run format:check`: passed.
- `cargo test --manifest-path src-tauri/Cargo.toml`: all four tests passed, covering save/reopen and persisted deletion, ownership, asset validation/copy/thumbnails, and newer-library rejection.
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`: passed after the deletion change.
- `npm run tauri -- build --bundles app`: release bundle built and ad-hoc signing succeeded. Bundle reported approximately 7.60 MiB.
- Browser UI: board/card creation, text editing, combined heading/text content, delete button, Delete key, and Trash restoration verified.
- Native UI: created `Working slice` board; entered instructional text; changed a card to yellow; dragged it; imported the synthetic app-icon image into that card; reordered the image/text blocks; resized width from 320 to 340 with keyboard; deleted the card and observed it in Trash.
- Native Cmd-Q exited the app, confirmed by absence of its process. The test card was in Trash at quit.

Do not claim all v1 acceptance criteria pass. The browser preview is intentionally ephemeral and may reset during hot reload; it is not the saved desktop library.

## Local artifacts and runtime

- Release app: `src-tauri/target/release/bundle/macos/Milanote-ish.app`
- Desktop library: `~/Library/Application Support/com.zacdougo.milanoteish/`
- Library contains `library.sqlite3` and copied originals/thumbnails in `assets/`.
- Development dependencies are installed. Rust compilation caches are large and ignored; they are not part of the 7.60 MiB app.
- Native app was quit during verification. The local Vite preview server is stopped during session cleanup.
- Node 26.9.0 and Rust 1.98.1 were available. Project requires Node 24+; native desktop build succeeded using command-line developer tools without a full Xcode installation.

## Next session

1. Launch the release app and finish the persistence UI check: open `Working slice`, confirm its deleted card remains in Trash, restore it, and verify text, image, width, and position after another quit/reopen. Preserve any new user content.
2. Verify actual native clipboard image paste, Finder drag/drop, mouse resizing, trackpad pinch, and normal window close. Handlers exist, but these exact native paths were not all exercised.
3. Measure release idle CPU and total memory including correctly attributed WebKit helpers, then a representative image-heavy board. Only installed bundle size is established; there is no aggregate memory or frame-rate result yet.
4. If reading the SQLite file directly, avoid implying a failed read means missing data. A sandboxed Python read-only connection returned `unable to open database file`, while file inventory confirmed the database and assets existed. Investigate sandbox/WAL handling or use the app's load path; do not replace or reset the library.
5. Address any observed defects before expanding scope. Full v1 still needs nested/free-placement board tiles, connectors, quote/link/checklist/file blocks, basic rich-text formatting, multi-selection/duplication/moves, undo/redo, board/subtree recovery, backup/restore, and the full performance/recovery checks.

No app implementation should be called complete v1 yet. The user authorised a small working version, and this checkpoint provides that first slice.
