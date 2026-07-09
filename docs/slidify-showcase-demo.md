# Slidify As-Is Showcase

> [!NOTE]
> The same Markdown document is used for writing, preview, and fullscreen presentation.

- No custom slide format
- No export step
- No visual rewrite before presenting

---

## What "As Is" means in practice

> [!TIP]
> Callouts remain callouts in presentation.

Use ==highlight==, **bold**, and *italic* for emphasis exactly as written.

- [x] Checklists stay readable
- [x] Structure remains scannable
- [ ] Add your own content and present immediately

> "If it looks right while editing, it should look right on stage."

---

%% 110% %%

| Control | Where you define it | Effect on presentation |
| --- | --- | --- |
| Directives | In-slide comments (`%% ... %%`) | Per-slide overrides and speaker-note metadata |
| Slide separator | Plugin settings (`---` by default) | Controls how Markdown is split into slides |
| Default content zoom (%) | Plugin settings | Sets baseline text scale for readability |
| Header/paragraph margin + slide padding | Plugin settings | Tunes rhythm, density, and visual breathing room |

```ts
const promise = {
  source: "one markdown document",
  transition: "write -> preview -> present",
  visualIntent: "preserved",
};
```

Outcome: Slidify presents your document ==as written==, with minimal ceremony.
