'use strict';
/**
 * A headless stand-in for the `vscode` module, rich enough to load and exercise
 * the extension's providers in plain node.
 *
 * The workspace is in-memory: `create_stub({ files: { 'a/b.jqhtml': '...' } })`
 * builds the document store, and findFiles / openTextDocument / getWordRange...
 * all read from it. Everything the providers call is recorded on `stub.calls`
 * so a test can assert on what was *not* asked for (see the PHP symbol probe).
 *
 * Deliberately not a mock framework: it is the smallest amount of VS Code that
 * makes componentIndex / definitionProvider / hover / blade_* run truthfully.
 */
const path = require('path');

const ROOT = '/ws';

function to_fs_path(p) {
    return p.startsWith('/') ? p : path.posix.join(ROOT, p);
}

class Position {
    constructor(line, character) { this.line = line; this.character = character; }
    translate(dl, dc) {
        const l = this.line + (dl || 0), c = this.character + (dc || 0);
        if (l < 0 || c < 0) { throw new Error('negative position'); }
        return new Position(l, c);
    }
    isBefore(o) { return this.line < o.line || (this.line === o.line && this.character < o.character); }
    with(line, character) { return new Position(line === undefined ? this.line : line, character === undefined ? this.character : character); }
}

class Range {
    constructor(a, b, c, d) {
        if (typeof a === 'number') { this.start = new Position(a, b); this.end = new Position(c, d); }
        else { this.start = a; this.end = b; }
    }
    get isEmpty() { return this.start.line === this.end.line && this.start.character === this.end.character; }
}

class Uri {
    constructor(fsPath) { this.fsPath = fsPath; this.scheme = 'file'; this.path = fsPath; }
    static file(p) { return new Uri(to_fs_path(p)); }
    static parse(s) { return new Uri(s.replace(/^file:\/\//, '')); }
    toString() { return 'file://' + this.fsPath; }
    with() { return this; }
}

class Location {
    constructor(uri, rangeOrPosition) {
        this.uri = uri;
        this.range = rangeOrPosition instanceof Range
            ? rangeOrPosition
            : new Range(rangeOrPosition, rangeOrPosition);
    }
}

class MarkdownString {
    constructor(value) { this.value = value || ''; this.isTrusted = false; }
    appendMarkdown(v) { this.value += v; return this; }
    appendCodeblock(code, lang) { this.value += '\n```' + (lang || '') + '\n' + code + '\n```\n'; return this; }
    appendText(v) { this.value += v; return this; }
}

class Hover {
    constructor(contents, range) {
        this.contents = Array.isArray(contents) ? contents : [contents];
        this.range = range;
    }
    /** Every bit of hover text, flattened - what tests assert against. */
    get text() {
        return this.contents.map(c => (typeof c === 'string' ? c : c.value)).join('\n');
    }
}

class SnippetString {
    constructor(value) { this.value = value || ''; }
}

class RelativePattern {
    constructor(base, pattern) {
        this.base = typeof base === 'string' ? base : (base.uri ? base.uri.fsPath : String(base));
        this.baseUri = typeof base === 'object' && base.uri ? base.uri : Uri.file(this.base);
        this.pattern = pattern;
    }
}

class SemanticTokensBuilder {
    constructor(legend) { this.legend = legend; this.tokens = []; }
    push(line, char, length, type, modifiers) {
        this.tokens.push({ line, char, length, type, modifiers });
    }
    build() { return { data: this.tokens, tokens: this.tokens }; }
}

class SemanticTokensLegend {
    constructor(tokenTypes, tokenModifiers) {
        this.tokenTypes = tokenTypes || [];
        this.tokenModifiers = tokenModifiers || [];
    }
}

class Disposable {
    constructor(fn) { this._fn = fn; }
    dispose() { if (this._fn) { this._fn(); } }
}

const SymbolKind = { Class: 4, Method: 5, Property: 6, Function: 11, Variable: 12 };

/** Minimal TextDocument over an in-memory string. */
class TextDocument {
    constructor(uri, text, languageId) {
        this.uri = uri;
        this.fileName = uri.fsPath;
        this._text = text;
        this._lines = text.split('\n');
        this.languageId = languageId || language_for(uri.fsPath);
        this.version = 1;
        this.isUntitled = false;
    }
    get lineCount() { return this._lines.length; }
    getText(range) {
        if (!range) { return this._text; }
        const start = this.offsetAt(range.start), end = this.offsetAt(range.end);
        return this._text.substring(start, end);
    }
    lineAt(lineOrPos) {
        const line = typeof lineOrPos === 'number' ? lineOrPos : lineOrPos.line;
        const text = this._lines[line] === undefined ? '' : this._lines[line];
        return {
            lineNumber: line,
            text,
            range: new Range(new Position(line, 0), new Position(line, text.length)),
            firstNonWhitespaceCharacterIndex: text.length - text.replace(/^\s+/, '').length,
            isEmptyOrWhitespace: text.trim() === '',
        };
    }
    offsetAt(position) {
        let offset = 0;
        for (let i = 0; i < position.line && i < this._lines.length; i++) {
            offset += this._lines[i].length + 1;
        }
        return offset + position.character;
    }
    positionAt(offset) {
        let remaining = offset;
        for (let line = 0; line < this._lines.length; line++) {
            const len = this._lines[line].length;
            if (remaining <= len) { return new Position(line, remaining); }
            remaining -= len + 1;
        }
        const last = this._lines.length - 1;
        return new Position(last, this._lines[last].length);
    }
    /**
     * VS Code semantics: expand around the position with `regex` and return the
     * match that actually covers the position.
     */
    getWordRangeAtPosition(position, regex) {
        const line = this.lineAt(position.line).text;
        const re = new RegExp(regex ? regex.source : '[A-Za-z0-9_]+', 'g');
        let m;
        while ((m = re.exec(line)) !== null) {
            if (m[0].length === 0) { re.lastIndex++; continue; }
            const start = m.index, end = m.index + m[0].length;
            if (position.character >= start && position.character <= end) {
                return new Range(new Position(position.line, start), new Position(position.line, end));
            }
        }
        return undefined;
    }
}

function language_for(fsPath) {
    if (fsPath.endsWith('.jqhtml')) { return 'jqhtml'; }
    if (fsPath.endsWith('.blade.php')) { return 'blade'; }
    if (fsPath.endsWith('.php')) { return 'php'; }
    if (fsPath.endsWith('.js')) { return 'javascript'; }
    return 'plaintext';
}

/**
 * Minimal glob matcher over the handful of forms VS Code's exclude settings
 * actually use here: `**` , `*` and `{a,b}`.
 */
function glob_to_regex(glob) {
    let out = '';
    for (let i = 0; i < glob.length; i++) {
        const c = glob[i];
        if (c === '*') {
            if (glob[i + 1] === '*') {
                const slash = glob[i + 2] === '/';
                out += slash ? '(?:.*/)?' : '.*';
                i += slash ? 2 : 1;
            } else { out += '[^/]*'; }
        } else if (c === '{') {
            const close = glob.indexOf('}', i);
            const alts = glob.substring(i + 1, close).split(',');
            out += '(?:' + alts.map(a => glob_to_regex(a).source.replace(/^\^|\$$/g, '')).join('|') + ')';
            i = close;
        } else if (c === '?') { out += '[^/]';
        } else { out += c.replace(/[.+^$()|[\]\\]/g, '\\$&'); }
    }
    return new RegExp('^' + out + '$');
}

function glob_matches(glob, relative) {
    if (glob_to_regex(glob).test(relative)) { return true; }
    // VS Code treats a bare `foo/**` style pattern as matching the folder itself too.
    return glob_to_regex(glob).test(relative.replace(/\/[^/]*$/, ''));
}

/**
 * Build the stub.
 *
 * @param {object} options
 * @param {Record<string,string>} options.files    relative path -> contents
 * @param {Record<string,any>}    options.config   'section.key' -> value
 * @param {any[]}                 options.symbols  workspace symbol results
 * @param {boolean}               options.intelephense  pretend Intelephense is installed
 * @param {boolean}               options.no_workspace  simulate "no folder open"
 */
function create_stub(options) {
    options = options || {};
    const documents = new Map();
    const calls = {
        findFiles: [],
        executeCommand: [],
        workspaceSymbolQueries: [],
        insertSnippet: [],
        openTextDocument: [],
        warnings: [],
        output: [],
        outputChannels: [],
    };
    // Tests set this to make the next findFiles reject (transient failures).
    const state = { findFilesFailures: 0 };
    /** Every watcher the code under test created, newest last. */
    const watchers = [];

    const folder = { uri: Uri.file(ROOT), name: 'ws', index: 0 };

    function add_file(rel, text, languageId) {
        const uri = Uri.file(rel);
        documents.set(uri.fsPath, new TextDocument(uri, text, languageId));
        return uri;
    }

    Object.entries(options.files || {}).forEach(([rel, text]) => add_file(rel, text));

    function relative_of(uri) {
        const p = typeof uri === 'string' ? uri : uri.fsPath;
        return p.startsWith(ROOT + '/') ? p.substring(ROOT.length + 1) : p;
    }

    function get_config(section, key) {
        const cfg = options.config || {};
        const full = section ? `${section}.${key}` : key;
        return cfg[full];
    }

    const workspace = {
        workspaceFolders: options.no_workspace ? undefined : [folder],
        getConfiguration(section) {
            return {
                get(key, fallback) {
                    const v = get_config(section, key);
                    return v === undefined ? fallback : v;
                },
                has(key) { return get_config(section, key) !== undefined; },
            };
        },
        async findFiles(include, exclude, maxResults) {
            const pattern = include && include.pattern ? include.pattern : String(include);
            calls.findFiles.push({ pattern, exclude, maxResults });
            if (state.findFilesFailures > 0) {
                state.findFilesFailures--;
                throw new Error('findFiles failed (simulated)');
            }
            const excludes = [];
            if (typeof exclude === 'string' && exclude) {
                const inner = exclude.startsWith('{') && exclude.endsWith('}')
                    ? exclude.substring(1, exclude.length - 1)
                    : exclude;
                // Split only on top-level commas; these globs have no nested braces.
                inner.split(',').forEach(g => g && excludes.push(g.trim()));
            }
            const out = [];
            for (const doc of documents.values()) {
                const rel = relative_of(doc.uri);
                if (!glob_matches(pattern, rel)) { continue; }
                if (excludes.some(g => glob_matches(g, rel))) { continue; }
                out.push(doc.uri);
                if (maxResults && out.length >= maxResults) { break; }
            }
            return out;
        },
        async openTextDocument(uriOrOptions) {
            if (uriOrOptions && (uriOrOptions.content !== undefined || uriOrOptions.language !== undefined)) {
                const uri = Uri.file('untitled-' + (documents.size + 1));
                const doc = new TextDocument(uri, uriOrOptions.content || '', uriOrOptions.language);
                doc.isUntitled = true;
                documents.set(uri.fsPath, doc);
                return doc;
            }
            const p = typeof uriOrOptions === 'string' ? to_fs_path(uriOrOptions) : uriOrOptions.fsPath;
            calls.openTextDocument.push(p);
            const doc = documents.get(p);
            if (!doc) { throw new Error('cannot open ' + p); }
            return doc;
        },
        asRelativePath(uri) { return relative_of(uri); },
        getWorkspaceFolder(uri) {
            if (options.no_workspace) { return undefined; }
            const p = typeof uri === 'string' ? uri : uri.fsPath;
            return p.startsWith(ROOT + '/') ? folder : undefined;
        },
        createFileSystemWatcher() {
            const handlers = { create: [], change: [], delete: [] };
            const watcher = {
                handlers,
                onDidCreate(fn) { handlers.create.push(fn); return new Disposable(); },
                onDidChange(fn) { handlers.change.push(fn); return new Disposable(); },
                onDidDelete(fn) { handlers.delete.push(fn); return new Disposable(); },
                dispose() {},
                async fire(kind, uri) { for (const fn of handlers[kind]) { await fn(uri); } },
            };
            watchers.push(watcher);
            return watcher;
        },
        onDidChangeConfiguration(fn) { workspace._configListeners.push(fn); return new Disposable(); },
        onDidChangeTextDocument(fn) { workspace._changeListeners.push(fn); return new Disposable(); },
        onDidSaveTextDocument() { return new Disposable(); },
        _configListeners: [],
        _changeListeners: [],
        fs: {
            async readFile(uri) {
                const doc = documents.get(uri.fsPath);
                if (!doc) { throw new Error('ENOENT ' + uri.fsPath); }
                return Buffer.from(doc.getText(), 'utf8');
            },
            async stat(uri) {
                const doc = documents.get(uri.fsPath);
                if (!doc) { throw new Error('ENOENT ' + uri.fsPath); }
                return { type: 1, size: doc.getText().length, ctime: 0, mtime: 0 };
            },
        },
    };

    const window = {
        activeTextEditor: undefined,
        showWarningMessage(m) { calls.warnings.push(m); return Promise.resolve(undefined); },
        showErrorMessage(m) { calls.warnings.push(m); return Promise.resolve(undefined); },
        showInformationMessage(m) { calls.warnings.push(m); return Promise.resolve(undefined); },
        onDidChangeActiveTextEditor() { return new Disposable(); },
        /**
         * Output channels record everything appended, so a test can assert on
         * what the extension logged (and on what it did NOT log at info level).
         */
        createOutputChannel(name) {
            const lines = [];
            const channel = {
                name,
                lines,
                append(v) { lines.push(v); calls.output.push({ name, text: v }); },
                appendLine(v) { lines.push(v); calls.output.push({ name, text: v }); },
                replace(v) { lines.length = 0; lines.push(v); },
                clear() { lines.length = 0; },
                show() {},
                hide() {},
                dispose() {},
            };
            calls.outputChannels.push(channel);
            return channel;
        },
    };

    const languages = {
        registerDefinitionProvider() { return new Disposable(); },
        registerHoverProvider() { return new Disposable(); },
        registerDocumentFormattingEditProvider() { return new Disposable(); },
        registerDocumentSemanticTokensProvider() { return new Disposable(); },
        registerCompletionItemProvider() { return new Disposable(); },
        setLanguageConfiguration() { return new Disposable(); },
        createDiagnosticCollection() { return { set() {}, clear() {}, dispose() {} }; },
    };

    const commands = {
        registerCommand() { return new Disposable(); },
        async executeCommand(command, ...args) {
            calls.executeCommand.push({ command, args });
            if (command === 'vscode.executeWorkspaceSymbolProvider') {
                calls.workspaceSymbolQueries.push(args[0]);
                return options.symbols || [];
            }
            return undefined;
        },
    };

    const extensions = {
        getExtension(id) {
            if (id === 'bmewburn.vscode-intelephense-client') {
                return options.intelephense ? { id, isActive: true, exports: {} } : undefined;
            }
            return undefined;
        },
    };

    /** An editor over one of the in-memory documents; records insertSnippet calls. */
    function make_editor(relPath) {
        const doc = documents.get(to_fs_path(relPath));
        if (!doc) { throw new Error('no such document: ' + relPath); }
        return {
            document: doc,
            selection: new Range(new Position(0, 0), new Position(0, 0)),
            insertSnippet(snippet, ranges) {
                calls.insertSnippet.push({ snippet: snippet.value, ranges });
                return Promise.resolve(true);
            },
            edit(fn) {
                const ops = [];
                fn({ insert: (pos, text) => ops.push({ pos, text }), replace: (r, t) => ops.push({ range: r, text: t }) });
                return Promise.resolve(true);
            },
        };
    }

    const vscode = {
        Position, Range, Uri, Location, MarkdownString, Hover, SnippetString,
        RelativePattern, SemanticTokensBuilder, SemanticTokensLegend, Disposable,
        SymbolKind,
        TextEdit: {
            replace: (range, newText) => ({ range, newText }),
            insert: (position, newText) => ({ range: new Range(position, position), newText }),
            delete: (range) => ({ range, newText: '' }),
        },
        EndOfLine: { LF: 1, CRLF: 2 },
        CompletionItemKind: { Class: 6, Snippet: 14, Property: 9 },
        DiagnosticSeverity: { Error: 0, Warning: 1 },
        ConfigurationTarget: { Global: 1, Workspace: 2 },
        workspace, window, languages, commands, extensions,
    };

    return {
        vscode,
        calls,
        state,
        watchers,
        documents,
        folder,
        add_file,
        make_editor,
        /** Delete a file and fire the watcher-style delete path. */
        remove_file(rel) { documents.delete(to_fs_path(rel)); return Uri.file(rel); },
        /** Fire an onDidChangeConfiguration event with the given affected keys. */
        fire_config_change(affected) {
            const event = { affectsConfiguration: (k) => affected.includes(k) };
            workspace._configListeners.forEach(fn => fn(event));
        },
        uri(rel) { return Uri.file(rel); },
        pos(line, character) { return new Position(line, character); },
    };
}

/**
 * Require one of the compiled out/*.js modules with `vscode` resolved to `stub`.
 * The module registry is cleared for out/ so each test gets fresh module state.
 */
function load_with_stub(stub, ...relative_out_paths) {
    const Module = require('module');
    const out_dir = require('path').join(__dirname, '..', 'out');
    const original_load = Module._load;

    for (const key of Object.keys(require.cache)) {
        if (key.startsWith(out_dir)) { delete require.cache[key]; }
    }

    Module._load = function (request) {
        if (request === 'vscode') { return stub.vscode; }
        return original_load.apply(this, arguments);
    };
    try {
        const loaded = relative_out_paths.map(p => require(require('path').join(out_dir, p)));
        return loaded.length === 1 ? loaded[0] : loaded;
    } finally {
        Module._load = original_load;
    }
}

module.exports = {
    create_stub, load_with_stub,
    Position, Range, Uri, Location, MarkdownString, Hover, SnippetString,
    TextDocument, glob_matches,
};
