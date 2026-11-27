// Served only by the local preview server, never included in an export.
(() => {
    'use strict';
    const script = document.currentScript;
    const base = new URL('.', script.src);
    let attempted = Number(script.dataset.revision);
    const templateRevision = Number(script.dataset.templateRevision);
    let wanted = attempted, handler, updating = false, notice;
    const source = new EventSource(new URL('events', base));
    const show = message => {
        if( notice ) notice.textContent = message;
    };
    window.inkyPreview = { accept(callback) { handler = callback; } };
    document.addEventListener('DOMContentLoaded', () => {
        const host = document.createElement('aside');
        host.id = 'inky-browser-preview';
        const shadow = host.attachShadow({ mode: 'open' });
        shadow.innerHTML = '<style>:host{position:fixed;bottom:12px;right:12px;z-index:2147483647;max-width:min(440px,calc(100vw - 24px));font:14px/1.4 system-ui,sans-serif;color:#fff}div{background:#18212f;border:1px solid #8192a8;border-radius:6px;padding:10px;box-shadow:0 2px 12px #0006}button{font:inherit;padding:8px;margin-left:8px;cursor:pointer}</style><div><span role="status"></span><button type="button">Restart preview</button></div>';
        notice = shadow.querySelector('span');
        shadow.querySelector('button').addEventListener('click', () => location.reload());
        document.body.appendChild(host);
        show(handler ? 'Live preview · Ready' : 'Live preview · Updates reload this template');
    });
    async function update() {
        if( updating ) return;
        updating = true;
        try {
            while( wanted > attempted ) {
                const response = await fetch(new URL('story.json', base), { cache: 'no-store' });
                if( !response.ok ) throw new Error('Could not fetch the updated story.');
                const next = await response.json();
                if( next.revision <= attempted ) break;
                attempted = next.revision;
                if( next.templateRevision !== templateRevision || !handler ) { location.reload(); return; }
                try {
                    await handler(next.content);
                    show('Live preview · Updated');
                } catch(error) {
                    show('Progress could not be restored. Restart preview to apply the update. ' + error.message);
                }
            }
        } catch(error) {
            show('Preview disconnected: ' + error.message);
        } finally { updating = false; }
    }
    source.onmessage = event => {
        const message = JSON.parse(event.data);
        if( message.stopped ) { source.close(); show('Live preview stopped'); return; }
        if( message.error ) { show('Showing the last successful build. ' + message.error); return; }
        if( message.templateRevision !== templateRevision && message.revision ) { location.reload(); return; }
        wanted = Math.max(wanted, message.revision);
        void update();
    };
    source.onerror = () => show('Preview disconnected · Waiting for Inky');
    window.addEventListener('pagehide', () => source.close());
})();
