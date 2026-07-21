import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Component definition interface
 */
export interface ComponentDefinition {
    name: string;
    uri: vscode.Uri;
    position: vscode.Position;
    line: string; // The full line for context
}

/**
 * JQHTML Component Indexer
 *
 * Maintains an index of all JQHTML component definitions in the workspace
 * for fast lookup during goto definition operations.
 */
export class JqhtmlComponentIndex {
    private componentMap: Map<string, ComponentDefinition> = new Map();
    private fileWatcher: vscode.FileSystemWatcher | undefined;
    private indexPromise: Promise<void> | undefined;

    constructor() {
        // Start initial indexing
        this.reindexWorkspace();

        // Watch for changes to .jqhtml files
        this.setupFileWatcher();
    }

    /**
     * Set up file system watcher for .jqhtml files
     */
    private setupFileWatcher(): void {
        this.fileWatcher = vscode.workspace.createFileSystemWatcher('**/*.jqhtml');

        // Re-index when files are created, changed, or deleted
        this.fileWatcher.onDidCreate(uri => this.indexFile(uri));
        this.fileWatcher.onDidChange(uri => this.indexFile(uri));
        this.fileWatcher.onDidDelete(uri => this.removeFileFromIndex(uri));
    }

    /**
     * Re-index all .jqhtml files in the workspace
     */
    public async reindexWorkspace(): Promise<void> {
        // Avoid multiple concurrent reindexing
        if (this.indexPromise) {
            return this.indexPromise;
        }

        this.indexPromise = this._reindexWorkspace();
        await this.indexPromise;
        this.indexPromise = undefined;
    }

    private async _reindexWorkspace(): Promise<void> {
        console.log('JQHTML: Starting workspace component indexing...');
        this.componentMap.clear();

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            console.log('JQHTML: No workspace folders found');
            return;
        }

        // Search each workspace folder explicitly for multi-root workspace support
        const allFiles: vscode.Uri[] = [];
        for (const folder of workspaceFolders) {
            const files = await vscode.workspace.findFiles(
                new vscode.RelativePattern(folder, '**/*.jqhtml'),
                new vscode.RelativePattern(folder, '**/node_modules/**')
            );
            allFiles.push(...files);
        }

        // Index each file
        const promises = allFiles.map(uri => this.indexFile(uri));
        await Promise.all(promises);

        console.log(`JQHTML: Indexed ${this.componentMap.size} components from ${allFiles.length} files`);
    }

    /**
     * Index a single .jqhtml file
     */
    private async indexFile(uri: vscode.Uri): Promise<void> {
        try {
            // Remove old entries from this file
            this.removeFileFromIndex(uri);

            // Read file content
            const document = await vscode.workspace.openTextDocument(uri);
            const text = document.getText();
            const lines = text.split('\n');

            // Look for component definitions
            // Pattern: <Define:ComponentName (followed by non-alphanumeric or end of tag)
            //
            // DIAGNOSTIC HISTORY:
            // - Issue: Component "Contacts_Datagrid" not found in index
            // - This regex SHOULD match: <Define:Contacts_Datagrid...
            // - Component name pattern: [A-Z][A-Za-z0-9_]* (starts uppercase, then alphanum+underscore)
            // - Contacts_Datagrid matches this pattern
            //
            // POSSIBLE REASONS FOR MISSED COMPONENTS:
            // 1. File not in workspace folders (check workspaceFolders in console)
            // 2. File in node_modules (explicitly excluded line 75)
            // 3. Syntax variations:
            //    - Extra whitespace: <Define: Contacts_Datagrid> (space after colon) ❌
            //    - Wrong case: <define:Contacts_Datagrid> (lowercase 'define') ❌
            //    - Missing colon: <DefineContacts_Datagrid> ❌
            // 4. Indexing hasn't completed yet (async operation)
            // 5. File watcher didn't fire (check file modification timestamp)
            //
            // DEBUGGING STEPS:
            // 1. Check console output "JQHTML: Indexed X components from Y files"
            // 2. Check console log when file is saved (should trigger onDidChange)
            // 3. Manually reload VS Code window to force reindex
            // 4. Check if file path contains "node_modules"
            const definePattern = /<Define:([A-Z][A-Za-z0-9_]*)(?:[^\w]|>|$)/g;

            for (let lineNum = 0; lineNum < lines.length; lineNum++) {
                const line = lines[lineNum];
                let match;

                // Reset regex for each line
                definePattern.lastIndex = 0;

                while ((match = definePattern.exec(line)) !== null) {
                    const componentName = match[1];
                    const charPos = match.index + '<Define:'.length;

                    // Store component definition
                    this.componentMap.set(componentName, {
                        name: componentName,
                        uri: uri,
                        position: new vscode.Position(lineNum, charPos),
                        line: line.trim()
                    });

                    // Debug: Log each component as it's indexed
                    console.log(`JQHTML Index: Indexed "${componentName}" from ${path.basename(uri.fsPath)}:${lineNum + 1}`);
                }
            }
        } catch (error) {
            console.error(`JQHTML: Error indexing file ${uri.fsPath}:`, error);
        }
    }

    /**
     * Remove all components from a file from the index
     */
    private removeFileFromIndex(uri: vscode.Uri): void {
        // Remove all components defined in this file
        const toRemove: string[] = [];

        this.componentMap.forEach((def, name) => {
            if (def.uri.toString() === uri.toString()) {
                toRemove.push(name);
            }
        });

        // Verbose logging commented out to reduce console noise
        // if (toRemove.length > 0) {
        //     console.log(`JQHTML Index: Removing ${toRemove.length} component(s) from deleted file: ${uri.fsPath}`);
        //     console.log(`JQHTML Index: Components removed: ${toRemove.join(', ')}`);
        // }

        toRemove.forEach(name => {
            this.componentMap.delete(name);
        });

        // console.log(`JQHTML Index: Current index size after removal: ${this.componentMap.size} components`);
    }

    /**
     * Find a component definition by name
     */
    public findComponent(name: string): ComponentDefinition | undefined {
        return this.componentMap.get(name);
    }

    /**
     * Get all component names (for autocomplete)
     */
    public getAllComponentNames(): string[] {
        return Array.from(this.componentMap.keys());
    }

    /**
     * Check if a string is a component reference (starts with capital letter)
     */
    public static isComponentReference(tagName: string): boolean {
        return /^[A-Z]/.test(tagName);
    }

    /**
     * Dispose of resources
     */
    public dispose(): void {
        if (this.fileWatcher) {
            this.fileWatcher.dispose();
        }
        this.componentMap.clear();
    }
}