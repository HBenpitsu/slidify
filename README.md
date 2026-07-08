# Slides Live Preview

This plugin adds a dedicated live preview pane for slide-style Markdown in Obsidian.

## What it does

- Open a dedicated preview pane by command.
- Update preview while typing.
- Split slides by `---` (or a custom separator from settings).
- Browse preview slides as a vertical stack of 16:9 cards.
- Navigate with icon controls, shared content zoom controls with percentage display, `Ctrl`+wheel zoom, arrow keys, and fullscreen mouse-wheel paging.
- Show a progress bar only during presentation mode.
- Follow the active cursor and jump to the slide you are editing.
- Ignore YAML frontmatter before the first slide.
- Present in fullscreen with a large 16:9 stage.
- Use the same document-colored surface for preview cards and the presentation stage.

## Commands

- `Open preview pane`
- `Refresh preview pane`
- `Toggle presentation mode`

## Settings

- `Slide separator`: slide separator line (default: `---`)
- `Sync with active file`: follow the active note automatically
- `Open preview when Obsidian starts`: open the pane on startup
- `Use vertical split`: open to the right (off = below)

## Development

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
```

Lint:

```bash
npm run lint
```

## Manual install

After building, copy `main.js`, `manifest.json`, and `styles.css` to:

`<Vault>/.obsidian/plugins/<plugin-id>/`
