const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { randomUUID } = require('crypto');
const { contains } = require('../webTemplates.js');

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.mp4': 'video/mp4', '.webm': 'video/webm' };

// One project window owns this server and every file it serves.
class BrowserPreview {
    constructor() {
        this.root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'inky-preview-')));
        this.prefix = '/' + randomUUID() + '/';
        this.clients = new Set();
        this.build = null;
        this.error = null;
        this.closed = false;
        this.server = http.createServer((req, res) => this.serve(req, res));
        this.ready = new Promise((resolve, reject) => {
            this.server.once('error', reject);
            this.server.listen(0, '127.0.0.1', () => {
                this.host = '127.0.0.1:' + this.server.address().port;
                this.url = 'http://' + this.host + this.prefix;
                resolve();
            });
        });
    }

    message() {
        return { revision: this.build?.revision || 0, templateRevision: this.build?.templateRevision || 0, error: this.error, stopped: this.closed };
    }

    notify() {
        const data = 'data: ' + JSON.stringify(this.message()) + '\n\n';
        for( const client of this.clients ) client.write(data);
    }

    fail(message) {
        this.error = message;
        this.notify();
    }

    async publish(revision, content, template) {
        if( this.closed || revision <= (this.build?.revision || 0) ) return false;
        const directory = path.join(this.root, String(revision));
        if( !(await fs.promises.stat(path.join(directory, 'index.html'))).isFile() ) throw new Error('Preview export has no index.html.');
        const previous = this.build;
        this.build = { revision, directory, content, template, readers: 0, retired: false,
            templateRevision: (previous?.templateRevision || 0) + (!previous || template !== previous.template ? 1 : 0) };
        this.error = null;
        this.notify();
        if( previous ) {
            previous.retired = true;
            await this.removeRetired(previous);
        }
        return true;
    }

    async removeRetired(build) {
        if( build.retired && !build.readers ) {
            try { await fs.promises.rm(build.directory, { recursive: true, force: true }); }
            catch(error) { this.fail('Could not clean up the previous preview: ' + error.message); }
        }
    }

    async serve(req, res) {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        const finish = (code, text) => { res.statusCode = code; res.end(text); };
        let relative;
        try { relative = decodeURIComponent(new URL(req.url, this.url).pathname); }
        catch(error) { finish(400, 'Invalid path'); return; }
        if( req.headers.host !== this.host || !relative.startsWith(this.prefix) ||
            (req.headers.origin && req.headers.origin !== 'http://' + this.host) ) {
            finish(403, 'Not a preview request'); return;
        }
        if( !['GET', 'HEAD'].includes(req.method) ) { finish(405, 'Method not allowed'); return; }
        relative = relative.slice(this.prefix.length);
        if( relative === '__inky/events' && req.method === 'GET' ) {
            res.writeHead(200, { 'Content-Type': 'text/event-stream' });
            this.clients.add(res);
            res.write('data: ' + JSON.stringify(this.message()) + '\n\n');
            req.on('close', () => this.clients.delete(res));
            return;
        }
        const build = this.build;
        if( !build ) { finish(503, 'Waiting for the first successful preview build.'); return; }
        build.readers++;
        try {
            let body, type;
            if( relative === '__inky/story.json' ) {
                body = Buffer.from(JSON.stringify({ ...this.message(), content: build.content }));
                type = types['.json'];
            } else if( relative === '__inky/client.js' ) {
                body = await fs.promises.readFile(path.join(__dirname, '../renderer/browserPreviewClient.js'));
                type = types['.js'];
            } else {
                const target = path.resolve(build.directory, relative || 'index.html');
                if( !contains(build.directory, target) || !contains(build.directory, await fs.promises.realpath(target)) ) {
                    finish(403, 'Outside the preview'); return;
                }
                body = await fs.promises.readFile(target);
                type = types[path.extname(target).toLowerCase()] || 'application/octet-stream';
                if( target === path.join(build.directory, 'index.html') ) {
                    const client = `<script src="${this.prefix}__inky/client.js" data-revision="${build.revision}" data-template-revision="${build.templateRevision}"></script>`;
                    let html = body.toString('utf8');
                    html = /<head\b[^>]*>/i.test(html) ? html.replace(/<head\b[^>]*>/i, match => match + client) : html.replace(/^(<!doctype[^>]*>)?/i, match => match + client);
                    body = Buffer.from(html);
                }
            }
            res.setHeader('Content-Type', type);
            res.setHeader('Accept-Ranges', 'bytes');
            let start = 0, end = body.length - 1;
            if( req.headers.range ) {
                const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
                if( !match || (!match[1] && !match[2]) ) { finish(416, 'Invalid range'); return; }
                start = match[1] ? Number(match[1]) : Math.max(0, body.length - Number(match[2]));
                end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
                if( start > end || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) ) {
                    res.setHeader('Content-Range', 'bytes */' + body.length);
                    finish(416, 'Invalid range'); return;
                }
                res.statusCode = 206;
                res.setHeader('Content-Range', `bytes ${start}-${end}/${body.length}`);
            }
            res.setHeader('Content-Length', end - start + 1);
            res.end(req.method === 'HEAD' ? undefined : body.subarray(start, end + 1));
        } catch(error) {
            if( !res.headersSent ) finish(error.code === 'ENOENT' || error.code === 'ENOTDIR' ? 404 : 500, 'Preview file unavailable');
            else res.destroy(error);
        } finally {
            build.readers--;
            await this.removeRetired(build);
        }
    }

    async close() {
        if( this.closed ) return;
        this.closed = true;
        this.notify();
        for( const client of this.clients ) client.end();
        this.clients.clear();
        try { await this.ready; }
        catch(error) { /* Startup failure still needs directory cleanup. */ }
        await new Promise(resolve => { this.server.close(resolve); this.server.closeAllConnections(); });
        await fs.promises.rm(this.root, { recursive: true, force: true });
    }
}

module.exports = { BrowserPreview };
