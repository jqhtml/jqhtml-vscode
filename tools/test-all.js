#!/usr/bin/env node
/**
 * The extension's test entry point - `npm test` runs this.
 *
 * Three tiers, cheapest first:
 *
 *   1. unit     tools/test-formatter.js + tools/test-providers.js
 *               The formatter against its fixtures, and every provider loaded
 *               with `vscode` replaced by tools/vscode-stub.js. Sub-second.
 *   2. grammar  tools/test-grammar.js
 *               The real TextMate engine over syntaxes/*.tmLanguage.json,
 *               snapshotted token by token. A couple of seconds.
 *   3. host     tools/test-extension-host/run.js
 *               A real VS Code extension host. Proves the extension activates
 *               and that VS Code's command layer reaches the providers; nothing
 *               below this tier can see that. ~40s, plus a one-off ~1 GB
 *               VS Code download.
 *
 * Tier 3 is skipped when JQHTML_FAST=1 (root ./run-all-suites.sh --fast sets it).
 * It still has to run before a release: it is the only tier that runs the real
 * editor, so a suite that never runs it has never tested the extension.
 *
 *   node tools/test-all.js              all three tiers
 *   node tools/test-all.js --fast       tiers 1 and 2 only (same as JQHTML_FAST=1)
 */
'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const HERE = __dirname;
const EXT_DIR = path.join(HERE, '..');
const fast = process.env.JQHTML_FAST === '1' || process.argv.includes('--fast');

const ESC = String.fromCharCode(27) + '[';
const BOLD = ESC + '1m', RED = ESC + '31m', GREEN = ESC + '32m',
    YELLOW = ESC + '33m', GRAY = ESC + '90m', OFF = ESC + '0m';

const tiers = [
    {
        name: 'tier 1: unit (vscode stubbed)',
        steps: [
            ['formatter fixtures', path.join(HERE, 'test-formatter.js')],
            ['provider unit tests', path.join(HERE, 'test-providers.js')],
        ],
    },
    {
        name: 'tier 2: grammar tokenisation',
        steps: [
            ['textmate snapshots', path.join(HERE, 'test-grammar.js')],
        ],
    },
    {
        name: 'tier 3: real extension host',
        fast_skip: 'JQHTML_FAST=1 - the real VS Code host is the slow tier',
        steps: [
            ['vscode extension host', path.join(HERE, 'test-extension-host', 'run.js')],
        ],
    },
];

const summary = [];
let failed_tiers = 0;

for (const tier of tiers) {
    console.log('');
    console.log(BOLD + '=== ' + tier.name + ' ===' + OFF);

    if (fast && tier.fast_skip) {
        console.log(YELLOW + '  SKIPPED: ' + tier.fast_skip + OFF);
        console.log(YELLOW + '  Run without --fast (or unset JQHTML_FAST) before committing or releasing.' + OFF);
        summary.push({ name: tier.name, state: 'SKIP', seconds: 0 });
        continue;
    }

    const started = Date.now();
    let tier_failed = false;

    for (const [label, script] of tier.steps) {
        console.log(GRAY + '$ node ' + path.relative(EXT_DIR, script) + OFF);
        const result = spawnSync(process.execPath, [script], { stdio: 'inherit', cwd: EXT_DIR });
        if (result.status !== 0) {
            tier_failed = true;
            const how = result.status === null ? 'signal ' + result.signal : 'exit ' + result.status;
            console.log(RED + '  ' + label + ': ' + how + OFF);
        }
    }

    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    if (tier_failed) { failed_tiers++; }
    console.log(tier_failed
        ? RED + '--- ' + tier.name + ': FAIL (' + seconds + 's)' + OFF
        : GREEN + '--- ' + tier.name + ': PASS (' + seconds + 's)' + OFF);
    summary.push({ name: tier.name, state: tier_failed ? 'FAIL' : 'PASS', seconds });
}

console.log('');
console.log('============================================================');
console.log(BOLD + 'vscode extension: tier summary' + OFF);
console.log('');
for (const row of summary) {
    const colour = row.state === 'PASS' ? GREEN : (row.state === 'FAIL' ? RED : YELLOW);
    console.log('  ' + colour + row.state.padEnd(6) + OFF + ' ' + row.name.padEnd(34) +
        ' ' + (row.state === 'SKIP' ? '' : row.seconds + 's'));
}
console.log('');

if (failed_tiers === 0) {
    console.log(GREEN + BOLD + 'All extension tiers passed.' + OFF);
    process.exit(0);
}
console.log(RED + BOLD + failed_tiers + ' extension tier(s) failed.' + OFF);
process.exit(1);
