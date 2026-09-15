import * as vscode from 'vscode';
import { TextDecoder } from 'util';
import { build_exclude_pattern } from './excludes';
import { JqhtmlComponentIndex } from './componentIndex';
import { COMPONENT_NAME_SOURCE, COMPONENT_NAME_WORD } from './component_name';
import { log } from './log';

const DEFINE_NAME = new RegExp(`<Define:(${COMPONENT_NAME_SOURCE})`);

/** Slot names are ordinary identifiers - the lexer accepts [A-Za-z0-9_]+. */
const SLOT_NAME_SOURCE = '[A-Za-z0-9_]+';

/** Files a JS class/function definition may live in. */
const JS_FILE_PATTERN = /\.(js|mjs|ts)$/;

/** End of a JS identifier: \b does not stop at `$`, which is a name character. */
const IDENTIFIER_END = '(?![A-Za-z0-9_$])';

/** $ and other regex metacharacters are legal in JS identifiers. */
function escape_regex(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Position of a byte offset in a string we read ourselves (no TextDocument). */
function position_at(text: string, offset: number): vscode.Position {
    let line = 0;
    let last_newline = -1;
    for (let i = 0; i < offset && i < text.length; i++) {
        if (text[i] === '\n') {
            line++;
            last_newline = i;
        }
    }
    return new vscode.Position(line, offset - last_newline - 1);
}

/**
 * The $ attribute expression under the cursor.
 *
 * `via_this` records that the expression was written as `this.x`: the class name
 * has already been resolved to the enclosing <Define:> component, but the search
 * rules for `this` differ (no language-server probe, no standalone function).
 */
interface DollarAttributeContext {
    className: string;
    memberName?: string;
    isFirstSegment: boolean;
    via_this: boolean;
}

/**
 * One workspace .js scan, shared between the class and the function search so a
 * single Go to Definition never lists or reads the workspace twice.
 */
interface JsScan {
    files?: vscode.Uri[];
    texts: Map<string, string>;
}

/**
 * JQHTML Definition Provider
 *
 * Provides "Go to Definition" functionality for JQHTML components.
 * When a user Ctrl/Cmd+clicks on a component name or uses F12,
 * this provider will locate the component definition.
 */
export class JqhtmlDefinitionProvider implements vscode.DefinitionProvider {
    constructor(private componentIndex: JqhtmlComponentIndex) {}

    public async provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Definition | undefined> {
        log.debug(`definition: ${document.uri.fsPath}:${position.line + 1}:${position.character}`);

        const line = document.lineAt(position.line).text;

        // Check if we're in a $ attribute with unquoted value
        const dollarAttrResult = this.checkDollarAttributeContext(document, position, line);
        if (dollarAttrResult) {
            log.debug(`definition: $ attribute context ${JSON.stringify(dollarAttrResult)}`);
            return await this.handleDollarAttributeDefinition(document, position, dollarAttrResult, token);
        }

        // Check for slot syntax BEFORE extracting a word, so slot names are not
        // treated as component names.
        const beforeCursor = line.substring(0, position.character);
        if (beforeCursor.match(new RegExp(`<\\/?Slot:\\s*${SLOT_NAME_SOURCE}$`))) {
            const slotNameMatch = line.match(new RegExp(`<\\/?Slot:\\s*(${SLOT_NAME_SOURCE})`));
            if (slotNameMatch) {
                const slotName = slotNameMatch[1];
                log.debug(`definition: slot tag ${slotName}`);
                return await this.handleSlotDefinition(document, position, slotName);
            }
        }

        // Get the word at the cursor position
        const wordRange = document.getWordRangeAtPosition(position, COMPONENT_NAME_WORD);
        if (!wordRange) {
            return undefined;
        }

        const word = document.getText(wordRange);

        // Check if this looks like a component reference
        if (!JqhtmlComponentIndex.isComponentReference(word)) {
            return undefined;
        }

        // Check if this word is inside an extends="" attribute value
        let beforeWord = line.substring(0, wordRange.start.character);
        if (beforeWord.match(/extends\s*=\s*["']?\s*$/)) {
            const componentDef = this.componentIndex.findComponent(word);
            if (!componentDef) {
                log.debug(`definition: component '${word}' not in index`);
                return undefined;
            }

            // Verify the file still exists
            try {
                await vscode.workspace.fs.stat(componentDef.uri);
            } catch {
                log.debug(`definition: '${word}' definition file no longer exists`);
                this.componentIndex.reindexWorkspace();
                return undefined;
            }

            return new vscode.Location(componentDef.uri, componentDef.position);
        }

        // Check if this word is in a tag context
        let isInTagContext = false;

        // Opening tag: <ComponentName or <Define:ComponentName
        beforeWord = line.substring(0, wordRange.start.character);
        if (beforeWord.match(/<\s*$/) || beforeWord.match(/<Define:\s*$/)) {
            isInTagContext = true;
        }

        // Closing tag: </ComponentName or </Define:ComponentName
        if (beforeWord.match(/<\/\s*$/) || beforeWord.match(/<\/Define:\s*$/)) {
            isInTagContext = true;
        }

        if (!isInTagContext) {
            // Also check if cursor is inside the tag name (not in attributes)
            const afterWord = line.substring(wordRange.end.character);

            if ((afterWord.match(/^[\s>]/) || afterWord.length === 0) && beforeWord.includes('<')) {
                const lastLessThan = beforeWord.lastIndexOf('<');
                const lastGreaterThan = beforeWord.lastIndexOf('>');

                if (lastLessThan > lastGreaterThan) {
                    isInTagContext = true;
                }
            }
        }

        if (!isInTagContext) {
            log.debug(`definition: '${word}' not in tag context`);
            return undefined;
        }

        log.debug(`definition: index contains ${this.componentIndex.getAllComponentNames().join(', ')}`);

        // Look up the component in our index
        const componentDef = this.componentIndex.findComponent(word);
        if (!componentDef) {
            // Not indexed: VS Code falls back to its other definition providers,
            // which is how a component name can resolve into a CSS file.
            log.debug(`definition: component '${word}' not found in index`);
            return undefined;
        }

        // Verify the file still exists (catches stale index entries)
        try {
            await vscode.workspace.fs.stat(componentDef.uri);
        } catch {
            log.debug(`definition: '${word}' file is gone (${componentDef.uri.fsPath}), reindexing`);
            this.componentIndex.reindexWorkspace(); // Async, non-blocking
            return undefined;
        }

        log.debug(`definition: '${word}' -> ${componentDef.uri.fsPath}:${componentDef.position.line + 1}`);
        return new vscode.Location(componentDef.uri, componentDef.position);
    }

    /**
     * Check if cursor is in a $ attribute with unquoted value like $handler=Controller.method
     * Returns the parsed segments and position info, or undefined if not in such context
     */
    private checkDollarAttributeContext(document: vscode.TextDocument, position: vscode.Position, line: string):
        DollarAttributeContext | undefined {

        const char = position.character;
        const beforeCursor = line.substring(0, char);
        const afterCursor = line.substring(char);

        // Look for pattern: $attributeName=FirstSegment.secondSegment
        const dollarAttrMatch = beforeCursor.match(/\$\w+\s*=\s*([a-zA-Z_$][a-zA-Z0-9_$]*(?:\.[a-zA-Z_$][a-zA-Z0-9_$]*)*)$/);
        if (!dollarAttrMatch) {
            return undefined;
        }

        // Get the full expression (before cursor + until space or >)
        const expressionBeforeCursor = dollarAttrMatch[1];
        const expressionAfterCursor = afterCursor.match(/^([a-zA-Z0-9_$]*)/)?.[1] || '';
        const fullExpression = expressionBeforeCursor + expressionAfterCursor;

        // Split by dots
        const segments = fullExpression.split('.');

        // Determine which segment we're on based on cursor position
        const expressionStartChar = char - expressionBeforeCursor.length;
        const cursorOffsetInExpression = char - expressionStartChar;

        let currentSegmentIndex = 0;
        let charCount = 0;
        for (let i = 0; i < segments.length; i++) {
            const segmentLength = segments[i].length;
            if (cursorOffsetInExpression <= charCount + segmentLength) {
                currentSegmentIndex = i;
                break;
            }
            charCount += segmentLength + 1; // +1 for the dot
        }

        // Handle "this" keyword - resolve to containing Define component. The
        // resolution is recorded in via_this because the search rules differ.
        let className = segments[0];
        const via_this = className === 'this';
        if (via_this) {
            const containingComponent = this.findContainingDefineComponent(document, position.line);
            if (!containingComponent) {
                log.debug('definition: "this" used but no containing <Define:> found');
                return undefined;
            }
            className = containingComponent;
            log.debug(`definition: resolved "this" to ${className}`);
        }

        if (currentSegmentIndex === 0) {
            // First segment - just the class name
            return { className, isFirstSegment: true, via_this };
        }

        // Second or later segment - class + member
        return {
            className,
            memberName: segments[currentSegmentIndex],
            isFirstSegment: false,
            via_this
        };
    }

    /**
     * Find the containing <Define:ComponentName> for a given line
     */
    private findContainingDefineComponent(document: vscode.TextDocument, currentLine: number): string | undefined {
        // Search backwards from current line to find <Define:ComponentName>
        for (let i = currentLine; i >= 0; i--) {
            const lineText = document.lineAt(i).text;
            const defineMatch = lineText.match(DEFINE_NAME);
            if (defineMatch) {
                return defineMatch[1];
            }
        }
        return undefined;
    }

    /**
     * Handle goto definition for $ attribute values
     *
     * SEARCH PRIORITY MATRIX:
     *
     * Single Segment (e.g., $handler=Controller):
     *   1. PHP class
     *   2. JS class
     *   3. Standalone JS function (only if the expression is not "this.*")
     *
     * Multiple Segments - First Segment (e.g., $handler=Controller.method, click on "Controller"):
     *   1. PHP class
     *   2. JS class (if no PHP class found)
     *
     * Multiple Segments - Second+ Segment (e.g., click on "method"):
     *   1. PHP method in PHP class -> Fall back to PHP class if method not found
     *   2. JS method in JS class -> Fall back to JS class if method not found
     *   (No standalone function search for second+ segments)
     *
     * Special Case: "this" (context.via_this)
     *   - Resolved to the containing <Define:ComponentName>
     *   - The name is ours, not the user's: no language-server probe (so no PHP
     *     lookup) and no standalone-function search. Only the JS class search.
     */
    private async handleDollarAttributeDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: DollarAttributeContext,
        token: vscode.CancellationToken
    ): Promise<vscode.Definition | undefined> {

        log.debug(`definition: looking for class "${context.className}"${context.memberName ? `, member "${context.memberName}"` : ''}`);

        const scan: JsScan = { texts: new Map() };

        // Priority 1: Search PHP classes/methods (skipped for "this")
        if (!context.via_this) {
            const phpResult = await this.searchPhpDefinition(context);
            if (phpResult) {
                return phpResult;
            }
        }

        if (token.isCancellationRequested) {
            return undefined;
        }

        // Priority 2: Search JS classes/methods
        const jsClassResult = await this.searchJsClassDefinition(context, scan, token);
        if (jsClassResult) {
            return jsClassResult;
        }

        // Priority 3: Standalone JS functions (single segment only, never "this")
        if (context.isFirstSegment && !context.memberName && !context.via_this) {
            const jsFunctionResult = await this.searchStandaloneJsFunction(context.className, scan, token);
            if (jsFunctionResult) {
                return jsFunctionResult;
            }
        }

        log.debug(`definition: nothing found for "${context.className}"${context.memberName ? `.${context.memberName}` : ''}`);
        return undefined;
    }

    /**
     * Ask the installed language servers for a symbol by name.
     *
     * Intelephense answers for PHP and the TypeScript server for .js/.ts/.mjs,
     * so one command covers both and neither needs a file scan.
     */
    private async findWorkspaceSymbol(
        name: string,
        kinds: vscode.SymbolKind[],
        file_pattern: RegExp
    ): Promise<vscode.SymbolInformation | undefined> {
        try {
            const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
                'vscode.executeWorkspaceSymbolProvider',
                name
            );
            if (!symbols || symbols.length === 0) {
                return undefined;
            }
            return symbols.find(s =>
                s.name === name &&
                kinds.indexOf(s.kind) !== -1 &&
                file_pattern.test(s.location.uri.fsPath)
            );
        } catch (error) {
            log.error('JQHTML: workspace symbol provider failed', error);
            return undefined;
        }
    }

    /**
     * Search for PHP class and optionally method, through Intelephense's symbol
     * index (vscode.executeWorkspaceSymbolProvider). No file scanning.
     */
    private async searchPhpDefinition(
        context: DollarAttributeContext
    ): Promise<vscode.Location | undefined> {

        // Check if Intelephense is installed
        const intelephenseExt = vscode.extensions.getExtension('bmewburn.vscode-intelephense-client');
        if (!intelephenseExt) {
            log.debug('definition: Intelephense not installed, skipping PHP lookup');
            return undefined;
        }

        const phpClassSymbol = await this.findWorkspaceSymbol(
            context.className, [vscode.SymbolKind.Class], /\.php$/);

        if (!phpClassSymbol) {
            log.debug(`definition: no PHP class symbol for ${context.className}`);
            return undefined;
        }

        // Looking for the class itself
        if (!context.memberName) {
            return phpClassSymbol.location;
        }

        // Looking for a method within the class
        const phpMethodSymbol = await this.findWorkspaceSymbol(
            context.memberName, [vscode.SymbolKind.Method], /\.php$/);

        if (phpMethodSymbol &&
            phpMethodSymbol.location.uri.toString() === phpClassSymbol.location.uri.toString()) {
            return phpMethodSymbol.location;
        }

        // Method not found - fall back to class definition
        log.debug(`definition: PHP method ${context.memberName} not found, using the class`);
        return phpClassSymbol.location;
    }

    /**
     * Find the workspace .js files that the user can actually see.
     *
     * findFiles replaces the default excludes when given an explicit pattern, so the
     * merged pattern from excludes.ts carries files.exclude, search.exclude,
     * files.watcherExclude and node_modules.
     */
    private async findWorkspaceJsFiles(): Promise<vscode.Uri[]> {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders) {
            return [];
        }

        const files: vscode.Uri[] = [];
        for (const folder of folders) {
            files.push(...await vscode.workspace.findFiles(
                new vscode.RelativePattern(folder, '**/*.js'),
                build_exclude_pattern(folder)
            ));
        }
        return files;
    }

    /** The file list for this Go to Definition, computed at most once. */
    private async scan_files(scan: JsScan): Promise<vscode.Uri[]> {
        if (!scan.files) {
            scan.files = await this.findWorkspaceJsFiles();
        }
        return scan.files;
    }

    /**
     * Read a file without pulling it into the editor's document model - a
     * Go to Definition must not open every .js file in the workspace.
     */
    private async read_text(uri: vscode.Uri, scan?: JsScan): Promise<string | undefined> {
        const key = uri.toString();
        if (scan) {
            const cached = scan.texts.get(key);
            if (cached !== undefined) {
                return cached;
            }
        }
        try {
            const bytes = await vscode.workspace.fs.readFile(uri);
            const text = new TextDecoder().decode(bytes);
            if (scan) {
                scan.texts.set(key, text);
            }
            return text;
        } catch (error) {
            log.debug(`definition: could not read ${uri.fsPath}: ${String(error)}`);
            return undefined;
        }
    }

    /**
     * Search for a JS class and optionally one of its members.
     *
     * The language server is asked first; the workspace scan is the fallback.
     */
    private async searchJsClassDefinition(
        context: DollarAttributeContext,
        scan: JsScan,
        token: vscode.CancellationToken
    ): Promise<vscode.Location | undefined> {

        const class_regex = new RegExp(`^\\s*(?:export\\s+)?class\\s+${escape_regex(context.className)}${IDENTIFIER_END}`, 'm');

        // A "this.*" class name was inferred by us from the enclosing <Define:>,
        // so it is not put to the language servers - see the priority matrix.
        if (!context.via_this) {
            const symbol = await this.findWorkspaceSymbol(
                context.className, [vscode.SymbolKind.Class], JS_FILE_PATTERN);

            if (symbol) {
                if (!context.memberName) {
                    return symbol.location;
                }
                const text = await this.read_text(symbol.location.uri, scan);
                if (text) {
                    const classMatch = class_regex.exec(text);
                    if (classMatch) {
                        const offset = this.findJsClassMemberOffset(text, classMatch.index, context.memberName);
                        if (offset !== undefined) {
                            return new vscode.Location(symbol.location.uri, position_at(text, offset));
                        }
                    }
                }
                // Member not found - the class itself is still the best answer.
                return symbol.location;
            }
        }

        if (token.isCancellationRequested) {
            return undefined;
        }

        // Excluded folders are hidden from the user, so a definition found there is
        // one they cannot search for - see excludes.ts.
        const jsFiles = await this.scan_files(scan);

        for (const fileUri of jsFiles) {
            if (token.isCancellationRequested) {
                return undefined;
            }

            const fileText = await this.read_text(fileUri, scan);
            if (!fileText) {
                continue;
            }

            const classMatch = class_regex.exec(fileText);
            if (!classMatch) {
                continue;
            }

            log.debug(`definition: found JS class ${context.className} in ${fileUri.fsPath}`);
            const classOffset = classMatch.index + classMatch[0].indexOf(context.className);

            if (!context.memberName) {
                return new vscode.Location(fileUri, position_at(fileText, classOffset));
            }

            const memberOffset = this.findJsClassMemberOffset(fileText, classMatch.index, context.memberName);
            if (memberOffset !== undefined) {
                return new vscode.Location(fileUri, position_at(fileText, memberOffset));
            }

            // Member not found, but we found the class - fall back to it.
            log.debug(`definition: JS member ${context.memberName} not found, using the class`);
            return new vscode.Location(fileUri, position_at(fileText, classOffset));
        }

        return undefined;
    }

    /**
     * Search for standalone JS function (not in a class)
     * Only called for single-segment expressions that were not written as "this".
     */
    private async searchStandaloneJsFunction(
        functionName: string,
        scan: JsScan,
        token: vscode.CancellationToken
    ): Promise<vscode.Location | undefined> {

        const symbol = await this.findWorkspaceSymbol(
            functionName,
            [vscode.SymbolKind.Function, vscode.SymbolKind.Variable],
            JS_FILE_PATTERN);
        if (symbol) {
            return symbol.location;
        }

        if (token.isCancellationRequested) {
            return undefined;
        }

        const name = escape_regex(functionName);
        // function fn / async function fn
        const functionRegex = new RegExp(`^\\s*(?:export\\s+)?(?:async\\s+)?function\\s+${name}${IDENTIFIER_END}`, 'm');
        // const/let/var fn = ...
        const constFunctionRegex = new RegExp(`^\\s*(?:export\\s+)?(?:const|let|var)\\s+${name}\\s*=`, 'm');

        const jsFiles = await this.scan_files(scan);

        for (const fileUri of jsFiles) {
            if (token.isCancellationRequested) {
                return undefined;
            }

            const fileText = await this.read_text(fileUri, scan);
            if (!fileText) {
                continue;
            }

            const functionMatch = functionRegex.exec(fileText);
            if (functionMatch) {
                log.debug(`definition: found function ${functionName} in ${fileUri.fsPath}`);
                return new vscode.Location(fileUri,
                    position_at(fileText, functionMatch.index + functionMatch[0].indexOf(functionName)));
            }

            const constMatch = constFunctionRegex.exec(fileText);
            if (constMatch) {
                log.debug(`definition: found ${functionName} (const/let/var) in ${fileUri.fsPath}`);
                return new vscode.Location(fileUri,
                    position_at(fileText, constMatch.index + constMatch[0].indexOf(functionName)));
            }
        }

        return undefined;
    }

    /**
     * Offset of a method or property within a JS class body, or undefined.
     */
    private findJsClassMemberOffset(fileText: string, classStartIndex: number, memberName: string): number | undefined {
        // Find the class body (starts at { after class declaration)
        const classBodyStart = fileText.indexOf('{', classStartIndex);
        if (classBodyStart === -1) {
            return undefined;
        }

        // Find matching closing brace
        let braceCount = 1;
        let classBodyEnd = classBodyStart + 1;
        while (classBodyEnd < fileText.length && braceCount > 0) {
            if (fileText[classBodyEnd] === '{') { braceCount++; }
            if (fileText[classBodyEnd] === '}') { braceCount--; }
            classBodyEnd++;
        }

        const classBody = fileText.substring(classBodyStart, classBodyEnd);

        // Look for method: methodName() { or property: methodName =
        const methodRegex = new RegExp(`^\\s*(?:async\\s+)?${escape_regex(memberName)}\\s*[=(]`, 'm');
        const methodMatch = methodRegex.exec(classBody);

        if (methodMatch) {
            return classBodyStart + methodMatch.index + methodMatch[0].indexOf(memberName);
        }

        return undefined;
    }

    /**
     * Handle goto definition for slot tags (<Slot:SlotName>)
     *
     * IMPLEMENTATION SCOPE (Narrow, for now):
     * - Handles direct extends="ComponentName" on <Define:> tags
     * - Handles direct <ComponentName> invocation tags
     * - Does NOT traverse full inheritance chain (TODO: add later)
     */
    private async handleSlotDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        slotName: string
    ): Promise<vscode.Location | undefined> {

        // Find the parent component that defines this slot
        const parentComponentName = this.findParentComponentForSlot(document, position);
        if (!parentComponentName) {
            log.debug('definition: could not determine the parent component for the slot');
            return undefined;
        }

        // Find the parent component definition file
        const parentComponent = this.componentIndex.findComponent(parentComponentName);
        if (!parentComponent) {
            log.debug(`definition: parent component '${parentComponentName}' not in index`);
            return undefined;
        }

        // Search for content('SlotName') in the parent component file
        const slotUsageLocation = await this.findSlotUsageInTemplate(parentComponent.uri, slotName);
        if (!slotUsageLocation) {
            log.debug(`definition: content('${slotName}') not found in ${parentComponent.uri.fsPath}`);
            return undefined;
        }

        return slotUsageLocation;
    }

    /**
     * Find the parent component that should define this slot
     *
     * Looks for either:
     * 1. <Define:ChildComponent extends="ParentComponent"> - check if slots are top-level
     * 2. <ParentComponent> - find enclosing component invocation tag
     */
    private findParentComponentForSlot(
        document: vscode.TextDocument,
        position: vscode.Position
    ): string | undefined {
        const currentLine = position.line;

        // Strategy 1: <Define extends="ParentComponent"> with top-level slots
        let defineTagStartLine = -1;
        for (let i = currentLine; i >= 0; i--) {
            if (document.lineAt(i).text.match(DEFINE_NAME)) {
                defineTagStartLine = i;
                break;
            }
        }

        // If we found a Define tag, look for extends attribute in the tag (may be multi-line)
        if (defineTagStartLine >= 0) {
            let tagContent = '';
            for (let i = defineTagStartLine; i < document.lineCount; i++) {
                const lineText = document.lineAt(i).text;
                tagContent += lineText + ' ';

                if (lineText.includes('>')) {
                    break;
                }
            }

            const extendsMatch = tagContent.match(new RegExp(`\\bextends\\s*=\\s*["'](${COMPONENT_NAME_SOURCE})["']`));
            if (extendsMatch) {
                // TODO: verify the slot is at top level (not nested inside other tags)
                return extendsMatch[1];
            }
        }

        // Strategy 2: enclosing <ParentComponent> invocation tag
        const tagStack: string[] = [];
        for (let i = currentLine; i >= 0; i--) {
            const lineText = document.lineAt(i).text;

            const tagRegex = new RegExp(`<\\/?(${COMPONENT_NAME_SOURCE})[^>]*>`, 'g');
            let match;

            const tagsOnLine: { tag: string; isClosing: boolean }[] = [];
            while ((match = tagRegex.exec(lineText)) !== null) {
                tagsOnLine.push({ tag: match[1], isClosing: match[0].startsWith('</') });
            }

            // Process tags in reverse order (right to left on the line)
            for (let j = tagsOnLine.length - 1; j >= 0; j--) {
                const { tag, isClosing } = tagsOnLine[j];

                if (isClosing) {
                    tagStack.push(tag);
                } else if (tagStack.length > 0 && tagStack[tagStack.length - 1] === tag) {
                    // Matches the last closing tag seen - they cancel out
                    tagStack.pop();
                } else {
                    // An unclosed opening tag - this is our parent
                    return tag;
                }
            }
        }

        return undefined;
    }

    /**
     * Search for <%= content('SlotName') %> in a template file
     */
    private async findSlotUsageInTemplate(
        templateUri: vscode.Uri,
        slotName: string
    ): Promise<vscode.Location | undefined> {
        const templateText = await this.read_text(templateUri);
        if (templateText === undefined) {
            return undefined;
        }

        // content('SlotName') or content("SlotName"), whitespace tolerated
        const contentRegex = new RegExp(`<%=\\s*content\\s*\\(\\s*['"]${escape_regex(slotName)}['"]\\s*\\)`);
        const match = contentRegex.exec(templateText);

        if (!match) {
            return undefined;
        }

        // Point at the slot name within content('SlotName')
        const slotNamePosition = position_at(templateText, match.index + match[0].indexOf(slotName));
        const slotNameRange = new vscode.Range(
            slotNamePosition,
            new vscode.Position(slotNamePosition.line, slotNamePosition.character + slotName.length)
        );

        return new vscode.Location(templateUri, slotNameRange);
    }

}

/**
 * JQHTML Hover Provider
 *
 * Provides hover information for JQHTML components.
 * Shows the file and line where the component is defined.
 */
export class JqhtmlHoverProvider implements vscode.HoverProvider {
    constructor(private componentIndex: JqhtmlComponentIndex) {}

    public async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Hover | undefined> {
        const line = document.lineAt(position.line).text;
        const char = position.character;

        // $redrawable - the occurrence under the cursor, not the first on the line.
        const redrawableRegex = /\$redrawable(?=\s|>|\/|$)/g;
        let redrawableMatch;
        while ((redrawableMatch = redrawableRegex.exec(line)) !== null) {
            const start = redrawableMatch.index;
            const end = start + '$redrawable'.length;
            if (char < start || char > end) {
                continue;
            }

            const markdown = new vscode.MarkdownString();
            markdown.appendMarkdown(`**\`$redrawable\` Attribute**\n\n`);
            markdown.appendMarkdown(`Converts this tag into an anonymous component class, allowing it to be redrawn on demand.\n\n`);
            markdown.appendMarkdown(`**Usage:**\n\`\`\`javascript\nthis.$sid('element_id').render()\n\`\`\`\n\n`);
            markdown.appendMarkdown(`Call \`render()\` on the element's scoped ID to trigger a re-render of just this element without affecting the rest of the component.`);

            const range = new vscode.Range(
                new vscode.Position(position.line, start),
                new vscode.Position(position.line, end)
            );
            return new vscode.Hover(markdown, range);
        }

        // Check for tag="" attribute on components (Define tags or component invocations)
        const beforeCursor = line.substring(0, char);

        const tagAttrMatch = beforeCursor.match(new RegExp(`<(Define:${COMPONENT_NAME_SOURCE}|${COMPONENT_NAME_SOURCE})[^>]*\\btag\\s*=\\s*["']?(\\w*)$`));
        if (tagAttrMatch) {
            const markdown = new vscode.MarkdownString();
            markdown.appendMarkdown(`**\`tag\` Attribute**\n\n`);
            markdown.appendMarkdown(`Sets the HTML element type for this component.\n\n`);
            markdown.appendMarkdown(`**Default:** \`div\`\n\n`);
            markdown.appendMarkdown(`**Examples:**\n`);
            markdown.appendMarkdown(`- \`tag="button"\` - Creates a \`<button>\` element\n`);
            markdown.appendMarkdown(`- \`tag="span"\` - Creates a \`<span>\` element\n`);
            markdown.appendMarkdown(`- \`tag="a"\` - Creates an \`<a>\` element\n\n`);
            markdown.appendMarkdown(`Use this when your component should be a specific HTML element instead of the default \`<div>\`.`);

            return new vscode.Hover(markdown);
        }

        // Component hover
        const wordRange = document.getWordRangeAtPosition(position, COMPONENT_NAME_WORD);
        if (!wordRange) {
            return undefined;
        }

        const word = document.getText(wordRange);

        if (!JqhtmlComponentIndex.isComponentReference(word)) {
            return undefined;
        }

        // Verify this is in a tag context (same logic as the definition provider)
        const beforeWord = line.substring(0, wordRange.start.character);

        let isInTagContext = false;
        if (beforeWord.match(/<\s*$/) || beforeWord.match(/<Define:\s*$/) ||
            beforeWord.match(/<\/\s*$/) || beforeWord.match(/<\/Define:\s*$/)) {
            isInTagContext = true;
        }

        if (!isInTagContext) {
            const afterWord = line.substring(wordRange.end.character);
            if ((afterWord.match(/^[\s>]/) || afterWord.length === 0) && beforeWord.includes('<')) {
                const lastLessThan = beforeWord.lastIndexOf('<');
                const lastGreaterThan = beforeWord.lastIndexOf('>');
                if (lastLessThan > lastGreaterThan) {
                    isInTagContext = true;
                }
            }
        }

        if (!isInTagContext) {
            return undefined;
        }

        // Look up the component in our index
        const componentDef = this.componentIndex.findComponent(word);
        if (!componentDef) {
            const markdown = new vscode.MarkdownString();
            markdown.appendMarkdown(`**JQHTML Component:** \`${word}\`\n\n`);
            markdown.appendMarkdown(`⚠️ *Component definition not found in workspace*`);

            return new vscode.Hover(markdown, wordRange);
        }

        const markdown = new vscode.MarkdownString();
        markdown.appendMarkdown(`**JQHTML Component:** \`${word}\`\n\n`);

        const relativePath = vscode.workspace.asRelativePath(componentDef.uri);
        markdown.appendMarkdown(`📁 **Defined in:** \`${relativePath}:${componentDef.position.line + 1}\`\n\n`);

        if (componentDef.line) {
            markdown.appendCodeblock(componentDef.line, 'jqhtml');
        }

        // Make the file path clickable
        markdown.isTrusted = true;

        return new vscode.Hover(markdown, wordRange);
    }
}
