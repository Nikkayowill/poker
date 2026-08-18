# Styling contract

Migrated from the root `CLAUDE.md` (2026-08-17) — loads only when working under this directory.

- Chrome (everything except the table) is borderless: separation comes from a raised fill, real
  shadow, and space — not 1px hairline borders. `--accent-edge` (inset ring) + `--accent-glow` stand
  in for a border; `--rule` is the one fading-hairline token for dividers between items (never an
  outline around one).
- Palette: dark obsidian ground (`--brand-ink` `#0a0a0b`), brand purple/red/gold
  (`#983fe0`/`#dc1413`/`#db9c0b`, sampled from the real logo) reserved for the mark and single
  primary actions — not a wash across a whole surface. Table felt/gold (`05-game-header.css` through
  `09-action-bar.css`, plus `16`/`17`/`99`) is untouched green felt and out of scope for chrome work.
- A single unbalanced CSS block comment silently kills the **entire** stylesheet — PostCSS drops it,
  and neither tsc nor eslint reads CSS. `stylesheets.test.ts` guards against an orphaned comment
  delimiter.
