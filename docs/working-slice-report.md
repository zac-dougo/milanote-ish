# Working-slice checks

12 October 2026. MacBook Pro Mac14,7, Apple M2, 8 GB RAM, macOS 27.0.

## Desktop checks

The first release build, commit `cb26dfe`, was exercised through its native interface.

- A deleted card remained in Trash after reopening. Restoration recovered its text, image, yellow colour, and width of 340 pixels.
- Mouse resizing changed its width to 390 pixels. A normal window close and reopen preserved that width and the other content.
- Copying the synthetic app icon in Preview and pasting onto the canvas created a locally stored image card.
- The native picker imported 32 generated images, and the board reached 32 cards. Each source was an 1800 × 1200 PNG. Source files totalled 29.82 MiB; canvas thumbnails were capped at 1000 pixels on their longest side.
- Normal window close removed the app and all three identified WebKit helper processes. No other WebKit processes were present at that point.

The fixture can be recreated with the standard-library script:

```sh
python3 scripts/generate-image-fixture.py /tmp/milanote-ish-image-fixture
```

The picker originally placed every imported card at the same point. The next build spreads batches across four columns. This is initial placement only; cards remain freely movable.

## Resource observations

These observations concern the first release build. They are not measurements of the development server or proof that all v1 performance targets pass.

The installed `.app` occupied about 7.60 MiB, excluding the local library and build caches.

A small board with one image card had a summed resident set of 56.5 MiB across the app and its three WebKit helpers, with every process reporting 0.0% CPU in a `ps` snapshot. Resident sets vary when macOS compresses or swaps memory, so this number does not describe the total memory cost.

With the 32-image board loaded, three `ps` samples two seconds apart reported total resident sets of 34.22, 108.67, and 97.77 MiB. Total reported CPU across the four processes was 0.3%, 2.0%, and 0.7%. These short samples followed import and Fit, rather than a controlled idle benchmark.

The native `footprint` tool then reported a combined physical footprint of 243 MB, including compressed memory:

| Process | Physical footprint |
| --- | ---: |
| App host | 35 MB |
| WebKit content | 174 MB |
| WebKit GPU | 28 MB |
| WebKit networking | 6976 KB |

Helpers were attributed by their appearance with the app and their disappearance when it closed, rather than by summing unrelated WebKit processes. This is one snapshot on an 8 GB Mac under its existing workload. No frame-rate or interaction-latency claim is established.

## Hierarchy increment

The updated release bundle occupies 7.63 MiB. Its native app migrated the existing library, retaining both main boards and their 34 image/text cards. A schema-v1 recovery SQLite copy was confirmed beside the library.

A nested `Storyboard` was created inside `Working slice` with a text card. Quit/reopen restored the last nested canvas and its full breadcrumb path. Deleting the parent and restoring it through Trash recovered the child and all direct items. Its nested note still contained both lines of text. Saved views, image widths, and card positions remained available.

Free Home placement, tile editing, keyboard opening, saved front/back ordering, and recoverable board subtrees are implemented. A browser UI check confirmed that new tiles sit above older cards and Send to back reverses their stacking. Native Bring to front and tile dragging were exercised. The synthetic resource-test board is now recoverable in Trash.

Seven JS tests and seven Rust tests pass, covering save races/retry, deep breadcrumb traversal, subtree visibility, 20-level persistent hierarchy, cycle/parent rejection, migration preservation/recovery, failed-migration rollback, asset copying, and newer-version rejection. Production build, formatting, Rust lint with warnings denied, and release packaging also pass.

Resource observations above still refer to the earlier release, rather than a repeated benchmark of this increment.

## Connector increment

Connectors now join cards and nested-board tiles, snap to their borders, track movement/resizing, support target/no arrow and four colours, and allow endpoint reconnection and recoverable deletion. No graph library was added. Endpoint/subtree deletion makes incident lines effectively trashed through the endpoint's saved state; restoring both endpoints on the original board revives eligible lines, while manual line deletion remains independent.

Ten JS tests and ten Rust tests passed, including geometry, effective-trash visibility, same-board validation, reconnection persistence, and schema-2 migration/recovery. Production build, formatting, Rust lint with warnings denied, and release packaging passed. Bundle size is 7.66 MiB.

Browser checks exercised final handle creation, card/tile endpoints, reconnection, movement and resizing, style controls, Trash restoration, and board isolation. Native checks exercised source/target pickers, accessibility line activation, line Trash restoration, and quit/reopen with both lines and blue styling intact. A schema-v2 recovery copy was confirmed beside the native library.

Native drag/scroll automation later could not locate its gesture target, despite the app remaining running and accessible. Final native gesture checks remain outstanding; they were verified in the browser preview. Handles were moved beside the top strip, outside the selection outline and above block controls, after observing overlap in the earlier layout. The measured canvas top remained unchanged when switching selection in the final browser layout.

The existing physical-memory observations concern the earlier release. No new frame-rate or aggregate-memory claim is established by this increment.

## Remaining checks

Finder drop and automated native trackpad pinch checks remain outstanding. The 500-card/200-connector fixture, measured frame timing, repeat-navigation memory growth, and a settled idle physical-footprint baseline remain outstanding. Rich text and the additional content block types remain unimplemented.
