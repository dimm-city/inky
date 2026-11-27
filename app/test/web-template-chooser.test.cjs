const { it: test, afterEach } = require('mocha');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { JSDOM } = require('jsdom');

const fixtures = [];
afterEach(() => {
    for( const { window, root } of fixtures.splice(0) ) {
        window.close(); fs.rmSync(root, { recursive: true, force: true });
    }
});
function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inky-chooser-test-'));
    const renderer = path.join(__dirname, '../renderer');
    const { window } = new JSDOM(fs.readFileSync(path.join(renderer, 'index.html'), 'utf8'), { runScripts: 'outside-only' });
    fixtures.push({ window, root });
    const dialog = window.document.querySelector('dialog'), list = dialog.querySelector('select');
    // jsdom has no native dialog implementation; real focus/Escape is checked in Electron.
    dialog.showModal = () => { dialog.open = true; };
    dialog.close = () => { dialog.open = false; };
    const listeners = {}, selections = [];
    const realRequire = createRequire(path.join(renderer, 'webTemplateChooser.js'));
    const boundary = { picker: { canceled: true }, failure: null };
    const ipcRenderer = {
        on: (name, callback) => { listeners[name] = callback; },
        async invoke(name, value) {
            if( name === 'showOpenDialog' ) return boundary.picker;
            assert.equal(name, 'select-web-template');
            if( boundary.failure ) throw new Error(boundary.failure);
            selections.push(value);
        }
    };
    window.Function('require', fs.readFileSync(path.join(renderer, 'webTemplateChooser.js'), 'utf8'))(name => {
        if( name === 'electron' ) return { ipcRenderer, shell: { openPath: async () => '' } };
        if( name === './i18n.js' ) return { _: text => text };
        return realRequire(name);
    });
    const library = path.join(root, 'library');
    return {
        root, library, dialog, list, boundary, selections,
        open: selected => listeners['choose-web-template'](null, { library, selected }),
        template(name) {
            const directory = path.join(root, name); fs.mkdirSync(directory);
            fs.writeFileSync(path.join(directory, 'index.html'), '<title>Player</title>');
            return directory;
        },
        async click(action) {
            dialog.querySelector(`[data-action=${action}]`).click();
            while( dialog.querySelector('fieldset').disabled ) await new Promise(resolve => setTimeout(resolve, 1));
        },
        async apply() {
            dialog.querySelector('form').dispatchEvent(new window.Event('submit', { cancelable: true }));
            while( dialog.querySelector('fieldset').disabled ) await new Promise(resolve => setTimeout(resolve, 1));
        }
    };
}

test('chooser applies only on Use template; cancel and native picker cancellation preserve the project', async function() {
    const ui = fixture(), selected = ui.template('Current');
    ui.open(selected);
    assert.equal(ui.list.value, selected);
    ui.list.value = '';
    await ui.click('cancel');
    assert.deepEqual(ui.selections, []);
    ui.open(selected);
    await ui.click('external');
    assert.equal(ui.list.value, selected);
    ui.list.value = '';
    await ui.apply();
    assert.deepEqual(ui.selections, [null]);
    assert.equal(ui.dialog.open, false);
});

test('import adds a complete library copy without applying it; failures keep the dialog usable', async function() {
    const ui = fixture(), source = ui.template('My player');
    ui.open(null); ui.boundary.picker = { canceled: false, filePaths: [source] };
    await ui.click('import');
    assert.equal(ui.list.value, path.join(ui.library, 'My player'));
    assert.equal(fs.readFileSync(path.join(ui.list.value, 'index.html'), 'utf8'), '<title>Player</title>');
    assert.deepEqual(ui.selections, []);
    await ui.click('cancel'); ui.open(null);
    assert.equal(ui.list.options.length, 2, 'The imported template remains available after Cancel');
    ui.boundary.picker.filePaths = [ui.root];
    await ui.click('external');
    assert.match(ui.dialog.querySelector('[role=alert]').textContent, /index.html/);
    assert.equal(ui.list.value, '');
    ui.boundary.failure = 'Could not save this choice';
    await ui.apply();
    assert.equal(ui.dialog.open, true);
    assert.match(ui.dialog.querySelector('[role=alert]').textContent, /Could not save/);
    assert.equal(ui.dialog.querySelector('fieldset').disabled, false);
});

test('missing selections can be relocated even when the library is unreadable', async function() {
    const ui = fixture(), external = ui.template('External');
    fs.writeFileSync(ui.library, 'not a directory');
    ui.open(path.join(ui.root, 'missing'));
    assert.equal(ui.dialog.querySelector('[type=submit]').disabled, true);
    assert.match(ui.dialog.querySelector('#web-template-location').textContent, /unavailable/);
    ui.boundary.picker = { canceled: false, filePaths: [external] };
    await ui.click('external');
    assert.equal(ui.list.value, external);
    assert.equal(ui.dialog.querySelector('[type=submit]').disabled, false);
    await ui.apply();
    assert.deepEqual(ui.selections, [external]);
});
