import * as vscode from 'vscode';
import { build_exclude_pattern, is_excluded, on_exclude_settings_changed } from './excludes';
import { COMPONENT_NAME_SOURCE, is_component_name } from './component_name';
import { log } from './log';

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
    /** Extra definitions of an already-indexed name, in discovery order. */
    private duplicateMap: Map<string, ComponentDefinition[]> = new Map();
    /** Names already reported as duplicated, so the warning is logged once. */
    private warnedDuplicates: Set<string> = new Set();
    private fileWatcher: vscode.FileSystemWatcher | undefined;
    private configWatcher: vscode.Disposable | undefined;
    private indexPromise: Promise<void> | undefined;

    constructor() {
        // Start initial indexing
        this.reindexWorkspace();

        // Watch for changes to .jqhtml files
        this.setupFileWatcher();

        // Hiding a folder should drop it from the index, not leave stale definitions
        // that Go to Definition can still jump into.
        this.configWatcher = on_exclude_settings_changed(() => this.reindexWorkspace());
    }

    /**
     * Set up file system watcher for .jqhtml files
     */
    private setupFileWatcher(): void {
        this.fileWatcher = vscode.workspace.createFileSystemWatcher('**/*.jqhtml');

        // Re-index when files are created, changed, or deleted. Watcher events fire
        // for hidden files too, so each one is checked against the exclusions before
        // it can re-enter the index. Deletions are always honoured - dropping an
        // entry can only ever make the index more correct.
        this.fileWatcher.onDidCreate(async uri => {
            if (!await is_excluded(uri)) { this.indexFile(uri); }
        });
        this.fileWatcher.onDidChange(async uri => {
            if (!await is_excluded(uri)) { this.indexFile(uri); }
        });
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

        // try/finally: a rejected reindex must not leave the rejected promise
        // cached, or every later call re-throws the original error forever.
        this.indexPromise = this._reindexWorkspace();
        try {
            await this.indexPromise;
        } finally {
            this.indexPromise = undefined;
        }
    }

    private async _reindexWorkspace(): Promise<void> {
        log.debug('JQHTML: starting workspace component indexing');
        this.componentMap.clear();
        this.duplicateMap.clear();
        this.warnedDuplicates.clear();

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            log.debug('JQHTML: no workspace folders to index');
            return;
        }

        // Search each workspace folder explicitly for multi-root workspace support
        const allFiles: vscode.Uri[] = [];
        for (const folder of workspaceFolders) {
            const files = await vscode.workspace.findFiles(
                new vscode.RelativePattern(folder, '**/*.jqhtml'),
                build_exclude_pattern(folder)
            );
            allFiles.push(...files);
        }

        // Index each file
        await Promise.all(allFiles.map(uri => this.indexFile(uri)));

        log.info(`JQHTML: indexed ${this.componentMap.size} components from ${allFiles.length} files`);
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
            const lines = document.getText().split('\n');

            // Component definitions: <Define:ComponentName followed by a
            // non-name character or the end of the line.
            const definePattern = new RegExp(`<Define:(${COMPONENT_NAME_SOURCE})(?:[^\\w]|>|$)`, 'g');

            for (let lineNum = 0; lineNum < lines.length; lineNum++) {
                const line = lines[lineNum];
                let match;

                // Reset regex for each line
                definePattern.lastIndex = 0;

                while ((match = definePattern.exec(line)) !== null) {
                    this.addDefinition({
                        name: match[1],
                        uri,
                        position: new vscode.Position(lineNum, match.index + '<Define:'.length),
                        line: line.trim()
                    });
                }
            }
        } catch (error) {
            log.error(`JQHTML: error indexing file ${uri.fsPath}:`, error);
        }
    }

    /**
     * Record one definition. The FIRST file to define a name wins; later files
     * are kept aside (getDuplicates) and reported once so the shadowing is
     * visible without flooding the channel on every reindex.
     */
    private addDefinition(definition: ComponentDefinition): void {
        const existing = this.componentMap.get(definition.name);

        if (!existing) {
            this.componentMap.set(definition.name, definition);
            return;
        }

        if (existing.uri.toString() === definition.uri.toString()) {
            // Same file defining the name twice - the first occurrence stands.
            return;
        }

        const extras = this.duplicateMap.get(definition.name) || [];
        extras.push(definition);
        this.duplicateMap.set(definition.name, extras);

        if (!this.warnedDuplicates.has(definition.name)) {
            this.warnedDuplicates.add(definition.name);
            log.info(`JQHTML: duplicate component "${definition.name}": using ${existing.uri.fsPath}, ignoring ${definition.uri.fsPath}`);
        }
    }

    /**
     * Remove all components from a file from the index
     */
    private removeFileFromIndex(uri: vscode.Uri): void {
        const key = uri.toString();

        // Names this file was the retained definition for.
        const orphaned: string[] = [];
        this.componentMap.forEach((def, name) => {
            if (def.uri.toString() === key) {
                orphaned.push(name);
            }
        });
        orphaned.forEach(name => this.componentMap.delete(name));

        // Drop this file's shadowed definitions too.
        this.duplicateMap.forEach((extras, name) => {
            const kept = extras.filter(def => def.uri.toString() !== key);
            if (kept.length > 0) {
                this.duplicateMap.set(name, kept);
            } else {
                this.duplicateMap.delete(name);
            }
        });

        // A shadowed definition becomes the real one when the winner goes away.
        for (const name of orphaned) {
            const extras = this.duplicateMap.get(name);
            if (!extras || extras.length === 0) {
                continue;
            }
            this.componentMap.set(name, extras[0]);
            const rest = extras.slice(1);
            if (rest.length > 0) {
                this.duplicateMap.set(name, rest);
            } else {
                this.duplicateMap.delete(name);
            }
        }
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
     * Names defined in more than one file, mapped to every definition found -
     * the retained one first, then the shadowed ones in discovery order.
     */
    public getDuplicates(): Map<string, ComponentDefinition[]> {
        const out = new Map<string, ComponentDefinition[]>();
        this.duplicateMap.forEach((extras, name) => {
            const retained = this.componentMap.get(name);
            out.set(name, retained ? [retained, ...extras] : [...extras]);
        });
        return out;
    }

    /**
     * Check if a string is a component reference (capital letter, optionally
     * preceded by a single underscore - see component_name.ts)
     */
    public static isComponentReference(tagName: string): boolean {
        return is_component_name(tagName);
    }

    /**
     * Dispose of resources
     */
    public dispose(): void {
        if (this.configWatcher) {
            this.configWatcher.dispose();
            this.configWatcher = undefined;
        }
        if (this.fileWatcher) {
            this.fileWatcher.dispose();
            this.fileWatcher = undefined;
        }
        this.indexPromise = undefined;
        this.componentMap.clear();
        this.duplicateMap.clear();
        this.warnedDuplicates.clear();
    }
}
