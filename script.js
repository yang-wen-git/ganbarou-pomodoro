/* JS Script for Pomodoro Timer 
   Author: William Marklynn (Yang Wen-li) ウィリアム
   目次： 
   1. Config  
   2. State  
   3. Helpers  
   4. Timer  
   5. Controls
   6. Sound   
   7. Background  
   8. Startup
   Element ids (m25, go, bgFile, ...) come from index.html.
*/

(function () {
  'use strict';

  /*  1. Config 
     Change timer lengths and cycle behavior here.　タイマーやサイクルを変更するはこちらある。*/ 

  // [focus minutes, short break minutes] for each mode 作業・休憩モード選ぶ
  const MODES = { 25: [25, 5], 50: [50, 10] };

  // Long break minutes for each mode 長い休憩時間。モードによって変わる　
  const LONG_BREAK = { 25: 10, 50: 20 };

  const ROUNDS_PER_CYCLE = 4;

  // Text shown for each phase
  const LABEL = { focus: 'Focus', break: 'Break', long: 'Long break' };

  // Ring radius; must match the r attribute on the SVG circles
  const RADIUS = 110;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

  // localStorage keys:   pomo.mode  pomo.vol  pomo.auto  pomo.snd  pomo.sndName
  // IndexedDB:           database "pomo", store "kv", key "bg" (background image)


  /*  2. State */

  let mode = 25;                          // 25 or 50
  let phase = 'focus';                    // 'focus' | 'break' | 'long'
  let total = MODES[25][0] * 60;          // length of the current phase, in seconds
  let left = total;                       // seconds remaining in the current phase
  let running = false;
  let endAt = 0;                          // timestamp (ms) when the phase ends; makes the
                                          // countdown drift-free if the tab is throttled
  let tick = null;                        // setInterval id
  let done = 0;                           // focus rounds completed

  let customSound = null;                 // data URL of the uploaded sound, if any
  let audioCtx = null;                    // Web Audio context for the default chime
  let audioEl = null;                     // <audio> element for the uploaded sound


  /*  3. Helper functions */ 

  const $ = id => document.getElementById(id);

  // localStorage wrapper that never throws (private mode, blocked storage, full quota)
  const store = {
    get(key) {
      try { return localStorage.getItem(key); } catch (e) { return null; }
    },
    set(key, value) {
      try { localStorage.setItem(key, value); return true; } catch (e) { return false; }
    },
    del(key) {
      try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
    }
  };

  // Show a short status message under the settings; it clears itself after 4 seconds
  function say(text) {
    $('msg').textContent = text;
    if (text) {
      setTimeout(() => {
        if ($('msg').textContent === text) $('msg').textContent = '';
      }, 4000);
    }
  }

  // Seconds -> "MM:SS"
  function formatTime(seconds) {
    seconds = Math.max(0, Math.ceil(seconds));
    const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
    const ss = String(seconds % 60).padStart(2, '0');
    return mm + ':' + ss;
  }

  // Reads a File into a data URL
  function readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }


  /*   4. Timer */ 

  // Text under the dial: "Round 2 of 4" while focusing, "Round 2 of 4 done" on a break
  function roundLabel() {
    if (phase === 'focus') {
      return 'Round ' + (done % ROUNDS_PER_CYCLE + 1) + ' of ' + ROUNDS_PER_CYCLE;
    }
    if (done) {
      return 'Round ' + ((done - 1) % ROUNDS_PER_CYCLE + 1) + ' of ' + ROUNDS_PER_CYCLE + ' done';
    }
    return '';
  }

  // Update everything on screen from the current state
  function render() {
    $('time').textContent = formatTime(left);
    $('bar').style.strokeDashoffset = CIRCUMFERENCE * (1 - left / total);
    $('phase').textContent = LABEL[phase];
    $('count').textContent = roundLabel();
    $('go').textContent = running ? 'Pause' : (left < total ? 'Resume' : 'Start');

    // Break colors apply to both short and long breaks
    document.body.classList.toggle('break', phase !== 'focus');

    // Countdown in the tab title while running
    document.title = (running ? formatTime(left) + ' · ' : '') + LABEL[phase];

    $('m25').setAttribute('aria-pressed', mode === 25);
    $('m50').setAttribute('aria-pressed', mode === 50);
  }

  // Switch to a phase and load its full length
  function setPhase(next) {
    phase = next;
    const minutes =
      next === 'focus' ? MODES[mode][0] :
      next === 'break' ? MODES[mode][1] :
      LONG_BREAK[mode];
    total = minutes * 60;
    left = total;
  }

  function start() {
    unlockAudio();                        // browsers only allow sound after a user action
    running = true;
    endAt = Date.now() + left * 1000;
    clearInterval(tick);
    tick = setInterval(step, 250);
    render();
  }

  function stop() {
    running = false;
    clearInterval(tick);
    tick = null;
  }

  // Runs every 250 ms: recompute the time left from the clock
  function step() {
    left = (endAt - Date.now()) / 1000;
    if (left <= 0) {
      finish();
      return;
    }
    render();
  }

  // A phase ran out: play the sound, move to the next phase, maybe auto-start it
  function finish() {
    stop();
    playSound();

    if (phase === 'focus') {
      done++;
      setPhase(done % ROUNDS_PER_CYCLE === 0 ? 'long' : 'break');
    } else {
      setPhase('focus');
    }

    render();
    if ($('auto').checked) start();
  }

  function setMode(newMode) {
    mode = newMode;
    stop();
    setPhase('focus');
    store.set('pomo.mode', newMode);
    render();
  }


  /*  5. Controls */ 

  // Start / Pause / Resume
  $('go').onclick = () => {
    if (running) {
      stop();
      render();
    } else {
      start();
    }
  };

  // Restart the current countdown only
  $('reset').onclick = () => {
    stop();
    left = total;
    render();
  };

  // Back to round 1 of a fresh cycle
  $('cycle').onclick = () => {
    stop();
    done = 0;
    setPhase('focus');
    render();
  };

  // Jump to the next phase; keeps running if it was running.
  // Skipping a focus round does not count toward the cycle.
  $('skip').onclick = () => {
    const wasRunning = running;
    stop();
    setPhase(phase === 'focus' ? 'break' : 'focus');
    render();
    if (wasRunning) start();
  };

  $('m25').onclick = () => setMode(25);
  $('m50').onclick = () => setMode(50);

  // Space starts / pauses, unless focus is on something that already uses Space
  document.addEventListener('keydown', e => {
    const tag = document.activeElement.tagName;
    if (e.code === 'Space' && !/INPUT|BUTTON|SUMMARY|LABEL/.test(tag)) {
      e.preventDefault();
      $('go').click();
    }
  });

  // Make the styled upload labels work with Enter / Space
  ['bgLbl', 'sndLbl'].forEach(id => {
    $(id).addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        $(id).click();
      }
    });
  });


  /*   6. Sound
     Default chime is generated with Web Audio; an uploaded file overrides it. デフォルトの音。自分の音で交代できる。*/ 

  // Create / resume the audio context (must be triggered by a user action)
  function unlockAudio() {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (e) { /* audio unavailable; the timer still works */ }
  }

  // Default sound: three rising sine notes　デフォルトの音
  function chime() {
    unlockAudio();
    if (!audioCtx) return;

    const volume = parseFloat($('vol').value);
    const now = audioCtx.currentTime;

    [660, 880, 1320].forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      const t = now + i * 0.22;           // each note starts 0.22 s after the last

      osc.type = 'sine';
      osc.frequency.value = freq;

      // Quick fade in, slow fade out
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.35 * volume, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);

      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t);
      osc.stop(t + 1);
    });
  }

  // Play the uploaded sound if there is one, otherwise the chime.
  // Falls back to the chime if the browser refuses to play the file.
  function playSound() {
    if (!customSound) {
      chime();
      return;
    }
    try {
      if (!audioEl) audioEl = new Audio();
      audioEl.src = customSound;
      audioEl.volume = parseFloat($('vol').value);
      audioEl.currentTime = 0;
      const result = audioEl.play();
      if (result && result.catch) result.catch(() => chime());
    } catch (e) {
      chime();
    }
  }

  async function handleSoundUpload(e) {
    const file = e.target.files[0];
    e.target.value = '';                  // allow re-selecting the same file later
    if (!file) return;

    if (!file.type.startsWith('audio/')) {
      say('That file is not an audio file. Choose an MP3, WAV, or OGG.');
      return;
    }

    try {
      customSound = await readFile(file);
      $('sndName').textContent = file.name;

      const saved = store.set('pomo.snd', customSound) && store.set('pomo.sndName', file.name);
      if (!saved) {
        store.del('pomo.snd');
        say('Sound loaded, but it is too large to remember after you close this page.');
      }
      playSound();                        // preview
    } catch (err) {
      say('Could not read that sound file.');
    }
  }

  function clearSound() {
    customSound = null;
    store.del('pomo.snd');
    store.del('pomo.sndName');
    $('sndName').textContent = 'Default chime';
  }

  $('sndFile').onchange = handleSoundUpload;
  $('sndClear').onclick = clearSound;
  $('sndTest').onclick = playSound;
  $('vol').oninput = e => store.set('pomo.vol', e.target.value);
  $('auto').onchange = e => store.set('pomo.auto', e.target.checked ? '1' : '0');


  /*   7. Background 
     Images are large, so they are saved in IndexedDB (localStorage is the
     fallback). The page shows the original upload; the saved copy is a
     resized JPEG. */ 

  // --- IndexedDB helpers (database "pomo", store "kv") ---

  function openDb() {
    return new Promise((resolve, reject) => {
      try {
        const request = indexedDB.open('pomo', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('kv');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      } catch (e) {
        reject(e);
      }
    });
  }

  // Run one operation in a transaction; fn receives the object store
  function idbRun(access, fn) {
    return openDb().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction('kv', access);
      const request = fn(tx.objectStore('kv'));
      tx.oncomplete = () => resolve(request && request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    }));
  }

  // Failures are swallowed: get -> null, set -> false, delete -> nothing
  const idbGet = key => idbRun('readonly', s => s.get(key)).catch(() => null);
  const idbSet = (key, value) => idbRun('readwrite', s => s.put(value, key)).then(() => true).catch(() => false);
  const idbDel = key => idbRun('readwrite', s => s.delete(key)).catch(() => { /* ignore */ });

  // Applying and saving

  // Show an image as the page background, or restore the default gradient when url is empty
  function applyBackground(url) {
    if (url) {
      document.body.style.setProperty('--bg', 'url("' + url + '")');
      document.body.classList.add('has-bg');
    } else {
      document.body.classList.remove('has-bg');
    }
  }

  // Resize an image (longest side up to 3200 px) and re-encode as JPEG for storage.
  // Resolves to null if the image cannot be decoded.
  function shrinkImage(dataUrl) {
    return new Promise(resolve => {
      const img = new Image();

      img.onload = () => {
        const scale = Math.min(1, 3200 / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);

        try {
          resolve(canvas.toDataURL('image/jpeg', 0.92));
        } catch (e) {
          resolve(dataUrl);               // keep the original if re-encoding fails
        }
      };

      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  }

  async function handleBackgroundUpload(e) {
    const file = e.target.files[0];
    e.target.value = '';                  // allow re-selecting the same file later
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      say('That file is not an image. Choose a JPG, PNG, or WebP.');
      return;
    }

    try {
      const original = await readFile(file);
      applyBackground(original);          // show it immediately at full quality

      const small = (await shrinkImage(original)) || original;
      store.del('pomo.bg');               // remove any older small copy in localStorage
      const savedInDb = await idbSet('bg', small);
      if (!savedInDb && !store.set('pomo.bg', small)) {
        say('Background applied, but it is too large to remember after you close this page.');
      }
    } catch (err) {
      say('Could not read that image.');
    }
  }

  function clearBackground() {
    applyBackground(null);
    store.del('pomo.bg');
    idbDel('bg');
  }

  $('bgFile').onchange = handleBackgroundUpload;
  $('bgClear').onclick = clearBackground;


  /*   8. Startup 
     Restore saved settings, then draw the first frame. */ 

  if (store.get('pomo.mode') === '50') {
    mode = 50;
    setPhase('focus');
  }

  // Older versions saved the background in localStorage; newer ones use IndexedDB
  const legacyBackground = store.get('pomo.bg');
  if (legacyBackground) applyBackground(legacyBackground);
  idbGet('bg').then(saved => { if (saved) applyBackground(saved); });

  const savedSound = store.get('pomo.snd');
  if (savedSound) {
    customSound = savedSound;
    $('sndName').textContent = store.get('pomo.sndName') || 'Custom sound';
  }

  const savedVolume = store.get('pomo.vol');
  if (savedVolume) $('vol').value = savedVolume;

  if (store.get('pomo.auto') === '0') $('auto').checked = false;

  render();
})();
