/* Shared by the packager and browser: Ink tag strings are a project contract. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DimmInkContract = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function tags(values) {
    const result = Object.create(null);
    for (const raw of values) {
      if (typeof raw !== 'string') throw new Error('Ink tags must be strings.');
      const at = raw.indexOf(':');
      const key = (at < 0 ? raw : raw.slice(0, at)).trim().toLowerCase();
      if (key) result[key] = at < 0 ? '' : raw.slice(at + 1).trim();
    }
    return result;
  }
  function line(text, values) {
    const meta = tags(values);
    return { text: text.trim(), tags: [...values], id: meta.id || '', speaker: meta.speaker || 'Narrator' };
  }
  function context(lines, position) {
    const result = { scene: 'The city is listening', scene_description: '', image: '', alt: '', decision_context: 'The next move is yours.', ending_title: 'A mark on the city', ending_description: 'This route is complete.' };
    for (let i = 0; i <= Math.min(position, lines.length - 1); i++) {
      const meta = tags(lines[i].tags);
      if (meta.scene && meta.scene !== result.scene) {
        result.scene_description = ''; result.image = ''; result.alt = '';
        result.decision_context = 'The next move is yours.';
      }
      for (const key of Object.keys(result)) if (Object.hasOwn(meta, key)) result[key] = meta[key];
    }
    return result;
  }
  function createStory(Story, content, seed = 1) {
    const story = new Story(content);
    story.state.storySeed = seed;
    story.state.previousRandom = 0;
    story.onError = message => { throw new Error(message); };
    return story;
  }
  return { tags, line, context, createStory };
});
