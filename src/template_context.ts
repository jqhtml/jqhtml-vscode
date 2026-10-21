import * as vscode from 'vscode';
import { find_template_close } from './vendor/jqhtml-js-scanner';

/**
 * Light-weight readings of the template text around the cursor, shared by the
 * auto-close handler and the completion provider. These are typing heuristics,
 * deliberately weaker than the real @jqhtml/parser lexer: they only have to
 * answer "what is the cursor in?" well enough to decide whether to offer help.
 */

/** How far back the scans look - linear, but bounded. */
const CONTEXT_SCAN_LINES = 200;

function text_before(document: vscode.TextDocument, position: vscode.Position): string {
    const first_line = Math.max(0, position.line - CONTEXT_SCAN_LINES);
    return document.getText(new vscode.Range(new vscode.Position(first_line, 0), position));
}

/**
 * Is `position` inside a <% ... %> block, a <%-- --%> or an <!-- --> comment?
 *
 * A single linear pass over the preceding text; the state at the end is the
 * state at the cursor. The scan starts at most CONTEXT_SCAN_LINES back, which
 * can mis-read a block opened further up - acceptable for a typing heuristic.
 */
export function in_code_or_comment(document: vscode.TextDocument, position: vscode.Position): boolean {
    const text = text_before(document, position);

    type State = 'text' | 'code' | 'template_comment' | 'html_comment';
    let state: State = 'text';
    let i = 0;
    // A <% %> block is skipped whole with the compiler's JavaScript scanner (a %>
    // in a string, regex or // comment does not close it); one still open at the
    // end of the text holds the cursor.

    while (i < text.length) {
        if (state === 'text') {
            if (text.startsWith('<%--', i)) { state = 'template_comment'; i += 4; }
            else if (text.startsWith('<%', i)) {
                const close = find_template_close(text, i + 2);
                if (close === -1) { state = 'code'; break; }
                i = close + 2;
            }
            else if (text.startsWith('<!--', i)) { state = 'html_comment'; i += 4; }
            else { i++; }
        } else if (state === 'template_comment') {
            if (text.startsWith('--%>', i)) { state = 'text'; i += 4; } else { i++; }
        } else {
            if (text.startsWith('-->', i)) { state = 'text'; i += 3; } else { i++; }
        }
    }

    return state !== 'text';
}

/** The opening tag the cursor sits in, between its name and its `>`. */
export interface OpenTagContext {
    /** The tag name as written: `Foo`, `div`, `Define:Foo`, `Slot:x`. */
    tag_name: string;
    /** Names of the attributes already written in the tag, `$` included. */
    attributes: string[];
}

/**
 * The opening tag `position` is inside, when the cursor is in attribute
 * position: after the tag name and whitespace, outside any quoted value and
 * outside <% %>. Returns undefined anywhere else, including inside a value.
 *
 * Forward scan over the preceding text tracking text / tag / quote / code /
 * comment state; the state at the end is the state at the cursor.
 */
export function open_tag_at(document: vscode.TextDocument, position: vscode.Position): OpenTagContext | undefined {
    const text = text_before(document, position);

    type State = 'text' | 'tag' | 'quote' | 'code' | 'template_comment' | 'html_comment';
    let state: State = 'text';
    let return_to: 'text' | 'tag' | 'quote' = 'text';
    let quote = '';
    let tag: OpenTagContext | undefined;
    let i = 0;

    while (i < text.length) {
        const c = text[i];
        if (state === 'text' || state === 'tag') {
            if (text.startsWith('<%--', i)) { return_to = state; state = 'template_comment'; i += 4; continue; }
            if (text.startsWith('<%', i)) {
                const close = find_template_close(text, i + 2);
                if (close === -1) { state = 'code'; break; }
                i = close + 2;
                continue;
            }
        }
        if (state === 'text') {
            if (text.startsWith('<!--', i)) { state = 'html_comment'; i += 4; continue; }
            const open = /^<([A-Za-z_][A-Za-z0-9_\-]*(?::[A-Za-z0-9_]+)?)/.exec(text.substring(i, i + 200));
            if (open) {
                tag = { tag_name: open[1], attributes: [] };
                state = 'tag';
                i += open[0].length;
                continue;
            }
            i++;
        } else if (state === 'tag') {
            if (c === '>') { state = 'text'; tag = undefined; i++; continue; }
            if (c === '"' || c === "'") { state = 'quote'; quote = c; i++; continue; }
            const attr = /^[$@:A-Za-z_][\w$:.\-]*/.exec(text.substring(i, i + 200));
            if (attr && /\s/.test(text[i - 1] || '')) {
                tag!.attributes.push(attr[0]);
                i += attr[0].length;
                continue;
            }
            i++;
        } else if (state === 'quote') {
            if (text.startsWith('<%', i)) {
                const close = find_template_close(text, i + 2);
                if (close === -1) { state = 'code'; break; }
                i = close + 2;
                continue;
            }
            if (c === quote) { state = 'tag'; }
            i++;
        } else if (state === 'template_comment') {
            if (text.startsWith('--%>', i)) { state = return_to; i += 4; } else { i++; }
        } else {
            if (text.startsWith('-->', i)) { state = 'text'; i += 3; } else { i++; }
        }
    }

    if (state !== 'tag' || !tag) {
        return undefined;
    }

    // Attribute position: the cursor follows whitespace, or a partial name that
    // itself follows whitespace (`<Foo $ti|`). Inside an unquoted value
    // (`$x=ab|`) is not attribute position.
    const partial = /[$@:A-Za-z_][\w$:.\-]*$/.exec(text);
    const before_partial = partial ? text.substring(0, partial.index) : text;
    if (!/\s$/.test(before_partial)) {
        return undefined;
    }
    if (partial) {
        // The partial word is the one being typed, not an attribute already written.
        const last = tag.attributes[tag.attributes.length - 1];
        if (last === partial[0]) { tag.attributes.pop(); }
    }
    return tag;
}
