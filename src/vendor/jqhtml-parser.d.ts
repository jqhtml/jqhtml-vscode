/**
 * Types for out/vendor/jqhtml-parser.js - @jqhtml/parser bundled into the
 * extension by build.sh (esbuild, CommonJS, source-map inlined). Only the
 * surface the extension uses is declared.
 */

export interface CompileOptions {
    format: 'iife' | 'esm' | 'cjs' | 'umd';
    sourcemap: boolean;
    version?: string;
}

export function compileTemplate(
    source: string,
    filename: string,
    options: CompileOptions
): { code: string; componentName: string };

export class JQHTMLParseError extends Error {
    line: number;
    column: number;
    endLine?: number;
    endColumn?: number;
    severity: 'error' | 'warning';
    suggestion?: string;
}
