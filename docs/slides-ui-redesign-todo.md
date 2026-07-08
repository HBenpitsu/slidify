# Slides UI redesign TODO

## Goals

- Separate preview browsing UI from presentation UI.
- Replace text controls with icon-only controls.
- Move controls to a bottom overlay.
- Remove metadata display such as file name and slide count.
- Remove gradients from the base UI and keep decoration only on preview cards.
- Render presentation slides at a 16:9 aspect ratio without card framing.
- Render preview cards with a 16:9 base ratio, extend vertically when content overflows, and mark overflow visually.
- Show the progress bar only in presentation mode.
- Allow vertical browsing through slide cards in preview mode.
- Vertically center slide content.
- Center both axes when a slide starts with h1.
- Keep only the leading heading pinned to the top when a slide starts with h2/h3/etc., while centering the remaining content.
- Add preview zoom controls while keeping preview cards visually aligned with the presentation stage.
- Use the document surface color for preview cards as well as presentation slides.
- Switch zoom behavior from card resizing to shared content scaling for both preview and presentation.
- Show zoom as a percentage, remove artificial zoom caps, restore preview overflow growth, and compensate preview zoom by the preview/fullscreen ratio.

## Work items

- [x] Introduce a preview/presentation rendering split in the view layer.
- [x] Add slide layout classification based on the first heading level.
- [x] Replace text buttons with icon buttons and bottom overlay positioning.
- [x] Rework preview rendering into a scrollable stack of cards.
- [x] Rework presentation rendering into a single 16:9 stage.
- [x] Detect preview overflow and display an overflow warning line.
- [x] Limit progress UI to presentation mode only.
- [x] Update docs after implementation and validation.
- [x] Add preview zoom controls and align preview cards with the presentation surface.
- [x] Switch preview card surfaces to the document background color.
- [x] Replace card resizing with shared content zoom and add `Ctrl`+wheel support.
- [x] Show percentage zoom, remove zoom caps, restore preview overflow growth, and compensate preview scaling.

## Validation

- [x] `npm run build`
- [x] `npm run lint`
