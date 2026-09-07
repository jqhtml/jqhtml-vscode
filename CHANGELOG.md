# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## 2.3.63 (2026-09-07)

### Features

* **naming:** component names may begin with a single underscore (`<_Root_Layout>`), matching
  @jqhtml/parser and @jqhtml/core 2.3.62. `src/component_name.ts` holds the rule
  (`_?[A-Z][A-Za-z0-9_]*`) for the TypeScript providers; the TextMate grammars carry it
  literally. Applied to: syntax highlighting of opening/closing component tags and
  `extends=""` values (both the jqhtml and Blade grammars), auto-close on `>`, the component
  index (`<Define:_Foo>`), Go to Definition and hover word ranges, `extends` resolution, the
  Blade component provider, and the formatter, which now recognises `<_Foo>` / `</_Foo>` as
  tags and indents them. `<_foo>` is an HTML element; `<_ ` and `<__Foo>` remain text.
  Fixture `tools/fixtures/underscore_components.jqhtml`.


## 2.3.60 (2026-09-02)

### Bug Fixes

* **formatter:** a `'$'` string literal in a `<% %>` block no longer corrupts the
  document on save. Escaped blocks were restored with `String.replace(placeholder,
  block)`, whose string form interprets `$`-sequences in the replacement: the two
  characters `$'` inside `'$' + n` mean "everything after the match", so restoring
  that one block spliced the rest of the file in at that point, once per retry of
  the ten-pass restore loop. Restoration is now a single concatenating scan that
  parses nothing.
* **formatter:** a `<% %>` pair inside a JS comment within a code block no longer
  ends the block early; the scanner tracks `<%`/`%>` nesting like the parser does.
* **formatter:** a `<` inside a quoted attribute value (`data-tooltip="x < y"`) or in
  text no longer counts as an opening tag and shifts the rest of the file right.
* **formatter:** braces inside JS strings, template literals, regex literals and
  comments are no longer counted for indentation.
* **formatter:** `<pre>` and `<textarea>` bodies are carried through verbatim
  instead of being re-indented.
* **formatter:** custom elements whose name begins with a void-element name
  (`<track-list>`, `<link-preview>`) nest their children; `<col>` and `<wbr>` added
  to the void list.
* **formatter:** `<%}else{%>` and other unspaced else forms are dedented.
* **formatter:** honours `editor.insertSpaces`; keeps CRLF line endings and the
  document's final-newline state instead of normalising them on every save.

### Features

* **formatter:** Format Selection (range formatting) is supported.
* **formatter:** edits are minimal - only the changed span of lines is replaced,
  so folding, selection and undo survive a format.
* **formatter:** multi-line `<% %>` blocks and comments are re-based one level
  under their opening line, preserving their internal relative indentation, with
  the closing `%>` / `--%>` aligned to the opener.
* **formatter:** when a document cannot be formatted (unterminated comment or code
  block), a warning names the reason and line instead of silently doing nothing.
* **tooling:** `npm test` runs a fixture-based formatter suite
  (`tools/test-formatter.js`, fixtures in `tools/fixtures/`), and
  `node tools/format-cli.js <file>` formats any file with the exact code the
  extension ships, outside VS Code.

## 2.3.59 (2026-08-29)

### Bug Fixes

* **indexing:** the component index and Go to Definition honour `files.exclude`,
  `search.exclude` and `files.watcherExclude`. `workspace.findFiles` replaces the
  default excludes when given an explicit pattern, so passing `**/node_modules/**`
  had been suppressing the user's own settings: files hidden from the Explorer and
  from Find in Files were still indexed, and Go to Definition could jump into them.
  File-watcher events are filtered through the same rules, and hiding a folder
  re-indexes the workspace rather than leaving stale definitions behind.

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
