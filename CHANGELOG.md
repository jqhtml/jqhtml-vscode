# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## 2.3.68 (2026-09-15)

### Bug Fixes

* **Go to Definition:** `<Slot:name>` navigation now accepts any identifier, not only names starting with a capital letter - `<Slot:header>` resolves to `content('header')` in the parent template.
* **Go to Definition:** a `$attr=this.member` reference is recognised as such after `this` is resolved to the enclosing `<Define:>` component, so the documented priority applies: JavaScript only, no PHP lookup and no standalone-function fallback.
* **Go to Definition:** class, member and function names are asked of the installed language servers (`vscode.executeWorkspaceSymbolProvider`) before any file scanning; the fallback scan now lists the workspace once per request, reads files with `workspace.fs` instead of opening them as editor documents, and stops as soon as the request is cancelled.
* **Go to Definition:** names containing `$` are matched literally instead of being interpolated into a regular expression as metacharacters.
* **Hover:** `$redrawable` hovers now describe the occurrence under the cursor rather than the first one on the line.
* **Component index:** a failed re-index no longer poisons the cached promise - later re-indexes run normally.
* **Component index:** a component defined in more than one file keeps the first definition, reports the collision once in the output channel naming both files, and exposes every definition through `getDuplicates()`; deleting the retained file promotes the next definition.
* **Auto-closing tags:** `<Foo />` no longer gets a `</Foo>` appended, nothing is inserted when the matching closing tag already follows the cursor or when the `>` is typed inside `<% %>`, `<%-- --%>` or `<!-- -->`, hyphenated custom elements (`<my-el>`) close correctly, and any lowercase tag that is not a void element closes - replacing the hand-maintained HTML tag list.

* **blade_spacer:** a change in a document other than the one being edited no longer
  inserts a snippet into the active editor. The guard validated
  `editor.document.fileName` but every position was read from `e.document`, so a change
  reported for any other open document (a background save, another extension's edit) was
  measured in that document's coordinates and applied to the user's file. The handler now
  returns unless `e.document === editor.document`. The file-name test is also
  `endsWith('.blade.php')` rather than `indexOf(...) !== -1`, which matched paths such as
  `a.blade.php.bak`.
* **blade tokens:** uppercase component tags are highlighted in `.blade.php` files when no
  Blade extension is installed. The semantic tokens provider returned nothing unless
  `languageId === 'blade'`, but the provider is also registered for `{pattern:
  '**/*.blade.php'}` and VS Code reports `.blade.php` as `php` with no Blade extension
  present. The gate is now the file name ending in `.blade.php` OR the `blade` language id.
* **blade tokens:** the `tag=""` attribute is highlighted at the right offset when the
  attribute text also occurs in the component name (`<Tag_Wrapper tag="span">`). The offset
  came from `component_match[0].indexOf(tag_attributes)`, which found the first textual
  occurrence; it is now computed structurally as `component_match.index + 1 +
  tag_name.length`.

* **formatter:** Define spacing no longer edits the interior of a protected region.
  `apply_define_spacing()` ran after the regions had been restored and the text
  re-split into lines, so a `<Define:>` written inside a `<%-- --%>` or `<!-- -->`
  comment, a `<% %>` block or a `<pre>`/`<textarea>` body had blank lines inserted
  around it - changing content the formatter's contract carries through verbatim.
  The decision is now made on the placeholder (substituted) line in the emit loop,
  where a whole region is a single character, and the blank lines are inserted
  around the restored text. A self-closing `<Define:Foo />` no longer opens a block
  either, so no blank line follows it. Fixture
  `tools/fixtures/define_spacing_protected.jqhtml`.

* **grammar:** a `//` line comment inside a `<% %>` block no longer swallows the `%>` that
  ends it. `//.*$` consumed the block terminator, so everything after `<% // note %>` —
  the whole rest of the file — stayed scoped as embedded JavaScript. The pattern is now
  `//(?:(?!%>).)*`.
* **grammar:** `/* */` block comments inside `<% %>` are scoped as `comment.block.js`.
  They had no rule at all and tokenized as a run of `keyword.operator.js` division and
  multiplication operators. A single-line form (`/\*(?:(?!\*/|%>).)*\*/`) matches first so a
  `%>` on the same line still ends the block; a begin/end form guarded by `/\*(?!.*\*/)`
  carries a comment across lines.
* **grammar:** `<Bar/>` with no space before the slash is highlighted as a component tag.
  The opening-tag lookahead was `(?=\s|>)`, which matched neither `/` nor `>` here, so the
  tag fell through to plain text. Now `(?=[\s/>])`, matching the Blade injection grammar.
* **grammar:** `</my-el>` and other hyphenated custom elements are highlighted as closing
  tags. The closing rule was `(</)(\w+)(>)`, which stops at the hyphen; it now mirrors the
  opening rule with `([a-z][a-z0-9\-]*)`.
* **grammar:** `<Define:` and `</Define:` accept only names the parser accepts
  (`_?[A-Z][A-Za-z0-9_]*`, the rule in `src/component_name.ts`). `\w+` highlighted
  `<Define:foo>` and `<Define:9x>` as valid definitions. `<Slot:` keeps `\w+` — slot names
  are lowercase by design.
* **grammar:** removed the dead `meta.component.body.jqhtml` rule. It began at the same
  position as the opening-tag rule listed before it, which always won, so its
  backreferenced `</Define:\4>` end never ran.
* **language configuration:** `<` and `>` are no longer a bracket pair, and the
  `<Slot:`/`<Define:` auto-closing pairs are gone. The extension closes tags itself from
  its `>` handler in `src/extension.ts`; the configuration pairs were a second mechanism
  over the same keystrokes. `<` → `>` remains as an auto-closing pair, now with
  `"notIn": ["string", "comment"]`. `<%` / `%>` is unchanged.
* **language configuration:** folding finds a `<Define:>` that carries attributes. The
  start marker required `>` immediately after the name (`^\s*<Define:\w+>`), so
  `<Define:Card tag="section">` did not fold; it is now
  `^\s*<Define:_?[A-Z][A-Za-z0-9_]*\b` with end `^\s*</Define:`.
* **language configuration:** dropped `foreach` from `increaseIndentPattern`. It is not
  JavaScript and never appears in a `<% %>` block.
* **snippets:** `compslot` emitted `<#header>…</#header>`, which is not jqhtml syntax; it
  now emits `<Slot:header>…</Slot:header>`.
* **snippets:** the scoped-ID snippet emitted `$id="…"`. The scoped ID attribute is
  `$sid`; `$id` is an ordinary component argument. Prefix is now `$sid`.
* **snippets:** `@event` emitted a quoted handler (`@click="handler"`), which the grammar
  itself flags as `invalid.illegal.quoted-event-handler`. It now emits
  `@click=this.handler`.
* **snippets:** removed the `:prop` "property binding" snippet. Property binding does not
  exist in jqhtml; `:prop="x"` is an ordinary passthrough attribute.
* **snippets:** `comp` emitted `<Component prop="value" />`; component arguments take the
  `$` prefix, so it now emits `$prop="value"`.
* **snippets:** the lifecycle truncation flags (`_load_only`, `_load_render_only`,
  `_force_initial_render`) are instantiation args, not assignable properties — the
  snippets emitted `this._load_only = true;`, which sets a private field the framework
  reads from `this.args` during `create()`. They now emit
  `$('<div>').component('Name', { …, _load_only: true })`.

### Features

* **Logging:** all extension output goes to a `JQHTML` output channel instead of the developer console; the new `jqhtml.debug` setting (default `false`) enables verbose tracing.

* **blade:** new setting `jqhtml.bladeIndentationRules` (default `true`). At activation the
  extension called `setLanguageConfiguration('blade', ...)`, replacing the indentation rules
  and word pattern of any installed Blade extension for every Blade file in the window. The
  default preserves that behaviour; set it to `false` to keep your Blade extension's own
  rules.
* **settings:** new setting `jqhtml.debug` (default `false`) - write verbose diagnostics to
  the JQHTML output channel.

* **snippets:** added `definecontent` (a `<Define:>` with `tag=`, `class=` and
  `<%= content() %>`), `slotparams` (a `<Slot:>` declaring `$params`), `$arg` (a `$`
  component argument) and `$redrawable`.

### Internal

* **tests:** three-tier headless test suite, run by `npm test` and by the monorepo's
  `./run-all-suites.sh` (label "vscode: extension"): (1) unit tests of the providers,
  index, auto-close and Blade helpers against an in-memory `vscode` stub plus the
  formatter fixtures; (2) TextMate tokenisation snapshots of both grammars with the
  engine VS Code uses (`vscode-textmate` + `vscode-oniguruma`, VS Code's JavaScript
  grammar vendored under `tools/grammars/` for `source.js`); (3) a real VS Code
  (`@vscode/test-electron`, pinned 1.137.0, under `xvfb-run`) driving Go to Definition,
  hover, formatting and auto-close through VS Code's own commands. Tier 3 is skipped
  under `--fast` (`JQHTML_FAST=1`). See README "Testing".
* **attribution:** `src/blade_spacer.ts` is a port of the MIT-licensed "Laravel Blade
  Spacer" extension by Austen Cameron. The file now carries the original copyright and MIT
  notice, and a new `THIRD_PARTY_NOTICES.md` records it along with VS Code's
  `JavaScript.tmLanguage.json` (MIT, Microsoft) vendored under `tools/grammars/` as a
  test-only fixture. `THIRD_PARTY_NOTICES.md` is in package.json's `files` so it ships.
* **packaging:** removed `"dependencies": null` from package.json (and the build.sh patch
  that deleted it at package time); set `"author": "jqhtml"`.
* **packaging:** `build.sh` now unzips the packaged vsix and fails the build if it contains
  any `.map` file or anything under `src/`, `tools/`, `test-files/`, `.vscode-test/`, or
  `build.sh`, printing the shipped file count. The staging manifest also drops `files`,
  because vsce refuses to run when both `files` and a `.vscodeignore` are present - `files`
  governs the npm tarball, `.vscodeignore` governs the vsix. `./build.sh` is now the only documented way
  to produce a release vsix; the previous hand-run `tsc -p ./` + `vsce` recipe used the dev
  tsconfig, which is how sourcemaps reached the shipped 2.3.67 vsix.
* **build:** `tsconfig.json` sets `target`/`lib` to `es2019`. It declared `lib: ["es6"]`
  while the source uses `trimStart`/`trimEnd` (ES2019); VS Code >= 1.74 runs Node 16.
* **settings:** dropped the `[jqhtml]` defaults `editor.bracketPairColorization.enabled` and
  `editor.guides.bracketPairs`. They existed to suppress colorization of the `<`/`>` bracket
  pair, which has since been removed from `language-configuration.json`.

## 2.3.66 (2026-09-14)

### Features

* **dynamic component tags:** `<{expression} ...>` and `</{expression}>` are recognised
  by the grammar - the braces highlight as a component name, the expression as embedded
  JavaScript (the same treatment an unquoted `$arg=` value gets) - and by the formatter,
  which indents them as tags and does not end the tag at a `>` inside the expression.
  Fixture `tools/fixtures/dynamic_tags.jqhtml`.

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
