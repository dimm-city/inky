const electron = require('electron');
const ipc = electron.ipcMain;
const dialog = electron.dialog;
const BrowserWindow = electron.BrowserWindow;
const path = require("path");
const fs = require("fs");
const Inklecate = require("./inklecate.js").Inklecate;
const Menu = electron.Menu;
const i18n = require("./i18n/i18n.js");
const { validateDirectory } = require('../webTemplates.js');
const ProjectSettings = require('../projectSettings.js');
const { pathToFileURL } = require('url');
const { BrowserPreview } = require('./browserPreview.js');

var electronWindowOptions = {
  width: 1300,
  height: 730,
  minWidth: 350,
  minHeight: 250,
  webPreferences: {
    preload: path.join(__dirname, '..', 'renderer', 'preload.js'),
    nodeIntegration: true,
  contextIsolation: false
  },
  
};


if( process.platform == "darwin" ) {
    electronWindowOptions.titleBarStyle = 'hidden';
    electronWindowOptions.titleBarOverlay = true;
}

var windows = [];

const recentFilesPath = path.join(electron.app.getPath("userData"), "recent-files.json");

const viewSettingsPath = path.join(electron.app.getPath("userData"), "view-settings.json");


// Overriden by main.js
var events = {
    onRecentFilesChanged:    (files) => {},
    onProjectSettingsChanged: (settings) => {},
    onViewSettingsChanged:   (settings) => {}
};


function ProjectWindow(filePath) {
    const getThemeFromMenu = () => Menu.getApplicationMenu().items.find(
        e => e.label.toLowerCase() === '&view'
    ).submenu.items.find(
        e => e.label.toLowerCase() === 'theme'
    ).submenu.items.find(
        e => e.checked
    ).label.toLowerCase();

    electronWindowOptions.title = i18n._("Inky");
    this.browserWindow = new BrowserWindow(electronWindowOptions);
    this.browserWindow.loadURL("file://" + __dirname + "/../renderer/index.html");
    this.browserWindow.setSheetOffset(49);

    this.safeToClose = false;
    this.mainInkAbsPath = filePath;
    this.settings = {};
    this.webExport = {};
    this.browserPreview = null;

    // Existing project at specific path
    if( filePath ) {
        this.browserWindow.webContents.on('dom-ready', () => {
            this.browserWindow.setRepresentedFilename(filePath);
            this.browserWindow.webContents.send('set-project-main-ink-filepath', filePath);

            // Try to load settings 
            this.refreshProjectSettings(filePath);
        });
    }
    
    // New project, new settings
    else {
        this.settings = {};
        if( events.onProjectSettingsChanged )
            events.onProjectSettingsChanged({});
    }

    windows.push(this);

    this.browserWindow.on("close", (event) => {
        if( !this.safeToClose ) {
            event.preventDefault();
            this.tryClose();
        }
    })

    this.browserWindow.on("closed", () => {
        this.stopBrowserPreview().catch(error => console.error('Preview cleanup failed:', error));
        var idx = windows.indexOf(this);
        if( idx != -1 )
            windows.splice(idx, 1);
    });

    // Set up theme/zoom from settings
    this.browserWindow.webContents.on('dom-ready', () => {
        this.browserWindow.send("change-theme", getThemeFromMenu());

        let settings = ProjectWindow.getViewSettings();
        this.zoom(settings.zoom);
        this.browserWindow.webContents.send('set-animation-enabled', settings.animationEnabled);
        this.browserWindow.webContents.send('set-autocomplete-disabled', !!settings.autoCompleteDisabled);
    });

    // Project settings may affect menus etc, so we refresh that
    // when changing focus between different windows
    this.browserWindow.on("focus", () => {
        if( events.onProjectSettingsChanged )
            events.onProjectSettingsChanged(this.settings);
    });
}

ProjectWindow.prototype.newInclude = function() {
    this.browserWindow.webContents.send('project-new-include');
}

ProjectWindow.prototype.save = function() {
    this.browserWindow.webContents.send('project-save');
}

ProjectWindow.prototype.exportJson = function() {
    this.browserWindow.webContents.send('project-export');
}

ProjectWindow.templatesDirectory = () => path.join(electron.app.getPath('userData'), 'templates');

ProjectWindow.prototype.persistWebExport = function() {
    if( !this.mainInkAbsPath || !Object.keys(this.webExport).length ) return;
    try {
        this.settings = ProjectSettings.writeWebExport(this.mainInkAbsPath, this.webExport);
        this.unsavedWebExport = null;
    } catch(error) {
        this.unsavedWebExport = { ...this.webExport };
        dialog.showErrorBox(i18n._('Project settings not saved'),
            i18n._('Web export settings are active for this session, but could not be saved.') + '\n' + error.message);
    }
}

ProjectWindow.prototype.selectWebTemplate = async function(directory) {
    if( directory ) await validateDirectory(directory);
    this.webExport.template = directory ? path.resolve(directory) : null;
    this.persistWebExport();
    if( this.browserPreview ) this.browserWindow.webContents.send('browser-preview-template', this.webExport.template);
}

ProjectWindow.prototype.toggleBrowserPreview = async function() {
    if( this.stoppingPreview ) await this.stoppingPreview.finished;
    if( this.browserPreview ) { await this.stopBrowserPreview(); return; }
    const preview = new BrowserPreview();
    this.browserPreview = preview;
    events.onProjectSettingsChanged(this.settings);
    try {
        await preview.ready;
        if( this.browserPreview !== preview ) return;
        this.browserWindow.webContents.send('browser-preview-start', { root: preview.root, template: this.webExport.template || null });
    } catch(error) {
        await this.stopBrowserPreview();
        throw error;
    }
}

ProjectWindow.prototype.stopBrowserPreview = async function() {
    const preview = this.browserPreview;
    if( !preview ) return this.stoppingPreview?.finished;
    this.browserPreview = null;
    this.stoppingPreview = preview;
    let finish;
    preview.finished = new Promise(resolve => { finish = resolve; });
    events.onProjectSettingsChanged(this.settings);
    try {
        if( !this.browserWindow.isDestroyed() && !this.browserWindow.webContents.isCrashed() ) {
            // Let in-flight file copies finish before removing their owned directory.
            const idle = new Promise(resolve => { preview.stopped = resolve; });
            this.browserWindow.once('closed', preview.stopped);
            this.browserWindow.webContents.once('render-process-gone', preview.stopped);
            this.browserWindow.webContents.send('browser-preview-stop', preview.root);
            await idle;
            this.browserWindow.removeListener('closed', preview.stopped);
            this.browserWindow.webContents.removeListener('render-process-gone', preview.stopped);
        }
        await preview.close();
    } finally {
        this.stoppingPreview = null;
        finish();
        events.onProjectSettingsChanged(this.settings);
    }
}

ProjectWindow.prototype.exportForWeb = function() {
    this.browserWindow.webContents.send('project-export-for-web', this.webExport);
}

ProjectWindow.prototype.exportJSOnly = function() {
    this.browserWindow.webContents.send('project-export-js-only', this.webExport);
}

ProjectWindow.prototype.openExportedGame = async function() {
    const file = this.webExport.directory && path.join(this.webExport.directory, 'index.html');
    try {
        if( !file || !(await fs.promises.stat(file)).isFile() ) throw new Error(i18n._('No exported game is available.'));
        await electron.shell.openExternal(pathToFileURL(file).href);
    } catch(error) {
        dialog.showErrorBox(i18n._('Could not open exported game'),
            i18n._('Export for web again, choosing the game folder, then try opening it.') + '\n' + error.message);
    }
}

ProjectWindow.prototype.tryClose = function() {
    this.browserWindow.webContents.send('project-tryClose');
}

ProjectWindow.prototype.stats = function() {
    this.browserWindow.webContents.send('project-stats');
}

ProjectWindow.prototype.keyboardShortcuts = function() {
    this.browserWindow.webContents.send('keyboard-shortcuts');
}

ProjectWindow.prototype.finalClose = async function() {
    await this.stopBrowserPreview();
    this.safeToClose = true;
    Inklecate.killSessions(this.browserWindow);
    this.browserWindow.close();
}

ProjectWindow.prototype.openDevTools = function() {
    this.browserWindow.webContents.openDevTools();
}

ProjectWindow.prototype.zoom = function(amount) {
    this.browserWindow.webContents.send('zoom', amount);
}

// The existing sidecar owns project preferences, including web exports.
ProjectWindow.prototype.refreshProjectSettings = function(rootInkFilePath) {
    try {
        const settings = ProjectSettings.read(rootInkFilePath);
        const webExport = { ...ProjectSettings.webExport(settings, rootInkFilePath), ...this.unsavedWebExport };
        if( this.browserPreview && webExport.template !== this.webExport.template )
            this.browserWindow.webContents.send('browser-preview-template', webExport.template || null);
        this.settings = settings;
        this.webExport = webExport;
    } catch(error) {
        dialog.showErrorBox(i18n._('Project Settings Error'), ProjectSettings.filename(rootInkFilePath) + '\n' + error.message);
    }
    this.browserWindow.webContents.send('project-settings-changed', this.settings);
    events.onProjectSettingsChanged(this.settings);
}

ProjectWindow.all = () => windows;

ProjectWindow.setEvents = function(newEvents) {
    events = newEvents
}


ProjectWindow.createEmpty = function() {
    return new ProjectWindow();
}

ProjectWindow.focused = function() {
    var browWin = BrowserWindow.getFocusedWindow();
    if( browWin )
        return ProjectWindow.withWebContents(browWin.webContents);
    else
        return null;
}


ProjectWindow.withWebContents = function(webContents) {
    if( !webContents )
        return null;

    for(var i=0; i<windows.length; i++) {
        if( windows[i].browserWindow.webContents === webContents )
            return windows[i];
    }
    return null;
}


ProjectWindow.withMainkInkPath = function(absPath) {
    if( !absPath ) return null;

    for(var i=0; i<windows.length; i++) {
        if( windows[i].mainInkAbsPath == absPath )
            return windows[i];
    }
    return null;
}


ProjectWindow.getRecentFiles = function() {
    if(!fs.existsSync(recentFilesPath)) {
        return [];
    }
    const json = fs.readFileSync(recentFilesPath, "utf-8");
    try {
        return JSON.parse(json);
    } catch(e) {
        console.error("Error in recent files JSON parsing:", e);
        return [];
    }
}

ProjectWindow.clearRecentFiles = function() {
    if(fs.existsSync(recentFilesPath)) {
        fs.unlinkSync(recentFilesPath);
    }
}

function addRecentFile(filePath) {
    const resolvedFilePath = path.resolve(filePath);
    const recentFiles = ProjectWindow.getRecentFiles();
    const newRecentFiles = recentFiles.indexOf(resolvedFilePath) >= 0 ?
        recentFiles :
        [resolvedFilePath].concat(recentFiles).slice(0, 5);
    fs.writeFileSync(recentFilesPath, JSON.stringify(newRecentFiles), {
        encoding: "utf-8"
    });

    if( events.onRecentFilesChanged ) {
        events.onRecentFilesChanged(newRecentFiles);
    }
}

ProjectWindow.open = function(filePath) {
    if( !filePath ) {
        var multiSelectPaths = dialog.showOpenDialogSync({
            title: i18n._("Open main ink file"),
            properties: ['openFile'],
            filters: [
                { name: i18n._('Ink files'), extensions: ['ink'] }
            ]
        });
        if( multiSelectPaths && multiSelectPaths.length > 0 )
            filePath = multiSelectPaths[0];
    }

    // TODO: Could check whether the filepath is relative to any of our
    // existing open projects, and switch to that window?
    console.log("Testing!")
    if( filePath) {
        addRecentFile(filePath);
        return new ProjectWindow(filePath);
    }
}

ProjectWindow.getViewSettings = function() {
    let viewSettingDefaults = { theme:'light', zoom:'100', animationEnabled:true };

    if(!fs.existsSync(viewSettingsPath)) {
        return viewSettingDefaults;
    }
    
    const json = fs.readFileSync(viewSettingsPath, "utf-8");
    try {
        let loadedSettings = JSON.parse(json);

        // if we've added a new setting or one is missing, make sure they all exist
        for(requiredKey in viewSettingDefaults) {
            if(loadedSettings[requiredKey] === undefined) {
                loadedSettings[requiredKey] = viewSettingDefaults[requiredKey];
            }
        }

        return loadedSettings;
    } catch(e) {
        console.error('Error in view settings JSON parsing:', e);
        return viewSettingDefaults;
    }
}

ProjectWindow.addOrChangeViewSetting = function(name, data){
    const viewSettings = ProjectWindow.getViewSettings();
    viewSettings[name] = data;
    fs.writeFileSync(viewSettingsPath, JSON.stringify(viewSettings), {
        encoding: "utf-8"
    });
    if(events.onViewSettingsChanged) {
        events.onViewSettingsChanged(viewSettings);
    }
}


ipc.on("main-file-saved", (event, absFilePath) => {
    if( !absFilePath ) return;
    addRecentFile(absFilePath);

    var win = ProjectWindow.withWebContents(event.sender);
    const previousPath = win.mainInkAbsPath;
    win.mainInkAbsPath = absFilePath;
    if( previousPath != absFilePath ) {
        if( previousPath ) win.webExport = { template: win.webExport.template || null, directory: null, script: null };
        win.persistWebExport();
    }
    win.refreshProjectSettings(absFilePath);
});

ipc.handle('browser-preview-publish', async (event, root, revision, content, template) => {
    const win = ProjectWindow.withWebContents(event.sender);
    const preview = win && win.browserPreview;
    if( !preview || preview.root !== root ) return;
    if( !Number.isSafeInteger(revision) || revision < 1 ) throw new Error('Invalid preview revision.');
    if( await preview.publish(revision, content, template) && !preview.opened ) {
        preview.opened = true;
        try { await electron.shell.openExternal(preview.url); }
        catch(error) { preview.opened = false; throw error; }
    }
});

ipc.on('browser-preview-error', (event, root, message) => {
    const win = ProjectWindow.withWebContents(event.sender);
    const preview = win && win.browserPreview;
    if( !preview || preview.root !== root ) return;
    preview.fail(message);
    if( !preview.opened && !preview.reportedError ) {
        preview.reportedError = true;
        dialog.showErrorBox(i18n._('Browser preview not ready'), message + '\n' + i18n._('Fix the problem and save again to update the preview.'));
    }
});

ipc.on('browser-preview-stopped', (event, root) => {
    const win = ProjectWindow.withWebContents(event.sender);
    if( win && win.stoppingPreview?.root === root ) win.stoppingPreview.stopped();
});

ipc.on('browser-preview-cancel', event => {
    const win = ProjectWindow.withWebContents(event.sender);
    if( win ) win.stopBrowserPreview().catch(error => console.error('Preview cleanup failed:', error));
});

ipc.handle('web-export-complete', async (event, directory, script) => {
    const win = ProjectWindow.withWebContents(event.sender);
    const previousDirectory = win.webExport.directory;
    win.webExport.directory = directory;
    win.webExport.script = script;
    win.persistWebExport();
    events.onProjectSettingsChanged(win.settings);
    if( previousDirectory == directory ) return;
    const result = await dialog.showMessageBox(win.browserWindow, {
        type: 'info',
        message: i18n._('Game exported'),
        detail: directory,
        buttons: [i18n._('Done'), i18n._('Open exported game')],
        defaultId: 0,
        cancelId: 0
    });
    if( result.response == 1 ) await win.openExportedGame();
});

ipc.on("project-final-close", (event) => {
    var win = ProjectWindow.withWebContents(event.sender);
    win.finalClose();
});

ipc.on("project-settings-needs-reload", (event, rootInkFilePath) => {
    var win = ProjectWindow.withWebContents(event.sender);
    win.refreshProjectSettings(rootInkFilePath);
});

ipc.on("set-native-window-title", (event, newWindowTitle) => {
    var win = ProjectWindow.withWebContents(event.sender);
    win.browserWindow.title = newWindowTitle;
});

exports.ProjectWindow = ProjectWindow;
