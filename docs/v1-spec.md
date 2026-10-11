# Local visual planning app: v1 implementation specification

Date: 11 October 2026

## Status and authority

This document defines the first version to implement. The user has requested a specification; app implementation has not started. The working name is `milanote-ish`, not a settled product name.

Requirements marked **Confirmed** come from the user. Requirements marked **Default** are concrete choices supplied by this specification to make implementation possible. They can be revised without reopening the confirmed scope. Do not interpret reference screenshots as a requirement to reproduce every visible feature.

The functional scope is implementation-ready. Tauri, React/TypeScript, custom CSS, and SQLite are confirmed. Stable dependency versions, minimum macOS version, and installer/signing approach remain implementation choices; verify current support before scaffolding.

## Purpose and success

**Confirmed.** A personal Mac app for storyboarding and collecting images, text, quotes, links, checklists, and files on freely arranged boards. It runs locally, works offline, requires no account, and imposes no subscription quotas. The user starts fresh; Milanote import is unnecessary.

A successful session lets the user create a main board, add a nested storyboard, collect references, combine an image with a heading and commentary on one card, arrange cards freely, connect them in sequence, and reopen everything later without missing content or changed positions.

No paid gates or product-imposed caps on boards, cards, nesting, assets, or library size. Available disk space, memory, file decoding, and tested performance remain practical constraints. Explain resource failures rather than presenting them as upgrade opportunities.

## Included and excluded scope

**Confirmed inclusions:** free placement; main and nested boards; mixed-content cards with reorderable blocks and multiple images/links; image, text, quote, link, checklist, and file content; headings and supporting text; connectors; imported images copied into storage; automatic local-library saving; full-canvas nested-board navigation with breadcrumbs.

**Default inclusions:** card width resizing; pan/zoom; clipboard and file imports; basic text formatting; multi-selection; duplication; moving content between boards; undo/redo; recoverable deletion; whole-library backup and restore. These implement the basic editing baseline discussed in the conversation.

**Excluded:** trackpad drawing and other drawing tools; plugins and a plugin API; columns, tables, grids, automatic storyboard structures, and templates; cloud sync, accounts, sharing, collaboration, and comments; automatic link previews or remote image fetching; Milanote import; AI features; embedded audio/video players; linked or synchronised copies; arbitrary HTML blocks; board PDF/image export; global content search. Generic file attachments can hold audio/video without an embedded player.

## Domain and ownership

The library contains a Home canvas, main boards, nested boards, cards, connectors, and copied assets. Home is the root navigation surface, not an ordinary content board. **Default:** Home contains freely positioned main-board tiles; content cards live inside boards.

Each board has exactly one parent: Home for a main board, another board for a nested board. Every board has exactly one tile in its parent canvas. No shortcuts, multiple parents, or cycles. Nesting has no artificial depth cap. Traverse hierarchies iteratively where deep nesting would otherwise risk stack overflow.

A board tile is a separate item, not a content block. It displays a colour swatch/initial, title, and direct item count. It can be moved, renamed, recoloured, duplicated with its subtree, and connected like a card. Double-click or focused Return opens it. A tile cannot be inserted into a combined card in v1.

A card belongs to one board and contains an ordered, nonempty block list. Card type names are creation presets, not restrictions on subsequent content. Duplicate cards have independent content; editing either never changes the other. Copies may safely reference the same immutable asset bytes.

Connectors belong to one board and join two distinct items on that board. Items can be cards or nested-board tiles. Home has no connectors in v1. Neither connectors across boards nor free-floating line endpoints are required.

## Screens and visual design

**Confirmed direction:** colour-block design. Reference images establish the working layout and content relationships. They do not override the requested design style.

**Default visual system:** warm off-white canvas, an ink-coloured header, a solid muted-yellow tool rail, white card surfaces, and selectable muted-blue, terracotta, green, and yellow board accents. Use large flat colour regions, restrained 1 px borders, and a 2 px selection outline. Primary colours must achieve accessible contrast with their text. Colour must never be the only indication of state.

Use a bundled/system sans-serif font, 14 px body text, approximately 1.5 line height, and compact semibold headings. Use an 8 px spacing scale, 16 px card padding, and 0–4 px card/control corner radii. Board tiles can use slightly larger corners. No gradients, glass effects, pill-shaped panels, large decorative hero text, remote fonts, or ornamental charts. Shadows are limited to a small drag-elevation cue. Images retain their own colours and remain the focus.

At a default 1280 × 800 window, provide a 64 px header and approximately 88 px left tool rail. Support a minimum window of 900 × 600; overflow tools remain reachable. The canvas fills the remaining space. Tooltips and accessible names explain icon buttons.

| Surface | Required contents |
| --- | --- |
| Header | Home/breadcrumb path, editable current-board title, undo/redo, save status, zoom, library/settings menu |
| Tool rail | Text, quote, link, checklist, board, connector, image import, file import, trash |
| Canvas | Freely positioned items and connectors; subdued optional dot texture, never an enforced grid |
| Selected-card controls | Add block, block reorder/delete, card colour, duplicate, move, delete; contextual formatting while editing |
| Library menu | Backup, restore, reveal library in Finder, keyboard help |
| Trash view | Deleted items with original location, restore, permanent deletion |

The rail may switch to context tools while editing, as in the image-card reference, but a visible back action returns to creation tools. Settings and backup controls are ordinary utility views. Do not add an analytics dashboard, promotional controls, subscription banners, notification feed, or sharing controls.

On first launch show an empty Home and a clear Create board action. After reopening, restore the last valid canvas and its viewport. Opening a nested board replaces the canvas; breadcrumbs always provide a route to Home. Browser-style back/forward navigation is a useful default, with no additional tabs required.

## Canvas interaction contract

- World coordinates are independent of zoom and window size; allow negative coordinates. There is no fixed page boundary.
- Click an item to select; Shift-click toggles membership. Drag empty space to marquee-select intersecting items. Clicking empty space clears selection.
- Drag an item's dedicated grip or noninteractive surface to move it. Text selection, links, checkboxes, and block handles must not accidentally move the card. Multi-selection moves as a unit.
- Hold Space and drag to pan. Two-finger scrolling pans in both axes; trackpad pinch zooms. Cmd-plus/minus and header controls zoom. Provide Fit content and Reset to 100%. Zoom range is 10%–400%, anchored to the pointer or viewport centre. Cmd-wheel may also zoom, but must not conflict with normal trackpad scrolling.
- New toolbar items can be dragged to a canvas position or created by click at the viewport centre. Multiple imported files land in a nonoverlapping staggered arrangement near the drop point.
- Cards have user-set width and content-driven height. Default width is 320 world units; minimum is 180, maximum is 1200. A lower-right handle changes width; height grows/shrinks to fit content. Do not silently crop text. Images scale proportionally with card width.
- Bring to front and send to back are available in the context menu. Selection raises a temporary outline, not persisted stacking order.
- Inline text editing begins by clicking editable content. Escape finishes editing or cancels an active gesture. Canvas Delete shortcuts are disabled while a text field owns focus.
- Zoom and navigation are view state, not edits in the undo history.

## Cards and block editing

All cards can mix blocks. The user adds a block through a small Add content control; drag handles reorder blocks vertically. New blocks are inserted after the chosen block or appended. The user can delete a block and undo it. Removing the final block converts the card to one empty text block, rather than silently deleting the card.

Heading and supporting text are optional blocks, not mandatory reserved fields. Presets create sensible initial stacks. Empty optional fields should be discoverable when editing and absent when viewing; do not display permanent filler captions. Internal blocks are vertically stacked, not freely positioned or nested inside one another.

| Block | Stored content and v1 behaviour |
| --- | --- |
| Heading | Plain text, prominent style; no arbitrary font settings |
| Text | Paragraphs, bold, italic, underline, strikethrough, bullet/numbered lists, text hyperlinks; simple semantic document data |
| Quote | Quoted text and optional attribution; distinct quote styling; a heading or commentary can be added as separate blocks |
| Image | Copied asset, optional alt text; proportional display without default cropping; click-to-open local full-image preview |
| Link | HTTP/HTTPS URL and optional display title; readable hostname; explicit open action launches the default browser; no background request |
| Checklist | Ordered independent text items with completion state; add, edit, reorder, remove; Return creates next item |
| File | Copied asset, original filename, media type and size; open with the system default application or reveal a safe copy in Finder |

Creation presets: Text creates one text block; Quote creates one quote block; Link creates one link block; Checklist creates one checklist block; Image import creates one image block per file/card; File import creates one file block per file/card. Heading, image, and supporting text can be added to any preset. A combined card is edited in place, without opening a separate document editor.

Text content is user data and never executed as HTML or script. Clipboard rich text is converted to the supported formatting subset; unsupported styling is removed without discarding readable text. Invalid link input remains editable with a clear error; it cannot launch an unsafe scheme. No automatic Markdown syntax conversion is required.

## Imports, clipboard, and files

Support file picker and Finder drag/drop. Inline image support must include JPEG, PNG, WebP, and GIF; animated GIF playback is optional, with the first frame sufficient for v1. Additional formats such as HEIC require explicit decoder verification before being advertised. Unsupported images can be retained as generic file attachments with an explanation. Arbitrary files are attachments, not executed by the app itself.

Copy original bytes into library-owned storage before committing a reference. Source deletion or movement must not affect the imported asset. Store original filename separately from the safe internal identifier. A failed/cancelled import leaves no broken committed card. Multi-file imports report failed files individually and keep successful imports.

Paste on the canvas creates a card from clipboard image bytes or text. Plain HTTP/HTTPS URLs create link blocks; other text creates text blocks. Paste in an active text editor edits that text. Paste an image into a selected card through its explicit Add image action; selection alone must not make ordinary canvas paste ambiguous. Internal copy/paste duplicates selected items, retaining internal connectors when both endpoints are copied.

Image thumbnails are generated locally for browsing, preserving originals. Missing or corrupt assets show a placeholder, filename, and recovery guidance while retaining the rest of the card. Do not silently remove user content. Disk exhaustion or decoding failures must be actionable and must not hang the canvas.

## Boards, moving, duplication, and connectors

Create a main board on Home or a child board within the active board. Board titles are editable and need not be unique. Breadcrumbs use stable identities, not title matching. Renames appear immediately wherever that board is referenced.

Move selected cards or board tiles using a destination picker. Reject moving a board into itself or any descendant. Moving a tile moves its entire subtree. Preserve relative positions of moved items, translating the group to a visible location on the destination canvas. An explicit Move to Home action promotes a board to a main board; content cards cannot move to Home.

Duplicate a card with a small position offset. Duplicate a board as an independent deep copy with new board/item/block/connector IDs; asset bytes may be reused. Duplicating a group includes connectors whose endpoints are both in the group. Connectors to uncopied items are not duplicated.

Create a connector by dragging a selected item's connector handle onto another item. **Default:** straight line with a target arrowhead; selectable arrow mode is none or target. Endpoints snap to the nearest item border and follow movement or resizing. Draw lines behind items, with generous hit areas independent of visible stroke width. Allow deletion, endpoint reconnection, and basic line colour. Curves, labels, both-ended arrows, and free-point anchors are outside v1.

When moving a group between boards, transfer connectors wholly contained in the group. Remove connectors crossing the group boundary as part of the same undoable operation. Explain this in the move dialog when applicable. Deleting an endpoint also deletes its connectors, recoverably and atomically.

## Undo, deletion, and recovery

**Default:** one global editing history for the current app session, covering changes across boards. Provide at least 100 recent user actions. Drag/resize/reorder commits as one action on release; coalesce a continuous typing burst. Completing a checklist item is one action. A new edit after undo clears redo. Clipboard export, view navigation, and file opening are not edit actions. Persisted data survives relaunch; undo history need not.

Undo/redo must apply the entire operation, including connectors, blocks, board subtrees, and asset references. If an undo affects another board, navigate there and reveal the affected item. Do not let native text undo and application history undo the same change twice.

Ordinary Delete moves content to Trash without a modal confirmation. A deleted board includes its subtree. Trash is part of the library and backup; it is not cleared automatically. Restore returns an item to its original live parent, or Home for a board whose parent is unavailable. For cards whose parent is unavailable, require a live destination board. Restore connectors only when both original endpoints are available in the same board; report connectors that cannot be restored.

Permanent deletion and Empty trash explicitly confirm the affected scope and cannot be undone. Asset reclamation may remove bytes only when no live content, trash content, or available undo/redo operation references them. Restoring a backup starts a new editing history.

## Local storage and persistence contracts

Use one library in the user's macOS Application Support directory, created on first launch. The shipped app launches from Finder and does not require a developer terminal or a hosted service. All fonts, icons, scripts, and core assets ship locally. Core use requires no outbound network requests, analytics, or account endpoints. Explicitly opening a saved web link hands it to the browser and may use the internet outside the app.

The library contains versioned structured metadata, immutable original assets, disposable thumbnail caches, and recovery/snapshot data. Use a transactional persistence engine or an equivalent atomic snapshot design. Never treat browser localStorage as the sole authoritative library. Metadata and original files are authoritative; cache deletion must be harmless.

| Entity | Minimum persisted fields |
| --- | --- |
| Library | ID, schema version, created/updated timestamps |
| Board | ID, parent board ID or Home, title, accent, tile position/stacking, timestamps, trash state |
| Card | ID, board ID, x/y, width, stacking order, surface colour, ordered block IDs, timestamps, trash state |
| Block | ID, card ID, kind, order, versioned kind-specific payload |
| Connector | ID, board ID, endpoint item IDs, arrow mode, colour, trash state |
| Asset | ID, safe relative path, original filename, media type, byte size, integrity hash, optional image dimensions |
| View state | Canvas ID, pan/zoom, last opened canvas |
| Trash record | Deletion group, original ownership/position, deletion time, affected entity IDs |

No absolute source paths are needed to render imported content. IDs survive backup/restore. Cross-entity integrity is enforced at mutation boundaries: no parent cycles, missing owners, missing committed assets, duplicate block ownership, or connectors with foreign-board endpoints.

The UI updates optimistically and reports Saving until committed, then Saved. Persist completed discrete actions promptly; text edits may debounce up to 500 ms. Flush pending text on blur, navigation, and normal quit. **Target:** Saved appears within one second of a normal edit on the target Mac. During a drag, checkpoint pending positions periodically so a crash loses at most the current uncommitted gesture rather than an entire session. Do not claim crash durability for edits still labelled Saving.

Save errors remain visible, preserve pending in-memory edits, and provide retry. Prevent quitting without a warning when edits remain unsaved. A successful save status requires completed durable metadata and available asset bytes. Serialize library writes and prevent a second writer opening the same library.

Stage asset bytes to a temporary path, verify, atomically promote them, then commit their metadata reference. A crash may leave an unreferenced asset, never a committed missing asset. Clean staging/orphans only after validating references. Schema migrations create a recovery copy first and fail without overwriting the only usable library. An unsupported newer library opens with an explanatory message and no mutation.

## Backup and restore

Backup exports the complete committed library to one versioned portable archive, including originals and Trash, excluding reproducible caches. Before export, flush pending edits and take a consistent snapshot. Include a manifest with archive/schema versions, entity counts, asset hashes, and a completion timestamp. Write the archive atomically; a partial export must not look complete.

Restore is whole-library replacement, not merging. Validate archive structure, paths, supported versions, references, and asset hashes in a temporary location. Reject corrupt archives and unsafe paths without touching the current library. Show archive contents/counts and explain replacement before confirmation. Automatically create a recovery backup of the current library; if that fails, do not proceed. Promote the validated library atomically, reopen it, and reset history. A rejected/cancelled restore leaves current work intact.

## Keyboard and accessibility baseline

| Input outside text editing | Action |
| --- | --- |
| Cmd-Z / Shift-Cmd-Z | Undo / redo |
| Cmd-C / Cmd-V | Copy / paste items |
| Cmd-D | Duplicate selection |
| Delete / Backspace | Move selection to Trash |
| Escape | Finish editing, cancel gesture, or dismiss transient controls |
| Space-drag | Pan canvas |
| Cmd-plus / Cmd-minus / Cmd-0 | Zoom in / out / reset |
| Return on focused board tile | Open board |

Standard text shortcuts retain their usual editing meaning when text owns focus. Provide visible focus states, labelled controls, keyboard-accessible creation and block operations, and no hover-only essential action. A selected item can move by arrow keys, with Shift for a larger increment. Respect reduced-motion settings; no decorative animations are required.

## Implementation boundaries and delivery order

### Resource priority and confirmed stack

**Confirmed:** the app should be lightweight and avoid consuming excessive system resources. React and Electron are acceptable if justified by this app's behaviour; the user has not prohibited either technology.

**Confirmed:** Tauri, React, TypeScript, custom CSS, and SQLite with local original assets. Tauri supplies desktop integration through a Rust host and uses macOS's system WKWebView rather than bundling Chromium. React is only the interface layer. Keep transactions, files, and asset processing behind narrow host commands. Choose stable dependency versions and verify their APIs before scaffolding.

The tradeoff is two implementation languages and dependence on the installed WebKit version. Electron remains a fallback if the packaged Tauri feasibility check reveals a material blocker. A fully native Swift/AppKit app is another option, but its custom canvas and mixed-content editor would require a different implementation approach. Neither alternative is justified by unmeasured performance claims alone.

Treat installed size, idle CPU, total application memory including WebKit helper processes, and interaction latency as separate measurements. A smaller download does not establish lower working memory or better frame times. Compare release builds, not development servers.

Implementation must load only the active board's detailed content, render visible cards with a small margin, decode thumbnails sized for display, bound image caches, perform imports/thumbnail work off the UI thread, and avoid periodic polling or continuous repainting while idle. During dragging, update positions without rerendering every block on every card. Text editing must not write the entire library per keystroke.

Before the full build, prove a packaged slice with image paste, trackpad pan/zoom, rich-text editing, SQLite save/reopen, and a representative image-heavy board. Record installed size, settled idle CPU, aggregate memory, and pan/drag frame timing on the target Mac. Resource budgets should be set from this baseline rather than invented before measurement. Recheck the same fixture at release; unexplained idle work or memory growth after repeatedly opening and closing boards is a defect.

Primary source: Tauri's [webview documentation](https://tauri.app/reference/webview-versions/) describes using the system webview; its [process model](https://tauri.app/concept/process-model/) explains that helper processes still exist. These establish architecture, not performance results for this app.

### Delivery order

Separate canvas/view state, content editing, user commands/history, library persistence, asset handling, and macOS integration. The UI submits validated user commands; it does not write arbitrary library files. File access, clipboard bytes, system opening, and archive selection belong behind a narrow platform boundary. This is an ownership plan, not a request for a plugin framework.

Implement vertical slices in this order:

1. Select and document the desktop stack and minimum OS; prove packaged offline launch, writable library, clipboard images, and trackpad gestures on the target Mac.
2. Home, board hierarchy, free canvas, text card, autosave, and reopen with identical content/positions.
3. Images/assets, block stacks, formatting, quotes, links, checklists, and file attachments.
4. Selection, resizing, clipboard, moves, independent duplication, and connectors.
5. Complete command history, Trash recovery, save-failure handling, and crash/import consistency.
6. Backup/restore, visual/accessibility review, performance verification, and installable release.

Use the colour-block visual system from the first slice; do not postpone it as an unrelated reskin. Verify each slice against the behaviours below before expanding scope.

## Acceptance criteria

| ID | Observable release requirement |
| --- | --- |
| A01 | Packaged app launches with network disconnected, creates a library, and permits all core edits without login or network access. |
| A02 | Home contains multiple freely placed main-board tiles; nested boards open full canvas with correct breadcrumbs; cycles are rejected. |
| A03 | One card contains heading, two images, quote, text, two links, checklist, and file; blocks reorder and retain order after relaunch. |
| A04 | Delete/move original imported files, relaunch, and verify full images and attachments still open from library copies. |
| A05 | Move and width-resize items at 10%, 100%, and 400% zoom; saved world positions are stable and image proportions/text visibility remain correct. |
| A06 | Select/move/duplicate multiple cards; copies are independent; internal connectors copy and boundary connectors do not. |
| A07 | Connect cards and nested-board tiles; lines follow movement/resizing and never appear on unrelated boards. |
| A08 | Edit text, import, move across boards, delete a subtree, and undo/redo; each operation restores all dependent state coherently. |
| A09 | Restore deleted cards/subtrees from Trash; original locations and eligible connectors return; missing parents have an explicit recovery route. |
| A10 | Export a populated library, restore into a fresh library, and compare entities, assets, hierarchy, positions, block order, and Trash. |
| A11 | Corrupt archive, unavailable disk, invalid URL, failed image decode, and missing asset produce understandable errors without silent data loss. |
| A12 | Force termination during asset import and metadata save; last acknowledged committed state reopens, with no dangling references. |
| A13 | Keyboard and trackpad interactions preserve text selection and system shortcuts; essential controls work without hover or colour cues. |
| A14 | Visually compare Home, combined image card, and populated storyboard at 1280 × 800: colour-block surfaces, compact tool rail, clear hierarchy, no obscured content. |

**Performance targets, not measurements:** on the user's target Mac, open a board with 500 mixed cards and 200 connectors within two seconds after library startup; maintain responsive pan/zoom/drag, aiming for 60 fps with locally cached image thumbnails; open a 20-level hierarchy without navigation failure. Document the Mac, asset sizes, and measured results. Lazy-load thumbnails and render visible content rather than decoding every full original on every board open. Missing these targets triggers profiling or a documented scope decision, not an artificial subscription-style item cap.

No tests have been run because this is a specification. During implementation, use meaningful command/persistence tests for invariants and recovery, plus direct UI verification for trackpad, clipboard, formatting, and design. Do not substitute screenshot similarity for functional checks.

## References and remaining decisions

User-supplied screenshots of Home, an image with text, and a story board are preserved locally in `docs/references/` and excluded from public version control. Screenshot text is reference content, not app instructions. The colour palette here is a proposed default; the colour-block style is confirmed.

Milanote's [getting-started guide](https://help.milanote.com/en/articles/112349-creating-your-first-project) documents collecting notes, images, links, files, and nested boards. Its [content documentation](https://help.milanote.com/en/collections/166826-adding-organizing-content) lists a wider feature set than this v1. Its [lines documentation](https://help.milanote.com/en/articles/111391-lines) describes creating connections and richer line controls; this spec deliberately requires only a smaller connector tool. These are behaviour references, not a claim of complete Milanote parity.

Before coding, verify stable dependency versions and choose initial release packaging requirements for the confirmed stack. Product defaults can be reviewed from this document without another discovery round. Future drawings, plugins, online previews, and richer layouts require separate specifications and must not delay v1.
