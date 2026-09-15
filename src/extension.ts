import * as vscode from 'vscode';
import { JqhtmlFormattingEditProvider } from './formatter';
import { JqhtmlComponentIndex } from './componentIndex';
import { JqhtmlDefinitionProvider, JqhtmlHoverProvider } from './definitionProvider';
import { BladeComponentSemanticTokensProvider } from './blade_component_provider';
import { blade_spacer } from './blade_spacer';
import { init_blade_language_config } from './blade_language_config';
import { COMPONENT_NAME_SOURCE, is_component_name } from './component_name';
import { log } from './log';

/**
 * JQHTML Language Extension
 *
 * Provides:
 * - Syntax highlighting through TextMate grammar
 * - Auto-formatting for proper indentation
 * - Auto-closing tags for components and Define tags
 * - Go to definition for components (Ctrl/Cmd+Click or F12)
 * - Hover information showing component definitions
 * - Automatic indexing of all JQHTML components in workspace
 *
 * Future enhancements could include:
 * - Validation of component usage
 * - Auto-completion for component props
 * - Find all references to components
 * - Rename component refactoring
 */

/**
 * Public API for JQHTML Extension
 *
 * Allows other extensions (like RSpade Blade) to leverage the component index
 * for implementing "Go to Definition" in other file types that use JQHTML components.
 */
export interface JqhtmlExtensionAPI {
    /**
     * Find a JQHTML component definition by name
     *
     * @param name - Component name (e.g., "UserCard", "StatusBadge")
     * @returns Component definition with uri and position, or undefined if not found
     */
    findComponent(name: string): {
        uri: vscode.Uri;
        position: vscode.Position;
        name: string;
        line: string;
    } | undefined;

    /**
     * Get all registered component names
     *
     * @returns Array of component names
     */
    getAllComponentNames(): string[];

    /**
     * Force a re-index of all JQHTML files in the workspace
     */
    reindexWorkspace(): Promise<void>;
}

export function activate(context: vscode.ExtensionContext): JqhtmlExtensionAPI {
    log.activate(context);
    log.info('JQHTML extension activated');

    // Initialize component index
    const componentIndex = new JqhtmlComponentIndex();
    context.subscriptions.push({
        dispose: () => componentIndex.dispose()
    });

    // Register the formatter
    const formatter = new JqhtmlFormattingEditProvider();
    context.subscriptions.push(
        vscode.languages.registerDocumentFormattingEditProvider('jqhtml', formatter),
        vscode.languages.registerDocumentRangeFormattingEditProvider('jqhtml', formatter)
    );

    // Register definition provider for goto definition (Ctrl+Click, F12)
    const definitionProvider = new JqhtmlDefinitionProvider(componentIndex);
    const definitionProviderDisposable = vscode.languages.registerDefinitionProvider(
        'jqhtml',
        definitionProvider
    );
    context.subscriptions.push(definitionProviderDisposable);

    // Register hover provider for component information
    const hoverProvider = new JqhtmlHoverProvider(componentIndex);
    const hoverProviderDisposable = vscode.languages.registerHoverProvider(
        'jqhtml',
        hoverProvider
    );
    context.subscriptions.push(hoverProviderDisposable);

    // Register auto-closing tag functionality
    const autoCloseDisposable = vscode.workspace.onDidChangeTextDocument((event: vscode.TextDocumentChangeEvent) => {
        if (event.document.languageId !== 'jqhtml') {
            return;
        }

        // Check if we should auto-close
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor || activeEditor.document !== event.document) {
            return;
        }

        // Only process single character changes (typing)
        if (event.contentChanges.length !== 1) {
            return;
        }

        const change = event.contentChanges[0];
        if (change.text !== '>') {
            return;
        }

        const position = change.range.start;
        const closingTag = closing_tag_for(event.document, position);
        if (!closingTag) {
            return;
        }

        activeEditor.edit((editBuilder: vscode.TextEditorEdit) => {
            editBuilder.insert(position.translate(0, 1), closingTag);
        }, { undoStopBefore: false, undoStopAfter: false }).then(() => {
            // Leave the cursor between the tags
            const newPosition = position.translate(0, 1);
            activeEditor.selection = new vscode.Selection(newPosition, newPosition);
        });
    });

    context.subscriptions.push(autoCloseDisposable);

    // Register format on save if enabled
    const config = vscode.workspace.getConfiguration('editor');
    if (config.get('formatOnSave')) {
        log.info('JQHTML: Format on save is enabled');
    }

    // =========================================================================
    // BLADE SUPPORT (Optional - controlled by jqhtml.enableBladeSupport setting)
    // =========================================================================
    const jqhtmlConfig = vscode.workspace.getConfiguration('jqhtml');
    const bladeSupport = jqhtmlConfig.get('enableBladeSupport', true);

    if (bladeSupport) {
        // Register Blade component semantic tokens provider
        // Highlights component tag names and tag="" attributes in .blade.php files
        const bladeComponentProvider = new BladeComponentSemanticTokensProvider();
        context.subscriptions.push(
            vscode.languages.registerDocumentSemanticTokensProvider(
                [{ language: 'blade' }, { pattern: '**/*.blade.php' }],
                bladeComponentProvider,
                new vscode.SemanticTokensLegend(['class', 'jqhtmlTagAttribute'])
            )
        );
        log.info('JQHTML: Blade component highlighting registered');

        // Register Blade auto-spacing ({{ -> {{ | }})
        const getAutoSpacingEnabled = () => {
            return vscode.workspace.getConfiguration('jqhtml').get('enableBladeAutoSpacing', true);
        };

        context.subscriptions.push(
            vscode.workspace.onDidChangeTextDocument((event) => {
                blade_spacer(event, vscode.window.activeTextEditor, getAutoSpacingEnabled());
            })
        );
        log.info('JQHTML: Blade auto-spacing registered');

        // Initialize Blade language configuration (indentation rules)
        init_blade_language_config();
        log.info('JQHTML: Blade language configuration initialized');
    } else {
        log.info('JQHTML: Blade support disabled via settings');
    }

    log.info('JQHTML: All features registered (formatter, auto-close, goto definition, hover)');

    // Return public API for other extensions
    return {
        findComponent: (name: string) => componentIndex.findComponent(name),
        getAllComponentNames: () => componentIndex.getAllComponentNames(),
        reindexWorkspace: () => componentIndex.reindexWorkspace()
    };
}

/**
 * HTML elements that must not be closed - everything else lowercase gets a
 * closing tag, so hyphenated custom elements work without a maintained list.
 */
const VOID_ELEMENTS = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
    'link', 'meta', 'param', 'source', 'track', 'wbr'
]);

const HTML_NAME_SOURCE = '[a-z][a-z0-9\\-]*';
const SLOT_NAME_SOURCE = '[A-Za-z0-9_]+';

const SLOT_TAG = new RegExp(`<Slot:(${SLOT_NAME_SOURCE})(?:\\s[^>]*)?>$`);
const DEFINE_TAG = new RegExp(`<Define:(${COMPONENT_NAME_SOURCE})(?:\\s[^>]*)?>$`);
const PLAIN_TAG = new RegExp(`<(${COMPONENT_NAME_SOURCE}|${HTML_NAME_SOURCE})(?:\\s[^>]*)?>$`);

/** How far back the code/comment scan looks - a linear scan, but bounded. */
const CONTEXT_SCAN_LINES = 200;

/**
 * Is `position` inside a <% ... %> block, a <%-- --%> or an <!-- --> comment?
 *
 * A single linear pass over the preceding text; the state at the end is the
 * state at the cursor. The scan starts at most CONTEXT_SCAN_LINES back, which
 * can mis-read a block opened further up - acceptable for a typing heuristic.
 */
function in_code_or_comment(document: vscode.TextDocument, position: vscode.Position): boolean {
    const first_line = Math.max(0, position.line - CONTEXT_SCAN_LINES);
    const text = document.getText(new vscode.Range(new vscode.Position(first_line, 0), position));

    type State = 'text' | 'code' | 'template_comment' | 'html_comment';
    let state: State = 'text';
    let i = 0;

    while (i < text.length) {
        if (state === 'text') {
            if (text.startsWith('<%--', i)) { state = 'template_comment'; i += 4; }
            else if (text.startsWith('<%', i)) { state = 'code'; i += 2; }
            else if (text.startsWith('<!--', i)) { state = 'html_comment'; i += 4; }
            else { i++; }
        } else if (state === 'code') {
            if (text.startsWith('%>', i)) { state = 'text'; i += 2; } else { i++; }
        } else if (state === 'template_comment') {
            if (text.startsWith('--%>', i)) { state = 'text'; i += 4; } else { i++; }
        } else {
            if (text.startsWith('-->', i)) { state = 'text'; i += 3; } else { i++; }
        }
    }

    return state !== 'text';
}

/**
 * The closing tag to insert after a `>` just typed at `position`, or undefined
 * when nothing should be inserted.
 */
export function closing_tag_for(
    document: vscode.TextDocument,
    position: vscode.Position
): string | undefined {
    const lineText = document.lineAt(position.line).text;
    const before = lineText.substring(0, position.character);

    // `<Foo />` - the character before the `>` closes the tag itself.
    if (before.endsWith('/')) {
        return undefined;
    }

    // A `>` inside <% %> / <%-- --%> / <!-- --> is not a tag at all.
    if (in_code_or_comment(document, position)) {
        return undefined;
    }

    const upToTag = before + '>';

    let closing: string | undefined;

    const slot = upToTag.match(SLOT_TAG);
    const define = slot ? null : upToTag.match(DEFINE_TAG);
    const plain = slot || define ? null : upToTag.match(PLAIN_TAG);

    if (slot) {
        closing = `</Slot:${slot[1]}>`;
    } else if (define) {
        closing = `</Define:${define[1]}>`;
    } else if (plain) {
        const name = plain[1];
        if (is_component_name(name)) {
            closing = `</${name}>`;
        } else if (!VOID_ELEMENTS.has(name.toLowerCase())) {
            closing = `</${name}>`;
        }
    }

    if (!closing) {
        return undefined;
    }

    // Already closed: `<Foo>` typed in front of an existing `</Foo>`.
    const after = lineText.substring(position.character + 1);
    if (after.replace(/^\s*/, '').startsWith(closing)) {
        return undefined;
    }

    return closing;
}

export function deactivate() {
    log.info('JQHTML extension deactivated');
}