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

## Testing the Formatter

The formatter is pure (`format_jqhtml(text, options)` in `src/formatter.ts`) and is
exercised outside VS Code by loading the compiled `out/formatter.js` with a stubbed
`vscode` module - the same code the extension ships, not a copy.

```bash
npm run compile
npm test                                   # fixture suite: tools/fixtures/*.jqhtml vs *.expected.jqhtml
node tools/test-formatter.js --update      # rewrite expected files - review the diff, they are the spec
node tools/format-cli.js path/to/file.jqhtml   # format one file to file.jqhtml.formatted (never in place)
```

Every fixture is checked for exact expected output, idempotence (`format(format(x)) === format(x)`),
no leaked placeholders, and - when `@jqhtml/parser` is reachable - that the output still compiles.
`tools/fixtures/errors/` holds documents the formatter must refuse, with the expected message.
Add a fixture for every formatter bug fixed.

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
