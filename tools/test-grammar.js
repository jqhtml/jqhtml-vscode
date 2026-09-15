#!/usr/bin/env node
/**
 * Tier 2: TextMate tokenisation snapshots for syntaxes/*.tmLanguage.json.
 *
 *   node tools/test-grammar.js            run
 *   node tools/test-grammar.js --update   rewrite every .expected.txt from current output
 *   node tools/test-grammar.js <name>     run one fixture
 *
 * For every tools/grammar-fixtures/<name>.jqhtml the file is tokenised with the
 * real vscode-textmate engine (the same one VS Code runs) and compared line by
 * line against <name>.expected.txt, one token per line:
 *
 *     "<"<TAB>meta.tag.component.jqhtml punctuation.definition.tag.begin.jqhtml
 *
 * The token text is JSON-encoded and the root scope (source.jqhtml) is dropped
 * from every scope list, since it is on every token and carries no information.
 *
 * A fixture is tokenised with source.jqhtml unless a sibling <name>.scope.txt
 * names a different grammar (the blade injection grammar is exercised standalone
 * that way - injections have no host grammar here).
 *
 * The expected files ARE the spec: several of them are written by hand to the
 * behaviour the grammar SHOULD have and fail today. Read the diff before
 * running --update, and never --update a hand-written expectation into
 * agreement with a bug.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vsctm = require('vscode-textmate');
const oniguruma = require('vscode-oniguruma');

const EXT = path.join(__dirname, '..');
const FIXTURES = path.join(__dirname, 'grammar-fixtures');

/** scopeName -> grammar file. source.js is VS Code's own grammar, see tools/grammars/README.md. */
const GRAMMARS = {
    'source.jqhtml': path.join(EXT, 'syntaxes', 'jqhtml.tmLanguage.json'),
    'source.jqhtml.blade-injection': path.join(EXT, 'syntaxes', 'blade-jqhtml.tmLanguage.json'),
    'source.js': path.join(__dirname, 'grammars', 'JavaScript.tmLanguage.json'),
};

const argv = process.argv.slice(2);
const update = argv.includes('--update');
const only = argv.find(a => !a.startsWith('--')) || null;

let passed = 0, failed = 0, updated = 0;

function fail(name, message) {
    failed++;
    console.log(`  FAIL ${name}\n       ${message.split('\n').join('\n       ')}`);
}
function ok(name) { passed++; console.log(`  ok   ${name}`); }

async function make_registry() {
    const wasm = fs.readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm'));
    await oniguruma.loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength));
    return new vsctm.Registry({
        onigLib: Promise.resolve({
            createOnigScanner: (patterns) => new oniguruma.OnigScanner(patterns),
            createOnigString: (s) => new oniguruma.OnigString(s),
        }),
        loadGrammar: async (scopeName) => {
            const file = GRAMMARS[scopeName];
            if (!file) { return null; }
            return vsctm.parseRawGrammar(fs.readFileSync(file, 'utf8'), file);
        },
    });
}

/** Tokenise `text` and render it as the one-token-per-line snapshot format. */
function tokenize(grammar, root_scope, text) {
    const lines = text.replace(/\n$/, '').split('\n');
    let state = vsctm.INITIAL;
    const out = [];
    for (const line of lines) {
        const result = grammar.tokenizeLine(line, state);
        for (const token of result.tokens) {
            const piece = line.substring(token.startIndex, token.endIndex);
            if (piece === '') { continue; }
            const scopes = token.scopes.filter(s => s !== root_scope);
            out.push(JSON.stringify(piece) + '\t' + scopes.join(' '));
        }
        state = result.ruleStack;
    }
    return out.join('\n') + '\n';
}

function first_diff(actual, expected) {
    const a = actual.split('\n'), b = expected.split('\n');
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if (a[i] !== b[i]) {
            return `line ${i + 1}\n  expected: ${b[i] === undefined ? '<end of file>' : b[i]}\n  actual:   ${a[i] === undefined ? '<end of file>' : a[i]}`;
        }
    }
    return 'differs only in trailing whitespace';
}

async function main() {
    if (!fs.existsSync(FIXTURES)) {
        console.error(`no fixtures directory: ${FIXTURES}`);
        process.exit(2);
    }
    const registry = await make_registry();
    const cache = new Map();

    const files = fs.readdirSync(FIXTURES)
        .filter(f => f.endsWith('.jqhtml'))
        .filter(f => !only || f === only || f === only + '.jqhtml')
        .sort();

    console.log('grammar tokenisation fixtures:');

    for (const file of files) {
        const name = path.basename(file, '.jqhtml');
        const source_path = path.join(FIXTURES, file);
        const scope_path = path.join(FIXTURES, name + '.scope.txt');
        const expected_path = path.join(FIXTURES, name + '.expected.txt');

        const root_scope = fs.existsSync(scope_path)
            ? fs.readFileSync(scope_path, 'utf8').trim()
            : 'source.jqhtml';

        if (!cache.has(root_scope)) {
            const grammar = await registry.loadGrammar(root_scope);
            if (!grammar) { fail(name, `no grammar registered for scope ${root_scope}`); continue; }
            cache.set(root_scope, grammar);
        }

        const actual = tokenize(cache.get(root_scope), root_scope,
            fs.readFileSync(source_path, 'utf8'));

        if (update) { fs.writeFileSync(expected_path, actual, 'utf8'); updated++; }

        if (!fs.existsSync(expected_path)) {
            fail(name, 'no .expected.txt - write one by hand, or run --update and review the output');
            continue;
        }
        const expected = fs.readFileSync(expected_path, 'utf8');
        actual === expected ? ok(name) : fail(name, first_diff(actual, expected));
    }

    console.log(update ? `\n${updated} expected file(s) written` : '');
    console.log(failed === 0 ? `all ${passed} passed` : `${failed} failed, ${passed} passed`);
    process.exit(failed === 0 ? 0 : 1);
}

main().catch(err => { console.error(err); process.exit(2); });
