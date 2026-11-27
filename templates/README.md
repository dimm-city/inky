# Web templates

Templates are standalone directories, separate from Inky's core application.

| Template | Download | Description |
| --- | --- | --- |
| [Classic](classic/) | [Release ZIP](https://github.com/dimm-city/inky/releases/latest/download/inky-template-classic.zip) | The original web player, used automatically when Default is selected. |

## Download and use

Download the template ZIP from the catalog and extract it. The archive contains
one `classic/` folder with `index.html` and its assets; no repository checkout or
package installation is needed.

The release download becomes available after the first release containing
`inky-template-classic.zip` is published. For an unreleased source snapshot, use
the `templates/classic` folder directly, download the repository ZIP from its Code
menu and extract that folder, or create the template ZIP locally as described below.
Templates from other authors use the same directory format.

1. **File → Web template → Open templates folder** opens Inky's global template
   library: the `templates` directory inside your per-user application data.
   Copy each downloaded template into its own subfolder there. Select **Refresh
   templates**, or return to the Inky window, to refresh the menu.
2. Select an installed folder under **File → Web template**, or use **Choose
   template folder…** to select a template from any other accessible location.
3. Choose **File → Export for web…**, then open the exported `index.html` in your
   browser.

**Default** clears the selection and uses the built-in Classic template.
Selection applies to the current window; new windows start with Default. An
unavailable or invalid selected directory reports an error without silently
switching designs. The native play-as-you-write pane keeps its existing
presentation.

Template files are copied into the export, not executed by Inky. Installing a
template does not run installation scripts. Keep sources in a dedicated folder
separate from output. Full exports overwrite template files but preserve unrelated
destination files. Edit source HTML/CSS and export again after template changes;
keep manual edits to generated files separately. Browser saves depend on the
player and file location.

**Export story.js only…** updates story content without replacing the design.
Select the same template and target its existing exported story script. Re-export
the full folder when layout or assets change.

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
files and output directories outside the template. Nested symlinks are rejected.
Use local browser-compatible script/resource references for offline play; no
server is started by Inky. Export to a separate folder and keep edits in the
template sources. JSON export and the native testing pane are unchanged.

## Development

`templates/classic` is the single source of the default player. Packaged apps
copy this `templates` directory into their resources folder; development builds
read it directly from the repository.

With Node.js 20 or newer, run `node app/test/web-templates.test.cjs` from the
repository root for the template filesystem checks.

The Linux release job packages Classic from the checked-out commit and attaches
`inky-template-classic.zip` using the existing release upload step. To create the
same archive locally without building the app, run from the repository root:

```sh
mkdir -p ReleaseUpload
git archive --format=zip --prefix=classic/ --output=ReleaseUpload/inky-template-classic.zip HEAD:templates/classic
```

This packages committed source files, so commit template edits before running it.
