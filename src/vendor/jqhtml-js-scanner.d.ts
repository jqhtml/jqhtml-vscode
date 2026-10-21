/**
 * Types for out/vendor/jqhtml-js-scanner.js - @jqhtml/parser's JavaScript scanner
 * (packages/parser/src/js_scanner.ts) bundled into the extension by build.sh. Only
 * the surface the extension uses is declared.
 */

/**
 * Index of the %> closing the <% %> / <%= %> body that starts at `start`, or -1.
 * Strings, template literals, regexes and comments hide %>; a // comment runs to
 * the end of its line.
 */
export function find_template_close(text: string, start: number): number;
