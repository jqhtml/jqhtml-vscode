/**
 * The one rule for "is this name a component?", mirrored from
 * @jqhtml/parser and @jqhtml/core (src/component-name.ts there).
 *
 * An optional SINGLE leading underscore, then a capital letter, then letters,
 * digits and underscores. The underscore prefix is a namespace reserved for
 * framework-provided components (_Root_Layout). Two or more leading
 * underscores are not a component name; a lower-case first letter after the
 * optional underscore is an HTML tag.
 *
 * The TextMate grammars (syntaxes/*.tmLanguage.json) cannot import this and
 * carry the same pattern literally - keep them in step.
 */
export const COMPONENT_NAME_SOURCE = '_?[A-Z][A-Za-z0-9_]*';

export const COMPONENT_NAME_PATTERN = new RegExp(`^${COMPONENT_NAME_SOURCE}$`);

/** Word-range form for getWordRangeAtPosition: the name without anchors. */
export const COMPONENT_NAME_WORD = new RegExp(COMPONENT_NAME_SOURCE);

export function is_component_name(name: string): boolean {
    return COMPONENT_NAME_PATTERN.test(name);
}
