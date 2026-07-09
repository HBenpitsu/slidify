# Slidify

Slidify is a live slide workspace for Obsidian Markdown.
It keeps authoring and presenting in one flow: write in your note, browse slides in a preview stack, then go fullscreen instantly.

## User Guide

### Why Slidify

- Live while typing: slide preview stays in sync with editor content and cursor position.
- One visual language: preview cards and presentation stage share the same rendering pipeline.
- Presentation-ready controls: keyboard navigation, wheel paging in fullscreen, and content zoom with percentage display.
- Markdown-first: no custom file format, no export step required to present.

### Core workflow

1. Open a Markdown note.
2. Run **Open preview pane**.
3. Edit as usual; the active slide follows your cursor.
4. Run **Toggle presentation mode** when you are ready.

### Restart persistence

On Obsidian restart/workspace restore, each Slidify pane restores its last state independently:

- Target Markdown file path
- Active slide index
- Content zoom value

Notes:

- Fullscreen presentation state is not restored.
- If the previously opened file no longer exists, the pane falls back to the empty state.

### Commands

- `Open preview pane`
- `Refresh preview pane`
- `Toggle presentation mode`

### Slide model

- Slides are split by a separator line (default: `---`).
- YAML frontmatter is ignored before slide parsing.
- Layout is classified from the first heading in each slide:
	- `# ...` -> hero
	- `## ...` and below -> section
	- no heading -> content

### Slide directives

Leading `%% ... %%` comment blocks can define per-slide directives.

Supported today:

- `80%` / `125%`: per-slide content scale
- `theme: dark` (parsed into slide metadata)
- `note: ...` (parsed into speaker-notes metadata)

Notes:

- Directives are parsed only from leading comment blocks in each slide.
- Theme/notes are currently stored as metadata for upcoming UI features.

### Settings

- `Slide separator`
- `Default content zoom (%)`
- `Header margin (em)`
- `Paragraph margin (em)`
- `Slide padding (px)`

Advanced refresh:

- `Enable periodic self-healing refresh`
- `Periodic refresh interval (ms)`
- `Resize settle refresh count`
- `Resize settle interval (ms)`

Aspect ratio source order:

1. Monitor ratio (`screen.width / screen.height`)
2. Window ratio
3. `16:9` fallback

## Developer Guide

### Project overview

- TypeScript-based Obsidian community plugin bundled to `main.js`.
- Entry point: `src/main.ts`.
- Core slide view orchestration: `src/slidesPreviewView.ts`.

### Source layout

- `src/slideModel.ts`: slide parsing, layout classification, directive parsing, slide metadata.
- `src/slidesPreview/layoutEngine.ts`: layout measurement and geometry.
- `src/slidesPreview/modeRenderers.ts`: preview/presentation rendering orchestration.
- `src/slidesPreview/interactionController.ts`: keyboard/wheel/fullscreen/resize interaction wiring.
- `src/slidesPreview/icons.ts`: safe SVG icon creation.

### Development

```bash
npm install
npm run dev
```

### Quality checks

```bash
npm run build
npm run lint
```

### Manual install for local testing

After building, copy `main.js`, `manifest.json`, and `styles.css` to:

`<Vault>/.obsidian/plugins/<plugin-id>/`
