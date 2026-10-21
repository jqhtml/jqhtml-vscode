import * as vscode from 'vscode';
import { TextDecoder } from 'util';
import { JqhtmlComponentIndex } from './componentIndex';
import { build_exclude_pattern } from './excludes';
import { is_component_name } from './component_name';
import { in_code_or_comment, open_tag_at } from './template_context';
import { log } from './log';
import { find_template_close } from './vendor/jqhtml-js-scanner';

/**
 * Completion for .jqhtml templates:
 *
 * - component names after `<` / `</` and inside `extends="..."`, from the
 *   component index (the same index Go to Definition uses);
 * - `$` args inside a component's opening tag (`<User_Card $|`), from the
 *   `$name=` defaults on its `<Define:>` tag, the `this.args.name` reads in its
 *   template, and the `this.args.name` reads in its JS class.
 *
 * Args set through other routes (a parent class, `extends=`, destructuring) are
 * not followed; the list is a convenience, not a contract.
 */

/** `<Foo`, `</Foo`, `<` - a tag name being typed. `<Define:` / `<Slot:` are excluded. */
const TAG_NAME_BEFORE_CURSOR = /<\/?([A-Za-z_][A-Za-z0-9_]*)?$/;

/** `extends="Fo` - a component name inside an extends value. */
const EXTENDS_BEFORE_CURSOR = /\bextends\s*=\s*["']([A-Za-z0-9_]*)$/;

/** The arg name being typed: `$`, `$ti`, or nothing. */
const ARG_BEFORE_CURSOR = /\$?[A-Za-z0-9_]*$/;

/** `this.args.name` and `this.args['name']`. */
const ARGS_READ = /\bthis\.args(?:\.([A-Za-z_$][\w$]*)|\[\s*['"]([A-Za-z_$][\w$]*)['"]\s*\])/g;

/** A `$name` attribute (optionally `=value`) inside a Define tag. */
const DEFINE_ARG = /(?:^|\s)\$([A-Za-z_][A-Za-z0-9_]*)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g;

/** Files a JS class may live in. */
const JS_FILE_PATTERN = /\.(js|mjs|ts)$/;

function escape_regex(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Where one arg name was found - the first source wins and sets the detail. */
interface ArgSource {
    name: string;
    detail: string;
    order: number;
}

/**
 * The text of a `<Define:...>` opening tag starting at `offset`: up to the `>`
 * that closes it, skipping quoted values and <% %> blocks.
 */
export function define_tag_text(text: string, offset: number): string {
    let i = offset;
    let quote = '';
    while (i < text.length) {
        if (quote) {
            if (text[i] === quote) { quote = ''; }
            i++;
        } else if (text.startsWith('<%', i)) {
            const close = find_template_close(text, i + 2);
            if (close === -1) { return text.substring(offset); }
            i = close + 2;
        } else if (text[i] === '"' || text[i] === "'") {
            quote = text[i++];
        } else if (text[i] === '>') {
            return text.substring(offset, i + 1);
        } else {
            i++;
        }
    }
    return text.substring(offset);
}

/** `$name` defaults declared on a `<Define:>` tag, with their written values. */
export function define_defaults(define_tag: string): { name: string; value?: string }[] {
    const out: { name: string; value?: string }[] = [];
    DEFINE_ARG.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = DEFINE_ARG.exec(define_tag)) !== null) {
        out.push({ name: m[1], value: m[2] });
    }
    return out;
}

/** Every `this.args.name` read in `text`, in order of first appearance. */
export function args_read_in(text: string): string[] {
    const seen = new Set<string>();
    ARGS_READ.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = ARGS_READ.exec(text)) !== null) {
        seen.add(m[1] || m[2]);
    }
    return Array.from(seen);
}

/** The `{ ... }` body of the class whose declaration starts at `class_start`. */
function class_body(text: string, class_start: number): string | undefined {
    const open = text.indexOf('{', class_start);
    if (open === -1) { return undefined; }
    let depth = 1;
    let i = open + 1;
    while (i < text.length && depth > 0) {
        if (text[i] === '{') { depth++; }
        if (text[i] === '}') { depth--; }
        i++;
    }
    return text.substring(open, i);
}

export class JqhtmlCompletionProvider implements vscode.CompletionItemProvider {
    /** Class name -> the file its class was last found in, re-verified on use. */
    private class_files = new Map<string, vscode.Uri>();

    constructor(private componentIndex: JqhtmlComponentIndex) {}

    public async provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.CompletionItem[] | undefined> {
        if (in_code_or_comment(document, position)) {
            return undefined;
        }

        const before = document.lineAt(position.line).text.substring(0, position.character);

        const ext = EXTENDS_BEFORE_CURSOR.exec(before);
        if (ext) {
            return this.component_items(position, ext[1].length);
        }

        const tag = TAG_NAME_BEFORE_CURSOR.exec(before);
        if (tag) {
            return this.component_items(position, (tag[1] || '').length);
        }

        const open_tag = open_tag_at(document, position);
        if (open_tag && is_component_name(open_tag.tag_name)) {
            const partial = (ARG_BEFORE_CURSOR.exec(before) || [''])[0];
            return this.arg_items(open_tag.tag_name, open_tag.attributes, position, partial.length, token);
        }

        return undefined;
    }

    private component_items(position: vscode.Position, partial_length: number): vscode.CompletionItem[] {
        const range = new vscode.Range(position.translate(0, -partial_length), position);
        return this.componentIndex.getAllComponentNames().sort().map(name => {
            const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Class);
            const def = this.componentIndex.findComponent(name);
            if (def) {
                item.detail = vscode.workspace.asRelativePath(def.uri);
            }
            item.range = range;
            return item;
        });
    }

    private async arg_items(
        component: string,
        written: string[],
        position: vscode.Position,
        partial_length: number,
        token: vscode.CancellationToken
    ): Promise<vscode.CompletionItem[] | undefined> {
        const sources = await this.collect_args(component, token);
        if (token.isCancellationRequested) {
            return undefined;
        }

        const already = new Set(written.filter(a => a.startsWith('$')).map(a => a.substring(1)));
        const range = new vscode.Range(position.translate(0, -partial_length), position);

        return sources.filter(s => !already.has(s.name)).map(s => {
            const item = new vscode.CompletionItem('$' + s.name, vscode.CompletionItemKind.Property);
            item.detail = s.detail;
            item.insertText = '$' + s.name + '=';
            item.filterText = '$' + s.name;
            item.sortText = s.order + '_' + s.name;
            item.range = range;
            return item;
        });
    }

    /** Arg names for `component`, Define defaults first, then template, then class. */
    private async collect_args(component: string, token: vscode.CancellationToken): Promise<ArgSource[]> {
        const found = new Map<string, ArgSource>();
        const add = (name: string, detail: string, order: number) => {
            if (!found.has(name)) { found.set(name, { name, detail, order }); }
        };

        const def = this.componentIndex.findComponent(component);
        if (def) {
            const text = await this.read_text(def.uri);
            if (text !== undefined) {
                const start = offset_of(text, def.position.line, def.position.character) - '<Define:'.length;
                const tag = define_tag_text(text, Math.max(0, start));
                for (const d of define_defaults(tag)) {
                    add(d.name, d.value !== undefined ? `default: ${d.value}` : 'default (flag)', 0);
                }
                const close = text.indexOf(`</Define:${component}>`, start);
                const body = text.substring(start + tag.length, close === -1 ? text.length : close);
                for (const name of args_read_in(body)) {
                    add(name, 'read in the template', 1);
                }
            }
        }

        if (token.isCancellationRequested) {
            return [];
        }

        for (const name of await this.class_args(component, token)) {
            add(name, `read in class ${component}`, 2);
        }

        return Array.from(found.values());
    }

    /** `this.args.*` reads in `class <component>`, or [] when the class is not found. */
    private async class_args(component: string, token: vscode.CancellationToken): Promise<string[]> {
        const class_regex = new RegExp(`^\\s*(?:export\\s+)?(?:default\\s+)?class\\s+${escape_regex(component)}(?![A-Za-z0-9_$])`, 'm');

        const read_class = async (uri: vscode.Uri): Promise<string[] | undefined> => {
            const text = await this.read_text(uri);
            if (text === undefined) { return undefined; }
            const m = class_regex.exec(text);
            if (!m) { return undefined; }
            const body = class_body(text, m.index);
            return body === undefined ? undefined : args_read_in(body);
        };

        const cached = this.class_files.get(component);
        if (cached) {
            const args = await read_class(cached);
            if (args) { return args; }
            this.class_files.delete(component);
        }

        // The language servers answer for .js/.ts without a file scan.
        const candidates: vscode.Uri[] = [];
        try {
            const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
                'vscode.executeWorkspaceSymbolProvider', component);
            for (const s of symbols || []) {
                if (s && s.name === component && s.location && JS_FILE_PATTERN.test(s.location.uri.fsPath)) {
                    candidates.push(s.location.uri);
                }
            }
        } catch (error) {
            log.debug(`completion: workspace symbol query failed: ${String(error)}`);
        }

        if (candidates.length === 0) {
            for (const folder of vscode.workspace.workspaceFolders || []) {
                candidates.push(...await vscode.workspace.findFiles(
                    new vscode.RelativePattern(folder, '**/*.js'),
                    build_exclude_pattern(folder)
                ));
            }
        }

        for (const uri of candidates) {
            if (token.isCancellationRequested) { return []; }
            const args = await read_class(uri);
            if (args) {
                this.class_files.set(component, uri);
                return args;
            }
        }
        return [];
    }

    /** Read without opening the file as an editor document. */
    private async read_text(uri: vscode.Uri): Promise<string | undefined> {
        try {
            return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
        } catch (error) {
            log.debug(`completion: could not read ${uri.fsPath}: ${String(error)}`);
            return undefined;
        }
    }
}

/** Offset of a 0-based line/character in `text`. */
function offset_of(text: string, line: number, character: number): number {
    let offset = 0;
    for (let l = 0; l < line; l++) {
        const nl = text.indexOf('\n', offset);
        if (nl === -1) { return text.length; }
        offset = nl + 1;
    }
    return offset + character;
}
