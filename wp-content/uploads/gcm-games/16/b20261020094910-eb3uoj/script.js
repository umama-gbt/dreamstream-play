/* =========================================================================
   DOODLE JUMP — on the Pac-Man UI / responsive / ad standard
   -------------------------------------------------------------------------
   The game itself (physics, platforms, scoring, coins, skins, milestones,
   star rating) is Doodle Jump's own code. Everything AROUND the game
   follows Pac-Man's implementation: screens, popups, the bottom game bar,
   the ad system (local video ads, 300x600 side rails, 970x90 leaderboard,
   300x250 MREC), unlimited Watch Ad & Continue, the ad-gated Restart, the
   every-3rd-level ad, the 24-hour session reset with its message, and the
   5-ads unlock for levels after a reset.
   ========================================================================= */
(function () {
  "use strict";

  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d");
  if (!ctx.roundRect) {
    ctx.roundRect = function (x, y, w, h, r) {
      r = Math.min(r, w / 2, h / 2);
      this.beginPath();
      this.moveTo(x + r, y);
      this.lineTo(x + w - r, y);
      this.quadraticCurveTo(x + w, y, x + w, y + r);
      this.lineTo(x + w, y + h - r);
      this.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      this.lineTo(x + r, y + h);
      this.quadraticCurveTo(x, y + h, x, y + h - r);
      this.lineTo(x, y + r);
      this.quadraticCurveTo(x, y, x + r, y);
    };
  }

  /* localStorage can throw (private mode, sandboxed iframes, quota). Every
     read/write goes through here, as in Pac-Man. */
  const store = {
    get(key) { try { return localStorage.getItem(key); } catch (e) { return null; } },
    set(key, val) { try { localStorage.setItem(key, val); } catch (e) {} },
    remove(key) { try { localStorage.removeItem(key); } catch (e) {} },
  };

  /* Carousel timers declared up front, as in Pac-Man: showScreen() can reach
     the code that reads them during start-up. */
  let leaderboardCarouselTimer = null;
  let railCarouselTimer = null;
  let modalBannerCarouselTimer = null;

  // ===================== DOM =====================
  const scoreEl = document.getElementById("scoreEl");
  const targetEl = document.getElementById("targetEl");
  const highScoreEl = document.getElementById("highScoreEl");
  const livesEl = document.getElementById("livesEl");
  const levelTitleEl = document.getElementById("levelTitle");
  const btnLeft = document.getElementById("btnLeft");
  const btnRight = document.getElementById("btnRight");
  const coinCountMenu = document.getElementById("coinCountMenu");
  const coinCountShop = document.getElementById("coinCountShop");
  const coinCountGame = document.getElementById("coinCountGame");

  const shopBtn = document.getElementById("shopBtn");
  const shopGrid = document.getElementById("shopGrid");

  const screens = {
    menu: document.getElementById("menuScreen"),
    howto: document.getElementById("howToPlayScreen"),
    levelSelect: document.getElementById("levelSelectScreen"),
    shop: document.getElementById("shopScreen"),
    game: document.getElementById("gameScreen"),
  };

  const playBtn = document.getElementById("playBtn");
  const levelSelectBtn = document.getElementById("levelSelectBtn");
  const howToPlayBtn = document.getElementById("howToPlayBtn");
  const levelGrid = document.getElementById("levelGrid");

  const pauseBtn = document.getElementById("pauseBtn");
  const prevLevelBtn = document.getElementById("prevLevelBtn");
  const nextLevelBtn = document.getElementById("nextLevelBtn");
  const restartBtn = document.getElementById("restartBtn");
  const exitBtn = document.getElementById("exitBtn");
  const muteBtns = document.querySelectorAll(".mute-btn");

  const overlay = document.getElementById("overlay");
  const modalTitle = document.getElementById("modalTitle");
  const modalMessage = document.getElementById("modalMessage");
  const modalCoins = document.getElementById("modalCoins");
  const modalBannerAd = document.getElementById("modalBannerAd");
  const modalCloseX = document.getElementById("modalCloseX");
  const continueNote = document.getElementById("continueNote");
  let modalPrimaryBtn = document.getElementById("modalPrimaryBtn");
  let modalSecondaryBtn = document.getElementById("modalSecondaryBtn");
  let modalPrevBtn = document.getElementById("modalPrevBtn");
  const continueAdBtn = document.getElementById("continueAdBtn");

  const shopTabsEl = document.getElementById("shopTabs");

  const confirmOverlayEl = document.getElementById("confirmOverlay");
  const confirmTitleEl = document.getElementById("confirmTitle");
  const confirmMessageEl = document.getElementById("confirmMessage");
  const confirmSubMessageEl = document.getElementById("confirmSubMessage");
  let confirmOkBtn = document.getElementById("confirmOkBtn");
  let confirmCancelBtn = document.getElementById("confirmCancelBtn");

  // ===================== 24-HOUR SESSION (Pac-Man's rules) =====================
  // Progress resets 24 hours after the session started. Sound is a device
  // setting, not progress, so it is left alone. The reset flag survives the
  // wipe it is set by: it is what switches on the 5-ads level unlock.
  const SESSION_START_KEY = "doodle_sessionStart";
  const SESSION_LENGTH_MS = 24 * 60 * 60 * 1000;
  const UNLOCKED_KEY = "doodle_unlockedLevels";
  const COMPLETED_KEY = "doodle_completedLevels";
  const LEGACY_UNLOCKED_KEY = "doodle_unlockedLevel"; // old single "unlocked up to" number
  const COINS_KEY = "doodle_coins";
  const OWNED_SKINS_KEY = "doodle_ownedSkins";
  const EQUIPPED_SKIN_KEY = "doodle_equippedSkin";
  const MILESTONES_KEY = "doodle_milestonesAwarded";
  const HIGH_SCORE_KEY = "doodle-high-score";
  const LAST_PLAYED_KEY = "doodle_lastPlayedLevel"; // the level the Play button resumes
  const SESSION_KEYS = [UNLOCKED_KEY, COMPLETED_KEY, LEGACY_UNLOCKED_KEY, COINS_KEY,
    OWNED_SKINS_KEY, EQUIPPED_SKIN_KEY, MILESTONES_KEY, HIGH_SCORE_KEY, LAST_PLAYED_KEY];
  const RESET_HAPPENED_KEY = "doodle_resetHappened";

  function hasSessionEverReset() {
    return store.get(RESET_HAPPENED_KEY) === "1";
  }
  function readSessionStart() {
    const start = Number(store.get(SESSION_START_KEY));
    return Number.isFinite(start) && start > 0 ? start : null;
  }
  function startNewSession() {
    store.set(SESSION_START_KEY, String(Date.now()));
  }
  function wipeSessionProgress() {
    SESSION_KEYS.forEach((k) => store.remove(k));
    store.set(RESET_HAPPENED_KEY, "1");
    startNewSession();
  }
  /* Runs before any progress is read, so a session that expired while the
     page was closed starts this visit fresh. */
  let sessionExpiredAtLoad = false;
  (function checkSessionAtLoad() {
    const start = readSessionStart();
    if (!start) {
      startNewSession();
    } else if (start + SESSION_LENGTH_MS - Date.now() <= 0) {
      wipeSessionProgress();
      sessionExpiredAtLoad = true;
    }
  })();

  // ===================== SOUND EFFECTS =====================
  // Generated with the Web Audio API so no sound files are needed.
  const SOUND_STORAGE_KEY = "doodle_soundEnabled";
  let soundEnabled = store.get(SOUND_STORAGE_KEY) !== "false";
  // Master volume multiplier — bumped up so effects are punchier/louder.
  const MASTER_VOLUME = 1.8;

  let audioCtx = null;
  function getAudioCtx() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    }
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }
  // Unlock audio on the first user interaction (autoplay policies require a gesture).
  ["pointerdown", "keydown"].forEach((evt) =>
    document.addEventListener(evt, () => getAudioCtx(), { once: true, passive: true })
  );

  function playTone(freq, startTime, duration, type, peakVolume) {
    if (!soundEnabled) return;
    const ac = getAudioCtx();
    if (!ac) return;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type || "sine";
    osc.frequency.setValueAtTime(freq, startTime);
    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(Math.min(peakVolume * MASTER_VOLUME, 1), startTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start(startTime);
    osc.stop(startTime + duration);
  }

  function playJumpSound() {
    if (!soundEnabled) return;
    const ac = getAudioCtx();
    if (!ac) return;
    const t = ac.currentTime;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(320, t);
    osc.frequency.exponentialRampToValueAtTime(620, t + 0.09);
    gain.gain.setValueAtTime(0.001, t);
    gain.gain.linearRampToValueAtTime(Math.min(0.12 * MASTER_VOLUME, 1), t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start(t);
    osc.stop(t + 0.11);
  }

  function playCoinSound() {
    if (!soundEnabled) return;
    const ac = getAudioCtx();
    if (!ac) return;
    const t = ac.currentTime;
    playTone(988, t, 0.09, "triangle", 0.1);
    playTone(1319, t + 0.05, 0.12, "triangle", 0.1);
  }

  function playCongratsSound() {
    if (!soundEnabled) return;
    const ac = getAudioCtx();
    if (!ac) return;
    const t = ac.currentTime;
    // A fuller celebratory fanfare — rising run + a held triumphant chord.
    const run = [523.25, 659.25, 783.99, 1046.5, 1318.51]; // C5 E5 G5 C6 E6
    run.forEach((freq, i) => playTone(freq, t + i * 0.09, 0.22, "triangle", 0.13));
    const chordStart = t + run.length * 0.09 + 0.03;
    [1046.5, 1318.51, 1567.98].forEach((freq) => playTone(freq, chordStart, 0.55, "triangle", 0.12));
  }

  function playLifeLostSound() {
    if (!soundEnabled) return;
    const ac = getAudioCtx();
    if (!ac) return;
    const t = ac.currentTime;
    playTone(523.25, t, 0.12, "triangle", 0.1);        // C5
    playTone(392, t + 0.1, 0.18, "triangle", 0.1);     // G4
  }

  function playLoseSound() {
    if (!soundEnabled) return;
    const ac = getAudioCtx();
    if (!ac) return;
    const t = ac.currentTime;
    const notes = [392, 329.63, 261.63, 196]; // G4 E4 C4 G3, descending
    notes.forEach((freq, i) => playTone(freq, t + i * 0.13, 0.3, "sawtooth", 0.09));
  }


  // ===================== SOUND TOGGLE (Pac-Man's mute buttons) =====================
  function setSoundEnabled(value, silent) {
    soundEnabled = value;
    store.set(SOUND_STORAGE_KEY, String(soundEnabled));
    muteBtns.forEach((btn) => {
      btn.textContent = soundEnabled ? "\u{1F50A}" : "\u{1F507}";
      btn.classList.toggle("is-muted", !soundEnabled);
      btn.setAttribute("aria-pressed", String(!soundEnabled));
    });
    if (soundEnabled && !silent) {
      const ac = getAudioCtx();
      if (ac) playTone(880, ac.currentTime, 0.12, "sine", 0.12);
    }
  }
  muteBtns.forEach((btn) => btn.addEventListener("click", () => setSoundEnabled(!soundEnabled)));

  const CANVAS_WIDTH = 480;
  const CANVAS_HEIGHT = 600;
  const JUMP_FORCE = -12;
  const MOVE_SPEED = 5;
  const PLATFORM_HEIGHT = 14;
  const PLATFORM_GAP_MIN = 50;
  const PLATFORM_GAP_MAX = 120;
  const PLAYER_WIDTH = 36;
  const PLAYER_HEIGHT = 40;
  const CAMERA_LEAD = 0.4;

  // ===================== LEVELS =====================
  const TOTAL_LEVELS = 35;

  // Target score climbs in tiers. Each tier's END target is fixed, and the points
  // in between are divided evenly across that tier's levels:
  // Levels 1–10 → reach 300 (30 pts/level) · 11–20 → reach 500 (20 pts/level)
  // 21–30 → reach 1,000 (50 pts/level) · 31–35 → reach 1,500 (100 pts/level)
  const SCORE_TIERS = [
    { maxLevel: 10, targetEnd: 300 },
    { maxLevel: 20, targetEnd: 500 },
    { maxLevel: 30, targetEnd: 1000 },
    { maxLevel: 35, targetEnd: 1500 },
  ];

  const TARGET_SCORES = [0];
  {
    let prevMaxLevel = 0;
    let prevTarget = 0;
    for (const tier of SCORE_TIERS) {
      const levelsInTier = tier.maxLevel - prevMaxLevel;
      const jump = (tier.targetEnd - prevTarget) / levelsInTier;
      for (let lvl = prevMaxLevel + 1; lvl <= tier.maxLevel; lvl++) {
        TARGET_SCORES.push(TARGET_SCORES[TARGET_SCORES.length - 1] + jump);
      }
      prevMaxLevel = tier.maxLevel;
      prevTarget = tier.targetEnd;
    }
  }

  const LEVEL_NAMES = [
    "Backyard Bounce", "Garden Hop", "Porch Steps", "Picket Fence", "Rooftop Peek",
    "Treetop Trail", "Chimney Climb", "Kite String", "Lamp Post Leap", "Sky Window",
    "Cloud Deck", "Cotton Drift", "Storm Front", "Rainbow Ridge", "Thunderhead",
    "Jet Stream", "Silver Lining", "Cloud Nine", "Wind Tunnel", "Sky Ceiling",
    "Stratosphere Step", "Ozone Overlook", "Aurora Alley", "Ice Crystal Climb", "Polar Vortex",
    "Meteor Watch", "Satellite Row", "Orbit Edge", "Zero Gravity", "Space Threshold",
    "Lunar Landing", "Starlight Sprint", "Comet Chase", "Galaxy Gate", "Edge of the Universe",
  ];


  // ---------- Unlocked / completed levels (Pac-Man's set model) ----------
  // A SET of playable levels rather than one "unlocked up to" number, so the
  // 5-ads unlock can open one level out of order. Saves from the old single
  // number are converted once.
  (function migrateLegacyUnlock() {
    const legacy = Number(store.get(LEGACY_UNLOCKED_KEY));
    if (legacy >= 1 && store.get(UNLOCKED_KEY) === null) {
      const top = Math.min(legacy, TOTAL_LEVELS);
      const unlocked = [];
      const completed = [];
      for (let i = 1; i <= top; i++) unlocked.push(i);
      for (let i = 1; i < top; i++) completed.push(i);
      store.set(UNLOCKED_KEY, JSON.stringify(unlocked));
      store.set(COMPLETED_KEY, JSON.stringify(completed));
    }
    store.remove(LEGACY_UNLOCKED_KEY);
  })();

  function getUnlockedLevels() {
    try {
      const stored = JSON.parse(store.get(UNLOCKED_KEY));
      if (Array.isArray(stored)) return stored.filter((n) => n >= 1 && n <= TOTAL_LEVELS);
    } catch (e) {}
    return [1];
  }
  function isLevelUnlocked(level) {
    return level === 1 || getUnlockedLevels().includes(level);
  }
  function unlockLevel(level) {
    const levels = getUnlockedLevels();
    if (!levels.includes(level) && level >= 1 && level <= TOTAL_LEVELS) {
      levels.push(level);
      store.set(UNLOCKED_KEY, JSON.stringify(levels));
    }
  }
  /* A locked level can be unlocked with ads only after a 24-hour reset has
     happened, and only when the level right before it is still locked. */
  function isLevelAdUnlockable(level) {
    return level > 1 && level <= TOTAL_LEVELS && !isLevelUnlocked(level) &&
      hasSessionEverReset() && !isLevelUnlocked(level - 1);
  }
  function getFurthestUnlockedLevel() {
    return Math.min(TOTAL_LEVELS, Math.max(1, ...getUnlockedLevels()));
  }

  /* ---------- The level the Play button starts ----------
     Play used to start getFurthestUnlockedLevel(), the highest level in the
     unlocked set. A 5-ads unlock adds a level to that set out of order, so
     after unlocking Level 34 with ads, Play kept going to 34 even when the
     player had since chosen to play Level 1. Play now resumes the last level
     the player actually played, saved as they play it (see enterLevel and the
     first steering input in stepGame). Unlocking a level never sets it. */
  function setLastPlayedLevel(level) {
    store.set(LAST_PLAYED_KEY, String(level));
  }
  function getPlayLevel() {
    const last = Number(store.get(LAST_PLAYED_KEY));
    if (Number.isInteger(last) && last >= 1 && last <= TOTAL_LEVELS && isLevelUnlocked(last)) return last;
    /* Nothing played yet this session (or a save from before this was
       tracked): the furthest level reached by winning — a level whose
       predecessor is cleared — never one that only ads opened. */
    let level = 1;
    getUnlockedLevels().forEach((l) => {
      if (l > level && isLevelCompleted(l - 1)) level = l;
    });
    return Math.min(level, TOTAL_LEVELS);
  }
  function getCompletedLevels() {
    try {
      const stored = JSON.parse(store.get(COMPLETED_KEY));
      if (Array.isArray(stored)) return stored.filter((n) => n >= 1 && n <= TOTAL_LEVELS);
    } catch (e) {}
    return [];
  }
  function isLevelCompleted(level) {
    return getCompletedLevels().includes(level);
  }
  // A level win marks it cleared and unlocks the next one (Doodle Jump's
  // existing "clear a level -> next is unlocked" rule).
  function markLevelCompleted(level) {
    const completed = getCompletedLevels();
    if (!completed.includes(level)) {
      completed.push(level);
      store.set(COMPLETED_KEY, JSON.stringify(completed));
    }
    unlockLevel(level + 1);
  }

  // ===================== COINS =====================
  let coins = parseInt(store.get(COINS_KEY) || "0", 10) || 0;

  function saveCoins() {
    store.set(COINS_KEY, String(coins));
  }

  function updateCoinsUI() {
    // The in-game readout shows the committed balance plus whatever's been
    // collected so far this run (not yet committed — see sessionCoins).
    if (coinCountGame) coinCountGame.textContent = coins + sessionCoins;
    if (coinCountShop) coinCountShop.textContent = coins;
    if (coinCountMenu) coinCountMenu.textContent = coins;
  }

  function addCoins(amount) {
    if (!amount) return;
    coins += amount;
    saveCoins();
    updateCoinsUI();
  }

  // ===================== SKINS =====================
  // unlock: "default" (always owned), "coins" (buy in the shop), "level" (unlocked
  // automatically when that level is cleared for the first time).
  const SKINS = [
    { id: "classic", name: "Classic Doodle", emoji: "🟢", body: "#2d3436", eye: "#ffffff", pupil: "#2d3436", unlock: "default", cost: 0 },
    { id: "blue", name: "Blue Doodle", emoji: "🔵", body: "#2f5fa8", eye: "#eaf3ff", pupil: "#0b1f3d", unlock: "coins", cost: 100 },
    { id: "fire", name: "Fire Doodle", emoji: "🔴", body: "#c0392b", eye: "#ffe8a3", pupil: "#5c1a10", unlock: "coins", cost: 250 },
    { id: "galaxy", name: "Galaxy Doodle", emoji: "🟣", body: "#6c3fa8", eye: "#e3d3ff", pupil: "#2a1145", unlock: "coins", cost: 500 },
    { id: "golden", name: "Golden Doodle", emoji: "🟡", body: "#d8a324", eye: "#fff3c2", pupil: "#5c4200", unlock: "coins", cost: 1000 },
    { id: "sky", name: "Sky Doodle", emoji: "🔵", body: "#3aa0d1", eye: "#eafcff", pupil: "#0d3a4d", unlock: "level", unlockLevel: 10 },
    { id: "space", name: "Space Doodle", emoji: "🚀", body: "#1b1f3b", eye: "#9fd8ff", pupil: "#04070f", unlock: "level", unlockLevel: 20 },
    { id: "ghost", name: "Ghost Doodle", emoji: "👻", body: "#dfe7ea", eye: "#ffffff", pupil: "#4b5a61", unlock: "level", unlockLevel: 30 },
    { id: "robot", name: "Robot Doodle", emoji: "🤖", body: "#607d8b", eye: "#c8f7ff", pupil: "#0f2229", unlock: "coins", cost: 2000 },
    { id: "king", name: "King Doodle", emoji: "👑", body: "#8e44ad", eye: "#ffe8a3", pupil: "#3a1a4d", unlock: "level", unlockLevel: 35 },
  ];


  function loadOwnedSkins() {
    try {
      const stored = JSON.parse(store.get(OWNED_SKINS_KEY) || "null");
      if (Array.isArray(stored) && stored.length) return stored;
    } catch (err) {
      /* fall through to default */
    }
    return ["classic"];
  }

  let ownedSkins = loadOwnedSkins();
  let equippedSkinId = store.get(EQUIPPED_SKIN_KEY) || "classic";

  function saveOwnedSkins() {
    store.set(OWNED_SKINS_KEY, JSON.stringify(ownedSkins));
  }

  function saveEquippedSkin() {
    store.set(EQUIPPED_SKIN_KEY, equippedSkinId);
  }

  function getSkin(id) {
    return SKINS.find((s) => s.id === id) || SKINS[0];
  }

  function getActiveSkin() {
    return getSkin(equippedSkinId);
  }

  // ===================== MILESTONES =====================
  const MILESTONES = {
    5: { name: "Backyard Explorer", coins: 50 },
    10: { name: "Sky Climber", coins: 100 },
    15: { name: "Cloud Master", coins: 150 },
    20: { name: "Storm Rider", coins: 200 },
    25: { name: "Space Explorer", coins: 250 },
    30: { name: "Galaxy Traveler", coins: 300 },
    35: { name: "Doodle Jump Master", coins: 500 },
  };

  function loadMilestonesAwarded() {
    try {
      const stored = JSON.parse(store.get(MILESTONES_KEY) || "null");
      if (Array.isArray(stored)) return stored;
    } catch (err) {
      /* fall through to default */
    }
    return [];
  }

  let milestonesAwarded = loadMilestonesAwarded();

  function saveMilestonesAwarded() {
    store.set(MILESTONES_KEY, JSON.stringify(milestonesAwarded));
  }

  // Awards a milestone's coin bonus (and unlocks its tied skin, if any) the
  // first time that level is cleared — never again on replays.
  function checkMilestone(level) {
    const m = MILESTONES[level];
    if (!m || milestonesAwarded.includes(level)) return null;
    milestonesAwarded.push(level);
    saveMilestonesAwarded();
    addCoins(m.coins);
    const skin = SKINS.find((s) => s.unlock === "level" && s.unlockLevel === level);
    if (skin && !ownedSkins.includes(skin.id)) {
      ownedSkins.push(skin.id);
      saveOwnedSkins();
    }
    return { name: m.name, coins: m.coins };
  }

  function computeStars() {
    if (adContinuesUsed === 0) return 3;
    if (adContinuesUsed === 1) return 2;
    return 1;
  }


  function getLevelConfig(level) {
    const gravity = Math.min(0.42 + level * 0.0045, 0.6);
    const jump = buildJumpTable(gravity);
    return {
      targetScore: TARGET_SCORES[level],
      name: LEVEL_NAMES[level - 1] || `Level ${level}`,
      gravity,
      breakChance: Math.min(0.08 + level * 0.0065, 0.32),
      movingChance: Math.min(0.12 + level * 0.006, 0.3),
      minWidth: Math.max(38, 60 - level * 0.55),
      maxWidth: Math.max(70, 120 - level * 1.3),
      // The highest gap a jump clears with a comfortable margin (70% of
      // its height). Gravity rises with the level, so this shrinks from
      // about 115px on Level 1 to about 83px on Level 35.
      maxGap: Math.min(PLATFORM_GAP_MAX, jump.apex * REACH_HEIGHT_SAFETY),
      landFrames: jump.landFrames,
      apex: jump.apex, // how high a bounce goes with no input
    };
  }

  /* ---------- Jump reach, from the game's own physics ----------
     Platforms used to be placed at a random x with a random 50-120px gap
     above the last one. The doodler cannot wrap round the screen edge, its
     jump gets lower as gravity rises with the level, and its sideways speed
     is fixed — so a platform 120px up on the far side of the board was often
     simply out of reach, and nothing guaranteed another way up. Simulated
     with this file's exact physics, a run needing ~60 climbs (Level 10) hit
     an unreachable step more often than not, and from Level 20 on almost
     every run did: the level could not be finished at all.
     buildJumpTable() steps the same integration gameLoop uses (vy += g,
     y += vy, the same +-2px landing window) once per level and records, for
     each height above the take-off platform, how many frames the doodler
     has in the air before its feet come down through that height. Frames x
     MOVE_SPEED is how far sideways it can travel to get there, and new
     platforms are placed inside that reach.

     That first version only guaranteed a step was POSSIBLE: it could need
     the player to walk to the right edge of the platform first, react on the
     very first frame, hold the key for almost the whole jump, or catch a
     moving platform at the right moment. Played normally, the doodler still
     fell short every 20 or so climbs (a player that reacts after 8 frames
     and just steers at the next platform cleared Level 10 without a fall
     2 times in 20). Every step is now placed to be COMFORTABLE:
       - from wherever the doodler can be on the platform it is on (see
         reachableRange), not just the best spot;
       - with a reaction allowance before the doodler starts to steer, and
         only part of the remaining sideways travel;
       - and no higher than 70% of the jump's height.

     Third pass — no climbing without the player:
     a doodler bouncing in place goes straight up about 120-165px. Whenever
     a higher platform sat over the one it was on, within that height, it
     landed there with no input at all and kept going — the "automatic
     upward movement". A new platform is now never placed where a doodler
     bouncing in place on ANY platform below it (within one jump's height,
     either platform's slide included) could land on it: upward progress
     always needs the player to steer sideways. The doodler's footprint is
     also measured as the body the player sees (see footHalf), so the
     placement uses that too.
     Gravity, platform widths, breaking and moving platforms, coins and the
     level targets are unchanged. */
  const REACH_HEIGHT_SAFETY = 0.7;  // a gap uses at most 70% of the jump's height
  const REACTION_FRAMES = 8;        // the player starts steering this late (~1/7 s)
  const REACH_SIDE_SAFETY = 0.85;   // and uses 85% of the travel left after that
  const REACH_MIN_OVERLAP = 14;     // land with at least this much foot on it

  /* ---------- The doodler's footprint ----------
     The board stretches the world sideways to fill wide screens (platforms
     are drawn sx wide), but the doodler is drawn round (sy wide), so in
     landscape its body is only sy/sx as wide as its 36px hit box — on a
     landscape phone about half. It could "stand" on a platform with its
     whole visible body past the edge, hanging in the air. Landing now uses
     the doodler's FEET as the player sees them (the two feet span about 70%
     of the body), so it only lands when its feet are over the platform:
     half-width footHalf() around its centre, in every orientation. */
  const FEET_SPAN = 0.7;                        // the feet cover 70% of the body width
  const FOOT_HALF = (PLAYER_WIDTH / 2) * FEET_SPAN; // feet half-width when drawn round (portrait)
  const FOOT_K_MIN = 0.45;                      // narrowest it gets (ultra-wide boards)
  const FOOT_HALF_MIN = FOOT_HALF * FOOT_K_MIN;
  function footHalf() {
    const k = view.sx > 0 ? view.sy / view.sx : 1;
    return FOOT_HALF * Math.max(FOOT_K_MIN, Math.min(1, k));
  }

  function buildJumpTable(gravity) {
    const landFrames = [];
    let y = -1; // feet sit 1px above the platform after a bounce
    let vy = JUMP_FORCE;
    let apex = 0;
    for (let frame = 1; frame < 400; frame++) {
      vy += gravity;
      const prev = y;
      y += vy;
      apex = Math.max(apex, -y);
      if (vy < 0) continue;
      // Every height h whose platform top this frame's fall crossed.
      for (let h = Math.max(0, Math.ceil(-y - 2)); h <= Math.floor(-prev + 2); h++) {
        if (landFrames[h] === undefined) landFrames[h] = frame;
      }
      if (y > 0) break;
    }
    return { apex, landFrames };
  }

  function sidewaysReach(dy) {
    const frames = levelConfig.landFrames[Math.max(0, Math.round(dy))] || 0;
    return Math.max(0, frames - REACTION_FRAMES) * MOVE_SPEED * REACH_SIDE_SAFETY;
  }

  // How far a platform slides either side of its resting spot.
  const slideOf = (p) => (p.type === "moving" ? p.moveRange : 0);

  /* Left edges a new platform (width w) dy above `from` may have so that a
     player can comfortably land on it:
       - from a breaking platform (one bounce, no chance to reposition):
         from anywhere in its middle three quarters;
       - from a solid one: from anywhere in its middle half (the player can
         bounce along it);
       - from a moving one: from its middle half anywhere in the middle half
         of its slide (it carries the doodler away from its resting spot);
       - onto the new platform's resting position (a moving one passes
         through it every slide; the player can wait for it), landing a few
         px inside its edge with the narrowest footprint.
     Works on the doodler's centre c, which is clamped to [PLAYER_WIDTH / 2,
     CANVAS_WIDTH - PLAYER_WIDTH / 2]. Null when none. */
  function reachableRange(from, w, dy) {
    const reach = sidewaysReach(dy);
    const cMin = PLAYER_WIDTH / 2;                 // the box stays on the board
    const cMax = CANVAS_WIDTH - PLAYER_WIDTH / 2;
    const mid = from.startX + from.width / 2;
    const span =
      from.type === "break" ? from.width * 0.375 :
      from.type === "moving" ? from.width / 4 + from.moveRange / 2 :
      from.width / 4;
    const a = Math.max(cMin, mid - span);          // left-most take-off centre
    const b = Math.min(cMax, mid + span);          // right-most take-off centre
    const inset = Math.max(0, REACH_MIN_OVERLAP - FOOT_HALF_MIN); // land this far inside the edge
    const hi = Math.min(cMax, a + reach) - inset;
    const lo = Math.max(cMin, b - reach) - w + inset;
    const min = Math.max(0, lo);
    const max = Math.min(CANVAS_WIDTH - w, hi);
    return min <= max ? { min, max } : null;
  }

  /* Left edges at which a platform (width w, sliding +-range, top at y)
     could be reached by a doodler just bouncing in place on platform p
     below it: their footprints would overlap. Null if p is out of jumping
     range below y. */
  function freeClimbBand(p, w, range, y) {
    const rise = p.y - y;
    if (rise <= 0 || rise > levelConfig.apex + 4) return null;
    /* Moving platforms: they sweep 80-160px, so keeping every sweep clear of
       every neighbour would leave almost no room for them (they all but
       vanished). A doodler cannot bounce in place on a moving platform for
       long (it slides out from under it), so the lower one counts at its
       resting spot; an upper one counts with half its slide, which keeps it
       clear of a doodler waiting below most of the time. */
    const ps = 0;
    const r = range / 2;
    return {
      from: p.startX - ps - 2 * FOOT_HALF - w - r - 2,
      to: p.startX + p.width + ps + 2 * FOOT_HALF + r + 2,
    };
  }

  // Picks a random left edge in [min, max] that avoids every band.
  function pickOutside(min, max, bands) {
    let pieces = [{ from: min, to: max }];
    bands.forEach((band) => {
      const next = [];
      pieces.forEach((pc) => {
        if (band.to <= pc.from || band.from >= pc.to) { next.push(pc); return; }
        if (band.from > pc.from) next.push({ from: pc.from, to: band.from });
        if (band.to < pc.to) next.push({ from: band.to, to: pc.to });
      });
      pieces = next;
    });
    const total = pieces.reduce((t, pc) => t + (pc.to - pc.from), 0);
    if (pieces.length === 0) return null;
    if (total <= 0) return pieces[0].from;
    let r = Math.random() * total;
    for (const pc of pieces) {
      if (r <= pc.to - pc.from) return pc.from + r;
      r -= pc.to - pc.from;
    }
    return pieces[pieces.length - 1].to;
  }

  /* The next platform up from `from`: comfortably reachable from it, and
     not reachable by bouncing in place from any platform below it. A few
     tries with a fresh width / type and a smaller gap if a step won't fit;
     then the same without the no-free-climb rule (rare); then a plain
     platform right above at the smallest gap. */
  function makeReachablePlatform(from) {
    let dy = nextGap();
    // Keep the type that was rolled for the first tries (so moving and
    // breaking platforms keep their share), varying width and gap.
    const rolled = pickPlatformType();
    for (let attempt = 0; attempt < 28; attempt++) {
      const strict = attempt < 24;
      // Later tries also take narrower platforms, which fit more easily.
      const width = attempt < 12 ? randomPlatformWidth()
        : levelConfig.minWidth + Math.random() * (levelConfig.maxWidth - levelConfig.minWidth) * 0.4;
      let type = attempt < 8 ? rolled : "normal";
      // A breaking platform gives one bounce with no chance to wait, so the
      // step after it must not be one that slides away.
      if (from.type === "break" && type === "moving") type = "normal";
      const platform = createPlatform(0, from.y - dy, width, type);
      const range = reachableRange(from, width, dy);
      if (range) {
        /* Last tries after a MOVING platform drop only that platform's own
           rule: the doodler cannot stay bouncing in place on it (it slides
           away), so overlapping its resting spot is harmless. Every other
           platform below keeps the rule. */
        const lenient = !strict || (attempt >= 16 && from.type === "moving");
        const bands = !strict
          ? []
          : platforms
              .filter((p) => !(lenient && p === from))
              .map((p) => freeClimbBand(p, width, platform.moveRange, platform.y))
              .filter(Boolean);
        const x = pickOutside(range.min, range.max, bands);
        if (x !== null) {
          platform.x = platform.startX = x;
          return platform;
        }
      }
      if (attempt % 2 === 1) dy = Math.max(minGap(), dy * 0.92);
    }
    const width = randomPlatformWidth();
    const x = Math.max(0, Math.min(CANVAS_WIDTH - width, from.startX + from.width / 2 - width / 2));
    return createPlatform(x, from.y - PLATFORM_GAP_MIN, width, "normal");
  }

  /* Gaps run from just over HALF a jump's height to 70% of it (Level 1:
     about 88-115px, Level 35: about 65-83px). Over half, so that two steps
     together are always more than one jump: a doodler bouncing in place can
     then only ever reach the platform directly above it, and that one is
     placed off to the side — so climbing always takes steering. */
  function minGap() {
    return Math.max(PLATFORM_GAP_MIN, levelConfig.apex * 0.52 + 4);
  }
  function nextGap() {
    const lo = minGap();
    return lo + Math.random() * Math.max(0, levelConfig.maxGap - lo);
  }

  let currentLevel = 1;
  let levelConfig = getLevelConfig(1);
  let levelCleared = false;

  let animationId = null;
  let player = null;
  let platforms = [];
  let coinItems = []; // in-level collectible coins (adds to the coin balance live)
  const COIN_ITEM_SIZE = 20;
  const COIN_SPAWN_CHANCE = 0.32;
  let cameraY = 0;
  let highestY = 0;
  const CLIMB_POINTS = 5;
  let score = 0;
  let highScore = parseInt(store.get(HIGH_SCORE_KEY) || "0", 10) || 0;
  // Counts continues only for the star rating — there is no cap (Pac-Man).
  let adContinuesUsed = 0;

  /* ---------- 3 lives per attempt ----------
     A fall off the bottom used to end the run on the spot. It is now a
     mistake that costs one of 3 lives: the doodler is put back on a safe
     platform with its score kept, and only the 3rd fall opens Game Over
     (whose Watch Ad & Continue gives 3 fresh lives, as in Pac-Man). */
  const MAX_LIVES = 3;
  const RESPAWN_BLINK_STEPS = 75; // 1.25 s of blinking after a respawn
  let lives = MAX_LIVES;
  let respawnBlinkUntil = 0;
  let lastPlatform = null; // the platform the doodler last bounced on
  /* A breaking platform the doodler has just been put back on holds (does
     not crumble) until the player steers: otherwise a restart on one would
     give a single bounce while the player is still finding the doodler, then
     another fall and another lost life. */
  let respawnHold = null;

  function updateLivesUI() {
    if (livesEl) livesEl.textContent = String(lives);
  }

  function flashLivesChip() {
    const chip = livesEl ? livesEl.closest(".lives-label") : null;
    if (!chip) return;
    chip.classList.remove("life-lost");
    void chip.offsetWidth; // restart the animation
    chip.classList.add("life-lost");
  }
  let sessionCoins = 0; // coins collected this run — only committed to the
                         // persistent balance if the level is completed.
  let gameRunning = false;
  let keys = { left: false, right: false };
  let time = 0;


  // ===================== CANVAS VIEW =====================
  /* The board fills its whole box on every screen — no bands, no centred
     window. The game world is still exactly CANVAS_WIDTH x CANVAS_HEIGHT
     units and none of the physics, camera or game-over logic knows about the
     screen; only the DRAWING is mapped:
       - horizontally the 480-unit world always spans the full box width
         (sx), so platforms sit edge to edge exactly where the logic has them;
       - vertically it is drawn at sy = min(sx, height/600): on a tall box any
         extra height shows more sky above the play view, on a wide box the
         600-unit view spans the full height.
     The doodler and coins are drawn at their true shape (scale sy) centred
     on their logical position, so they never look squashed or stretched. */
  const view = { w: CANVAS_WIDTH, h: CANVAS_HEIGHT, dpr: 1, sx: 1, sy: 1, oy: 0, top: 0 };

  function resizeCanvas() {
    if (!screens.game.classList.contains("active")) return;
    const box = boardHostBox();
    if (!(box.w > 0) || !(box.h > 0)) return;
    canvas.style.aspectRatio = "auto";
    canvas.style.width = Math.floor(box.w) + "px";
    canvas.style.height = Math.floor(box.h) + "px";
    canvas.style.maxWidth = "100%";
    canvas.style.maxHeight = "100%";

    const W = Math.max(1, canvas.clientWidth);
    const H = Math.max(1, canvas.clientHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const bw = Math.round(W * dpr);
    const bh = Math.round(H * dpr);
    if (canvas.width !== bw) canvas.width = bw;
    if (canvas.height !== bh) canvas.height = bh;

    view.w = W;
    view.h = H;
    view.dpr = dpr;
    view.sx = W / CANVAS_WIDTH;
    view.sy = Math.min(view.sx, H / CANVAS_HEIGHT);
    view.oy = H - CANVAS_HEIGHT * view.sy; // extra height, shown as sky above
    view.top = view.oy / view.sy;
    render();
  }

  // Maps world coordinates to the screen at true proportions, centred on the
  // horizontal world position cx (used for the doodler and coins).
  function setUniformTransform(cx) {
    const { dpr, sx, sy, oy } = view;
    ctx.setTransform(dpr * sy, 0, 0, dpr * sy, dpr * (sx - sy) * cx, dpr * oy);
  }

  function render() {
    const { w, h, dpr, sx, sy, oy } = view;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!player) return;
    ctx.setTransform(dpr * sx, 0, 0, dpr * sy, 0, dpr * oy);
    platforms.forEach(drawPlatform);
    coinItems.forEach((c) => {
      setUniformTransform(c.x + c.width / 2);
      drawCoinItem(c);
    });
    setUniformTransform(player.x + PLAYER_WIDTH / 2);
    drawPlayer();
  }

  function pickPlatformType() {
    const r = Math.random();
    if (r < levelConfig.breakChance) return "break";
    if (r < levelConfig.breakChance + levelConfig.movingChance) return "moving";
    return "normal";
  }

  function createPlatform(x, y, width, type) {
    return {
      x,
      y,
      width,
      height: PLATFORM_HEIGHT,
      type: type || "normal",
      moveDir: type === "moving" ? (Math.random() > 0.5 ? 1 : -1) : 0,
      moveRange: type === "moving" ? 40 + Math.random() * 40 : 0,
      startX: x,
    };
  }

  // Occasionally floats a collectible coin just above a platform (skipped for
  // the very first platform so the run always starts clean).
  function maybeSpawnCoinAbove(platform) {
    if (Math.random() > COIN_SPAWN_CHANCE) return;
    coinItems.push({
      x: platform.x + platform.width / 2 - COIN_ITEM_SIZE / 2,
      y: platform.y - 34,
      width: COIN_ITEM_SIZE,
      height: COIN_ITEM_SIZE,
      collected: false,
      bob: Math.random() * Math.PI * 2,
    });
  }

  function randomPlatformWidth() {
    return levelConfig.minWidth + Math.random() * (levelConfig.maxWidth - levelConfig.minWidth);
  }

  /* The newest (highest) platform. Kept as a reference rather than found with
     Math.min(...platforms) each time: a breaking platform is removed from
     the list when it is used, and the chain has to continue from where it
     was generated, not from whatever happens to be highest afterwards. */
  let topPlatform = null;

  function initPlatforms() {
    platforms = [];
    coinItems = [];
    const firstWidth = randomPlatformWidth();
    topPlatform = createPlatform((CANVAS_WIDTH - firstWidth) / 2, CANVAS_HEIGHT - 80, firstWidth, "normal");
    platforms.push(topPlatform);
    addPlatformsAbove(0);
  }

  // Extends the chain upwards until it is a screen and a bit above topY.
  function addPlatformsAbove(topY) {
    while (topPlatform.y > topY - CANVAS_HEIGHT - 200) {
      const platform = makeReachablePlatform(topPlatform);
      platforms.push(platform);
      maybeSpawnCoinAbove(platform);
      topPlatform = platform;
    }
  }

  function resetGame() {
    cameraY = 0;
    score = 0;
    adContinuesUsed = 0;
    lives = MAX_LIVES;
    respawnBlinkUntil = 0;
    respawnHold = null;
    updateLivesUI();
    sessionCoins = 0;
    time = 0;
    levelCleared = false;
    keys.left = false;
    keys.right = false;
    if (btnLeft) btnLeft.classList.remove("active");
    if (btnRight) btnRight.classList.remove("active");
    initPlatforms();
    lastPlatform = platforms[0]; // the start platform, until the first bounce
    const firstPlatform = platforms[0];
    player = {
      x: (CANVAS_WIDTH - PLAYER_WIDTH) / 2,
      y: firstPlatform.y - PLAYER_HEIGHT - 2,
      vx: 0,
      vy: 0,
      facing: 1, // 1 = right, -1 = left; kept after the key is released
      width: PLAYER_WIDTH,
      height: PLAYER_HEIGHT,
    };
    highestY = player.y;
    scoreEl.textContent = "0";
    targetEl.textContent = levelConfig.targetScore;
    highScoreEl.textContent = highScore;
    updateCoinsUI();
  }

  // Lightens a "#rrggbb" color by `amount` (0-1) — used to fake a glossy
  // highlight on the doodle's body without needing extra art assets.
  function lightenHex(hex, amount) {
    const num = parseInt(hex.replace("#", ""), 16);
    const delta = Math.round(255 * amount);
    const r = Math.max(0, Math.min(255, (num >> 16) + delta));
    const g = Math.max(0, Math.min(255, ((num >> 8) & 0xff) + delta));
    const b = Math.max(0, Math.min(255, (num & 0xff) + delta));
    return `rgb(${r}, ${g}, ${b})`;
  }

  function drawPlayer() {
    const x = player.x;
    const y = player.y - cameraY;
    if (y < -view.top - PLAYER_HEIGHT - 20 || y > CANVAS_HEIGHT + 20) return;

    // Blink for a moment after a respawn so the player sees where it is.
    if (time < respawnBlinkUntil && Math.floor(time / 6) % 2 === 1) return;

    const skin = getActiveSkin();
    const cx = x + PLAYER_WIDTH / 2;
    const cy = y + PLAYER_HEIGHT / 2;

    // Squash & stretch: stretched tall while flying up fast, squashed flat
    // right as it's falling into a landing — gives it a springy, alive feel.
    const vy = player.vy || 0;
    const stretch = Math.max(-0.16, Math.min(0.16, -vy / 40));
    const rx = (PLAYER_WIDTH / 2) * (1 - stretch * 0.6);
    const ry = (PLAYER_HEIGHT / 2) * (1 + stretch);
    /* The body squashes and stretches from the FEET, not from its middle.
       It used to stretch around the centre, so on the bounce frame (fully
       stretched) its bottom reached ~3px below the hit box and the doodler
       looked sunk into the platform, and while falling it hovered above it.
       Its bottom now always sits on the feet line, where it lands. */
    const by = y + PLAYER_HEIGHT - ry;

    ctx.save();
    ctx.translate(cx, cy);
    if (player.facing < 0) ctx.scale(-1, 1);
    ctx.translate(-cx, -cy);

    // ---- Soft contact shadow ----
    ctx.beginPath();
    ctx.ellipse(cx, y + PLAYER_HEIGHT + 1, PLAYER_WIDTH * 0.35, 4, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(31, 41, 55, 0.16)";
    ctx.fill();

    ctx.globalAlpha = skin.id === "ghost" ? 0.75 : 1;

    // ---- Little bouncy antennae (classic doodle silhouette) ----
    const wobble = Math.sin(time * 0.12) * 2;
    ctx.strokeStyle = skin.body;
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x + PLAYER_WIDTH * 0.3, y + ry * 0.35);
    ctx.quadraticCurveTo(x + PLAYER_WIDTH * 0.18, y - 6, x + PLAYER_WIDTH * 0.24 + wobble, y - 12);
    ctx.moveTo(x + PLAYER_WIDTH * 0.7, y + ry * 0.35);
    ctx.quadraticCurveTo(x + PLAYER_WIDTH * 0.82, y - 6, x + PLAYER_WIDTH * 0.76 + wobble, y - 12);
    ctx.stroke();
    ctx.fillStyle = skin.body;
    ctx.beginPath();
    ctx.arc(x + PLAYER_WIDTH * 0.24 + wobble, y - 12, 2.8, 0, Math.PI * 2);
    ctx.arc(x + PLAYER_WIDTH * 0.76 + wobble, y - 12, 2.8, 0, Math.PI * 2);
    ctx.fill();
    // Tiny shine dots on the antenna tips for a glossy touch.
    ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
    ctx.beginPath();
    ctx.arc(x + PLAYER_WIDTH * 0.24 + wobble - 0.8, y - 13, 0.9, 0, Math.PI * 2);
    ctx.arc(x + PLAYER_WIDTH * 0.76 + wobble - 0.8, y - 13, 0.9, 0, Math.PI * 2);
    ctx.fill();

    // ---- Feet ----
    ctx.fillStyle = skin.body;
    ctx.beginPath();
    ctx.ellipse(x + PLAYER_WIDTH * 0.32, y + PLAYER_HEIGHT - 3, 6, 3.5, 0, 0, Math.PI * 2);
    ctx.ellipse(x + PLAYER_WIDTH * 0.68, y + PLAYER_HEIGHT - 3, 6, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // ---- Body: glossy rounded blob instead of a flat box ----
    const bodyGradient = ctx.createRadialGradient(
      cx - rx * 0.35, by - ry * 0.45, 2,
      cx, by, PLAYER_WIDTH * 0.85
    );
    bodyGradient.addColorStop(0, lightenHex(skin.body, 0.35));
    bodyGradient.addColorStop(0.55, skin.body);
    bodyGradient.addColorStop(1, lightenHex(skin.body, -0.12));
    ctx.fillStyle = bodyGradient;
    ctx.beginPath();
    ctx.ellipse(cx, by, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(31, 41, 55, 0.2)";
    ctx.stroke();

    // Pale belly patch — a lighter two-tone underside like the classic doodler.
    ctx.fillStyle = lightenHex(skin.body, 0.42);
    ctx.globalAlpha = (skin.id === "ghost" ? 0.75 : 1) * 0.55;
    ctx.beginPath();
    ctx.ellipse(cx, by + ry * 0.42, rx * 0.55, ry * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();

    // Soft top highlight streak for extra glossiness.
    ctx.globalAlpha = (skin.id === "ghost" ? 0.75 : 1) * 0.35;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.ellipse(cx - rx * 0.32, by - ry * 0.55, rx * 0.28, ry * 0.16, -0.4, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 1;

    // ---- Rosy cheeks ----
    ctx.fillStyle = "rgba(255, 120, 130, 0.35)";
    ctx.beginPath();
    ctx.ellipse(x + 6, y + PLAYER_HEIGHT * 0.52, 3.6, 2.4, 0, 0, Math.PI * 2);
    ctx.ellipse(x + PLAYER_WIDTH - 6, y + PLAYER_HEIGHT * 0.52, 3.6, 2.4, 0, 0, Math.PI * 2);
    ctx.fill();

    // ---- Big glossy eyes ----
    const eyeY = y + PLAYER_HEIGHT * 0.4;
    const eyeR = 7.5;
    ctx.fillStyle = skin.eye;
    ctx.beginPath();
    ctx.arc(x + 11, eyeY, eyeR, 0, Math.PI * 2);
    ctx.arc(x + PLAYER_WIDTH - 11, eyeY, eyeR, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(31, 41, 55, 0.15)";
    ctx.stroke();

    ctx.fillStyle = skin.pupil;
    ctx.beginPath();
    ctx.arc(x + 12, eyeY + 1.5, 3.6, 0, Math.PI * 2);
    ctx.arc(x + PLAYER_WIDTH - 10, eyeY + 1.5, 3.6, 0, Math.PI * 2);
    ctx.fill();

    // Tiny white eye-shine for a glossy, friendlier look.
    ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
    ctx.beginPath();
    ctx.arc(x + 9, eyeY - 2, 1.6, 0, Math.PI * 2);
    ctx.arc(x + PLAYER_WIDTH - 13, eyeY - 2, 1.6, 0, Math.PI * 2);
    ctx.fill();

    // ---- Small smile ----
    ctx.strokeStyle = "rgba(31, 41, 55, 0.4)";
    ctx.lineWidth = 1.6;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(cx, y + PLAYER_HEIGHT * 0.62, 6, 0.12 * Math.PI, 0.88 * Math.PI);
    ctx.stroke();

    // Small flavor accessory per special skin.
    if (skin.id === "king") {
      ctx.font = "18px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("👑", x + PLAYER_WIDTH / 2, y - 6);
    } else if (skin.id === "fire") {
      ctx.font = "14px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("🔥", x + PLAYER_WIDTH / 2, y - 4);
    } else if (skin.id === "space") {
      ctx.font = "14px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("🚀", x + PLAYER_WIDTH / 2, y - 4);
    }

    ctx.restore();
  }

  function drawCoinItem(c) {
    if (c.collected) return;
    const y = c.y - cameraY;
    if (y < -view.top - 40 || y > CANVAS_HEIGHT + 40) return;
    const cx = c.x + c.width / 2;
    const cy = y + c.height / 2 + Math.sin((time + c.bob * 20) * 0.08) * 3;

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, c.width / 2, 0, Math.PI * 2);
    ctx.fillStyle = "#ffd93d";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#d9a20e";
    ctx.stroke();
    ctx.font = "13px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("🪙", cx, cy + 1);
    ctx.restore();
  }

  function drawPlatform(p) {
    if (p.broken) return;
    const y = p.y - cameraY;
    if (y < -view.top - PLATFORM_HEIGHT - 20 || y > CANVAS_HEIGHT + 50) return;

    const x = p.x;
    const w = p.width;
    const h = p.height;

    if (p.type === "normal") {
      ctx.fillStyle = "#6bcb77";
      ctx.strokeStyle = "#4ade80";
    } else if (p.type === "break") {
      ctx.fillStyle = "#c9a959";
      ctx.strokeStyle = "#b8860b";
    } else {
      ctx.fillStyle = "#4d96ff";
      ctx.strokeStyle = "#6eb5ff";
    }

    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 6);
    ctx.fill();
    ctx.stroke();
  }


  function stopLoop() {
    gameRunning = false;
    if (animationId) cancelAnimationFrame(animationId);
    animationId = null;
  }

  // ===================== TOAST (Pac-Man's session / notice message) =====================
  let sessionToastEl = null;
  function showToast(text) {
    if (!sessionToastEl) {
      sessionToastEl = document.createElement("div");
      sessionToastEl.className = "session-toast";
      document.body.appendChild(sessionToastEl);
    }
    sessionToastEl.textContent = text;
    sessionToastEl.classList.add("show");
    clearTimeout(sessionToastEl._hideTimer);
    sessionToastEl._hideTimer = setTimeout(() => sessionToastEl.classList.remove("show"), 3200);
  }
  function showSessionToast() {
    showToast("\u23F0 24-hour session over \u2014 progress reset, starting fresh");
  }

  // Re-reads every piece of progress held in memory after a session wipe.
  function reloadProgressFromStorage() {
    coins = parseInt(store.get(COINS_KEY) || "0", 10) || 0;
    ownedSkins = loadOwnedSkins();
    equippedSkinId = store.get(EQUIPPED_SKIN_KEY) || "classic";
    milestonesAwarded = loadMilestonesAwarded();
    highScore = parseInt(store.get(HIGH_SCORE_KEY) || "0", 10) || 0;
    if (highScoreEl) highScoreEl.textContent = highScore;
    updateCoinsUI();
  }

  function checkSession() {
    const start = readSessionStart();
    if (!start) {
      startNewSession();
      return;
    }
    if (start + SESSION_LENGTH_MS - Date.now() <= 0) {
      wipeSessionProgress();
      sessionCoins = 0;
      reloadProgressFromStorage();
      // A level in progress drops back to the menu with a fresh start.
      if (screens.game.classList.contains("active")) {
        stopLoop();
        isPaused = false;
        hideOverlay();
        showScreen("menu");
      }
      if (screens.levelSelect.classList.contains("active")) buildLevelGrid();
      if (screens.shop.classList.contains("active")) renderShop(activeShopTab);
      showSessionToast();
    }
  }
  setInterval(checkSession, 30000);
  window.addEventListener("focus", checkSession);

  // ===================== SHOP (Pac-Man's card layout, Doodle Jump's skins) =====================
  function equipSkin(id) {
    equippedSkinId = id;
    saveEquippedSkin();
  }

  /* Pac-Man's shop: a tab row over a 3-column card grid, one button per
     card (Buy / Equip / Equipped), Buy disabled when the coins aren't
     there, and no toast on equip or purchase. Doodle Jump's skins split
     into its two kinds: the ones you buy, and the ones a level milestone
     unlocks. */
  let activeShopTab = "skins";
  function skinsForTab(cat) {
    return SKINS.filter((s) => (cat === "milestones" ? s.unlock === "level" : s.unlock !== "level"));
  }

  function renderShop(cat) {
    activeShopTab = cat || activeShopTab;
    if (shopTabsEl) {
      [...shopTabsEl.querySelectorAll(".shop-tab")].forEach((t) =>
        t.classList.toggle("active", t.dataset.cat === activeShopTab));
    }
    shopGrid.innerHTML = "";
    skinsForTab(activeShopTab).forEach((skin) => {
      const owned = ownedSkins.includes(skin.id);
      const equipped = owned && equippedSkinId === skin.id;

      const cell = document.createElement("div");
      cell.className = "shop-item" + (equipped ? " equipped-item" : "") +
        (!owned && skin.unlock === "level" ? " locked-item" : "");

      const swatch = document.createElement("div");
      swatch.className = "shop-item-swatch";
      swatch.style.background =
        "radial-gradient(circle at 35% 30%, " + lightenHex(skin.body, 0.35) + ", " + skin.body + " 70%)";
      swatch.textContent = skin.emoji;

      const name = document.createElement("div");
      name.className = "shop-item-name";
      name.textContent = skin.name;

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "shop-item-btn";

      if (equipped) {
        btn.textContent = "Equipped";
        btn.classList.add("equipped");
        btn.disabled = true;
      } else if (owned) {
        btn.textContent = "Equip";
        btn.classList.add("equip");
        btn.addEventListener("click", () => {
          equipSkin(skin.id);
          renderShop(activeShopTab);
        });
      } else if (skin.unlock === "level") {
        btn.textContent = "\u{1F512} Level " + skin.unlockLevel;
        btn.classList.add("buy");
        btn.disabled = true;
        btn.title = "Unlocks when you clear Level " + skin.unlockLevel;
      } else {
        btn.textContent = "Buy \u00b7 " + skin.cost + " \u{1FA99}";
        btn.classList.add("buy");
        if (skin.cost >= 1000) btn.classList.add("long-price");
        btn.disabled = coins < skin.cost;
        btn.addEventListener("click", () => {
          if (coins < skin.cost) return;
          coins -= skin.cost;
          saveCoins();
          updateCoinsUI();
          ownedSkins.push(skin.id);
          saveOwnedSkins();
          equipSkin(skin.id);
          renderShop(activeShopTab);
        });
      }

      cell.appendChild(swatch);
      cell.appendChild(name);
      cell.appendChild(btn);
      shopGrid.appendChild(cell);
    });
  }

  if (shopTabsEl) {
    [...shopTabsEl.querySelectorAll(".shop-tab")].forEach((tab) => {
      tab.addEventListener("click", () => renderShop(tab.dataset.cat));
    });
  }

  shopBtn.addEventListener("click", () => {
    updateCoinsUI();
    renderShop(activeShopTab);
    showScreen("shop");
  });

  // ===================== VIDEO / BANNER ADS (Pac-Man's system) =====================
  // - "continue"              -> Game Over -> Watch Ad & Continue
  // - "restart"               -> in-game Restart button (once per attempt)
  // - "level_gate"            -> every 3rd level, when Next Level is pressed
  // - "recover"               -> Level Select, 5 ads to unlock a level after a reset
  // - "level_complete_banner" -> MREC inside the Congratulations popup
  // - "banner" / "leaderboard"-> 300x600 side cards / 970x90 top banner in play
  const SPONSOR_JSON_URL = "sponsor-media.json";
  const AD_LOAD_TIMEOUT_MS = 12000;
  const SPONSOR_FALLBACK_CATALOGUE = {
    "ads": [
      {
        "id": "dj-continue-1",
        "adType": "video",
        "advertiser": "Continue Sponsor",
        "duration": 67,
        "isSkippable": true,
        "nonSkippableSeconds": 10,
        "streamUrl": "ad-continue-2.mp4",
        "placements": [
          "continue"
        ]
      },
      {
        "id": "dj-continue-2",
        "adType": "video",
        "advertiser": "Continue Sponsor",
        "duration": 16,
        "isSkippable": true,
        "nonSkippableSeconds": 10,
        "streamUrl": "ad-continue-3.mp4",
        "placements": [
          "continue"
        ]
      },
      {
        "id": "dj-restart-1",
        "adType": "video",
        "advertiser": "Restart Sponsor",
        "duration": 30,
        "isSkippable": true,
        "nonSkippableSeconds": 10,
        "streamUrl": "ad-restart-2.mp4",
        "placements": [
          "restart"
        ]
      },
      {
        "id": "dj-restart-2",
        "adType": "video",
        "advertiser": "Restart Sponsor",
        "duration": 36,
        "isSkippable": true,
        "nonSkippableSeconds": 10,
        "streamUrl": "ad-restart-3.mp4",
        "placements": [
          "restart"
        ]
      },
      {
        "id": "dj-levelgate-1",
        "adType": "video",
        "advertiser": "Level Sponsor",
        "duration": 27,
        "isSkippable": true,
        "nonSkippableSeconds": 10,
        "streamUrl": "ad-levelgate-2.mp4",
        "placements": [
          "level_gate"
        ]
      },
      {
        "id": "dj-recover-1",
        "adType": "video",
        "advertiser": "Unlock Sponsor",
        "duration": 25,
        "isSkippable": true,
        "nonSkippableSeconds": 10,
        "streamUrl": "ad-recover-2.mp4",
        "placements": [
          "recover"
        ]
      },
      {
        "id": "dj-banner-creditkey",
        "adType": "image",
        "advertiser": "Credit Key",
        "title": "Credit Key",
        "subtitle": "Buy Now, Pay On Your Terms",
        "ctaText": "Learn more",
        "bgFrom": "#0b1450",
        "bgTo": "#1e3a8a",
        "streamUrl": "ad-creditkey-mrec.png",
        "clickUrl": "",
        "placements": [
          "level_complete_banner"
        ],
        "adSize": "MREC",
        "imageUrl": "ad-creditkey-mrec.png"
      },
      {
        "id": "dj-banner-creditkey-2",
        "adType": "image",
        "advertiser": "Credit Key",
        "title": "Credit Key",
        "subtitle": "Buy Now, Pay On Your Terms",
        "ctaText": "Learn more",
        "bgFrom": "#0b1450",
        "bgTo": "#1e3a8a",
        "streamUrl": "ad-creditkey-mrec-2.png",
        "clickUrl": "",
        "placements": [
          "level_complete_banner"
        ],
        "imageUrl": "ad-creditkey-mrec-2.png",
        "adSize": "MREC"
      },
      {
        "id": "dj-banner-creditkey-3",
        "adType": "image",
        "advertiser": "Credit Key",
        "title": "Credit Key",
        "subtitle": "Buy Now, Pay On Your Terms",
        "ctaText": "Learn more",
        "bgFrom": "#0b1450",
        "bgTo": "#1e3a8a",
        "streamUrl": "ad-creditkey-mrec-3.png",
        "clickUrl": "",
        "placements": [
          "level_complete_banner"
        ],
        "imageUrl": "ad-creditkey-mrec-3.png",
        "adSize": "MREC"
      },
      {
        "id": "dj-rail-creditkey",
        "adType": "image",
        "adSize": "VERTICAL_BANNER",
        "advertiser": "Credit Key",
        "title": "Credit Key",
        "subtitle": "Buy Now, Pay On Your Terms",
        "rating": 4.5,
        "ctaText": "Learn more",
        "bgFrom": "#0b1450",
        "bgTo": "#1e3a8a",
        "streamUrl": "ad-creditkey-banner.png",
        "clickUrl": "",
        "placements": [
          "banner"
        ],
        "imageUrl": "ad-creditkey-banner.png",
        "bgBottom": "#070d59"
      },
      {
        "id": "dj-rail-creditkey-2",
        "adType": "image",
        "advertiser": "Credit Key",
        "title": "Credit Key",
        "subtitle": "Buy Now, Pay On Your Terms",
        "ctaText": "Learn more",
        "bgFrom": "#0b1450",
        "bgTo": "#1e3a8a",
        "streamUrl": "ad-creditkey-banner-2.png",
        "clickUrl": "",
        "placements": [
          "banner"
        ],
        "imageUrl": "ad-creditkey-banner-2.png",
        "adSize": "VERTICAL_BANNER",
        "bgBottom": "#091148"
      },
      {
        "id": "dj-rail-creditkey-3",
        "adType": "image",
        "advertiser": "Credit Key",
        "title": "Credit Key",
        "subtitle": "Buy Now, Pay On Your Terms",
        "ctaText": "Learn more",
        "bgFrom": "#0b1450",
        "bgTo": "#1e3a8a",
        "streamUrl": "ad-creditkey-banner-3.png",
        "clickUrl": "",
        "placements": [
          "banner"
        ],
        "imageUrl": "ad-creditkey-banner-3.png",
        "adSize": "VERTICAL_BANNER",
        "bgBottom": "#0d1a6b"
      },
      {
        "id": "dj-leader-creditkey",
        "adType": "image",
        "adSize": "LEADER_BOARD",
        "advertiser": "Credit Key",
        "title": "Credit Key",
        "subtitle": "Buy Now, Pay On Your Terms",
        "ctaText": "Learn more",
        "bgFrom": "#0b1450",
        "bgTo": "#1e3a8a",
        "streamUrl": "ad-creditkey-leaderboard.png",
        "clickUrl": "",
        "placements": [
          "leaderboard"
        ],
        "imageUrl": "ad-creditkey-leaderboard.png"
      },
      {
        "id": "dj-leader-creditkey-2",
        "adType": "image",
        "advertiser": "Credit Key",
        "title": "Credit Key",
        "subtitle": "Buy Now, Pay On Your Terms",
        "ctaText": "Learn more",
        "bgFrom": "#0b1450",
        "bgTo": "#1e3a8a",
        "streamUrl": "ad-creditkey-leaderboard-2.png",
        "clickUrl": "",
        "placements": [
          "leaderboard"
        ],
        "imageUrl": "ad-creditkey-leaderboard-2.png",
        "adSize": "LEADER_BOARD"
      },
      {
        "id": "dj-leader-creditkey-3",
        "adType": "image",
        "advertiser": "Credit Key",
        "title": "Credit Key",
        "subtitle": "Buy Now, Pay On Your Terms",
        "ctaText": "Learn more",
        "bgFrom": "#0b1450",
        "bgTo": "#1e3a8a",
        "streamUrl": "ad-creditkey-leaderboard-3.png",
        "clickUrl": "",
        "placements": [
          "leaderboard"
        ],
        "imageUrl": "ad-creditkey-leaderboard-3.png",
        "adSize": "LEADER_BOARD"
      }
    ]
  };
  let sponsorCataloguePromise = null;

  function loadSponsorCatalogue() {
    if (sponsorCataloguePromise) return sponsorCataloguePromise;
    sponsorCataloguePromise = fetch(SPONSOR_JSON_URL, { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error("bad status");
        return res.json();
      })
      .then((data) => {
        if (!data || !data.ads || !data.ads.length) throw new Error("empty");
        return data;
      })
      .catch(() => SPONSOR_FALLBACK_CATALOGUE);
    return sponsorCataloguePromise;
  }

  const sponsorRotation = {};
  function fetchAd(opts) {
    const placement = (opts && opts.placement) || "";
    return loadSponsorCatalogue().then((data) => {
      let list = (data.ads || []).filter((ad) => ad && ad.streamUrl && (!ad.placements || ad.placements.includes(placement)));
      if (opts && opts.adType) list = list.filter((ad) => (ad.adType || "video") === opts.adType);
      if (!list.length) return null;
      const i = sponsorRotation[placement] || 0;
      sponsorRotation[placement] = (i + 1) % list.length;
      /* A copy that also says WHICH creative of how many this is, so the card
         can draw its carousel dots. The catalogue's own objects are left
         untouched. */
      return Object.assign({}, list[i % list.length], { _slot: i % list.length, _slots: list.length });
    });
  }

  /* ---------- Carousel helpers shared by all three ad placements ----------
     adDotsHtml(): the little page indicator (● ○ ○) drawn on top of a card, so
     it is obvious the ad is a carousel and which slide it is on. Nothing is
     drawn for a placement that only has one creative.
     swapAdCard(): fades the card out, swaps its content, fades it back in.
     The rotation used to replace innerHTML in one frame, and with a single
     creative per placement that meant nothing visibly happened at all. */
  function adDotsHtml(ad) {
    if (!ad || !(ad._slots > 1)) return "";
    let h = '<div class="ad-dots" aria-hidden="true">';
    for (let i = 0; i < ad._slots; i++) h += "<i" + (i === ad._slot ? ' class="on"' : "") + "></i>";
    return h + "</div>";
  }

  /* Returns a Promise that resolves AFTER the content has been swapped.
     Callers must re-run their placement in .then(): buildRailCard() and
     buildLeaderboardCard() rewrite the element's style attribute, which wipes
     the inline left/top/--ad-scale the fit code set, so a placement that ran
     before the (delayed) swap would leave the card stuck at the page's 0,0. */
  function swapAdCard(el, build) {
    if (!el) return Promise.resolve();
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || !el.innerHTML) {
      build();
      return Promise.resolve();
    }
    el.classList.add("ad-fading");
    return new Promise((resolve) => {
      setTimeout(() => {
        build();
        resolve();
        /* two frames so the browser paints the new content at opacity 0 before
           the fade back in starts */
        requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove("ad-fading")));
      }, 260);
    });
  }

  function adIsImage(ad) {
    if (!ad) return false;
    if (ad.adType && String(ad.adType).toLowerCase() === "image") return true;
    return /\.(png|jpe?g|gif|webp|avif)(\?|$)/i.test(ad.streamUrl || "");
  }

  // Elements for the fullscreen video ad overlay
  const adOverlayEl = document.getElementById("adOverlay");
  const adVideoEl = document.getElementById("adVideo");
  const adStatusEl = document.getElementById("adStatus");
  const adAdvertiserEl = document.getElementById("adAdvertiser");
  const adCountdownEl = document.getElementById("adCountdown");
  const adSkipBtn = document.getElementById("adSkipBtn");
  const adUnmuteBtn = document.getElementById("adUnmuteBtn");
  const adRewardNoteEl = document.getElementById("adRewardNote");
  let adIsPlaying = false;

  function closeAdOverlay() {
    adIsPlaying = false;
    try {
      adVideoEl.pause();
      adVideoEl.removeAttribute("src");
      adVideoEl.load();
    } catch (e) {}
    if (adOverlayEl) adOverlayEl.classList.add("hidden");
    if (adSkipBtn) adSkipBtn.classList.add("ad-hidden");
    if (adUnmuteBtn) adUnmuteBtn.classList.add("ad-hidden");
    if (adCountdownEl) adCountdownEl.textContent = "";
    if (adAdvertiserEl) adAdvertiserEl.textContent = "";
    if (adRewardNoteEl) adRewardNoteEl.textContent = "";
  }

  /**
   * Plays a fullscreen video ad. Always resolves (never rejects) with
   * { shown: boolean, completed: boolean } — if no ad is available or it
   * fails to load, the overlay closes instantly and the caller continues as
   * normal; the player is never blocked. `completed` is true only when the
   * video played to its end (not when it was skipped); rewards that must be
   * fully earned (Watch Ad & Continue) check it.
   */
  function playVideoAd(opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      if (adIsPlaying || !adOverlayEl) {
        resolve({ shown: false });
        return;
      }
      adIsPlaying = true;

      adOverlayEl.classList.remove("hidden");
      adStatusEl.classList.remove("ad-hidden");
      adStatusEl.textContent = "Loading ad\u2026";
      adSkipBtn.classList.add("ad-hidden");
      adUnmuteBtn.classList.add("ad-hidden");
      adCountdownEl.textContent = "";
      adAdvertiserEl.textContent = "";
      adRewardNoteEl.textContent = opts.rewardText || "";

      let settled = false;
      let loadTimer = null;
      let cleanup = () => {};

      function finish(shown, completed) {
        if (settled) return;
        settled = true;
        clearTimeout(loadTimer);
        cleanup();
        closeAdOverlay();
        resolve({ shown: !!shown, completed: !!completed });
      }

      fetchAd({ placement: opts.placement || "continue", adType: "video" }).then((ad) => {
        if (settled) return;
        if (!ad) {
          finish(false);
          return;
        }

        const duration = Number(ad.duration) || 0;
        const skippable = ad.isSkippable === true;
        const skipAfter = Math.max(0, Number(ad.nonSkippableSeconds) || 0);
        adAdvertiserEl.textContent = ad.advertiser || ad.title || "";

        const onLoaded = () => adStatusEl.classList.add("ad-hidden");
        const onTime = () => {
          const total = duration || adVideoEl.duration || 0;
          const left = Math.max(0, Math.ceil(total - adVideoEl.currentTime));
          adCountdownEl.textContent = total ? left + "s" : "";
          if (skippable && adVideoEl.currentTime >= skipAfter) adSkipBtn.classList.remove("ad-hidden");
        };
        const onEnded = () => finish(true, true);
        const onError = () => {
          if (adVideoEl.error) finish(false);
        };
        const onSkip = () => finish(true, false);
        const onUnmute = () => {
          adVideoEl.muted = false;
          adVideoEl.volume = 1;
          adUnmuteBtn.classList.add("ad-hidden");
        };
        const tryPlay = () => {
          const p = adVideoEl.play();
          if (!p || typeof p.catch !== "function") return;
          p.catch((err) => {
            if (err && err.name === "NotAllowedError") {
              adVideoEl.muted = true;
              adUnmuteBtn.classList.remove("ad-hidden");
              const retry = adVideoEl.play();
              if (retry && typeof retry.catch === "function") retry.catch(() => {});
            }
          });
        };
        const onCanPlay = () => {
          if (adVideoEl.paused) tryPlay();
        };

        cleanup = () => {
          adVideoEl.removeEventListener("loadedmetadata", onLoaded);
          adVideoEl.removeEventListener("timeupdate", onTime);
          adVideoEl.removeEventListener("ended", onEnded);
          adVideoEl.removeEventListener("error", onError);
          adVideoEl.removeEventListener("canplay", onCanPlay);
          adSkipBtn.removeEventListener("click", onSkip);
          adUnmuteBtn.removeEventListener("click", onUnmute);
        };

        adVideoEl.addEventListener("loadedmetadata", onLoaded);
        adVideoEl.addEventListener("timeupdate", onTime);
        adVideoEl.addEventListener("ended", onEnded);
        adVideoEl.addEventListener("error", onError);
        adVideoEl.addEventListener("canplay", onCanPlay);
        adSkipBtn.addEventListener("click", onSkip);
        adUnmuteBtn.addEventListener("click", onUnmute);

        adVideoEl.muted = !soundEnabled;
        adVideoEl.src = ad.streamUrl;
        tryPlay();

        loadTimer = setTimeout(() => {
          if (!settled && adVideoEl.currentTime === 0) finish(false);
        }, AD_LOAD_TIMEOUT_MS);
      });
    });
  }

  // Compact horizontal ad card: icon, title, subtitle, CTA button in a row.
  /* ---------- MREC 300x250 (medium rectangle) — inside the popup ----------
     Built at its exact pixel size and scaled down as a whole only if the popup
     is narrower than 300px, so the standard shape is always kept. */
  function buildBannerCard(el, ad) {
    el.classList.toggle("clickable", !!ad.clickUrl);
    el.onclick = ad.clickUrl ? () => window.open(ad.clickUrl, "_blank", "noopener") : null;
    el.classList.remove("hidden");

    /* MREC, 300x250. Same reasoning as the side rails: one <img> at the exact
       IAB size beats four stacked elements that each have to land in the right
       place. The unit scales down as a whole on narrow popups, keeping 6:5. */
    if (ad.imageUrl) {
      el.removeAttribute("style");
      el.innerHTML =
        '<img class="ad-unit-img" src="' + ad.imageUrl + '" width="300" height="250" alt="' +
        (ad.advertiser || "Advertisement") + '" />' + adDotsHtml(ad);
      return;
    }

    const bgFrom = ad.bgFrom || "#6a3fb5";
    const title = ad.title || ad.advertiser || "Sponsored";
    const subtitle = ad.subtitle || "Free \u00b7 Sponsored";
    const cta = ad.ctaText || "Learn More";
    const rating = Math.round(ad.rating || 4.5);
    const stars = "\u2605".repeat(Math.min(5, rating)) + "\u2606".repeat(Math.max(0, 5 - rating));

    el.removeAttribute("style");
    el.innerHTML =
      /* Solid background, not a gradient: a two-tone diagonal across a small
         card reads as two different-coloured strips once the unit is scaled
         down rather than as one card, which is what "different colours top
         and bottom" was. One flat colour stays one colour at any scale. */
      '<div class="ad-mrec" style="background:' + bgFrom + '">' +
        '<span class="ad-mrec-tag">AD</span>' +
        '<div class="ad-mrec-icon"><img alt="" src="' + ad.streamUrl + '"></div>' +
        '<div class="ad-mrec-title">' + title + "</div>" +
        '<div class="ad-mrec-stars">' + stars + "</div>" +
        '<div class="ad-mrec-sub">' + subtitle + "</div>" +
        '<button type="button" class="ad-mrec-cta">' + cta + "</button>" +
      "</div>";

    el.classList.toggle("clickable", !!ad.clickUrl);
    el.onclick = ad.clickUrl ? () => window.open(ad.clickUrl, "_blank", "noopener") : null;
    el.classList.remove("hidden");
    fitMrec(el);
  }

  /* The card is 300x250 exactly; if the dialog is narrower than that (small
     phones) the whole card is scaled, never squashed. */
  function fitMrec(el) {
    if (!el || el.classList.contains("hidden")) return;
    const avail = el.clientWidth || 300;
    const scale = Math.min(avail / 300, 1);
    el.style.setProperty("--mrec-scale", String(Math.max(0.5, Math.floor(scale * 100) / 100)));
  }

  function loadLevelCompleteBanner() {
    if (!modalBannerAd) return;
    fetchAd({ placement: "level_complete_banner", adType: "image" }).then((ad) => {
      if (!ad || !adIsImage(ad)) {
        modalBannerAd.classList.add("hidden");
        modalBannerAd.innerHTML = "";
        stopModalBannerCarousel();
        return;
      }
      buildBannerCard(modalBannerAd, ad);
      /* The card is up, so start rotating it. Started on the far side of the
         fetch rather than beside the call: if the placement returns nothing
         there is no card, and a timer ticking against a hidden element would
         be the only thing left running. */
      startModalBannerCarousel();
    });
  }


  // ===================== BOARD BOX (Pac-Man's measuring helpers) =====================
  function layoutSize(el) {
    if (!el) return { w: 0, h: 0 };
    return { w: el.offsetWidth || 0, h: el.offsetHeight || 0 };
  }

  function layoutOffset(el) {
    let left = 0;
    let top = 0;
    let node = el;
    while (node) {
      left += node.offsetLeft || 0;
      top += node.offsetTop || 0;
      node = node.offsetParent;
    }
    return { left, top };
  }

  /* The box the BOARD itself may occupy: its column, less the hint line, which
     is a sibling in the same column and so not the board's height to spend.
     That line used to be taken out of the board's space by the flexbox after
     the fact, which pushed it past the bottom edge on a short window. */
  function boardHostBox() {
    const host = canvas ? canvas.parentElement : null;
    if (!host) return { w: 0, h: 0 };
    const size = layoutSize(host);
    const hint = host.querySelector(".hint");
    let taken = 0;
    if (hint && hint.offsetParent !== null) {
      const gap = parseFloat(getComputedStyle(host).rowGap) || 0;
      taken = hint.offsetHeight + gap;
    }
    return { w: size.w, h: Math.max(40, size.h - taken) };
  }

  function boardBoxNoBand() {
    const gs = document.getElementById("gameScreen");
    const host = canvas ? canvas.parentElement : null;
    if (!gs || !host) return { w: 0, h: 0 };

    const cs = getComputedStyle(gs);
    const band = parseFloat(cs.getPropertyValue("--ad-band")) || 0;
    const padT = parseFloat(cs.paddingTop) || 0;
    const padB = parseFloat(cs.paddingBottom) || 0;
    const colGap = parseFloat(cs.rowGap) || 0;
    const hdr = gs.querySelector(".header");
    const hdrH = hdr ? hdr.offsetHeight : 0;

    // clientHeight is content + padding, so the padding comes back off; adding
    // the band back on is what makes this "as if nothing were reserved".
    let inner = gs.clientHeight - padT - padB + band - hdrH - (hdrH ? colGap : 0);

    const hint = host.querySelector(".hint");
    if (hint && hint.offsetParent !== null) {
      const g = parseFloat(getComputedStyle(host).rowGap) || 0;
      inner -= hint.offsetHeight + g;
    }

    return { w: layoutSize(host).w, h: Math.max(40, inner) };
  }


  /* The narrowest box the board can fill edge to edge with the world at its
     full height (480 x 600), and the flattest the leaderboard band may leave
     it. Doodle Jump's world is a fixed 4:5; the extra room on either axis is
     filled by the view (see resizeCanvas), so these two bound the band and
     the landscape column exactly as Pac-Man's tilt range does for its maze. */
  function minBoardAspect() { return CANVAS_WIDTH / CANVAS_HEIGHT; }
  /* The flattest box the leaderboard band may leave in portrait: the world
     still fills the full width up to 4:5 and keeps its full height beyond
     it, with sky either side, so a little flatter than 4:5 costs nothing
     and gives the band room on tablets held upright and small phones. */
  function maxBoardAspect() { return 1.0; }

  // ===================== LEVEL COMPLETE / GAME OVER =====================
  /* The win / Game Over popups open after a 150ms beat (Pac-Man). The timer
     is kept so leaving the board inside that beat can cancel it. */
  let resultPopupTimer = null;
  /* What the shared popup is showing right now: "win" or "over". */
  let modalMode = null;

  function resetModalExtras() {
    modalCoins.classList.add("hidden");
    continueAdBtn.classList.add("hidden");
    continueNote.classList.add("hidden");
    modalBannerAd.classList.add("hidden");
    modalBannerAd.innerHTML = "";
    stopModalBannerCarousel();
  }

  function isAdGateLevel(level) {
    return level % 3 === 0; // interstitial on every 3rd level clear
  }

  /* Congratulations — Pac-Man's popup row for row: title, one-line message,
     coins line, 300x250 MREC, [Next Level | Levels], [Level N-1].
     Doodle Jump's own reward data (coins collected this run, star rating,
     a first-time milestone bonus) all ride on the single coins line, and
     the coins are paid the moment the level is cleared, as in Pac-Man. */
  function handleLevelComplete() {
    stopLoop();
    levelCleared = true;
    playCongratsSound();
    markLevelCompleted(currentLevel);
    const isLast = currentLevel >= TOTAL_LEVELS;
    const clearedLevel = currentLevel;
    const clearScore = score;

    const stars = computeStars();
    const milestone = checkMilestone(currentLevel); // pays its own bonus
    const runCoins = sessionCoins;
    sessionCoins = 0;
    if (runCoins > 0) addCoins(runCoins);
    updateCoinsUI();
    updatePrevNextButtons();

    clearTimeout(resultPopupTimer);
    resultPopupTimer = setTimeout(() => {
      resultPopupTimer = null;
      modalMode = "win";
      resetModalExtras();

      modalTitle.textContent = "\u{1F389} Congratulations!";
      modalMessage.textContent = isLast
        ? `You finished all ${TOTAL_LEVELS} levels with a score of ${clearScore}!`
        : `Level ${clearedLevel} cleared with a score of ${clearScore}. Level ${clearedLevel + 1} is now unlocked.`;

      let coinLine = "\u2B50".repeat(stars) + "\u2606".repeat(3 - stars) +
        "  +" + runCoins + " \u{1FA99} coins";
      if (milestone) coinLine += "  \u00b7  \u{1F3C6} +" + milestone.coins;
      modalCoins.textContent = coinLine;
      modalCoins.title = milestone ? "Milestone: " + milestone.name : "";
      modalCoins.classList.remove("hidden");

      loadLevelCompleteBanner();

      wireModalButtons(
        isLast ? "\u{1F5FA} Levels" : "Next Level \u27A1",
        "\u{1F5FA} Levels",
        () => {
          if (isLast) {
            goToLevelSelect();
            return;
          }
          if (isAdGateLevel(clearedLevel)) {
            modalPrimaryBtn.disabled = true;
            playVideoAd({
              placement: "level_gate",
              rewardText: `Level ${clearedLevel} cleared \u2014 your reward is next!`,
            }).then(() => {
              /* An interstitial, not a reward: the next level was already
                 earned, so the game moves on even if the ad could not load. */
              modalPrimaryBtn.disabled = false;
              enterLevel(clearedLevel + 1);
            });
          } else {
            enterLevel(clearedLevel + 1);
          }
        },
        () => goToLevelSelect()
      );
      setModalPrevLevel(clearedLevel > 1 ? clearedLevel - 1 : 0);
      overlay.classList.remove("hidden");
    }, 150);
  }

  function handleGameOver() {
    stopLoop();
    playLoseSound();

    clearTimeout(resultPopupTimer);
    resultPopupTimer = setTimeout(() => {
      resultPopupTimer = null;
      modalMode = "over";
      resetModalExtras();
      showGameOverContent();
      overlay.classList.remove("hidden");
    }, 150);
  }

  /* Game Over — Pac-Man's popup: one-line message, Watch Ad & Continue
     ALWAYS offered (no cap), Retry Level, Level Select, then the note. */
  function showGameOverContent() {
    modalTitle.textContent = "Game Over \u{1F480}";
    modalMessage.textContent =
      `You scored ${score} / ${levelConfig.targetScore} on Level ${currentLevel}.`;

    continueAdBtn.classList.remove("hidden");
    continueAdBtn.disabled = false;
    continueNote.classList.remove("hidden");
    continueNote.textContent = "Watch the whole ad to get " + MAX_LIVES + " fresh lives and carry on " +
      "from the same platform, with your score of " + score + " kept.";

    wireModalButtons(
      "\u{1F501} Retry Level",
      "\u{1F5FA} Level Select",
      () => enterLevel(currentLevel),
      () => goToLevelSelect()
    );
  }

  let continueAdInFlight = false;
  function grantContinue() {
    // Only guard against a double-click while this ad is playing — never a cap.
    if (continueAdInFlight || modalMode !== "over") return;
    continueAdInFlight = true;
    continueAdBtn.disabled = true;
    overlay.classList.add("hidden");
    stopModalBannerCarousel();
    playVideoAd({
      placement: "continue",
      rewardText: "Watch the whole ad to get your " + MAX_LIVES + " lives back \u2014 same platform, same score.",
    }).then((res) => {
      continueAdInFlight = false;
      /* The 3 lives come back only for an ad watched to the end. If it could
         not load, or was skipped before it finished, nothing is restored and
         the Game Over popup returns so the player can try again. */
      if (!res || !res.completed) {
        continueAdBtn.disabled = false;
        continueNote.textContent = res && res.shown
          ? "The ad was skipped before the end, so your lives were not restored. Watch the whole ad to continue."
          : "The ad couldn't load, so no continue was given. Please try again.";
        overlay.classList.remove("hidden");
        return;
      }
      modalMode = null;
      continueAfterAd();
    });
  }
  continueAdBtn.addEventListener("click", grantContinue);

  /* ---------- Back on the platform it fell from ----------
     After a fall (a lost life, or Watch Ad & Continue) the doodler goes back
     onto the platform it last bounced on — the one it fell from — exactly
     where that platform is. No platform is added or moved, so the layout the
     player was climbing stays the same. A breaking platform that had
     crumbled under it is restored for the restart. If that platform is
     somehow gone, the lowest platform still on screen is used instead. */
  function respawnOnLastPlatform() {
    let p = lastPlatform && platforms.includes(lastPlatform) ? lastPlatform : null;
    if (!p) {
      p = platforms
        .filter((q) => q.y - cameraY < CANVAS_HEIGHT - 20)
        .reduce((best, q) => (!best || q.y > best.y ? q : best), null);
    }
    if (!p) return;
    p.broken = false;
    respawnHold = p.type === "break" ? p : null;
    // Keep it on screen: if it has scrolled near the bottom edge, bring the
    // view down just enough to show it with room to see the bounce.
    if (p.y - cameraY > CANVAS_HEIGHT - 120) cameraY = p.y - (CANVAS_HEIGHT - 120);
    lastPlatform = p;

    player.x = Math.max(0, Math.min(CANVAS_WIDTH - PLAYER_WIDTH, p.x + p.width / 2 - PLAYER_WIDTH / 2));
    player.y = p.y - PLAYER_HEIGHT - 2;
    player.vx = 0;
    player.vy = 0;
    keys.left = keys.right = false;
    respawnBlinkUntil = time + RESPAWN_BLINK_STEPS;
  }

  // A fall that still leaves a life: one life off, back on a safe platform.
  function loseLife() {
    lives = Math.max(0, lives - 1);
    updateLivesUI();
    flashLivesChip();
    playLifeLostSound();
    respawnOnLastPlatform();
  }

  function continueAfterAd() {
    adContinuesUsed++;
    lives = MAX_LIVES;
    updateLivesUI();
    respawnOnLastPlatform();
    startLoop();
  }

  /* ---------- Fixed 60 Hz simulation ----------
     The physics were written per animation frame (vy += gravity, x += 5 per
     frame), and the loop advanced them once per requestAnimationFrame. A
     120 Hz phone or a ProMotion iPad calls that twice as often, so the whole
     game — falling, jumping, sideways speed, moving platforms — ran at double
     speed there, and at 50/75/144 Hz it ran at the wrong speed too.
     The simulation now advances in fixed 1/60 s steps however often the
     screen refreshes: the numbers above mean exactly what they always meant
     on a 60 Hz screen. A long stall (tab switch, debugger) is capped so the
     game never fast-forwards to catch up. */
  const STEP_MS = 1000 / 60;
  const MAX_STEPS_PER_FRAME = 5;
  let lastFrameTime = null;
  let stepAccumulator = 0;

  function startLoop() {
    if (animationId) cancelAnimationFrame(animationId);
    gameRunning = true;
    lastFrameTime = null;
    stepAccumulator = 0;
    animationId = requestAnimationFrame(gameLoop);
  }

  function gameLoop(now) {
    if (!gameRunning) return;
    if (lastFrameTime === null) lastFrameTime = now;
    stepAccumulator += Math.min(now - lastFrameTime, 100);
    lastFrameTime = now;

    let steps = 0;
    while (stepAccumulator >= STEP_MS && steps < MAX_STEPS_PER_FRAME) {
      stepAccumulator -= STEP_MS;
      steps++;
      if (!stepGame()) return; // the level ended this step
    }
    if (steps === MAX_STEPS_PER_FRAME) stepAccumulator = 0;

    render();
    animationId = requestAnimationFrame(gameLoop);
  }

  // One 1/60 s tick of the game. Returns false once the run has ended.
  function stepGame() {
    time++;

    /* An ad-unlocked level counts as played once the player steers in it.
       (Not on the first climb: the doodler can bounce onto a platform
       straight above without any input, which is not playing the level.) */
    if (respawnHold && (keys.left || keys.right)) respawnHold = null;
    if (lastPlayedPending && (keys.left || keys.right)) {
      lastPlayedPending = false;
      setLastPlayedLevel(currentLevel);
    }
    if (keys.left) {
      player.vx = -MOVE_SPEED;
      player.facing = -1;
    } else if (keys.right) {
      player.vx = MOVE_SPEED;
      player.facing = 1;
    }
    else player.vx *= 0.85;
    player.x += player.vx;
    player.x = Math.max(0, Math.min(CANVAS_WIDTH - player.width, player.x));
    player.vy += levelConfig.gravity;
    const prevBottom = player.y + player.height;
    player.y += player.vy;

    const foot = footHalf();
    const playerCentre = player.x + PLAYER_WIDTH / 2;
    for (let i = platforms.length - 1; i >= 0; i--) {
      const p = platforms[i];
      if (p.type === "moving") {
        p.x = p.startX + Math.sin((time + p.startX) * 0.03) * p.moveRange * p.moveDir;
        p.x = Math.max(0, Math.min(CANVAS_WIDTH - p.width, p.x));
      }

      const py = p.y - cameraY;
      if (py > CANVAS_HEIGHT + 100) {
        platforms.splice(i, 1);
        continue;
      }

      if (p.broken) continue;
      const playerBottom = player.y + player.height;
      const platformTop = p.y;
      // The body the player sees, not the full 36px box (see footHalf).
      const overlapX = playerCentre + foot > p.x && playerCentre - foot < p.x + p.width;
      // Swept check: land if the player's feet crossed the platform's top
      // surface this frame, no matter how far they moved — this prevents
      // fast falls (high gravity / high levels) from tunneling through.
      if (
        overlapX &&
        player.vy >= 0 &&
        prevBottom <= platformTop + 2 &&
        playerBottom >= platformTop - 2
      ) {
        player.vy = JUMP_FORCE;
        player.y = platformTop - player.height - 1;
        lastPlatform = p;
        playJumpSound();

        // Award points per climb (a jump onto a new highest platform) instead
        // of continuously by pixels — a fixed +5 each time, not a big chunk.
        if (platformTop < highestY) {
          highestY = platformTop;
          score += CLIMB_POINTS;
          scoreEl.textContent = score;
          if (score > highScore) {
            highScore = score;
            highScoreEl.textContent = highScore;
            store.set(HIGH_SCORE_KEY, String(highScore));
          }
        }

        /* A breaking platform crumbles when used. It used to be deleted for
           good, so a doodler that missed the next jump and fell back onto
           the platform below it was left with a gap too high to jump and
           nothing to do but bounce until it stepped off to its death. It
           now comes back if the doodler lands anywhere below it again. */
        if (p.type === "break" && p !== respawnHold) p.broken = true;
        platforms.forEach((q) => {
          if (q.broken && q !== p && q.y < platformTop) q.broken = false;
        });
        // A doodler can only land on one platform per frame. Without this
        // break, a second nearby/overlapping platform could be checked
        // against a stale prevBottom (computed once above) combined with
        // the just-updated player.y from this bounce, wrongly triggering
        // a second bounce in the same frame and causing a jittery/glitchy
        // double-jump on close platform stacks.
        break;
      }
    }

    // Collectible coins: prune off-screen ones and pick up anything the
    // player's bounding box touches. Collected coins are added to the
    // persistent coin balance immediately, live during the run.
    for (let i = coinItems.length - 1; i >= 0; i--) {
      const c = coinItems[i];
      if (c.collected) continue;
      const cy = c.y - cameraY;
      if (cy > CANVAS_HEIGHT + 100) {
        coinItems.splice(i, 1);
        continue;
      }
      // Coins are picked up by the body the player sees (feet span / 70%).
      const body = foot / FEET_SPAN;
      const overlap =
        playerCentre - body < c.x + c.width &&
        playerCentre + body > c.x &&
        player.y < c.y + c.height &&
        player.y + player.height > c.y;
      if (overlap) {
        c.collected = true;
        coinItems.splice(i, 1);
        // Not committed to the permanent balance yet — only counts if this
        // run ends in a level clear (see handleLevelComplete / handleGameOver).
        sessionCoins++;
        updateCoinsUI();
        playCoinSound();
      }
    }

    const targetCameraY = player.y - CANVAS_HEIGHT * CAMERA_LEAD;
    if (targetCameraY < cameraY) {
      cameraY = targetCameraY;
      addPlatformsAbove(cameraY);
    }

    if (!levelCleared && score >= levelConfig.targetScore) {
      render();
      handleLevelComplete();
      return false;
    }

    if (player.y - cameraY > CANVAS_HEIGHT + 50) {
      if (lives > 1) {
        loseLife();
        return true;
      }
      lives = 0;
      updateLivesUI();
      handleGameOver();
      return false;
    }
    return true;
  }

  function startRunning() {
    hideOverlay();
    modalMode = null;
    setPaused(false, true);
    resetGame();
    startLoop();
  }

  // ===================== PAUSE (Pac-Man's in-bar toggle) =====================
  let isPaused = false;

  function setPaused(next, silent) {
    if (next && !isPaused && (!gameRunning || adIsPlaying)) return;
    if (!next && !isPaused) {
      renderPauseBtn();
      return;
    }
    isPaused = next;
    if (isPaused) {
      gameRunning = false;
      if (animationId) cancelAnimationFrame(animationId);
      animationId = null;
      keys.left = false;
      keys.right = false;
      if (btnLeft) btnLeft.classList.remove("active");
      if (btnRight) btnRight.classList.remove("active");
    } else if (!silent && player && screens.game.classList.contains("active")) {
      startLoop();
    }
    renderPauseBtn();
  }

  function renderPauseBtn() {
    if (!pauseBtn) return;
    pauseBtn.innerHTML = isPaused
      ? '<span class="ico">\u25B6</span><span class="lbl">Resume</span>'
      : '<span class="ico">\u23F8</span><span class="lbl">Pause</span>';
    pauseBtn.setAttribute("aria-pressed", String(isPaused));
    pauseBtn.classList.toggle("is-paused", isPaused);
  }

  pauseBtn.addEventListener("click", () => setPaused(!isPaused));

  // ===================== LEVEL FLOW =====================
  /* A level the player picks (Play, a Level Select tile, Prev/Next, Next
     Level, Retry, Restart) is the level they are playing, so it is saved for
     the Play button at once. The 5-ads unlock opens its level straight away
     too, but that alone is not playing it: that level is saved only when the
     player actually steers in it (first left / right input, in stepGame). */
  let lastPlayedPending = false;
  function enterLevel(level, { fromAdUnlock = false } = {}) {
    currentLevel = Math.min(Math.max(level, 1), TOTAL_LEVELS);
    levelConfig = getLevelConfig(currentLevel);
    lastPlayedPending = fromAdUnlock;
    if (!fromAdUnlock) setLastPlayedLevel(currentLevel);
    stopLoop();
    isPaused = false;
    renderPauseBtn();
    hideOverlay();
    restartAdUsedThisRun = false;
    restartBtn.disabled = false;

    levelTitleEl.innerHTML =
      '<span class="lvl-word">Level</span><span class="lvl-num">' + currentLevel + "</span>";
    levelTitleEl.title = "Level " + currentLevel + ": " + levelConfig.name;

    // Straight into play, the way Pac-Man starts a level: no intro popup.
    updatePrevNextButtons();
    showScreen("game");
    resizeCanvas();
    requestAnimationFrame(() => requestAnimationFrame(() => fitSideRails()));
    startRunning();
  }

  function updatePrevNextButtons() {
    prevLevelBtn.disabled = currentLevel <= 1;
    nextLevelBtn.disabled = !isLevelUnlocked(currentLevel + 1);
  }

  /* ---------- Restart, gated behind one rewarded ad per attempt ----------
     Pac-Man's rule: the in-game Restart plays an ad first, once per attempt.
     A fresh entry into a level (Play, Level Select, Prev/Next, Retry) makes
     it available again; the restart itself leaves it used. */
  let restartAdUsedThisRun = false;

  restartBtn.addEventListener("click", () => {
    if (restartAdUsedThisRun) return;
    restartBtn.disabled = true;
    // Hold the run still while the ad is up; resume it if no ad was shown.
    const wasRunning = gameRunning;
    if (wasRunning) stopLoop();
    playVideoAd({
      placement: "restart",
      rewardText: "Watch the ad to restart this level.",
    }).then((res) => {
      if (!res || !res.shown) {
        restartBtn.disabled = false;
        showToast("The ad couldn't load \u2014 level not restarted. Please try again.");
        if (wasRunning && !isPaused && screens.game.classList.contains("active")) {
          startLoop();
        }
        return;
      }
      enterLevel(currentLevel);
      restartAdUsedThisRun = true;
      restartBtn.disabled = true;
    });
  });

  /* ---------- Same ads gate as Level Select, for in-game level nav ---------- */
  function goToLevelGated(level, { closeOverlay } = {}) {
    if (level < 1 || level > TOTAL_LEVELS || levelUnlockInProgress) return;
    if (isLevelUnlocked(level)) {
      if (closeOverlay) hideOverlay();
      enterLevel(level);
      return;
    }
    if (isLevelAdUnlockable(level)) {
      showUnlockConfirm(level, {
        onConfirm: closeOverlay ? hideOverlay : null,
      });
    }
  }

  /* Prev / Next turn green when used, so the player sees which one took
     effect: while pressed (CSS :active) and for a moment after the click,
     long enough to still show once the new level has loaded. */
  const NAV_HIGHLIGHT_MS = 900;
  let navHighlightTimer = null;
  function highlightNavButton(btn) {
    [prevLevelBtn, nextLevelBtn].forEach((b) => b.classList.remove("is-activated"));
    clearTimeout(navHighlightTimer);
    btn.classList.add("is-activated");
    navHighlightTimer = setTimeout(() => btn.classList.remove("is-activated"), NAV_HIGHLIGHT_MS);
  }
  prevLevelBtn.addEventListener("click", () => {
    highlightNavButton(prevLevelBtn);
    goToLevelGated(currentLevel - 1);
  });
  nextLevelBtn.addEventListener("click", () => {
    highlightNavButton(nextLevelBtn);
    goToLevelGated(currentLevel + 1);
  });
  exitBtn.addEventListener("click", () => goToLevelSelect());

  // ===================== SCREEN NAVIGATION =====================
  function showScreen(name) {
    if (!screens[name]) return;
    if (name !== "game") {
      stopLoop();
      isPaused = false;
      renderPauseBtn();
    }
    Object.values(screens).forEach((s) => s.classList.remove("active"));
    screens[name].classList.add("active");
    document.body.classList.toggle("in-game", name === "game");
    // The 300x600 side cards / top leaderboard belong to gameplay only.
    if (name === "game") loadSideRails();
    else hideSideRails();
  }

  function goToLevelSelect() {
    hideOverlay();
    modalMode = null;
    stopLoop();
    buildLevelGrid();
    showScreen("levelSelect");
  }

  playBtn.addEventListener("click", () => enterLevel(getPlayLevel()));
  levelSelectBtn.addEventListener("click", goToLevelSelect);

  /* How to Play opens from the menu tile and from the "?" on Level Select,
     and returns to whichever one it came from. */
  let howToReturnScreen = "menu";
  function openHowToPlay(from) {
    howToReturnScreen = from || "menu";
    showScreen("howto");
  }
  howToPlayBtn.addEventListener("click", () => openHowToPlay("menu"));
  const levelHelpBtn = document.getElementById("levelHelpBtn");
  if (levelHelpBtn) levelHelpBtn.addEventListener("click", () => openHowToPlay("levelSelect"));

  document.querySelectorAll(".back-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const inHowTo = !!btn.closest("#howToPlayScreen");
      if (inHowTo) {
        const target = howToReturnScreen;
        howToReturnScreen = "menu";
        if (target === "levelSelect") goToLevelSelect();
        else showScreen(target);
      } else {
        showScreen(btn.dataset.target);
      }
    });
  });

  // Difficulty label on the tile you can start from, following Doodle
  // Jump's own target-score tiers (1-10, 11-20, 21-30, 31-35).
  function getDifficultyTier(level) {
    if (level <= 10) return { key: "easy", label: "Easy" };
    if (level <= 20) return { key: "medium", label: "Medium" };
    if (level <= 30) return { key: "hard", label: "Hard" };
    return { key: "expert", label: "Expert" };
  }

  function buildLevelGrid() {
    const furthest = getFurthestUnlockedLevel();
    const progressLine = document.getElementById("levelProgressLine");
    if (progressLine) {
      progressLine.textContent = "Level " + furthest + " of " + TOTAL_LEVELS + " unlocked";
    }

    levelGrid.innerHTML = "";
    for (let i = 1; i <= TOTAL_LEVELS; i++) {
      const btn = document.createElement("button");
      const tier = getDifficultyTier(i);
      btn.className = `level-btn diff-${tier.key}`;
      const completed = isLevelCompleted(i);
      const unlocked = isLevelUnlocked(i);
      const adUnlockable = isLevelAdUnlockable(i);
      if (completed) btn.classList.add("completed");
      else if (unlocked) btn.classList.add("unlocked");
      else btn.classList.add("locked");
      btn.title = LEVEL_NAMES[i - 1] ? `Level ${i}: ${LEVEL_NAMES[i - 1]}` : `Level ${i}`;
      btn.innerHTML = completed || unlocked
        ? `<span class="level-num">${i}</span>` +
          (unlocked && !completed ? `<span class="level-diff">${tier.label}</span>` : "")
        : `<span class="level-lock">\u{1F512}</span><span class="level-num">${i}</span>`;
      if (adUnlockable) btn.title = "Watch " + UNLOCK_ADS_REQUIRED + " ads to unlock this level and continue the game";
      if (levelUnlockInProgress) btn.disabled = true;
      btn.addEventListener("click", () => {
        if (levelUnlockInProgress) return;
        if (unlocked) enterLevel(i);
        else if (adUnlockable) showUnlockConfirm(i);
      });
      levelGrid.appendChild(btn);
    }
  }

  /* ---------- Unlock a single locked level by watching 5 ads ----------
     Only after a 24-hour reset has happened (see isLevelAdUnlockable). A
     confirmation comes first; OK plays the ads back to back, then unlocks
     just that level and starts it. One ad failing stops with no unlock. */
  const UNLOCK_ADS_REQUIRED = 5;
  let levelUnlockInProgress = false;

  function showUnlockConfirm(level, { onConfirm } = {}) {
    if (levelUnlockInProgress) return;
    confirmTitleEl.textContent = "\u{1F4FA} Unlock Level " + level;
    confirmMessageEl.textContent =
      "Watch " + UNLOCK_ADS_REQUIRED + " ads to unlock this level and continue the game.";
    confirmSubMessageEl.textContent =
      "You'll watch " + UNLOCK_ADS_REQUIRED + " short ads back to back, then Level " + level + " unlocks and you can play it.";
    confirmSubMessageEl.classList.remove("hidden");

    const freshOk = confirmOkBtn.cloneNode(true);
    confirmOkBtn.replaceWith(freshOk);
    confirmOkBtn = freshOk;
    const freshCancel = confirmCancelBtn.cloneNode(true);
    confirmCancelBtn.replaceWith(freshCancel);
    confirmCancelBtn = freshCancel;

    const close = () => confirmOverlayEl.classList.add("hidden");
    confirmOkBtn.addEventListener("click", () => {
      close();
      if (onConfirm) onConfirm();
      unlockLevelViaAds(level);
    });
    confirmCancelBtn.addEventListener("click", close);
    confirmOverlayEl.classList.remove("hidden");
  }

  function unlockLevelViaAds(level) {
    if (levelUnlockInProgress) return;
    levelUnlockInProgress = true;
    buildLevelGrid();

    let watched = 0;
    function playNext() {
      watched++;
      return playVideoAd({
        placement: "recover",
        rewardText: "Watching ad " + watched + " of " + UNLOCK_ADS_REQUIRED + " to unlock Level " + level + "\u2026",
      }).then((res) => {
        if (!res || !res.shown) return false;
        return watched < UNLOCK_ADS_REQUIRED ? playNext() : true;
      });
    }

    playNext().then((ok) => {
      levelUnlockInProgress = false;
      if (!ok) {
        buildLevelGrid();
        showToast("An ad couldn't load \u2014 Level " + level + " was not unlocked. Please try again.");
        return;
      }
      unlockLevel(level);
      buildLevelGrid();
      enterLevel(level, { fromAdUnlock: true });
    });
  }

  // ===================== OVERLAY / MODAL (Pac-Man's wiring) =====================
  function setModalPrevLevel(level) {
    const fresh = modalPrevBtn.cloneNode(true);
    modalPrevBtn.replaceWith(fresh);
    modalPrevBtn = fresh;
    if (!level || level < 1) {
      modalPrevBtn.classList.add("hidden");
      return;
    }
    modalPrevBtn.textContent = "\u2B05 Level " + level;
    modalPrevBtn.classList.remove("hidden");
    modalPrevBtn.addEventListener("click", () => goToLevelGated(level, { closeOverlay: true }));
  }

  function wireModalButtons(primaryLabel, secondaryLabel, onPrimary, onSecondary) {
    modalPrimaryBtn.textContent = primaryLabel;
    modalSecondaryBtn.textContent = secondaryLabel;
    setModalPrevLevel(0);

    const newPrimary = modalPrimaryBtn.cloneNode(true);
    newPrimary.disabled = false;
    modalPrimaryBtn.replaceWith(newPrimary);
    modalPrimaryBtn = newPrimary;
    modalPrimaryBtn.addEventListener("click", onPrimary);

    const newSecondary = modalSecondaryBtn.cloneNode(true);
    modalSecondaryBtn.replaceWith(newSecondary);
    modalSecondaryBtn = newSecondary;
    modalSecondaryBtn.addEventListener("click", onSecondary);
  }

  function hideOverlay() {
    clearTimeout(resultPopupTimer);
    resultPopupTimer = null;
    overlay.classList.add("hidden");
    stopModalBannerCarousel();
  }

  // The popup's X (Pac-Man): straight to Level Select.
  modalCloseX.addEventListener("click", () => {
    hideOverlay();
    goToLevelSelect();
  });

  // ===================== INPUT =====================
  document.addEventListener("keydown", function (e) {
    if (screens.game.classList.contains("active") &&
        (e.key === "Escape" || e.key === "p" || e.key === "P")) {
      e.preventDefault();
      if (overlay.classList.contains("hidden") && !adIsPlaying &&
          confirmOverlayEl.classList.contains("hidden")) {
        setPaused(!isPaused);
      }
      return;
    }
    if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") keys.left = true;
    if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") keys.right = true;
    if (e.key === " ") e.preventDefault();
  });

  document.addEventListener("keyup", function (e) {
    if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") keys.left = false;
    if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") keys.right = false;
  });

  function setKeyLeft(value) {
    keys.left = value;
    if (btnLeft) btnLeft.classList.toggle("active", value);
  }
  function setKeyRight(value) {
    keys.right = value;
    if (btnRight) btnRight.classList.toggle("active", value);
  }
  [[btnLeft, setKeyLeft], [btnRight, setKeyRight]].forEach(([btn, setter]) => {
    if (!btn) return;
    btn.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      setter(true);
    });
    btn.addEventListener("pointerup", function () { setter(false); });
    btn.addEventListener("pointerleave", function () { setter(false); });
    btn.addEventListener("pointercancel", function () { setter(false); });
    btn.addEventListener("contextmenu", (e) => e.preventDefault());
  });

  // Auto-pause a live run when the tab / app goes to the background (Pac-Man).
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (screens.game.classList.contains("active") && gameRunning && !adIsPlaying) setPaused(true);
    } else {
      checkSession();
      if (screens.game.classList.contains("active")) resizeCanvas();
    }
  });

  const AD_RAIL_W = 300;
  const AD_RAIL_H = 600;
  /* IAB LEADER_BOARD 970x90, used by placeLeaderboardTop() instead of the
     VERTICAL_BANNER pair when the ad has to go above the board. */
  const AD_LEADER_W = 970;
  const AD_LEADER_H = 90;
  const LEADER_MIN_SCALE = 0.22;  // below this the card is too small to read.
                                   // Was 0.28 — measured live, a 346x346
                                   // square (a common embedded-widget size)
                                   // computes exactly 0.277, i.e. this used to
                                   // reject the single closest, most cramped
                                   // real case by three thousandths of a
                                   // scale step and show no ad there at all.
                                   // The content is one icon and two lines of
                                   // text on a single row, so it stays
                                   // identifiable well under the rail card's
                                   // 0.34 floor; 0.22 clears 346x346 with
                                   // margin instead of sitting right on its
                                   // edge again.
  /* Both kept deliberately tight. On a width-bound window the arithmetic is
     simply: 2 cards + 4 gaps + maze = window width, so every pixel spent here
     is a pixel the maze does not get. */
  const RAIL_EDGE = 0;   // tablet side ads sit flush to the available outer edge
  /* Equal gap placeLeaderboardTop() leaves above the portrait leaderboard
     and between it and the board. */
  const LEADERBOARD_MARGIN = 5;
  /* Short side at or below this = a phone (isPhoneWidth()). */
  const PHONE_NO_RAIL_MAX_W = 500;


  /* How much of the window each card may take, and how little the maze may be
     left with. On a desktop the full 300px card is a small fraction of the
     width and the maze keeps a comfortable 640px. A tablet has neither to
     spare, so both numbers follow the window instead of being fixed: the card
     is capped at a share of the width so it can never dominate the screen, and
     the maze's floor drops with it so there is still room for both.
     The tablet cases these produce:
       1024x768 landscape -> ~225x450 cards, ~545px of maze
        768x1024 portrait  -> ~150x300 cards, ~430px of maze
     Before this the portrait tablet got no cards at all — the fixed 640px floor
     left nothing over, and the whole rail was hidden. */
  /* ---------- The viewport the LAYOUT actually sees ----------
     This used to have two answers. The stylesheet rotated <html> by -90deg on
     every portrait screen, and inside that rotation the page was laid out at
     innerHeight x innerWidth — the two SWAPPED — so every measurement here had
     to know which way the page was turned and half the file's comments are
     about getting that right.
     The rotation is gone (see the orientation block in style.css), so there is
     one answer again: the layout viewport, as the browser reports it.
     clientWidth/clientHeight rather than innerWidth/innerHeight because the
     latter follow the VISUAL viewport, which moves when the user pinch-zooms or
     a phone's address bar slides away — the cards would resize under them. */

  function layoutViewport() {
    const de = document.documentElement;
    return {
      w: de.clientWidth || window.innerWidth,
      h: de.clientHeight || window.innerHeight,
    };
  }

  function isPhoneWidth() {
    const w = window.innerWidth || 9999;
    const h = window.innerHeight || 9999;
    return Math.min(w, h) <= PHONE_NO_RAIL_MAX_W;
  }


  /* Looked up on demand rather than held in a const: this block sits at the
     end of the file, but showScreen() runs during start-up, and a const here
     would still be in its temporal dead zone at that point — reading it threw
     "Cannot access 'adRailLeft' before initialization" and killed the whole
     start-up path. */
  function railEls() {
    return [document.getElementById("adRailLeft"), document.getElementById("adRailRight")];
  }

  function railCardHtml(ad) {
    const rating = Math.round(ad.rating || 4.5);
    const stars = "\u2605".repeat(Math.min(5, rating)) + "\u2606".repeat(Math.max(0, 5 - rating));
    return (
      '<div class="ad-rail-art">' +
        '<span class="ad-rail-tag">AD</span>' +
        '<div class="ad-rail-icon"><img alt="" src="' + ad.streamUrl + '"></div>' +
        '<div class="ad-rail-title">' + (ad.title || ad.advertiser || "Sponsored") + "</div>" +
        '<div class="ad-rail-stars">' + stars + "</div>" +
        '<div class="ad-rail-subtitle">' + (ad.subtitle || "Free \u00b7 Sponsored") + "</div>" +
        '<div class="ad-rail-sponsored">Sponsored</div>' +
      "</div>" +
      '<button type="button" class="ad-rail-cta">' + (ad.ctaText || "Learn More") + "</button>"
    );
  }

  /* A creative with `imageUrl` is a whole-unit STATIC IMAGE: one file that is
     already the full 300x600, drawn as a single <img> and nothing else. That is
     what an IAB static unit is, and it removes every way a card could come out
     blank — there is no gradient to compute, no icon to place, no four pieces of
     text to lay out. Creatives without `imageUrl` still get the old assembled
     card, so a catalogue that only supplies an icon keeps working. */
  function buildRailCard(el, ad) {
    el.classList.toggle("clickable", !!ad.clickUrl);
    el.onclick = ad.clickUrl ? () => window.open(ad.clickUrl, "_blank", "noopener") : null;

    if (ad.imageUrl) {
      el.style.background = ad.bgBottom || ad.bgFrom || "#1b2437"; // not setAttribute("style"): that would wipe left/top/--ad-scale
      el.innerHTML =
        '<img class="ad-unit-img" src="' + ad.imageUrl + '" width="300" height="600" alt="' +
        (ad.advertiser || "Advertisement") + '" />';
      return;
    }

    // Solid background, not a gradient — see the note on buildBannerCard's
    // MREC for why: a two-colour diagonal across a small, scaled-down card
    // reads as mismatched colour bands rather than one ad unit.
    el.style.background = ad.bgFrom || "#6a3fb5";
    el.innerHTML = railCardHtml(ad);
  }

  /* ---------- LEADER_BOARD 970x90 card ----------
     Same assembled-card idea as railCardHtml(), laid out as a row instead of
     a column: tag, icon, title+subtitle, CTA, left to right. Used as the
     fallback for creatives with no imageUrl — buildLeaderboardCard() draws a
     real 970x90 raster (e.g. pm-leader-creditkey) as a single <img> instead
     when one is bundled. */
  function leaderboardCardHtml(ad) {
    return (
      '<span class="ad-leaderboard-tag">AD</span>' +
      '<div class="ad-leaderboard-icon"><img alt="" src="' + ad.streamUrl + '"></div>' +
      '<div class="ad-leaderboard-text">' +
        '<div class="ad-leaderboard-title">' + (ad.title || ad.advertiser || "Sponsored") + "</div>" +
        '<div class="ad-leaderboard-subtitle">' + (ad.subtitle || "Free \u00b7 Sponsored") + "</div>" +
      "</div>" +
      '<button type="button" class="ad-leaderboard-cta">' + (ad.ctaText || "Learn More") + "</button>"
    );
  }

  function buildLeaderboardCard(el, ad) {
    if (!el || !ad) return;
    el.classList.toggle("clickable", !!ad.clickUrl);
    el.onclick = ad.clickUrl ? () => window.open(ad.clickUrl, "_blank", "noopener") : null;

    // Same whole-unit static image path as buildRailCard(): a creative with
    // imageUrl is already the full 970x90, drawn as a single <img>. The
    // assembled layout's 0 22px side padding (breathing room for the tag,
    // icon, text and CTA) would otherwise inset a full-bleed image by 22px
    // on each side, so this class drops it to 0 for the image case only.
    el.classList.toggle("has-image-ad", !!ad.imageUrl);
    if (ad.imageUrl) {
      el.style.background = ad.bgFrom || "#1b2437"; // not setAttribute("style"): that would wipe left/top/--ad-scale
      el.innerHTML =
        '<img class="ad-unit-img" src="' + ad.imageUrl + '" width="970" height="90" alt="' +
        (ad.advertiser || "Advertisement") + '" />' + adDotsHtml(ad);
      return;
    }

    // Solid background, same reasoning as the rail card and the MREC.
    el.style.background = ad.bgFrom || "#6a3fb5";
    el.innerHTML = leaderboardCardHtml(ad);
  }

  /* ---------- Leaderboard carousel ----------
     fetchAd() already round-robins through every ad registered under a
     placement (sponsorRotation, above) — each CALL advances it, nothing here
     has to track positions or wrap an index. So the carousel is just that
     same call made again every 5s instead of once: the placement currently
     has a single ad (pm-leader-creditkey), so calling fetchAd("leaderboard")
     repeatedly just re-fetches Credit Key each tick — adding a second ad to
     sponsor-media.json extends the rotation with no further changes needed
     here.
     Self-stopping rather than requiring a stop() call at every place the
     leaderboard could stop being the thing on screen (rotating to landscape,
     leaving the game screen, the window shrinking below LEADER_MIN_SCALE):
     every tick checks is-shown first and clears itself the moment that is no
     longer true, so a missed call site is never a live timer quietly ticking
     against a card nobody can see. hideSideRails() still stops it directly
     too, for promptness — no reason to wait up to 5s to notice.
     leaderboardCarouselTimer itself is declared at the TOP of the file, not
     here next to the functions that use it — see that declaration for why. */

  function stopLeaderboardCarousel() {
    if (leaderboardCarouselTimer) {
      clearInterval(leaderboardCarouselTimer);
      leaderboardCarouselTimer = null;
    }
  }

  function slideLeaderboardCard(el, ad) {
    if (!el || !ad) return Promise.resolve();
    if (!ad.imageUrl) return swapAdCard(el, () => buildLeaderboardCard(el, ad));

    const oldImg = el.querySelector('.ad-unit-img');
    if (!oldImg) {
      buildLeaderboardCard(el, ad);
      return Promise.resolve();
    }

    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      buildLeaderboardCard(el, ad);
      return Promise.resolve();
    }

    el.classList.add('ad-sliding');
    const track = document.createElement('div');
    track.className = 'ad-slide-track';

    const current = oldImg.cloneNode(true);
    const next = document.createElement('img');
    next.className = 'ad-unit-img';
    next.width = 970;
    next.height = 90;
    next.alt = ad.advertiser || 'Advertisement';
    next.src = ad.imageUrl;

    track.appendChild(current);
    track.appendChild(next);
    el.innerHTML = '';
    el.appendChild(track);
    el.style.background = ad.bgFrom || '#1b2437';
    el.classList.toggle('clickable', !!ad.clickUrl);
    el.onclick = ad.clickUrl ? () => window.open(ad.clickUrl, '_blank', 'noopener') : null;

    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        track.classList.add('slide-next');
      }));
      setTimeout(() => {
        el.innerHTML = '<img class="ad-unit-img" src="' + ad.imageUrl + '" width="970" height="90" alt="' +
          (ad.advertiser || 'Advertisement') + '" />' + adDotsHtml(ad);
        el.classList.remove('ad-sliding');
        resolve();
      }, 430);
    });
  }

  function startLeaderboardCarousel() {
    if (leaderboardCarouselTimer) return; // already running
    leaderboardCarouselTimer = setInterval(() => {
      const el = document.getElementById("adLeaderboard");
      if (!el || !el.classList.contains("is-shown")) {
        stopLeaderboardCarousel();
        return;
      }
      fetchAd({ placement: "leaderboard", adType: "image" }).then((ad) => {
        if (!ad || !el.classList.contains("is-shown")) return;
        const swapped = slideLeaderboardCard(el, ad);
        swapped.then(() => placeLeaderboardTop());
      });
    }, 5000);
  }

  /* ---------- VERTICAL_BANNER 300x600 carousel ----------
     The same 5s beat and the same self-stopping shape as the leaderboard
     above, with one difference that matters: there can be TWO of these cards
     on screen at once (a plain desktop landscape window keeps a rail on each
     side), and a rotation that put the same creative in both would read as a
     mistake rather than as two ad slots.
     fetchAd() round-robins per CALL, so asking once per visible rail — in
     sequence, awaiting each before the next — hands back consecutive, and
     therefore different, creatives from the placement's three. Promise.all
     would fire both calls in the same tick and is fine for that too, but
     sequencing keeps the left card's ad always one step ahead of the right
     card's, which is the order they were first painted in.
     Only rails carrying .is-shown are refreshed: in single-card mode the left
     rail is hidden but still holds its old innerHTML, and rebuilding it would
     quietly burn a slot in the rotation on a card nobody can see. */
  function stopRailCarousel() {
    if (railCarouselTimer) {
      clearInterval(railCarouselTimer);
      railCarouselTimer = null;
    }
  }


  function slideRailCard(el, ad) {
    if (!el || !ad) return Promise.resolve();
    if (!ad.imageUrl) {
      return swapAdCard(el, () => buildRailCard(el, ad));
    }

    const oldImg = el.querySelector('.ad-unit-img');
    if (!oldImg) {
      buildRailCard(el, ad);
      return Promise.resolve();
    }

    el.classList.add('ad-sliding');
    const track = document.createElement('div');
    track.className = 'ad-slide-track';

    const current = oldImg.cloneNode(true);
    const next = document.createElement('img');
    next.className = 'ad-unit-img';
    next.width = 300;
    next.height = 600;
    next.alt = ad.advertiser || 'Advertisement';
    next.src = ad.imageUrl;

    track.appendChild(current);
    track.appendChild(next);

    const dots = '';
    el.innerHTML = '';
    el.appendChild(track);
    if (dots) el.insertAdjacentHTML('beforeend', dots);
    el.style.background = ad.bgBottom || ad.bgFrom || '#1b2437';
    el.classList.toggle('clickable', !!ad.clickUrl);
    el.onclick = ad.clickUrl ? () => window.open(ad.clickUrl, '_blank', 'noopener') : null;

    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        track.classList.add('slide-next');
      }));
      setTimeout(() => {
        /* Keep only the newly arrived creative after the slide has finished. */
        el.innerHTML = '<img class="ad-unit-img" src="' + ad.imageUrl + '" width="300" height="600" alt="' +
          (ad.advertiser || 'Advertisement') + '" />' + dots;
        el.classList.remove('ad-sliding');
        resolve();
      }, 430);
    });
  }

  function startRailCarousel() {
    if (railCarouselTimer) return; // already running
    railCarouselTimer = setInterval(() => {
      const shown = railEls().filter((el) => el && el.classList.contains("is-shown"));
      if (!shown.length) {
        stopRailCarousel();
        return;
      }

      /* One fetch per visible card, chained so the round-robin advances once
         per card rather than both cards landing on whatever a single call
         returned. */
      /* Fetch one creative per visible card first, THEN fade and swap all of
         them in the same instant, so the two side cards change together
         (side by side) instead of one after the other. */
      let chain = Promise.resolve();
      const picks = [];
      shown.forEach((el) => {
        chain = chain.then(() =>
          fetchAd({ placement: "banner", adType: "image" }).then((ad) => {
            picks.push([el, ad]);
          })
        );
      });
      chain = chain.then(() =>
        Promise.all(
          picks.map(([el, ad]) => {
            // Re-check after the fetch: the layout may have dropped this card
            // while the request was in flight.
            if (!ad || !el.classList.contains("is-shown")) return null;
            return slideRailCard(el, ad);
          })
        )
      );

      /* One layout pass at the END, not one per card. Re-running the full fit
         rather than trusting the boxes to still be where the last pass left
         them — same reasoning as the leaderboard's placeLeaderboardTop() call:
         the card is a fixed 300x600 with overflow:hidden and buildRailCard()
         never touches --ad-scale or position, so content alone would do, but
         re-deriving size and position from the CURRENT viewport on every
         rotation is what stops a size that was right once from going stale if
         anything shifts in the seconds between ticks. */
      chain.then(() => fitSideRails()).catch(() => {});
    }, 5000);
  }

  /* ---------- MREC 300x250 carousel (inside the Congratulations popup) ----------
     Rotates on the same 5s beat as the other two. The popup's own creative
     (pm-banner-creditkey) is what it cycles through — a single ad, so each
     tick just re-fetches the same one.
     Self-stopping on TWO conditions rather than one, because this card has two
     independent ways of leaving the screen: the whole overlay being dismissed
     (Next Level, Level Select, the X), and the card itself being hidden while
     the overlay stays up — which is exactly what handleGameOver() does when it
     reuses the same dialog for the Game Over state, where this placement is not
     shown at all. Checking only the overlay would leave the timer rebuilding a
     hidden card for the whole of a Game Over screen. */
  function stopModalBannerCarousel() {
    if (modalBannerCarouselTimer) {
      clearInterval(modalBannerCarouselTimer);
      modalBannerCarouselTimer = null;
    }
  }

  function startModalBannerCarousel() {
    if (modalBannerCarouselTimer) return; // already running
    modalBannerCarouselTimer = setInterval(() => {
      const overlayEl = document.getElementById("overlay");
      if (
        !modalBannerAd ||
        modalBannerAd.classList.contains("hidden") ||
        !overlayEl ||
        overlayEl.classList.contains("hidden")
      ) {
        stopModalBannerCarousel();
        return;
      }
      fetchAd({ placement: "level_complete_banner", adType: "image" }).then((ad) => {
        if (!ad || !adIsImage(ad)) return;
        // Re-check on the far side of the fetch — the player may have pressed
        // Next Level while it was in flight.
        if (modalBannerAd.classList.contains("hidden")) return;
        if (overlayEl.classList.contains("hidden")) {
          stopModalBannerCarousel();
          return;
        }
        swapAdCard(modalBannerAd, () => buildBannerCard(modalBannerAd, ad));
      });
    }, 5000);
  }

  /* Draws both cards straight away from the built-in creatives, then swaps in
     whatever the catalogue returns once it arrives.
     It used to do the opposite — wait for fetchAd() and only then build — so
     anything that went wrong on the way (a file:// page that cannot fetch, a
     rejected promise, an empty result) left both cards with no innerHTML, and
     fitSideRails() treats an empty card as "nothing to show" and hides it.
     Painting first means the cards are on screen before any of that can
     matter, and the fetch can only ever improve them. */
  function loadSideRails() {
    const [adRailLeft, adRailRight] = railEls();
    const adLeaderboardEl = document.getElementById("adLeaderboard");
    if (!adRailLeft || !adRailRight) return;

    const withSlots = (list) =>
      list.map((ad, i) => Object.assign({}, ad, { _slot: i, _slots: list.length }));
    const builtIn = withSlots(
      SPONSOR_FALLBACK_CATALOGUE.ads.filter((ad) => ad.placements && ad.placements.includes("banner"))
    );
    const builtInLeader = withSlots(
      SPONSOR_FALLBACK_CATALOGUE.ads.filter((ad) => ad.placements && ad.placements.includes("leaderboard"))
    );
    if (builtIn.length) {
      buildRailCard(adRailLeft, builtIn[0]);
      buildRailCard(adRailRight, builtIn[1] || builtIn[0]);
    }
    if (adLeaderboardEl) buildLeaderboardCard(adLeaderboardEl, builtInLeader[0] || builtIn[0]);
    if (builtIn.length || (adLeaderboardEl && builtInLeader.length)) fitSideRails();

    /* shownId tracks which creative is already on screen so the fetch below
       — which reads sponsor-media.json, kept editable on purpose (see the
       comment at the top of that file) — only rebuilds a card and re-runs the
       whole layout pass when the file actually swapped in something
       different. Against the file as shipped, mirrored to be identical to
       SPONSOR_FALLBACK_CATALOGUE, that fetch used to resolve to the exact
       same ad every time and STILL rebuilt the DOM and re-ran fitSideRails()
       a second time regardless — a second full layout pass a moment after
       the first, measuring a DOM that had just been rebuilt out from under
       it. Nothing here needed that; it only matters once someone actually
       edits the JSON. */
    const shownId = {
      left: (builtIn[0] || {}).id,
      right: (builtIn[1] || builtIn[0] || {}).id,
      board: (builtInLeader[0] || builtIn[0] || {}).id,
    };

    const pick = () =>
      fetchAd({ placement: "banner", adType: "image" }).then((ad) =>
        ad || fetchAd({ placement: "level_complete_banner", adType: "image" })
      );
    const pickLeader = () =>
      fetchAd({ placement: "leaderboard", adType: "image" }).then((ad) => ad || pick());

    Promise.all([pick(), pick(), adLeaderboardEl ? pickLeader() : Promise.resolve(null)])
      .then(([a, bAd, lAd]) => {
        let changed = false;
        if (a && a.id !== shownId.left) {
          buildRailCard(adRailLeft, a);
          shownId.left = a.id;
          changed = true;
        }
        const right = bAd || a;
        if (right && right.id !== shownId.right) {
          buildRailCard(adRailRight, right);
          shownId.right = right.id;
          changed = true;
        }
        if (adLeaderboardEl && lAd && lAd.id !== shownId.board) {
          buildLeaderboardCard(adLeaderboardEl, lAd);
          shownId.board = lAd.id;
          changed = true;
        }
        if (changed) fitSideRails();
      })
      .catch(() => {});   // the built-in cards are already up; nothing to undo
  }

  function hideSideRails() {
    railEls().forEach((el) => el && el.classList.remove("is-shown"));
    const adLeaderboardEl = document.getElementById("adLeaderboard");
    if (adLeaderboardEl) adLeaderboardEl.classList.remove("is-shown");
    stopLeaderboardCarousel();
    stopRailCarousel();
    const gs = document.getElementById("gameScreen");
    if (gs) {
      gs.style.removeProperty("--game-max");
      gs.style.removeProperty("--maze-max");
      gs.style.removeProperty("--bar-w");
      gs.style.removeProperty("--ad-band");
      gs.style.removeProperty("--game-edge-margin");
      gs.style.removeProperty("--maze-w");
      gs.style.removeProperty("--maze-x");
    }
    /* The single-card offset has to go with the card. Left behind, it keeps a
       strip of the window reserved for a gutter that no longer has anything in
       it — the maze would sit off centre with a blank margin beside it. */
    const wrapperEl = document.querySelector(".wrapper");
    if (wrapperEl) wrapperEl.style.removeProperty("--ad-gutter-right");
    syncBarToMaze();
  }

  /* ---------- Leaderboard above the board ----------
     On a tablet held upright there is no gutter: two 300-wide cards plus the
     board need about 1130px of width and the tablet has 820, so the side rails
     stand down — and then the game carried no advertising at all on exactly the
     device with the most screen going spare. What that screen has is HEIGHT.
     So when the rails cannot go beside the board, a single IAB LEADER_BOARD
     970x90 goes ABOVE it instead, and a band is reserved for it out of the
     board's height (the board gives up a slim strip of height and keeps all of
     its width).
     This used to be two 300x600 VERTICAL_BANNER cards scaled down together —
     but that unit is 1:2 (tall), and the band it has to fit is wide and short,
     which is the opposite shape. Fitting it there meant scaling the pair down
     until they were barely readable, or hiding them outright once the band got
     short enough to be unreadable. A 970x90 LEADER_BOARD is built for
     exactly this band's shape (roughly 10.8:1), so the same height buys a much
     wider, more legible unit — and it keeps fitting in bands that would have
     dropped the pair below their minimum scale.
     The card is still scaled as one whole piece, so the 970:90 shape never
     changes, same rule as every other unit here: proportional scale-down,
     never cropped, never stretched.
     The band's size is worked out from the VIEWPORT only, never from the board,
     so reserving it can never feed back into the measurement that produced it. */
  /* ---------- The single ad this game ever shows in portrait, and the
     landscape fallback when even one side rail is too cramped to be worth
     showing ---------------------------------------------------------------
     Always the LEADER_BOARD 970x90, always at the TOP of the screen. A
     portrait screen has no side gutter — the board wants the full width —
     but does leave real height under it once the board has taken what it
     needs, and a wide-short band is exactly this unit's own shape.
     Same fixed-box + scale(--ad-scale) pattern as the side rails: the 970:90
     shape never changes, only ever scaled down as a whole. */
  function placeLeaderboardTop() {
    const adLeaderboardEl = document.getElementById("adLeaderboard");
    const gs = document.getElementById("gameScreen");
    if (!adLeaderboardEl || !gs || !adLeaderboardEl.innerHTML) return false;

    const vp = layoutViewport();

    /* ---------- How big the band gets to be ----------
       Not a fixed fraction of the screen, and not "fill the width" either —
       both of those were wrong in their own way. A fixed fraction left a wide
       unused margin either side of a small card on a tall tablet. Filling the
       width went too far the other way: the band would grow past what the
       board could spare, the board would run out of height before it ran out
       of width, and it would shrink IN from the sides — trading the empty
       strip beside the ad for an empty strip beside the maze, which is a worse
       place for it to be.
       What actually decides the ceiling is geometry: the board can be drawn at
       any shape between minBoardAspect() (tallest) and maxBoardAspect()
       (flattest) and fill its box completely either way. So the biggest band
       the ad may have is however much height turns the board's box from its
       CURRENT shape into exactly maxBoardAspect() — the flattest the board can
       still be with nothing left over on any edge. Past that point every extra
       pixel handed to the band comes back out of the board's WIDTH instead of
       its height, which is the empty-strip-beside-the-maze failure mode this
       is written to avoid.

       fullH — the height available with NOTHING reserved for the band yet — is
       computed by boardBoxNoBand() rather than by zeroing the band, forcing a
       reflow and reading it back. That mutate-measure-restore was correct but
       it changed the live layout twice per call from inside a ResizeObserver,
       and the browser may paint the intermediate state — which is exactly what
       a flashing screen looks like.
       boardW is worked out the same way: this mode always drops --game-max, so
       the column is simply the wrapper's content width capped at the usual
       maximum. Reading the element instead would give whatever the LAST fit
       left behind, which on a side-mode pass is a much narrower number. */
    const noBand = boardBoxNoBand();
    const fullH = noBand.h;

    const gsCs = getComputedStyle(gs);
    const gsPadX = (parseFloat(gsCs.paddingLeft) || 0) + (parseFloat(gsCs.paddingRight) || 0);
    const wrapEl = document.querySelector(".wrapper");
    const wrapCs = wrapEl ? getComputedStyle(wrapEl) : null;
    const wrapPadX = wrapCs
      ? (parseFloat(wrapCs.paddingLeft) || 0) + (parseFloat(wrapCs.paddingRight) || 0)
      : 0;
    const wrapInner = Math.min(1400, vp.w) - wrapPadX;
    const boardW = Math.min(1360, wrapInner) - gsPadX;

    const minBoardH = boardW / maxBoardAspect();
    const bandCeiling = Math.max(0, fullH - minBoardH - 4);

    /* Two limits: the band's height, and the viewport's width minus a margin
       on each edge. The smaller one wins, same "never cropped, never
       stretched, only scaled as a whole" rule as the side cards. */
    let scale = Math.min(1, bandCeiling / AD_LEADER_H, (vp.w - 2 * RAIL_EDGE) / AD_LEADER_W);
    scale = Math.floor(Math.max(0, scale) * 1000) / 1000;
    if (scale < LEADER_MIN_SCALE) {
      gs.style.setProperty("--ad-band", "0px");
      return false;
    }

    const cardW = Math.round(AD_LEADER_W * scale);
    const cardH = Math.round(AD_LEADER_H * scale);

    gs.style.removeProperty("--game-max");
    gs.style.removeProperty("--maze-max");
    // The leaderboard sits ABOVE the board, not to one side of it — nothing
    // here should be pushing #gameScreen off-centre. Only the single-side
    // rail case (in fitSideRailsInner) ever sets this.
    gs.style.removeProperty("--game-edge-margin");
    /* Same reason: the wrapper's right padding still reserves a side gutter
       unless this is cleared, and in this mode there is nothing in it. */
    const wrapTop = document.querySelector(".wrapper");
    if (wrapTop) wrapTop.style.removeProperty("--ad-gutter-right");
    /* Equal gap above the card and below it (between the card and the
       maze) — LEADERBOARD_MARGIN on both sides of cardH, rather than the
       card sitting RAIL_EDGE (4px) from the screen's own top edge with a
       bigger, unequal gap on the maze side. Was cardH+14 with the card
       pinned at RAIL_EDGE: the two gaps that left (4px above, 10px below)
       read as the card being stuck to the top of the screen with all the
       breathing room on the wrong side of it. */
    gs.style.setProperty("--ad-band", (cardH + 2 * LEADERBOARD_MARGIN) + "px");

    const left = Math.round((vp.w - cardW) / 2);
    const top = LEADERBOARD_MARGIN;
    adLeaderboardEl.style.left = left + "px";
    adLeaderboardEl.style.top = top + "px";
    adLeaderboardEl.style.setProperty("--ad-scale", String(scale));
    adLeaderboardEl.classList.add("is-shown");

    // The 300x600 pair is not used in this mode — make sure neither is left
    // showing from an earlier, wider layout.
    railEls().forEach((el) => el && el.classList.remove("is-shown"));
    /* The rails just went away, so their rotation goes with them — otherwise
       a rotation to portrait leaves a timer rebuilding two invisible cards
       (and re-running fitSideRails) every 5s for the rest of the session. */
    stopRailCarousel();
    startLeaderboardCarousel();

    syncBarToMaze();
    return true;
  }
  /* ---------- Match the top bar to the maze ----------
     The bar used to span the game COLUMN, which is wider than the board
     whenever the board is bounded by height — so it hung out past the maze on
     both sides. It is now set to the board's measured width and centred, and
     the tier below is chosen from that same number, so the bar is sized by the
     room it will actually occupy.
     One catch: a narrower bar can wrap to another row, which shortens the
     board, which changes the bar's width again. Rather than let that chase its
     own tail, the two are settled in a bounded loop that stops as soon as the
     bar's height stops moving — in practice on the first or second pass. */
  /* Settle the board against the bar. The bar's height is fixed by CSS
     (--joy + padding), so the board's box is known before it is drawn and two
     passes are enough: the first sizes the canvas to its box, the second sizes
     the WebGL buffer to the canvas the first one produced. */
  function syncBarToMaze() {
    const gs = document.getElementById("gameScreen");
    if (!gs || !gs.classList.contains("active")) return;
    centreMovePad();
    resizeCanvas();
  }

  /* ---------- Keep the ← → pair on the centre of the bar ----------
     In landscape the bar is [ stats | ← → | buttons ] with two equal outer
     columns, so the pair sits on the exact centre as long as the stats fit
     in their half. Doodle Jump's stats column (level, Score, Target, Lives,
     Best, coins) can be wider than that, which pushed the pair off centre by
     up to ~110px. This measures the bar and, only as far as needed, switches
     to icons instead of words, then drops Best, then shortens "Level 7" to
     "L7", then narrows the two move buttons equally (never below a square),
     and as a last resort hides the in-bar coin count. Re-run whenever the bar or the stats change size (resize, rotation, a
     longer score or coin count). */
  function centreMovePad() {
    const gs = screens.game;
    const header = gs ? gs.querySelector(".header") : null;
    const pad = header ? header.querySelector(".move-pad") : null;
    if (!pad) return;
    gs.classList.remove("bar-icons", "bar-no-best", "bar-short-title", "bar-no-coins");
    gs.style.removeProperty("--move-w");
    if (!gs.classList.contains("active")) return;

    const portrait = window.matchMedia("(orientation: portrait)").matches;
    const left = header.querySelector(".bar-left");
    const right = header.querySelector(".game-controls");
    // How many px the bar is short of: in landscape, two equal halves around
    // the centred pair; in portrait, the top row (the pair has its own row).
    const shortBy = () => {
      const cs = getComputedStyle(header);
      const inner = header.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
      const gap = parseFloat(cs.columnGap) || 0;
      const l = left.getBoundingClientRect().width;
      const r = right.getBoundingClientRect().width;
      if (portrait) {
        // The top row's grid tracks (they can be a few px wider than the
        // stats and buttons themselves) plus the gap between them.
        const tracks = cs.gridTemplateColumns.split(" ").reduce((sum, t) => sum + (parseFloat(t) || 0), 0);
        return Math.max(l + r, tracks) + gap - inner;
      }
      return 2 * Math.max(l, r) + pad.getBoundingClientRect().width + 2 * gap - inner;
    };
    const visible = (sel) => [...header.querySelectorAll(sel)].some((el) => el.offsetWidth > 0);

    if (shortBy() > 0.5 && visible(".scoreboard .stat-word")) gs.classList.add("bar-icons");
    if (shortBy() > 0.5 && visible(".best-label")) gs.classList.add("bar-no-best");
    if (shortBy() > 0.5 && (visible(".brand-tag-sm") || visible(".lvl-word"))) gs.classList.add("bar-short-title");
    let over = shortBy();
    if (over > 0.5 && !portrait) {
      const btn = pad.querySelector(".move-btn");
      const joy = parseFloat(getComputedStyle(gs).getPropertyValue("--joy")) || btn.offsetHeight;
      const w = Math.max(joy, btn.getBoundingClientRect().width - Math.ceil(over / 2));
      gs.style.setProperty("--move-w", w + "px");
      over = shortBy();
    }
    if (over > 0.5 && visible(".game-coin-pill")) gs.classList.add("bar-no-coins");
  }
  if (window.ResizeObserver) {
    const barObserver = new ResizeObserver(() => centreMovePad());
    const hdr = screens.game ? screens.game.querySelector(".header") : null;
    if (hdr) {
      barObserver.observe(hdr);
      barObserver.observe(hdr.querySelector(".bar-left"));
    }
  }

  function fitSideRailsInner() {
    const [adRailLeft, adRailRight] = railEls();
    if (!adRailLeft || !adRailRight) return;
    const gs = document.getElementById("gameScreen");
    if (!gs || !gs.classList.contains("active") || !adRailLeft.innerHTML) {
      hideSideRails();
      return;
    }

    /* ---------- PORTRAIT: the ad goes ABOVE and BELOW the board, never beside
       it -------------------------------------------------------------------
       Checked FIRST. A former railLimits() helper's vw<480
       floor was written for a LANDSCAPE gutter (below it there is no
       realistic side column to speak of) and used to double as "this window
       is too narrow for advertising, fall back to under-the-board". On a
       portrait phone vp.w is now the device's own short side, routinely under
       480, so that guard fired before this function ever got a look at it —
       every portrait phone fell straight through to the single leaderboard
       fallback regardless of how much height it actually had. Portrait uses a
       completely different piece of geometry (height above and below the
       board, not width beside it), so it has to be decided before that guard,
       not filtered by it.
       A portrait screen has no gutter worth the name. The board is 28x31, so
       from above it is very nearly square and it wants the whole width;
       anything standing next to it is taken straight off the maze. What a
       portrait screen has spare is HEIGHT — real height the board's own
       shape doesn't need, since it rarely reaches as tall as the box it is
       given. placeLeaderboardTop() puts a single LEADER_BOARD 970x90 in that
       space, at the TOP of the screen, at its own true aspect ratio: never
       rotated, never stretched, only ever scaled down as a whole.
       This is the case the recording was showing: the old build turned the
       page a quarter turn and dropped a 300x600 into what it then thought was
       a side gutter, which on the real screen was a band across the TOP with
       the card lying on its side and its text running vertically.
       Everything the side-rail path sets is cleared first, or a value left
       over from a landscape pass keeps reserving a gutter that portrait does
       not have — the maze would sit off centre with a blank strip beside it. */
    const vpEarly = layoutViewport();
    if (vpEarly.h > vpEarly.w) {
      gs.style.removeProperty("--game-max");
      gs.style.removeProperty("--maze-max");
      gs.style.removeProperty("--game-edge-margin");
      gs.style.removeProperty("--phone-bar-w");
      gs.style.removeProperty("--maze-w");
      gs.style.removeProperty("--maze-x");
      const wrapPortrait = document.querySelector(".wrapper");
      if (wrapPortrait) wrapPortrait.style.removeProperty("--ad-gutter-right");
      if (!placeLeaderboardTop()) hideSideRails();
      return;
    }

    return layoutLandscapeGame(gs, adRailLeft, adRailRight);
  }

  /* =======================================================================
     LANDSCAPE GAME LAYOUT  (phone, tablet, laptop, desktop — one rule set)
     -----------------------------------------------------------------------
     Everything is derived from ONE number: the height the maze may have.

       Hm  = screen height - frame - bar - hint            (bar height is fixed
                                                            by CSS, so this is
                                                            known up front)
       Wc  = min(300, Hm / 2)     an ad card is 1:2, so its width follows the
                                  maze's height and it can never be taller than
                                  the maze it sits beside
       Wm  = what is left of the width after the card(s)

     The old code sized the card from the WHOLE screen height and only shrank
     it to the maze afterwards. The gutter had already been reserved for the
     bigger card, so the difference was left as blank space beside the ad — the
     "negative space next to the ad" seen on iPhones. Sizing the card from the
     maze's own height removes it: card and gutter are the same number.

     One card or two: two cards are used when one card would leave the maze
     stretched much wider than its true shape (phones, wide laptops, desktop).
     Tablets, whose maze is close to square with one card, keep one.

     The maze column, the ads and the full-width bar are then placed as ONE
     group across the screen, so nothing is left hanging off one edge.
     ======================================================================= */
  const LAND_AD_GAP = 8;          // px between the maze and each ad card
  const LAND_MIN_SCALE = 0.22;    // smallest card worth showing beside the maze
  const LAND_TWO_IF_WIDER = 1.4;  // one card would make the maze wider than this
                                  //   (w/h) -> use two cards instead
  const LAND_TWO_MIN_ASPECT = 1.0; // ...but only if the maze still keeps this
  const LAND_MAX_ASPECT = 2.0;    // never draw the maze wider than this (w/h);
                                  //   any extra width becomes equal side margin

  function layoutLandscapeGame(gs, adRailLeft, adRailRight) {
    const wrapperEl = document.querySelector(".wrapper");
    const canvasEl = document.getElementById("gameCanvas");

    /* Clear every piece of geometry the old placement code used to leave behind,
       so a rotation from portrait (or an old cached pass) cannot leak in. */
    gs.style.removeProperty("--ad-band");
    gs.style.removeProperty("--game-max");
    gs.style.removeProperty("--maze-max");
    gs.style.removeProperty("--game-edge-margin");
    gs.style.removeProperty("--phone-bar-w");
    gs.style.removeProperty("--bar-w");
    gs.style.removeProperty("--tablet-ad-extend");
    if (wrapperEl) wrapperEl.style.removeProperty("--ad-gutter-right");

    /* The frame: gs is the full-width content box (CSS keeps it flush to the
       screen edge plus the notch/home-indicator safe area). */
    const cs = getComputedStyle(gs);
    const padL = parseFloat(cs.paddingLeft) || 0;
    const padR = parseFloat(cs.paddingRight) || 0;
    const innerL = layoutOffset(gs).left + padL;
    const innerW = Math.max(0, gs.clientWidth - padL - padR);

    const box = boardBoxNoBand();
    const Hm = Math.floor(box.h);
    if (!(innerW > 0) || !(Hm > 0)) return;

    const gap = LAND_AD_GAP;
    const minAspect = minBoardAspect();
    let cardW = Math.min(AD_RAIL_W, Math.floor(Hm / 2));

    /* One card or two? */
    let n = 1;
    const w1 = innerW - (cardW + gap);
    const w2 = innerW - 2 * (cardW + gap);
    if (w2 >= Hm * LAND_TWO_MIN_ASPECT && w1 > Hm * LAND_TWO_IF_WIDER) n = 2;

    /* A single card must still leave the maze its narrowest natural shape; if
       it does not (a very narrow landscape window), the card gives it back. */
    if (n === 1 && w1 < Hm * minAspect) {
      cardW = Math.floor(innerW - gap - Hm * minAspect);
    }

    let scale = Math.floor((cardW / AD_RAIL_W) * 1000) / 1000;
    if (scale < LAND_MIN_SCALE) {
      /* No room for a side card at all — the wide leaderboard above the board
         is the fallback, exactly as before. */
      gs.style.removeProperty("--maze-w");
      gs.style.removeProperty("--maze-x");
      if (!placeLeaderboardTop()) hideSideRails();
      return;
    }
    cardW = AD_RAIL_W * scale;
    const cardH = AD_RAIL_H * scale;

    /* The maze takes whatever the cards leave, up to LAND_MAX_ASPECT; anything
       beyond that is not stretched into the maze but split into equal margins
       either side of the whole [ad | maze | ad] group.
       On a phone this cap was what left visible empty strips OUTSIDE each ad
       card in landscape — a short/wide phone screen hit LAND_MAX_ASPECT
       before it ran out of real width, so the leftover got centred as blank
       margin beyond the rails instead of going to either the cards or the
       board. Phones skip the cap: every pixel the cards don't use goes
       straight to the maze, and the cards end up flush against the true
       screen edges (lead stays 0) instead of pulled in with a gap outside
       them. Tablets/laptops/desktop keep the cap — a very wide, short maze
       reads badly there and they don't have this edge-gap problem. */
    let mazeW = Math.floor(innerW - n * (cardW + gap));
    if (!isPhoneWidth()) {
      mazeW = Math.min(mazeW, Math.floor(Hm * LAND_MAX_ASPECT));
    }
    const groupW = mazeW + n * (cardW + gap);
    const lead = Math.max(0, Math.floor((innerW - groupW) / 2));

    const mazeX = innerL + lead + (n === 2 ? cardW + gap : 0);
    gs.style.setProperty("--maze-w", mazeW + "px");
    gs.style.setProperty("--maze-x", Math.round(mazeX - innerL) + "px");

    /* Let the board settle into its new column (canvas first, WebGL buffer
       second), then read where it really is and hang the cards off that. */
    gs.style.removeProperty("--ad-band");
    syncBarToMaze();

    let railTop = 2;
    let railH = Math.min(Hm, Math.floor(cardH));
    if (canvasEl) {
      railTop = Math.max(2, Math.round(layoutOffset(canvasEl).top));
      railH = Math.max(1, Math.round(layoutSize(canvasEl).h));
    }
    /* The creative keeps its 1:2 shape; if the maze is taller than a full
       300x600 unit the box is lengthened and filled with the creative's own
       background (.is-tall), as before. */
    const shownCardH = AD_RAIL_H * scale;
    const extraPx = railH > shownCardH + 1 ? (railH - shownCardH) / scale : 0;

    const leftX = Math.round(innerL + lead);
    const rightX = Math.round(mazeX + mazeW + gap);

    const placements = n === 2
      ? [[adRailLeft, leftX], [adRailRight, rightX]]
      : [[adRailRight, rightX]];

    if (n === 1) {
      adRailLeft.classList.remove("is-shown");
      adRailLeft.style.removeProperty("left");
    }
    placements.forEach(([el, left]) => {
      el.style.left = left + "px";
      el.style.top = railTop + "px";
      el.style.setProperty("--ad-scale", String(scale));
      el.style.setProperty("--ad-h", Math.max(1, Math.round(railH / Math.max(scale, 0.001))) + "px");
      if (extraPx > 0) el.classList.add("is-tall");
      else el.classList.remove("is-tall");
      el.classList.add("is-shown");
    });

    /* The card(s) are on screen, so the rotation may run. This is the one place
       a rail becomes visible, so a rail is never showing without its carousel;
       start is a no-op when the timer is already ticking. */
    startRailCarousel();

    /* Side placement is running, so the leaderboard (if up from a previous,
       narrower pass) is not needed any more. */
    const adLeaderboardEl = document.getElementById("adLeaderboard");
    if (adLeaderboardEl) adLeaderboardEl.classList.remove("is-shown");
    stopLeaderboardCarousel();
  }

  /* ---------- Keep the cards attached to the board ----------
     The cards are placed against the board's measured position, so anything
     that moves the board AFTER they are placed leaves them behind — which is
     what "they jump somewhere else on refresh" was. There are several such
     things and they all land at slightly different moments: the ad images
     decoding, the bar settling to its tier (which changes its height, and so
     the board's size), a restore from the back/forward cache, and the browser
     simply laying out a cold load in a different order to a warm one. That is
     why it depended on a refresh rather than happening every time.
     Rather than chase each trigger, the board itself is watched: whenever its
     box changes, the cards are placed again. The depth guard is what makes
     that safe — placing the cards can resize the board, so without it the
     observer and the fitter would keep waking each other.
     8, was 2. The ad band, the board's width, and the header's tier all feed
     each other (a bigger band leaves less height for the board, which changes
     its width, which can cross a bar-tier threshold, which changes the
     header's height, which changes how much room is left for the band) — and
     2 passes was sometimes cut off before that settled, leaving the board
     stuck at whatever size the FIRST, not-yet-converged pass happened to land
     on. That is what produced a board a fraction of its proper size with a
     few hundred pixels of unclaimed space beneath it. Each pass is cheap (a
     handful of layout reads), so allowing more of them costs nothing when
     the loop settles quickly, which it almost always does — this is a ceiling
     for the rare case, not a budget that gets spent every time. */
  let railFitDepth = 0;
  function fitSideRails() {
    if (railFitDepth > 8) return;
    railFitDepth++;
    try {
      fitSideRailsInner();
    } finally {
      railFitDepth--;
    }
  }

  if (typeof ResizeObserver === "function") {
    const boardWatcher = new ResizeObserver(() => fitSideRails());
    const boardEl = document.getElementById("gameCanvas");
    if (boardEl) boardWatcher.observe(boardEl);
  }

  /* ---------- One re-fit per frame, not one per event ----------
     A mobile browser fires `resize` continuously while the address bar slides
     in and out, and every one of those used to force a full re-fit: bar tier,
     board resize, renderer resize, cards replaced. That is a whole layout pass
     several times a frame, and on a tablet it is visible as the board flashing.
     The events are coalesced into a single animation frame, and a re-fit is
     skipped altogether when the viewport has not really changed — a 1-2px
     wobble from a toolbar is not a resize. */
  let railFitFrame = 0;
  let lastFitW = 0;
  let lastFitH = 0;
  function scheduleRailFit(force) {
    const vp = layoutViewport();
    if (!force && Math.abs(vp.w - lastFitW) < 3 && Math.abs(vp.h - lastFitH) < 3) return;
    lastFitW = vp.w;
    lastFitH = vp.h;
    if (railFitFrame) return;
    railFitFrame = requestAnimationFrame(() => {
      railFitFrame = 0;
      fitSideRails();
    });
  }

  window.addEventListener("resize", () => scheduleRailFit(false));
  /* ---------- The rotation race a screenshot on a real phone caught -------
     orientationchange fired, scheduleRailFit(true) ran, and it still laid out
     the OLD (pre-rotation) size: the board, the bar and the ad card all came
     out sized for the narrow portrait width, sitting centred in the newly-
     landscape viewport with blank margin on all four sides — small, correct
     relative to EACH OTHER, wrong relative to the screen. Not a bug this repo
     can reproduce on demand: it depends on how fast one particular phone's
     browser updates document.documentElement.clientWidth/clientHeight after a
     physical rotation, and the two events this used to rely on are exactly
     the ones with no guaranteed order on that — orientationchange is free to
     fire (and this file's handler free to read layoutViewport()) BEFORE the
     browser has actually finished relaying out the page for the new
     orientation, and the very next resize event can still land mid-animation
     with an intermediate size neither portrait nor landscape. A desktop
     window resize, and the simulated rotations this file's own testing tools
     produce, do not have that gap — the new size is simply correct the
     instant the event fires — which is exactly why this shipped invisible to
     every check that was not a real handset.
     Three independent listeners now feed the same scheduleRailFit/fitSideRails
     pair, so a browser that gets any ONE of them right still lands on the
     correct size:
       - orientationchange, as before, for browsers that fire it promptly and
         correctly;
       - a plain follow-up fitSideRails() a few hundred ms after it, which
         does not consult the "did the size really change" wobble check at
         all — it re-measures and re-lays-out unconditionally, so it corrects
         the board even if the FIRST read (immediately on the event) was the
         stale one. 350ms clears a toggle animation on every device this was
         tested against without being long enough to see as a delay;
       - visualViewport's own resize event, which several real mobile
         browsers fire with the CORRECT post-rotation size measurably sooner
         than window's resize does, because it tracks the actual visible
         page rather than waiting on the layout viewport to finish settling. */
  window.addEventListener("orientationchange", () => {
    scheduleRailFit(true);
    setTimeout(() => fitSideRails(), 350);
  });
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", () => scheduleRailFit(false));
  }
  window.addEventListener("load", fitSideRails);
  // A back/forward-cache restore does not re-run the script, so it needs its own
  window.addEventListener("pageshow", () => fitSideRails());
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => fitSideRails());

  // ===================== INIT =====================
  highScoreEl.textContent = highScore;
  setSoundEnabled(soundEnabled, true);
  updateCoinsUI();
  buildLevelGrid();
  showScreen("menu");
  if (sessionExpiredAtLoad) showSessionToast();
  // Warm the ad catalogue so the first popup / ad has it ready.
  loadSponsorCatalogue();

})();
