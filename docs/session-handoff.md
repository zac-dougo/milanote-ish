# Session handoff

Updated: 12 October 2026, Australia/Melbourne.

The user resumed work on 12 October. The updated checkpoint below supersedes the original next-session checklist.

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

## Resumed session, 12 October

The following work is now complete and supersedes the earlier implementation/checklist status.

- Home is now a free canvas of main-board tiles. Boards can contain nested board tiles. Both support dragging, keyboard nudging, title/colour editing, full-canvas opening, and breadcrumbs. The last canvas and its viewport reopen with the app.
- Cards and tiles share saved front/back ordering. New items appear in front; selected items temporarily come forward for editing. Bring to front/Send to back changes saved order.
- Deleting a board hides its subtree without rewriting each descendant's trash flag. Restore recovers its contents, leaving separately trashed items in Trash. Boards whose original parent is unavailable restore to Home. Separately deleted cards can choose a live destination board.
- Schema version 2 adds parent/tile/trash fields, a Home viewport, and session settings. Version-1 libraries get a consistent SQLite recovery copy before transactional migration. Failed migrations preserve old metadata/version; unsupported later schemas are rejected. Ordering fields default to zero for early test records.
- Bulk image imports now spread across four columns instead of piling up at one spot. Imported cards remain freely movable. Quit/close is held while an image import is active; retry quit once copying finishes.
- Seven JS tests and seven Rust tests passed, along with production build, formatting, Rust lint with warnings denied, and final release packaging. Latest `.app` size is 7.63 MiB.
- Native deleted-card restoration, mouse resizing, normal window close, and image clipboard paste were verified. Preview was used only to copy the app's synthetic icon, not personal files.
- Native picker imported 32 generated 1800×1200 PNGs, 29.82 MiB total originals. The resource-test board is now recoverable in Trash to keep Home uncluttered. Recreate images with `python3 scripts/generate-image-fixture.py /tmp/milanote-ish-image-fixture`.
- Real library migration retained both original boards and their 34 cards. A version-1 recovery copy was confirmed beside the database.
- Created `Storyboard` inside `Working slice`, containing `Opening scene` and `A nested board for the storyboard.` Quit/reopen restored the last nested canvas and its breadcrumb path. Deleting/restoring its parent recovered the child and two image cards; the nested text survived. Native Bring to front and tile dragging worked; browser Send to back changed ordering behind an older card.
- First-release physical-memory snapshot with 32 images was 243 MB including attributed WebKit helpers, on Apple M2/8 GB/macOS 27.0. RSS was lower and variable under memory compression. No measured FPS or 500-card result exists. See [working-slice-report.md](working-slice-report.md).

Next after the hierarchy increment was connectors. The connector checkpoint below supersedes that next step. Quote/link/checklist/file blocks and rich text remain next. Multi-selection/moves/duplication, undo/redo, full portable backup/restore, and viewport culling remain outstanding. The migration recovery SQLite file is not a portable full-library backup. Finder drop, explicit native pinch, restore destination edge cases, controlled idle memory, navigation growth, and frame timing still need checks.

Preserve the desktop library. Browser preview remains ephemeral. Do not reset data because a sandboxed direct SQLite read fails. Do not merge the feature branch without the user's request.

## Connector checkpoint, 12 October

- Connectors are implemented between two distinct live cards/board tiles on the same board. Home has no connectors. Straight lines snap to item borders, with target/no arrow and four colours. Lines render behind items with a 16-pixel hit stroke.
- Select an item and drag the round handle beside its top strip, or use the Connector tool's source/target pickers. Select a line to edit its endpoints, colour or arrow, delete it, or drag an endpoint to reconnect. Keyboard Delete/Backspace applies outside editing fields. Escape cancels a connector gesture. Click activation also handles accessibility presses which do not send pointer events.
- `src/connectors.ts` owns geometry and visibility. `src/ConnectorLayer.tsx` watches item geometry with ResizeObserver/MutationObserver and batches changed-node reads into animation frames. Existing item drag code still changes only its DOM node during a gesture. Handles sit above selected items and away from block controls. The connector toolbar keeps a steady height at the tested viewport so selection does not shift the canvas.
- Effective connector trash is derived from its explicit trash flag and endpoint/owner availability. Endpoint or subtree deletion hides incident lines through the same saved state change, without rewriting each connector. Eligible lines return when endpoints return to the same board; explicitly deleted lines remain trashed. The retained references are intentional, not dangling live connections. Future item moves/history/backup must preserve this distinction.
- SQLite schema 3 adds connectors and same-board endpoint validation. Existing schemas 1/2 get recovery copies before migration. Connector owners cannot change through the single-line save command; future group moves need an atomic command. Self-links, foreign/missing/trashed endpoints, and invalid styles are rejected.
- Ten JS and ten Rust tests passed, plus production build, formatting, Rust lint with warnings denied, and final ad-hoc-signed release packaging. Bundle size is 7.66 MiB.
- Browser checks passed for picker and final handle creation, card-to-card/card-to-tile links, drag reconnection, movement/width tracking, colour/arrow editing, manual deletion/restoration, endpoint restoration, and nested-board isolation. Canvas top stayed at 178 pixels when changing selection in the final fixture. Vite now ignores the native source/build directory, preventing native build output from resetting the temporary preview.
- Native checks passed for picker creation, line accessibility activation, manual Trash restoration, real schema-2 migration with a recovery copy, and quit/reopen with two arrows and the blue colour intact. The native `Working slice` board has one blue app-icon-to-Storyboard line and one ink Pasted-image-to-Storyboard line.
- Native automation could not dispatch drag/scroll gestures late in the session, returning `noWindowsAvailable` even though the app was running and readable. Rebinding/resetting did not resolve that tool limitation. Do not claim final native gesture checks passed; manually exercise the final top-strip handle, reconnection, and live resizing on the Mac next. Browser gesture checks did pass.

Next implementation: quote/link/checklist/file blocks and rich text, followed by multi-selection/moves/duplication, undo/redo, and portable backup/restore. Performance measurements remain those of the earlier build, not this increment. Native app is left open; temporary preview is stopped after verification.


## Content checkpoint, 12 October

The user asked to prioritise actual features and said they will do hands-on testing while using the app. This increment did not open Preview or perform browser/native UI walkthroughs.

- Added quote blocks with optional attribution, manually edited HTTP/HTTPS link blocks with optional titles and explicit open actions, checklists with completion/edit/add/reorder/remove and Return-to-add, and copied generic file attachments with Open file and Show in Finder.
- Rail presets create standalone cards. Selected cards can append any new block type alongside headings, text, and multiple images. Shared block labels now name these cards in connector pickers and Trash.
- File copies stream on a background worker, sync staging bytes, then rename before committing a reference. Original names, media type, and byte size are stored. Native opening resolves only a regular file inside the library assets directory. Invalid/unavailable files report errors. Finder drops route supported image extensions to inline image import and other extensions to generic attachments. Corrupt supported images report an import error.
- Added semantic rich-text documents to text blocks: paragraphs, bold, italic, underline, strikethrough, bullets, numbered lists, and HTTP/HTTPS hyperlinks. Existing plain text remains readable. Rendering constructs supported DOM nodes, and formatted paste is parsed into this subset. Unsupported styling is removed, scripts/embedded objects are ignored, and saved content is never injected as HTML. Native editing commands operate on the current selection; Cmd-click opens a text hyperlink. Application-wide undo remains outstanding.
- Canvas URL paste creates a link card. Other formatted text paste creates a semantic text card. Paste and Delete while in contenteditable now stay in the editor.
- SQLite schema 4 is a content compatibility boundary. Schema-3 libraries receive a consistent recovery SQLite snapshot and advance transactionally; builds capped at schema 3 reject the new library instead of trying to parse unknown blocks. New content and formatting are checked at save boundaries. Invalid link card input may be stored for editing but cannot launch; text hyperlink schemes are validated before saving.
- No new frontend dependency. Rust now explicitly depends on the already-transitive URL parser for native scheme/host/credential validation.
- Automated verification: 13 JS tests and 14 Rust tests pass, including mixed-block save/reopen, retained file bytes after source deletion, path/size validation, duplicate checklist identifiers, formatting consistency, URL schemes, and schema-3 recovery. Production build, formatting, Rust lint with warnings denied, and ad-hoc-signed release packaging passed. The updated `.app` is 7.75 MiB. Quit and reopen any already-running older build to load these features.

Next actual features: multi-selection, independent duplication including subtrees/internal connectors, atomic moves across boards, session undo/redo, permanent deletion, and portable whole-library backup/restore. Performance/culling work and user interaction testing are still outstanding. Preserve the local library and leave the PR unmerged. The user prefers to do interaction testing themselves; do not spend the next implementation turn on Preview walkthroughs unless asked or required to diagnose a reported issue.


## V1 editing completion, 13 October

The user asked to prioritise undo/redo and multi-select, then requested work until all features were implemented. They are handling hands-on interaction testing. No Preview or native UI walkthrough was used in this increment.

- Added one global session history with 100 actions, typing-burst coalescing, explicit blur boundaries, and redo invalidation after new edits. Cmd-Z/Shift-Cmd-Z and native beforeinput undo requests use this history. View navigation/zoom/file opening are excluded. Undo/redo reveals affected items on the appropriate board, preserving the current viewport for same-board edits. Imported groups, drags/resizes, stacking, moves, subtree operations, and connector edits are coherent actions. History resets after restore and irreversible deletion.
- Added Shift-click membership, marquee intersection selection, Cmd-A, group dragging, group keyboard nudges, group deletion, Cmd-D/visible duplication, Cmd-C/Cmd-V within the app session, and destination-picker moves. Duplication gives boards/items/blocks/checklist items/connectors fresh IDs while reusing immutable original bytes. Board duplication includes descendants. Internal connectors duplicate/transfer; boundary lines are retained in Trash when moved. Cyclic board moves are rejected. A board-only move to Home promotes it.
- Nested boards were already implemented. The user clarified their appearance with a compact Milanote screenshot: a small coloured icon with name and count, rather than a full card. Both Home and nested boards now use this compact layout. Board path is explicitly labelled in the header. Existing saved positions, IDs, and nesting are retained; icon geometry is 136 by 140 world units, with a 72-pixel coloured symbol.
- Added toolbar drag-to-create/import, block drag reordering alongside keyboard buttons, item context menu for group front/back order, Escape editing/gesture cancellation, image alt descriptions, and an explicit Paste image mode for a chosen card. Optional empty quote attribution/link title fields are hidden outside editing. Group selection outlines do not show every selected item's editing toolbar.
- Added `src/editing.ts` for reversible patches, history, pending-save merging, duplication, moves, and translation. Unchanged entity tables retain their references, and card callbacks stay stable to avoid rerendering every card on ordinary typing. No frontend dependency was added.
- Added transactional `save_patch` for all content changes. It validates the final hierarchy, ownership, connector membership, UUIDs, block ownership, geometry, and asset references. New/moved/dependent items can be saved together; failed graph updates roll back. Pending snapshots retain edits arriving during a save. Geometry checkpoints merge only coordinates/width into the latest saved record, preserving concurrent text. A completed gesture is one history action; cancellation restores the base geometry.
- Existing missing asset references remain editable/recoverable without silently dropping the rest of a card. New missing references are rejected. Deleted preview caches regenerate off the UI thread on load. Attachment Open/Show in Finder now use an off-thread temporary copy with the original filename, preserving library originals.
- Added `src-tauri/src/backup.rs`. Portable `.milanote` archives have magic/versioned JSON manifest plus streamed original bytes, per-asset SHA-256 and byte counts, entity counts and completion time. They include Trash and preserve entity IDs; thumbnails are excluded and rebuilt. This is an uncompressed custom format, not ZIP. Manifest parsing streams through the declared archive segment and hashes it as read. The segment must fit within the actual archive file; malformed lengths/versions are rejected without imposing a library-size quota.
- Backup flushes edits and reads a consistent SQLite snapshot. Restore stages and validates archive versions, paths, identities, graphs, asset membership/hashes, views, and decoded previews before any replacement. Inspection shows counts; confirmation rechecks the manifest fingerprint. It exports a recovery archive and keeps the replaced directory beside the active library. A durable restore journal recovers the old library if interrupted between directory renames, preventing creation of an empty library in that gap. A shared native library lock prevents commands racing a replacement. If activation succeeds but reload fails, editing stops until restart.
- Added per-item permanent deletion and Empty Trash with explicit scope confirmation. They remove subtrees and incident lines, reset history/copied state, and reclaim only unreferenced owned assets. Failed cleanup is reported separately from the successful metadata deletion. Removed board views/session pointers are cleaned as part of the transaction.
- Automated checks: 18 JS tests and 20 Rust tests pass. New coverage includes group undo/redo, new-item removal, typing coalescing/history bounds, in-flight patch retention, subtree/internal-line duplication, move boundary lines/cycle rejection, atomic graph rollback, geometry preserving newer text, retained missing references, shared-asset reclamation, archive round trips including Trash/originals, corruption/version/path rejection, thumbnail regeneration, and interrupted restore recovery. Formatting, production build, Rust lint with warnings denied, and final release packaging passed. The ad-hoc-signed Apple Silicon `.app` is 8.16 MiB.

The planned user-facing v1 feature set is implemented. Do not equate this with passing all manual acceptance criteria or measured release performance. The 500-card/200-connector fixture, frame timing, idle memory/navigation growth, and wider macOS compatibility have not been established; prior resource figures remain from the earlier slice. Drawing, plugins, automatic previews, columns/grids, sharing and cloud sync remain excluded. The PR stays unmerged unless the user asks. Preserve the real desktop library; all new backend checks use temporary test libraries. Reopen the rebuilt app to load this increment.
