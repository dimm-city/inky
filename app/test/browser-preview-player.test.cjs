const { it: test, afterEach } = require('mocha');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { Compiler } = require('inkjs/full');
const runtime = require('inkjs');

const original = `VAR coins = 0
-> gate
=== gate ===
A lantern glows.
* [Enter the shop]
    ~ coins = 7
    -> shop
=== shop ===
The lamp is blue. Coins: {coins}.
* [Check balance]
    ~ coins += 1
    -> shop
* [Leave]
    Goodbye.
    -> END
`;
const compile = source => JSON.parse(new Compiler(source).Compile().ToJson());
const windows = [];
afterEach(() => { for (const window of windows.splice(0)) window.close(); });
function player(preview = true) {
    const html = fs.readFileSync(path.join(__dirname, '../../templates/classic/index.html'), 'utf8');
    const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://127.0.0.1/fixture/' });
    windows.push(dom.window);
    const window = dom.window;
    window.matchMedia = () => ({ matches: false }); // Read immediately with reduced motion.
    window.inkjs = runtime;
    window.storyContent = compile(original);
    let update;
    if( preview ) window.inkyPreview = { accept(callback) { update = callback; } };
    window.eval(fs.readFileSync(path.join(__dirname, '../../templates/classic/main.js'), 'utf8'));
    const text = () => window.document.querySelector('#story').textContent;
    const choices = () => [...window.document.querySelectorAll('.choice a')];
    return { window, text, choices, update: source => update(compile(source)) };
}

test('Classic still plays normally when no preview client is present', function() {
    const game = player(false);
    game.choices()[0].click();
    assert.match(game.text(), /The lamp is blue. Coins: 7/);
    assert.equal(game.window.inkyPreview, undefined);
});

test('Classic hot updates regenerate prose and choices while preserving variables and consumed choices', async function() {
    const game = player();
    game.choices()[0].click();
    const updated = original.replace('lamp is blue', 'lamp is green').replace('[Check balance]', '[Count coins]');
    await game.update(updated);
    assert.match(game.text(), /The lamp is green. Coins: 7/);
    assert.equal(game.choices()[0].textContent, 'Count coins');
    assert.doesNotMatch(game.text(), /The lamp is blue/);
    game.choices()[0].click();
    assert.match(game.text(), /The lamp is green. Coins: 8/);
    await game.update(updated.replace('lamp is green', 'lamp is gold'));
    assert.match(game.text(), /The lamp is gold. Coins: 8/);
    assert.deepEqual(game.choices().map(choice => choice.textContent), ['Leave']);
    assert.equal(game.window.localStorage.getItem('save-state'), null);
});

test('an incompatible update keeps the existing game and its working controls', async function() {
    const game = player();
    game.choices()[0].click();
    game.choices()[0].click(); // Checkpoint now points inside the knot being renamed.
    const before = game.text();
    await assert.rejects(game.update(original.replaceAll('shop', 'hall')), /Failed to find content/);
    assert.equal(game.text(), before);
    assert.match(game.text(), /Coins: 8/);
    game.choices()[0].click();
    assert.match(game.text(), /Goodbye/);
});
