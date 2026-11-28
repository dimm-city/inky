const { it: test, afterEach } = require('mocha');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const windows = [];
afterEach(() => { for (const window of windows.splice(0)) window.close(); });
async function fixture() {
    const dom = new JSDOM('<!doctype html><body><button id="game-control">Transcript</button></body>', {
        runScripts: 'outside-only', url: 'http://127.0.0.1:1234/story/'
    });
    const window = dom.window; windows.push(window);
    // Let the document's real ready event finish before loading the served client.
    await new Promise(resolve => window.addEventListener('load', resolve));
    const script = window.document.createElement('script');
    script.src = '/story/__inky/client.js';
    script.dataset.revision = '1'; script.dataset.templateRevision = '1';
    Object.defineProperty(window.document, 'currentScript', { value: script });
    let events, timer;
    window.EventSource = class {
        constructor() { events = this; }
        close() { this.closed = true; }
    };
    window.setTimeout = callback => { timer = callback; return 1; };
    window.clearTimeout = () => { timer = null; };
    let revision = 1, content = {};
    window.fetch = async () => ({ ok: true, json: async () => ({ revision, templateRevision: 1, content }) });
    window.eval(fs.readFileSync(path.join(__dirname, '../renderer/browserPreviewClient.js'), 'utf8'));
    window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
    const host = window.document.querySelector('#inky-browser-preview');
    const root = host.shadowRoot;
    const send = data => events.onmessage({ data: JSON.stringify(data) });
    return {
        window, host, root, events, send,
        expire: () => { if (timer) timer(); },
        async update(next) {
            revision++; content = next;
            send({ revision, templateRevision: 1 });
            // Flush the fetch, JSON and template callback promise chain.
            await new Promise(resolve => setImmediate(resolve));
        }
    };
}

test('healthy preview notices show late template readiness, offer no restart, and disappear', async function() {
    const game = await fixture();
    assert.match(game.root.querySelector('[role=status]').textContent, /Updates reload/);
    game.window.inkyPreview.accept(async () => {});
    assert.match(game.root.querySelector('[role=status]').textContent, /Ready/);
    assert.equal(game.root.querySelector('[data-action=restart]').hidden, true);
    game.expire();
    assert.equal(game.host.hidden, true);
    await game.update({ revised: true });
    assert.equal(game.host.hidden, false);
    assert.match(game.root.querySelector('[role=status]').textContent, /Updated/);
    game.root.querySelector('[data-action=hide]').click();
    assert.equal(game.host.hidden, true);
    assert.equal(game.window.document.querySelector('#game-control').disabled, false);
});

test('compile errors remain visible with save-again recovery and no destructive restart', async function() {
    const game = await fixture();
    game.send({ error: 'Missing divert target.' });
    game.expire();
    assert.equal(game.host.hidden, false);
    assert.match(game.root.querySelector('[role=status]').textContent, /Fix the Ink errors and save again.*Missing divert target/);
    assert.equal(game.root.querySelector('[data-action=restart]').hidden, true);
    game.root.querySelector('[data-action=hide]').click();
    assert.equal(game.host.hidden, true);
});

test('incompatible updates expose restart; reconnect preserves the recovery state', async function() {
    const game = await fixture();
    game.window.inkyPreview.accept(async () => { throw new Error('The current knot was removed.'); });
    await game.update({ incompatible: true });
    assert.match(game.root.querySelector('[role=status]').textContent, /current game is unchanged.*from the beginning.*knot was removed/);
    assert.equal(game.root.querySelector('[data-action=restart]').hidden, false);
    game.expire(); assert.equal(game.host.hidden, false);
    game.events.onerror();
    assert.match(game.root.querySelector('[role=status]').textContent, /Waiting for Inky/);
    assert.equal(game.root.querySelector('[data-action=restart]').hidden, true);
    game.events.onopen();
    assert.equal(game.root.querySelector('[data-action=restart]').hidden, false);
    game.window.inkyPreview.accept(async () => {});
    await game.update({ compatible: true });
    assert.equal(game.root.querySelector('[data-action=restart]').hidden, true);
    assert.match(game.root.querySelector('[role=status]').textContent, /Updated/);
    game.send({ stopped: true });
    assert.equal(game.events.closed, true);
    assert.match(game.root.querySelector('[role=status]').textContent, /stopped/);
});
