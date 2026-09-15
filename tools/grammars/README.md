# Vendored third-party TextMate grammars

These are **test fixtures only**. They are not shipped in the extension (`tools/`
is excluded by `.vscodeignore` and is not in `package.json`'s `files` list); they
exist so `tools/test-grammar.js` can resolve the grammars that
`syntaxes/jqhtml.tmLanguage.json` includes by scope name.

## JavaScript.tmLanguage.json

- **Scope:** `source.js`
- **Source:** <https://raw.githubusercontent.com/microsoft/vscode/main/extensions/javascript/syntaxes/JavaScript.tmLanguage.json>
- **Upstream project:** Visual Studio Code (microsoft/vscode)
- **License:** MIT — Copyright (c) Microsoft Corporation.
  <https://github.com/microsoft/vscode/blob/main/LICENSE.txt>
- **Fetched:** 2026-09-15

`#expression-block` sets `contentName: source.js` and includes `source.js`, so
without this file every `<%= ... %>` body tokenises as one undifferentiated blob
and the snapshots would not prove anything about embedded JavaScript. VS Code
itself resolves `source.js` from its bundled JavaScript extension; the test
registry has to be handed the same grammar explicitly.

To refresh it, re-fetch from the URL above, then run
`node tools/test-grammar.js` and review any snapshot churn: a change here means
VS Code's own JavaScript highlighting changed, not that jqhtml's grammar did.
