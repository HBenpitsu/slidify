# Slidify

This plugin adds a dedicated live preview pane for slide-style Markdown in Obsidian.

## What it does

- Open a dedicated preview pane by command.
- Update preview while typing.
- Split slides by `---` (or a custom separator from settings).
- Browse preview slides as a vertical stack of cards that follow the monitor aspect ratio.
- Navigate with icon controls, shared content zoom controls with percentage display, `Ctrl`+wheel zoom, arrow keys, and fullscreen mouse-wheel paging.
- Show a progress bar only during presentation mode.
- Follow the active cursor and jump to the slide you are editing.
- Ignore YAML frontmatter before the first slide.
- Present in fullscreen with a large stage that follows the monitor aspect ratio.
- Use the same document-colored surface for preview cards and the presentation stage.
- Support slide-level zoom directives in a leading comment block such as `%% 80% %%`; effective zoom becomes `global zoom x slide zoom`.

## Commands

- `Open preview pane`
- `Refresh preview pane`
- `Toggle presentation mode`

## Settings

- `Slide separator`: slide separator line (default: `---`)
- `Default content zoom (%)`: default zoom used on open and reset
- `Header margin (em)`: heading bottom margin tuning for slide content
- `Paragraph margin (em)`: paragraph margin tuning for slide content
- `Slide padding (px)`: surface padding tuning for preview and presentation

Aspect ratio source order:

1. Monitor ratio (`screen.width / screen.height`)
2. Window ratio
3. `16:9` fallback

## Slide directives

You can add extensible directive comments at the beginning of each slide.

- `%% 80% %%`: apply a per-slide zoom multiplier of `0.8`
- `%% 125% %%`: apply a per-slide zoom multiplier of `1.25`
- `%%\n 80%\n%%`: multiline form is also supported
- `%% 80 % %%`: spacing variants are normalized

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
