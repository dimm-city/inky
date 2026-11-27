# Dimm City

An illustrated Dimm City reader with a dark palette, dialogue cards, scene
images/captions, choices and authored endings. It includes Begin/Continue,
spoiler-free transcript, rewind, save/load and restart.

Select this directory with **File → Web template → Choose template folder…**, or
copy it into Inky's global templates folder and select `dimm-city` from the menu.
Use **Export for web…**, then open the generated `index.html` in a browser.

Edit `theme.css` for colors and `base.css` for layout. The included `cover.png`
is decorative background art and can also be used as an `IMAGE: cover.png`
with authored ALT and scene_description tags. This version includes no narration
recordings; optional audio controls stay hidden. The player reads Inky's standard
`storyContent` payload, so content-only `story.js` updates work too.

Save identity uses SHA-256 of compiled content plus the fixed random seed 1;
style changes preserve it. The browser must support Web Crypto (HTTPS or a
supported local-file context); browser storage failures are shown in the player.

See [SOURCES.md](SOURCES.md), `inkjs-LICENSE.md` and the notices under `fonts/`
for provenance and redistribution details. Keep those notices with the template.
