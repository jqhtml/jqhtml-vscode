import * as vscode from 'vscode';

/**
 * Blade Auto-Spacing Provider
 *
 * Automatically adds spaces inside Blade tags when typing:
 *   {{ -> {{ | }} (cursor at |)
 *   {!! -> {!! | !!}
 *   {{-- -> {{-- | --}}
 *
 * Configuration:
 *   Set 'jqhtml.enableBladeAutoSpacing' to false to disable
 *   (or modify the config key below to match your extension's namespace)
 */

const TAG_DOUBLE = 0;
const TAG_UNESCAPED = 1;
const TAG_COMMENT = 2;

const snippets: Record<number, string> = {
    [TAG_DOUBLE]: '{{ ${1:${TM_SELECTED_TEXT/[{}]//g}} }}$0',
    [TAG_UNESCAPED]: '{!! ${1:${TM_SELECTED_TEXT/[{} !]//g}} !!}$0',
    [TAG_COMMENT]: '{{-- ${1:${TM_SELECTED_TEXT/(--)|[{} ]//g}} --}}$0',
};

const triggers = ['{}', '!', '-', '{'];

const regexes = [
    /({{(?!\s|-))(.*?)(}})/,
    /({!!(?!\s))(.*?)?(}?)/,
    /({{[\s]?--)(.*?)?(}})/,
];

const translate = (position: vscode.Position, offset: number): vscode.Position => {
    try {
        return position.translate(0, offset);
    } catch (error) {
        // VS Code doesn't like negative numbers passed
        // to translate (even though it works fine), so
        // this block prevents debug console errors
    }

    return position;
};

const chars_for_change = (
    doc: vscode.TextDocument,
    change: vscode.TextDocumentContentChangeEvent
): number => {
    if (change.text === '!') {
        return 2;
    }

    if (change.text !== '-') {
        return 1;
    }

    const start = translate(change.range.start, -2);
    const end = translate(change.range.start, -1);

    return doc.getText(new vscode.Range(start, end)) === ' ' ? 4 : 3;
};

/**
 * Main entry point - call this from onDidChangeTextDocument
 *
 * @param e - The text document change event
 * @param editor - The active text editor (optional)
 * @param config_enabled - Whether auto-spacing is enabled (default: true)
 *                        Pass your own config check here, e.g.:
 *                        vscode.workspace.getConfiguration('jqhtml').get('enableBladeAutoSpacing', true)
 */
export const blade_spacer = async (
    e: vscode.TextDocumentChangeEvent,
    editor?: vscode.TextEditor,
    config_enabled: boolean = true
) => {
    if (
        !config_enabled ||
        !editor ||
        editor.document.fileName.indexOf('.blade.php') === -1
    ) {
        return;
    }

    let tag_type: number = -1;
    let ranges: vscode.Range[] = [];
    let offsets: number[] = [];

    // Changes (per line) come in right-to-left when we need them left-to-right
    const changes = e.contentChanges.slice().reverse();

    changes.forEach((change) => {
        if (triggers.indexOf(change.text) === -1) {
            return;
        }

        if (!offsets[change.range.start.line]) {
            offsets[change.range.start.line] = 0;
        }

        const start_offset =
            offsets[change.range.start.line] -
            chars_for_change(e.document, change);

        const start = translate(change.range.start, start_offset);
        const line_end = e.document.lineAt(start.line).range.end;

        for (let i = 0; i < regexes.length; i++) {
            // If we typed a - or a !, don't consider the "double" tag type
            if (i === TAG_DOUBLE && ['-', '!'].indexOf(change.text) !== -1) {
                continue;
            }

            // Only look at unescaped tags if we need to
            if (i === TAG_UNESCAPED && change.text !== '!') {
                continue;
            }

            // Only look at comment tags if we need to
            if (i === TAG_COMMENT && change.text !== '-') {
                continue;
            }

            const tag = regexes[i].exec(
                e.document.getText(new vscode.Range(start, line_end))
            );

            if (tag) {
                tag_type = i;
                ranges.push(
                    new vscode.Range(start, start.translate(0, tag[0].length))
                );
                offsets[start.line] += tag[1].length;
            }
        }
    });

    if (ranges.length > 0 && snippets[tag_type]) {
        editor.insertSnippet(new vscode.SnippetString(snippets[tag_type]), ranges);
    }
};
