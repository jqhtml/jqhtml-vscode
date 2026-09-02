import * as vscode from 'vscode';

/**
 * JQHTML document formatter.
 *
 * The formatter re-indents a template; it never reorders, rewraps or rewrites
 * content. It works in four passes over the text:
 *
 *   1. scan_protected_regions   find the spans whose interior must be carried
 *                               through verbatim: <%-- --%>, <!-- -->, every
 *                               <% %> block, and <pre>/<textarea> bodies.
 *   2. substitute               swap each region for a one-character-class
 *                               placeholder so the later passes only ever see
 *                               structure, never contents.
 *   3. measure                  walk the placeholder text once, tokenizing HTML
 *                               tags and (inside code placeholders) JS braces,
 *                               and record per line how the nesting depth moves.
 *   4. emit                     compute an indent per line from those movements,
 *                               restore the regions, and fix Define spacing.
 *
 * IMPORTANT: no regular expressions are used for parsing here. The passes are
 * hand-written scanners over the string, so behaviour on unusual input is
 * predictable and every decision is traceable to a line below. Regex belongs
 * in the syntax highlighter only.
 *
 * The scanners are deliberately weaker than the real @jqhtml/parser lexer -
 * they exist to place indentation, not to validate - but wherever the two
 * could disagree (nested <% %> inside a JS comment, <% %> inside a <pre> body,
 * '<' inside an attribute value) this file follows the parser.
 */

export interface JqhtmlFormatOptions {
    /** Width of one indent level, in spaces, when insert_spaces is true. */
    tab_size: number;
    /** Indent with spaces (true) or a single tab per level (false). */
    insert_spaces: boolean;
}

/** Raised when the document cannot be formatted. `offset` is a character index into the input. */
export class JqhtmlFormatError extends Error {
    constructor(message: string, public readonly offset: number) {
        super(message);
        this.name = 'JqhtmlFormatError';
    }
}

// Void elements never take children, so an opening tag does not raise the depth.
// Matched case-sensitively against the lowercase form only: a capitalized name
// such as <Input> is a component, which does nest.
const VOID_ELEMENTS = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
    'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

// Elements whose body is significant whitespace. Their contents are protected
// exactly like a comment: the opening and closing tags are indented, the body
// is carried through untouched. The parser treats these as raw text too.
const RAW_TEXT_ELEMENTS = ['pre', 'textarea'];

// Placeholder sentinels. Private Use Area code points, so a real source file
// will not contain them; if one does, the offending code point is stepped past
// (see choose_sentinel). A placeholder is  OPEN <digits> CLOSE.
const SENTINEL_CANDIDATES = ['\uE000', '\uE001', '\uE002', '\uE003', '\uE004', '\uE005'];

type RegionKind = 'jqhtml_comment' | 'html_comment' | 'code' | 'raw_text';

interface ProtectedRegion {
    kind: RegionKind;
    start: number;   // inclusive, into the input
    end: number;     // exclusive
    text: string;
}

/** Per-line nesting measurements gathered by the measure pass. */
interface LineMeasure {
    /** Text of the line after substitution, trimmed. */
    text: string;
    /** Lowest point the running depth reaches while walking this line, relative to its start (<= 0). */
    min_depth: number;
    /** Net depth change across the line. */
    net_depth: number;
    /** Line is an attribute continuation of a tag opened on an earlier line. */
    attr_continuation: boolean;
    /** Line is the final line of a multi-line tag (the one holding its '>' or '/>'). */
    tag_end_line: boolean;
}

// ---------------------------------------------------------------------------
// Character helpers
// ---------------------------------------------------------------------------

function is_name_start(ch: string): boolean {
    return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z');
}

function is_name_char(ch: string): boolean {
    return is_name_start(ch) || (ch >= '0' && ch <= '9') || ch === '_' || ch === '-' || ch === ':' || ch === '.';
}

function is_space(ch: string): boolean {
    return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}

function is_digit(ch: string): boolean {
    return ch >= '0' && ch <= '9';
}

/**
 * True when `text` has exactly the tag `name` at `pos`, followed by a tag
 * delimiter. Case-sensitive: <pre> is HTML, <Pre> would be a component.
 */
function tag_name_at(text: string, pos: number, name: string): boolean {
    if (text.substr(pos, name.length) !== name) {
        return false;
    }
    const after = text[pos + name.length];
    return after === undefined || is_space(after) || after === '>' || after === '/';
}

// ---------------------------------------------------------------------------
// Pass 1: protected regions
// ---------------------------------------------------------------------------

/**
 * Find the end of a <% ... %> block starting at `start` (which points at '<%').
 * Nested '<% %>' pairs inside the block - typically in a JS comment that talks
 * about the syntax - are skipped over, matching what the parser accepts.
 */
function find_code_end(text: string, start: number): number {
    let depth = 0;
    let pos = start;
    while (pos < text.length) {
        if (text.startsWith('<%', pos)) {
            depth++;
            pos += 2;
            continue;
        }
        if (text.startsWith('%>', pos)) {
            depth--;
            pos += 2;
            if (depth === 0) {
                return pos;
            }
            continue;
        }
        pos++;
    }
    return -1;
}

/**
 * Find the end of a raw-text element body. `body_start` is the offset just
 * past the opening tag's '>'. Returns the offset of the closing tag's '<', or
 * -1. Code blocks in the body are stepped over so a '</pre>' mentioned inside
 * one does not end the element early - same rule as the lexer.
 */
function find_raw_text_end(text: string, body_start: number, name: string): number {
    const closing = '</' + name;
    let pos = body_start;
    while (pos < text.length) {
        if (text.startsWith('<%', pos)) {
            const end = find_code_end(text, pos);
            if (end === -1) {
                return -1;
            }
            pos = end;
            continue;
        }
        if (text[pos] === '<' && tag_name_at(text, pos + 2, name) && text.startsWith(closing, pos)) {
            return pos;
        }
        pos++;
    }
    return -1;
}

function scan_protected_regions(text: string): ProtectedRegion[] {
    const regions: ProtectedRegion[] = [];
    let pos = 0;

    const push = (kind: RegionKind, start: number, end: number) => {
        regions.push({ kind, start, end, text: text.substring(start, end) });
        pos = end;
    };

    while (pos < text.length) {
        const lt = text.indexOf('<', pos);
        if (lt === -1) {
            break;
        }
        pos = lt;

        if (text.startsWith('<%--', pos)) {
            const end = text.indexOf('--%>', pos + 4);
            if (end === -1) {
                throw new JqhtmlFormatError('Unterminated JQHTML comment (<%-- without --%>)', pos);
            }
            push('jqhtml_comment', pos, end + 4);
            continue;
        }

        if (text.startsWith('<!--', pos)) {
            const end = text.indexOf('-->', pos + 4);
            if (end === -1) {
                throw new JqhtmlFormatError('Unterminated HTML comment (<!-- without -->)', pos);
            }
            push('html_comment', pos, end + 3);
            continue;
        }

        if (text.startsWith('<%', pos)) {
            const end = find_code_end(text, pos);
            if (end === -1) {
                throw new JqhtmlFormatError('Unterminated code block (<% without %>)', pos);
            }
            push('code', pos, end);
            continue;
        }

        let matched_raw = false;
        for (const name of RAW_TEXT_ELEMENTS) {
            if (!tag_name_at(text, pos + 1, name)) {
                continue;
            }
            const open_end = skip_tag(text, pos);
            if (open_end === -1) {
                throw new JqhtmlFormatError(`Unterminated <${name}> tag`, pos);
            }
            if (text[open_end - 2] === '/') {
                // <pre /> has no body.
                pos = open_end;
                matched_raw = true;
                break;
            }
            const close = find_raw_text_end(text, open_end, name);
            if (close === -1) {
                throw new JqhtmlFormatError(`Missing </${name}> for <${name}>`, pos);
            }
            // The body only. Both tags stay visible to the measure pass so they
            // are indented like any other element.
            if (close > open_end) {
                regions.push({ kind: 'raw_text', start: open_end, end: close, text: text.substring(open_end, close) });
            }
            pos = close;
            matched_raw = true;
            break;
        }
        if (matched_raw) {
            continue;
        }

        pos++;
    }

    return regions;
}

/**
 * Given `pos` at a tag's '<', return the offset just past its closing '>',
 * honouring quoted attribute values. -1 if the tag never closes.
 */
function skip_tag(text: string, pos: number): number {
    let quote: string | null = null;
    for (let i = pos + 1; i < text.length; i++) {
        const ch = text[i];
        if (quote !== null) {
            if (ch === quote) {
                quote = null;
            }
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch;
            continue;
        }
        if (ch === '>') {
            return i + 1;
        }
    }
    return -1;
}

// ---------------------------------------------------------------------------
// Pass 2: substitution
// ---------------------------------------------------------------------------

function choose_sentinel(text: string): [string, string] {
    const free = SENTINEL_CANDIDATES.filter(ch => text.indexOf(ch) === -1);
    if (free.length < 2) {
        throw new JqhtmlFormatError('Document uses every private-use sentinel the formatter relies on', 0);
    }
    return [free[0], free[1]];
}

interface Substituted {
    text: string;
    regions: ProtectedRegion[];
    open: string;
    close: string;
}

function substitute(text: string, regions: ProtectedRegion[]): Substituted {
    const [open, close] = choose_sentinel(text);
    let out = '';
    let pos = 0;
    regions.forEach((region, index) => {
        out += text.substring(pos, region.start);
        out += open + index + close;
        pos = region.end;
    });
    out += text.substring(pos);
    return { text: out, regions, open, close };
}

/** Width of a line's leading whitespace, with tabs counted at `tab_size`. */
function leading_width(line: string, tab_size: number): number {
    let width = 0;
    for (let i = 0; i < line.length; i++) {
        if (line[i] === ' ') width++;
        else if (line[i] === '\t') width += tab_size;
        else break;
    }
    return width;
}

function indent_string(width: number, options: JqhtmlFormatOptions): string {
    if (options.insert_spaces) {
        return ' '.repeat(width);
    }
    const tabs = Math.floor(width / options.tab_size);
    return '\t'.repeat(tabs) + ' '.repeat(width - tabs * options.tab_size);
}

/**
 * Re-base the interior of a multi-line code block or comment so it sits one
 * level under the line that opens it, keeping the lines' indentation relative
 * to each other. A final line holding only the closer ('%>', '--%>', '-->')
 * goes back to the opening line's level. Raw-text bodies are never touched.
 */
function rebase_region(region: ProtectedRegion, host_width: number, options: JqhtmlFormatOptions): string {
    if (region.kind === 'raw_text' || region.text.indexOf('\n') === -1) {
        return region.text;
    }
    const lines = region.text.split('\n');
    const closer = region.kind === 'code' ? '%>' : region.kind === 'jqhtml_comment' ? '--%>' : '-->';
    // The last line is the block's floor - placed back at the opener's level -
    // when it is just the closer, or a closing bracket followed by the closer
    // ("]; %>", "}) %>"). Anything else on the last line is interior.
    const last = lines.length - 1;
    const last_trimmed = lines[last].trim();
    const last_is_closer = last_trimmed === closer ||
        ((last_trimmed[0] === ']' || last_trimmed[0] === '}' || last_trimmed[0] === ')') && last_trimmed.endsWith(closer));
    const interior_end = last_is_closer ? last : lines.length;

    let min = Infinity;
    for (let i = 1; i < interior_end; i++) {
        if (lines[i].trim().length) {
            min = Math.min(min, leading_width(lines[i], options.tab_size));
        }
    }
    if (min === Infinity) {
        min = 0;
    }

    const unit = options.tab_size; // one level, in columns
    const out = [lines[0]];
    for (let i = 1; i < interior_end; i++) {
        const trimmed = lines[i].trim();
        if (!trimmed.length) {
            out.push('');
            continue;
        }
        const relative = leading_width(lines[i], options.tab_size) - min;
        out.push(indent_string(host_width + unit + relative, options) + lines[i].trimEnd().trimStart());
    }
    if (last_is_closer) {
        out.push(indent_string(host_width, options) + last_trimmed);
    }
    return out.join('\n');
}

/**
 * Undo substitute() on one emitted line, in a single scan. `host_width` is
 * the indentation the line was given, in columns; multi-line regions are
 * re-based against it.
 */
function restore_line(text: string, host_width: number, sub: Substituted, options: JqhtmlFormatOptions): string {
    let out = '';
    let pos = 0;
    while (true) {
        const start = text.indexOf(sub.open, pos);
        if (start === -1) {
            break;
        }
        let i = start + 1;
        while (i < text.length && is_digit(text[i])) {
            i++;
        }
        if (text[i] !== sub.close || i === start + 1) {
            // Not a placeholder we wrote; impossible by construction, but never loop.
            out += text.substring(pos, start + 1);
            pos = start + 1;
            continue;
        }
        const index = parseInt(text.substring(start + 1, i), 10);
        out += text.substring(pos, start);
        out += rebase_region(sub.regions[index], host_width, options);
        pos = i + 1;
    }
    out += text.substring(pos);
    return out;
}

// ---------------------------------------------------------------------------
// Pass 3: measurement
// ---------------------------------------------------------------------------

/**
 * Net and minimum brace depth of a JS code block, ignoring braces inside
 * string literals, template literals, comments and regex literals.
 * `code` is the block text including its '<%' ... '%>' delimiters.
 */
function measure_braces(code: string): { min: number; net: number } {
    // Strip the delimiters and any leading '=' / '-' / '!=' modifier.
    let body = code.substring(2, code.length - 2);
    while (body.length && (body[0] === '=' || body[0] === '-' || body[0] === '!')) {
        body = body.substring(1);
    }

    let depth = 0;
    let min = 0;
    let i = 0;
    // The token before a '/' decides whether it starts a regex or is division.
    let last_significant = '';

    const regex_can_start = () =>
        last_significant === '' || '(,=:[!&|?{};+-*%<>~^'.indexOf(last_significant) !== -1 ||
        last_significant === 'return' || last_significant === 'typeof';

    while (i < body.length) {
        const ch = body[i];
        const next = body[i + 1];

        if (ch === '/' && next === '/') {
            const nl = body.indexOf('\n', i);
            i = nl === -1 ? body.length : nl + 1;
            continue;
        }
        if (ch === '/' && next === '*') {
            const end = body.indexOf('*/', i + 2);
            i = end === -1 ? body.length : end + 2;
            continue;
        }
        if (ch === '"' || ch === "'") {
            i = skip_js_string(body, i, ch);
            last_significant = 'string';
            continue;
        }
        if (ch === '`') {
            const r = measure_template(body, i);
            depth += r.net;
            min = Math.min(min, depth);
            i = r.end;
            last_significant = 'string';
            continue;
        }
        if (ch === '/' && regex_can_start()) {
            i = skip_js_regex(body, i);
            last_significant = 'regex';
            continue;
        }
        if (ch === '{') {
            depth++;
        } else if (ch === '}') {
            depth--;
            min = Math.min(min, depth);
        }

        if (is_name_start(ch) || ch === '$' || ch === '_') {
            let j = i;
            while (j < body.length && (is_name_char(body[j]) || body[j] === '$')) {
                j++;
            }
            last_significant = body.substring(i, j);
            i = j;
            continue;
        }
        if (!is_space(ch)) {
            last_significant = ch;
        }
        i++;
    }
    return { min, net: depth };
}

function skip_js_string(body: string, i: number, quote: string): number {
    i++;
    while (i < body.length) {
        if (body[i] === '\\') {
            i += 2;
            continue;
        }
        if (body[i] === quote || body[i] === '\n') {
            return i + 1;
        }
        i++;
    }
    return body.length;
}

/** Template literal: braces inside ${ } are real code and are counted. */
function measure_template(body: string, i: number): { end: number; net: number } {
    let net = 0;
    i++;
    while (i < body.length) {
        if (body[i] === '\\') {
            i += 2;
            continue;
        }
        if (body[i] === '`') {
            return { end: i + 1, net };
        }
        if (body[i] === '$' && body[i + 1] === '{') {
            // Find the matching '}' by measuring the inner expression.
            let depth = 1;
            let j = i + 2;
            while (j < body.length && depth > 0) {
                if (body[j] === '{') depth++;
                else if (body[j] === '}') depth--;
                else if (body[j] === '`') {
                    j = measure_template(body, j).end;
                    continue;
                }
                j++;
            }
            i = j;
            continue;
        }
        i++;
    }
    return { end: body.length, net };
}

function skip_js_regex(body: string, i: number): number {
    let in_class = false;
    i++;
    while (i < body.length) {
        const ch = body[i];
        if (ch === '\\') {
            i += 2;
            continue;
        }
        if (ch === '\n') {
            return i;
        }
        if (in_class) {
            if (ch === ']') in_class = false;
        } else if (ch === '[') {
            in_class = true;
        } else if (ch === '/') {
            return i + 1;
        }
        i++;
    }
    return body.length;
}

/**
 * Walk the substituted text once and record, per line, how the combined
 * HTML + JS nesting depth moves. Multi-line tags are tracked so their
 * attribute lines can be indented under the tag.
 */
function measure(sub: Substituted): LineMeasure[] {
    const text = sub.text;
    const lines: LineMeasure[] = [];

    // Running state for the line being walked.
    let line_start = 0;
    let depth = 0;
    let min = 0;
    let attr_continuation = false;
    let tag_end_line = false;

    const flush = (line_end: number) => {
        lines.push({
            text: text.substring(line_start, line_end).trim(),
            min_depth: min,
            net_depth: depth,
            attr_continuation,
            tag_end_line,
        });
        line_start = line_end + 1;
        depth = 0;
        min = 0;
        attr_continuation = false;
        tag_end_line = false;
    };

    const lower = () => {
        depth--;
        min = Math.min(min, depth);
    };

    let pos = 0;
    while (pos < text.length) {
        const ch = text[pos];

        if (ch === '\n') {
            flush(pos);
            pos++;
            continue;
        }

        // Code placeholder: measure its braces.
        if (ch === sub.open) {
            let i = pos + 1;
            while (is_digit(text[i])) i++;
            const region = sub.regions[parseInt(text.substring(pos + 1, i), 10)];
            if (region.kind === 'code') {
                const braces = measure_braces(region.text);
                min = Math.min(min, depth + braces.min);
                depth += braces.net;
            }
            pos = i + 1;
            continue;
        }

        if (ch !== '<') {
            pos++;
            continue;
        }

        // '<!' - doctype and friends. Skip; no nesting.
        if (text[pos + 1] === '!') {
            const end = skip_tag(text, pos);
            pos = end === -1 ? text.length : end;
            continue;
        }

        // Closing tag.
        if (text[pos + 1] === '/' && is_name_start(text[pos + 2] || '')) {
            lower();
            const end = text.indexOf('>', pos);
            pos = end === -1 ? text.length : end + 1;
            continue;
        }

        // Opening tag.
        if (is_name_start(text[pos + 1] || '')) {
            let i = pos + 1;
            while (i < text.length && is_name_char(text[i])) i++;
            const name = text.substring(pos + 1, i);
            const is_void = VOID_ELEMENTS.has(name) && name === name.toLowerCase();

            // Walk the attributes, honouring quotes and tracking newlines so
            // continuation lines get flagged.
            let quote: string | null = null;
            let self_closing = false;
            let opened_on_line = lines.length;
            while (i < text.length) {
                const c = text[i];
                if (quote !== null) {
                    if (c === quote) quote = null;
                    else if (c === '\n') { flush(i); attr_continuation = true; }
                    i++;
                    continue;
                }
                if (c === '"' || c === "'") {
                    quote = c;
                    i++;
                    continue;
                }
                if (c === '\n') {
                    flush(i);
                    attr_continuation = true;
                    i++;
                    continue;
                }
                if (c === sub.open) {
                    // A code block inside the tag (e.g. class="<%= x %>" unquoted form).
                    let j = i + 1;
                    while (is_digit(text[j])) j++;
                    i = j + 1;
                    continue;
                }
                if (c === '/' && text[i + 1] === '>') {
                    self_closing = true;
                    i += 2;
                    break;
                }
                if (c === '>') {
                    i++;
                    break;
                }
                i++;
            }

            if (lines.length !== opened_on_line) {
                // The tag spanned lines; this is the line holding its '>'.
                tag_end_line = true;
            }
            if (!self_closing && !is_void) {
                depth++;
            }
            pos = i;
            continue;
        }

        // A bare '<' in text content.
        pos++;
    }
    flush(text.length);

    return lines;
}

// ---------------------------------------------------------------------------
// Pass 4: emit
// ---------------------------------------------------------------------------

function is_blank(line: string): boolean {
    return line.trim().length === 0;
}

/**
 * Blank line after an opening <Define:> and before its closing tag, so every
 * component body reads as a block. Existing blank lines are respected.
 */
function apply_define_spacing(lines: string[]): string[] {
    const out: string[] = [];
    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        const next = i + 1 < lines.length ? lines[i + 1].trim() : '';
        const prev_out = out.length ? out[out.length - 1].trim() : '';

        if (trimmed.startsWith('</Define:')) {
            if (out.length && prev_out.length > 0 && !prev_out.startsWith('<Define:')) {
                out.push('');
            }
            out.push(lines[i]);
            continue;
        }

        out.push(lines[i]);

        if (trimmed.startsWith('<Define:') && trimmed.endsWith('>') && trimmed.indexOf('</') === -1) {
            if (next.length > 0 && !next.startsWith('</Define:')) {
                out.push('');
            }
        }
    }
    return out;
}

/**
 * Format a JQHTML document. Pure: the same input and options always give the
 * same output, and the result is a fixed point (formatting it again changes
 * nothing).
 *
 * Throws JqhtmlFormatError when the document is not well-formed enough to
 * indent - unterminated comment, code block, or raw-text element.
 */
export function format_jqhtml(text: string, options: JqhtmlFormatOptions): string {
    const eol = text.indexOf('\r\n') !== -1 ? '\r\n' : '\n';
    const had_final_newline = text.endsWith('\n');

    // Work in LF internally; protected regions keep whatever they had.
    const lf = eol === '\r\n' ? text.split('\r\n').join('\n') : text;

    const regions = scan_protected_regions(lf);
    const sub = substitute(lf, regions);
    const measures = measure(sub);

    const out: string[] = [];
    let level = 0;
    let continuation_base = 0;

    for (const m of measures) {
        let indent: number;

        if (m.attr_continuation) {
            // Attributes sit one level under their tag; the closing '>' line too.
            indent = continuation_base + 1;
        } else {
            indent = level + m.min_depth;
        }

        if (!m.attr_continuation && !m.tag_end_line) {
            continuation_base = indent;
        }

        // Where a multi-line tag ends, its children start from the tag's own
        // level, not from the continuation indent.
        level = (m.attr_continuation ? continuation_base : level) + m.net_depth;

        if (m.text.length === 0) {
            out.push('');
            continue;
        }
        const width = Math.max(0, indent) * options.tab_size;
        out.push(restore_line(indent_string(width, options) + m.text, width, sub, options));
    }

    // A multi-line region's interior lines are now inline; split them out
    // again so the Define spacing and blank-line trimming see real lines.
    let lines = apply_define_spacing(out.join('\n').split('\n'));

    // Drop leading and trailing blank lines; keep the final newline if the
    // document had one so files.insertFinalNewline is not fought over.
    while (lines.length && is_blank(lines[0])) lines.shift();
    while (lines.length && is_blank(lines[lines.length - 1])) lines.pop();

    let result = lines.join(eol);
    if (had_final_newline && result.length) {
        result += eol;
    }
    return result;
}

// ---------------------------------------------------------------------------
// VS Code provider
// ---------------------------------------------------------------------------

/**
 * Minimal edits between two texts: everything before the first differing
 * line and after the last differing line is left alone, so the editor keeps
 * folding, selection and undo granularity for the untouched majority.
 */
function line_diff_edits(document: vscode.TextDocument, formatted: string): vscode.TextEdit[] {
    const before = document.getText();
    if (before === formatted) {
        return [];
    }
    const a = before.split('\n');
    const b = formatted.split('\n');

    let head = 0;
    while (head < a.length && head < b.length && a[head] === b[head]) head++;

    let tail = 0;
    while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;

    const start = document.positionAt(a.slice(0, head).join('\n').length + (head > 0 ? 1 : 0));
    const end_offset = before.length - (a.slice(a.length - tail).join('\n').length + (tail > 0 ? 1 : 0));
    const end = document.positionAt(end_offset);
    const replacement = b.slice(head, b.length - tail).join('\n');

    return [vscode.TextEdit.replace(new vscode.Range(start, end), replacement)];
}

export class JqhtmlFormattingEditProvider
    implements vscode.DocumentFormattingEditProvider, vscode.DocumentRangeFormattingEditProvider {

    provideDocumentFormattingEdits(
        document: vscode.TextDocument,
        options: vscode.FormattingOptions
    ): vscode.TextEdit[] {
        const formatted = this.run(document, options);
        return formatted === null ? [] : line_diff_edits(document, formatted);
    }

    /**
     * Range formatting re-indents the requested lines in the context of the
     * whole document (indentation is not meaningful in isolation), then keeps
     * only the edits that fall inside the selection.
     */
    provideDocumentRangeFormattingEdits(
        document: vscode.TextDocument,
        range: vscode.Range,
        options: vscode.FormattingOptions
    ): vscode.TextEdit[] {
        const formatted = this.run(document, options);
        if (formatted === null) {
            return [];
        }
        const a = document.getText().split('\n');
        const b = formatted.split('\n');
        if (a.length !== b.length) {
            // Define spacing changed the line count; only a whole-document
            // format can express that faithfully.
            return line_diff_edits(document, formatted);
        }
        const edits: vscode.TextEdit[] = [];
        for (let i = range.start.line; i <= range.end.line && i < a.length; i++) {
            if (a[i] !== b[i]) {
                const line = document.lineAt(i);
                const replacement = b[i].endsWith('\r') ? b[i].substring(0, b[i].length - 1) : b[i];
                edits.push(vscode.TextEdit.replace(line.range, replacement));
            }
        }
        return edits;
    }

    /** Backwards-compatible entry point used by older callers and the CLI stub. */
    formatDocument(document: vscode.TextDocument, options?: vscode.FormattingOptions): string {
        return format_jqhtml(document.getText(), {
            tab_size: options ? options.tabSize : 4,
            insert_spaces: options ? options.insertSpaces : true,
        });
    }

    private run(document: vscode.TextDocument, options: vscode.FormattingOptions): string | null {
        try {
            return this.formatDocument(document, options);
        } catch (err) {
            if (err instanceof JqhtmlFormatError) {
                const where = document.positionAt(err.offset);
                vscode.window.showWarningMessage(
                    `JQHTML: not formatted - ${err.message} (line ${where.line + 1})`
                );
                return null;
            }
            throw err;
        }
    }
}
