import * as vscode from 'vscode';

/**
 * Workspace exclusion handling.
 *
 * The rule this module enforces: if a file is hidden from the user, JQHTML does not
 * index it and Go to Definition never lands in it. A definition you cannot open by
 * searching for it is worse than no definition at all - it silently shadows the real
 * one, and jumping into a hidden build artifact or vendored copy looks like a bug in
 * whatever the developer was actually working on.
 *
 * Three settings hide files, and all three are honoured:
 *   files.exclude         - hidden from the Explorer tree
 *   search.exclude        - hidden from Find in Files / Quick Open
 *   files.watcherExclude  - not watched for changes
 *
 * Each is a map of glob -> boolean (or a `when` clause object); an entry counts as
 * enabled when its value is truthy. node_modules is always excluded.
 *
 * NOTE on vscode.workspace.findFiles: passing an explicit `exclude` REPLACES the
 * default file-excludes rather than adding to them, so the merged pattern built here
 * must carry every glob we care about. Passing `undefined` would apply files.exclude
 * but neither search.exclude nor node_modules.
 */

const ALWAYS_EXCLUDED = ['**/node_modules/**'];

const EXCLUDE_SETTINGS: Array<[section: string, key: string]> = [
  ['files', 'exclude'],
  ['search', 'exclude'],
  ['files', 'watcherExclude']
];

/**
 * Collect the enabled exclusion globs for a workspace folder.
 */
export function collect_exclude_globs(folder?: vscode.WorkspaceFolder): string[] {
  const globs = new Set<string>(ALWAYS_EXCLUDED);

  for (const [section, key] of EXCLUDE_SETTINGS) {
    const setting = vscode.workspace
      .getConfiguration(section, folder?.uri)
      .get<Record<string, unknown>>(key);

    if (!setting) {
      continue;
    }

    for (const [glob, enabled] of Object.entries(setting)) {
      // `true`, or a { when: "..." } sibling-condition object, both count as enabled.
      if (enabled) {
        globs.add(glob);
      }
    }
  }

  return [...globs];
}

/**
 * Build the exclude pattern to hand to findFiles for a workspace folder.
 *
 * Returns a single brace-expanded glob. A lone glob is returned as-is: `{a}` is not
 * valid brace syntax everywhere, and there is no reason to wrap it.
 */
export function build_exclude_pattern(folder?: vscode.WorkspaceFolder): string {
  const globs = collect_exclude_globs(folder);
  return globs.length === 1 ? globs[0] : `{${globs.join(',')}}`;
}

/**
 * Is this file hidden from the user, and therefore off-limits to the index?
 *
 * Rather than reimplementing VS Code's glob semantics (`**`, `{a,b}`, `when`
 * clauses), this asks VS Code to find the file with the exclusions applied: if the
 * search cannot see it, neither will we. Used to filter file-watcher events, which
 * fire regardless of these settings.
 */
export async function is_excluded(uri: vscode.Uri): Promise<boolean> {
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (!folder) {
    // Outside every workspace folder - not indexable in the first place.
    return true;
  }

  const relative = vscode.workspace.asRelativePath(uri, false);

  try {
    const matches = await vscode.workspace.findFiles(
      new vscode.RelativePattern(folder, relative),
      build_exclude_pattern(folder),
      1
    );
    return matches.length === 0;
  } catch {
    // If the check itself fails, index the file: a missing definition is a worse
    // failure than an extra one, and this path should not be reachable.
    return false;
  }
}

/**
 * Fire `on_change` whenever a setting that affects exclusions changes, so the index
 * does not keep serving results from a folder the user has since hidden.
 */
export function on_exclude_settings_changed(on_change: () => void): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration(event => {
    const affected = EXCLUDE_SETTINGS.some(([section, key]) =>
      event.affectsConfiguration(`${section}.${key}`)
    );
    if (affected) {
      on_change();
    }
  });
}
