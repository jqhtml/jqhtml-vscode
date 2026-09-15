'use strict';
/**
 * Tier 3 test suite - runs INSIDE a real VS Code extension host.
 *
 * VS Code loads this module via --extensionTestsPath and calls run(); the
 * returned promise rejecting is what marks the run as failed. Deliberately no
 * mocha: the whole contract is one exported function, and a test framework here
 * buys nothing but another vendored dependency.
 *
 * What only this tier can prove: that the extension actually activates, that
 * VS Code's own command layer (executeDefinitionProvider, executeHoverProvider,
 * executeFormatDocumentProvider) reaches our providers, and how the
 * auto-closing-tag handler behaves against real typing and against the
 * auto-closing pairs in language-configuration.json - which the stubbed tier
 * cannot see at all.
 */

const vscode = require('vscode');
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const EXT_DIR = path.resolve(__dirname, '..', '..', '..');
const WORKSPACE = path.resolve(__dirname, '..', 'workspace');

const results = [];

async function test(name, fn) {
    try {
        await fn();
        results.push({ name, ok: true });
        console.log(`  ok   ${name}`);
    } catch (err) {
        results.push({ name, ok: false, error: err });
        const detail = (err && err.message ? err.message : String(err)).split('\n').join('\n       ');
        console.log(`  FAIL ${name}\n       ${detail}`);
    }
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function uri_for(name) { return vscode.Uri.file(path.join(WORKSPACE, name)); }

/** Wait until the component index has picked the workspace up. */
async function wait_for_index(doc, position, attempts = 40) {
    for (let i = 0; i < attempts; i++) {
        const locations = await vscode.commands.executeCommand(
            'vscode.executeDefinitionProvider', doc.uri, position);
        if (locations && locations.length > 0) { return locations; }
        await sleep(250);
    }
    return [];
}

/**
 * Open an untitled jqhtml document in an editor, type `text` into it, and
 * return the resulting document text after the auto-close handler has run.
 *
 * Typing is done with editor.edit() insertions rather than the `type` command
 * so the test controls exactly what the extension's onDidChangeTextDocument
 * handler sees.
 */
async function type_into_new_document(pieces) {
    const doc = await vscode.workspace.openTextDocument({ language: 'jqhtml', content: '' });
    const editor = await vscode.window.showTextDocument(doc, { preview: false });
    for (const piece of pieces) {
        const end = doc.lineAt(doc.lineCount - 1).range.end;
        await editor.edit(builder => builder.insert(end, piece));
        await sleep(300);
    }
    await sleep(300);
    return doc.getText();
}

/**
 * Like type_into_new_document, but the document starts with `content` and the
 * pieces are typed at `position` - for the "a closing tag already follows the
 * cursor" case, which cannot be produced by appending at the end.
 */
async function type_at(content, position, pieces) {
    const doc = await vscode.workspace.openTextDocument({ language: 'jqhtml', content });
    const editor = await vscode.window.showTextDocument(doc, { preview: false });
    let where = position;
    for (const piece of pieces) {
        await editor.edit(builder => builder.insert(where, piece));
        where = where.translate(0, piece.length);
        await sleep(300);
    }
    await sleep(300);
    return doc.getText();
}

async function run_tests() {
    console.log('extension host suite:');

    // The extension must be present and activatable; everything else is moot otherwise.
    const ext = vscode.extensions.getExtension('jqhtml.jqhtml-vscode-extension')
        || vscode.extensions.all.find(e => e.packageJSON && e.packageJSON.name === 'vscode-extension' && e.packageJSON.publisher === 'jqhtml')
        || vscode.extensions.all.find(e => e.id.toLowerCase().indexOf('jqhtml') !== -1);

    await test('the jqhtml extension is loaded and activates', async () => {
        assert.ok(ext, `extension not found. loaded: ${vscode.extensions.all.map(e => e.id).join(', ')}`);
        await ext.activate();
        assert.strictEqual(ext.isActive, true);
    });

    const page = await vscode.workspace.openTextDocument(uri_for('Page.jqhtml'));
    await vscode.window.showTextDocument(page, { preview: false });

    // Line 1 is "    <Card>"; character 6 is inside the component name.
    const card_position = new vscode.Position(1, 6);

    await test('executeDefinitionProvider on <Card> resolves to the Define', async () => {
        const locations = await wait_for_index(page, card_position);
        assert.ok(locations.length > 0, 'no definition returned for <Card>');
        const target = locations[0];
        const target_uri = target.uri || target.targetUri;
        assert.ok(target_uri.fsPath.endsWith('Card.jqhtml'),
            `definition went to ${target_uri.fsPath}, expected Card.jqhtml`);
        const range = target.range || target.targetRange;
        assert.strictEqual(range.start.line, 0, 'definition did not land on the <Define:Card> line');
    });

    await test('executeHoverProvider on <Card> returns the "Defined in" hover', async () => {
        const hovers = await vscode.commands.executeCommand(
            'vscode.executeHoverProvider', page.uri, card_position);
        assert.ok(hovers && hovers.length > 0, 'no hover returned');
        const text = hovers.map(h => h.contents.map(c => (typeof c === 'string' ? c : c.value)).join('\n')).join('\n');
        assert.ok(text.indexOf('Defined in') !== -1, `hover text has no "Defined in": ${text}`);
        assert.ok(text.indexOf('Card.jqhtml') !== -1, 'hover does not name Card.jqhtml');
    });

    await test('executeFormatDocumentProvider agrees with tools/format-cli.js', async () => {
        const messy_uri = uri_for('messy.jqhtml');
        const messy = await vscode.workspace.openTextDocument(messy_uri);
        await vscode.window.showTextDocument(messy, { preview: false });

        const edits = await vscode.commands.executeCommand(
            'vscode.executeFormatDocumentProvider', messy_uri,
            { tabSize: 4, insertSpaces: true });
        assert.ok(edits && edits.length > 0, 'the formatter returned no edits for a badly indented document');

        // Apply the edits to the original text, exactly as VS Code would.
        const original = messy.getText();
        let formatted = original;
        const sorted = edits.slice().sort((a, b) =>
            messy.offsetAt(b.range.start) - messy.offsetAt(a.range.start));
        for (const edit of sorted) {
            const start = messy.offsetAt(edit.range.start);
            const end = messy.offsetAt(edit.range.end);
            formatted = formatted.substring(0, start) + edit.newText + formatted.substring(end);
        }

        const cli = execFileSync(process.execPath,
            [path.join(EXT_DIR, 'tools', 'format-cli.js'), messy_uri.fsPath, '--stdout'],
            { encoding: 'utf8', cwd: EXT_DIR });

        assert.strictEqual(formatted, cli,
            'the document formatting provider and tools/format-cli.js disagree');
    });

    await test('typing <Foo> auto-closes to <Foo></Foo>', async () => {
        const text = await type_into_new_document(['<Foo', '>']);
        assert.strictEqual(text, '<Foo></Foo>');
    });

    // KNOWN BUG (expected to fail): the auto-close handler checks for a self-closing
    // tag, but a component typed as `<Foo />` still gets a `</Foo>` appended.
    await test('typing <Foo /> does NOT append a closing tag', async () => {
        const text = await type_into_new_document(['<Foo /', '>']);
        assert.strictEqual(text, '<Foo />',
            `a self-closing component got a closing tag appended: ${JSON.stringify(text)}`);
    });

    await test('typing <div> auto-closes to <div></div>', async () => {
        const text = await type_into_new_document(['<div', '>']);
        assert.strictEqual(text, '<div></div>');
    });

    await test('typing <br> does NOT append a closing tag (void element)', async () => {
        const text = await type_into_new_document(['<br', '>']);
        assert.strictEqual(text, '<br>');
    });

    await test('typing <my-el> auto-closes to <my-el></my-el>', async () => {
        const text = await type_into_new_document(['<my-el', '>']);
        assert.strictEqual(text, '<my-el></my-el>');
    });

    await test('typing <Define:Foo> auto-closes to </Define:Foo>', async () => {
        const text = await type_into_new_document(['<Define:Foo', '>']);
        assert.strictEqual(text, '<Define:Foo></Define:Foo>');
    });

    await test('typing <Foo> in front of an existing </Foo> does not duplicate it', async () => {
        const text = await type_at('</Foo>', new vscode.Position(0, 0), ['<Foo', '>']);
        assert.strictEqual(text, '<Foo></Foo>',
            `a second closing tag was inserted: ${JSON.stringify(text)}`);
    });

    await test('typing > inside a <% %> code block does not close a tag', async () => {
        const text = await type_into_new_document(['<% if (a<Foo && b', '>']);
        assert.strictEqual(text.indexOf('</Foo>'), -1,
            `a closing tag was inserted inside a code block: ${JSON.stringify(text)}`);
    });

    await test('typing <Slot:body> auto-closes to </Slot:body>', async () => {
        const text = await type_into_new_document(['<Slot:body', '>']);
        assert.ok(text.indexOf('</Slot:body>') !== -1,
            `expected a closing slot tag, got ${JSON.stringify(text)}`);
    });

    // EXPLORATORY: language-configuration.json declares an auto-closing PAIR
    // { open: "<Define:", close: "</Define:" } while extension.ts also appends a
    // closing tag from its own onDidChangeTextDocument handler. The two must not
    // both fire. The assertion is deliberately lenient - it only pins the one
    // outcome that is unambiguously wrong - and the actual text is printed so the
    // real behaviour is on the record.
    await test('typing <Define: does not produce a duplicated </Define:', async () => {
        const text = await type_into_new_document(['<Define:']);
        console.log(`       <Define: produced ${JSON.stringify(text)}`);
        const occurrences = text.split('</Define:').length - 1;
        assert.ok(occurrences <= 1,
            `"</Define:" appears ${occurrences} times: ${JSON.stringify(text)}`);
    });

    await vscode.commands.executeCommand('workbench.action.closeAllEditors');

    const failed = results.filter(r => !r.ok);
    console.log('');
    console.log(failed.length === 0
        ? `all ${results.length} passed`
        : `${failed.length} failed, ${results.length - failed.length} passed`);
    if (failed.length > 0) {
        console.log('failing: ' + failed.map(r => r.name).join(', '));
        throw new Error(`${failed.length} extension host test(s) failed`);
    }
}

function run() {
    return run_tests();
}

module.exports = { run };
