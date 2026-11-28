const { it: test, afterEach } = require('mocha');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const Settings = require('../projectSettings.js');

const roots = [];
afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inky-window-test-'));
    roots.push(root);
    const file = path.join(__dirname, '../main-process/projectWindow.js');
    const realRequire = createRequire(file), errors = [];
    const electron = {
        app: { getPath: () => root },
        ipcMain: { on() {}, handle() {} },
        dialog: { showErrorBox: (...args) => errors.push(args) }
    };
    const context = {
        module: { exports: {} }, __dirname: path.dirname(file), console, process,
        require(name) {
            if (name === 'electron') return electron;
            if (name === './i18n/i18n.js') return { _: text => text };
            if (name === './inklecate.js') return { Inklecate: {} };
            return realRequire(name);
        }
    };
    context.exports = context.module.exports;
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
    const win = Object.create(context.module.exports.ProjectWindow.prototype);
    win.mainInkAbsPath = path.join(root, 'story.ink');
    win.webExport = {};
    win.settings = {};
    win.browserWindow = { webContents: { send() {} } };
    const template = path.join(root, 'template');
    fs.mkdirSync(template);
    fs.writeFileSync(path.join(template, 'index.html'), '<html></html>');
    return { root, win, errors, template, settings: Settings.filename(win.mainInkAbsPath) };
}

test('a session-only template survives saving the story and can be persisted after recovery', async function() {
    const { win, errors, template, settings } = fixture();
    fs.writeFileSync(settings, '{"webExport":{"template":null},"customInkSnippets":[]}');
    fs.chmodSync(settings, 0o444);
    try { fs.accessSync(settings, fs.constants.W_OK); this.skip(); }
    catch (error) { if (!['EACCES', 'EPERM'].includes(error.code)) throw error; }
    try {
        await win.selectWebTemplate(template);
        assert.equal(errors.length, 1);
        assert.equal(Settings.read(win.mainInkAbsPath).webExport.template, null);
        win.refreshProjectSettings(win.mainInkAbsPath);
        assert.equal(win.webExport.template, template);
        assert.equal(errors.length, 1, 'Saving the story should not repeat the preference warning');
    } finally { fs.chmodSync(settings, 0o644); }
    await win.selectWebTemplate(template);
    assert.equal(Settings.webExport(Settings.read(win.mainInkAbsPath), win.mainInkAbsPath).template, template);
    Settings.writeWebExport(win.mainInkAbsPath, { template: null });
    win.refreshProjectSettings(win.mainInkAbsPath);
    assert.equal(win.webExport.template, null, 'Successful persistence must clear the session override');
});

test('selection keeps the library path when a template folder is a symlink', async function() {
    const { root, win, template } = fixture();
    const alias = path.join(root, 'Library name');
    try { fs.symlinkSync(template, alias, 'junction'); }
    catch (error) { if (error.code === 'EPERM') this.skip(); throw error; }
    await win.selectWebTemplate(alias);
    assert.equal(win.webExport.template, alias);
    assert.equal(Settings.webExport(Settings.read(win.mainInkAbsPath), win.mainInkAbsPath).template, alias);
});

test('choosing an invalid template leaves the selected template and settings untouched', async function() {
    const { root, win, template, settings } = fixture();
    await win.selectWebTemplate(template);
    const original = fs.readFileSync(settings, 'utf8');
    const invalid = path.join(root, 'empty'); fs.mkdirSync(invalid);
    await assert.rejects(win.selectWebTemplate(invalid), /template folder containing index.html/);
    assert.equal(win.webExport.template, template);
    assert.equal(fs.readFileSync(settings, 'utf8'), original);
});
