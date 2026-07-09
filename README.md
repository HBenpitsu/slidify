# Slidify

This plugin adds a dedicated live preview pane for slide-style Markdown in Obsidian.

## What it does

- Open a dedicated preview pane by command.
- Update preview while typing.
- Split slides by `---` (or a custom separator from settings).
- Browse preview slides as a vertical stack of cards that follow the current window aspect ratio.
- Navigate with icon controls, shared content zoom controls with percentage display, `Ctrl`+wheel zoom, arrow keys, and fullscreen mouse-wheel paging.
- Show a progress bar only during presentation mode.
- Follow the active cursor and jump to the slide you are editing.
- Ignore YAML frontmatter before the first slide.
- Present in fullscreen with a large stage that follows the current window aspect ratio.
- Use the same document-colored surface for preview cards and the presentation stage.
- Support slide-level zoom directives with a leading comment line such as `% 80%`; effective zoom becomes `global zoom x slide zoom`.

## Commands

- `Open preview pane`
- `Refresh preview pane`
- `Toggle presentation mode`

## Settings

- `Slide separator`: slide separator line (default: `---`)
- `Default content zoom (%)`: default zoom used on open and reset

## Slide directives

You can add extensible directive comments at the beginning of each slide.

- `% 80%`: apply a per-slide zoom multiplier of `0.8`
- `% 125%`: apply a per-slide zoom multiplier of `1.25`

Only leading directive comment lines are interpreted as directives. Heading detection ignores these lines.

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
