import * as vscode from 'vscode';
import * as path from 'path';
import { compileTemplate } from './vendor/jqhtml-parser';
import { log } from './log';

/**
 * Compile errors as editor diagnostics.
 *
 * Each open .jqhtml document is compiled with @jqhtml/parser's compileTemplate()
 * - the same entry point the CLI and the webpack loader use - so the editor
 * reports exactly what the build would reject, at the line and column the
 * parser gives. The parser is bundled into the extension at build time
 * (out/vendor/jqhtml-parser.js, see build.sh); it is not looked up in the
 * user's workspace, so the rules are the ones this extension release shipped
 * with.
 *
 * Validation runs when a document opens, DEBOUNCE_MS after the last edit, and
 * is cleared when the document closes. `jqhtml.validate: false` turns it off.
 */

export const DEBOUNCE_MS = 300;

/** Version stamp handed to the compiler; the output is discarded. */
const COMPILE_VERSION = 'vscode';

/**
 * The parser's message is "<what> \nat <file>:<line>:<col>\n\n<code snippet>"
 * followed by the suggestion. The editor already shows where; keep the what.
 */
function headline(error: any): string {
    const message = String(error && error.message || error);
    const at = message.search(/\nat [^\n]*:\d+:\d+(\n|$)/);
    return (at === -1 ? message : message.substring(0, at)).trim();
}

/** Length of the token starting at `character` on `line_text`; at least 1. */
function token_length(line_text: string, character: number): number {
    const rest = line_text.substring(character);
    const m = /^<\/?[^\s>]*>?|^%>|^[^\s<>]+/.exec(rest);
    return Math.max(1, m ? m[0].length : 1);
}

/** The range a compile error points at. Parser lines and columns are 1-based. */
function error_range(lines: string[], error: any): vscode.Range {
    const has_line = typeof error.line === 'number' && error.line > 0;
    const line = has_line ? Math.min(error.line - 1, lines.length - 1) : 0;
    const text = lines[line] || '';

    if (typeof error.endLine === 'number' && typeof error.endColumn === 'number' && error.endLine > 0) {
        return new vscode.Range(line, Math.max(0, error.column - 1),
            Math.min(error.endLine - 1, lines.length - 1), Math.max(0, error.endColumn - 1));
    }

    if (!has_line || !(error.column > 0)) {
        // No column (a JavaScript error reported by line, or no position at all):
        // mark the line's content.
        const first = text.length - text.replace(/^\s+/, '').length;
        return new vscode.Range(line, first, line, Math.max(first + 1, text.trimEnd().length));
    }

    const character = Math.min(error.column - 1, text.length);
    return new vscode.Range(line, character, line, character + token_length(text, character));
}

/**
 * Compile `source` and return its diagnostics: none when it compiles, one for
 * the first error otherwise (the parser stops at the first error).
 */
export function compile_diagnostics(source: string, filename: string): vscode.Diagnostic[] {
    try {
        compileTemplate(source, filename, { format: 'iife', sourcemap: false, version: COMPILE_VERSION });
        return [];
    } catch (error: any) {
        const lines = source.split('\n');
        let message = headline(error);
        if (typeof error.suggestion === 'string' && error.suggestion.trim()) {
            message += '\n\n' + error.suggestion.trim();
        }
        const severity = error.severity === 'warning'
            ? vscode.DiagnosticSeverity.Warning
            : vscode.DiagnosticSeverity.Error;
        const diagnostic = new vscode.Diagnostic(error_range(lines, error), message, severity);
        diagnostic.source = 'jqhtml';
        return [diagnostic];
    }
}

/** Owns the diagnostic collection and the open / edit / close wiring. */
export class JqhtmlDiagnostics {
    private collection: vscode.DiagnosticCollection;
    private timers = new Map<string, ReturnType<typeof setTimeout>>();
    private disposables: vscode.Disposable[] = [];

    constructor(private debounce_ms: number = DEBOUNCE_MS) {
        this.collection = vscode.languages.createDiagnosticCollection('jqhtml');

        this.disposables.push(
            vscode.workspace.onDidOpenTextDocument(doc => this.validate(doc)),
            vscode.workspace.onDidChangeTextDocument(event => this.schedule(event.document)),
            vscode.workspace.onDidCloseTextDocument(doc => this.forget(doc)),
            vscode.workspace.onDidChangeConfiguration(event => {
                if (event.affectsConfiguration('jqhtml.validate')) { this.validate_all(); }
            })
        );

        this.validate_all();
    }

    private enabled(): boolean {
        return vscode.workspace.getConfiguration('jqhtml').get<boolean>('validate', true);
    }

    /** (Re)validate every open jqhtml document, or clear all when disabled. */
    public validate_all(): void {
        if (!this.enabled()) {
            this.timers.forEach(timer => clearTimeout(timer));
            this.timers.clear();
            this.collection.clear();
            return;
        }
        vscode.workspace.textDocuments.forEach(doc => this.validate(doc));
    }

    /** Validate after the document has been quiet for the debounce window. */
    public schedule(document: vscode.TextDocument): void {
        if (document.languageId !== 'jqhtml') { return; }
        const key = document.uri.toString();
        const pending = this.timers.get(key);
        if (pending) { clearTimeout(pending); }
        this.timers.set(key, setTimeout(() => {
            this.timers.delete(key);
            this.validate(document);
        }, this.debounce_ms));
    }

    /** Validate now. */
    public validate(document: vscode.TextDocument): void {
        if (document.languageId !== 'jqhtml' || !this.enabled()) { return; }
        if (document.isClosed) { return; }
        const filename = document.isUntitled ? 'untitled.jqhtml' : path.basename(document.fileName);
        try {
            this.collection.set(document.uri, compile_diagnostics(document.getText(), filename));
        } catch (error) {
            // compile_diagnostics catches compile errors; anything here is our bug.
            log.error(`JQHTML: validation of ${document.uri.fsPath} failed:`, error);
        }
    }

    /** Drop a closed document's diagnostics and any pending validation. */
    public forget(document: vscode.TextDocument): void {
        const key = document.uri.toString();
        const pending = this.timers.get(key);
        if (pending) {
            clearTimeout(pending);
            this.timers.delete(key);
        }
        this.collection.delete(document.uri);
    }

    public dispose(): void {
        this.timers.forEach(timer => clearTimeout(timer));
        this.timers.clear();
        this.disposables.forEach(d => d.dispose());
        this.collection.dispose();
    }
}
