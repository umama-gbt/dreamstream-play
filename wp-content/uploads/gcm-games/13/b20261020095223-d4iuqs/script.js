/* ===================== CONSTANTS ===================== */
const TOTAL_LEVELS = 35;
const STORAGE_KEY = 'sudokuProgress';
const SOUND_KEY = 'sudokuSound';
/* The keys these used to be, back when the game was called NumaSudoku.
   Renaming the game renames the keys, and a key rename is a silent data
   wipe: anyone who has already played is holding their cleared levels,
   coins and shop unlocks under the OLD names, and the new build would open
   on a blank save and quietly start them from Level 1 again.
   migrateLegacyKeys() below copies each one across, once, the first time a
   renamed build runs. The old entries are then removed so this cannot run
   twice and so a later downgrade cannot resurrect stale data on top of
   newer progress. */
/* localStorage can throw (Safari private mode, sandboxed iframes, storage
   disabled, quota). Every read/write goes through these so a storage failure
   degrades to "nothing saved" instead of killing the whole script. */
const store = {
  get(key) { try { return localStorage.getItem(key); } catch (e) { return null; } },
  set(key, val) { try { localStorage.setItem(key, val); } catch (e) {} },
  remove(key) { try { localStorage.removeItem(key); } catch (e) {} },
};

const LEGACY_KEY_MAP = {
  numaSudokuProgress: 'sudokuProgress',
  numaSudokuSound: 'sudokuSound',
  numaSudokuSession: 'sudokuSession'
};

function migrateLegacyKeys() {
  try {
    Object.keys(LEGACY_KEY_MAP).forEach(function (oldKey) {
      const newKey = LEGACY_KEY_MAP[oldKey];
      const oldVal = localStorage.getItem(oldKey);
      if (oldVal === null) return;
      /* Never overwrite. If something already exists under the new name it
         is newer than the leftover, and the leftover is just cleaned up. */
      if (localStorage.getItem(newKey) === null) localStorage.setItem(newKey, oldVal);
      localStorage.removeItem(oldKey);
    });
  } catch (_) {
    /* Private mode, disabled storage, quota — none of it is worth breaking
       the game over. Worst case the player starts fresh, which is exactly
       what would have happened without any of this. */
  }
}
migrateLegacyKeys();
const MAX_MISTAKES = 5;
// Ad continues are UNLIMITED: every Game Over offers Watch Ad & Continue,
// and every successfully watched continue-ad restores the full MAX_MISTAKES
// (5) allowance. adContinuesUsed is kept only as a count, never as a cap.
// 24-hour session (Pac-Man's): progress resets 24 hours after the session
// STARTED — see the "24-HOUR SESSION" block below.
const SESSION_MS = 24 * 60 * 60 * 1000;
/* Set the first time a 24-hour reset happens (Pac-Man's pacman_resetHappened). */
const RESET_HAPPENED_KEY = 'sudokuResetHappened';

/* ===================== SOUND ENGINE (Web Audio, no assets needed) ===================== */

const Sound = (() => {
  let ctx = null;
  let muted = store.get(SOUND_KEY) === 'off';

  function ensureCtx() {
    try {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) ctx = new AC();
      }
      if (ctx && ctx.state !== 'running') ctx.resume();
    } catch (e) { /* audio unavailable — sounds stay silent, rest of the game keeps working */ }
    return ctx;
  }

  // Mobile browsers (and in-app webviews) only unlock Web Audio on a real,
  // direct user gesture, and a context created earlier but never resumed
  // inside one of those gestures stays silently suspended forever. This
  // grabs the very first tap/click/key anywhere on the page and uses it to
  // create + resume the context, plus fires one inaudible buffer through
  // it — the standard iOS unlock trick — so every sound after that plays.
  function unlock() {
    const c = ensureCtx();
    if (c) {
      try {
        const buf = c.createBuffer(1, 1, 22050);
        const src = c.createBufferSource();
        src.buffer = buf;
        src.connect(c.destination);
        src.start(0);
      } catch (e) {}
    }
    ['pointerdown', 'touchstart', 'mousedown', 'keydown'].forEach(ev =>
      document.removeEventListener(ev, unlock, true));
  }
  ['pointerdown', 'touchstart', 'mousedown', 'keydown'].forEach(ev =>
    document.addEventListener(ev, unlock, true));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && ctx && ctx.state !== 'running') { try { ctx.resume(); } catch (e) {} }
  });

  function tone(freq, duration, type = 'sine', startGain = 0.14, delay = 0) {
    if (muted) return;
    try {
      const c = ensureCtx();
      if (!c) return;
      const t0 = c.currentTime + delay;
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      gain.gain.setValueAtTime(startGain, t0);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start(t0);
      osc.stop(t0 + duration + 0.02);
    } catch (e) { /* never let a sound glitch break gameplay */ }
  }

  return {
    tap()      { tone(520, 0.07, 'triangle', 0.09); },
    select()   { tone(660, 0.06, 'sine', 0.08); },
    correct()  { tone(740, 0.09, 'sine', 0.12); tone(988, 0.12, 'sine', 0.1, 0.06); },
    wrong()    { tone(220, 0.16, 'sawtooth', 0.11); tone(160, 0.2, 'sawtooth', 0.09, 0.05); },
    erase()    { tone(340, 0.08, 'triangle', 0.08); },
    win()      {
      [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, 'sine', 0.12, i * 0.11));
    },
    fail()     {
      [392, 330, 262].forEach((f, i) => tone(f, 0.25, 'sawtooth', 0.1, i * 0.14));
    },
    isMuted()  { return muted; },
    toggle()   {
      muted = !muted;
      store.set(SOUND_KEY, muted ? 'off' : 'on');
      if (!muted) ensureCtx();
      return muted;
    },
  };
})();

/* ===================== VIDEO AD SYSTEM (real <video> playback) ===================== */
/* Same shared ad architecture used across the portfolio: a small local JSON
   catalogue (sponsor-media.json) with a built-in fallback, an actual
   <video> element (not a static image with a fake timer), a non-skippable
   window, and a promise that always resolves so the game is never blocked
   even if the ad fails to load.
   Placements used here:
   - "level_gate" -> Next Level, on every 3rd level (3, 6, 9 ...)
   - "continue"   -> Game Over's Watch Ad & Continue (unlimited, 5 mistakes each time)
   - "restart"    -> the bar's Restart button (one ad per attempt, as in Pac-Man)
   - "recover"    -> Select Level: the 5 ads that unlock one locked level after
                     a 24-hour reset (same flow as Pac-Man, see unlockLevelViaAds) */
/* Promise form of playVideoAd(), so a run of ads can be chained exactly the
   way Pac-Man chains them: each ad waits on the previous one. */
function playVideoAdP(placement, rewardText) {
  return new Promise((resolve) => playVideoAd(placement, resolve, rewardText));
}
const SPONSOR_JSON_URL = 'sponsor-media.json';
const AD_LOAD_TIMEOUT_MS = 12000;

const SPONSOR_FALLBACK_CATALOGUE = {
  ads: [
    // Video ads: Pac-Man's own files and entries for the placements both
    // games share (same durations, skippable after 10 seconds).
    { id: 'ns-continue-1', adType: 'video', advertiser: 'Continue Sponsor',
      duration: 67, isSkippable: true, nonSkippableSeconds: 10,
      streamUrl: 'ad-continue-2.mp4', placements: ['continue'] },
    { id: 'ns-continue-2', adType: 'video', advertiser: 'Continue Sponsor',
      duration: 16, isSkippable: true, nonSkippableSeconds: 10,
      streamUrl: 'ad-continue-3.mp4', placements: ['continue'] },
    { id: 'ns-restart-1', adType: 'video', advertiser: 'Restart Sponsor',
      duration: 30, isSkippable: true, nonSkippableSeconds: 10,
      streamUrl: 'ad-restart-2.mp4', placements: ['restart'] },
    { id: 'ns-restart-2', adType: 'video', advertiser: 'Restart Sponsor',
      duration: 36, isSkippable: true, nonSkippableSeconds: 10,
      streamUrl: 'ad-restart-3.mp4', placements: ['restart'] },
    { id: 'ns-levelgate-1', adType: 'video', advertiser: 'Level Sponsor',
      duration: 27, isSkippable: true, nonSkippableSeconds: 10,
      streamUrl: 'ad-levelgate-2.mp4', placements: ['level_gate'] },
    { id: 'ns-recover-1', adType: 'video', advertiser: 'Unlock Sponsor',
      duration: 25, isSkippable: true, nonSkippableSeconds: 10,
      streamUrl: 'ad-recover-2.mp4', placements: ['recover'] },
    // Inline copy of sponsor-media.json's image ads — used only when the
    // JSON file itself cannot be read (e.g. index.html opened via file://).
    { id: 'ns-banner-1', adType: 'image', advertiser: 'Credit Key',
      imageUrl: 'ad-creditkey-banner.png', placements: ['banner'] },
    { id: 'ns-banner-2', adType: 'image', advertiser: 'Credit Key',
      imageUrl: 'ad-creditkey-banner-2.png', placements: ['banner'] },
    { id: 'ns-banner-3', adType: 'image', advertiser: 'Credit Key',
      imageUrl: 'ad-creditkey-banner-3.png', placements: ['banner'] },
    { id: 'ns-leaderboard-1', adType: 'image', advertiser: 'Credit Key',
      imageUrl: 'ad-creditkey-leaderboard.png', placements: ['leaderboard'] },
    { id: 'ns-leaderboard-2', adType: 'image', advertiser: 'Credit Key',
      imageUrl: 'ad-creditkey-leaderboard-2.png', placements: ['leaderboard'] },
    { id: 'ns-leaderboard-3', adType: 'image', advertiser: 'Credit Key',
      imageUrl: 'ad-creditkey-leaderboard-3.png', placements: ['leaderboard'] },
    { id: 'ns-mrec-1', adType: 'image', advertiser: 'Credit Key',
      imageUrl: 'ad-creditkey-mrec.png', placements: ['level_complete_banner'] },
    { id: 'ns-mrec-2', adType: 'image', advertiser: 'Credit Key',
      imageUrl: 'ad-creditkey-mrec-2.png', placements: ['level_complete_banner'] },
    { id: 'ns-mrec-3', adType: 'image', advertiser: 'Credit Key',
      imageUrl: 'ad-creditkey-mrec-3.png', placements: ['level_complete_banner'] },
  ],
};

let sponsorCataloguePromise = null;
function loadSponsorCatalogue() {
  if (sponsorCataloguePromise) return sponsorCataloguePromise;
  sponsorCataloguePromise = fetch(SPONSOR_JSON_URL, { cache: 'no-store' })
    .then((res) => { if (!res.ok) throw new Error('bad status'); return res.json(); })
    .then((data) => { if (!data || !data.ads || !data.ads.length) throw new Error('empty'); return data; })
    .catch(() => SPONSOR_FALLBACK_CATALOGUE);
  return sponsorCataloguePromise;
}

/* One rotation picker for every placement. Video ads carry streamUrl and
   image ads carry imageUrl, so `field` says which kind the placement wants;
   each (placement, kind) pair keeps its own round-robin position. The result
   is tagged with its slot so the MREC card can draw its rotation dots. */
const sponsorRotation = {};
function nextAd(placement, field) {
  return loadSponsorCatalogue().then((data) => {
    const list = (data.ads || []).filter((ad) => ad && ad[field] && (!ad.placements || ad.placements.includes(placement)));
    if (!list.length) return null;
    const key = field + ':' + placement;
    const i = (sponsorRotation[key] || 0) % list.length;
    sponsorRotation[key] = (i + 1) % list.length;
    return Object.assign({}, list[i], { _slot: i, _slots: list.length });
  });
}
const fetchAd = (placement) => nextAd(placement, 'streamUrl');
const fetchImageAd = (placement) => nextAd(placement, 'imageUrl');

/* ===================== BANNER / LEADERBOARD / MREC IMAGE ADS =====================
   Same shared rotation behaviour used across the portfolio (e.g. Pac-Man):
   wherever a placement ("banner", "leaderboard", "level_complete_banner")
   holds more than one image ad, the visible creative swaps to the next one
   every 5 seconds. */
const IMAGE_AD_ROTATE_MS = 5000;

/* imgEls: one or more <img> elements that should all advance together (kept
   as a param, rather than one call per element, so two side rails could be
   synced later if ever wanted — today each rail gets its own call so the
   two sides don't show the same creative at the same time). */
function startImageAdRotation(placement, imgEls) {
  const els = (imgEls || []).filter(Boolean);
  if (!els.length) return;
  function tick(force) {
    // Nobody can see a rotation in a background tab or on another screen.
    if (!force && (document.hidden || !els.some((el) => el.offsetParent))) return;
    fetchImageAd(placement).then((ad) => {
      if (!ad) return;
      els.forEach((el) => { el.src = ad.imageUrl; el.alt = ad.advertiser || 'Advertisement'; });
    });
  }
  tick(true);
  setInterval(tick, IMAGE_AD_ROTATE_MS);
}

document.addEventListener('DOMContentLoaded', () => {
  startImageAdRotation('banner', [document.querySelector('#side-ad-left .ad-unit-img')]);
  startImageAdRotation('banner', [document.querySelector('#side-ad-right .ad-unit-img')]);
  startImageAdRotation('leaderboard', [document.querySelector('#ad-leaderboard .ad-leaderboard-img')]);
  // The Congratulations MREC is Pac-Man's: built and rotated only while the
  // popup is open (loadLevelCompleteBanner / startModalBannerCarousel).
});

const adOverlayEl = document.getElementById('ad-overlay');
const adVideoEl = document.getElementById('ad-video');
const adStatusEl = document.getElementById('ad-status');
const adAdvertiserEl = document.getElementById('ad-advertiser');
const adCountdownEl = document.getElementById('ad-countdown');
const adSkipBtn = document.getElementById('ad-skip-btn');
const adUnmuteBtn = document.getElementById('ad-unmute-btn');
const adRewardNoteEl = document.getElementById('ad-reward-note');
const adSoundToggle = document.getElementById('ad-sound-toggle');
let adIsPlaying = false;

// Reflects the ad video's OWN current mute state on its toggle icon —
// separate from the game's Sound module, since autoplay-with-sound can get
// force-muted by the browser independently of the player's own setting.
function syncAdSoundToggle() {
  if (adSoundToggle) adSoundToggle.classList.toggle('muted', !!adVideoEl.muted);
}
if (adSoundToggle) {
  adSoundToggle.addEventListener('click', () => {
    adVideoEl.muted = !adVideoEl.muted;
    if (!adVideoEl.muted) {
      adVideoEl.volume = 1;
      adUnmuteBtn.classList.add('ad-hidden');
    }
    syncAdSoundToggle();
  });
}

function closeAdOverlay() {
  adIsPlaying = false;
  try {
    adVideoEl.pause();
    adVideoEl.removeAttribute('src');
    adVideoEl.load();
  } catch (e) {}
  if (adOverlayEl) adOverlayEl.classList.add('hidden');
  if (adSkipBtn) adSkipBtn.classList.add('ad-hidden');
  if (adUnmuteBtn) adUnmuteBtn.classList.add('ad-hidden');
  if (adCountdownEl) adCountdownEl.textContent = '';
  if (adAdvertiserEl) adAdvertiserEl.textContent = '';
  if (adRewardNoteEl) adRewardNoteEl.textContent = '';
}

/* Plays a real fullscreen video ad for the given placement, then calls
   onDone — always, whether the ad actually played, failed to load, or no
   ad was available, so a bad connection can never trap the player behind
   an ad screen. rewardText (optional) shows a small caption under the
   player, e.g. "Unlocks Next Level" / "+1 life". */
function playVideoAd(placement, onDone, rewardText) {
  if (adIsPlaying || !adOverlayEl) { if (onDone) onDone(); return; }
  adIsPlaying = true;

  adOverlayEl.classList.remove('hidden');
  adStatusEl.classList.remove('ad-hidden');
  adStatusEl.textContent = 'Loading ad…';
  adSkipBtn.classList.add('ad-hidden');
  adUnmuteBtn.classList.add('ad-hidden');
  adCountdownEl.textContent = '';
  adAdvertiserEl.textContent = '';
  adRewardNoteEl.textContent = rewardText || '';

  let settled = false;
  let loadTimer = null;
  let cleanup = () => {};

  function finish() {
    if (settled) return;
    settled = true;
    clearTimeout(loadTimer);
    cleanup();
    closeAdOverlay();
    if (onDone) onDone();
  }

  fetchAd(placement).then((ad) => {
    if (settled) return;
    if (!ad) { finish(); return; }

    // The catalogue's duration is only a hint; once the file's metadata is
    // in, its real length wins
    // so the countdown can never reach 0s while the video is still playing.
    const listedDuration = Number(ad.duration) || 0;
    const skippable = ad.isSkippable === true;
    const skipAfter = Math.max(0, Number(ad.nonSkippableSeconds) || 0);
    adAdvertiserEl.textContent = ad.advertiser || '';

    const onLoaded = () => adStatusEl.classList.add('ad-hidden');
    const onTime = () => {
      const real = adVideoEl.duration;
      const total = (isFinite(real) && real > 0) ? real : listedDuration;
      const left = Math.max(0, Math.ceil(total - adVideoEl.currentTime));
      adCountdownEl.textContent = total ? left + 's' : '';
      if (skippable && adVideoEl.currentTime >= skipAfter) adSkipBtn.classList.remove('ad-hidden');
    };
    const onEnded = () => finish();
    const onError = () => { if (adVideoEl.error) finish(); };
    const onSkip = () => finish();
    const onUnmute = () => {
      adVideoEl.muted = false;
      adVideoEl.volume = 1;
      adUnmuteBtn.classList.add('ad-hidden');
      syncAdSoundToggle();
    };
    const tryPlay = () => {
      const p = adVideoEl.play();
      if (!p || typeof p.catch !== 'function') return;
      p.catch((err) => {
        if (err && err.name === 'NotAllowedError') {
          adVideoEl.muted = true;
          adUnmuteBtn.classList.remove('ad-hidden');
          syncAdSoundToggle();
          const retry = adVideoEl.play();
          if (retry && typeof retry.catch === 'function') retry.catch(() => {});
        }
      });
    };
    const onCanPlay = () => { if (adVideoEl.paused) tryPlay(); };

    cleanup = () => {
      adVideoEl.removeEventListener('loadedmetadata', onLoaded);
      adVideoEl.removeEventListener('timeupdate', onTime);
      adVideoEl.removeEventListener('ended', onEnded);
      adVideoEl.removeEventListener('error', onError);
      adVideoEl.removeEventListener('canplay', onCanPlay);
      adSkipBtn.removeEventListener('click', onSkip);
      adUnmuteBtn.removeEventListener('click', onUnmute);
    };

    adVideoEl.addEventListener('loadedmetadata', onLoaded);
    adVideoEl.addEventListener('timeupdate', onTime);
    adVideoEl.addEventListener('ended', onEnded);
    adVideoEl.addEventListener('error', onError);
    adVideoEl.addEventListener('canplay', onCanPlay);
    adSkipBtn.addEventListener('click', onSkip);
    adUnmuteBtn.addEventListener('click', onUnmute);

    adVideoEl.muted = Sound.isMuted();
    syncAdSoundToggle();
    adVideoEl.src = ad.streamUrl;
    tryPlay();

    loadTimer = setTimeout(() => {
      if (!settled && adVideoEl.currentTime === 0) finish();
    }, AD_LOAD_TIMEOUT_MS);
  });
}

/* ===================== SUDOKU CORE (bitmask backtracking) ===================== */

function boxIndex(r, c) {
  return Math.floor(r / 3) * 3 + Math.floor(c / 3);
}

function shuffledDigits() {
  const arr = [1,2,3,4,5,6,7,8,9];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Generates a fully solved, valid 9x9 grid (flat array length 81)
function makeSolvedGrid() {
  const grid = new Array(81).fill(0);
  const rows = new Array(9).fill(0);
  const cols = new Array(9).fill(0);
  const boxes = new Array(9).fill(0);

  function place(pos) {
    if (pos === 81) return true;
    const r = Math.floor(pos / 9), c = pos % 9, b = boxIndex(r, c);
    const digits = shuffledDigits();
    for (const d of digits) {
      const bit = 1 << d;
      if (rows[r] & bit || cols[c] & bit || boxes[b] & bit) continue;
      grid[pos] = d;
      rows[r] |= bit; cols[c] |= bit; boxes[b] |= bit;
      if (place(pos + 1)) return true;
      grid[pos] = 0;
      rows[r] &= ~bit; cols[c] &= ~bit; boxes[b] &= ~bit;
    }
    return false;
  }
  place(0);
  return grid;
}

// Counts solutions of a partially filled grid up to `limit` (early exit)
function countSolutions(grid, limit) {
  const rows = new Array(9).fill(0);
  const cols = new Array(9).fill(0);
  const boxes = new Array(9).fill(0);
  const empties = [];

  for (let pos = 0; pos < 81; pos++) {
    const r = Math.floor(pos / 9), c = pos % 9, b = boxIndex(r, c);
    const v = grid[pos];
    if (v === 0) {
      empties.push(pos);
    } else {
      const bit = 1 << v;
      rows[r] |= bit; cols[c] |= bit; boxes[b] |= bit;
    }
  }

  let count = 0;

  function backtrack(idx) {
    if (count >= limit) return;
    if (idx === empties.length) { count++; return; }

    // pick the empty cell with fewest candidates (MRV) among remaining for speed
    let bestI = idx, bestCandidates = null, bestLen = 10;
    for (let i = idx; i < empties.length; i++) {
      const pos = empties[i];
      const r = Math.floor(pos / 9), c = pos % 9, b = boxIndex(r, c);
      const used = rows[r] | cols[c] | boxes[b];
      let cands = [];
      for (let d = 1; d <= 9; d++) if (!(used & (1 << d))) cands.push(d);
      if (cands.length < bestLen) {
        bestLen = cands.length; bestI = i; bestCandidates = cands;
        if (bestLen === 0) break;
      }
    }
    // swap chosen empty to position idx
    [empties[idx], empties[bestI]] = [empties[bestI], empties[idx]];
    const pos = empties[idx];
    const r = Math.floor(pos / 9), c = pos % 9, b = boxIndex(r, c);

    for (const d of bestCandidates) {
      const bit = 1 << d;
      rows[r] |= bit; cols[c] |= bit; boxes[b] |= bit;
      backtrack(idx + 1);
      rows[r] &= ~bit; cols[c] &= ~bit; boxes[b] &= ~bit;
      if (count >= limit) break;
    }
  }

  backtrack(0);
  return count;
}

// Removes cells from a solved grid while keeping a unique solution, down to `clues` given cells.
// One symmetric pass often stalls well above the target on the hard levels
// (Level 35 aims for 24 clues but could come out with 30 — easier than
// Level 28), so a few attempts are made and the leanest board is kept.
function generatePuzzle(clues) {
  let best = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    const result = generatePuzzleOnce(clues);
    const given = result.puzzle.filter(v => v !== 0).length;
    if (!best || given < best.given) best = { ...result, given };
    if (given <= clues) break;
  }
  return { puzzle: best.puzzle, solution: best.solution };
}

function generatePuzzleOnce(clues) {
  const solved = makeSolvedGrid();
  const puzzle = solved.slice();
  const positions = [];
  for (let i = 0; i < 81; i++) positions.push(i);
  // shuffle
  for (let i = positions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [positions[i], positions[j]] = [positions[j], positions[i]];
  }

  let given = 81;
  for (const pos of positions) {
    if (given <= clues) break;
    if (puzzle[pos] === 0) continue;
    const backup = puzzle[pos];
    const mirror = 80 - pos; // symmetric removal for a nicer looking pattern
    const mirrorBackup = puzzle[mirror];

    puzzle[pos] = 0;
    if (mirror !== pos && given - 1 > clues) puzzle[mirror] = 0;

    if (countSolutions(puzzle, 2) !== 1) {
      // revert - removal breaks uniqueness
      puzzle[pos] = backup;
      puzzle[mirror] = mirrorBackup;
    }
    given = puzzle.filter(v => v !== 0).length;
  }

  // Second pass: if symmetric pairs could not get low enough, try removing
  // single cells (still keeping the solution unique).
  for (const pos of positions) {
    if (given <= clues) break;
    if (puzzle[pos] === 0) continue;
    const backup = puzzle[pos];
    puzzle[pos] = 0;
    if (countSolutions(puzzle, 2) !== 1) puzzle[pos] = backup;
    else given--;
  }

  return { puzzle, solution: solved };
}

/* ===================== LEVEL / DIFFICULTY CONFIG ===================== */

function cluesForLevel(level) {
  // Level 1 -> 46 clues (easy), Level 35 -> 24 clues (expert)
  const start = 46, end = 24;
  return Math.round(start - (level - 1) * (start - end) / (TOTAL_LEVELS - 1));
}

// Difficulty as shown to the player: fixed 7-level bands, independent of
// the exact clue count, so it reads Easy 1-7 / Medium 8-14 / Hard 15-21 /
// Very Hard 22-28 / Expert 29-35 the same way every run.
function difficultyLabelForLevel(level) {
  if (level <= 7) return 'Easy';
  if (level <= 14) return 'Medium';
  if (level <= 21) return 'Hard';
  if (level <= 28) return 'Very Hard';
  return 'Expert';
}
function difficultyClassForLevel(level) {
  return 'diff-' + difficultyLabelForLevel(level).toLowerCase().replace(/\s+/g, '');
}

function timeThresholds(clues) {
  const threeStar = 70 + (46 - clues) * 9;
  const twoStar = threeStar * 1.8;
  return { threeStar, twoStar };
}

/* ===================== PROGRESS STORAGE ===================== */

function defaultProgress() {
  return {
    unlocked: 1,
    // Levels unlocked OUT OF ORDER with the 5-ads flow (unlocking level 20
    // must not open 19 or 21) — Pac-Man keeps a set of unlocked levels for
    // exactly this reason. Normal progression stays in 'unlocked'.
    adUnlocked: [],
    stars: {},
    coins: 0,
    achievements: [],
    owned: { themes: ['classic'], numstyles: ['default'], backgrounds: ['default'] },
    selected: { theme: 'classic', numstyle: 'default', background: 'default' },
  };
}

function loadProgress() {
  const base = defaultProgress();
  try {
    const raw = store.get(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      // Merge onto defaults so progress saved before the coins/shop system
      // existed still loads cleanly instead of crashing on a missing field.
      const merged = {
        ...base,
        ...saved,
        owned: { ...base.owned, ...(saved.owned || {}) },
        selected: { ...base.selected, ...(saved.selected || {}) },
      };
      // Older or hand-edited saves: make sure the collections are real
      // collections before anything calls .includes()/.push() on them.
      if (!Array.isArray(merged.adUnlocked)) merged.adUnlocked = [];
      if (!Array.isArray(merged.achievements)) merged.achievements = [];
      if (!merged.stars || typeof merged.stars !== 'object') merged.stars = {};
      ['themes', 'numstyles', 'backgrounds'].forEach((k) => {
        if (!Array.isArray(merged.owned[k])) merged.owned[k] = base.owned[k].slice();
      });
      // The 24-hour reset is decided by checkSession() (fixed 24h from the
      // session start, checked live), not here.
      return merged;
    }
  } catch (e) {}
  return base;
}

function saveProgress(progress) {
  store.set(STORAGE_KEY, JSON.stringify(progress));
}

let progress = loadProgress();

/* ===================== SESSION ===================== */
/* A session is one continuous run of play. Progress itself already persists
   forever in localStorage; this is the shorter-lived thing on top of it —
   how long this sitting has lasted, how many levels were cleared in it, and
   where the player left off, so returning inside the window picks up rather
   than starting over.
   It is kept separate from progress on purpose: clearing a stale session
   must never be able to take a cleared level away with it. */
const SESSION_KEY = 'sudokuSession'; // renamed with the game; see LEGACY_KEY_MAP
/* A day, not half an hour: coming back the next morning picks up where the
   last sitting left off; only after a full 24 hours away is it a fresh start. */

function newSession() {
  return { id: Date.now().toString(36), startedAt: Date.now(), lastSeenAt: Date.now(),
           levelsCleared: 0, lastLevel: null, inProgress: false, puzzle: null };
}

function readSession() {
  try {
    const raw = store.get(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || typeof s.lastSeenAt !== 'number') return null;
    /* Too long since the last sign of life — that was a different sitting,
       so it does not get resumed. Whatever puzzle it left mid-solve starts
       over instead, same as a level the player has never begun. */
    if (Date.now() - s.lastSeenAt > SESSION_MS) return null;
    return s;
  } catch (e) { return null; }
}

function writeSession(s) {
  store.set(SESSION_KEY, JSON.stringify(s));
}

let session = readSession() || newSession();
writeSession(session);

/* ===================== 24-HOUR SESSION (Pac-Man's) =====================
   Same logic as Pac-Man's checkSession(): progress (unlocked / completed
   levels, stars, coins, shop items and selections) resets 24 hours after
   the session STARTED. Sound preference is a device setting, not game
   progress, so it is deliberately excluded. Checked on load, every 30s,
   and whenever the tab comes back into view or regains focus. When the
   reset fires mid-level the player is dropped back to the menu, and the
   Pac-Man "24-hour session over" toast is shown. */
const SESSION_START_KEY = 'sudokuSessionStart';

/* Session start time, or null when it is missing or unreadable. A corrupt
   value used to come back as NaN, and since NaN <= 0 is false the 24-hour
   reset could then never fire again. */
function readSessionStart() {
  const start = Number(store.get(SESSION_START_KEY));
  return Number.isFinite(start) && start > 0 ? start : null;
}

function startNewSession() {
  store.set(SESSION_START_KEY, String(Date.now()));
}

function wipeSessionProgress() {
  progress = defaultProgress();
  saveProgress(progress);
  // A puzzle saved mid-solve belongs to the wiped run, so it is not resumed.
  store.remove(SESSION_KEY);
  session = newSession();
  // Pac-Man's pacman_resetHappened: survives the wipe it is set by.
  store.set(RESET_HAPPENED_KEY, '1');
  startNewSession();
}

function checkSession() {
  const start = readSessionStart();
  if (!start) { startNewSession(); return; }
  if (start + SESSION_MS - Date.now() > 0) return;
  // Don't wipe mid-ad: the ad's reward callback would run afterwards against
  // the wiped progress (restarting the clock on the home screen, or opening a
  // level that was just re-locked). The 30s re-check picks it up after.
  if (adIsPlaying || levelUnlockInProgress) return;

  wipeSessionProgress();
  applyCosmetics();
  updateCoinDisplays();
  // If a level was in progress, drop back to the menu with a fresh start.
  if ($('#game-screen').classList.contains('active')) {
    state.running = false;
    stopTimer();
    hideOverlay();
    showScreen('home-screen');
  }
  if ($('#levels-screen').classList.contains('active')) renderLevelsGrid();
  if ($('#shop-screen').classList.contains('active')) renderShop();
  showSessionToast();
}

let sessionToastEl = null;
function showSessionToast() {
  if (!sessionToastEl) {
    sessionToastEl = document.createElement('div');
    sessionToastEl.className = 'session-toast';
    document.body.appendChild(sessionToastEl);
  }
  sessionToastEl.textContent = '\u23F0 24-hour session over \u2014 progress reset, starting fresh';
  sessionToastEl.classList.add('show');
  clearTimeout(sessionToastEl._hideTimer);
  sessionToastEl._hideTimer = setTimeout(() => sessionToastEl.classList.remove('show'), 3200);
}
window.showSessionToast = showSessionToast;

setInterval(checkSession, 30000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { checkSession(); return; }
  // Switching apps / tabs used to leave the clock running, so time spent
  // away counted against the star rating and the fast-solve bonus. Pause
  // instead; the bar's Resume (or Esc / P) carries on where the player was.
  if (state.running && $('#game-screen').classList.contains('active') && !isBlockingLayerOpen()) setPaused(true);
});
window.addEventListener('focus', checkSession);
/* Pause / Game Over state — declared up here because startLevel() and
   showScreen() read them. */
let gamePaused = false;
let gameOverTimer = null;
/* Pac-Man's restartAdUsedThisRun: the bar's Restart button is gated behind
   ONE rewarded "restart" ad per attempt (see the Restart handler). */
let restartAdUsedThisRun = false;

/* ===================== UNLOCKED LEVELS (Pac-Man's rules) ===================== */
const UNLOCK_ADS_REQUIRED = 5;       // Pac-Man's UNLOCK_ADS_REQUIRED
let levelUnlockInProgress = false;   // true while the 5 unlock ads are playing (see unlockLevelViaAds)
function hasSessionEverReset() {
  return store.get(RESET_HAPPENED_KEY) === '1';
}
function isLevelUnlocked(level) {
  return level === 1 || level <= progress.unlocked || progress.adUnlocked.includes(level);
}
/* Pac-Man: a locked level is ad-unlockable only once a 24-hour reset has
   happened at least once AND the level right before it is still locked —
   i.e. it sits after a gap, where ads are the only way in. The moment a
   level is unlocked (by ads or by winning) the one after it drops out of
   the ads pool and can only be reached by winning. */
function isLevelAdUnlockable(level) {
  return level > 1 && level <= TOTAL_LEVELS && !isLevelUnlocked(level) &&
    hasSessionEverReset() && !isLevelUnlocked(level - 1);
}
/* Pac-Man's unlockLevel(): opens exactly one level. A level right after the
   contiguous run just extends it (pulling in any ads-unlocked levels it now
   touches); anything further out goes into the out-of-order set. */
function unlockLevel(level) {
  if (level < 1 || level > TOTAL_LEVELS || isLevelUnlocked(level)) return;
  if (level === progress.unlocked + 1) {
    progress.unlocked = level;
    while (progress.adUnlocked.includes(progress.unlocked + 1)) progress.unlocked++;
    progress.adUnlocked = progress.adUnlocked.filter((n) => n > progress.unlocked);
  } else {
    progress.adUnlocked.push(level);
  }
}
/* Furthest level the player can open — Pac-Man's getFurthestUnlockedLevel(),
   used for the "Level X of 35 unlocked" line and where Play drops in. */
/* Can the player get into this level from a Prev/Next-style button, either
   directly or through the 5-ads confirm? */
function isLevelReachable(level) {
  return level >= 1 && level <= TOTAL_LEVELS && (isLevelUnlocked(level) || isLevelAdUnlockable(level));
}
function getFurthestUnlockedLevel() {
  return Math.min(TOTAL_LEVELS, Math.max(progress.unlocked, ...progress.adUnlocked));
}

/* ===================== GAME STATE ===================== */

let state = {
  level: 1,
  clues: 46,
  given: [],      // 81 booleans - true if fixed clue
  board: [],      // 81 current values (0 = empty)
  solution: [],   // 81 solved values
  selected: -1,
  mistakes: 0,
  totalMistakes: 0, // every mistake this attempt, including ones wiped by a continue-ad
  seconds: 0,
  adContinuesUsed: 0,
  timerId: null,
  running: false,
};

/* ===================== DOM HELPERS ===================== */

const $ = (sel) => document.querySelector(sel);
const $all = (sel) => Array.from(document.querySelectorAll(sel));

function showScreen(id) {
  // Leaving (or re-entering) a screen always clears Pause — Pac-Man's showScreen().
  if (gamePaused && id !== 'game-screen') setPaused(false, true);
  $all('.screen').forEach(s => s.classList.remove('active'));
  $(`#${id}`).classList.add('active');
  // The game layout and its one-line top bar are measured, so they follow
  // the screen switch here rather than via two separate wrapper hooks.
  refitGameLayout();
  fitTopBar();
}

/* True while anything modal sits on top of the game board. */
function isBlockingLayerOpen() {
  return adIsPlaying ||
    !$('#overlay').classList.contains('hidden') ||
    !$('#confirmOverlay').classList.contains('hidden');
}

/* How to Play is a full screen now (matching Home/Levels/Shop's shared
   card), not a popup, so leaving it has to go back to whichever screen
   opened it rather than just closing an overlay. */
let howtoOrigin = 'home-screen';

/* ===================== LEVEL SELECT RENDER ===================== */

function renderLevelsGrid() {
  const grid = $('#levels-grid');
  grid.innerHTML = '';
  /* Same flat grid as Pac-Man: no difficulty headings, one tile per level.
     Locked = padlock above the number; the level you can start from also
     names its difficulty; finished levels are just the number on gold. */
  const line = $('#levels-progress-line');
  if (line) line.textContent = 'Level ' + getFurthestUnlockedLevel() + ' of ' + TOTAL_LEVELS + ' unlocked';
  for (let lvl = 1; lvl <= TOTAL_LEVELS; lvl++) {
    const btn = document.createElement('button');
    const locked = !isLevelUnlocked(lvl);
    const completed = !locked && (lvl < progress.unlocked || !!progress.stars[lvl]);
    const adUnlockable = locked && isLevelAdUnlockable(lvl);
    const diffKey = difficultyClassForLevel(lvl);
    btn.className = 'level-btn ' + diffKey + (locked ? ' locked' : completed ? ' completed' : ' unlocked');
    if (locked) {
      btn.innerHTML = `<span class="level-lock">\uD83D\uDD12</span><span class="level-num">${lvl}</span>`;
      /* Same plain padlock before and after a reset — only the tap differs
         (Pac-Man). An ad-unlockable tile opens the 5-ads confirm. */
      if (adUnlockable) {
        btn.title = 'Watch ' + UNLOCK_ADS_REQUIRED + ' ads to unlock this level and continue the game';
        btn.addEventListener('click', () => {
          if (levelUnlockInProgress) return;
          Sound.tap();
          showUnlockConfirm(lvl);
        });
      }
    } else {
      btn.innerHTML = `<span class="level-num">${lvl}</span>` +
        (completed ? '' : `<span class="level-diff">${difficultyLabelForLevel(lvl)}</span>`);
      btn.addEventListener('click', () => { if (levelUnlockInProgress) return; Sound.tap(); startLevel(lvl); });
    }
    if (levelUnlockInProgress) btn.disabled = true; // ads playing — whole grid waits (Pac-Man)
    grid.appendChild(btn);
  }
}

/* ===================== GAME START / RESTART ===================== */

function startLevel(level) {
  state.level = level;
  state.clues = cluesForLevel(level);
  const { puzzle, solution } = generatePuzzle(state.clues);
  state.given = puzzle.map(v => v !== 0);
  state.board = puzzle.slice();
  state.solution = solution;
  state.mistakes = 0;
  state.totalMistakes = 0;
  state.seconds = 0;
  state.adContinuesUsed = 0;
  enterGame();
}

/* Everything that happens whenever the board is put in front of the player,
   whether it is a brand-new puzzle (startLevel) or a resumed one
   (resumeSession). Kept in one place so the two can't drift apart — the
   resume path used to skip the pause / popup / Restart-button reset. */
function enterGame() {
  state.selected = -1;
  state.running = true;
  // Any level entered fresh (Play, Select Level, Prev/Next, Next Level,
  // Retry, resume) offers the ad-gated Restart again — Pac-Man's startLevel().
  restartAdUsedThisRun = false;
  const restartBtnEl = document.getElementById('bottom-restart');
  if (restartBtnEl) restartBtnEl.disabled = false;
  hideOverlay();
  setPaused(false, true);

  $('#level-label').textContent = `Lvl ${state.level}`;
  const diffEl = $('#difficulty-label');
  diffEl.textContent = difficultyLabelForLevel(state.level);
  diffEl.className = 'diff-chip ' + difficultyClassForLevel(state.level);
  $('#mistakes').textContent = `${state.mistakes}/${MAX_MISTAKES}`;
  $('#timer').textContent = formatTime(state.seconds);
  updateCoinDisplays(); // also refreshes the bottom bar and Prev/Next

  showScreen('game-screen');
  renderBoard();
  startTimer();
  touchSession({ lastLevel: state.level, inProgress: true, puzzle: snapshotPuzzle() });
}

/* Leaving the board for another screen (Back, Exit, Level Select). The clock
   stops, input is frozen, and the snapshot is written NOW — it is otherwise
   only refreshed every 5s, so a resume could lose the last few seconds. */
function leaveGame() {
  const wasLive = state.running || gamePaused;
  stopTimer();
  state.running = false;
  if (wasLive) syncSessionPuzzle();
}

/* ===================== BOARD RENDER ===================== */

function renderBoard() {
  const board = $('#sudoku-board');
  board.innerHTML = '';
  for (let pos = 0; pos < 81; pos++) {
    const r = Math.floor(pos / 9), c = pos % 9;
    const cell = document.createElement('div');
    cell.className = 'cell' + (state.given[pos] ? ' fixed' : '');
    cell.dataset.row = r;
    cell.dataset.col = c;
    cell.dataset.pos = pos;
    if (state.board[pos] !== 0) cell.textContent = state.board[pos];
    cell.addEventListener('click', () => selectCell(pos));
    board.appendChild(cell);
  }
  updateHighlights();
}

function updateHighlights() {
  const cells = $all('.cell');
  const sel = state.selected;
  let selRow = -1, selCol = -1, selVal = 0;
  if (sel >= 0) {
    selRow = Math.floor(sel / 9); selCol = sel % 9;
    selVal = state.board[sel];
  }
  cells.forEach((cellEl) => {
    const pos = Number(cellEl.dataset.pos);
    const r = Number(cellEl.dataset.row), c = Number(cellEl.dataset.col);
    cellEl.classList.remove('selected', 'peer', 'same-num');
    if (sel < 0) return;
    if (pos === sel) {
      cellEl.classList.add('selected');
    } else if (r === selRow || c === selCol || boxIndex(r, c) === boxIndex(selRow, selCol)) {
      cellEl.classList.add('peer');
    }
    if (selVal !== 0 && state.board[pos] === selVal) {
      cellEl.classList.add('same-num');
    }
  });
}

function selectCell(pos) {
  if (pos !== state.selected) Sound.select();
  state.selected = pos;
  updateHighlights();
}

/* ===================== INPUT HANDLING ===================== */

/* A wrong digit is only flashed, never stored, so each cell remembers the
   timer that will wipe its flash; a second wrong tap restarts it instead of
   being cleared early by the first one's timer. */
const errorFlashTimers = {};

function inputNumber(num) {
  if (!state.running) return;
  const pos = state.selected;
  if (pos < 0 || state.given[pos]) return;
  // Only correct digits are ever written to the board, so a filled cell is
  // already solved. Typing over it used to show the wrong digit on screen
  // (red, permanently — the clean-up below only fires for EMPTY cells) while
  // the board kept the right one, and cost a mistake for a cell already done.
  if (state.board[pos] !== 0) return;

  const cellEl = document.querySelector(`.cell[data-pos="${pos}"]`);
  clearTimeout(errorFlashTimers[pos]);

  if (state.solution[pos] === num) {
    Sound.correct();
    state.board[pos] = num;
    cellEl.textContent = num;
    cellEl.classList.remove('error');
    updateHighlights();
    if (!checkWin()) syncSessionPuzzle();
    return;
  }

  Sound.wrong();
  cellEl.classList.add('error');
  cellEl.textContent = num;
  state.mistakes++;
  state.totalMistakes = (state.totalMistakes || 0) + 1;
  $('#mistakes').textContent = `${state.mistakes}/${MAX_MISTAKES}`;
  syncBottomGameBar();
  errorFlashTimers[pos] = setTimeout(() => {
    if (state.board[pos] === 0 && cellEl.isConnected) {
      cellEl.classList.remove('error');
      cellEl.textContent = '';
    }
  }, 450);
  if (state.mistakes >= MAX_MISTAKES) {
    stopTimer();
    state.running = false;
    handleGameOver(); // also marks the session as no longer resumable
  } else {
    syncSessionPuzzle();
  }
}

function eraseCell() {
  if (!state.running) return; // paused / game over: the board is frozen (Pac-Man's pause)
  const pos = state.selected;
  if (pos < 0 || state.given[pos]) return;
  Sound.erase();
  clearTimeout(errorFlashTimers[pos]);
  state.board[pos] = 0;
  const cellEl = document.querySelector(`.cell[data-pos="${pos}"]`);
  cellEl.textContent = '';
  cellEl.classList.remove('error');
  updateHighlights();
  syncSessionPuzzle();
}

/* ===================== WIN CHECK ===================== */

/* Returns true when the board is solved (and the win has been handled). */
function checkWin() {
  for (let i = 0; i < 81; i++) {
    if (state.board[i] !== state.solution[i]) return false;
  }
  state.running = false;
  stopTimer();

  const { threeStar, twoStar } = timeThresholds(state.clues);
  // Rated on ALL mistakes made this attempt. A continue-ad resets the live
  // counter to 0/5, which used to let a board that hit Game Over still earn
  // 3 stars.
  const mistakesMade = Math.max(state.mistakes, state.totalMistakes || 0);
  let stars = 1;
  if (mistakesMade === 0 && state.seconds <= threeStar) stars = 3;
  else if (mistakesMade <= 1 && state.seconds <= twoStar) stars = 2;

  const prevStars = progress.stars[state.level] || 0;
  progress.stars[state.level] = Math.max(prevStars, stars);
  // Pac-Man's markLevelCompleted(): winning a level unlocks the NEXT level
  // for free — and only that one. (Winning an ads-unlocked level 20 opens 21,
  // never 2-19.)
  const nextNewlyUnlocked = state.level < TOTAL_LEVELS && !isLevelUnlocked(state.level + 1);
  unlockLevel(state.level + 1);

  // Rewards: 45 coins for finishing (the old 25 base + the 20 hint-free
  // bonus, which every solve already earned since hints were unreachable),
  // plus 15 for a fast solve (the same time window the 3-star rating uses).
  let coinsEarned = 45;
  const fastSolve = state.seconds <= threeStar;
  if (fastSolve) coinsEarned += 15;
  progress.coins = (progress.coins || 0) + coinsEarned;

  let achievementText = '';
  if (difficultyLabelForLevel(state.level) === 'Expert' && !progress.achievements.includes('expert-completion')) {
    progress.achievements.push('expert-completion');
    achievementText = '🏆 Achievement unlocked: Expert Solver';
  }

  saveProgress(progress);
  updateCoinDisplays();
  // The level is finished, so there's nothing left to resume — clear the
  // in-progress puzzle out of the session, and count the clear.
  touchSession({ inProgress: false, puzzle: null, levelsCleared: (session.levelsCleared || 0) + 1 });

  handleLevelWin({ coinsEarned, stars, achievementText, nextNewlyUnlocked });
  return true;
}

function syncBottomGameBar() {
  const level = document.getElementById("bottom-level-num");
  const timer = document.getElementById("bottom-timer");
  const mistakes = document.getElementById("bottom-mistakes");
  const coins = document.getElementById("bottom-coins");
  if (level) level.textContent = String(state.level); // "Level" / "L" is Pac-Man's CSS (.lvl-word / .lvl-num tiers)
  if (timer) timer.textContent = formatTime(state.seconds);
  if (mistakes) mistakes.textContent = `${state.mistakes}/${MAX_MISTAKES}`;
  if (coins) coins.textContent = String(progress.coins || 0);
  // Pac-Man's updateUI() re-applies the Prev/Next disabled rule every time it
  // refreshes the bar, so the buttons can never show a stale state (e.g. a
  // resumed Level 1 board showing an enabled Prev). Same here.
  updateLevelNavButtons();
}

function updateTimerDisplays() {
  const t = formatTime(state.seconds);
  $('#timer').textContent = t;
  const bottom = document.getElementById('bottom-timer');
  if (bottom) bottom.textContent = t;
}

/* ===================== TIMER ===================== */

function formatTime(sec) {
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const s = (sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function startTimer() {
  stopTimer();
  state.timerId = setInterval(() => {
    state.seconds++;
    updateTimerDisplays(); // just the clocks — not the whole bar every second
    // Throttled so a live game isn't writing to storage every single
    // second — the snapshot only needs to be roughly current.
    if (state.seconds % 5 === 0) syncSessionPuzzle();
  }, 1000);
}

function stopTimer() {
  if (state.timerId) { clearInterval(state.timerId); state.timerId = null; }
}

/* ===================== COINS / SHOP / UNLOCKABLES ===================== */

function updateCoinDisplays() {
  const val = String(progress.coins || 0);
  ['#coin-count-home', '#coin-count-shop', '#coin-count-game'].forEach(sel => {
    const el = $(sel);
    if (el) el.textContent = val;
  });
  syncBottomGameBar();
}

// Applies the player's chosen theme / number style / background as body
// classes, so the CSS variable overrides and swatch rules in style.css
// take effect. Called on load and whenever a shop selection changes.
function applyCosmetics() {
  document.body.className = document.body.className
    .split(' ')
    .filter(c => !/^(theme|numstyle|bg)-/.test(c))
    .join(' ')
    .trim();
  document.body.classList.add('theme-' + progress.selected.theme);
  if (progress.selected.numstyle !== 'default') document.body.classList.add('numstyle-' + progress.selected.numstyle);
  if (progress.selected.background !== 'default') document.body.classList.add('bg-' + progress.selected.background);
}

const THEMES = [
  { id: 'classic',  name: 'Sky',          cost: 0,   colors: ['#3F9BE0', '#77C2F0'] },
  { id: 'sunset',   name: 'Sunset',       cost: 120, colors: ['#E8845B', '#F2A66F'] },
  { id: 'forest',   name: 'Meadow',       cost: 120, colors: ['#3FAE55', '#63CC72'] },
  { id: 'midnight', name: 'Midnight',     cost: 180, colors: ['#232C43', '#7CB8F0'] },
];
const NUMSTYLES = [
  { id: 'default', name: 'Rounded',      cost: 0,  sample: '5 9 2', font: "'Poppins', sans-serif" },
  { id: 'mono',    name: 'Mono',         cost: 80, sample: '5 9 2', font: "'Courier New', monospace" },
  { id: 'serif',   name: 'Classic Serif', cost: 80, sample: '5 9 2', font: "Georgia, serif" },
];
const BACKGROUNDS = [
  { id: 'default', name: 'Default', cost: 0,   colors: ['#C9D8FF', '#FFE3C2'] },
  { id: 'ocean',   name: 'Ocean',   cost: 100, colors: ['#A7E6F2', '#7FD1E8'] },
  { id: 'peach',   name: 'Peach',   cost: 100, colors: ['#FFD7C2', '#FFC2D6'] },
];

function buyOrSelect(category, id, cost, ownedListKey) {
  const owned = progress.owned[ownedListKey].includes(id);
  if (!owned) {
    if ((progress.coins || 0) < cost) return;
    progress.coins -= cost;
    progress.owned[ownedListKey].push(id);
  }
  progress.selected[category] = id;
  saveProgress(progress);
  applyCosmetics();
  updateCoinDisplays();
  renderShop();
}

function renderShopGrid(containerSel, items, category, ownedListKey) {
  const el = $(containerSel);
  el.innerHTML = '';
  items.forEach(item => {
    const owned = progress.owned[ownedListKey].includes(item.id);
    const selected = progress.selected[category] === item.id;
    const card = document.createElement('div');
    card.className = 'shop-item' + (selected ? ' selected' : '');

    let swatchHtml;
    if (category === 'numstyle') {
      swatchHtml = `<span class="shop-item-sample" style="font-family:${item.font}">${item.sample}</span>`;
    } else {
      swatchHtml = `<div class="shop-swatch" style="background:linear-gradient(135deg, ${item.colors[0]}, ${item.colors[1]})"></div>`;
    }

    let btnHtml;
    if (selected) {
      btnHtml = `<button class="shop-item-btn selected-btn" disabled>Equipped</button>`;
    } else if (owned) {
      btnHtml = `<button class="shop-item-btn select">Select</button>`;
    } else {
      btnHtml = `<button class="shop-item-btn buy" ${(progress.coins || 0) < item.cost ? 'disabled' : ''}>Buy · ${item.cost} 🪙</button>`;
    }

    card.innerHTML = `${swatchHtml}<span class="shop-item-name">${item.name}</span>${btnHtml}`;
    const btn = card.querySelector('.shop-item-btn');
    if (!selected) {
      btn.addEventListener('click', () => { Sound.tap(); buyOrSelect(category, item.id, item.cost, ownedListKey); });
    }
    el.appendChild(card);
  });
}

function renderShop() {
  updateCoinDisplays();
  renderShopGrid('#shop-themes', THEMES, 'theme', 'themes');
  renderShopGrid('#shop-numstyles', NUMSTYLES, 'numstyle', 'numstyles');
  renderShopGrid('#shop-backgrounds', BACKGROUNDS, 'background', 'backgrounds');
}

// Only the tapped category's items are shown at once — the others stay
// hidden rather than all stacking on one long scrollable page.
function showShopCategory(cat) {
  ['themes', 'numstyles', 'backgrounds'].forEach(c => {
    const sec = $(`#shop-cat-${c}`);
    if (sec) sec.hidden = (c !== cat);
  });
  $all('.shop-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.cat === cat));
}

/* ===================== EVENT WIRING ===================== */

function syncSoundButtons() {
  const muted = Sound.isMuted();
  // The in-game top-bar toggle. (#ad-sound-toggle also carries .sound-toggle
  // but mirrors the AD VIDEO's own mute state, so it is left to
  // syncAdSoundToggle() rather than being overwritten here.)
  $all('.sound-toggle:not(#ad-sound-toggle)').forEach(btn => btn.classList.toggle('muted', muted));
  // Home's Pac-Man mute button: its CSS draws the crossed-out speaker from
  // .is-muted, which nothing used to set — so it always showed "sound on".
  const homeSound = document.getElementById('sound-toggle-home');
  if (homeSound) {
    homeSound.classList.toggle('is-muted', muted);
    homeSound.setAttribute('aria-pressed', String(muted));
  }
  // The bar's sound button is Pac-Man's icon-only mute button: 🔊 / 🔇,
  // greyed with .is-muted while sound is off.
  const bottomSound = document.getElementById('bottom-sound');
  if (bottomSound) {
    bottomSound.textContent = muted ? '\u{1F507}' : '\u{1F50A}';
    bottomSound.classList.toggle('pm-is-muted', muted);
    bottomSound.setAttribute('aria-pressed', String(muted));
  }
}

document.addEventListener('DOMContentLoaded', () => {
  applyCosmetics();
  updateCoinDisplays();
  renderLevelsGrid();
  syncSoundButtons();

  $('#sound-toggle-home').addEventListener('click', () => { Sound.toggle(); syncSoundButtons(); });
  $('#sound-toggle-game').addEventListener('click', () => { Sound.toggle(); syncSoundButtons(); });
  const bottomPause = $('#bottom-pause');
  if (bottomPause) bottomPause.addEventListener('click', () => setPaused(!gamePaused));
  const bottomSound = $('#bottom-sound');
  if (bottomSound) bottomSound.addEventListener('click', () => { Sound.toggle(); syncSoundButtons(); });
  const bottomRestart = $('#bottom-restart');
  /* ---------- Restart, gated behind one rewarded ad per attempt ----------
     Pac-Man's Restart, same to same: the tap plays a "restart" video ad
     ("Watch the ad to restart this level."), and only when it finishes is the
     level restarted with a fresh board. Once per attempt: after that the
     button stays disabled until a level is entered fresh (Play, Select
     Level, Prev/Next, Next Level, or Game Over's Retry Level — which is free,
     exactly as in Pac-Man).
     startLevel() resets the flag and re-enables the
     button, like every fresh entry, so both are set back straight after it:
     this restart is the one entry that must leave them used/disabled. */
  if (bottomRestart) bottomRestart.addEventListener('click', () => {
    if (restartAdUsedThisRun) return; // one per attempt
    Sound.tap();
    bottomRestart.disabled = true; // no double-clicks while the ad is up
    playVideoAd('restart', () => {
      startLevel(state.level);
      restartAdUsedThisRun = true;
      bottomRestart.disabled = true;
    }, 'Watch the ad to restart this level.');
  });
  const bottomPrev = $('#bottom-prev');
  if (bottomPrev) bottomPrev.addEventListener('click', () => { Sound.tap(); goToLevelGated(state.level - 1); });
  const bottomNext = $('#bottom-next');
  if (bottomNext) bottomNext.addEventListener('click', () => {
    Sound.tap();
    const next = Math.min(TOTAL_LEVELS, state.level + 1);
    if (next === state.level) return;
    // Pac-Man's in-game Next goes through goToLevelGated(): a locked level
    // is never reached for free from here.
    if (!isLevelUnlocked(next)) { goToLevelGated(next); return; }
    // Same gate as the Level Complete popup's Next Level: every 3rd level.
    // (This used to be a hard-coded [3, 6, 9], so from level 12 on the bar's
    // Next skipped the ad the popup still showed.)
    if (isAdGateLevel(state.level)) playVideoAd('level_gate', () => startLevel(next), 'Unlocks Next Level');
    else startLevel(next);
  });
  const bottomExit = $('#bottom-exit');
  if (bottomExit) bottomExit.addEventListener('click', () => { Sound.tap(); goToLevelSelect(); });
  $('#howto-btn-levels').addEventListener('click', () => { Sound.tap(); howtoOrigin = 'levels-screen'; showScreen('howto-screen'); });

  $('#play-btn').addEventListener('click', () => {
    Sound.tap();
    /* Play means "carry on where I am", and where the player IS is the level
       they have reached — progress.unlocked.
       This used to hand straight over to resumeSession() whenever any saved
       puzzle existed, which quietly turned Play into "reopen whatever board
       was last left unfinished". Replay level 2 from Select Level, wander
       off mid-solve, come back and press Play, and it opened level 2 again
       even though the player was up to level 9. The saved board was real, so
       nothing looked broken — it just sent them backwards.
       A resume is only offered now when it is a resume of the CURRENT level.
       An abandoned replay of an earlier level is not what Play is for; it is
       still there under Select Level, which is where a player goes when they
       actually want an old level back. */
    const s = readSession();
    const target = getFurthestUnlockedLevel(); // Pac-Man: Play -> furthest unlocked level
    const resumable = s && s.inProgress && s.puzzle && s.puzzle.level === target;
    if (!resumable || !resumeSession()) {
      startLevel(target);
    }
  });
  $('#levels-btn').addEventListener('click', () => {
    Sound.tap();
    renderLevelsGrid();
    showScreen('levels-screen');
  });
  $('#shop-btn').addEventListener('click', () => {
    Sound.tap();
    renderShop();
    showShopCategory('themes');
    showScreen('shop-screen');
  });
  $('#shop-tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.shop-tab');
    if (!tab) return;
    Sound.tap();
    showShopCategory(tab.dataset.cat);
  });
  $('#howto-btn').addEventListener('click', () => { Sound.tap(); howtoOrigin = 'home-screen'; showScreen('howto-screen'); });
  $('#howto-close-btn').addEventListener('click', () => { Sound.tap(); showScreen(howtoOrigin); });
  $('#howto-gotit-btn').addEventListener('click', () => { Sound.tap(); showScreen(howtoOrigin); });

  $all('.back-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      Sound.tap();
      const target = btn.dataset.target;
      if (target === 'levels-screen') {
        // Back out of the game: same as Exit. (This used to stop the clock
        // but leave state.running = true, so the board still took input.)
        goToLevelSelect();
        return;
      }
      showScreen(target);
    });
  });

  $('#numpad').addEventListener('click', (e) => {
    const btn = e.target.closest('.num-btn');
    if (!btn) return;
    if (btn.id === 'erase-btn') { eraseCell(); return; }
    const num = Number(btn.dataset.num);
    if (num) inputNumber(num);
  });

  // Keyboard (desktop convenience): 1-9 enter, Backspace/Delete erase,
  // Escape / P pause (Pac-Man's keys). Ignored whenever a popup, the unlock
  // confirm or a video ad is in front of the board — keys used to reach
  // straight through them and fill cells behind it.
  // While paused every key is swallowed before it gets here (see
  // swallowKeysWhilePaused), so this only ever pauses, never resumes.
  document.addEventListener('keydown', (e) => {
    if (!$('#game-screen').classList.contains('active') || isBlockingLayerOpen()) return;
    if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
      e.preventDefault();
      setPaused(true);
    } else if (e.key >= '1' && e.key <= '9') {
      inputNumber(Number(e.key));
    } else if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      eraseCell();
    }
  });

  /* Paused = the keyboard does nothing in the game. Runs in the capture
     phase so it beats every other key handler, and blocks keyup as well as
     keydown because Space activates a focused button on keyup (after a mouse
     click on Pause, focus sits on that button and Space/Enter would resume).
     The only way back is the on-screen Resume button.
     Left alone: browser/OS shortcuts (Ctrl/Cmd/Alt combos, F-keys), and any
     dialog or ad on top of the paused board, which still needs its keys. */
  function swallowKeysWhilePaused(e) {
    if (!gamePaused || !$('#game-screen').classList.contains('active') || isBlockingLayerOpen()) return;
    if (e.ctrlKey || e.metaKey || e.altKey || /^F\d{1,2}$/.test(e.key)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }
  document.addEventListener('keydown', swallowKeysWhilePaused, true);
  document.addEventListener('keyup', swallowKeysWhilePaused, true);
});

/* ===================== GAME LAYOUT: board fills the room it has =====================
   The side ads are ordinary flex items now, so their width is settled by CSS
   and the board column simply gets what is left — no more pinning cards over
   the page and capping the screen to make room for them.
   What is left to JS is the one thing CSS cannot express: the board is a
   SQUARE that has to fit BOTH the column's width and the height still going
   under the top bar and the number pad. Sizing it from the smaller of those
   two is what closes the dead band that used to sit under the grid, and it
   is why the board can now grow well past the old fixed 440px cap.
   The pad's own height depends on the width it is given, so the fit is run
   as a short loop that re-measures rather than solved in one pass. */

/* Ad-card fill colours: the creative is 300x600 and sits at the top of a
   taller card (like Pac-Man's), so the space under it takes the creative's own
   bottom colour and the image fades into it. */
const AD_FILL = {
  'ad-creditkey-banner.png': '#070d59',
  'ad-creditkey-banner-2.png': '#081148',
  'ad-creditkey-banner-3.png': '#0c1969'
};
function paintRailFill(img) {
  const rail = img && img.closest('.side-ad');
  if (!rail) return;
  const name = (img.getAttribute('src') || '').split('/').pop();
  rail.style.backgroundColor = AD_FILL[name] || '#0b1250';
}
['side-ad-left', 'side-ad-right'].forEach((id) => {
  const img = document.querySelector('#' + id + ' .ad-unit-img');
  if (!img) return;
  img.addEventListener('load', () => paintRailFill(img));
  paintRailFill(img);
});

/* Same geometry as Pac-Man's play screen:
   - ad cards 300px wide (scaled down only when the window is short), top-
     aligned with the white board and running the full board height;
   - two cards while the middle lane stays wide enough for the grid, else one
     card on the right (Pac-Man does the same at 1024x768);
   - stats bar 62px tall, 8px from the edges (54px on a portrait phone);
   - the 9x9 grid fills the white lane, cells stretching as needed. */
function fitGameLayout() {
  const gameScreen = document.getElementById("game-screen");
  const column = document.getElementById("game-column");
  const board = document.getElementById("sudoku-board");
  const numpad = document.getElementById("numpad");
  if (!gameScreen || !column || !board || !numpad || !gameScreen.classList.contains("active")) return;

  const vw = document.documentElement.clientWidth || window.innerWidth;
  const vh = document.documentElement.clientHeight || window.innerHeight;
  /* The bottom bar is Pac-Man's now: a fixed height set by CSS (joystick
     token + padding, tier by tier — 62px on a laptop, 64 on a small tablet,
     54 on a phone ...). Measured rather than guessed, so the board and pad
     always stop exactly above it. The old fixed guesses are only a fallback. */
  const barEl = document.getElementById("pacman-gamebar");
  const barMeasured = barEl ? Math.ceil(barEl.getBoundingClientRect().height) : 0;
  // +6: a small breathing gap so the number pad never sits flush on the bar.
  const barH = barMeasured ? barMeasured + 6 : (vw <= 559 ? 44 : (vw <= 820 ? 50 : 62));
  gameScreen.style.setProperty("--bar-h", barH + "px");

  const isPortrait = vh > vw;
  const topbar = document.querySelector("#game-screen .game-topbar");
  const topbarVisible = !!topbar && getComputedStyle(topbar).display !== "none";
  const topbarH = topbarVisible ? Math.max(42, Math.ceil(topbar.getBoundingClientRect().height || 48)) : 0;

  /* The board should visually fill the white lane.  Width and height are
     calculated independently so landscape screens do not leave a large white
     strip simply because a square board was capped by the shorter dimension. */
  function fitBoard(laneW, availableH) {
    const laneInset = 2;
    const boardW = Math.max(180, Math.floor(laneW - laneInset * 2));

    /* Keep the complete number pad visible. Its actual rendered height is
       measured after the board is placed, so reserve a safe touch-control
       budget here. */
    const padGap = vw <= 559 ? 5 : 7;
    /* Reserve an estimate of the keypad's footprint; placeLane() measures the
       real pad afterwards and hands the board exactly what is left. */
    const padWidth = Math.max(180, Math.floor(laneW - laneInset * 2));
    let padH;
    if (vw <= 559) {
      /* Phones: all 1-9/X controls stay on ONE row. Keep the row compact
         so the 9x9 matrix can use the reclaimed vertical space, while the
         buttons remain comfortably tappable. */
      const keyGap = 4;
      const keyW = Math.max(28, Math.floor((padWidth - keyGap * 9) / 10));
      padH = Math.max(38, Math.min(48, Math.ceil(keyW * 0.92)));
    } else if (vw >= 560 && vw <= 820 && !isPortrait) {
      /* Tablet landscape: keep the keypad inside the white play panel. */
      padH = 54;
    } else {
      const keyGap = 7;
      const keyW = Math.max(48, Math.floor((padWidth - keyGap * 9) / 10));
      padH = Math.min(82, Math.max(62, Math.ceil(keyW * 0.92)));
    }
    const boardH = Math.max(180, Math.floor(availableH - padH - padGap - laneInset * 2));
    return { w: boardW, h: boardH };
  }

  /* ================= Pac-Man's game-screen geometry =================
     Same numbers Pac-Man's fitSideRailsInner() / placeLeaderboardTop() /
     layoutLandscapeGame() work out, so the ad(s), the white play lane and the
     bar sit in exactly the same boxes at every size — phone, tablet, laptop,
     desktop, either way up:
       frame   8px all round (4px page + 4px screen), bar fixed by CSS at
               the bottom, 6px between the play area and the bar;
       portrait  one LEADER_BOARD 970x90 across the top, scaled as a whole
               to the width (and never so tall that the board could not keep
               Pac-Man's flattest shape), 5px above and below it; the play
               lane takes all the width and every pixel of height left;
       landscape one 300x600 card beside the lane (two only when one card
               would leave the lane more than 1.4x wider than tall), its
               width following the lane's height (1:2), the lane taking the
               rest of the width up to 2:1 on tablets/desktop, the whole
               [ad | lane | ad] group centred.
     The lane is filled by the board + number pad (fitBoard), so the space
     Pac-Man gives its maze is used by the Sudoku grid with nothing left
     over. */
  const FRAME = 8, AD_GAP = 8;
  // Pac-Man: 6px between the play area and the bar, 4px on a short landscape
  // screen ((orientation: landscape) and (max-height: 520px)).
  const ROW_GAP = (!isPortrait && vh <= 520) ? 4 : 6;
  const RAIL_W = 300, LEADER_W = 970, LEADER_H = 90, LEADER_MARGIN = 5;
  const MIN_SCALE = 0.22;
  const MIN_ASPECT = 0.928785206993315;  // Pac-Man minBoardAspect()
  const MAX_ASPECT = 1.2881958922098347; // Pac-Man maxBoardAspect()
  const barPx = (barEl ? barEl.offsetHeight : 0) || (barH - 6); // Pac-Man reads the bar's offsetHeight
  const innerW = Math.max(0, vw - FRAME * 2);
  const fullH = Math.max(40, vh - FRAME * 2 - barPx - ROW_GAP); // play height with no band
  const isPhone = Math.min(vw, vh) <= 500;                      // Pac-Man isPhoneWidth()
  const set = (k, v) => gameScreen.style.setProperty(k, v);
  const lb = document.getElementById("ad-leaderboard");
  const railL = document.getElementById("side-ad-left");
  const railR = document.getElementById("side-ad-right");
  const hideRails = () => { [railL, railR].forEach((r) => r && r.classList.remove("pm-rail-on")); };

  function placeLeaderboard() {
    const boardW = Math.min(1360, Math.min(1400, vw) - FRAME) - FRAME;
    const bandCeiling = Math.max(0, fullH - boardW / MAX_ASPECT - 4);
    let scale = Math.min(1, bandCeiling / LEADER_H, vw / LEADER_W);
    scale = Math.floor(Math.max(0, scale) * 1000) / 1000;
    if (scale < MIN_SCALE || !lb) { if (lb) lb.classList.remove("pm-lb-on"); return 0; }
    const w = Math.round(LEADER_W * scale), h = Math.round(LEADER_H * scale);
    set("--pm-lb-w", w + "px");
    set("--pm-lb-x", Math.round((vw - w) / 2) + "px");
    set("--pm-lb-y", LEADER_MARGIN + "px");
    lb.classList.add("pm-lb-on");
    return h + 2 * LEADER_MARGIN;
  }

  function placeLane(x, y, w, h, side) {
    set("--pm-lane-x", x + "px");
    set("--pm-lane-y", y + "px");
    set("--pm-lane-w", w + "px");
    set("--pm-lane-h", h + "px");
    column.classList.toggle("pad-side", !!side);
    if (side) {
      /* LANDSCAPE: the 1-9/X pad stands beside the 9x9 grid, so the grid
         gets the lane's FULL height (taller boxes) and the pad's column is
         the only width it gives up. */
      const sp = side;
      set("--play-h", h + "px");
      set("--lane-x", x + "px");
      column.style.width = w + "px";
      column.style.setProperty("--play-central-w", w + "px");
      column.style.setProperty("--board-w", sp.boardW + "px");
      column.style.setProperty("--board-h", sp.boardH + "px");
      column.style.setProperty("--pad-cols", String(sp.cols));
      column.style.setProperty("--pad-rows", String(sp.rows));
      column.style.setProperty("--pad-w", sp.padW + "px");
      column.style.setProperty("--pad-key-gap", sp.keyGap + "px");
      column.style.setProperty("--pad-side-gap", sp.padGap + "px");
      column.style.setProperty("--pad-fs", sp.fontPx + "px");
      column.classList.add("fill-lane");
      return;
    }
    const size = fitBoard(w, h - topbarH - 2);
    set("--play-h", h + "px");
    set("--lane-x", x + "px");
    column.style.width = w + "px";
    column.style.setProperty("--play-central-w", w + "px");
    column.style.setProperty("--board-w", size.w + "px");
    column.style.setProperty("--board-h", size.h + "px");
    column.classList.add("fill-lane");
    /* fitBoard() only estimates the number pad's height; the pad's real
       height comes from CSS tiers. Measure it now it is laid out and give
       the board exactly what is left of the lane, so board + pad fill the
       lane edge to edge with nothing overflowing and no band left over. */
    const cs = getComputedStyle(column);
    const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    const npCs = getComputedStyle(numpad);
    const npH = numpad.getBoundingClientRect().height + (parseFloat(npCs.marginTop) || 0) + (parseFloat(npCs.marginBottom) || 0);
    const bdCs = getComputedStyle(board);
    const bdM = (parseFloat(bdCs.marginTop) || 0) + (parseFloat(bdCs.marginBottom) || 0);
    const tb = topbarVisible ? topbar.getBoundingClientRect().height : 0;
    const exactH = Math.floor(h - padY - npH - bdM - tb);
    if (exactH > 120) column.style.setProperty("--board-h", exactH + "px");
  }

  /* Landscape side-pad geometry. innerW/innerH are the lane's inner box
     (lane minus its 2px padding). The pad is one column of 10 keys when the
     keys stay comfortably tall, otherwise two columns of five (short
     screens such as phones on their side). The grid takes the full height;
     its width is what is left beside the pad, capped so the boxes never
     turn into wide slabs — any width beyond that first widens the keys and
     only then is handed back (slack) so the lane can be narrowed and the
     whole group re-centred instead of leaving a white band. */
  const LANE_PAD = 2;
  /* The side pad / single-ad landscape layout is for PHONES and TABLETS only
     (a touch screen, i.e. a coarse primary pointer). Desktop and laptop
     windows keep the original landscape layout untouched. */
  const touchDevice = (() => {
    try {
      return window.matchMedia("(pointer: coarse)").matches ||
        (navigator.maxTouchPoints > 0 && window.matchMedia("(hover: none)").matches) ||
        /Android|iPhone|iPad|iPod|Mobile|Tablet|Silk|Kindle|Opera Mini|IEMobile/i.test(navigator.userAgent || "");
    } catch (e) { return false; }
  })();
  /* PHONE LANDSCAPE only: a touch device whose short side is 500px or less
     (Pac-Man's isPhoneWidth()). Tablets and desktops — including tablet-sized
     windows in a browser's device-emulation mode — keep the original layout. */
  const mobileLandscape = !isPortrait && touchDevice && isPhone;
  function sidePadGeometry(innerW, innerH) {
    const shortScreen = vh <= 520;
    const keyGap = shortScreen ? 5 : 7;
    const padGap = shortScreen ? 6 : 8;
    const oneColKeyH = (innerH - 9 * keyGap) / 10;
    const cols = oneColKeyH >= 46 ? 1 : 2;
    const rows = 10 / cols;
    const keyH = (innerH - (rows - 1) * keyGap) / rows;
    let keyW = Math.round(Math.max(56, Math.min(104, keyH * 1.2)));
    const maxKeyW = Math.round(Math.max(keyW, Math.min(120, keyH * 1.6)));
    /* Phones: no width cap — the grid takes ALL the width beside the pad so
       there is no empty space on either side (the boxes grow wider).
       Tablets keep their cap. */
    const maxBoardW = isPhone ? Infinity : Math.floor(innerH * 1.2);
    let padW = cols * keyW + (cols - 1) * keyGap;
    let boardW = innerW - padW - padGap;
    if (boardW > maxBoardW) {
      const extraPerKey = Math.floor((boardW - maxBoardW) / cols);
      keyW = Math.min(maxKeyW, keyW + extraPerKey);
      padW = cols * keyW + (cols - 1) * keyGap;
      boardW = Math.min(maxBoardW, innerW - padW - padGap);
    }
    boardW = Math.max(160, Math.floor(boardW));
    const slack = Math.max(0, Math.floor(innerW - (boardW + padW + padGap)));
    const fontPx = Math.round(Math.max(16, Math.min(34, Math.min(keyH, keyW) * 0.42)));
    return { cols, rows, keyW, padW, keyGap, padGap, boardW, boardH: Math.floor(innerH), slack, fontPx };
  }
  /* Width the lane needs so the grid next to the pad keeps at least
     Pac-Man's flattest board shape (MIN_ASPECT). */
  function sidePadLaneNeed(laneH) {
    const innerH = laneH - LANE_PAD * 2;
    const g = sidePadGeometry(99999, innerH);
    return Math.ceil(innerH * MIN_ASPECT + g.padW + g.padGap + LANE_PAD * 2);
  }
  function placeSideLane(x, y, w, h) {
    const g = sidePadGeometry(w - LANE_PAD * 2, h - LANE_PAD * 2);
    placeLane(x, y, w, h, g);
  }

  function desktopLandscapeLayout() {
    const Hm = Math.floor(fullH);
    let cardW = Math.min(RAIL_W, Math.floor(Hm / 2));
    let n = 1;
    const w1 = innerW - (cardW + AD_GAP);
    const w2 = innerW - 2 * (cardW + AD_GAP);
    if (w2 >= Hm * 1.0 && w1 > Hm * 1.4) n = 2;
    if (n === 1 && w1 < Hm * MIN_ASPECT) cardW = Math.floor(innerW - AD_GAP - Hm * MIN_ASPECT);
    let scale = Math.floor((cardW / RAIL_W) * 1000) / 1000;
    if (scale < MIN_SCALE) { leaderboardLayout(); return; }
    cardW = RAIL_W * scale;

    let laneW = Math.floor(innerW - n * (cardW + AD_GAP));
    if (!isPhone) laneW = Math.min(laneW, Math.floor(Hm * 2));
    const groupW = laneW + n * (cardW + AD_GAP);
    const lead = Math.max(0, Math.floor((innerW - groupW) / 2));
    const laneX = FRAME + lead + (n === 2 ? cardW + AD_GAP : 0);

    gameScreen.classList.toggle("rails-2", n === 2);
    gameScreen.classList.toggle("rails-1", n === 1);
    gameScreen.classList.toggle("rail-tall", Hm > cardW * 2 + 4);
    set("--rail-w", cardW + "px");
    set("--pm-rail-w", cardW + "px");
    set("--pm-rail-h", Hm + "px");
    set("--pm-rail-y", FRAME + "px");
    set("--pm-rail-lx", Math.round(FRAME + lead) + "px");
    set("--pm-rail-rx", Math.round(laneX + laneW + AD_GAP) + "px");
    if (railL) railL.classList.toggle("pm-rail-on", n === 2);
    if (railR) railR.classList.add("pm-rail-on");
    placeLane(laneX, FRAME, laneW, Hm);
  }

  function leaderboardLayout() {
    hideRails();
    gameScreen.classList.remove("rails-2", "rails-1", "rail-tall");
    gameScreen.classList.add("portrait-layout");
    set("--rail-w", "0px");
    const band = placeLeaderboard();
    set("--ad-band", band + "px");
    const laneH = Math.max(200, fullH - band);
    if (!mobileLandscape) { placeLane(FRAME, FRAME + band, innerW, laneH); return; }
    // Landscape without room for a side card: pad still sits beside the grid,
    // and any width the grid cannot use closes up around the centre.
    const g = sidePadGeometry(innerW - LANE_PAD * 2, laneH - LANE_PAD * 2);
    const w = innerW - g.slack;
    placeLane(FRAME + Math.floor(g.slack / 2), FRAME + band, w, laneH, g);
  }

  if (isPortrait) { column.classList.remove("pad-side"); leaderboardLayout(); return; }

  gameScreen.classList.remove("portrait-layout");
  if (lb) lb.classList.remove("pm-lb-on");
  set("--ad-band", "0px");

  if (!mobileLandscape) {
    /* Desktop / laptop landscape: the original layout, unchanged. */
    column.classList.remove("pad-side");
    desktopLandscapeLayout();
    return;
  }

  const Hm = Math.floor(fullH);
  let cardW = Math.min(RAIL_W, Math.floor(Hm / 2));
  /* Phone / tablet landscape: the left-side ad is removed — always ONE card, on the right. */
  const n = 1;
  const w1 = innerW - (cardW + AD_GAP);
  const laneNeed = sidePadLaneNeed(Hm);
  if (w1 < laneNeed) cardW = Math.floor(innerW - AD_GAP - laneNeed);
  let scale = Math.floor((cardW / RAIL_W) * 1000) / 1000;
  if (scale < MIN_SCALE) { leaderboardLayout(); return; }
  cardW = RAIL_W * scale;

  let laneW = Math.floor(innerW - n * (cardW + AD_GAP));
  if (!isPhone) laneW = Math.min(laneW, Math.floor(Hm * 2));
  // Hand back any width the grid + pad cannot use, so the [lane | ad] group
  // closes up and centres rather than leaving a white band inside the lane.
  const sideGeo = sidePadGeometry(laneW - LANE_PAD * 2, Hm - LANE_PAD * 2);
  laneW -= sideGeo.slack;
  const groupW = laneW + n * (cardW + AD_GAP);
  const lead = Math.max(0, Math.floor((innerW - groupW) / 2));
  const laneX = FRAME + lead + (n === 2 ? cardW + AD_GAP : 0);

  gameScreen.classList.toggle("rails-2", n === 2);
  gameScreen.classList.toggle("rails-1", n === 1);
  gameScreen.classList.toggle("rail-tall", Hm > cardW * 2 + 4);
  set("--rail-w", cardW + "px");
  set("--pm-rail-w", cardW + "px");
  set("--pm-rail-h", Hm + "px");
  set("--pm-rail-y", FRAME + "px");
  set("--pm-rail-lx", Math.round(FRAME + lead) + "px");
  set("--pm-rail-rx", Math.round(laneX + laneW + AD_GAP) + "px");
  if (railL) railL.classList.remove("pm-rail-on");
  if (railR) railR.classList.add("pm-rail-on");
  placeSideLane(laneX, FRAME, laneW, Hm);
}

/* Placing the board changes the column's own box, which would wake the
   observer that placed it — the depth guard is what keeps that from
   becoming a loop. */
let layoutDepth = 0;
function refitGameLayout() {
  if (layoutDepth > 2) return;
  layoutDepth++;
  try { fitGameLayout(); } finally { layoutDepth--; }
}
window.addEventListener("resize", refitGameLayout);
window.addEventListener("orientationchange", refitGameLayout);
window.addEventListener("orientationchange", () => setTimeout(refitGameLayout, 150));
window.addEventListener("load", refitGameLayout);
window.addEventListener("pageshow", () => refitGameLayout());
if (document.fonts && document.fonts.ready) document.fonts.ready.then(refitGameLayout);
/* Pac-Man also listens to visualViewport's own resize: on several real
   phones it fires with the correct size sooner than window's resize when the
   browser's address bar shows/hides or the phone is rotated, so the board and
   bar are re-fitted to what is actually visible. */
if (window.visualViewport) window.visualViewport.addEventListener("resize", refitGameLayout);
/* The board's width is measured from what is left after the cards, so a
   creative that has not decoded yet reports a different box than the one
   the player ends up looking at. */
["side-ad-left", "side-ad-right"].forEach((id) => {
  const img = document.querySelector("#" + id + " img");
  if (img && !img.complete) img.addEventListener("load", refitGameLayout, { once: true });
});
if (typeof ResizeObserver === "function") {
  const gs = document.getElementById("game-screen");
  if (gs) new ResizeObserver(() => refitGameLayout()).observe(gs);
}

refitGameLayout();

function touchSession(patch) {
  session.lastSeenAt = Date.now();
  if (patch) Object.assign(session, patch);
  writeSession(session);
}

function sessionSummary() {
  const mins = Math.max(0, Math.round((Date.now() - session.startedAt) / 60000));
  return { id: session.id, minutes: mins, levelsCleared: session.levelsCleared,
           lastLevel: session.lastLevel };
}
window.sessionSummary = sessionSummary;

/* ---------- Resuming a mid-solve puzzle within the session window ---------- */

function snapshotPuzzle() {
  return {
    level: state.level, clues: state.clues,
    given: state.given, board: state.board, solution: state.solution,
    mistakes: state.mistakes, totalMistakes: state.totalMistakes || state.mistakes || 0,
    seconds: state.seconds,
    adContinuesUsed: state.adContinuesUsed || 0,
  };
}

// Cheap enough to call after any move — just re-stamps the session with
// the current board so a resume within 24h picks up exactly where the
// player left off.
function syncSessionPuzzle() {
  touchSession({ puzzle: snapshotPuzzle() });
}

// Play button uses this first: if the last sitting is still within its
// 24h window AND left a puzzle mid-solve, pick it back up rather than
// generating a new one. Past that window readSession() itself returns
// null, so this naturally falls through to a fresh start.
function resumeSession() {
  const s = readSession();
  if (!s || !s.inProgress || !s.puzzle) return false;
  const p = s.puzzle;

  // A damaged snapshot must not open a broken board — start fresh instead.
  if (![p.given, p.board, p.solution].every((a) => Array.isArray(a) && a.length === 81)) return false;

  state.level = p.level;
  state.clues = p.clues;
  state.given = p.given;
  state.board = p.board;
  state.solution = p.solution;
  state.mistakes = p.mistakes || 0;
  state.totalMistakes = Math.max(state.mistakes, p.totalMistakes || 0);
  state.seconds = p.seconds || 0;
  state.adContinuesUsed = p.adContinuesUsed || 0;
  enterGame();
  return true;
}

/* Keep it alive while the game is actually being used, and stamp it on the
   way out so a refresh a moment later still counts as the same sitting. */
['click', 'keydown', 'touchstart'].forEach(ev =>
  window.addEventListener(ev, () => touchSession(), { passive: true }));
window.addEventListener('beforeunload', () => touchSession());
document.addEventListener('visibilitychange', () => { if (!document.hidden) touchSession(); });
setInterval(() => { if (!document.hidden) touchSession(); }, 60000);

/* ---------- Hold the game top bar to ONE line ----------
   Measured, not guessed. The bar is laid out at the largest unit first and
   the overflow is read DIRECTLY — how far past the bar's content edge the
   last group actually lands. Summing the children's widths does not work:
   they are flex items, so when the bar runs short they shrink instead of
   overflowing it, and the bar reports that everything fits while its
   contents are being squashed.
   The floor stops it shrinking into illegibility; at the floor it stays on
   one line regardless, because wrapping there buys no legibility back and
   costs a whole row of height. */
const BAR_U_MAX = 16, BAR_U_MIN = 9;

function fitTopBar() {
  const bar = document.querySelector("#game-screen .game-topbar");
  if (!bar || !bar.offsetParent) return;
  const groups = bar.children;
  if (!groups.length) return;

  let u = BAR_U_MAX;
  bar.style.setProperty("--bar-u", u + "px");
  bar.style.flexWrap = "nowrap";

  const cs = getComputedStyle(bar);
  const padL = parseFloat(cs.paddingLeft) || 0;
  const padR = parseFloat(cs.paddingRight) || 0;

  const overflow = () => {
    const box = bar.getBoundingClientRect();
    let furthest = box.left + padL;
    for (let i = 0; i < groups.length; i++) {
      furthest = Math.max(furthest, groups[i].getBoundingClientRect().right);
    }
    return furthest - (box.right - padR);
  };

  for (let pass = 0; pass < 6; pass++) {
    const over = overflow();
    if (over <= 0.5) break;
    const inner = bar.clientWidth - padL - padR;
    if (inner <= 0) break;
    const next = Math.min(u * ((inner - 1) / (inner + over)), u - 0.15);
    if (next <= BAR_U_MIN) { u = BAR_U_MIN; bar.style.setProperty("--bar-u", u + "px"); break; }
    u = next;
    bar.style.setProperty("--bar-u", u + "px");
  }

  bar.style.flexWrap = u <= BAR_U_MIN + 0.01 ? "nowrap" : (overflow() > 0.5 ? "wrap" : "nowrap");
}

window.addEventListener("resize", fitTopBar);
window.addEventListener("orientationchange", fitTopBar);
window.addEventListener("load", fitTopBar);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitTopBar);
if (typeof ResizeObserver === "function") {
  const bar = document.querySelector("#game-screen .game-topbar");
  if (bar) new ResizeObserver(() => fitTopBar()).observe(bar);
}


/* ===================== UNLOCK A LOCKED LEVEL WITH 5 ADS =====================
   Pac-Man's flow, same to same (goToLevelGated / showUnlockConfirm /
   unlockLevelViaAds in Pac-Man's script.js):
     1. Tapping an ad-unlockable locked level (Select Level tile, in-game
        Prev / Next, the Level Complete popup's Previous) does NOT start the
        ads. It first pops the confirmation dialog — "📺 Unlock Level N",
        "Watch 5 ads to unlock this level and continue the game.", "You'll
        watch 5 short ads back to back, then Level N unlocks and you can play
        it." — so the player opts in.
     2. Cancel just closes the dialog; whatever was behind it is untouched.
     3. OK closes it, runs the caller's onConfirm, and plays
        UNLOCK_ADS_REQUIRED "recover" video ads back to back — never fewer,
        and none can be tapped past, because each waits on the previous
        ad's promise. The whole level grid is disabled while they play.
     4. After the fifth, ONLY that level is unlocked (nothing before or after
        it changes) and the player is dropped straight into it. */
const confirmOverlayEl = document.getElementById('confirmOverlay');
const confirmTitleEl = document.getElementById('confirmTitle');
const confirmMessageEl = document.getElementById('confirmMessage');
const confirmSubMessageEl = document.getElementById('confirmSubMessage');
let confirmOkBtn = document.getElementById('confirmOkBtn');
let confirmCancelBtn = document.getElementById('confirmCancelBtn');

/* Pac-Man's prev/next disabled rule (updateUI): Prev off on level 1, Next
   off unless the next level is already unlocked. */
function updateLevelNavButtons() {
  const prev = document.getElementById('bottom-prev');
  const next = document.getElementById('bottom-next');
  // Off when the level before can't be opened at all (locked and not
  // ad-unlockable, e.g. a gap left behind an ads-unlocked level); it used to
  // stay enabled there and silently do nothing.
  if (prev) prev.disabled = state.level <= 1 || !isLevelReachable(state.level - 1);
  if (next) next.disabled = !isLevelUnlocked(state.level + 1);
}

/* Every way of jumping to a specific level goes through here, exactly like
   Pac-Man: unlocked -> go straight there; locked but ad-unlockable -> the
   5-ads confirm; locked and not ad-unlockable -> nothing. */
function goToLevelGated(level, opts) {
  const closeOverlay = opts && opts.closeOverlay;
  if (level < 1 || level > TOTAL_LEVELS || levelUnlockInProgress) return;
  if (isLevelUnlocked(level)) {
    if (closeOverlay) closeOverlay();
    startLevel(level);
    return;
  }
  if (isLevelAdUnlockable(level)) {
    // Don't close the calling popup yet — only once the player commits by
    // pressing OK. Cancel leaves it exactly as it was.
    showUnlockConfirm(level, { onConfirm: closeOverlay || null });
  }
}

function showUnlockConfirm(level, opts) {
  const onConfirm = opts && opts.onConfirm ? opts.onConfirm : null;
  if (levelUnlockInProgress) return;
  if (!confirmOverlayEl) {
    // Safety net: if the dialog markup is ever missing, fall straight
    // through to the ad sequence rather than stranding the player.
    if (onConfirm) onConfirm();
    unlockLevelViaAds(level);
    return;
  }

  confirmTitleEl.textContent = '\u{1F4FA} Unlock Level ' + level;
  confirmMessageEl.textContent =
    'Watch ' + UNLOCK_ADS_REQUIRED + ' ads to unlock this level and continue the game.';
  if (confirmSubMessageEl) {
    confirmSubMessageEl.textContent =
      "You'll watch " + UNLOCK_ADS_REQUIRED + ' short ads back to back, then Level ' + level + ' unlocks and you can play it.';
    confirmSubMessageEl.classList.remove('hidden');
  }

  // Clone-and-replace: a stale OK / Cancel handler from the last tile tapped
  // can never leak into this one, so the right level always gets unlocked.
  const freshOk = confirmOkBtn.cloneNode(true);
  confirmOkBtn.replaceWith(freshOk);
  confirmOkBtn = freshOk;
  const freshCancel = confirmCancelBtn.cloneNode(true);
  confirmCancelBtn.replaceWith(freshCancel);
  confirmCancelBtn = freshCancel;

  const close = () => confirmOverlayEl.classList.add('hidden');

  confirmOkBtn.addEventListener('click', () => {
    close();
    if (onConfirm) onConfirm();
    unlockLevelViaAds(level);
  });
  confirmCancelBtn.addEventListener('click', close);

  confirmOverlayEl.classList.remove('hidden');
}

function unlockLevelViaAds(level) {
  if (levelUnlockInProgress) return;
  levelUnlockInProgress = true;
  renderLevelsGrid(); // redraw so every tile is non-interactive while ads play

  let watched = 0;
  function playNext() {
    watched++;
    return playVideoAdP(
      'recover',
      'Watching ad ' + watched + ' of ' + UNLOCK_ADS_REQUIRED + ' to unlock Level ' + level + '\u2026'
    ).then(() => (watched < UNLOCK_ADS_REQUIRED ? playNext() : null));
  }

  playNext().then(() => {
    levelUnlockInProgress = false;
    unlockLevel(level); // unlocks ONLY this level — nothing before it changes
    saveProgress(progress);
    renderLevelsGrid(); // redraw: level+1 immediately drops off the ads list
    startLevel(level);
  });
}


/* ===================== PAUSE (Pac-Man's setPaused) =====================
   No popup: the board stays on screen, frozen — the clock stops and number
   input / erase are ignored — and the Pause button itself turns into
   the yellow "▶ Resume" (.is-paused). Esc / P pause from the keyboard, but
   only the Resume button carries on — every key is ignored while paused. Starting a level or leaving the game clears it. */

function setPaused(next, silent) {
  const btn = document.getElementById('bottom-pause');
  if (next && !gamePaused && !state.running) return; // nothing running to pause (won / lost / not started)
  gamePaused = !!next;
  if (btn) {
    /* Icon and word in separate spans so the narrow-bar tiers can hide the
       word and keep the icon — identical to Pac-Man's setPaused(). */
    btn.innerHTML = gamePaused
      ? '<span class="pm-ico">\u25B6</span><span class="pm-lbl">Resume</span>'
      : '<span class="pm-ico">\u23F8</span><span class="pm-lbl">Pause</span>';
    btn.setAttribute('aria-pressed', String(gamePaused));
    btn.setAttribute('title', gamePaused ? 'Resume' : 'Pause');
    btn.classList.toggle('pm-is-paused', gamePaused);
  }
  if (silent) return; // flag + button only; the clock is left alone
  if (gamePaused) {
    state.running = false;
    stopTimer();
  } else if ($('#game-screen').classList.contains('active')) {
    state.running = true;
    startTimer();
  }
}

/* ===================== GAME OVER (Pac-Man's handleGameOver) =====================
   Pac-Man's #overlay popup and flow, same to same:
     - the game-over sound plays straight away, then after a 150ms beat the
       popup opens: "Game Over 💀", "... on Level N. Try again?";
     - "▶ Watch Ad & Continue" is offered on EVERY Game Over (no limit);
       each watched ad restores the full 5-mistake allowance;
     - "🔁 Retry Level" restarts this level, "🗺 Level Select" and the ×
       both go to Select Level.
   Continuing keeps the SAME board and clock and resets mistakes to 0/5. */
const overlayEl = document.getElementById('overlay');
const modalTitleEl = document.getElementById('modalTitle');
const modalMessageEl = document.getElementById('modalMessage');
const continueAdBtn = document.getElementById('continueAdBtn');
const continueNoteEl = document.getElementById('continueNote');
let modalPrimaryBtn = document.getElementById('modalPrimaryBtn');
let modalSecondaryBtn = document.getElementById('modalSecondaryBtn');

function wireModalButtons(primaryLabel, secondaryLabel, onPrimary, onSecondary) {
  modalPrimaryBtn.textContent = primaryLabel;
  modalSecondaryBtn.textContent = secondaryLabel;
  setModalPrevLevel(0);
  const newPrimary = modalPrimaryBtn.cloneNode(true);
  modalPrimaryBtn.replaceWith(newPrimary);
  modalPrimaryBtn = newPrimary;
  modalPrimaryBtn.addEventListener('click', onPrimary);
  const newSecondary = modalSecondaryBtn.cloneNode(true);
  modalSecondaryBtn.replaceWith(newSecondary);
  modalSecondaryBtn = newSecondary;
  modalSecondaryBtn.addEventListener('click', onSecondary);
}

function hideOverlay() {
  clearTimeout(gameOverTimer);
  gameOverTimer = null;
  stopModalBannerCarousel();
  const el = document.getElementById('overlay');
  if (el) el.classList.add('hidden');
}

function goToLevelSelect() {
  hideOverlay();
  leaveGame();
  renderLevelsGrid();
  showScreen('levels-screen');
}

function handleGameOver() {
  Sound.fail();
  // This attempt is dead-ended, not just paused — don't offer to resume
  // straight back into a lost board next time Play is tapped. (The board is
  // still saved, so Watch Ad & Continue can pick it back up.)
  touchSession({ inProgress: false, puzzle: snapshotPuzzle() });
  clearTimeout(gameOverTimer);
  gameOverTimer = setTimeout(() => {
    gameOverTimer = null;
    modalTitleEl.textContent = 'Game Over \u{1F480}';
    // Same dialog as Congratulations: its coins line and MREC are not part of
    // Game Over, and the MREC's rotation stops here (Pac-Man).
    document.getElementById('modalCoins').classList.add('hidden');
    const banner = document.getElementById('modalBannerAd');
    banner.classList.add('hidden');
    banner.innerHTML = '';
    stopModalBannerCarousel();
    modalMessageEl.textContent = `Out of tries on Level ${state.level}. Try again?`; // Pac-Man: "You scored N on Level N. Try again?"

    // Unlimited ad continues: the button is offered on every Game Over.
    continueAdBtn.classList.remove('hidden');
    continueAdBtn.disabled = false;
    continueNoteEl.classList.remove('hidden');
    continueNoteEl.textContent = 'Watch a short ad to pick up right where you were \u2014 with ' +
      MAX_MISTAKES + ' mistakes available again.';

    wireModalButtons(
      '\u{1F501} Retry Level',
      '\u{1F5FA} Level Select',
      () => { Sound.tap(); hideOverlay(); startLevel(state.level); },
      () => { Sound.tap(); goToLevelSelect(); }
    );
    overlayEl.classList.remove('hidden');
  }, 150);
}

function grantContinue() {
  // No cap: every Game Over can be continued by watching the ad.
  state.adContinuesUsed = (state.adContinuesUsed || 0) + 1;
  continueAdBtn.disabled = true;
  hideOverlay();
  playVideoAd('continue', () => {
    state.mistakes = 0; // full MAX_MISTAKES (5) allowance again after each continue
    $('#mistakes').textContent = `${state.mistakes}/${MAX_MISTAKES}`;
    syncBottomGameBar();
    state.running = true;
    startTimer();
    touchSession({ inProgress: true, puzzle: snapshotPuzzle() });
  }, 'Watch the ad to continue this attempt \u2014 your board and time are kept.');
}
if (continueAdBtn) continueAdBtn.addEventListener('click', () => { Sound.tap(); grantContinue(); });

const modalCloseX = document.getElementById('modalCloseX');
if (modalCloseX) modalCloseX.addEventListener('click', () => { Sound.tap(); goToLevelSelect(); });


/* ===================== CONGRATULATIONS (Pac-Man's handleLevelWin) =====================
   The SAME #overlay popup as Game Over, filled in the way Pac-Man fills it
   when a level is cleared:
     - win sound straight away, popup after the same 150ms beat;
     - "🎉 Congratulations!", one line about the level just cleared (Pac-Man:
       "Level N cleared with a score of X. Level N+1 is now unlocked." —
       Sudoku has no score, so its time and star rating stand in), then
       "+N 🪙 coins";
     - the 300x250 MREC ("level_complete_banner"), rotating every 5s while
       the popup is open, with Pac-Man's slot dots;
     - ONE row of buttons: "Next Level ➡", "⬅ Level N" (from level 2 up, and
       through the same ads gate as Select Level), "🗺 Levels"; on the last
       level the primary becomes "🗺 Levels" too;
     - Next Level after a level that is a multiple of 3 plays the
       "level_gate" video first (Pac-Man's isAdGateLevel);
     - the × goes to Select Level.
   Everything Sudoku works out on a win — stars, coins and their bonuses,
   the unlock, the Expert achievement — is unchanged (checkWin). */
let modalBannerCarouselTimer = null;

function isAdGateLevel(level) {
  return level % 3 === 0; // Pac-Man: every 3rd level
}

function setModalPrevLevel(level) {
  let btn = document.getElementById('modalPrevBtn');
  if (!btn) return;
  const fresh = btn.cloneNode(true);
  btn.replaceWith(fresh);
  btn = fresh;
  if (!level || level < 1) {
    btn.classList.add('hidden');
    return;
  }
  btn.textContent = '\u2B05 Level ' + level;
  btn.classList.remove('hidden');
  btn.addEventListener('click', () => {
    Sound.tap();
    // Same ads gate as Select Level / the in-game Prev-Next buttons.
    goToLevelGated(level, { closeOverlay: hideOverlay });
  });
}

function adDotsHtml(ad) {
  if (!ad || !(ad._slots > 1)) return '';
  let h = '<div class="pm-ad-dots" aria-hidden="true">';
  for (let i = 0; i < ad._slots; i++) h += '<i' + (i === ad._slot ? ' class="pm-on"' : '') + '></i>';
  return h + '</div>';
}
function buildBannerCard(el, ad) {
  el.classList.remove('hidden');
  el.innerHTML = '<img class="pm-ad-unit-img" src="' + ad.imageUrl + '" width="300" height="250" alt="' +
    (ad.advertiser || 'Advertisement') + '" />' + adDotsHtml(ad);
}
function swapAdCard(el, build) {
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce || !el.innerHTML) { build(); return; }
  el.classList.add('pm-ad-fading');
  setTimeout(() => {
    build();
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('pm-ad-fading')));
  }, 260);
}
function stopModalBannerCarousel() {
  if (modalBannerCarouselTimer) { clearInterval(modalBannerCarouselTimer); modalBannerCarouselTimer = null; }
}
function startModalBannerCarousel() {
  if (modalBannerCarouselTimer) return;
  modalBannerCarouselTimer = setInterval(() => {
    const el = document.getElementById('modalBannerAd');
    const ov = document.getElementById('overlay');
    if (!el || el.classList.contains('hidden') || !ov || ov.classList.contains('hidden')) { stopModalBannerCarousel(); return; }
    fetchImageAd('level_complete_banner').then((ad) => {
      if (!ad || el.classList.contains('hidden') || ov.classList.contains('hidden')) return;
      swapAdCard(el, () => buildBannerCard(el, ad));
    });
  }, 5000);
}
function loadLevelCompleteBanner() {
  const el = document.getElementById('modalBannerAd');
  if (!el) return;
  fetchImageAd('level_complete_banner').then((ad) => {
    if (!ad) { el.classList.add('hidden'); el.innerHTML = ''; stopModalBannerCarousel(); return; }
    buildBannerCard(el, ad);
    startModalBannerCarousel();
  });
}

function handleLevelWin({ coinsEarned, stars, achievementText, nextNewlyUnlocked }) {
  Sound.win();
  clearTimeout(gameOverTimer);
  gameOverTimer = setTimeout(() => {
    gameOverTimer = null;
    const cleared = state.level;
    const isLast = cleared >= TOTAL_LEVELS;
    const starText = '\u2605'.repeat(stars) + '\u2606'.repeat(3 - stars);
    const time = formatTime(state.seconds);
    modalTitleEl.textContent = '\u{1F389} Congratulations!';
    modalMessageEl.textContent = (isLast
      ? `You finished all ${TOTAL_LEVELS} levels in ${time} ${starText}!`
      : `Level ${cleared} cleared in ${time} ${starText}.` +
        (nextNewlyUnlocked ? ` Level ${cleared + 1} is now unlocked.` : ''))
      + (achievementText ? ' ' + achievementText + '.' : '');
    const coinsEl = document.getElementById('modalCoins');
    coinsEl.textContent = `+${coinsEarned} \u{1FA99} coins`;
    coinsEl.classList.remove('hidden');
    continueAdBtn.classList.add('hidden');
    continueNoteEl.classList.add('hidden');
    loadLevelCompleteBanner();

    // Short labels: Pac-Man lays these out in ONE row under the 300px MREC.
    wireModalButtons(
      isLast ? '\u{1F5FA} Levels' : 'Next Level \u27A1',
      '\u{1F5FA} Levels',
      () => {
        Sound.tap();
        if (isLast) { goToLevelSelect(); return; }
        if (isAdGateLevel(cleared)) {
          modalPrimaryBtn.disabled = true;
          playVideoAd('level_gate', () => {
            modalPrimaryBtn.disabled = false;
            startLevel(cleared + 1);
          }, `Level ${cleared} cleared \u2014 your reward is next!`);
        } else {
          startLevel(cleared + 1);
        }
      },
      () => { Sound.tap(); goToLevelSelect(); }
    );
    // Wired AFTER wireModalButtons, which clears it.
    setModalPrevLevel(cleared > 1 && isLevelReachable(cleared - 1) ? cleared - 1 : 0);
    overlayEl.classList.remove('hidden');
  }, 150);
}

/* Pac-Man runs checkSession() once all of its game code is defined. */
checkSession();
