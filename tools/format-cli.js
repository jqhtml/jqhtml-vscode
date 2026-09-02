#!/usr/bin/env node
/**
 * CLI harness for the JQHTML formatter.
 *
 * Runs the SAME compiled formatter the extension ships (out/formatter.js), so
 * there is exactly one copy of the formatting logic. The 'vscode' module is
 * stubbed; format_jqhtml() itself never touches it.
 *
 *   node tools/format-cli.js <input> [-o out] [--tab-size N] [--tabs] [--stdout] [--check]
 *
 * Never writes over the input file. Default output is <input>.formatted.
 * Exit 0 on success, 1 if the formatter refused the document or the output
 * failed a sanity check, 2 on usage errors.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { load_formatter } = require('./load-formatter');

const argv = process.argv.slice(2);
if (argv.length === 0 || argv.includes('-h') || argv.includes('--help')) {
    console.error('usage: node tools/format-cli.js <input.jqhtml> [-o <output>] [--tab-size N] [--tabs] [--stdout] [--check]');
    process.exit(argv.length === 0 ? 2 : 0);
}

let input_path = null;
let output_path = null;
let tab_size = 4;
let insert_spaces = true;
let to_stdout = false;
let check_only = false;

for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-o' || a === '--output') { output_path = argv[++i]; }
    else if (a === '--tab-size') { tab_size = parseInt(argv[++i], 10); }
    else if (a === '--tabs') { insert_spaces = false; }
    else if (a === '--stdout') { to_stdout = true; }
    else if (a === '--check') { check_only = true; }
    else if (!input_path) { input_path = a; }
    else { console.error(`unexpected argument: ${a}`); process.exit(2); }
}

const { format_jqhtml, JqhtmlFormatError } = load_formatter();
const source = fs.readFileSync(input_path, 'utf8');

const started = Date.now();
let formatted;
try {
    formatted = format_jqhtml(source, { tab_size, insert_spaces });
} catch (err) {
    if (err instanceof JqhtmlFormatError) {
        const line = source.substring(0, err.offset).split('\n').length;
        console.error(`refused: ${err.message} (line ${line})`);
        process.exit(1);
    }
    console.error(`formatter threw: ${err && err.stack || err}`);
    process.exit(1);
}
const elapsed = Date.now() - started;

// ---- diagnostics -----------------------------------------------------------
const in_lines = source.split('\n');
const out_lines = formatted.split('\n');
const uniq = (arr) => new Set(arr.map(l => l.trim()).filter(l => l.length)).size;
const sentinel_leak = /[-]/.test(formatted);

let stable = true;
try { stable = format_jqhtml(formatted, { tab_size, insert_spaces }) === formatted; } catch (e) { stable = false; }

console.error('--- jqhtml format-cli ---');
console.error(`input      : ${input_path}`);
console.error(`bytes      : ${source.length} -> ${formatted.length} (${formatted.length >= source.length ? '+' : ''}${formatted.length - source.length})`);
console.error(`lines      : ${in_lines.length} -> ${out_lines.length}`);
console.error(`unique     : ${uniq(in_lines)} -> ${uniq(out_lines)}`);
console.error(`indent     : ${insert_spaces ? tab_size + ' spaces' : 'tabs'}`);
console.error(`elapsed    : ${elapsed}ms`);
console.error(`changed    : ${formatted === source ? 'no' : 'yes'}`);
console.error(`idempotent : ${stable ? 'yes' : 'NO  <-- format(format(x)) != format(x)'}`);
if (sentinel_leak) console.error('!! placeholder sentinel leaked into the output');
if (formatted.length > source.length * 1.5) console.error(`!! output grew ${(formatted.length / source.length).toFixed(1)}x`);

if (to_stdout) {
    process.stdout.write(formatted);
} else if (!check_only) {
    const target = output_path || (input_path + '.formatted');
    fs.writeFileSync(target, formatted, 'utf8');
    console.error(`wrote      : ${target}`);
}

process.exit(sentinel_leak || !stable ? 1 : 0);
