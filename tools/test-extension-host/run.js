#!/usr/bin/env node
/**
 * Tier 3 launcher: downloads VS Code (once) and runs suite/index.js inside a
 * real extension host.
 *
 *   node tools/test-extension-host/run.js
 *
 * Environment:
 *   JQHTML_VSCODE_HOST_OPTIONAL=1   exit 0 (SKIPPED) instead of 1 when VS Code
 *                                   cannot be downloaded or launched. Intended
 *                                   for offline CI; never set it locally, or a
 *                                   broken tier 3 looks like a passing one.
 *   JQHTML_VSCODE_VERSION           override the pinned VS Code version.
 *   JQHTML_VSCODE_CACHE             override where VS Code is downloaded to.
 *
 * This is the slow tier: roughly 1 GB of download on the first run and ~30
 * seconds per run after that. The download is cached OUTSIDE the repo, in
 * ~/.cache/jqhtml-vscode-test, so it survives a re-clone and, in the dev
 * container, a rebuild (/root is persisted there).
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

// Pinned so a VS Code release cannot silently change what tier 3 tests. This is
// the version 'stable' resolved to on 2026-09-15; bump it deliberately, and
// re-run the suite when you do.
const VSCODE_VERSION = process.env.JQHTML_VSCODE_VERSION || '1.137.0';

const EXT_DIR = path.resolve(__dirname, '..', '..');
const CACHE_DIR = process.env.JQHTML_VSCODE_CACHE ||
    path.join(process.env.HOME || require('os').homedir(), '.cache', 'jqhtml-vscode-test');
const SUITE = path.join(__dirname, 'suite', 'index.js');
const WORKSPACE = path.join(__dirname, 'workspace');

/**
 * VS Code is an Electron app and needs a display. Re-exec under xvfb-run when
 * there is none, rather than failing with an opaque Electron crash.
 */
function ensure_display() {
    if (process.env.DISPLAY || process.env.JQHTML_VSCODE_NO_XVFB) { return true; }
    if (!fs.existsSync('/usr/bin/xvfb-run')) { return false; }

    const result = spawnSync('/usr/bin/xvfb-run',
        ['-a', '--server-args=-screen 0 1280x1024x24', process.execPath, __filename],
        { stdio: 'inherit', env: Object.assign({}, process.env, { JQHTML_VSCODE_NO_XVFB: '1' }) });
    process.exit(result.status === null ? 1 : result.status);
}

function skip_or_fail(reason) {
    console.log(`  SKIPPED extension host tests: ${reason}`);
    if (process.env.JQHTML_VSCODE_HOST_OPTIONAL === '1') {
        console.log('  (JQHTML_VSCODE_HOST_OPTIONAL=1, so this is not a failure)');
        process.exit(0);
    }
    console.log('  Set JQHTML_VSCODE_HOST_OPTIONAL=1 to make this tier optional.');
    console.log('  To run it you need: outbound HTTPS to update.code.visualstudio.com,');
    console.log(`  ~1 GB of disk under ${CACHE_DIR} (JQHTML_VSCODE_CACHE overrides), and either`);
    console.log('  a DISPLAY or /usr/bin/xvfb-run.');
    process.exit(1);
}

async function main() {
    if (!ensure_display()) {
        skip_or_fail('no DISPLAY and no /usr/bin/xvfb-run - VS Code needs a display server');
    }

    if (!fs.existsSync(path.join(EXT_DIR, 'out', 'extension.js'))) {
        skip_or_fail('out/extension.js is missing - run ./build.sh --dev first');
    }

    let runTests, TestRunFailedError;
    try {
        ({ runTests, TestRunFailedError } = require('@vscode/test-electron'));
    } catch (err) {
        skip_or_fail(`@vscode/test-electron is not installed (${err.message})`);
    }

    console.log(`extension host: VS Code ${VSCODE_VERSION}, cache ${CACHE_DIR}`);

    let exit_code;
    try {
        exit_code = await runTests({
            version: VSCODE_VERSION,
            cachePath: CACHE_DIR,
            extensionDevelopmentPath: EXT_DIR,
            extensionTestsPath: SUITE,
            launchArgs: [
                WORKSPACE,
                '--disable-extensions',
                '--disable-gpu',
                '--no-sandbox',
                '--disable-workspace-trust',
                `--user-data-dir=${path.join(CACHE_DIR, 'user-data')}`,
                `--extensions-dir=${path.join(CACHE_DIR, 'extensions')}`,
            ],
        });
    } catch (err) {
        const message = err && err.message ? err.message : String(err);
        // A failing test inside the host is a test failure, not an infrastructure
        // problem - the suite has already printed which tests failed. (The error
        // class does not set `name`, so identify it by constructor.)
        if (TestRunFailedError && err instanceof TestRunFailedError) {
            process.exit(1);
        }
        // Anything else is VS Code failing to download or launch, not a test
        // result. skip_or_fail still exits 1 unless the run has explicitly opted
        // into tier 3 being optional, so this cannot quietly swallow a breakage.
        skip_or_fail(`could not download or launch VS Code: ${message}`);
    }

    process.exit(exit_code === 0 ? 0 : 1);
}

main().catch(err => { console.error(err); process.exit(1); });
