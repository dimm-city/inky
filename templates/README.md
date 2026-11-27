# Web templates

Templates are standalone directories, separate from Inky's core application.

| Template | Description |
| --- | --- |
| [Dimm City](dimm-city/README.md) | Illustrated dark reader with dialogue, choices, transcript, rewind and save/load. |

## Download and use

Download this repository as a ZIP from its Code menu, extract it, and use the
individual folder under `templates/`, not the entire repository. You can also
download a template from another author or create your own.

Open **File → Web template → Open templates folder** in Inky and copy a template
folder into that global library. Select **Refresh templates**, then select its
folder name in the Web template menu. Alternatively, **Choose template folder…**
can select the extracted folder directly from any accessible location.

Choose **Export for web…** to build your story, then open its `index.html` in a
browser. **Default** clears the selection and restores the built-in template.
An unavailable or invalid selected directory reports an error; it does not
silently switch designs. Installing a template does not run installation scripts.

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

Content-only updates can use **Export story.js only…**, targeting the existing
exported story script. Re-export the full web folder when assets or layout change.
