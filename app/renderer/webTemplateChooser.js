const { ipcRenderer, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { listDirectories, validateDirectory, importDirectory } = require('../webTemplates.js');
const i18n = require('./i18n.js');

const dialog = document.getElementById('web-template-chooser');
const list = dialog.querySelector('select');
const error = dialog.querySelector('[role=alert]');
const location = dialog.querySelector('#web-template-location');
const fields = dialog.querySelector('fieldset');
const use = dialog.querySelector('[type=submit]');
let library, selected, sourceDirectory, busy = false;

function showSelection() {
    const directory = list.value;
    use.disabled = false;
    location.textContent = directory || i18n._("Classic is built into Inky.");
    if( directory ) {
        try {
            if( !fs.statSync(path.join(directory, 'index.html')).isFile() ) throw new Error();
        } catch(_) {
            use.disabled = true;
            location.textContent += '\n' + i18n._('Folder unavailable. Use external folder to locate it, or select another template.');
        }
    }
}

function refresh(directory) {
    error.textContent = '';
    let directories = [];
    try { directories = listDirectories(library); }
    catch(problem) { error.textContent = problem.message; }
    for( const extra of [selected, directory] ) {
        if( extra && !directories.includes(extra) ) directories.push(extra);
    }
    list.replaceChildren(new Option(i18n._('Classic — Built-in'), ''));
    for( const entry of directories ) {
        const source = path.dirname(entry) === library ? i18n._('Library') : i18n._('External');
        list.add(new Option(path.basename(entry) + ' — ' + source, entry));
    }
    list.value = directory || '';
    showSelection();
}

async function perform(action) {
    if( busy ) return;
    busy = fields.disabled = true;
    error.textContent = '';
    try { await action(); }
    catch(problem) { error.textContent = problem.message; }
    finally {
        busy = fields.disabled = false;
        if( dialog.open ) list.focus();
    }
}

ipcRenderer.on('choose-web-template', (_event, options) => {
    if( dialog.open ) { list.focus(); return; }
    library = options.library;
    selected = options.selected;
    sourceDirectory = options.sourceDirectory;
    refresh(selected);
    dialog.showModal();
});
window.addEventListener('focus', () => { if( dialog.open && !busy ) refresh(list.value); });
list.addEventListener('change', () => { error.textContent = ''; showSelection(); });
// Keep background editor shortcuts from consuming the dialog's native keys.
dialog.addEventListener('keydown', event => event.stopPropagation());
dialog.addEventListener('cancel', event => { if( busy ) event.preventDefault(); });
dialog.querySelector('[data-action=cancel]').addEventListener('click', () => dialog.close());
dialog.querySelector('form').addEventListener('submit', event => {
    event.preventDefault();
    void perform(async () => {
        await ipcRenderer.invoke('select-web-template', list.value || null);
        dialog.close();
    });
});
for( const action of ['import', 'external'] ) {
    dialog.querySelector(`[data-action=${action}]`).addEventListener('click', () => perform(async () => {
        let defaultPath = sourceDirectory;
        if( action === 'external' && list.value ) {
            const current = fs.existsSync(list.value) ? list.value : path.dirname(list.value);
            if( fs.existsSync(current) ) defaultPath = current;
        }
        const result = await ipcRenderer.invoke('showOpenDialog', {
            title: action === 'import' ? i18n._('Import template folder') : i18n._('Use external template folder'),
            defaultPath,
            properties: ['openDirectory']
        });
        if( result.canceled ) return;
        let directory = path.resolve(result.filePaths[0]);
        if( action === 'import' ) directory = await importDirectory(directory, library);
        else await validateDirectory(directory);
        refresh(directory);
    }));
}
dialog.querySelector('[data-action=library]').addEventListener('click', () => perform(async () => {
    await fs.promises.mkdir(library, { recursive: true });
    const problem = await shell.openPath(library);
    if( problem ) throw new Error(problem);
    refresh(list.value);
}));
