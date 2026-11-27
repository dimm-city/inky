/* Cinematic Ink reader. Narration follows the displayed frame, never prefetched output. */
(async () => {
  'use strict';
  const content = window.storyContent, seed = 1;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ content, seed })));
  const id = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  const game = { id, seed, content, media: { 'cover.png': 'cover.png' }, audio: {}, narrationCoverage: null };
  const contract = window.DimmInkContract;
  const ui = Object.fromEntries(['title','subtitle','description','cover-description','author','footer-title','intro','reader','scene','scene-figure','scene-image','scene-description','scene-caption','speaker','speaker-caption','story-card','passages','choices','decision-panel','decision-context','ending-panel','ending-title','ending-description','status','begin','continue','rewind','save','load','restart','again','transcript-open','transcript-modal','transcript-close','transcript-lines','ending-transcript','sound-toggle','voice-controls','voice-status','voice-time','voice-progress','voice-play','narration'].map(id => [id, document.getElementById(id)]));
  const storageKey = `dimm-ink:${game.id}`;
  const audio = ui.narration;
  const recordings = game.audio || {};
  const hasNarration = Object.keys(recordings).length > 0;
  let story, lines = [], history = [], frame = 0;
  let started = false, busy = false, failed = false, soundOn = true, audioTicket = 0;

  function status(message, error = false) {
    ui.status.textContent = message;
    ui.status.toggleAttribute('data-error', error);
  }
  function createStory() {
    const next = contract.createStory(inkjs.Story, game.content, game.seed ?? 1);
    // Bind real externals here if extending the host. Bundled stories have none.
    return next;
  }
  function hasSave() {
    try { return localStorage.getItem(storageKey) !== null; }
    catch { return false; }
  }
  function updateControls() {
    ui.begin.disabled = busy;
    ui.continue.disabled = busy || failed;
    ui.restart.disabled = busy || !started;
    ui.save.disabled = busy || failed || !started;
    ui.rewind.disabled = busy || !history.length;
    ui.load.disabled = busy || !hasSave();
    ui.again.disabled = busy;
    for (const button of ui.choices.querySelectorAll('button')) button.disabled = busy || failed;
  }
  function snapshot() { return { state: story.state.ToJson(), lines: structuredClone(lines), frame }; }
  function nextFrame(from) {
    for (let i = from; i < lines.length; i++) if (lines[i].text || contract.tags(lines[i].tags).image) return i;
    return lines.length;
  }
  function stopVoice() {
    audioTicket++;
    audio.pause();
    audio.removeAttribute('src');
    audio.removeAttribute('data-line-id');
    audio.load();
    ui['voice-progress'].value = 0;
    ui['voice-time'].textContent = '';
  }
  function voiceStatus(message, button) {
    ui['voice-status'].textContent = message;
    if (button) ui['voice-play'].textContent = button;
  }
  function playVoice() {
    if (!soundOn || !started || frame >= lines.length || !audio.getAttribute('src')) return;
    const ticket = audioTicket;
    const attempt = audio.play();
    if (attempt && attempt.catch) attempt.catch(error => {
      if (ticket !== audioTicket || error.name === 'AbortError') return;
      voiceStatus(error.name === 'NotAllowedError' ? 'Press Play narration to listen.' : 'Narration unavailable. You can keep reading.', 'Play narration');
    });
  }
  function configureVoice(line, autoplay) {
    const record = recordings[line.id];
    ui['voice-controls'].hidden = !record;
    if (!record) {
      if (game.narrationCoverage === 'complete' && line.text) throw new Error(`Missing narration for ${line.id || 'an untagged line'}.`);
      return;
    }
    if (record.text !== line.text || record.speaker !== line.speaker) throw new Error(`Narration no longer matches ${line.id}. Rebuild from reviewed words and recordings.`);
    audio.src = record.src;
    audio.dataset.lineId = line.id;
    voiceStatus(soundOn ? 'Narration ready.' : 'Sound is off.', 'Play narration');
    if (autoplay && soundOn) playVoice();
  }
  function paragraph(line) {
    const p = document.createElement('p');
    for (const token of (contract.tags(line.tags).class || '').split(/\s+/).filter(Boolean)) if (/^[a-zA-Z_][\w-]*$/.test(token)) p.classList.add(token);
    p.textContent = line.text;
    return p;
  }
  function setScene(context) {
    ui.scene.textContent = context.scene;
    ui['scene-description'].textContent = context.scene_description;
    ui['scene-caption'].textContent = context.scene_description;
    ui['scene-figure'].hidden = !context.image;
    ui['scene-caption'].hidden = !!context.image || !context.scene_description;
    if (context.image) {
      if (!Object.hasOwn(game.media, context.image)) throw new Error(`Image not bundled: ${context.image}.`);
      ui['scene-image'].src = game.media[context.image];
      ui['scene-image'].alt = context.alt;
    } else ui['scene-image'].removeAttribute('src');
  }
  function render(focus = false, autoplay = true) {
    stopVoice();
    document.body.dataset.phase = started ? 'play' : 'intro';
    ui.intro.hidden = started; ui.reader.hidden = !started;
    ui['transcript-open'].hidden = !started;
    ui['voice-controls'].hidden = true;
    ui.choices.replaceChildren();
    if (!started) { updateControls(); return; }
    const reading = frame < lines.length;
    const choosing = !reading && story.currentChoices.length > 0;
    ui['story-card'].hidden = !reading;
    ui['decision-panel'].hidden = !choosing;
    ui['ending-panel'].hidden = reading || choosing;
    const context = contract.context(lines, frame);
    setScene(context);
    ui['decision-context'].textContent = context.decision_context;
    ui['ending-title'].textContent = context.ending_title;
    ui['ending-description'].textContent = context.ending_description;
    if (reading) {
      const line = lines[frame], meta = contract.tags(line.tags);
      ui.speaker.textContent = line.speaker;
      ui['speaker-caption'].textContent = meta.speaker_caption || '';
      ui['speaker-caption'].hidden = !meta.speaker_caption;
      ui['story-card'].dataset.speaker = line.speaker;
      ui['story-card'].dataset.lineId = line.id;
      ui.passages.replaceChildren();
      if (line.text) ui.passages.append(paragraph(line));
      configureVoice(line, autoplay);
    } else if (choosing) {
      for (const choice of story.currentChoices) {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'choice'; button.textContent = choice.text;
        const meta = contract.tags(choice.tags || []);
        if (meta.choice_id) button.dataset.choiceId = meta.choice_id;
        button.addEventListener('click', () => choose(choice.index));
        ui.choices.append(button);
      }
    }
    updateControls();
    if (focus) (reading ? ui.continue : choosing ? ui.choices.querySelector('button') : ui['ending-title']).focus({ preventScroll: true });
  }
  function fail(error) {
    stopVoice(); busy = false; failed = true; updateControls();
    status(`Story error: ${error.message}`, true);
  }
  async function advance() {
    stopVoice(); busy = true; updateControls();
    const first = lines.length;
    try {
      const deadline = performance.now() + 5000;
      let count = 0;
      while (story.canContinue) {
        story.ContinueAsync(16);
        while (!story.asyncContinueComplete) {
          if (performance.now() > deadline) throw new Error('Story did not reach a choice within five seconds. Check for a loop.');
          await new Promise(resolve => setTimeout(resolve, 0));
          story.ContinueAsync(16);
        }
        lines.push(contract.line(story.currentText || '', story.currentTags || []));
        if (++count > 2000 || performance.now() > deadline) throw new Error('Too much output before a choice. Check story flow.');
      }
      frame = nextFrame(first); busy = false; render(true); status('');
    } catch (error) { fail(error); }
  }
  function start() {
    if (busy) return;
    try { story = createStory(); lines = []; history = []; frame = 0; started = true; failed = false; void advance(); }
    catch (error) { fail(error); }
  }
  function choose(index) {
    if (busy || failed) return;
    try {
      history.push(snapshot()); if (history.length > 50) history.shift();
      story.ChooseChoiceIndex(index); void advance();
    } catch (error) { fail(error); }
  }
  function validateSnapshot(saved) {
    if (!saved || typeof saved.state !== 'string' || !Array.isArray(saved.lines)) throw new Error('Saved transcript is invalid.');
    const clean = saved.lines.map(line => {
      if (!line || typeof line.text !== 'string' || !Array.isArray(line.tags)) throw new Error('Saved transcript is invalid.');
      return contract.line(line.text, line.tags);
    });
    const position = saved.frame === undefined ? clean.length : saved.frame;
    if (!Number.isInteger(position) || position < 0 || position > clean.length) throw new Error('Saved reading position is invalid.');
    return { state: saved.state, lines: clean, frame: position };
  }
  function restore(saved) {
    const clean = validateSnapshot(saved), next = createStory();
    next.state.LoadJson(clean.state);
    story = next; lines = clean.lines; frame = clean.frame; started = true; failed = false;
    render(true, false); // Restored lines are ready to replay, not played unexpectedly.
  }
  function rewind() {
    if (busy || !history.length) return;
    try { restore(history[history.length - 1]); history.pop(); updateControls(); status('Returned to the previous choice.'); }
    catch (error) { fail(error); }
  }
  function showTranscript() {
    audio.pause(); ui['transcript-lines'].replaceChildren();
    for (const line of lines.slice(0, Math.min(frame + 1, lines.length))) {
      const meta = contract.tags(line.tags);
      if (!line.text && !meta.image) continue;
      const item = document.createElement('div'); item.className = 'transcript-line';
      if (meta.image && game.media[meta.image]) {
        const figure = document.createElement('figure'), img = document.createElement('img');
        img.className = 'story-image'; img.src = game.media[meta.image]; img.alt = meta.alt || '';
        figure.append(img);
        const caption = contract.context(lines, lines.indexOf(line)).scene_description;
        if (caption) { const text = document.createElement('figcaption'); text.textContent = caption; figure.append(text); }
        item.append(figure);
      }
      if (line.text) { const label = document.createElement('strong'); label.textContent = line.speaker; item.append(label, paragraph(line)); }
      ui['transcript-lines'].append(item);
    }
    ui['transcript-modal'].showModal();
  }
  ui.begin.addEventListener('click', start);
  ui.continue.addEventListener('click', () => {
    if (busy || failed) return;
    try { frame = nextFrame(frame + 1); render(true); status(''); }
    catch (error) { fail(error); }
  });
  ui.rewind.addEventListener('click', rewind);
  ui.again.addEventListener('click', () => history.length ? rewind() : start());
  ui.restart.addEventListener('click', () => {
    if (busy) return;
    if (ui['transcript-modal'].open) ui['transcript-modal'].close();
    lines = []; history = []; frame = 0; started = false; failed = false;
    render(); status(''); ui.begin.focus();
  });
  ui.save.addEventListener('click', () => {
    if (busy || failed || !started) return;
    try { localStorage.setItem(storageKey, JSON.stringify({ id: game.id, ...snapshot(), history })); updateControls(); status('Saved in this browser.'); }
    catch { status('Saving is unavailable in this browser or its storage is full.', true); }
  });
  ui.load.addEventListener('click', () => {
    if (busy) return;
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey));
      if (!saved || saved.id !== game.id || !Array.isArray(saved.history) || saved.history.length > 50) throw new Error('Saved story is incompatible.');
      const previous = saved.history.map(validateSnapshot);
      restore(saved); history = previous; updateControls(); status('Saved story loaded.');
    } catch (error) { status(`Could not load: ${error.message}`, true); }
  });
  ui['sound-toggle'].hidden = !hasNarration;
  ui['sound-toggle'].addEventListener('click', () => {
    soundOn = !soundOn;
    ui['sound-toggle'].textContent = soundOn ? 'Sound on' : 'Sound off';
    ui['sound-toggle'].setAttribute('aria-pressed', String(soundOn));
    if (!soundOn) { audio.pause(); voiceStatus('Sound is off.', 'Play narration'); }
    else playVoice();
  });
  ui['voice-play'].addEventListener('click', () => {
    if (!soundOn) { ui['sound-toggle'].click(); return; }
    if (!audio.paused) audio.pause();
    else { if (audio.ended) audio.currentTime = 0; playVoice(); }
  });
  audio.addEventListener('playing', () => voiceStatus('Playing narration.', 'Pause narration'));
  audio.addEventListener('pause', () => {
    if (!audio.getAttribute('src')) return;
    voiceStatus(soundOn ? (audio.ended ? 'Narration complete.' : 'Narration paused.') : 'Sound is off.', audio.ended ? 'Replay narration' : 'Play narration');
  });
  audio.addEventListener('ended', () => voiceStatus('Narration complete.', 'Replay narration'));
  audio.addEventListener('error', () => { if (audio.getAttribute('src')) voiceStatus('Narration unavailable. You can keep reading.', 'Play narration'); });
  audio.addEventListener('timeupdate', () => {
    if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
    ui['voice-progress'].value = Math.min(1, audio.currentTime / audio.duration);
    ui['voice-time'].textContent = `${Math.floor(audio.currentTime)}s / ${Math.ceil(audio.duration)}s`;
  });
  ui['transcript-open'].addEventListener('click', showTranscript);
  ui['ending-transcript'].addEventListener('click', showTranscript);
  ui['transcript-close'].addEventListener('click', () => ui['transcript-modal'].close());
  try {
    story = createStory();
    const meta = contract.tags(story.globalTags || []);
    ui.title.textContent = meta.display_title || meta.title || 'Dimm City story';
    ui['footer-title'].textContent = ui.title.textContent;
    document.title = meta.title || ui.title.textContent;
    ui.author.textContent = meta.author || '';
    ui.subtitle.textContent = meta.subtitle || ui.subtitle.textContent;
    ui.description.textContent = meta.description || ui.description.textContent;
    ui['cover-description'].textContent = meta.cover_description || '';
    ui['cover-description'].hidden = !meta.cover_description;
    render();
  } catch (error) { fail(error); }
})().catch(error => {
  const status = document.getElementById('status');
  status.textContent = `Story error: ${error.message}`;
  status.setAttribute('data-error', '');
});
