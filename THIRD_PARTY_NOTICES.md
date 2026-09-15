# Third-Party Notices

The JQHTML VS Code extension incorporates the third-party material listed below.
Each item remains under its own license; the notices are reproduced here as those
licenses require.

---

## Laravel Blade Spacer

- **Used in:** `src/blade_spacer.ts` (shipped as `out/blade_spacer.js`)
- **Upstream project:** Laravel Blade Spacer, a Visual Studio Code extension by
  Austen Cameron — <https://github.com/austenc/vscode-laravel-blade-spacer>
- **License:** MIT

`src/blade_spacer.ts` is a TypeScript port of that extension. The Blade tag
detection regexes, the snippet strings and the left-to-right change-offset
bookkeeping are derived from it.

```
MIT License

Copyright (c) Austen Cameron

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## Visual Studio Code — JavaScript.tmLanguage.json

- **Used in:** `tools/grammars/JavaScript.tmLanguage.json`
- **Upstream project:** Visual Studio Code (microsoft/vscode) —
  <https://github.com/microsoft/vscode/blob/main/extensions/javascript/syntaxes/JavaScript.tmLanguage.json>
- **License:** MIT — Copyright (c) Microsoft Corporation.
  <https://github.com/microsoft/vscode/blob/main/LICENSE.txt>

**This file is test-only.** It is a fixture for `tools/test-grammar.js`, which needs
to resolve the `source.js` grammar that `syntaxes/jqhtml.tmLanguage.json` includes by
scope name. It is not shipped in the `.vsix` or the npm tarball — `tools/` is excluded
by `.vscodeignore` and is not listed in `package.json`'s `files`. It is listed here
because it is present in the source repository.

```
MIT License

Copyright (c) Microsoft Corporation.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
