# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## 2.3.58 (2026-08-26)

### Bug Fixes

* **editor:** the auto-closing pair and bracket pair for slots use the current
  `<Slot:name>` syntax, so typing a slot completes to `</Slot:`.

## 2.3.57 (2026-08-25)

### Features

* **branding:** the project website at https://jqhtml.org/ is listed as the
  extension's homepage.
* **docs:** the README opens with an introduction to JQHTML and documents the full
  snippet set for templates and component classes.
* **marketplace:** added the Formatters category, alongside Programming Languages and
  Snippets.

### Build

* **build.sh:** `./build.sh` produces a release build - compiled with
  `tsconfig.release.json` so the packaged extension ships without sourcemaps - and
  packages the `.vsix`. `./build.sh --dev` compiles with sourcemaps for local
  development.

## 2.3.55 (2026-08-24)

### Bug Fixes

* **activation:** the extension activates on `jqhtml`, `blade` and `php`, enabling Go
  to Definition, the formatter, the component index and Blade auto-spacing.
* **syntax:** `<%!= %>` and `<%br= %>` were highlighted as `<% %>` code blocks. The
  code-block pattern's lookahead (`<%(?!=|--)`) admitted both forms and, being listed
  ahead of the expression pattern, always won the match. Tightened to
  `<%(?!=|--|!=|br=)` at both the document and in-tag levels.
* **snippets:** the `slot` and `slotself` snippets now emit the current `<Slot:name>`
  syntax.
* **docs:** README and LLM_REFERENCE document the current `<Slot:name>` slot syntax.

### Features

* **snippets:** added `expraw` (`<%!= %>`) and `expbr` (`<%br= %>`) template snippets.
* **snippets:** added a JavaScript/TypeScript snippet set for component classes,
  covering the lifecycle hooks (`on_create`, `on_load`, `on_loaded`, `on_render`,
  `on_ready`, `on_stop`, `on_viewport_resize`), `gate_load()`, the `on()`/`once()`/
  `trigger()` event API, and the `_load_only` / `_load_render_only` /
  `_force_initial_render` lifecycle flags. All prefixes are namespaced `jq*`.

## 2.2.13 (2025-09-21)

**Note:** Version bump only for package @jqhtml/vscode-extension





## 2.1.10 (2025-09-18)

**Note:** Version bump only for package @jqhtml/vscode-extension





## 2.1.9 (2025-09-18)

**Note:** Version bump only for package @jqhtml/vscode-extension





# Change Log

All notable changes to the JQHTML VS Code extension will be documented in this file.

## [2.0.0] - 2024-12-30

### Initial Release

- Full syntax highlighting for JQHTML v2 templates
- Support for both colon and brace control flow styles
- Component definition highlighting with `<Define:ComponentName>`
- Slot syntax highlighting with `<#slotname>` and let:prop support
- Data binding syntax with `:property`
- Event handler syntax with `@event`
- Special attribute syntax with `$attribute`
- Template expression highlighting `<%= expression %>`
- Comment support with `<%-- comment --%>`
- Auto-closing pairs for tags and brackets
- Code folding for component definitions
- Smart indentation for control structures
- 16 code snippets for common patterns
- Language configuration for optimal editing experience
