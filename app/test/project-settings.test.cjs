const { it: test, afterEach } = require('mocha');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const Settings = require('../projectSettings.js');

const roots = [];
afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inky-settings-test-'));
    roots.push(root);
    return { root, main: path.join(root, 'night-shift.ink'), file: path.join(root, 'night-shift.settings.json') };
}

test('web preferences preserve authored settings and portable project paths', function() {
    const { root, main, file } = fixture();
    const existing = { customInkSnippets: [{ name: 'Example', ink: 'Text' }], instructionPrefix: '>>>', extra: 42, webExport: { authorOption: true } };
    fs.writeFileSync(file, JSON.stringify(existing));
    const value = { template: path.join(root, 'template'), directory: path.join(root, 'web'), script: 'story.js' };
    Settings.writeWebExport(main, value);
    const saved = Settings.read(main);
    assert.deepEqual(saved, { ...existing, webExport: { authorOption: true, template: 'template', directory: 'web', script: 'story.js' } });
    assert.deepEqual(Settings.webExport(saved, main), value);
    const previousDirectory = process.cwd();
    fs.mkdirSync(path.join(root, 'nested'));
    try {
        process.chdir(path.join(root, 'nested'));
        Settings.writeWebExport(main, { template: null });
        assert.equal(Settings.read(main).webExport.directory, 'web');
    } finally { process.chdir(previousDirectory); }
    fs.rmdirSync(path.join(root, 'nested'));
    assert.deepEqual(fs.readdirSync(root), ['night-shift.settings.json']);
    const moved = path.join(root, 'moved/night-shift.ink');
    assert.equal(Settings.webExport(saved, moved).directory, path.join(root, 'moved/web'));
});

test('external template paths stay absolute and Classic can be explicitly selected', function() {
    const { root, main } = fixture();
    const external = path.join(path.dirname(root), 'external-template');
    Settings.writeWebExport(main, { template: external });
    assert.equal(Settings.read(main).webExport.template, external);
    Settings.writeWebExport(main, { template: null });
    assert.equal(Settings.webExport(Settings.read(main), main).template, null);
});

test('malformed or non-object settings are never overwritten', function() {
    const { main, file } = fixture();
    for (const content of ['{not JSON', '[]', 'null', '42']) {
        fs.writeFileSync(file, content);
        assert.throws(() => Settings.writeWebExport(main, { template: null }));
        assert.equal(fs.readFileSync(file, 'utf8'), content);
    }
});

test('read-only and symlinked settings preserve the existing bytes', function() {
    const { root, main, file } = fixture();
    fs.writeFileSync(file, '{"extra":42}');
    fs.chmodSync(file, 0o444);
    try {
        // Windows reports EPERM; POSIX reports EACCES for the same read-only file.
        assert.throws(() => Settings.writeWebExport(main, { template: null }), error => ['EACCES', 'EPERM'].includes(error.code));
        assert.equal(fs.readFileSync(file, 'utf8'), '{"extra":42}');
    } finally { fs.chmodSync(file, 0o644); }
    fs.unlinkSync(file);
    const outside = path.join(root, 'outside.json');
    fs.writeFileSync(outside, '{"extra":42}');
    try { fs.symlinkSync(outside, file); }
    catch (error) { if (error.code === 'EPERM') { this.skip('Symlinks require permission on this host.'); return; } throw error; }
    assert.throws(() => Settings.writeWebExport(main, { template: null }), /regular file/);
    assert.equal(fs.readFileSync(outside, 'utf8'), '{"extra":42}');
});

test('missing settings reset preferences and invalid web targets are rejected', function() {
    const { main, file } = fixture();
    assert.deepEqual(Settings.read(main), {});
    assert.deepEqual(Settings.webExport({}, main), {});
    for (const webExport of [null, [], { template: 123 }, { directory: '' }, { script: '../story.js' }, { script: 'index.html' }]) {
        assert.throws(() => Settings.webExport({ webExport }, main));
    }
    assert.throws(() => Settings.writeWebExport(main, { script: '../story.js' }));
    assert.equal(fs.existsSync(file), false);
});
