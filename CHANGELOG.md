# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## 2.3.55 (2026-08-24)

### Bug Fixes

* **activation:** `activationEvents` was empty and the extension contributes no
  commands, so nothing ever activated `out/extension.js` - Go to Definition, the
  formatter, the component index and the Blade auto-spacer were all dead in an
  installed build. Now activates on `jqhtml`, `blade` and `php`.
* **syntax:** `<%!= %>` and `<%br= %>` were highlighted as `<% %>` code blocks. The
  code-block pattern's lookahead (`<%(?!=|--)`) admitted both forms and, being listed
  ahead of the expression pattern, always won the match. Tightened to
  `<%(?!=|--|!=|br=)` at both the document and in-tag levels.
* **snippets:** the `slot` and `slotself` snippets emitted the retired `<#name>` slot
  syntax, which the lexer no longer accepts - corrected to `<Slot:name>`. Dropped the
  `slotprop` snippet: `let:prop` is an unimplemented parser TODO, not a feature.
* **docs:** README and LLM_REFERENCE documented slots as `<#slotname>` "with let:prop
  support"; both corrected.

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
