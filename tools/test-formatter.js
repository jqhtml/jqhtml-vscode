#!/usr/bin/env node
/**
 * Formatter regression suite, driven by fixtures.
 *
 *   node tools/test-formatter.js            run
 *   node tools/test-formatter.js --update   rewrite every .expected.jqhtml from current output
 *   node tools/test-formatter.js <name>     run one fixture
 *
 * For every tools/fixtures/<name>.jqhtml:
 *   - output must equal <name>.expected.jqhtml (byte for byte)
 *   - output must be a fixed point: format(output) === output
 *   - output must contain no placeholder sentinel
 *   - if @jqhtml/parser is reachable, the output must still compile
 *   - <name>.options.json, if present, overrides { tab_size, insert_spaces }
 *
 * For every tools/fixtures/errors/<name>.jqhtml the formatter must throw a
 * JqhtmlFormatError, and its message must match <name>.expected.txt.
 *
 * Run --update only after reading the diff: the expected files ARE the spec.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { load_formatter } = require('./load-formatter');

const FIXTURES = path.join(__dirname, 'fixtures');
const ERRORS = path.join(FIXTURES, 'errors');
const DEFAULT_OPTIONS = { tab_size: 4, insert_spaces: true };

const argv = process.argv.slice(2);
const update = argv.includes('--update');
const only = argv.find(a => !a.startsWith('--')) || null;

const { format_jqhtml, JqhtmlFormatError } = load_formatter();

// Optional: compile with the real parser so formatting is proven not to break templates.
let parser = null;
try {
    parser = require(path.join(__dirname, '..', '..', 'parser'));
} catch (e) {
    // running outside the monorepo
}

let passed = 0;
let failed = 0;
let updated = 0;

function fail(name, message) {
    failed++;
    console.log(`  FAIL ${name}\n       ${message.split('\n').join('\n       ')}`);
}
function ok(name) {
    passed++;
    console.log(`  ok   ${name}`);
}

function first_diff(a, b) {
    const al = a.split('\n'), bl = b.split('\n');
    for (let i = 0; i < Math.max(al.length, bl.length); i++) {
        if (al[i] !== bl[i]) {
            return `line ${i + 1}\n  expected: ${JSON.stringify(bl[i])}\n  actual:   ${JSON.stringify(al[i])}`;
        }
    }
    return 'differs only in length';
}

function run_fixture(file) {
    const name = path.basename(file, '.jqhtml');
    const source = fs.readFileSync(file, 'utf8');
    const options_path = file.replace(/\.jqhtml$/, '.options.json');
    const options = fs.existsSync(options_path)
        ? Object.assign({}, DEFAULT_OPTIONS, JSON.parse(fs.readFileSync(options_path, 'utf8')))
        : DEFAULT_OPTIONS;
    const expected_path = file.replace(/\.jqhtml$/, '.expected.jqhtml');

    let out;
    try {
        out = format_jqhtml(source, options);
    } catch (err) {
        return fail(name, `threw: ${err.message}`);
    }

    if (update) {
        fs.writeFileSync(expected_path, out, 'utf8');
        updated++;
    }

    const problems = [];

    if (!fs.existsSync(expected_path)) {
        problems.push('no .expected.jqhtml - run with --update after reviewing the output');
    } else {
        const expected = fs.readFileSync(expected_path, 'utf8');
        if (out !== expected) problems.push('output differs from expected at ' + first_diff(out, expected));
    }

    let again;
    try { again = format_jqhtml(out, options); } catch (err) { again = null; }
    if (again !== out) problems.push('not idempotent: format(format(x)) != format(x)' + (again === null ? ' (second pass threw)' : ' at ' + first_diff(again, out)));

    for (let i = 0; i < out.length; i++) {
        const c = out.charCodeAt(i);
        if (c >= 0xE000 && c <= 0xF8FF && source.indexOf(out[i]) === -1) {
            problems.push(`placeholder sentinel U+${c.toString(16).toUpperCase()} leaked`);
            break;
        }
    }

    if (parser) {
        // Only meaningful when the source itself compiles.
        let original_ok = true;
        try { parser.generate(parser.parse(source, name + '.jqhtml'), name + '.jqhtml'); } catch (e) { original_ok = false; }
        if (original_ok) {
            try { parser.generate(parser.parse(out, name + '.jqhtml'), name + '.jqhtml'); }
            catch (e) { problems.push('formatted output no longer compiles: ' + e.message.split('\n')[0]); }
        }
    }

    problems.length ? fail(name, problems.join('\n')) : ok(name);
}

function run_error_fixture(file) {
    const name = 'errors/' + path.basename(file, '.jqhtml');
    const source = fs.readFileSync(file, 'utf8');
    const expected_path = file.replace(/\.jqhtml$/, '.expected.txt');
    let message = null;
    try {
        format_jqhtml(source, DEFAULT_OPTIONS);
    } catch (err) {
        if (!(err instanceof JqhtmlFormatError)) return fail(name, `threw a non-format error: ${err.message}`);
        const line = source.substring(0, err.offset).split('\n').length;
        message = `${err.message} (line ${line})`;
    }
    if (message === null) return fail(name, 'expected the formatter to refuse this document, but it formatted it');
    if (update) { fs.writeFileSync(expected_path, message + '\n', 'utf8'); updated++; }
    if (!fs.existsSync(expected_path)) return fail(name, `no .expected.txt; formatter said: ${message}`);
    const expected = fs.readFileSync(expected_path, 'utf8').trim();
    message === expected ? ok(name) : fail(name, `expected "${expected}"\n       got      "${message}"`);
}

const list = (dir) => fs.readdirSync(dir)
    .filter(f => f.endsWith('.jqhtml') && !f.endsWith('.expected.jqhtml'))
    .filter(f => !only || f === only || f === only + '.jqhtml')
    .map(f => path.join(dir, f)).sort();

console.log(`formatter fixtures${parser ? ' (compile check on)' : ' (parser not found; compile check off)'}:`);
list(FIXTURES).forEach(run_fixture);
if (fs.existsSync(ERRORS)) list(ERRORS).forEach(run_error_fixture);

console.log(update ? `\n${updated} expected file(s) written` : '');
console.log(failed === 0 ? `all ${passed} passed` : `${failed} failed, ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);
