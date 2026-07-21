import * as vscode from 'vscode';
import { JqhtmlFormattingEditProvider } from './formatter';
import { JqhtmlComponentIndex } from './componentIndex';
import { JqhtmlDefinitionProvider, JqhtmlHoverProvider } from './definitionProvider';
import { BladeComponentSemanticTokensProvider } from './blade_component_provider';
import { blade_spacer } from './blade_spacer';
import { init_blade_language_config } from './blade_language_config';

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
    console.log('JQHTML extension activated');

    // Initialize component index
    const componentIndex = new JqhtmlComponentIndex();
    context.subscriptions.push({
        dispose: () => componentIndex.dispose()
    });

    // Register the formatter
    const formatter = new JqhtmlFormattingEditProvider();
    const formatterProvider = vscode.languages.registerDocumentFormattingEditProvider(
        'jqhtml',
        formatter
    );
    context.subscriptions.push(formatterProvider);

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
        const text = change.text;

        // Check if user typed '>'
        if (text === '>') {
            const position = change.range.start;
            const line = event.document.lineAt(position.line);
            const lineText = line.text.substring(0, position.character + 1);

            // Match opening tags: <ComponentName>, <Define:Name>, <Slot:Name>, or regular HTML tags
            // Look for self-closing indicators /> or existing closing tags
            const openingTagMatch = lineText.match(/<(\/?)(Define:|Slot:)?([A-Z][A-Za-z0-9_]*|\w+)(?:\s+[^>]*)?>$/);

            if (openingTagMatch && !openingTagMatch[1]) { // Not a closing tag (no /)
                const tagPrefix = openingTagMatch[2] || ''; // 'Define:' or 'Slot:' or ''
                const tagName = openingTagMatch[3];

                // Check if it's self-closing or already has a closing tag
                const beforeTag = lineText.substring(0, lineText.lastIndexOf('<'));
                if (beforeTag.endsWith('/')) {
                    return; // Self-closing tag
                }

                // Check if this is a slot tag (starts with Slot:)
                const isSlot = tagPrefix === 'Slot:';

                // For slots, check if it's self-closing syntax
                if (isSlot && lineText.match(/<Slot:\w+\s*\/?>$/)) {
                    // Don't auto-close self-closing slots
                    if (lineText.endsWith('/>')) {
                        return;
                    }
                }

                // Check if we should auto-close this tag
                // Component tags (start with capital), Define: tags, and slot tags
                const shouldAutoClose = tagName[0] === tagName[0].toUpperCase() ||
                                       tagPrefix === 'Define:' ||
                                       isSlot ||
                                       isHtmlTag(tagName);

                if (shouldAutoClose) {
                    // Build the closing tag
                    let closingTag = '';
                    if (isSlot) {
                        closingTag = `</Slot:${tagName}>`;
                    } else {
                        closingTag = `</${tagPrefix}${tagName}>`;
                    }

                    // Insert the closing tag
                    activeEditor.edit((editBuilder: vscode.TextEditorEdit) => {
                        const insertPosition = position.translate(0, 1);
                        editBuilder.insert(insertPosition, closingTag);
                    }, { undoStopBefore: false, undoStopAfter: false }).then(() => {
                        // Move cursor between the tags
                        const newPosition = position.translate(0, 1);
                        activeEditor.selection = new vscode.Selection(newPosition, newPosition);
                    });
                }
            }
        }
    });

    context.subscriptions.push(autoCloseDisposable);

    // Register format on save if enabled
    const config = vscode.workspace.getConfiguration('editor');
    if (config.get('formatOnSave')) {
        console.log('JQHTML: Format on save is enabled');
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
        console.log('JQHTML: Blade component highlighting registered');

        // Register Blade auto-spacing ({{ -> {{ | }})
        const getAutoSpacingEnabled = () => {
            return vscode.workspace.getConfiguration('jqhtml').get('enableBladeAutoSpacing', true);
        };

        context.subscriptions.push(
            vscode.workspace.onDidChangeTextDocument((event) => {
                blade_spacer(event, vscode.window.activeTextEditor, getAutoSpacingEnabled());
            })
        );
        console.log('JQHTML: Blade auto-spacing registered');

        // Initialize Blade language configuration (indentation rules)
        init_blade_language_config();
        console.log('JQHTML: Blade language configuration initialized');
    } else {
        console.log('JQHTML: Blade support disabled via settings');
    }

    console.log('JQHTML: All features registered (formatter, auto-close, goto definition, hover)');

    // Return public API for other extensions
    return {
        findComponent: (name: string) => componentIndex.findComponent(name),
        getAllComponentNames: () => componentIndex.getAllComponentNames(),
        reindexWorkspace: () => componentIndex.reindexWorkspace()
    };
}

// Helper function to check if a tag is a standard HTML tag
function isHtmlTag(tagName: string): boolean {
    const htmlTags = [
        'div', 'span', 'p', 'a', 'button', 'input', 'form', 'header', 'footer',
        'section', 'article', 'nav', 'main', 'aside', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'ul', 'ol', 'li', 'table', 'tr', 'td', 'th', 'thead', 'tbody', 'tfoot',
        'img', 'video', 'audio', 'canvas', 'svg', 'iframe', 'label', 'select', 'option',
        'textarea', 'fieldset', 'legend', 'details', 'summary', 'dialog', 'template',
        'blockquote', 'pre', 'code', 'em', 'strong', 'small', 'mark', 'del', 'ins', 'sub', 'sup'
    ];
    return htmlTags.includes(tagName.toLowerCase());
}

export function deactivate() {
    console.log('JQHTML extension deactivated');
}