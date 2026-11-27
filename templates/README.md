# Web templates

Templates are standalone directories, separate from Inky's core application.

| Template | Description |
| --- | --- |
| [Classic](classic/) | Inky's original web player, selected by default. |

## Download and use

Classic is built into Inky; no download is needed. Other authors can distribute
templates as ZIP files. Extract the ZIP and locate the folder containing
`index.html` and the template's assets.

1. **File → Web template: … → Open template library** opens the `templates`
   directory inside your per-user application data. Copy downloaded templates into
   separate subfolders. Returning to Inky refreshes the list automatically.
2. Select a library entry, or use **Choose template folder…** to select a template
   from any accessible location. The File menu shows the selected name. Location
   suffixes distinguish generic or duplicate folder names.
3. Choose **File → Export for web…** and select a dedicated output folder, creating
   one in the native folder picker if needed. For a new export, the picker
   starts in your project folder: create and select a `web` subfolder. Do not
   select a folder containing your Ink source or template. Export copies the
   complete player, story and assets.
4. On the first export or a new destination, the completion dialog names the folder
   and offers **Open exported game**. The command is also available in File. Repeat
   exports to the same folder finish without another completion dialog.
5. Edit your story, **Export for web…** again to the preselected folder, then refresh
   its browser tab, or enable [live browser preview](#live-browser-preview) for automatic updates. Use the same full export after changing templates or artwork.

**Classic (built-in)** uses the original player without selecting a folder.
The native play-as-you-write pane keeps its existing presentation; the selected
web template is tested in the browser.

Template files are copied into the export, not executed by Inky. Installing a
template does not run installation scripts. Full exports overwrite template
files but preserve unrelated destination files; they do not prune obsolete assets.
Edit the template source and re-export rather than editing generated layout files.
Browser saves depend on the player, compiled content and file location.

## Live browser preview

Enable **File → Live browser preview** to open the selected template in your
browser. Inky saves any unsaved project first (an untitled story asks for its
filename), compiles it and opens one tab after the first successful export.

Saving the main story or an include automatically rebuilds and updates that tab.
Successful source changes from another editor are also detected, including
referenced includes outside the main directory. Unsaved typing alone is not
published. If a disk change conflicts with unsaved Inky edits, resolve it and
save the project to resume preview updates.

Preview uses a private temporary export served only on this computer. It does
not change your publishing folder or export preferences. Disabling the option
or closing the project stops the server and removes its temporary files. The
option starts disabled for each project session. It does not enable LAN/phone
access or watch template HTML, CSS, JavaScript or artwork. Changing the selected
template rebuilds and reloads the same preview tab.

Classic preserves compatible play progress and regenerates the current turn,
including updated prose and choice labels. Earlier displayed turns remain as
previously read. Structural edits can invalidate a checkpoint: the browser keeps
the running game and offers **Restart preview** to apply the new version from
the beginning. Progress retention is best effort, not a save-migration guarantee.
A compile error also keeps the last successful game; fix the source and save
again. Preview does not overwrite the player's browser saves.

Other templates reload normally unless their player implements the optional
update hook below; their own startup behavior determines progress after reload.
A template's Content Security Policy must allow its same-origin preview script
and EventSource connection. Inky does not relax template security policies.

### Supporting live story updates in a template

The local server injects a preview client before player startup. Normal exports
do not contain that client. A player can opt in without depending on preview:

```js
if (window.inkyPreview) {
    window.inkyPreview.accept(async compiledStory => {
        // Prepare a new inkjs.Story(compiledStory), restore a compatible
        // checkpoint, regenerate the current view, then commit the update.
        // Throw to retain the running game and offer Restart preview.
    });
}
```

The callback receives compiled Ink JSON and may return a promise. It owns its
runtime, external bindings, seed, buffered text, reading position, history and
media. Validate a candidate before replacing the working story; reject errors,
approximated paths or other incompatible state. Saving a pre-turn checkpoint
lets the player regenerate changed text and choices: loading only the state
after a menu was generated retains its old labels. Do not overwrite ordinary
release saves with temporary preview checkpoints. See [Classic's player](classic/main.js)
for a working implementation. Templates without the hook need no changes for
automatic reloads.

### Project preferences

Inky saves the template and last successful full-export association in the
existing `<main-story>.settings.json` beside the main Ink file. No manual JSON
editing is required. For example:

```json
{
    "webExport": {
        "template": "template",
        "directory": "web",
        "script": "story.js"
    }
}
```

`template` is a folder path or `null` for Classic. `directory` is the successful
export folder; `script` is the actual generated JavaScript filename, which can
be source-derived for Classic. Paths inside the project are stored relative to
the main Ink file; external paths remain absolute and machine-specific. Sharing
settings does not install an external template on another machine.

An untitled story keeps the choice for the session and stores it when first saved.
Other existing settings are preserved. If JSON is malformed or settings cannot be
written, Inky reports that the selection is session-only instead of overwriting
the file. Missing template folders remain selected and identifiable; choose their
new location or deliberately select Classic. A failed or canceled export retains
the last successful destination. JSON export uses its own file suggestion.

### Advanced: content-only updates

**Export story content only…** updates an existing JavaScript story file without
replacing the layout. Its picker starts at the exact script from the last full
export, regardless of the current template selection. Select the existing script
used by that game's HTML; this action does not create a new unreferenced file.
It can update an existing game when the template source is unavailable.

Use a full export to apply a different template, artwork or styles. Narration and
other assets are not regenerated by a content-only update. Keep manual changes
to generated files separately; template sources are the ordinary place to edit.

## Create a template

Create a dedicated folder containing:

- `index.html`, with local references to the player, CSS and any assets.
- Your browser player, which reads the global `storyContent` compiled Ink data.
- All required images, fonts, stylesheets, scripts and redistribution notices.

Inky supplies `ink.js` (its installed inkjs runtime) and `story.js` (the compiled
story) for custom templates. Do not include those generated files in the source
folder. A basic HTML shell can load them with:

```html
<script src="ink.js"></script>
<script src="story.js"></script>
<script src="player.js"></script>
```

The optional `##STORY TITLE##` and `##JAVASCRIPT FILENAME##` slots in `index.html`
are replaced at export. The filename slot also works with the built-in export's
historical naming. A player can instantiate `new inkjs.Story(storyContent)` and
implement its own presentation and storage. Inky does not prescribe player DOM
IDs, theme names, a metadata manifest or executable build hooks.

All source files and subdirectories are copied, including notices: keep private
files and output directories outside the template. Nested source symlinks and
destination symlinks, including the export folder itself, are rejected.
Use local browser-compatible script/resource references for offline play; no
server is started by Inky. Export to a separate folder and keep edits in the
template sources. JSON export and the native testing pane are unchanged.

## Development

`templates/classic` is the single source of the default player. Packaged apps
copy this `templates` directory into their resources folder; development builds
read it directly from the repository.

Run the filesystem, project-settings and workflow tests with the existing Mocha
runner (Node.js 20 or newer):

```sh
cd app
npm ci
npm test
```

The test workflow runs this command on Linux, macOS and Windows. It uses no
signing credentials and does not build or publish releases. Native dialogs and
OS browser launching still need app smoke tests on each platform.

`app/test/test.js` is the old Spectron application suite. Spectron is no longer
an installed dependency; that file is retained for a separate migration and is
not included in the unit-test command.

