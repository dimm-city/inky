const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { BrowserPreview } = require('../main-process/browserPreview.js');

async function fixture(t) {
    const preview = new BrowserPreview();
    await preview.ready;
    t.after(() => preview.close());
    return preview;
}
async function build(preview, revision, text = 'A story') {
    const dir = path.join(preview.root, String(revision));
    await fs.mkdir(dir);
    await fs.writeFile(path.join(dir, 'index.html'), '<!doctype html><html><head><title>Test</title></head><body>' + text + '<script src="story.js"></script></body></html>');
    await fs.writeFile(path.join(dir, 'story.js'), 'var storyContent = {};');
    return dir;
}
function request(url, headers = {}, method = 'GET') {
    return new Promise((resolve, reject) => {
        const req = http.request(url, { headers, method }, res => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => resolve({ code: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
        });
        req.on('error', reject); req.end();
    });
}

test('serves completed exports on loopback and injects the client only into the response', async t => {
    const preview = await fixture(t);
    assert.equal(preview.server.address().address, '127.0.0.1');
    assert.equal((await request(preview.url)).code, 503);
    const directory = await build(preview, 1);
    await preview.publish(1, { inkVersion: 21 }, null);
    const page = await request(preview.url);
    assert.equal(page.code, 200);
    assert.match(page.body.toString(), /<head><script .*data-revision="1"/);
    assert.equal(page.headers['cache-control'], 'no-store');
    assert.doesNotMatch(await fs.readFile(path.join(directory, 'index.html'), 'utf8'), /__inky/);
    const json = await request(preview.url + '__inky/story.json');
    assert.deepEqual(JSON.parse(json.body).content, { inkVersion: 21 });
    assert.equal((await request(preview.url + '__inky/client.js')).code, 200);
    const head = await request(preview.url, {}, 'HEAD');
    assert.equal(head.body.length, 0);
    assert.equal(Number(head.headers['content-length']), page.body.length);
});

test('rejects other hosts, origins, sessions, traversal, methods and symlink escapes', async t => {
    const preview = await fixture(t);
    const directory = await build(preview, 1);
    await fs.writeFile(path.join(preview.root, 'private.txt'), 'Do not serve');
    await fs.symlink(path.join(preview.root, 'private.txt'), path.join(directory, 'link.txt'));
    await preview.publish(1, {}, null);
    assert.equal((await request(preview.url, { Host: 'attacker.example' })).code, 403);
    assert.equal((await request(preview.url, { Origin: 'https://attacker.example' })).code, 403);
    assert.equal((await request('http://' + preview.host + '/other-session/')).code, 403);
    assert.equal((await request(preview.url + '%2f..%2fprivate.txt')).code, 403);
    assert.equal((await request(preview.url + 'link.txt')).code, 403);
    assert.equal((await request(preview.url, {}, 'POST')).code, 405);
    assert.equal((await request(preview.url + 'missing.txt')).code, 404);
});

test('keeps the previous revision after failed publication and ignores old builds', async t => {
    const preview = await fixture(t);
    await build(preview, 1);
    await preview.publish(1, { text: 'first' }, null);
    await assert.rejects(preview.publish(2, {}, null));
    preview.fail('Compile failed');
    let state = JSON.parse((await request(preview.url + '__inky/story.json')).body);
    assert.equal(state.revision, 1);
    assert.equal(state.content.text, 'first');
    assert.equal(state.error, 'Compile failed');
    await build(preview, 3);
    await preview.publish(3, { text: 'latest' }, '/a-template');
    assert.equal(await preview.publish(1, { text: 'stale' }, null), false);
    state = JSON.parse((await request(preview.url + '__inky/story.json')).body);
    assert.equal(state.revision, 3);
    assert.equal(state.templateRevision, 2);
    assert.equal(state.error, null);
    assert.equal(state.content.text, 'latest');
    await assert.rejects(fs.stat(path.join(preview.root, '1')), { code: 'ENOENT' });
});

test('streams media byte ranges with correct types and rejects invalid ranges', async t => {
    const preview = await fixture(t);
    const directory = await build(preview, 1);
    await fs.writeFile(path.join(directory, 'voice.wav'), Buffer.from([0, 1, 2, 3, 4, 5]));
    await preview.publish(1, {}, null);
    const range = await request(preview.url + 'voice.wav', { Range: 'bytes=1-3' });
    assert.equal(range.code, 206);
    assert.equal(range.headers['content-type'], 'audio/wav');
    assert.equal(range.headers['content-range'], 'bytes 1-3/6');
    assert.deepEqual([...range.body], [1, 2, 3]);
    assert.equal((await request(preview.url + 'voice.wav', { Range: 'bytes=99-' })).code, 416);
    assert.equal((await request(preview.url + 'voice.wav', { Range: 'bytes=-' })).code, 416);
});

test('SSE reconnects receive the latest revision and shutdown removes the export', async t => {
    const preview = await fixture(t);
    await build(preview, 1);
    await preview.publish(1, {}, null);
    const response = await fetch(preview.url + '__inky/events');
    assert.equal(response.headers.get('content-type'), 'text/event-stream');
    const reader = response.body.getReader();
    assert.match(new TextDecoder().decode((await reader.read()).value), /"revision":1/);
    await build(preview, 2);
    await preview.publish(2, {}, null);
    assert.match(new TextDecoder().decode((await reader.read()).value), /"revision":2/);
    await reader.cancel();
    const reconnect = await fetch(preview.url + '__inky/events');
    const again = reconnect.body.getReader();
    assert.match(new TextDecoder().decode((await again.read()).value), /"revision":2/);
    await preview.close();
    assert.match(new TextDecoder().decode((await again.read()).value), /"stopped":true/);
    await assert.rejects(fs.stat(preview.root), { code: 'ENOENT' });
});
