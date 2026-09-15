# JQHTML VS Code Extension — Agent & Developer Quickstart

**Public reference for the JQHTML VS Code extension.** This file gives developers (and their AI agents) a fast, accurate understanding of this repository.

Copyright (c) 2026 HansonXyz. MIT License.

---

## What This Is

Language support for `.jqhtml` template files — the component templating language of [JQHTML](https://github.com/jqhtml/jqhtml), a jQuery-first component framework. Without this extension, `.jqhtml` files appear as plain text.

**Features:**
- Syntax highlighting for jqhtml template syntax (`<Define:Component>`, `<%= %>`, `$` attributes, `@` event bindings, slots)
- Code folding for `<Define:>` blocks
- IntelliSense for component attributes
- Bracket matching for template tags
- Error highlighting for malformed syntax
- Document and selection formatting (`src/formatter.ts`)
- Optional highlighting of JQHTML components inside Laravel Blade (`.blade.php`) files

## JQHTML Syntax in 30 Seconds

```jqhtml
<Define:User_Card tag="div" class="card">
  <h3 $sid="title"><%= this.data.name %></h3>
  <button @click=this.handle_click>Contact</button>
  <%= content() %>
</Define:User_Card>
```

- `<Define:Name>` — defines a component; the Define tag IS the root DOM element
- `<%= expr %>` escaped output · `<%!= expr %>` raw HTML · `<% code %>` JavaScript · `<%-- comment --%>`
- `$attr=value` — component parameters (quoted = string, unquoted = JS expression)
- `@event=handler` — DOM event binding
- `$sid="name"` — component-scoped element IDs
- `<Slot:name>` — named slot content

For the full language reference, see `LLM_REFERENCE.md` in this repo and the main [JQHTML documentation](https://github.com/jqhtml/jqhtml).

## Building

```bash
npm install
npm run build     # or: ./build.sh
```

TypeScript errors about a missing 'vscode' module during standalone builds are expected and can be ignored.

## Testing

`npm test` runs `tools/test-all.js`: three tiers, cheapest first, one summary,
non-zero exit if any tier fails. Compile first (`./build.sh --dev`) - every tier
tests the compiled `out/`, not `src/`.

```bash
npm test               # all three tiers
npm run test:unit      # tier 1 only
npm run test:grammar   # tier 2 only
npm run test:host      # tier 3 only
JQHTML_FAST=1 npm test # tiers 1 and 2; tier 3 prints SKIPPED
```

The root `./run-all-suites.sh` runs this as the "vscode: extension" suite and
exports `JQHTML_FAST=1` under `--fast`, so tier 3 runs in the full suite only.

### Tier 1 - unit tests with a stubbed `vscode` (sub-second)

`tools/vscode-stub.js` is a headless stand-in for the `vscode` module backed by
an in-memory workspace, and `tools/load-formatter.js` / `load_with_stub()` load
the compiled `out/*.js` through it. The extension ships exactly this code; the
tests do not carry a copy of it.

- `tools/test-formatter.js` - the formatter against `tools/fixtures/*.jqhtml`.
  Each fixture is checked for exact expected output, idempotence
  (`format(format(x)) === format(x)`), no leaked placeholders, and - when
  `@jqhtml/parser` is reachable - that the output still compiles.
  `tools/fixtures/errors/` holds documents the formatter must refuse, with the
  expected message. `--update` rewrites the expected files; review the diff,
  they are the spec. Add a fixture for every formatter bug fixed.
- `tools/test-providers.js` - `component_name`, `componentIndex`,
  `definitionProvider`, the hover provider, `blade_component_provider` and
  `blade_spacer`. The stub records what the providers asked VS Code for, so a
  test can assert on what was *not* called (for example, that a `this.method`
  handler never queries Intelephense).

```bash
node tools/format-cli.js path/to/file.jqhtml   # format one file to file.jqhtml.formatted (never in place)
```

### Tier 2 - TextMate tokenisation snapshots (~2s)

`tools/test-grammar.js` runs the real `vscode-textmate` + `vscode-oniguruma`
engine - the one VS Code itself uses - over `syntaxes/*.tmLanguage.json`, and
snapshots every token of every `tools/grammar-fixtures/*.jqhtml` as
`"text"<TAB>scopes` in a sibling `.expected.txt`. A fixture with a
`<name>.scope.txt` is tokenised with that grammar instead of `source.jqhtml`
(that is how the Blade injection grammar is exercised standalone).

`source.js` is resolved from `tools/grammars/JavaScript.tmLanguage.json`, VS
Code's own grammar, vendored for tests only - see `tools/grammars/README.md`.

`--update` rewrites the snapshots. Some expected files are written by hand to
the behaviour the grammar *should* have; never `--update` one of those into
agreement with a bug.

### Tier 3 - a real VS Code extension host (~10s, plus a one-off 1 GB download)

`tools/test-extension-host/run.js` launches a real VS Code via
`@vscode/test-electron` against the fixture workspace in
`tools/test-extension-host/workspace/`, and `suite/index.js` (plain JS exporting
`run()`, no mocha) asserts that the extension activates and that VS Code's own
command layer reaches the providers: `executeDefinitionProvider`,
`executeHoverProvider`, `executeFormatDocumentProvider` (cross-checked against
`tools/format-cli.js`), and the auto-closing-tag handler against real edits.

Only this tier can see activation, command registration and the interaction
between `language-configuration.json`'s auto-closing pairs and the extension's
own handler.

- VS Code is pinned to a version constant in `run.js` and cached in
  `~/.cache/jqhtml-vscode-test/` (override with `JQHTML_VSCODE_CACHE`).
- It runs under `xvfb-run` automatically when `DISPLAY` is unset.
- `JQHTML_VSCODE_HOST_OPTIONAL=1` downgrades "could not download or launch VS
  Code" from a failure to a SKIPPED line. For offline CI only - set it locally
  and a broken tier 3 looks like a passing one.

## Packaging & Installing Locally

```bash
npx vsce package          # produces jqhtml-vscode-<version>.vsix
code --install-extension jqhtml-vscode-*.vsix
```

## Repository Layout

- `src/` — extension source (TypeScript)
- `syntaxes/` — TextMate grammars for `.jqhtml` (and Blade integration)
- `language-configuration.json` — brackets, comments, folding rules
- `LLM_REFERENCE.md` — drop-in LLM context describing jqhtml syntax

## Conventions

- Package name is `@jqhtml/vscode-extension` — do not change it
- Files/variables: `snake_case`; components in examples: `Pascal_Snake_Case`
- Versioning follows the JQHTML monorepo: `2.MONTHS_SINCE_AUG_2025.BUILD_COUNT`
