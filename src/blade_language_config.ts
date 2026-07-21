import * as vscode from 'vscode';

/**
 * Initialize Blade language configuration
 *
 * Sets up:
 * - Indentation rules for Blade templates
 * - Auto-indent behavior when pressing Enter between tags
 * - Word pattern for Blade files
 *
 * Call this once during extension activation.
 */
export const init_blade_language_config = () => {
    // HTML empty elements that don't require closing tags
    const EMPTY_ELEMENTS: string[] = [
        'area',
        'base',
        'br',
        'col',
        'embed',
        'hr',
        'img',
        'input',
        'keygen',
        'link',
        'menuitem',
        'meta',
        'param',
        'source',
        'track',
        'wbr',
    ];

    // Configure Blade language indentation and auto-closing behavior
    vscode.languages.setLanguageConfiguration('blade', {
        indentationRules: {
            // Increase indent after opening tag (except void elements and self-closing)
            increaseIndentPattern:
                /<(?!\?|(?:area|base|br|col|frame|hr|html|img|input|link|meta|param)\b|[^>]*\/>)([-_\.A-Za-z0-9]+)(?=\s|>)\b[^>]*>(?!.*<\/\1>)|<!--(?!.*-->)|\{[^}"']*$/,
            // Decrease indent on closing tag
            decreaseIndentPattern:
                /^\s*(<\/(?!html)[-_\.A-Za-z0-9]+\b[^>]*>|-->|\})/,
        },
        wordPattern:
            /(-?\d*\.\d\w*)|([^\`\~\!\@\$\^\&\*\(\)\=\+\[\{\]\}\\\|\;\:\'\"\,\.\<\>\/\s]+)/g,
        onEnterRules: [
            {
                // When pressing Enter between opening and closing tags, auto-indent
                // e.g., <div>|</div> -> <div>\n  |\n</div>
                beforeText: new RegExp(
                    `<(?!(?:${EMPTY_ELEMENTS.join(
                        '|'
                    )}))([_:\\w][_:\\w-.\\d]*)([^/>]*(?!/)>)[^<]*$`,
                    'i'
                ),
                afterText: /^<\/([_:\w][_:\w-.\d]*)\s*>$/i,
                action: { indentAction: vscode.IndentAction.IndentOutdent },
            },
            {
                // When pressing Enter after opening tag, auto-indent
                // e.g., <div>| -> <div>\n  |
                beforeText: new RegExp(
                    `<(?!(?:${EMPTY_ELEMENTS.join(
                        '|'
                    )}))(\\w[\\w\\d]*)([^/>]*(?!/)>)[^<]*$`,
                    'i'
                ),
                action: { indentAction: vscode.IndentAction.Indent },
            },
        ],
    });
};
