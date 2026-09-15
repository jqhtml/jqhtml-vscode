import * as vscode from 'vscode';

/**
 * JQHTML output channel.
 *
 * Everything the extension has to say goes here rather than to the developer
 * console: `info` is always appended, `debug` only when the `jqhtml.debug`
 * setting is on, and `error` is appended *and* still reaches console.error.
 *
 * The channel is created lazily so providers loaded outside activate() (tests,
 * other extensions consuming the API) work without any setup.
 */

let channel: vscode.OutputChannel | undefined;
let debug_cached: boolean | undefined;

function get_channel(): vscode.OutputChannel | undefined {
    if (!channel) {
        try {
            channel = vscode.window.createOutputChannel('JQHTML');
        } catch {
            return undefined;
        }
    }
    return channel;
}

function debug_enabled(): boolean {
    if (debug_cached === undefined) {
        try {
            debug_cached = vscode.workspace.getConfiguration('jqhtml').get<boolean>('debug', false);
        } catch {
            debug_cached = false;
        }
    }
    return debug_cached;
}

function append(text: string): void {
    const c = get_channel();
    if (c) {
        c.appendLine(text);
    }
}

export const log = {
    /** Always recorded in the channel. */
    info(message: string): void {
        append(message);
    },

    /** Recorded only when `jqhtml.debug` is true. */
    debug(message: string): void {
        if (debug_enabled()) {
            append(message);
        }
    },

    /** Genuine errors: channel plus console. */
    error(message: string, error?: unknown): void {
        append(error === undefined ? message : `${message} ${error instanceof Error ? error.stack || error.message : String(error)}`);
        if (error === undefined) {
            console.error(message);
        } else {
            console.error(message, error);
        }
    },

    /** Reveal the channel (used by the output-channel command, if any). */
    show(): void {
        const c = get_channel();
        if (c) {
            c.show(true);
        }
    },

    /** Called from activate(): create the channel and track the debug setting. */
    activate(context: vscode.ExtensionContext): void {
        debug_cached = undefined;
        const c = get_channel();
        if (c) {
            context.subscriptions.push(c);
        }
        context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration(event => {
                if (event.affectsConfiguration('jqhtml.debug')) {
                    debug_cached = undefined;
                }
            })
        );
    },

    /** Test seam: forget the channel and the cached setting. */
    reset(): void {
        channel = undefined;
        debug_cached = undefined;
    },
};
