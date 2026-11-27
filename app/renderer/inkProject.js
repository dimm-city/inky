const {ipcRenderer} = require("electron");
const path = require("path");
const fs = require("fs");
const _ = require("lodash");
const chokidar = require('chokidar');
const WebTemplates = require('../webTemplates.js');
const ProjectSettings = require('../projectSettings.js');
const i18n = require('./i18n.js');
const { InkMode } = require('./ace-ink-mode/ace-ink.js');
const { PlayerView } = require('./playerView.js');

const EditorView = require("./editorView.js").EditorView;
const NavView = require("./navView.js").NavView;

const InkFile = require("./inkFile.js").InkFile;
const LiveCompiler = require("./liveCompiler.js").LiveCompiler;

// -----------------------------------------------------------------
// InkProject
// -----------------------------------------------------------------

InkProject.events = {};
InkProject.currentProject = null;

// mainInkFilePath is optional, if creating a brand new untitled project
// Can also be absolute, if loading a project.
function InkProject(mainInkFilePath) {
    this.files = [];
    this.hasUnsavedChanges = false;
    this.unsavedFiles = [];

    // Default ink mode for syntax highlighting. This may be replace if
    // the user has a project settings file that customises the instructionPrefix
    this.inkMode = new InkMode("");

    this.mainInk = null;
    this.mainInk = this.createInkFile(mainInkFilePath || null, isBrandNew = mainInkFilePath === undefined);

    EditorView.setFiles(this.files);
    this.showInkFile(this.mainInk);

    // Wait for all project files to be found before starting first compilation
    this.ready = false;

    // Make sure a project save is atomic   
    this.saveActive = false;

    this.startFileWatching();
}

InkProject.prototype.createInkFile = function(anyPath, isBrandNew, loadErrorCallback) {
    var inkFile = new InkFile(anyPath || null, this.mainInk, isBrandNew, this.inkMode, {
        fileChanged: () => { 
            if( inkFile.hasUnsavedChanges && !this.unsavedFiles.contains(inkFile) ) {
                this.unsavedFiles.push(inkFile);
                this.refreshUnsavedChanges();
            }

            // When a file is changed its state may change to have unsaved changes,
            // which should be reflected in the sidebar (unsaved files are bold).
            // Newly added INCLUDE lines get the callback includesChanged, below.
            this.refreshIncludes();
        },

        // Called when InkFile finds an INCUDE line in the contents of the file
        includesChanged: () => {         
            this.refreshIncludes();
            if( inkFile.includes.length > 0  )
                NavView.initialShow();
        },

        loadError: err => {
            if( loadErrorCallback )
                loadErrorCallback(err);
        }


    });

    this.files.push(inkFile);

    this.sortFileList();
    
    return inkFile;
}

InkProject.prototype.addNewInclude = function(newIncludePath, addToMainInk) {

    // Convert new include path to relative if it's not already
    if( path.isAbsolute(newIncludePath) ) {
        assert(this.mainInkFile.projectDir, "Main ink needs to be saved before we start loading includes with absolute paths.");
        newIncludePath = path.relative(this.mainInk.projectDir, newIncludePath);
    }

    // Make sure it doesn't already exist
    var alreadyExists = _.some(this.files, (f) => f.relativePath() == newIncludePath);
    if( alreadyExists ) {
        alert(`${i18n._("Could not create new include file at")} ${newIncludePath} ${i18n._("because it already exists!")}`);
        return null;
    }

    var newIncludeFile = this.createInkFile(newIncludePath || null, isBrandNew = true);

    if( addToMainInk )
        this.mainInk.addIncludeLine(newIncludeFile.relativePath());

    NavView.setFiles(this.mainInk, this.files);
    EditorView.setFiles(this.files);
    return newIncludeFile;
}

// - Load any newly discovered includes
// - Refresh nav hierarchy in sidebar
InkProject.prototype.refreshIncludes = function() {

    var existingRelFilePaths = _.map(_.without(this.files, this.mainInk), f => f.relativePath());

    var relPathsFromINCLUDEs = [];
    var addIncludePathsFromFile = (inkFile) => {
        if( inkFile.includes.length == 0 )
            return;

        inkFile.includes.forEach(incPath => {
            
            // fix include relative path on windows
            // on windows path should be either always stored using the same folder separator (\\ or /).
            // mixing them can create unexpected behaviours.
            incPath = path.format(path.parse(incPath));

            let alreadyDone = relPathsFromINCLUDEs.contains(incPath);

            relPathsFromINCLUDEs.push(incPath);

            var recurseInkFile = this.inkFileWithRelativePath(incPath);
            if( recurseInkFile && !alreadyDone )
                addIncludePathsFromFile(recurseInkFile);
        });
    }
    addIncludePathsFromFile(this.mainInk);

    // Includes that we don't have in this.files yet that are mentioned in other files
    var includeRelPathsToLoad = _.difference(relPathsFromINCLUDEs, existingRelFilePaths)

    // Files that are in this.files that aren't actually mentioned anywhere
    var spareRelFilePaths = _.difference(existingRelFilePaths,  relPathsFromINCLUDEs);

    // Mark files that are spare, so they go in a special category at the bottom
    this.files.forEach(f => {
        f.isSpare = spareRelFilePaths.indexOf(f.relativePath()) != -1;
    });

    // Load up newly mentioned include files, if they exist
    if( this.mainInk.projectDir ) {
        includeRelPathsToLoad.forEach(newIncludeRelPath => {
            let absPath = path.join(this.mainInk.projectDir, newIncludeRelPath);
            fs.stat(absPath, (err, stats) => {
                // If it exists, and double check that it hasn't already been created during the async fs.stat
                if( !!stats && stats.isFile() &&  !_.some(this.files, f => f.relativePath() == newIncludeRelPath) ) {
                    let newFile = this.createInkFile(newIncludeRelPath, isBrandNew = false, err => {
                        alert(`${i18n._("Failed to load ink file:")} ${err}`);
                        this.files.remove(newFile);
                        this.refreshIncludes();
                    });
                }
            });
            
        });

        this.sortFileList();
    }

    NavView.setFiles(this.mainInk, this.files);
    EditorView.setFiles(this.files);
    LiveCompiler.setEdited();
}

InkProject.prototype.sortFileList = function() {
    var mainInkFile = this.mainInk;
    this.files.sort(function(a,b) {
        return mainInkFile.includes.indexOf(a.relPath) - mainInkFile.includes.indexOf(b.relPath) 
    } );
}

InkProject.prototype.refreshUnsavedChanges = function() {

    this.hasUnsavedChanges = this.unsavedFiles.length > 0;

    // Update NavView for whether files are bold or not
    // TODO: This could be faster if it simply refreshes the state rather than
    // rebuilding the entire nav view hierarchy
    NavView.setFiles(this.mainInk, this.files);

    // Overall, are there *any* unsaved changes, and has the state changed?
    // Change the dot in the Mac close window button
    ipcRenderer.send("change-mac-dot", this.hasUnsavedChanges);
}

InkProject.prototype.startFileWatching = function() {
    if( !this.mainInk.projectDir ) {
        this.ready = true;
        return;
    }

    if( this.fileWatcher )
        this.fileWatcher.close();

    this.fileWatcher = chokidar.watch(this.mainInk.projectDir, {
        disableGlobbing: true
    });

    const isInkFile = fileAbsPath => {
        return fileAbsPath.split(".").pop() == "ink";
    };

    const tryUpdateSettingsFile = fileAbsPath => {
        const mainInkPath = this.mainInk.absolutePath();
        const expectedSettingsPath = ProjectSettings.filename(mainInkPath);
        if( expectedSettingsPath != fileAbsPath ) {
            return false; // not a settings file
        }

        ipcRenderer.send("project-settings-needs-reload", mainInkPath);

        return true; // yes, it was a settings file
    }

    this.fileWatcher.on("add", newlyFoundAbsFilePath => {
        if( this.saveActive ) return; // ignore file watching while atomic save is active
        if( tryUpdateSettingsFile(newlyFoundAbsFilePath) ) return;
        if (!isInkFile(newlyFoundAbsFilePath)) { return; }

        var relPath = path.relative(this.mainInk.projectDir, newlyFoundAbsFilePath);
        var existingFile = _.find(this.files, f => f.relativePath() == relPath);
        if( !existingFile ) {
            console.log("Watch found new file - creating it: "+relPath);

            let newFile = this.createInkFile(newlyFoundAbsFilePath, isBrandNew = false, err => {
                alert(`${i18n._("Failed to load ink file:")} ${err}`);
                this.files.remove(newFile);
                this.refreshIncludes();
            });

            // TODO: Find a way to refresh includes without spamming it
            this.refreshIncludes();
        } else {
            console.log("Watch found file but it already existed: "+relPath);
        }
    });

    this.fileWatcher.on("change", updatedAbsFilePath => {
        if( this.saveActive ) return; // ignore file watching while atomic save is active
        if( tryUpdateSettingsFile(updatedAbsFilePath) ) return;
        if (!isInkFile(updatedAbsFilePath)) { return; }

        var relPath = path.relative(this.mainInk.projectDir, updatedAbsFilePath);
        var inkFile = _.find(this.files, f => f.relativePath() == relPath);
        if( inkFile ) {
            // TODO: maybe ask user if they want to overwrite? not sure I want to though
            if( !inkFile.hasUnsavedChanges ) {

                if( this.activeInkFile == inkFile )
                    EditorView.saveCursorPos();

                inkFile.tryLoadFromDisk(err => {
                    if( !err && this.activeInkFile == inkFile )
                        setImmediate(() => EditorView.restoreCursorPos());
                });
            }
        }
    });
    this.fileWatcher.on("unlink", removedAbsFilePath => {
        if( this.saveActive ) return; // ignore file watching while atomic save is active
        if( tryUpdateSettingsFile(removedAbsFilePath) ) return;
        if (!isInkFile(removedAbsFilePath)) { return; }

        var relPath = path.relative(this.mainInk.projectDir, removedAbsFilePath);
        var inkFile = _.find(this.files, f => f.relativePath() == relPath);
        if( inkFile ) {
            if( !inkFile.hasUnsavedChanges && inkFile != this.mainInk ) {
                this.deleteInkFile(inkFile);
            }
        }
    });

    this.fileWatcher.on("ready", () => this.ready = true);
}

InkProject.prototype.showInkFile = function(inkFile) {

    if( _.isString(inkFile) )
        inkFile = this.inkFileWithRelativePath(inkFile);

    if( inkFile && inkFile != this.activeInkFile ) {
        if( this.activeInkFile )
            this.activeInkFile.isActive = false;

        this.activeInkFile = inkFile;

        if( this.activeInkFile )
            this.activeInkFile.isActive = true;

        EditorView.showInkFile(inkFile);
        InkProject.events.didSwitchToInkFile(this.activeInkFile);
    }
}

InkProject.prototype.save = function() {

    // Make saving atomic, don't save again if we're already saving
    if( this.saveActive ) return;
    this.saveActive = true;

    var wasUnsaved = !this.mainInk.projectDir;

    var filesRemaining = this.files.length;
    var includeFiles = _.filter(this.files, f => f != this.mainInk);

    var allSuccess = true;

    var singleFileSaveComplete = (file, success) => {
        allSuccess = allSuccess && success;
        if( success ) this.unsavedFiles.remove(file);

        filesRemaining--;
        if( filesRemaining == 0 ) {
            this.refreshUnsavedChanges();

            if( allSuccess )
                InkProject.events.didSave();

            this.saveActive = false;
        }
    }

    // Save main ink to ensure the other files have a base directory path
    this.mainInk.save(success => {
        singleFileSaveComplete(this.mainInk, success);

        ipcRenderer.send("main-file-saved", this.mainInk.absolutePath());

        // May not be a success if cancelled, in which case we stop early
        if( success ) {

            if( wasUnsaved ) this.startFileWatching();

            includeFiles.forEach(f => f.save(success => singleFileSaveComplete(f, success)));
        } 
        
        // Cancel the save process because main ink file save failed
        else {
            this.saveActive = false;
        }
    });
}

// JSON export suggestions are independent of the saved web-export association.
InkProject.prototype.export = function(exportType, webExport = {}) {
    if( !this.ready ) {
        alert(i18n._('Project not quite fully loaded! Please try exporting again in a couple of seconds...'));
        return;
    }
    LiveCompiler.exportJson(exportType != 'json', async (err, compiledJsonTempPath) => {
        if( err ) { alert(`${i18n._('Could not export:')} ${err}`); return; }
        try {
            let target;
            if( exportType == 'web' ) {
                const result = await ipcRenderer.invoke('showOpenDialog', {
                    title: i18n._('Export game to folder'),
                    buttonLabel: i18n._('Export'),
                    defaultPath: webExport.directory || (this.mainInk.projectDir && path.join(this.mainInk.projectDir, 'web')),
                    properties: ['openDirectory', 'createDirectory']
                });
                if( result.canceled ) return;
                target = result.filePaths[0];
                const mainInkPath = this.mainInk.absolutePath();
                if( mainInkPath && WebTemplates.contains(path.resolve(target), mainInkPath) ) {
                    throw new Error(i18n._('Create or select a separate output folder, such as a web subfolder. The export folder must not contain your Ink source.'));
                }
                const template = webExport.template || null;
                const script = await this.buildForWeb(compiledJsonTempPath, target, template);
                await ipcRenderer.invoke('web-export-complete', target, script);
            } else if( exportType == 'js' ) {
                const result = await ipcRenderer.invoke('showOpenDialog', {
                    title: i18n._('Choose the existing story script to update'),
                    buttonLabel: i18n._('Update story content'),
                    defaultPath: webExport.directory && webExport.script
                        ? path.join(webExport.directory, webExport.script) : this.mainInk.projectDir,
                    properties: ['openFile'],
                    filters: [{ name: i18n._('JavaScript files'), extensions: ['js'] }]
                });
                if( result.canceled ) return;
                target = result.filePaths[0];
                const stat = await fs.promises.lstat(target);
                if( !stat.isFile() ) throw new Error(i18n._('Choose an existing, regular story script file.'));
                await this.convertJSONToJS(compiledJsonTempPath, target);
            } else {
                const result = await ipcRenderer.invoke('showSaveDialog', {
                    defaultPath: this.defaultJSONExportPath || (this.mainInk.absolutePath() || 'Untitled.ink').replace(/\.ink$/, '') + '.json',
                    filters: [{ name: i18n._('JSON files'), extensions: ['json'] }]
                });
                if( result.canceled || !result.filePath ) return;
                target = result.filePath;
                await WebTemplates.rejectDestinationSymlink(target);
                await fs.promises.copyFile(compiledJsonTempPath, target);
                this.defaultJSONExportPath = target;
            }
        } catch(error) {
            alert(`${i18n._('Could not export:')} ${error.message}`);
        }
    });
}

InkProject.prototype.exportJson = function() {
    this.export('json');
}

InkProject.prototype.exportForWeb = function(webExport) {
    this.export('web', webExport);
}

InkProject.prototype.exportJSOnly = function(webExport) {
    this.export('js', webExport);
}

InkProject.prototype.jsFilename = function() {
    // Derive story content js file from root ink filename
    // Remove .ink extension if it's ".ink"
    var mainInkRootName = this.mainInk.filename();
    if( path.extname(mainInkRootName) == ".ink" )
        mainInkRootName = path.basename(mainInkRootName, ".ink");
    var jsContentFilename = mainInkRootName+".js";

    // Avoid naming collision with our own main.js
    // (if user chose "main.ink" for their root ink)
    if( jsContentFilename == "main.js" ) {
        jsContentFilename = "story.js";
    }

    return jsContentFilename;
}

// Convert JSON to JS file with "var storyContent = "
InkProject.prototype.convertJSONToJS = async function(jsonFilePath, targetJSPath) {
    const jsonContent = await fs.promises.readFile(jsonFilePath, "utf8");
    await fs.promises.writeFile(targetJSPath, `var storyContent = ${jsonContent};`, "utf8");
}

InkProject.prototype.buildForWeb = async function(jsonFilePath, targetDirectory, templateDirectory = null) {
    let templateDir = path.join(__dirname, "../../templates/classic");
    if( templateDirectory ) {
        try { templateDir = await WebTemplates.validateDirectory(templateDirectory); }
        catch(error) {
            throw new Error(i18n._('The web template is unavailable. Choose its folder again or select Classic (built-in).') + '\n' + error.message);
        }
    }
    const jsFilename = templateDirectory ? "story.js" : this.jsFilename();

    var storyTitle = path.basename(targetDirectory);
    var mainInkTagDict = this.mainInk.symbols.globalDictionaryStyleTags;
    if( mainInkTagDict && mainInkTagDict["title"] ) {
        storyTitle = mainInkTagDict["title"];
    }
    const html = (await fs.promises.readFile(path.join(templateDir, "index.html"), "utf8"))
        .replace(/##STORY TITLE##/g, () => storyTitle)
        .replace(/##JAVASCRIPT FILENAME##/g, () => jsFilename);

    await WebTemplates.copyDirectory(templateDir, targetDirectory, [jsFilename, "ink.js", "index.html"]);
    await this.convertJSONToJS(jsonFilePath, path.join(targetDirectory, jsFilename));
    await fs.promises.copyFile(path.join(__dirname, "../node_modules/inkjs/dist/ink.js"), path.join(targetDirectory, "ink.js"));
    await fs.promises.writeFile(path.join(targetDirectory, "index.html"), html, "utf8");
    return jsFilename;
}

InkProject.prototype.tryClose = function() {
    if( this.hasUnsavedChanges ) {
        ipcRenderer.invoke("try-close").then((responseObject) => {
            var response = responseObject.response;
            if( response == 0 ) {
                this.save(false, () => {
                    this.closeImmediate();
                });
            }
            
            // Don't save
            else if( response == 1 ) {
                this.closeImmediate();
            }
            
            // Cancel
            else { 
                ipcRenderer.send("project-cancelled-close");
            }
            })
    }
    // Nothing to save, just exit
    else {
        this.closeImmediate();
    }
}

// Response from the close menu


InkProject.prototype.closeImmediate = function() {
    ipcRenderer.send("project-final-close");
}

InkProject.prototype.inkFileWithRelativePath = function(relativePath) {
    return _.find(this.files, f => f.relativePath().replace('\\', '/') == relativePath);
}

InkProject.prototype.inkFileWithId = function(id) {
    return _.find(this.files, f => f.id == id);
}

InkProject.prototype.deleteInkFile = function(inkFile) {

    if( this.activeInkFile == inkFile )
        this.showInkFile(this.mainInk);

    inkFile.deleteFromDisk();

    this.files.remove(inkFile);

    NavView.setFiles(this.mainInk, this.files);
    EditorView.setFiles(this.files);
}

InkProject.prototype.findSymbol = function(name, posContext) {

    // Name components
    var nameComps = name.split(".");
    var baseName = nameComps[0];
    var tailNameComps = nameComps.slice(1);

    // Find starting symbol based on the context
    var symbolContext = this.activeInkFile.symbols.symbolAtPos(posContext);

    // Helper function to search downward into a symbol to find a single name
    function findWithinSymbolDeep(withinSymbol, targetName) {
        if( withinSymbol.innerSymbols ) {
            var foundSym = withinSymbol.innerSymbols[targetName];
            if( foundSym ) {
                return foundSym;
            } else {
                for(var innerSymName in withinSymbol.innerSymbols) {
                    foundSym = findWithinSymbolDeep(withinSymbol.innerSymbols[innerSymName])
                    if( foundSym )
                        return foundSym;
                }
            }
        }
    }

    // Try searching towards leaves first
    var baseSymbol = findWithinSymbolDeep(symbolContext, baseName);

    // Otherwise, work our way up to a broader and broader scope to
    // find the a symbol that contains the base name we're looking for
    if( !baseSymbol ) {
        while(symbolContext) {
            if( symbolContext.innerSymbols ) {
                var found = symbolContext.innerSymbols[baseName];
                if( found ) {
                    baseSymbol = found;
                    break;
                }
            }
            symbolContext = symbolContext.parent;
        }
    }

    // Finally, try to search within all files scope
    if( !baseSymbol ) {

        // Collect all symbols
        var allSymbols = {};
        for(var i=0; i<this.files.length; i++) {
            var file = this.files[i];
            var fileSymbols = file.symbols.getSymbols();
            var found = fileSymbols[baseName];
            if( found ) {
                baseSymbol = found;
                break;
            }
        }
    }
    
    if( !baseSymbol ) {
        console.log("Failed to find base symbol: "+baseName);
        return null;
    }

    // Resolve the rest of the path
    var symbol = baseSymbol;
    for(var i=0; i<tailNameComps.length; i++) {
        var tailComp = tailNameComps[i];
        var tailSymbol = findWithinSymbolDeep(symbol, tailComp);
        if( !tailSymbol ) {
            console.log("Failed to find complete path due to not finding: "+tailComp);
            return symbol;
        }
        
        symbol = tailSymbol;
    }

    console.log("Found "+symbol.name);
    return symbol;
}


InkProject.prototype.refreshProjectSettings = function(newProjectSettings) {
    if( this.instructionPrefix != newProjectSettings.instructionPrefix ) {
        this.instructionPrefix = newProjectSettings.instructionPrefix;

        PlayerView.setInstructionPrefix(this.instructionPrefix);
        
        // Refresh the InkMode, which affects syntax highlighting.
        // This allows users to customise the "instructionPrefix", which
        // is the game-specific convension to use something like ">>> CAMERA: Wide angle"
        this.inkMode = new InkMode(this.instructionPrefix);

        for(let inkFile of this.files) {
            inkFile.setInkMode(this.inkMode);
        }
    }
}


InkProject.setEvents = function(e) {
    InkProject.events = e;
}

InkProject.startNew = function() {
    InkProject.setProject(new InkProject());
}

InkProject.loadProject = function(mainInkPath) {
    InkProject.setProject(new InkProject(mainInkPath));
}

InkProject.setProject = function(project) {
    InkProject.currentProject = project;
    InkProject.events.newProject(project);
}

ipcRenderer.on("set-project-main-ink-filepath", (event, filePath) => {
    InkProject.loadProject(filePath);
});

ipcRenderer.on("open-main-ink", (event) => {
    if( InkProject.currentProject ) {
        InkProject.currentProject.showInkFile(InkProject.currentProject.mainInk);
    }
});

ipcRenderer.on("project-new-include", () => {
    if( InkProject.currentProject ) {
        NavView.show();
        NavView.showAddIncludeForm();
    }
});

ipcRenderer.on("project-save", (event) => {
    if( InkProject.currentProject ) {
        InkProject.currentProject.save();
    }
});

ipcRenderer.on("project-export", (event) => {
    if( InkProject.currentProject ) {
        InkProject.currentProject.exportJson();
    }
});

ipcRenderer.on("project-export-for-web", (event, webExport) => {
    if( InkProject.currentProject ) {
        InkProject.currentProject.exportForWeb(webExport);
    }
});

ipcRenderer.on("project-export-js-only", (event, webExport) => {
    if( InkProject.currentProject ) {
        InkProject.currentProject.exportJSOnly(webExport);
    }
});

ipcRenderer.on("project-tryClose", (event) => {
    if( InkProject.currentProject ) {
        InkProject.currentProject.tryClose();
    }
});

ipcRenderer.on("project-settings-changed", (event, settings) => {
    if( InkProject.currentProject ) {
        InkProject.currentProject.refreshProjectSettings(settings);
    }
});


exports.InkProject = InkProject;
