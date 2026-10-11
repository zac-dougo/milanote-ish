# Product scope

The implementation specification is [v1-spec.md](v1-spec.md). It distinguishes user-confirmed requirements from implementation defaults.

## Settled direction

- The primary uses are storyboarding and collecting images and pieces of text in one place.
- Milanote is the reference for the base functionality and experience. The v1 feature set is defined in the implementation specification.
- V1 runs on the user's Mac, fully locally and offline, with no account required and no subscription-based limits.
- Cards can be placed freely. Users create their own visual structures by arranging cards.
- The user prefers one or a small number of main boards containing nested boards. This is a usage preference, not an enforced limit.
- V1 supports images, text, quotes, links, checklists, and files on cards, plus nested boards.
- Cards can combine their main content with a heading and supporting text on the same card. This is particularly useful for images and quotes.
- Cards contain a reorderable stack of content blocks. A card can contain multiple images and links, as well as mixed content types.
- Users add images to link cards manually. Fetching website previews is not required for v1.
- Connectors between cards belong in v1.
- Opening a nested board replaces the current canvas, with breadcrumbs for navigating back. Each nested board has one parent, and boards can contain further nested boards.
- Imported images are copied into the app's storage so boards do not depend on the original files remaining in place.
- Work is saved automatically into a local library rather than managed as separately opened and saved project files.
- V1 starts fresh; importing existing Milanote boards is unnecessary.
- The visual direction is colour-block design. User screenshots guide layout and interactions; the app should avoid a generic AI-generated appearance.
- Low system-resource use is a product priority. React and Electron are not categorically excluded, but convenience alone does not justify unnecessary runtime overhead.

## Outside v1

- Small drawings made with a MacBook trackpad, inspired by the signature input experience on macOS.
- Advanced structured layouts. Plugins are a possible future approach, not a committed v1 requirement.
- Automatic website previews.
- Importing existing Milanote boards.

## Specification defaults

The user's request for a full specification is implemented with these defaults, rather than treating them as separately confirmed requirements:

- Drag cards freely and resize their width, with content-driven height.
- Pan and zoom the canvas.
- Add images through drag-and-drop and clipboard paste.
- Edit content directly on the board, with basic text formatting.
- Select, duplicate, and delete cards; move cards between boards.
- Undo and redo edits.
- Connectors follow cards when they move.
- Export and restore the local library for backup.
- Recoverable deletion through Trash.

## Confirmed technology direction

- Tauri desktop host, React/TypeScript interface, custom CSS, and SQLite metadata with copied local assets.
- Validate the packaged stack and resource use in a small working build before implementing the full feature set.

## Remaining implementation choices

- Stable dependency versions, minimum macOS version, and installer/signing approach.
- Exact palette and visual polish within the confirmed colour-block direction.

See the resource requirements and stack evaluation in the implementation specification.
