const { it: test, afterEach } = require('mocha');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { validateDirectory, listDirectories, copyDirectory, importDirectory } = require('../webTemplates.js');

const roots = [];
afterEach(async () => {
    for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
async function fixture() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'inky-template-test-'));
    roots.push(root);
    return root;
}

test('discovers installed template folders and reports unreadable library paths', async function() {
    const root = await fixture();
    assert.deepEqual(listDirectories(path.join(root, 'missing')), []);
    for( const name of ['Beta', 'Alpha', 'not-a-template'] ) await fs.mkdir(path.join(root, name));
    for( const name of ['Beta', 'Alpha'] ) await fs.writeFile(path.join(root, name, 'index.html'), '<html></html>');
    assert.deepEqual(listDirectories(root), ['Alpha', 'Beta'].map(name => path.join(root, name)));
    await fs.writeFile(path.join(root, 'file'), 'not a folder');
    assert.throws(() => listDirectories(path.join(root, 'file')), { code: 'ENOTDIR' });
});

test('validates arbitrary template locations and reserves generated files', async function() {
    const root = await fixture();
    await assert.rejects(validateDirectory(root), /template folder containing index.html/);
    await fs.writeFile(path.join(root, 'index.html'), '<html></html>');
    assert.equal(await validateDirectory(root), await fs.realpath(root));
    for( const file of ['story.js', 'ink.js'] ) {
        await fs.writeFile(path.join(root, file), 'generated output');
        await assert.rejects(validateDirectory(root), /must not contain generated file/);
        await fs.unlink(path.join(root, file));
    }
});

test('copies nested binary assets and player code without executing it or deleting author files', async function() {
    const root = await fixture(), source = path.join(root, 'source'), output = path.join(root, 'output');
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

test('rejects template/output overlap and nested symlinks', async function() {
    const root = await fixture(), source = path.join(root, 'source');
    await fs.mkdir(source);
    await fs.writeFile(path.join(source, 'index.html'), '<html></html>');
    for( const output of [source, path.join(source, 'output'), root] ) {
        await assert.rejects(copyDirectory(source, output), /separate folder/);
    }
    try {
        await fs.symlink(path.join(source, 'index.html'), path.join(source, 'linked.html'));
    } catch(error) {
        if( error.code == 'EPERM' ) { this.skip('Creating symlinks requires permission on this host.'); return; }
        throw error;
    }
    await assert.rejects(copyDirectory(source, path.join(root, 'output')), /symlinks are not supported/);
});

test('rejects destination directory and asset symlinks without overwriting outside files', async function() {
    const root = await fixture();
    for( const kind of ['directory', 'file'] ) {
        const source = path.join(root, kind, 'source'), output = path.join(root, kind, 'output');
        const outside = path.join(root, kind, 'outside');
        await fs.mkdir(path.join(source, 'assets'), { recursive: true });
        await fs.mkdir(output);
        await fs.mkdir(outside);
        await fs.writeFile(path.join(source, 'assets/style.css'), 'template stylesheet');
        await fs.writeFile(path.join(outside, 'style.css'), 'DO NOT OVERWRITE');
        try {
            if( kind == 'directory' ) {
                await fs.symlink(outside, path.join(output, 'assets'), 'junction');
            } else {
                await fs.mkdir(path.join(output, 'assets'));
                await fs.symlink(path.join(outside, 'style.css'), path.join(output, 'assets/style.css'));
            }
        } catch(error) {
            if( error.code == 'EPERM' ) { this.skip('Creating symlinks requires permission on this host.'); return; }
            throw error;
        }
        await assert.rejects(copyDirectory(source, output), /Export destination symlinks/);
        assert.equal(await fs.readFile(path.join(outside, 'style.css'), 'utf8'), 'DO NOT OVERWRITE');
    }
});

test('rejects generated output symlinks before copying or changing linked files', async function() {
    const root = await fixture(), source = path.join(root, 'source');
    await fs.mkdir(source);
    await fs.writeFile(path.join(source, 'asset.css'), 'template stylesheet');
    const outside = path.join(root, 'outside.txt');
    await fs.writeFile(outside, 'DO NOT OVERWRITE');
    for( const generated of ['story.js', 'ink.js', 'index.html'] ) {
        const output = path.join(root, generated + '-output');
        await fs.mkdir(output);
        try {
            await fs.symlink(outside, path.join(output, generated));
        } catch(error) {
            if( error.code == 'EPERM' ) { this.skip('Creating symlinks requires permission on this host.'); return; }
            throw error;
        }
        await assert.rejects(copyDirectory(source, output, [generated]), /Export destination symlinks/);
        assert.equal(await fs.readFile(outside, 'utf8'), 'DO NOT OVERWRITE');
        assert.equal((await fs.lstat(path.join(output, generated))).isSymbolicLink(), true);
        await assert.rejects(fs.stat(path.join(output, 'asset.css')), { code: 'ENOENT' });
    }
});

test('rejects a symlink used as the export root before copying or creating its target', async function() {
    const root = await fixture(), source = path.join(root, 'source');
    await fs.mkdir(source);
    await fs.writeFile(path.join(source, 'player.js'), 'template player');
    for( const exists of [true, false] ) {
        const outside = path.join(root, exists ? 'outside' : 'missing');
        const output = path.join(root, exists ? 'linked-output' : 'dangling-output');
        if( exists ) {
            await fs.mkdir(outside);
            await fs.writeFile(path.join(outside, 'player.js'), 'DO NOT OVERWRITE');
        }
        try {
            await fs.symlink(outside, output, 'junction');
        } catch(error) {
            if( error.code == 'EPERM' ) { this.skip('Creating symlinks requires permission on this host.'); return; }
            throw error;
        }
        await assert.rejects(copyDirectory(source, output), /Export destination symlinks/);
        assert.equal((await fs.lstat(output)).isSymbolicLink(), true);
        if( exists ) {
            assert.equal(await fs.readFile(path.join(outside, 'player.js'), 'utf8'), 'DO NOT OVERWRITE');
        } else {
            await assert.rejects(fs.stat(outside), { code: 'ENOENT' });
        }
    }
});

test('imports complete templates, keeps duplicate names and leaves the source editable', async function() {
    const root = await fixture(), source = path.join(root, 'My player'), library = path.join(root, 'library');
    await fs.mkdir(path.join(source, 'assets'), { recursive: true });
    await fs.writeFile(path.join(source, 'index.html'), '<title>##STORY TITLE##</title>');
    await fs.writeFile(path.join(source, 'assets/art.png'), Buffer.from([0, 255, 128]));
    const first = await importDirectory(source, library);
    const second = await importDirectory(source, library);
    assert.equal(path.basename(first), 'My player');
    assert.equal(path.basename(second), 'My player (2)');
    assert.deepEqual(listDirectories(library), [first, second].sort());
    assert.equal(await fs.readFile(path.join(second, 'index.html'), 'utf8'), '<title>##STORY TITLE##</title>');
    assert.deepEqual(await fs.readFile(path.join(second, 'assets/art.png')), Buffer.from([0, 255, 128]));
    await fs.writeFile(path.join(source, 'index.html'), 'source edit');
    assert.equal(await fs.readFile(path.join(first, 'index.html'), 'utf8'), '<title>##STORY TITLE##</title>');
});

test('failed imports remove their partial copy and preserve existing library entries', async function() {
    const root = await fixture(), library = path.join(root, 'library');
    await fs.mkdir(path.join(library, 'Good'), { recursive: true });
    await fs.writeFile(path.join(library, 'Good/index.html'), 'keep');
    const invalid = path.join(root, 'invalid'); await fs.mkdir(invalid);
    await assert.rejects(importDirectory(invalid, library), /template folder containing index.html/);
    // Importing a library's ancestor would recursively copy into its own source.
    await fs.writeFile(path.join(root, 'index.html'), 'template containing the library');
    await assert.rejects(importDirectory(root, library), /separate folder/);
    assert.deepEqual(await fs.readdir(library), ['Good']);
    assert.equal(await fs.readFile(path.join(library, 'Good/index.html'), 'utf8'), 'keep');
});
