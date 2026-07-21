import * as vscode from 'vscode';

/**
 * Provides semantic tokens for uppercase component tags in Blade files
 *
 * This provider highlights:
 * - Component tag names in cyan/turquoise (using 'class' token type)
 * - The tag="" attribute on jqhtml components in orange (using 'jqhtmlTagAttribute' token type)
 *
 * Usage:
 *   Register with vscode.languages.registerDocumentSemanticTokensProvider()
 *   using SemanticTokensLegend(['class', 'jqhtmlTagAttribute'])
 */
export class BladeComponentSemanticTokensProvider implements vscode.DocumentSemanticTokensProvider {
    async provideDocumentSemanticTokens(document: vscode.TextDocument): Promise<vscode.SemanticTokens> {
        const tokens_builder = new vscode.SemanticTokensBuilder();

        // Only process Blade files
        if (document.languageId !== 'blade') {
            return tokens_builder.build();
        }

        const text = document.getText();

        // Match opening tags that start with uppercase letter to find jqhtml components
        // Matches: <ComponentName ...>, captures the entire tag up to >
        const component_tag_regex = /<([A-Z][a-zA-Z0-9_]*)([^>]*?)>/g;
        let component_match;

        while ((component_match = component_tag_regex.exec(text)) !== null) {
            const tag_name = component_match[1];
            const tag_attributes = component_match[2];
            const tag_start = component_match.index + component_match[0].indexOf(tag_name);
            const tag_position = document.positionAt(tag_start);

            // Push token for the component tag name
            // Token type 0 maps to 'class' which VS Code themes style as entity.name.class (turquoise/cyan)
            tokens_builder.push(tag_position.line, tag_position.character, tag_name.length, 0, 0);

            // Now look for tag="" attribute within this component's attributes
            // Matches: tag="..." or tag='...'
            const tag_attr_regex = /\btag\s*=/g;
            let attr_match;

            while ((attr_match = tag_attr_regex.exec(tag_attributes)) !== null) {
                // Calculate the position of 'tag' within the document
                const attr_start = component_match.index + component_match[0].indexOf(tag_attributes) + attr_match.index;
                const attr_position = document.positionAt(attr_start);

                // Push token for 'tag' attribute name
                // Token type 1 maps to 'jqhtmlTagAttribute' which we'll define to be orange
                tokens_builder.push(attr_position.line, attr_position.character, 3, 1, 0);
            }
        }

        // Also match closing tags that start with uppercase letter
        // Matches: </ComponentName>
        const closing_tag_regex = /<\/([A-Z][a-zA-Z0-9_]*)/g;
        let closing_match;

        while ((closing_match = closing_tag_regex.exec(text)) !== null) {
            const tag_name = closing_match[1];
            const tag_start = closing_match.index + closing_match[0].indexOf(tag_name);
            const position = document.positionAt(tag_start);

            // Push token for the tag name
            // Token type 0 maps to 'class' which VS Code themes style as entity.name.class (turquoise/cyan)
            tokens_builder.push(position.line, position.character, tag_name.length, 0, 0);
        }

        return tokens_builder.build();
    }
}
