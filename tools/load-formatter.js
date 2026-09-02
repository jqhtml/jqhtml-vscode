'use strict';
/**
 * Load out/formatter.js outside VS Code by stubbing the 'vscode' module.
 * Shared by the CLI and the test runner.
 */
const Module = require('module');
const fs = require('fs');
const path = require('path');

const vscode_stub = {
    Position: class { constructor(line, character) { this.line = line; this.character = character; } },
    Range: class { constructor(start, end) { this.start = start; this.end = end; } },
    TextEdit: { replace: (range, newText) => ({ range, newText }) },
    window: { showWarningMessage: () => undefined },
    languages: {},
    workspace: {},
};

function load_formatter() {
    const formatter_path = path.join(__dirname, '..', 'out', 'formatter.js');
    if (!fs.existsSync(formatter_path)) {
        console.error(`formatter not compiled: ${formatter_path}\nRun ./build.sh --no-package (or npm run compile) first.`);
        process.exit(2);
    }
    const original_load = Module._load;
    Module._load = function (request) {
        if (request === 'vscode') return vscode_stub;
        return original_load.apply(this, arguments);
    };
    try {
        return require(formatter_path);
    } finally {
        Module._load = original_load;
    }
}

module.exports = { load_formatter, vscode_stub };
