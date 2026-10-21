#!/usr/bin/env node
/**
 * Tier 1: node unit tests for the extension's providers, run against the
 * compiled out/*.js with `vscode` replaced by tools/vscode-stub.js.
 *
 *   node tools/test-providers.js          run everything
 *   node tools/test-providers.js <substr>  run only matching tests
 *
 * No framework: plain assertions, "  ok   name" / "  FAIL name", exit 1 on
 * failure - the same output shape as test-formatter.js.
 *
 * Some assertions describe the CORRECT behaviour rather than today's; those
 * fail on purpose and are called out in the header comment of each test.
 */
'use strict';

const assert = require('assert');
const { create_stub, load_with_stub } = require('./vscode-stub');

const only = process.argv.slice(2).find(a => !a.startsWith('--')) || null;

let passed = 0, failed = 0;
const failures = [];

async function test(name, fn) {
    if (only && name.indexOf(only) === -1) { return; }
    try {
        await fn();
        passed++;
        console.log(`  ok   ${name}`);
    } catch (err) {
        failed++;
        failures.push(name);
        const detail = (err && err.message ? err.message : String(err)).split('\n').join('\n       ');
        console.log(`  FAIL ${name}\n       ${detail}`);
    }
}

// Providers log heavily; silence them so the test output is readable.
const real_log = console.log, real_error = console.error;
function quiet(fn) {
    return async function () {
        console.log = () => {};
        console.error = () => {};
        try { return await fn(); } finally { console.log = real_log; console.error = real_error; }
    };
}

// ---------------------------------------------------------------------------
// The shared in-memory workspace.
// ---------------------------------------------------------------------------

const WORKSPACE = {
    'src/Foo.jqhtml': [
        '<Define:Foo>',
        '    <button $handler=this.method>Go</button>',
        '</Define:Foo>',
        '',
    ].join('\n'),

    'src/Card.jqhtml': [
        '<Define:Card tag="span">',
        "    <header><%= content('header') %></header>",
        "    <div><%= content('Body') %></div>",
        '</Define:Card>',
        '',
    ].join('\n'),

    'src/usage.jqhtml': [
        '<Define:Usage extends="Foo">',
        '    <Foo tag="span">',
        '        <div>plain html</div>',
        '    </Foo>',
        '    <span $redrawable>x</span>',
        '    Some Text Here',
        '</Define:Usage>',
        '',
    ].join('\n'),

    'src/slots.jqhtml': [
        '<Define:Slots>',
        '    <Card>',
        '        <Slot:header>Hi</Slot:header>',
        '        <Slot:Body>Yo</Slot:Body>',
        '    </Card>',
        '</Define:Slots>',
        '',
    ].join('\n'),

    'src/handlers.jqhtml': [
        '<Define:Handlers>',
        '    <button $handler=Ctl.run>a</button>',
        '    <button $handler=standalone_fn>b</button>',
        '    <button $handler=arrow_fn>c</button>',
        '</Define:Handlers>',
        '',
    ].join('\n'),

    'src/dollar.jqhtml': [
        '<Define:Dollar>',
        '    <button $handler=Foo$Bar.run$now>x</button>',
        '</Define:Dollar>',
        '',
    ].join('\n'),

    'src/dollar.js': 'class Foo$Bar {\n    run$now() {}\n}\n',
    'src/foo.js': 'class Foo {\n    method() {\n        return 1;\n    }\n}\n',
    'src/ctl.js': 'class Ctl {\n    run() {}\n}\n',
    'src/fns.js': 'function standalone_fn() {}\nconst arrow_fn = () => {};\n',
};

/** A fresh stub + fully-built component index for one test. */
async function build(extra) {
    const stub = create_stub(Object.assign({ files: WORKSPACE }, extra || {}));
    // One load pass, so the index module the providers import is the same instance.
    const [{ JqhtmlComponentIndex }, { JqhtmlDefinitionProvider, JqhtmlHoverProvider }] =
        load_with_stub(stub, 'componentIndex.js', 'definitionProvider.js');
    const index = new JqhtmlComponentIndex();
    await index.reindexWorkspace();
    return {
        stub,
        index,
        definition: new JqhtmlDefinitionProvider(index),
        hover: new JqhtmlHoverProvider(index),
        doc: (rel) => stub.documents.get('/ws/' + rel),
        pos: stub.pos,
    };
}

const TOKEN = { isCancellationRequested: false, onCancellationRequested() {} };

// ---------------------------------------------------------------------------
// component_name
// ---------------------------------------------------------------------------

async function component_name_tests() {
    console.log('\ncomponent_name:');
    const stub = create_stub({ files: {} });
    const { is_component_name } = load_with_stub(stub, 'component_name.js');

    await test('component_name: accepts Foo', () => assert.strictEqual(is_component_name('Foo'), true));
    await test('component_name: accepts _Foo', () => assert.strictEqual(is_component_name('_Foo'), true));
    await test('component_name: accepts Foo_Bar1', () => assert.strictEqual(is_component_name('Foo_Bar1'), true));
    await test('component_name: rejects foo', () => assert.strictEqual(is_component_name('foo'), false));
    await test('component_name: rejects __Foo', () => assert.strictEqual(is_component_name('__Foo'), false));
    await test('component_name: rejects _foo', () => assert.strictEqual(is_component_name('_foo'), false));
    await test('component_name: rejects 1Foo', () => assert.strictEqual(is_component_name('1Foo'), false));
    await test('component_name: rejects empty string', () => assert.strictEqual(is_component_name(''), false));
}

// ---------------------------------------------------------------------------
// componentIndex
// ---------------------------------------------------------------------------

async function component_index_tests() {
    console.log('\ncomponentIndex:');

    const files = {
        'src/Foo.jqhtml': '<Define:Foo>\n</Define:Foo>\n',
        'src/Bar.jqhtml': '<Define:_Bar tag="span">\n</Define:_Bar>\n',
        'node_modules/dep/Vendored.jqhtml': '<Define:Vendored>\n',
        'build/Generated.jqhtml': '<Define:Generated>\n',
    };
    const config = { 'files.exclude': { '**/build/**': true } };

    async function fresh(extra) {
        const stub = create_stub(Object.assign({ files, config }, extra || {}));
        const { JqhtmlComponentIndex } = load_with_stub(stub, 'componentIndex.js');
        const index = new JqhtmlComponentIndex();
        await index.reindexWorkspace();
        return { stub, index };
    }

    await test('componentIndex: indexes <Define:Foo>', quiet(async () => {
        const { index } = await fresh();
        const def = index.findComponent('Foo');
        assert.ok(def, 'Foo not indexed');
        assert.strictEqual(def.position.line, 0);
        assert.strictEqual(def.position.character, '<Define:'.length);
    }));

    await test('componentIndex: indexes <Define:_Bar tag="span">', quiet(async () => {
        const { index } = await fresh();
        const def = index.findComponent('_Bar');
        assert.ok(def, '_Bar not indexed');
        assert.strictEqual(def.line, '<Define:_Bar tag="span">');
    }));

    await test('componentIndex: ignores files under node_modules', quiet(async () => {
        const { index } = await fresh();
        assert.strictEqual(index.findComponent('Vendored'), undefined);
    }));

    await test('componentIndex: ignores files matched by files.exclude', quiet(async () => {
        const { index } = await fresh();
        assert.strictEqual(index.findComponent('Generated'), undefined);
    }));

    await test('componentIndex: removes entries when the file is deleted', quiet(async () => {
        const { stub, index } = await fresh();
        assert.ok(index.findComponent('Foo'));
        const watcher = stub.watchers[stub.watchers.length - 1];
        assert.ok(watcher, 'no file system watcher was created');
        await watcher.fire('delete', stub.uri('src/Foo.jqhtml'));
        assert.strictEqual(index.findComponent('Foo'), undefined, 'Foo survived the delete event');
        assert.ok(index.findComponent('_Bar'), 'deleting one file dropped another file\'s components');
    }));

    // KNOWN BUG: reindexWorkspace() assigns this.indexPromise and clears it only
    // after a successful await - there is no try/finally - so one rejected
    // reindex leaves the rejected promise cached and every later call re-throws
    // the original error and never re-indexes.
    await test('componentIndex: a reindex after a failed reindex still works', quiet(async () => {
        const { stub, index } = await fresh();
        stub.state.findFilesFailures = 1;
        await index.reindexWorkspace().then(
            () => { throw new Error('expected the first reindex to reject'); },
            () => undefined,
        );
        stub.state.findFilesFailures = 0;
        await index.reindexWorkspace();
        assert.ok(index.findComponent('Foo'), 'the index is empty after recovering from a failed reindex');
    }));
}

// ---------------------------------------------------------------------------
// definitionProvider
// ---------------------------------------------------------------------------

async function definition_tests() {
    console.log('\ndefinitionProvider:');

    await test('definition: F12 on <Foo> opening tag resolves to the Define', quiet(async () => {
        const ctx = await build();
        const loc = await ctx.definition.provideDefinition(ctx.doc('src/usage.jqhtml'), ctx.pos(1, 6), TOKEN);
        assert.ok(loc, 'no definition returned');
        assert.strictEqual(loc.uri.fsPath, '/ws/src/Foo.jqhtml');
        assert.strictEqual(loc.range.start.line, 0);
    }));

    await test('definition: F12 on </Foo> closing tag resolves to the Define', quiet(async () => {
        const ctx = await build();
        const loc = await ctx.definition.provideDefinition(ctx.doc('src/usage.jqhtml'), ctx.pos(3, 7), TOKEN);
        assert.ok(loc, 'no definition returned');
        assert.strictEqual(loc.uri.fsPath, '/ws/src/Foo.jqhtml');
    }));

    await test('definition: F12 on extends="Foo" resolves to the Define', quiet(async () => {
        const ctx = await build();
        const loc = await ctx.definition.provideDefinition(ctx.doc('src/usage.jqhtml'), ctx.pos(0, 24), TOKEN);
        assert.ok(loc, 'no definition returned');
        assert.strictEqual(loc.uri.fsPath, '/ws/src/Foo.jqhtml');
    }));

    await test('definition: a lowercase html tag returns undefined', quiet(async () => {
        const ctx = await build();
        const loc = await ctx.definition.provideDefinition(ctx.doc('src/usage.jqhtml'), ctx.pos(2, 10), TOKEN);
        assert.strictEqual(loc, undefined);
    }));

    await test('definition: a capitalised word outside any tag returns undefined', quiet(async () => {
        const ctx = await build();
        const loc = await ctx.definition.provideDefinition(ctx.doc('src/usage.jqhtml'), ctx.pos(5, 10), TOKEN);
        assert.strictEqual(loc, undefined);
    }));

    await test('definition: <Slot:Body> resolves to content(\'Body\') in the parent', quiet(async () => {
        const ctx = await build();
        const loc = await ctx.definition.provideDefinition(ctx.doc('src/slots.jqhtml'), ctx.pos(3, 16), TOKEN);
        assert.ok(loc, 'no definition returned for the uppercase slot');
        assert.strictEqual(loc.uri.fsPath, '/ws/src/Card.jqhtml');
        assert.strictEqual(loc.range.start.line, 2);
    }));

    // KNOWN BUG: the slot detection regexes in provideDefinition require an
    // uppercase first letter (/<\/?Slot:\s*[A-Z][A-Za-z0-9_]*$/), but slot names
    // are ordinary identifiers - <Slot:header> is the common case.
    await test('definition: <Slot:header> (lowercase) resolves to content(\'header\')', quiet(async () => {
        const ctx = await build();
        const loc = await ctx.definition.provideDefinition(ctx.doc('src/slots.jqhtml'), ctx.pos(2, 16), TOKEN);
        assert.ok(loc, 'no definition returned for a lowercase slot name');
        assert.strictEqual(loc.uri.fsPath, '/ws/src/Card.jqhtml');
        assert.strictEqual(loc.range.start.line, 1);
    }));

    await test('definition: $handler=this.method resolves to the JS class method', quiet(async () => {
        const ctx = await build({ intelephense: true });
        const loc = await ctx.definition.provideDefinition(ctx.doc('src/Foo.jqhtml'), ctx.pos(1, 29), TOKEN);
        assert.ok(loc, 'no definition returned');
        assert.strictEqual(loc.uri.fsPath, '/ws/src/foo.js');
        assert.strictEqual(loc.range.start.line, 1);
    }));

    // KNOWN BUG: checkDollarAttributeContext rewrites className from "this" to the
    // enclosing component name BEFORE handleDollarAttributeDefinition tests
    // `className === 'this'`, so the "skip PHP for this.*" rule never fires and
    // every `this.x` handler round-trips through Intelephense first.
    await test('definition: $handler=this.method does not query PHP workspace symbols', quiet(async () => {
        const ctx = await build({ intelephense: true });
        await ctx.definition.provideDefinition(ctx.doc('src/Foo.jqhtml'), ctx.pos(1, 29), TOKEN);
        assert.deepStrictEqual(
            ctx.stub.calls.workspaceSymbolQueries, [],
            'executeWorkspaceSymbolProvider was called for a "this." handler');
    }));

    await test('definition: $handler=Ctl.run resolves to the JS class member', quiet(async () => {
        const ctx = await build();
        const loc = await ctx.definition.provideDefinition(ctx.doc('src/handlers.jqhtml'), ctx.pos(1, 26), TOKEN);
        assert.ok(loc, 'no definition returned');
        assert.strictEqual(loc.uri.fsPath, '/ws/src/ctl.js');
        assert.strictEqual(loc.range.start.line, 1);
    }));

    await test('definition: $handler=fn resolves to a standalone function fn', quiet(async () => {
        const ctx = await build();
        const loc = await ctx.definition.provideDefinition(ctx.doc('src/handlers.jqhtml'), ctx.pos(2, 25), TOKEN);
        assert.ok(loc, 'no definition returned');
        assert.strictEqual(loc.uri.fsPath, '/ws/src/fns.js');
        assert.strictEqual(loc.range.start.line, 0);
    }));

    await test('definition: $handler=fn resolves to a const fn = ...', quiet(async () => {
        const ctx = await build();
        const loc = await ctx.definition.provideDefinition(ctx.doc('src/handlers.jqhtml'), ctx.pos(3, 24), TOKEN);
        assert.ok(loc, 'no definition returned');
        assert.strictEqual(loc.uri.fsPath, '/ws/src/fns.js');
        assert.strictEqual(loc.range.start.line, 1);
    }));
}


// ---------------------------------------------------------------------------
// componentIndex: duplicates
// ---------------------------------------------------------------------------

async function duplicate_tests() {
    console.log('\ncomponentIndex duplicates:');

    const files = {
        'src/a/Dup.jqhtml': '<Define:Dup>\n</Define:Dup>\n',
        'src/b/Dup.jqhtml': '<Define:Dup>\n</Define:Dup>\n',
        'src/c/Dup.jqhtml': '<Define:Dup>\n</Define:Dup>\n',
    };

    async function fresh() {
        const stub = create_stub({ files });
        const { JqhtmlComponentIndex } = load_with_stub(stub, 'componentIndex.js');
        const index = new JqhtmlComponentIndex();
        await index.reindexWorkspace();
        return { stub, index };
    }

    await test('duplicates: findComponent returns the first file that defined the name', quiet(async () => {
        const { index } = await fresh();
        const def = index.findComponent('Dup');
        assert.ok(def);
        assert.strictEqual(def.uri.fsPath, '/ws/src/a/Dup.jqhtml');
    }));

    await test('duplicates: getDuplicates lists every definition, retained one first', quiet(async () => {
        const { index } = await fresh();
        const dups = index.getDuplicates();
        const defs = dups.get('Dup');
        assert.ok(defs, 'Dup is not reported as duplicated');
        assert.deepStrictEqual(defs.map(d => d.uri.fsPath), [
            '/ws/src/a/Dup.jqhtml', '/ws/src/b/Dup.jqhtml', '/ws/src/c/Dup.jqhtml']);
    }));

    await test('duplicates: exactly one warning per name, naming both files', quiet(async () => {
        const { stub } = await fresh();
        const lines = stub.calls.output.filter(o => o.text.indexOf('duplicate component') !== -1);
        assert.strictEqual(lines.length, 1, `expected 1 duplicate warning, got ${lines.length}`);
        assert.ok(lines[0].text.indexOf('/ws/src/a/Dup.jqhtml') !== -1, 'warning does not name the retained file');
        assert.ok(lines[0].text.indexOf('/ws/src/b/Dup.jqhtml') !== -1, 'warning does not name the shadowing file');
    }));

    await test('duplicates: deleting the winner promotes the shadowed definition', quiet(async () => {
        const { stub, index } = await fresh();
        const watcher = stub.watchers[stub.watchers.length - 1];
        await watcher.fire('delete', stub.uri('src/a/Dup.jqhtml'));
        const def = index.findComponent('Dup');
        assert.ok(def, 'Dup disappeared although two other files define it');
        assert.strictEqual(def.uri.fsPath, '/ws/src/b/Dup.jqhtml');
    }));
}

// ---------------------------------------------------------------------------
// logging
// ---------------------------------------------------------------------------

async function log_tests() {
    console.log('\nlogging:');

    const files = { 'src/Foo.jqhtml': '<Define:Foo>\n</Define:Foo>\n' };

    async function indexed(config) {
        const stub = create_stub({ files, config });
        const { JqhtmlComponentIndex } = load_with_stub(stub, 'componentIndex.js');
        const index = new JqhtmlComponentIndex();
        await index.reindexWorkspace();
        return stub;
    }

    await test('log: the index summary is written to the JQHTML output channel', quiet(async () => {
        const stub = await indexed();
        assert.ok(stub.calls.outputChannels.length > 0, 'no output channel was created');
        assert.strictEqual(stub.calls.outputChannels[0].name, 'JQHTML');
        assert.ok(stub.calls.output.some(o => /indexed \d+ components/.test(o.text)),
            `no index summary in the channel: ${JSON.stringify(stub.calls.output)}`);
    }));

    await test('log: debug lines are suppressed unless jqhtml.debug is on', quiet(async () => {
        const stub = await indexed();
        assert.ok(!stub.calls.output.some(o => o.text.indexOf('starting workspace component indexing') !== -1),
            'a debug line was logged with jqhtml.debug off');
    }));

    await test('log: debug lines appear when jqhtml.debug is on', quiet(async () => {
        const stub = await indexed({ 'jqhtml.debug': true });
        assert.ok(stub.calls.output.some(o => o.text.indexOf('starting workspace component indexing') !== -1),
            'jqhtml.debug is on but no debug line was logged');
    }));

    await test('log: nothing is written to console.log', quiet(async () => {
        const seen = [];
        const saved = console.log;
        console.log = (...a) => seen.push(a.join(' '));
        try { await indexed({ 'jqhtml.debug': true }); } finally { console.log = saved; }
        assert.deepStrictEqual(seen, [], `the index still writes to the console: ${seen.join(' | ')}`);
    }));
}

// ---------------------------------------------------------------------------
// definitionProvider: symbols, cancellation, escaping
// ---------------------------------------------------------------------------

async function definition_search_tests() {
    console.log('\ndefinitionProvider search:');

    await test('search: a workspace symbol is preferred over scanning files', quiet(async () => {
        const symbol = {
            name: 'Ctl',
            kind: 4, // SymbolKind.Class
            location: { uri: { fsPath: '/ws/src/elsewhere.js', toString: () => 'file:///ws/src/elsewhere.js' } },
        };
        const ctx = await build({ symbols: [symbol] });
        const loc = await ctx.definition.provideDefinition(ctx.doc('src/handlers.jqhtml'), ctx.pos(1, 26), TOKEN);
        assert.ok(loc, 'no definition returned');
        assert.strictEqual(loc.uri.fsPath, '/ws/src/elsewhere.js');
        assert.deepStrictEqual(ctx.stub.calls.findFiles.filter(c => c.pattern === '**/*.js'), [],
            'the workspace was scanned even though the symbol provider answered');
    }));

    await test('search: js files are read, never opened as editor documents', quiet(async () => {
        const ctx = await build();
        await ctx.definition.provideDefinition(ctx.doc('src/handlers.jqhtml'), ctx.pos(1, 26), TOKEN);
        const opened = ctx.stub.calls.openTextDocument.filter(p => p.endsWith('.js'));
        assert.deepStrictEqual(opened, [], `openTextDocument was used for: ${opened.join(', ')}`);
    }));

    await test('search: the workspace .js list is built at most once per request', quiet(async () => {
        const ctx = await build();
        // A name that exists nowhere: both the class and the function search run.
        await ctx.definition.provideDefinition(ctx.doc('src/handlers.jqhtml'), ctx.pos(2, 25), TOKEN);
        const listings = ctx.stub.calls.findFiles.filter(c => c.pattern === '**/*.js');
        assert.strictEqual(listings.length, 1, `findFiles('**/*.js') ran ${listings.length} times`);
    }));

    await test('search: a cancelled token stops the search and returns undefined', quiet(async () => {
        const ctx = await build();
        const cancelled = { isCancellationRequested: true, onCancellationRequested() {} };
        const loc = await ctx.definition.provideDefinition(ctx.doc('src/handlers.jqhtml'), ctx.pos(1, 26), cancelled);
        assert.strictEqual(loc, undefined, 'a cancelled request still returned a definition');
        assert.deepStrictEqual(ctx.stub.calls.findFiles.filter(c => c.pattern === '**/*.js'), [],
            'a cancelled request still listed the workspace');
    }));

    await test('search: a $ in the class and member name is matched literally', quiet(async () => {
        const ctx = await build();
        // <button $handler=Foo$Bar.run$now> - cursor inside run$now
        const loc = await ctx.definition.provideDefinition(ctx.doc('src/dollar.jqhtml'), ctx.pos(1, 36), TOKEN);
        assert.ok(loc, 'no definition returned for a name containing $');
        assert.strictEqual(loc.uri.fsPath, '/ws/src/dollar.js');
        assert.strictEqual(loc.range.start.line, 1);
    }));
}

// ---------------------------------------------------------------------------
// auto-closing tags (extension.ts)
// ---------------------------------------------------------------------------

async function auto_close_tests() {
    console.log('\nauto-close:');

    /** The closing tag the handler would insert for the `>` at the end of `text`. */
    function closer(text, after) {
        const line = text + '>' + (after || '');
        const stub = create_stub({ files: { 'src/typing.jqhtml': line + '\n' } });
        const { closing_tag_for } = load_with_stub(stub, 'extension.js');
        const doc = stub.documents.get('/ws/src/typing.jqhtml');
        return closing_tag_for(doc, stub.pos(0, text.length));
    }

    const cases = [
        ['<Foo', undefined, '</Foo>'],
        ['<Foo /', undefined, undefined],
        ['<Foo/', undefined, undefined],
        ['<_Root_Layout', undefined, '</_Root_Layout>'],
        ['<div', undefined, '</div>'],
        ['<div class="a"', undefined, '</div>'],
        ['<br', undefined, undefined],
        ['<img src="a.png"', undefined, undefined],
        ['<my-el', undefined, '</my-el>'],
        ['<Define:Foo', undefined, '</Define:Foo>'],
        ['<Slot:body', undefined, '</Slot:body>'],
        ['<Slot:Body_2', undefined, '</Slot:Body_2>'],
        ['</Foo', undefined, undefined],
        ['<Foo', '</Foo>', undefined],
        ['<Foo', '  </Foo>', undefined],
        ['<div', '</div>', undefined],
        ['<Foo', '</Bar>', '</Foo>'],
        ['<% if (a<Foo && b', undefined, undefined],
        ['<%-- <Foo', undefined, undefined],
        ['<!-- <Foo', undefined, undefined],
        ['<% x %> <Foo', undefined, '</Foo>'],
        // A // comment runs to the end of its line: its %> does not close the block
        ['<% x; // c %> <Foo', undefined, undefined],
        ['<%= x // c %> <Foo', undefined, undefined],
        ['<% x = "http://a %>"; %> <Foo', undefined, '</Foo>'],
        ['<%-- c --%> <Foo', undefined, '</Foo>'],
        ['<!-- c --> <Foo', undefined, '</Foo>'],
    ];

    for (const [typed, after, expected] of cases) {
        const label = `auto-close: ${JSON.stringify(typed + '>' + (after || ''))} -> ${expected === undefined ? 'nothing' : expected}`;
        await test(label, quiet(async () => {
            assert.strictEqual(closer(typed, after), expected);
        }));
    }
}

// ---------------------------------------------------------------------------
// hoverProvider
// ---------------------------------------------------------------------------

async function hover_tests() {
    console.log('\nhoverProvider:');

    await test('hover: <Foo> shows where the component is defined', quiet(async () => {
        const ctx = await build();
        const h = await ctx.hover.provideHover(ctx.doc('src/usage.jqhtml'), ctx.pos(1, 6), TOKEN);
        assert.ok(h, 'no hover returned');
        assert.ok(h.text.indexOf('Defined in') !== -1, `hover text has no "Defined in": ${h.text}`);
        assert.ok(h.text.indexOf('src/Foo.jqhtml') !== -1, 'hover does not name the defining file');
    }));

    await test('hover: $redrawable explains the attribute', quiet(async () => {
        const ctx = await build();
        const h = await ctx.hover.provideHover(ctx.doc('src/usage.jqhtml'), ctx.pos(4, 12), TOKEN);
        assert.ok(h, 'no hover returned');
        assert.ok(h.text.indexOf('$redrawable') !== -1, `hover text is not about $redrawable: ${h.text}`);
        assert.ok(h.text.indexOf('redrawn') !== -1, 'hover does not explain redrawing');
    }));

    await test('hover: $redrawable is matched at the cursor, not at the first occurrence', quiet(async () => {
        const stub = create_stub({ files: {
            'src/two.jqhtml': '<Define:Two>\n    <span $redrawable><i $redrawable>x</i></span>\n</Define:Two>\n',
        } });
        const [{ JqhtmlComponentIndex }, { JqhtmlHoverProvider }] =
            load_with_stub(stub, 'componentIndex.js', 'definitionProvider.js');
        const index = new JqhtmlComponentIndex();
        await index.reindexWorkspace();
        const hover = new JqhtmlHoverProvider(index);
        const doc = stub.documents.get('/ws/src/two.jqhtml');
        // Cursor inside the SECOND $redrawable.
        const line = doc.lineAt(1).text;
        const second = line.indexOf('$redrawable', line.indexOf('$redrawable') + 1);
        const h = await hover.provideHover(doc, stub.pos(1, second + 3), TOKEN);
        assert.ok(h, 'no hover returned for the second $redrawable on the line');
        assert.strictEqual(h.range.start.character, second,
            'the hover range points at the first $redrawable, not the one under the cursor');
    }));

    await test('hover: tag="..." explains the tag attribute', quiet(async () => {
        const ctx = await build();
        const h = await ctx.hover.provideHover(ctx.doc('src/usage.jqhtml'), ctx.pos(1, 17), TOKEN);
        assert.ok(h, 'no hover returned');
        assert.ok(h.text.indexOf('`tag` Attribute') !== -1, `hover text is not about tag=: ${h.text}`);
        assert.ok(h.text.indexOf('Default:') !== -1, 'hover does not state the default element');
    }));
}

// ---------------------------------------------------------------------------
// blade_component_provider
// ---------------------------------------------------------------------------

async function blade_provider_tests() {
    console.log('\nblade_component_provider:');

    const BLADE = '<Foo tag="x"></Foo>\n';

    async function tokens_for(rel, languageId) {
        const stub = create_stub({ files: {} });
        stub.add_file(rel, BLADE, languageId);
        const { BladeComponentSemanticTokensProvider } =
            load_with_stub(stub, 'blade_component_provider.js');
        const provider = new BladeComponentSemanticTokensProvider();
        const result = await provider.provideDocumentSemanticTokens(stub.documents.get('/ws/' + rel));
        return result.tokens;
    }

    await test('blade tokens: <Foo tag="x"></Foo> in a blade document is tokenised', quiet(async () => {
        const tokens = await tokens_for('views/page.blade.php', 'blade');
        assert.strictEqual(tokens.length, 3, `expected 3 tokens, got ${JSON.stringify(tokens)}`);
        // Opening name, tag attribute, closing name.
        assert.deepStrictEqual(
            tokens.map(t => [t.char, t.length, t.type]),
            [[1, 3, 0], [5, 3, 1], [15, 3, 0]]);
    }));

    // KNOWN BUG (expected to fail): the provider gates on
    // `document.languageId !== 'blade'`, but VS Code reports .blade.php as
    // languageId 'php' whenever the Blade extension is not installed - and the
    // extension declares an activation event for 'php' precisely for that case.
    // The gate should be on the file name, not the language id.
    await test('blade tokens: the same .blade.php file is tokenised when languageId is php', quiet(async () => {
        const tokens = await tokens_for('views/page2.blade.php', 'php');
        assert.strictEqual(tokens.length, 3,
            `a .blade.php file with languageId 'php' produced ${tokens.length} tokens, expected 3`);
    }));

    await test('blade tokens: a plain .php file produces no tokens', quiet(async () => {
        const tokens = await tokens_for('app/Controller.php', 'php');
        assert.strictEqual(tokens.length, 0);
    }));
}

// ---------------------------------------------------------------------------
// blade_spacer
// ---------------------------------------------------------------------------

async function blade_spacer_tests() {
    console.log('\nblade_spacer:');

    /**
     * The change VS Code reports when the second `{` is typed and its
     * auto-closing pair is inserted: text '{}' at the character after the first
     * brace, leaving the line as `{{}}`.
     */
    function brace_change(stub, doc) {
        return {
            document: doc,
            contentChanges: [{
                text: '{}',
                range: new stub.vscode.Range(stub.pos(0, 1), stub.pos(0, 1)),
                rangeOffset: 1,
                rangeLength: 0,
            }],
        };
    }

    await test('blade_spacer: typing {{ in the active document inserts the snippet', quiet(async () => {
        const stub = create_stub({ files: { 'views/a.blade.php': '{{}}\n' } });
        const { blade_spacer } = load_with_stub(stub, 'blade_spacer.js');
        const editor = stub.make_editor('views/a.blade.php');
        await blade_spacer(brace_change(stub, editor.document), editor, true);
        assert.strictEqual(stub.calls.insertSnippet.length, 1, 'insertSnippet was not called');
        assert.ok(stub.calls.insertSnippet[0].snippet.indexOf('{{ ') === 0,
            `unexpected snippet: ${stub.calls.insertSnippet[0].snippet}`);
        const range = stub.calls.insertSnippet[0].ranges[0];
        assert.deepStrictEqual(
            [range.start.line, range.start.character, range.end.line, range.end.character],
            [0, 0, 0, 4]);
    }));

    await test('blade_spacer: does nothing when auto-spacing is disabled', quiet(async () => {
        const stub = create_stub({ files: { 'views/a.blade.php': '{{}}\n' } });
        const { blade_spacer } = load_with_stub(stub, 'blade_spacer.js');
        const editor = stub.make_editor('views/a.blade.php');
        await blade_spacer(brace_change(stub, editor.document), editor, false);
        assert.strictEqual(stub.calls.insertSnippet.length, 0);
    }));

    // KNOWN BUG: blade_spacer validates `editor.document` but then reads the
    // change positions out of `e.document`. When a background document changes
    // (a save-time formatter, a source-control revert, another editor group) the
    // snippet is inserted into whatever the user happens to be looking at, at
    // coordinates from a different file.
    await test('blade_spacer: a change in a different document does not insert a snippet', quiet(async () => {
        const stub = create_stub({
            files: { 'views/a.blade.php': '{{}}\n', 'views/b.blade.php': '{{}}\n' },
        });
        const { blade_spacer } = load_with_stub(stub, 'blade_spacer.js');
        const editor = stub.make_editor('views/a.blade.php');
        const other = stub.documents.get('/ws/views/b.blade.php');
        await blade_spacer(brace_change(stub, other), editor, true);
        assert.strictEqual(stub.calls.insertSnippet.length, 0,
            'a change to a document the user is not editing inserted a snippet into the active editor');
    }));

    await test('blade_spacer: ignores non-blade files', quiet(async () => {
        const stub = create_stub({ files: { 'views/a.php': '{{}}\n' } });
        const { blade_spacer } = load_with_stub(stub, 'blade_spacer.js');
        const editor = stub.make_editor('views/a.php');
        await blade_spacer(brace_change(stub, editor.document), editor, true);
        assert.strictEqual(stub.calls.insertSnippet.length, 0);
    }));
}


// ---------------------------------------------------------------------------
// completion
// ---------------------------------------------------------------------------

const COMPLETION_WORKSPACE = {
    'src/user_card.jqhtml': [
        '<Define:User_Card',
        '    $title="Untitled"',
        '    $per_page=25',
        '    $compact',
        '    class="card">',
        '    <h3><%= this.args.title %></h3>',
        "    <% if (this.args['show_avatar']) { %><img src=\"<%= this.args.avatar_url %>\"><% } %>",
        '</Define:User_Card>',
        '',
    ].join('\n'),
    'src/user_card.js': [
        'class User_Card extends Jqhtml_Component {',
        '    on_create() {',
        '        this.args.title = this.args.title || "x";',
        '        this.state.cb = this.args.on_select;',
        '    }',
        '}',
        'class Other {',
        '    on_create() { this.args.not_mine = 1; }',
        '}',
        '',
    ].join('\n'),
    'src/_badge.jqhtml': '<Define:_Badge>\n</Define:_Badge>\n',
    'src/page.jqhtml': '<Define:Page>\n</Define:Page>\n',
};

async function completion_tests() {
    console.log('\ncompletion:');

    /** Provider over COMPLETION_WORKSPACE plus `page_text` as src/edit.jqhtml. */
    async function complete(page_text, extra) {
        // `|` marks the cursor.
        const offset = page_text.indexOf('|');
        const text = page_text.replace('|', '');
        const files = Object.assign({}, COMPLETION_WORKSPACE, { 'src/edit.jqhtml': text }, (extra && extra.files) || {});
        const stub = create_stub(Object.assign({}, extra || {}, { files }));
        const [{ JqhtmlComponentIndex }, { JqhtmlCompletionProvider }] =
            load_with_stub(stub, 'componentIndex.js', 'completionProvider.js');
        const index = new JqhtmlComponentIndex();
        await index.reindexWorkspace();
        const doc = stub.documents.get('/ws/src/edit.jqhtml');
        const position = doc.positionAt(offset);
        const items = await new JqhtmlCompletionProvider(index).provideCompletionItems(doc, position, TOKEN);
        return { items, position, stub };
    }
    const labels = (items) => (items || []).map(i => i.label);

    await test('completion: < offers every indexed component name', quiet(async () => {
        const { items } = await complete('<Define:Edit>\n    <|\n</Define:Edit>\n');
        assert.deepStrictEqual(labels(items).filter(l => l !== 'Edit'), ['Page', 'User_Card', '_Badge']);
        const card = items.find(i => i.label === 'User_Card');
        assert.strictEqual(card.kind, 6, 'kind is Class');
        assert.strictEqual(card.detail, 'src/user_card.jqhtml');
    }));

    await test('completion: a partial name is replaced, not appended to', quiet(async () => {
        const { items, position } = await complete('<Define:Edit>\n    <Us|\n</Define:Edit>\n');
        const card = items.find(i => i.label === 'User_Card');
        assert.ok(card, 'User_Card offered');
        assert.strictEqual(card.range.start.character, position.character - 2);
        assert.strictEqual(card.range.end.character, position.character);
    }));

    await test('completion: </ offers component names for a closing tag', quiet(async () => {
        const { items } = await complete('<Define:Edit>\n    <User_Card></|\n</Define:Edit>\n');
        assert.ok(labels(items).includes('User_Card'));
    }));

    await test('completion: extends="..." offers component names', quiet(async () => {
        const { items, position } = await complete('<Define:Edit extends="Pa|">\n</Define:Edit>\n');
        assert.ok(labels(items).includes('Page'));
        assert.strictEqual(items[0].range.start.character, position.character - 2);
    }));

    await test('completion: < inside <% %> offers nothing', quiet(async () => {
        const { items } = await complete('<Define:Edit>\n    <% if (a <| b) { %><% } %>\n</Define:Edit>\n');
        assert.strictEqual(items, undefined);
    }));

    await test('completion: <Define: does not offer existing component names', quiet(async () => {
        const { items } = await complete('<Define:|\n');
        assert.strictEqual(items, undefined);
    }));

    await test('completion: $ in a component tag offers Define defaults, template and class args', quiet(async () => {
        const { items } = await complete('<Define:Edit>\n    <User_Card $|\n</Define:Edit>\n');
        const by = {};
        (items || []).forEach(i => { by[i.label] = i; });
        assert.deepStrictEqual(Object.keys(by).sort(), [
            '$avatar_url', '$compact', '$on_select', '$per_page', '$show_avatar', '$title',
        ]);
        assert.strictEqual(by.$title.detail, 'default: "Untitled"');
        assert.strictEqual(by.$per_page.detail, 'default: 25');
        assert.strictEqual(by.$compact.detail, 'default (flag)');
        assert.strictEqual(by.$show_avatar.detail, 'read in the template');
        assert.strictEqual(by.$on_select.detail, 'read in class User_Card');
        assert.strictEqual(by.$title.insertText, '$title=');
        assert.ok(by.$title.sortText < by.$show_avatar.sortText, 'defaults sort before template reads');
        assert.ok(by.$show_avatar.sortText < by.$on_select.sortText, 'template reads sort before class reads');
        assert.ok(!by.$not_mine, 'another class is not read');
    }));

    await test('completion: the $ and partial arg name are replaced', quiet(async () => {
        const { items, position } = await complete('<Define:Edit>\n    <User_Card $ti|\n</Define:Edit>\n');
        const title = items.find(i => i.label === '$title');
        assert.strictEqual(title.range.start.character, position.character - 3);
    }));

    await test('completion: args already written on the tag are not offered again', quiet(async () => {
        const { items } = await complete('<Define:Edit>\n    <User_Card\n        $title="a" $compact\n        $|\n</Define:Edit>\n');
        const l = labels(items);
        assert.ok(!l.includes('$title') && !l.includes('$compact'), l.join(','));
        assert.ok(l.includes('$per_page'));
    }));

    await test('completion: no args inside a quoted value or an unquoted value', quiet(async () => {
        const quoted = await complete('<Define:Edit>\n    <User_Card $title="a $|"\n</Define:Edit>\n');
        assert.strictEqual(quoted.items, undefined);
        const unquoted = await complete('<Define:Edit>\n    <User_Card $title=a|\n</Define:Edit>\n');
        assert.strictEqual(unquoted.items, undefined);
    }));

    await test('completion: no args in an html tag', quiet(async () => {
        const { items } = await complete('<Define:Edit>\n    <div $|\n</Define:Edit>\n');
        assert.strictEqual(items, undefined);
    }));

    await test('completion: args after a <% %> attribute value still complete', quiet(async () => {
        const { items } = await complete('<Define:Edit>\n    <User_Card title="<%= x > 1 %>" $|\n</Define:Edit>\n');
        assert.ok(labels(items).includes('$per_page'));
    }));

    await test('completion: a %> in a // comment does not end the <% %> block', quiet(async () => {
        const open = await complete('<Define:Edit>\n    <User_Card <% if (a) { %>x="1"<% } // end %> $|\n</Define:Edit>\n');
        assert.strictEqual(open.items, undefined);
        const closed = await complete('<Define:Edit>\n    <User_Card <% if (a) { %>x="1"<% } // end\n    %> $|\n</Define:Edit>\n');
        assert.ok(labels(closed.items).includes('$per_page'));
    }));

    await test('completion: a language-server class location is used without a file scan', quiet(async () => {
        const symbol = {
            name: 'User_Card', kind: 4,
            location: { uri: create_stub().uri('src/user_card.js') },
        };
        const { items, stub } = await complete('<Define:Edit>\n    <User_Card $|\n</Define:Edit>\n', { symbols: [symbol] });
        assert.ok(labels(items).includes('$on_select'));
        assert.ok(!stub.calls.findFiles.some(c => c.pattern === '**/*.js'), 'no **/*.js scan');
    }));
}

// ---------------------------------------------------------------------------
// diagnostics
// ---------------------------------------------------------------------------

async function diagnostics_tests() {
    console.log('\ndiagnostics:');
    const fs = require('fs');
    const path = require('path');

    const stub = create_stub({ files: {} });
    const { compile_diagnostics } = load_with_stub(stub, 'diagnostics.js');
    const diag = (text) => compile_diagnostics(text, 'edit.jqhtml');
    const span = (d) => [d.range.start.line, d.range.start.character, d.range.end.line, d.range.end.character];

    await test('diagnostics: the parser is bundled at out/vendor and required from there', () => {
        const vendor = path.join(__dirname, '..', 'out', 'vendor', 'jqhtml-parser.js');
        assert.ok(fs.existsSync(vendor), 'out/vendor/jqhtml-parser.js exists');
        const compiled = fs.readFileSync(path.join(__dirname, '..', 'out', 'diagnostics.js'), 'utf8');
        assert.ok(compiled.includes('require("./vendor/jqhtml-parser")'), 'diagnostics.js requires ./vendor/jqhtml-parser');
        assert.ok(!/require\(["']@jqhtml\/parser["']\)/.test(fs.readFileSync(vendor, 'utf8')), 'bundle is self-contained');
        assert.ok(!/require\(["']source-map["']\)/.test(fs.readFileSync(vendor, 'utf8')), 'source-map is inlined');
    });

    await test('diagnostics: a template that compiles has none', () => {
        assert.deepStrictEqual(diag('<Define:A $x="1">\n  <b><%= this.args.x %></b>\n</Define:A>\n'), []);
    });

    await test('diagnostics: a mismatched closing tag is an error on that tag', () => {
        const d = diag('<Define:A>\n  <div>a</span></div>\n</Define:A>\n');
        assert.strictEqual(d.length, 1);
        assert.strictEqual(d[0].severity, 0, 'Error');
        assert.strictEqual(d[0].source, 'jqhtml');
        assert.ok(d[0].message.startsWith('Closing </span> does not match open <div>'), d[0].message);
        assert.ok(!/\nat edit\.jqhtml:/.test(d[0].message), 'location line and code snippet are left out');
        assert.ok(!d[0].message.includes('^^^'), 'no caret snippet');
        assert.deepStrictEqual(span(d[0]), [1, 8, 1, 15]);
    });

    await test('diagnostics: a lone closing tag is an error', () => {
        const d = diag('<Define:A>\n  </p>\n</Define:A>\n');
        assert.ok(d[0].message.startsWith('Closing </p> has no matching open tag'), d[0].message);
        assert.deepStrictEqual(span(d[0]), [1, 2, 1, 6]);
    });

    await test('diagnostics: a stray %> is an error', () => {
        const d = diag('<Define:A>\n  <div>x</div> %>\n</Define:A>\n');
        assert.ok(d[0].message.startsWith('Stray %> with no matching <%'), d[0].message);
        assert.deepStrictEqual(span(d[0]), [1, 15, 1, 17]);
    });

    await test('diagnostics: invalid JS in a slot-only template is an error at its column', () => {
        // `a + ` ends where the %> is, so that is where the parse fails
        const d = diag('<Define:A>\n<Slot:x><%= a + %></Slot:x>\n</Define:A>\n');
        assert.strictEqual(d.length, 1);
        assert.ok(d[0].message.includes('JavaScript syntax error in component "A"'), d[0].message);
        assert.deepStrictEqual(span(d[0]), [1, 16, 1, 18]);
    });

    await test('diagnostics: an unclosed tag carries the parser suggestion', () => {
        const d = diag('<Define:A>\n  <b>\n</Define:A>\n');
        assert.ok(d[0].message.startsWith('Unclosed tag: b'), d[0].message);
        assert.ok(d[0].message.includes('Missing closing tag'), 'suggestion included');
        assert.deepStrictEqual(span(d[0]), [1, 2, 1, 5]);
    });

    await test('diagnostics: a %> hidden in a // comment is named in the message', () => {
        const d = diag('<Define:A>\n  <% let x = 1; // note %> <b>hi</b>\n</Define:A>\n');
        assert.strictEqual(d.length, 1);
        assert.ok(d[0].message.includes('The %> on line 2, column 25 is inside a // comment (line 2, column 17)'), d[0].message);
    });

    await test('diagnostics: a file without <Define:> is an error at the top', () => {
        const d = diag('<div></div>\n');
        assert.ok(d[0].message.includes('exactly one top-level <Define:ComponentName>'), d[0].message);
        assert.strictEqual(d[0].range.start.line, 0);
    });

    const BAD = '<Define:A>\n  </p>\n</Define:A>\n';
    const GOOD = '<Define:A>\n  <p></p>\n</Define:A>\n';
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    function live(config) {
        const s = create_stub({ files: { 'a.jqhtml': BAD, 'b.jqhtml': GOOD, 'c.js': 'x </p>' }, config });
        const { JqhtmlDiagnostics } = load_with_stub(s, 'diagnostics.js');
        return { s, JqhtmlDiagnostics, uri: (rel) => s.uri(rel) };
    }

    await test('diagnostics: documents already open at activation are validated', quiet(async () => {
        const { s, JqhtmlDiagnostics, uri } = live();
        s.vscode.workspace.textDocuments.push(s.documents.get('/ws/a.jqhtml'), s.documents.get('/ws/c.js'));
        const d = new JqhtmlDiagnostics(20);
        const collection = s.calls.diagnosticCollections[0];
        assert.strictEqual(collection.get(uri('a.jqhtml')).length, 1);
        assert.strictEqual(collection.has(uri('c.js')), false, 'non-jqhtml documents are ignored');
        d.dispose();
    }));

    await test('diagnostics: opening a document validates it at once', quiet(async () => {
        const { s, JqhtmlDiagnostics, uri } = live();
        const d = new JqhtmlDiagnostics(20);
        s.open_document('a.jqhtml');
        s.open_document('b.jqhtml');
        const collection = s.calls.diagnosticCollections[0];
        assert.strictEqual(collection.get(uri('a.jqhtml')).length, 1);
        assert.deepStrictEqual(collection.get(uri('b.jqhtml')), []);
        d.dispose();
    }));

    await test('diagnostics: edits are debounced - one validation after the burst', quiet(async () => {
        const { s, JqhtmlDiagnostics, uri } = live();
        const d = new JqhtmlDiagnostics(40);
        s.open_document('b.jqhtml');
        const collection = s.calls.diagnosticCollections[0];
        let sets = 0;
        const real_set = collection.set.bind(collection);
        collection.set = (u, v) => { sets++; real_set(u, v); };

        s.edit_document('b.jqhtml', BAD);
        await sleep(10);
        s.edit_document('b.jqhtml', BAD + ' ');
        await sleep(10);
        assert.deepStrictEqual(collection.get(uri('b.jqhtml')), [], 'not re-validated mid-burst');
        assert.strictEqual(sets, 0);
        await sleep(80);
        assert.strictEqual(sets, 1, 'validated once');
        assert.strictEqual(collection.get(uri('b.jqhtml')).length, 1);

        s.edit_document('b.jqhtml', GOOD);
        await sleep(80);
        assert.deepStrictEqual(collection.get(uri('b.jqhtml')), [], 'fixed file clears');
        d.dispose();
    }));

    await test('diagnostics: closing a document clears it and cancels a pending validation', quiet(async () => {
        const { s, JqhtmlDiagnostics, uri } = live();
        const d = new JqhtmlDiagnostics(30);
        s.open_document('a.jqhtml');
        const collection = s.calls.diagnosticCollections[0];
        assert.strictEqual(collection.get(uri('a.jqhtml')).length, 1);
        s.edit_document('a.jqhtml', BAD + ' ');
        s.close_document('a.jqhtml');
        assert.strictEqual(collection.has(uri('a.jqhtml')), false, 'cleared on close');
        await sleep(60);
        assert.strictEqual(collection.has(uri('a.jqhtml')), false, 'pending validation did not repopulate it');
        d.dispose();
    }));

    await test('diagnostics: jqhtml.validate false reports nothing', quiet(async () => {
        const { s, JqhtmlDiagnostics, uri } = live({ 'jqhtml.validate': false });
        const d = new JqhtmlDiagnostics(20);
        s.open_document('a.jqhtml');
        assert.strictEqual(s.calls.diagnosticCollections[0].has(uri('a.jqhtml')), false);
        d.dispose();
    }));

    await test('diagnostics: dispose disposes the collection', quiet(async () => {
        const { s, JqhtmlDiagnostics } = live();
        const d = new JqhtmlDiagnostics(20);
        d.dispose();
        assert.strictEqual(s.calls.diagnosticCollections[0].disposed, true);
    }));
}

// ---------------------------------------------------------------------------

async function main() {
    console.log('provider unit tests (vscode stubbed):');
    await component_name_tests();
    await component_index_tests();
    await duplicate_tests();
    await log_tests();
    await definition_tests();
    await definition_search_tests();
    await auto_close_tests();
    await hover_tests();
    await blade_provider_tests();
    await blade_spacer_tests();
    await completion_tests();
    await diagnostics_tests();

    console.log('');
    if (failed === 0) {
        console.log(`all ${passed} passed`);
        process.exit(0);
    }
    console.log(`${failed} failed, ${passed} passed`);
    console.log('failing: ' + failures.join(', '));
    process.exit(1);
}

main().catch(err => { console.error(err); process.exit(2); });
