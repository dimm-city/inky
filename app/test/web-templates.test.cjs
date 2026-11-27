const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { validateDirectory, listDirectories, copyDirectory } = require('../webTemplates.js');

async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'inky-template-test-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    return root;
}

test('discovers installed template folders and reports unreadable library paths', async t => {
    const root = await fixture(t);
    assert.deepEqual(listDirectories(path.join(root, 'missing')), []);
    for( const name of ['Beta', 'Alpha', 'not-a-template'] ) await fs.mkdir(path.join(root, name));
    for( const name of ['Beta', 'Alpha'] ) await fs.writeFile(path.join(root, name, 'index.html'), '<html></html>');
    assert.deepEqual(listDirectories(root), ['Alpha', 'Beta'].map(name => path.join(root, name)));
    await fs.writeFile(path.join(root, 'file'), 'not a folder');
    assert.throws(() => listDirectories(path.join(root, 'file')), { code: 'ENOTDIR' });
});

test('validates arbitrary template locations and reserves generated files', async t => {
    const root = await fixture(t);
    await assert.rejects(validateDirectory(root), { code: 'ENOENT' });
    await fs.writeFile(path.join(root, 'index.html'), '<html></html>');
    assert.equal(await validateDirectory(root), await fs.realpath(root));
    for( const file of ['story.js', 'ink.js'] ) {
        await fs.writeFile(path.join(root, file), 'generated output');
        await assert.rejects(validateDirectory(root), /must not contain generated file/);
        await fs.unlink(path.join(root, file));
    }
});

test('copies nested binary assets and player code without executing it or deleting author files', async t => {
    const root = await fixture(t), source = path.join(root, 'source'), output = path.join(root, 'output');
    await fs.mkdir(path.join(source, 'assets/fonts'), { recursive: true });
    await fs.mkdir(output);
    await fs.writeFile(path.join(source, 'index.html'), '##STORY TITLE##');
    const bytes = Buffer.from([0, 255, 128, 10, 13, 0]);
    await fs.writeFile(path.join(source, 'assets/fonts/example.woff'), bytes);
    const code = 'throw new Error("template code must not run in the exporter");';
    await fs.writeFile(path.join(source, 'player.js'), code);
    await fs.writeFile(path.join(output, 'keep.txt'), 'author file');
    await copyDirectory(source, output);
    assert.deepEqual(await fs.readFile(path.join(output, 'assets/fonts/example.woff')), bytes);
    assert.equal(await fs.readFile(path.join(output, 'player.js'), 'utf8'), code);
    assert.equal(await fs.readFile(path.join(output, 'keep.txt'), 'utf8'), 'author file');
    await assert.rejects(fs.stat(path.join(output, 'index.html')), { code: 'ENOENT' });
});

test('rejects template/output overlap and nested symlinks', async t => {
    const root = await fixture(t), source = path.join(root, 'source');
    await fs.mkdir(source);
    await fs.writeFile(path.join(source, 'index.html'), '<html></html>');
    for( const output of [source, path.join(source, 'output'), root] ) {
        await assert.rejects(copyDirectory(source, output), /separate folder/);
    }
    try {
        await fs.symlink(path.join(source, 'index.html'), path.join(source, 'linked.html'));
    } catch(error) {
        if( error.code == 'EPERM' ) { t.skip('Creating symlinks requires permission on this host.'); return; }
        throw error;
    }
    await assert.rejects(copyDirectory(source, path.join(root, 'output')), /symlinks are not supported/);
});
