// Served only by the local preview server, never included in an export.
(() => {
    'use strict';
    const script = document.currentScript;
    const base = new URL('.', script.src);
    let attempted = Number(script.dataset.revision);
    const templateRevision = Number(script.dataset.templateRevision);
    let wanted = attempted, handler, updating = false, host, notice, restart, hideTimer;
    let status = { message: 'Live preview · Updates reload this template', state: 'ready' };
    const source = new EventSource(new URL('events', base));
    function renderStatus(value) {
        if( !notice ) return;
        clearTimeout(hideTimer);
        notice.textContent = value.message;
        host.dataset.state = value.state;
        restart.hidden = value.state !== 'restart';
        host.hidden = false;
        // Healthy updates should not cover the game's own reading controls.
        if( value.state === 'ready' ) hideTimer = setTimeout(() => { host.hidden = true; }, 3000);
    }
    function show(message, state = 'ready') {
        status = { message, state };
        renderStatus(status);
    }
    window.inkyPreview = { accept(callback) {
        handler = callback;
        if( status.state === 'ready' ) show('Live preview · Ready');
    } };
    document.addEventListener('DOMContentLoaded', () => {
        host = document.createElement('aside');
        host.id = 'inky-browser-preview';
        host.setAttribute('aria-label', 'Inky live browser preview');
        const shadow = host.attachShadow({ mode: 'open' });
        shadow.innerHTML = '<style>:host{position:fixed;bottom:12px;right:12px;z-index:2147483647;max-width:min(440px,calc(100vw - 24px));font:14px/1.4 system-ui,sans-serif;color:#fff}:host([hidden]){display:none}div{display:flex;align-items:center;flex-wrap:wrap;gap:8px;background:#18212f;border:1px solid #8192a8;border-radius:6px;padding:10px;box-shadow:0 2px 12px #0006;max-height:50vh;overflow:auto}span{flex:1;min-width:120px;overflow-wrap:anywhere}:host([data-state=error]) span,:host([data-state=restart]) span{flex-basis:100%}[data-action=hide]{margin-left:auto}button{font:inherit;min-height:36px;padding:6px 10px;cursor:pointer}button[hidden]{display:none}button:focus-visible{outline:2px solid #8bded5;outline-offset:2px}</style><div><span role="status"></span><button type="button" data-action="restart" hidden>Restart preview</button><button type="button" data-action="hide" aria-label="Hide preview status">Hide</button></div>';
        notice = shadow.querySelector('span');
        restart = shadow.querySelector('[data-action="restart"]');
        restart.addEventListener('click', () => location.reload());
        shadow.querySelector('[data-action="hide"]').addEventListener('click', () => {
            clearTimeout(hideTimer);
            host.hidden = true;
        });
        document.body.appendChild(host);
        renderStatus(status);
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
                    show('Your current game is unchanged. Restart preview to play the updated story from the beginning. ' + error.message, 'restart');
                }
            }
        } catch(error) {
            show('Could not update preview. Your current game is unchanged. Save again to retry. ' + error.message, 'error');
        } finally { updating = false; }
    }
    source.onmessage = event => {
        const message = JSON.parse(event.data);
        if( message.stopped ) { source.close(); show('Live preview stopped', 'error'); return; }
        if( message.error ) { show('Showing the last successful build. Fix the Ink errors and save again. ' + message.error, 'error'); return; }
        if( message.templateRevision !== templateRevision && message.revision ) { location.reload(); return; }
        wanted = Math.max(wanted, message.revision);
        void update();
    };
    source.onopen = () => renderStatus(status);
    source.onerror = () => renderStatus({ message: 'Preview disconnected · Waiting for Inky', state: 'error' });
    window.addEventListener('pagehide', () => { clearTimeout(hideTimer); source.close(); });
})();
