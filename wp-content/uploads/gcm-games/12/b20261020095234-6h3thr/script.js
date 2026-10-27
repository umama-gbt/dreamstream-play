/* The whole game runs inside this private scope. Nothing below is a global,
   so the score, coins, levels and the functions that change them (tetris,
   addCoins, setUnlockedLevel, ...) cannot be reached or called from the
   browser console. The few window.* hooks that remain only report or redo
   layout; none of them can read or change game data. */
(function () {
/* ===================== Saved data ===================== */
/* rawStore: the browser's localStorage, or an in-memory stand-in where the
   browser refuses storage (blocked cookies, some embedded frames) — touching
   localStorage there throws, and that used to stop the whole script before
   the menu was wired up. Progress then just lasts for the visit instead. */
var rawStore = (function () {
  try {
    var ls = window.localStorage;
    var probe = "__tetris_probe__";
    ls.setItem(probe, probe);
    ls.removeItem(probe);
    return ls;
  } catch (e) {
    var mem = {};
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
      setItem: function (k, v) { mem[k] = String(v); },
      removeItem: function (k) { delete mem[k]; }
    };
  }
})();

/* ---------- Tamper-resistant save ----------
   Every saved value (coins, levels, stars, achievements, skins, the 24-hour
   session, settings) lives in ONE signed record under SAVE_KEY instead of
   one plain localStorage entry each. Editing that record in DevTools (or
   writing the old plain keys back) breaks its signature, and a broken record
   is discarded: the game starts from a clean save instead of trusting it.
   One record, not one signature per value, on purpose: with separate
   signatures a player could copy their coin value, spend it, and paste the
   old one back next to the skins it bought. Restoring a whole old record only
   ever brings back an earlier REAL state — the coins and what they bought
   travel together — so nothing can be gained that way.
   Limits, stated plainly: the code that signs runs on the player's device.
   This stops casual editing; someone who reverse-engineers this file can
   still forge a save. Only a server that keeps the score can rule that out.
   The same getItem / setItem / removeItem interface as before, so nothing
   else in the game changed. Reads always go back to storage (not a cached
   copy), so two open tabs still see each other's progress as they did. */
var gameStore = (function (raw) {
  var SAVE_KEY = "tetrisSave";
  var FORMAT = "t2";
  // Pieces kept apart so the signing key is not one searchable string.
  var K = ["c4f1", "9e7b", "Tq", "x3", "a85d", "Lm0", "26fe"];
  var SECRET = K[3] + K[0] + K[5] + K[1] + K[6] + K[2] + K[4];

  // cyrb53 — fast 53-bit string hash; two seeds give ~106 bits of check.
  function h53(str, seed) {
    var h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (var i = 0, ch; i < str.length; i++) {
      ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  }
  function sign(body) {
    return h53(FORMAT + "|" + body + "|" + SECRET, 0x5bd1e995) + h53(SECRET + "|" + body, 0x27d4eb2f);
  }

  /* The keys the game used to keep as separate, unsigned entries. They are
     never read again; any copy left in storage (old version, or typed in by
     hand) is deleted so it cannot be mistaken for real progress. */
  var LEGACY_KEYS = ["tetrisUnlockedLevel", "tetrisCoins", "tetrisStars", "tetrisAchievements",
    "tetrisTotalLines", "tetrisSkins", "tetrisSessionStart", "tetrisResetHappened",
    "tetrisAdUnlocked", "tetrisSoundEnabled", "tetrisAdServer", "tetrisPrevSessionLevel"];
  function purgeLegacy() {
    for (var i = 0; i < LEGACY_KEYS.length; i++) {
      try { if (raw.getItem(LEGACY_KEYS[i]) !== null) raw.removeItem(LEGACY_KEYS[i]); } catch (e) {}
    }
  }

  var warned = false;
  function load() {
    var text = null;
    try { text = raw.getItem(SAVE_KEY); } catch (e) {}
    if (text === null) return {};
    var cut = text.indexOf(":");
    var mac = cut > 0 ? text.slice(0, cut) : "";
    var body = cut > 0 ? text.slice(cut + 1) : "";
    var data = null;
    if (mac && mac === sign(body)) {
      try { data = JSON.parse(body); } catch (e) { data = null; }
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      // Edited, truncated or forged: never trusted, replaced by a clean save.
      try { raw.removeItem(SAVE_KEY); } catch (e) {}
      if (!warned && window.console) {
        warned = true;
        console.warn("Tetris: saved data failed its integrity check and was reset.");
      }
      return {};
    }
    return data;
  }
  function save(data) {
    var body = JSON.stringify(data);
    try { raw.setItem(SAVE_KEY, sign(body) + ":" + body); } catch (e) {}
  }

  purgeLegacy();
  return {
    getItem: function (k) {
      var d = load();
      return Object.prototype.hasOwnProperty.call(d, k) ? d[k] : null;
    },
    setItem: function (k, v) {
      var d = load();
      d[k] = String(v);
      save(d);
    },
    removeItem: function (k) {
      var d = load();
      if (Object.prototype.hasOwnProperty.call(d, k)) {
        delete d[k];
        save(d);
      }
    }
  };
})(rawStore);

var TOTAL_LEVELS = 35;
var PROGRESS_KEY = "tetrisUnlockedLevel";
var COINS_KEY = "tetrisCoins";
var STARS_KEY = "tetrisStars";
var ACH_KEY = "tetrisAchievements";
var TOTAL_LINES_KEY = "tetrisTotalLines";
var SKINS_KEY = "tetrisSkins";
var SESSION_KEY = "tetrisSessionStart";
var SESSION_LENGTH_MS = 24 * 60 * 60 * 1000; // 24 hours
/* Set the first time a 24-hour reset actually happens, and deliberately NOT in
   SESSION_KEYS below, so the wipe leaves it alone. Same idea as Pac-Man: it is
   what tells Select Level that a reset has happened at least once. Only then
   does tapping a locked level offer the 5-ads unlock; before that a locked
   level is the ordinary padlock, reached only by clearing your way there. */
var RESET_HAPPENED_KEY = "tetrisResetHappened";
/* Levels unlocked out of order with ads (unlocking level 20 must not unlock
   19 or 21). Normal progression stays in PROGRESS_KEY as a contiguous run. */
var AD_UNLOCKED_KEY = "tetrisAdUnlocked";
var RECOVER_ADS_REQUIRED = 5;

function speedForLevel(level) {
  // 700ms at level 1, easing down exponentially to a 90ms floor by level 35 —
  // noticeably faster with every level gained.
  return Math.max(90, Math.round(700 * Math.pow(0.93, level - 1)));
}

function linesRequiredForLevel(level) {
  // Required lines climb from 5 (level 1) up to a cap of 40, echoing the design's
  // level table (5 → 10 → 15 → 20 → 30 → 40).
  return Math.min(40, 5 + (level - 1));
}

function getUnlockedLevel() {
  var v = parseInt(gameStore.getItem(PROGRESS_KEY), 10);
  if (!v || v < 1) return 1;
  return Math.min(v, TOTAL_LEVELS);
}

function getAdUnlockedLevels() {
  try {
    var arr = JSON.parse(gameStore.getItem(AD_UNLOCKED_KEY));
    if (Array.isArray(arr)) {
      return arr.filter(function (n) { return n >= 1 && n <= TOTAL_LEVELS; });
    }
  } catch (e) {}
  return [];
}

/* Winning level L unlocks L+1 for free. While the run of unlocked levels is
   contiguous that just advances PROGRESS_KEY; if the player got here by an
   out-of-order ads unlock (progress 3, ads-unlocked 20, now beating 20) the new
   level goes into the ads set instead, so nothing between them opens by
   accident. */
function setUnlockedLevel(n) {
  n = Math.min(n, TOTAL_LEVELS);
  var current = getUnlockedLevel();
  if (n <= current) return;
  if (n === current + 1) {
    gameStore.setItem(PROGRESS_KEY, String(n));
    return;
  }
  var set = getAdUnlockedLevels();
  if (set.indexOf(n) === -1) {
    set.push(n);
    gameStore.setItem(AD_UNLOCKED_KEY, JSON.stringify(set));
  }
}

/* Unlock exactly one level with ads. Nothing before or after it changes. */
function unlockLevelOnly(n) {
  if (n <= getUnlockedLevel()) return;
  var set = getAdUnlockedLevels();
  if (set.indexOf(n) === -1) {
    set.push(n);
    gameStore.setItem(AD_UNLOCKED_KEY, JSON.stringify(set));
  }
}

function isLevelUnlocked(level) {
  return level === 1 || level <= getUnlockedLevel() || getAdUnlockedLevels().indexOf(level) !== -1;
}

/* Furthest level the player can currently open (for "Level X of 35 unlocked"
   and for where Play picks up). */
function getFurthestUnlockedLevel() {
  var best = getUnlockedLevel();
  getAdUnlockedLevels().forEach(function (n) { if (n > best) best = n; });
  return best;
}

function hasSessionEverReset() {
  return gameStore.getItem(RESET_HAPPENED_KEY) === "1";
}

/* A locked level is only ad-unlockable once a 24-hour reset has happened AND
   the level right before it is still locked too - i.e. it sits after a gap,
   where ads are the only way in. The moment a level is unlocked (by ads or by
   winning) the one after it drops out of the ads pool and can only be reached
   by playing and winning that level. Identical rule to Pac-Man. */
function isLevelAdUnlockable(level) {
  return level > 1 && level <= TOTAL_LEVELS && !isLevelUnlocked(level) &&
    hasSessionEverReset() && !isLevelUnlocked(level - 1);
}

/* ===================== 24-hour session ===================== */
/* A session starts the first time the game is opened. Everything the player
   earns (progress, coins, stars, achievements, skins) lives inside that
   session. 24 hours after it began the session ends: all saved data is wiped
   and the game starts fresh from level 1. */
var SESSION_KEYS = [PROGRESS_KEY, AD_UNLOCKED_KEY, COINS_KEY, STARS_KEY, ACH_KEY, TOTAL_LINES_KEY, SKINS_KEY];

function wipeSessionData() {
  SESSION_KEYS.forEach(function (k) {
    gameStore.removeItem(k);
  });
  gameStore.setItem(RESET_HAPPENED_KEY, "1");
  gameStore.setItem(SESSION_KEY, String(Date.now()));
}

/* Returns true if the session had expired and was reset. */
function checkSessionReset() {
  var start = parseInt(gameStore.getItem(SESSION_KEY), 10);
  if (!start || isNaN(start) || start > Date.now()) {
    gameStore.setItem(SESSION_KEY, String(Date.now()));
    return false;
  }
  if (Date.now() - start >= SESSION_LENGTH_MS) {
    wipeSessionData();
    return true;
  }
  return false;
}
/* The check on load still runs before the UI exists, but its answer is kept
   so the "24-hour session over" popup can be shown once the page is ready -
   Pac-Man announces a reset that happened while the game was closed the same
   way. */
var sessionResetOnLoad = checkSessionReset();

/* ===================== Coins ===================== */
function getCoins() {
  return parseInt(gameStore.getItem(COINS_KEY), 10) || 0;
}
function addCoins(n) {
  var c = getCoins() + n;
  gameStore.setItem(COINS_KEY, String(c));
  updateCoinDisplays();
  return c;
}
function spendCoins(n) {
  var c = getCoins();
  if (c < n) return false;
  gameStore.setItem(COINS_KEY, String(c - n));
  updateCoinDisplays();
  return true;
}
function updateCoinDisplays() {
  var val = getCoins();
  var els = document.querySelectorAll(".coin-display");
  for (var i = 0; i < els.length; i++) els[i].textContent = val;
}

/* ===================== Stars ===================== */
function getStars() {
  try {
    return JSON.parse(gameStore.getItem(STARS_KEY)) || {};
  } catch (e) {
    return {};
  }
}
function setStar(level, stars) {
  var s = getStars();
  if (!s[level] || s[level] < stars) {
    s[level] = stars;
    gameStore.setItem(STARS_KEY, JSON.stringify(s));
  }
}
function starsForLevel(level, levelScore) {
  var t2 = 300 + level * 60;
  var t3 = 700 + level * 140;
  if (levelScore >= t3) return 3;
  if (levelScore >= t2) return 2;
  return 1;
}

/* ===================== Cumulative lines (for achievements) ===================== */
function getTotalLines() {
  return parseInt(gameStore.getItem(TOTAL_LINES_KEY), 10) || 0;
}
function addTotalLines(n) {
  var t = getTotalLines() + n;
  gameStore.setItem(TOTAL_LINES_KEY, String(t));
  return t;
}

/* ===================== Achievements ===================== */
var ACHIEVEMENTS = [
  { id: "firstLine", name: "First Line", desc: "Clear your first line.", coins: 20, icon: "\u{1F3C6}" },
  { id: "lineMaster", name: "Line Master", desc: "Clear 100 lines total.", coins: 50, icon: "\u{1F3C6}" },
  { id: "tetrisClear", name: "Tetris!", desc: "Clear 4 lines at once.", coins: 50, icon: "\u{1F3C6}" },
  { id: "comboKing", name: "Combo King", desc: "5 consecutive successful clears.", coins: 75, icon: "\u{1F3C6}" },
  { id: "tetrisMaster", name: "Tetris Master", desc: "Complete level " + TOTAL_LEVELS + ".", coins: 100, icon: "\u{1F451}" }
];
function getAchievements() {
  try {
    return JSON.parse(gameStore.getItem(ACH_KEY)) || {};
  } catch (e) {
    return {};
  }
}
function setAchievement(id) {
  var a = getAchievements();
  if (a[id]) return false;
  a[id] = true;
  gameStore.setItem(ACH_KEY, JSON.stringify(a));
  return true;
}
function unlockAchievement(id) {
  if (setAchievement(id)) {
    var a = null;
    for (var i = 0; i < ACHIEVEMENTS.length; i++) if (ACHIEVEMENTS[i].id === id) a = ACHIEVEMENTS[i];
    if (a) {
      addCoins(a.coins);
      /* No popup while a level is being played (Pac-Man shows nothing
         mid-game either). The achievement and its coins are still saved and
         show on the Achievements tab; the toast only appears off the game
         screen. */
      var gameScreenEl = document.getElementById("gameScreen");
      if (!gameScreenEl || gameScreenEl.classList.contains("hidden")) {
        showToast("\u{1F3C6} " + a.name + " unlocked! +" + a.coins + " coins", 2400);
      }
      SFX.levelUp();
    }
  }
}

/* ===================== Skins (coin-unlockable block colors) ===================== */
var SKINS = [
  { id: "classic", name: "Classic", cost: 0, colors: { t: "#9b3fe0", i: "#17c6d1", l: "#ef9a1e", j: "#2f66e0", s: "#3fbf5a", z: "#e14b4b", o: "#e8c62b" } },
  { id: "ocean", name: "Ocean", cost: 150, colors: { t: "#0077b6", i: "#00b4d8", l: "#90e0ef", j: "#023e8a", s: "#48cae4", z: "#ade8f4", o: "#caf0f8" } },
  { id: "neon", name: "Neon", cost: 100, colors: { t: "#ff2bd6", i: "#00f7ff", l: "#ff9500", j: "#3d5bff", s: "#39ff6a", z: "#ff2b4c", o: "#f9ff2b" } },
  { id: "candy", name: "Candy", cost: 250, colors: { t: "#d891ef", i: "#8fe3e8", l: "#ffc178", j: "#a5b8f2", s: "#b6f2b0", z: "#f7a3ab", o: "#fff0a3" } },
  { id: "sunset", name: "Sunset", cost: 350, colors: { t: "#ff477e", i: "#ffb703", l: "#fb5607", j: "#8338ec", s: "#ff9770", z: "#e0218a", o: "#ffd166" } },
  { id: "forest", name: "Forest", cost: 450, colors: { t: "#40916c", i: "#74c69d", l: "#d9ed92", j: "#1b4332", s: "#52b788", z: "#2d6a4f", o: "#b7e4c7" } },
  { id: "space", name: "Space", cost: 500, colors: { t: "#6c5ce7", i: "#00b8d9", l: "#c2c2d6", j: "#4834d4", s: "#341f97", z: "#535c68", o: "#dfe6e9" } },
  { id: "mono", name: "Monochrome", cost: 600, colors: { t: "#2b2d42", i: "#8d99ae", l: "#edf2f4", j: "#495057", s: "#adb5bd", z: "#343a40", o: "#ced4da" } },
  { id: "fire", name: "Fire", cost: 750, colors: { t: "#ff4500", i: "#ff8c00", l: "#ffae42", j: "#c0392b", s: "#e74c3c", z: "#8b0000", o: "#ffd700" } },
  { id: "retro", name: "Retro Arcade", cost: 900, colors: { t: "#f038ff", i: "#00e5ff", l: "#ff9100", j: "#2979ff", s: "#00e676", z: "#ff1744", o: "#ffea00" } },
  { id: "legendary", name: "Legendary", cost: 1000, colors: { t: "#ffd700", i: "#ffec8b", l: "#f4c430", j: "#b8860b", s: "#daa520", z: "#cd853f", o: "#fff8dc" } }
];
function getOwnedSkins() {
  try {
    var s = JSON.parse(gameStore.getItem(SKINS_KEY));
    if (s && s.owned) return s;
  } catch (e) {}
  return { owned: ["classic"], selected: "classic" };
}
function saveSkins(obj) {
  gameStore.setItem(SKINS_KEY, JSON.stringify(obj));
}
function applySkin(id) {
  var skin = null;
  for (var i = 0; i < SKINS.length; i++) if (SKINS[i].id === id) skin = SKINS[i];
  if (!skin) return;
  var root = document.documentElement.style;
  root.setProperty("--piece-t", skin.colors.t);
  root.setProperty("--piece-i", skin.colors.i);
  root.setProperty("--piece-l", skin.colors.l);
  root.setProperty("--piece-j", skin.colors.j);
  root.setProperty("--piece-s", skin.colors.s);
  root.setProperty("--piece-z", skin.colors.z);
  root.setProperty("--piece-o", skin.colors.o);
}

/* ===================== Themes (board look, tied to level range) ===================== */
var THEMES = [
  { name: "Classic", min: 1, max: 5, cls: "theme-classic" },
  { name: "Space", min: 6, max: 10, cls: "theme-space" },
  { name: "Neon City", min: 11, max: 15, cls: "theme-neon" },
  { name: "Fire", min: 16, max: 20, cls: "theme-fire" },
  { name: "Ice", min: 21, max: 25, cls: "theme-ice" },
  { name: "Royal", min: 26, max: 30, cls: "theme-royal" },
  { name: "Legendary", min: 31, max: 35, cls: "theme-legendary" }
];
function themeForLevel(level) {
  for (var i = 0; i < THEMES.length; i++) {
    if (level >= THEMES[i].min && level <= THEMES[i].max) return THEMES[i];
  }
  return THEMES[THEMES.length - 1];
}
function applyTheme(level) {
  var t = themeForLevel(level);
  var frame = document.getElementById("canvas-frame");
  if (!frame) return;
  for (var i = 0; i < THEMES.length; i++) frame.classList.remove(THEMES[i].cls);
  frame.classList.add(t.cls);
}

/* ===================== Level coin rewards ===================== */
function computeLevelCoins(stats) {
  var base = 20;
  var singleCoins = ((stats.linesByCount[1] || 0)) * 2;
  var doubleCoins = ((stats.linesByCount[2] || 0)) * 5;
  var tripleCoins = ((stats.linesByCount[3] || 0)) * 10;
  var tetrisCoins = ((stats.linesByCount[4] || 0)) * 20;
  var comboCoins = stats.comboCoins || 0;
  var perfectBonus = 10;
  var total = base + singleCoins + doubleCoins + tripleCoins + tetrisCoins + comboCoins + perfectBonus;
  return {
    base: base,
    singleCoins: singleCoins,
    doubleCoins: doubleCoins,
    tripleCoins: tripleCoins,
    tetrisCoins: tetrisCoins,
    comboCoins: comboCoins,
    perfectBonus: perfectBonus,
    total: total
  };
}

/* ===================== Level names ===================== */
var LEVEL_NAMES = [
  "Warm-Up", "Easy Drop", "Steady Stack", "Building Up", "Quick Fingers",
  "Brisk Blocks", "Row Runner", "Line Hunter", "Fast Falling", "Speed Stacker",
  "Momentum", "Rising Tempo", "Block Rush", "Swift Stack", "Overclock",
  "Turbo Tetris", "Rapid Rows", "High Gear", "Danger Zone", "Redline",
  "Blitz Mode", "Nitro Drop", "Hyper Stack", "Critical Speed", "Meltdown",
  "Chaos Drop", "Lightspeed", "Breakneck", "Sonic Stack", "Warp Speed",
  "Adrenaline", "Final Push", "Endgame", "Last Stand", "Tetris Master"
];

function getLevelName(level) {
  return LEVEL_NAMES[level - 1] || "Level " + level;
}

/* ===================== Sound effects (Web Audio, fully offline) ===================== */
var SFX = (function () {
  var ctx = null;
  var enabled = gameStore.getItem("tetrisSoundEnabled") !== "0";

  function getCtx() {
    if (!enabled) return null;
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) {
        enabled = false;
        return null;
      }
      ctx = new AC();
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function beep(freq, duration, type, volume) {
    var c = getCtx();
    if (!c) return;
    var osc = c.createOscillator();
    var gain = c.createGain();
    osc.type = type || "square";
    osc.frequency.value = freq;
    var now = c.currentTime;
    gain.gain.setValueAtTime(volume || 0.07, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(now);
    osc.stop(now + duration);
  }

  return {
    move: function () {
      beep(220, 0.045, "square", 0.045);
    },
    rotate: function () {
      beep(340, 0.06, "square", 0.06);
    },
    autoTick: function () {
      beep(300, 0.02, "sine", 0.02);
    },
    uiClick: function () {
      beep(600, 0.03, "sine", 0.05);
    },
    lock: function () {
      beep(140, 0.08, "square", 0.08);
    },
    lineClear: function (count) {
      var base = 440;
      var n = Math.min(count, 4);
      for (var i = 0; i < n; i++) {
        (function (i) {
          setTimeout(function () {
            beep(base + i * 130, 0.1, "triangle", 0.09);
          }, i * 70);
        })(i);
      }
    },
    levelUp: function () {
      beep(523, 0.1, "triangle", 0.08);
      setTimeout(function () {
        beep(659, 0.12, "triangle", 0.08);
      }, 100);
      setTimeout(function () {
        beep(784, 0.18, "triangle", 0.09);
      }, 200);
    },
    gameOver: function () {
      beep(196, 0.25, "sawtooth", 0.07);
      setTimeout(function () {
        beep(147, 0.35, "sawtooth", 0.07);
      }, 180);
    },
    isEnabled: function () {
      return enabled;
    },
    setEnabled: function (val) {
      enabled = !!val;
      gameStore.setItem("tetrisSoundEnabled", enabled ? "1" : "0");
    },
    toggle: function () {
      this.setEnabled(!enabled);
      return enabled;
    }
  };
})();

/* ===================== Tetris engine ===================== */
function levelBadgeLabel(level) {
  /* The pill is now Pac-Man's title (<span class="pm-lvl-word">Level</span>
     <span class="pm-lvl-num">N</span>), and #levelBadgeGame is the number
     span. The "Level 7" / "L7" switch is done by Pac-Man's own CSS tiers
     (the word is hidden and an "L" is drawn before the number under 700px),
     so only the number is written here. */
  return String(level);
}

var tetris = {
  board: [],
  boardDiv: null,
  canvas: null,
  pSize: 20,
  /* Starting values only — BOTH of these are overwritten at game start by
     applyGridForOrientation(), which derives the real column and row count
     from the room #boardArea actually has (see TARGET_CELL_PX and
     gridForArea() further down). Nothing should be tuned here: to change how
     big the falling pieces render, change TARGET_CELL_PX; to change the
     playable limits on the field, change GRID_COLS_MIN / GRID_COLS_MAX /
     GRID_ROWS_MAX / gridRowsMin(). These two are just what the field is
     before the first measurement lands, and they match the CSS fallback on
     #canvas in style.css. */
  canvasHeight: 560,
  canvasWidth: 920,
  boardHeight: 0,
  boardWidth: 0,
  spawnX: 7, // recalculated from boardWidth in initBoard()
  spawnY: 1,
  shapes: [
    [
      [-1, 1],
      [0, 1],
      [1, 1],
      [0, 0], //TEE
    ],
    [
      [-1, 0],
      [0, 0],
      [1, 0],
      [2, 0], //line
    ],
    [
      [-1, -1],
      [-1, 0],
      [0, 0],
      [1, 0], //L EL
    ],
    [
      [1, -1],
      [-1, 0],
      [0, 0],
      [1, 0], //R EL
    ],
    [
      [0, -1],
      [1, -1],
      [-1, 0],
      [0, 0], // R ess
    ],
    [
      [-1, -1],
      [0, -1],
      [0, 0],
      [1, 0], //L ess
    ],
    [
      [0, -1],
      [1, -1],
      [0, 0],
      [1, 0], //square
    ],
  ],
  tempShapes: null,
  curShape: null,
  curShapeIndex: null,
  curX: 0,
  curY: 0,
  curSqs: [],
  nextShape: null,
  nextShapeDisplay: null,
  nextShapeIndex: null,
  sqs: [],
  score: 0,
  startLevel: 1,
  level: 1,
  levelDisplay: null,
  linesDisplay: null,
  numLevels: TOTAL_LEVELS,
  isActive: 0,
  curComplete: false,
  pTimer: null,
  speed: 700,
  lines: 0,
  levelLines: 0,
  levelStats: null,
  comboStreak: 0,
  levelStartScore: 0,
  lastLevelReward: null,
  lastLevelStars: 1,
  lastCompletedLevel: 1,

  init: function (startLevel) {
    this.canvas = document.getElementById("canvas");
    this.initInfo();
    this.startLevel = startLevel || 1;
    this.level = this.startLevel;
    this.speed = speedForLevel(this.level);
    this.resetState();
    this.bindKeyEvents();
    applyTheme(this.level);
    this.play();
  },

  resetLevelStats: function () {
    this.levelStats = { linesByCount: {}, comboCoins: 0, maxCombo: 0 };
    this.comboStreak = 0;
    this.levelLines = 0;
    this.levelStartScore = this.score;
  },

  resetState: function () {
    this.clearTimers();
    this.canvas.innerHTML = "";
    this.board = [];
    this.initBoard();
    this.sqs = [];
    this.curSqs = [];
    this.tempShapes = null;
    this.score = 0;
    this.lines = 0;
    this.level = this.startLevel;
    this.speed = speedForLevel(this.level);
    this.isActive = 0;
    this.curComplete = false;
    this.resetLevelStats();
    this.setInfo("level");
    this.setInfo("lines");
    this.initShapes();
  },

  initBoard: function () {
    this.boardHeight = this.canvasHeight / this.pSize;
    this.boardWidth = this.canvasWidth / this.pSize;
    // Pieces spawn from the middle of whatever width the field ends up being,
    // rather than the hard-coded column 7 that only suited a 16-wide board.
    this.spawnX = Math.max(1, Math.floor(this.boardWidth / 2) - 2);
    var s = this.boardHeight * this.boardWidth;
    for (var i = 0; i < s; i++) {
      this.board.push(0);
    }
  },

  initInfo: function () {
    this.nextShapeDisplay = document.getElementById("next_shape");
    this.levelDisplay = document.getElementById("levelNumGame");
    this.linesDisplay = document.getElementById("statLines");
  },

  initShapes: function () {
    this.curSqs = [];
    this.curComplete = false;
    this.shiftTempShapes();
    this.curShapeIndex = this.tempShapes[0];
    this.curShape = this.shapes[this.curShapeIndex];
    this.initNextShape();
    this.setCurCoords(this.spawnX, this.spawnY);
    if (this.isCollision(this.curX, this.curY, this.curShape)) {
      this.gameOver();
      return;
    }
    this.drawShape(this.curX, this.curY, this.curShape);
  },

  initNextShape: function () {
    /* The queue holds the current piece at [0] and the preview at [1]. When
       only the current piece is left, the next shuffled bag is APPENDED.
       (It used to REPLACE the queue, so the new bag's first piece was never
       dealt and every bag after the first was missing one shape.) */
    if (this.tempShapes.length < 2) {
      this.tempShapes = this.tempShapes.concat(this.newBag());
    }
    this.nextShapeIndex = this.tempShapes[1];
    this.nextShape = this.shapes[this.nextShapeIndex];
    this.drawNextShape();
  },

  /* All seven shapes in random order (Fisher-Yates). */
  newBag: function () {
    var bag = [];
    for (var i = 0; i < this.shapes.length; i++) bag.push(i);
    for (var k = bag.length - 1; k > 0; k--) {
      var j = Math.floor(Math.random() * (k + 1));
      var tmp = bag[k];
      bag[k] = bag[j];
      bag[j] = tmp;
    }
    return bag;
  },

  shiftTempShapes: function () {
    if (!this.tempShapes || !this.tempShapes.length) {
      this.tempShapes = this.newBag();
    } else {
      this.tempShapes.shift();
    }
  },

  setInfo: function (el) {
    if (el === "lines") {
      /* The lines pill now counts DOWN to the level's target instead of
         counting up the run's total — the number next to the icon is
         "how many lines are left to clear", matching the objective text
         it replaced, so the pill itself is readable at a glance without
         a separate objective line. */
      if (this.linesDisplay) {
        var remaining = Math.max(0, linesRequiredForLevel(this.level) - this.levelLines);
        this.linesDisplay.innerHTML = remaining;
      }
      return;
    }
    if (!this[el + "Display"]) return;
    if (el === "level") {
      /* Just "Level 7" — the name ("Warm-Up", "Tetris Master") is gone from
         this badge on purpose. It was up to ~90px of the header row, which
         is the width that decided whether the four stat pills fitted on the
         level line or dropped to a second one; a second header line costs
         the board ~25px of height at every size. The name still appears
         where it has room and means something: the level-select grid and
         the Level Complete dialog. */
      this[el + "Display"].innerHTML = levelBadgeLabel(this[el]);
    }
  },

  /* The preview now lives in the stats bar, in a small fixed window, so the
     piece is drawn at its own origin (0,0) and the layer is sized to the
     piece's real bounding box — the CSS then centres and scales it. That
     way a flat 1x4 "I" and a 2x2 "O" are both framed the same. */
  drawNextShape: function () {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var i = 0; i < this.nextShape.length; i++) {
      var cx = this.nextShape[i][0];
      var cy = this.nextShape[i][1];
      if (cx < minX) minX = cx;
      if (cy < minY) minY = cy;
      if (cx > maxX) maxX = cx;
      if (cy > maxY) maxY = cy;
    }
    var ns = [];
    for (var j = 0; j < this.nextShape.length; j++) {
      ns[j] = this.createSquare(
        this.nextShape[j][0] - minX,
        this.nextShape[j][1] - minY,
        this.nextShapeIndex
      );
    }
    this.nextShapeDisplay.innerHTML = "";
    this.nextShapeDisplay.style.width = (maxX - minX) * this.pSize + 19 + "px";
    this.nextShapeDisplay.style.height = (maxY - minY) * this.pSize + 19 + "px";
    for (var k = 0; k < ns.length; k++) {
      this.nextShapeDisplay.appendChild(ns[k]);
    }
  },

  drawShape: function (x, y, p) {
    for (var i = 0; i < p.length; i++) {
      var newX = p[i][0] + x;
      var newY = p[i][1] + y;
      this.curSqs[i] = this.createSquare(newX, newY, this.curShapeIndex);
    }
    for (var k = 0; k < this.curSqs.length; k++) {
      this.canvas.appendChild(this.curSqs[k]);
    }
  },

  createSquare: function (x, y, type) {
    var el = document.createElement("div");
    el.className = "square type" + type;
    el.style.left = x * this.pSize + "px";
    el.style.top = y * this.pSize + "px";
    return el;
  },

  removeCur: function () {
    var canvas = this.canvas;
    this.curSqs.forEach(function (sq) {
      canvas.removeChild(sq);
    });
    this.curSqs = [];
  },

  setCurCoords: function (x, y) {
    this.curX = x;
    this.curY = y;
  },

  bindKeyEvents: function () {
    var me = this;
    var event = "keydown";
    var cb = function (e) {
      me.handleKey(e);
    };
    if (this._keyHandler) {
      document.removeEventListener(event, this._keyHandler, false);
    }
    this._keyHandler = cb;
    document.addEventListener(event, cb, false);
  },

  handleKey: function (e) {
    if (!isPlaying || adIsPlaying) return;
    var c = e.keyCode;
    if (c === 27 || c === 80) { // Escape / P — same keys as Pac-Man
      e.preventDefault();
      togglePause();
      return;
    }
    if (this.isActive !== 1) return; // ignore movement while paused
    switch (c) {
      case 37:
        e.preventDefault();
        this.move("L");
        SFX.move();
        break;
      case 38:
        e.preventDefault();
        this.move("RT");
        SFX.rotate();
        break;
      case 39:
        e.preventDefault();
        this.move("R");
        SFX.move();
        break;
      case 40:
        e.preventDefault();
        this.move("D");
        SFX.move();
        break;
      default:
        break;
    }
  },

  incScore: function (amount) {
    this.score = this.score + amount;
  },

  incLines: function (num) {
    this.lines += num;
    this.levelLines += num;
    this.setInfo("lines");
  },

  checkLevel: function () {
    if (this.levelLines < linesRequiredForLevel(this.level)) return false;

    var completedLevel = this.level;
    var levelScoreEarned = this.score - this.levelStartScore;
    var reward = computeLevelCoins(this.levelStats);
    addCoins(reward.total);
    var stars = starsForLevel(completedLevel, levelScoreEarned);
    setStar(completedLevel, stars);
    this.lastLevelReward = reward;
    this.lastLevelStars = stars;
    this.lastCompletedLevel = completedLevel;

    this.level = Math.min(this.numLevels, this.level + 1);
    this.speed = speedForLevel(this.level);
    this.setInfo("level");
    setUnlockedLevel(this.level);
    if (completedLevel >= this.numLevels) unlockAchievement("tetrisMaster");
    SFX.levelUp();
    return true;
  },

  /* Empties the well. Level progress (lines cleared so far, coin stats) is
     left alone, so the ad-powered Continue really does pick up where the
     player was. */
  clearBoard: function () {
    this.canvas.innerHTML = "";
    this.board = [];
    this.initBoard();
    this.sqs = [];
    this.curSqs = [];
    this.curComplete = false;
    this.comboStreak = 0;
    applyTheme(this.level);
  },

  /* Next Level: empty well AND a fresh lines target. The lines pill is
     redrawn here; it used to keep showing the previous level's count. */
  clearBoardForNextLevel: function () {
    this.clearBoard();
    this.resetLevelStats();
    this.setInfo("lines");
  },

  calcScore: function (args) {
    var lines = args.lines || 0;
    var placed = args.placed || false;
    var lineScores = [0, 40, 100, 300, 1200];
    var score = 0;

    if (lines > 0) {
      score += (lineScores[lines] || lineScores[4]) * this.level;
      this.incLines(lines);
    }
    if (placed) {
      score += 5;
    }
    this.incScore(score);
  },

  gameOver: function () {
    this.clearTimers();
    isPlaying = false;
    setUnlockedLevel(this.level);
    SFX.gameOver();
    showGameOver();
  },

  play: function () {
    var me = this;
    /* Anything that (re)starts the drop loop — Resume, Restart, Prev/Next,
       Next Level, the continue ad — means the game is no longer paused, so
       the Pause button is put back to "Pause" here, once, for all of them. */
    if (gamePaused) setPaused(false, true);
    /* Only ONE drop loop may ever run: starting the loop again (resume,
       restart, continue, next level, a resize remap...) cancels any tick
       still pending, so two loops can never drop/lock the same piece. */
    clearTimeout(this.pTimer);
    this.pTimer = null;
    var gameLoop = function () {
      if (!isPlaying) return;
      /* Landing is decided by THIS tick's own attempt to move down, never by
         a flag left over from earlier. A piece the player pressed Down on
         while it rested on a ledge, and then slid or rotated off that ledge,
         used to still carry that stale flag and was locked in mid-air. */
      me.curComplete = false;
      me.move("D");
      if (!isPlaying) return; // that move ended the run (game over at the spawn row)
      if (!me.curComplete) {
        SFX.autoTick();
      }
      if (me.curComplete) {
        me.markBoardShape(me.curX, me.curY, me.curShape);
        Array.prototype.push.apply(me.sqs, me.curSqs);
        SFX.lock();
        me.calcScore({ placed: true });
        me.checkRows();
        var leveledUp = me.checkLevel();
        if (leveledUp) {
          me.clearTimers();
          me.isActive = 0;
          showLevelComplete();
        } else {
          me.initShapes();
          if (isPlaying) me.play();
        }
      } else {
        me.pTimer = setTimeout(gameLoop, me.speed);
      }
    };
    this.pTimer = setTimeout(gameLoop, me.speed);
    this.isActive = 1;
  },

  pause: function () {
    if (this.isActive === 1) {
      this.clearTimers();
      this.isActive = 0;
    }
  },

  resume: function () {
    if (this.isActive === 0) {
      this.play();
    }
  },

  clearTimers: function () {
    clearTimeout(this.pTimer);
    this.pTimer = null;
  },

  move: function (dir) {
    var s = "";
    var tempX = this.curX;
    var tempY = this.curY;
    switch (dir) {
      case "L":
        s = "left";
        tempX -= 1;
        break;
      case "R":
        s = "left";
        tempX += 1;
        break;
      case "D":
        s = "top";
        tempY += 1;
        break;
      case "RT":
        this.rotate();
        return true;
      default:
        return false;
    }
    if (this.checkMove(tempX, tempY, this.curShape)) {
      var step = dir === "L" ? -this.pSize : this.pSize;
      this.curSqs.forEach(function (sq) {
        sq.style[s] = parseInt(sq.style[s], 10) + step + "px";
      });
      this.curX = tempX;
      this.curY = tempY;
      // The piece moved, so it is not resting on anything any more.
      this.curComplete = false;
    } else if (dir === "D") {
      if (this.curY <= this.spawnY) {
        this.gameOver();
        return false;
      }
      this.curComplete = true;
    }
  },

  rotate: function () {
    if (this.curShapeIndex !== 6) {
      //square never rotates
      var temp = this.curShape.map(function (c) {
        return [c[1] * -1, c[0]];
      });
      if (this.checkMove(this.curX, this.curY, temp)) {
        this.curShape = temp;
        this.removeCur();
        this.drawShape(this.curX, this.curY, this.curShape);
        // Rotated into a new footprint — whether it rests is re-checked on
        // the next drop tick, not carried over.
        this.curComplete = false;
      }
    }
  },

  checkMove: function (x, y, p) {
    if (this.isOB(x, y, p) || this.isCollision(x, y, p)) {
      return false;
    }
    return true;
  },

  isCollision: function (x, y, p) {
    var me = this;
    return p.some(function (c) {
      return me.boardPos(c[0] + x, c[1] + y) === 1;
    });
  },

  isOB: function (x, y, p) {
    var w = this.boardWidth - 1;
    var h = this.boardHeight - 1;
    return p.some(function (c) {
      var newX = c[0] + x;
      var newY = c[1] + y;
      return newX < 0 || newX > w || newY < 0 || newY > h;
    });
  },

  getRowState: function (y) {
    var c = 0;
    for (var x = 0; x < this.boardWidth; x++) {
      if (this.boardPos(x, y) === 1) {
        c = c + 1;
      }
    }
    if (c === 0) return "E";
    if (c === this.boardWidth) return "F";
    return "U";
  },

  checkRows: function () {
    var c = 0;
    var stopCheck = false;
    for (var y = this.boardHeight - 1; y >= 0; y--) {
      switch (this.getRowState(y)) {
        case "F":
          this.removeRow(y);
          c++;
          break;
        case "E":
          if (c === 0) {
            stopCheck = true;
          }
          break;
        case "U":
          if (c > 0) {
            this.shiftRow(y, c);
          }
          break;
        default:
          break;
      }
      if (stopCheck === true) {
        break;
      }
    }
    if (c > 0) {
      SFX.lineClear(c);
      this.calcScore({ lines: c });

      this.levelStats.linesByCount[c] = (this.levelStats.linesByCount[c] || 0) + 1;
      this.comboStreak++;
      if (this.comboStreak > this.levelStats.maxCombo) this.levelStats.maxCombo = this.comboStreak;
      if (this.comboStreak >= 2) this.levelStats.comboCoins += 5;

      addTotalLines(c);
      unlockAchievement("firstLine");
      if (c === 4) unlockAchievement("tetrisClear");
      if (getTotalLines() >= 100) unlockAchievement("lineMaster");
      if (this.comboStreak >= 5) unlockAchievement("comboKing");
    } else {
      this.comboStreak = 0;
    }
  },

  /* One pass over the landed squares (it used to be one pass per column). */
  shiftRow: function (y, amount) {
    var me = this;
    this.sqs.forEach(function (sq) {
      var pos = me.getPos(sq);
      if (pos[1] === y) me.setBlock(pos[0], y + amount, sq);
    });
    this.emptyBoardRow(y);
  },

  emptyBoardRow: function (y) {
    for (var x = 0; x < this.boardWidth; x++) {
      this.markBoardAt(x, y, 0);
    }
  },

  removeRow: function (y) {
    for (var x = 0; x < this.boardWidth; x++) {
      this.removeBlock(x, y);
    }
  },

  removeBlock: function (x, y) {
    var me = this;
    this.markBoardAt(x, y, 0);
    this.sqs = this.sqs.filter(function (sq) {
      if (!me.isAt(x, y, sq)) return true;
      me.canvas.removeChild(sq);
      return false;
    });
  },

  setBlock: function (x, y, block) {
    this.markBoardAt(x, y, 1);
    var newX = x * this.pSize;
    var newY = y * this.pSize;
    block.style.left = newX + "px";
    block.style.top = newY + "px";
  },

  isAt: function (x, y, block) {
    var pos = this.getPos(block);
    return pos[0] === x && pos[1] === y;
  },

  getPos: function (block) {
    var p = [];
    p.push(parseInt(block.style.left, 10) / this.pSize);
    p.push(parseInt(block.style.top, 10) / this.pSize);
    return p;
  },

  boardPos: function (x, y) {
    return this.board[x + y * this.boardWidth];
  },

  markBoardAt: function (x, y, val) {
    this.board[x + y * this.boardWidth] = val;
  },

  markBoardShape: function (x, y, p) {
    var me = this;
    p.forEach(function (c) {
      me.markBoardAt(c[0] + x, c[1] + y, 1);
    });
  },
};

/* ===================== Screens & app state ===================== */
var isPlaying = false;
var chosenStartLevel = 1;
/* One rewarded ad per level-entry for the in-game Restart button — reset to
   false on every fresh showGameScreen() (a normal entry), then set back to
   true immediately after Restart itself is used, so restarting twice in a
   row without ever really leaving the level can't be used to keep farming
   the "restart" ad placement. Same one-per-attempt rule Pac-Man's
   restartAdUsedThisRun carries. */
var restartAdUsedThisRun = false;

var startScreen = document.getElementById("startScreen");
var levelScreen = document.getElementById("levelScreen");
var gameScreen = document.getElementById("gameScreen");
var shopScreen = document.getElementById("shopScreen");
var playBtn = document.getElementById("playBtn");
var selectLevelBtn = document.getElementById("selectLevelBtn");
var shopBtn = document.getElementById("shopBtn");
var backToStartBtn = document.getElementById("backToStartBtn");
var backToStartFromShopBtn = document.getElementById("backToStartFromShopBtn");
var shopTabsEl = document.getElementById("shopTabs");
var shopGridEl = document.getElementById("shopGrid");
var achievementsListEl = document.getElementById("achievementsList");
/* Achievements moved inside the Shop as a second tab (see shopTabsEl) so the
   start screen keeps the same 3-option row Pac-Man uses, instead of a 4th
   pill-card just for this. "skins" is the tab shown when the Shop opens. */
var activeShopTab = "skins";
var levelGridEl = document.getElementById("levelGrid");
var progressTextEl = document.getElementById("progressText");
var levelBadgeGame = document.getElementById("levelNumGame");

var pauseBtn = document.getElementById("pauseBtn");
var exitBtn = document.getElementById("exitBtn");
var prevLevelBtn = document.getElementById("prevLevelBtn");
var restartBtn = document.getElementById("restartBtn");
var nextLevelBtn = document.getElementById("nextLevelBtn");
/* Game Over uses Pac-Man's #overlay popup, element for element (see
   index.html). The old variable names are kept so every existing caller
   still works; they now point at Pac-Man's ids. */
var resultOverlay = document.getElementById("overlay");
var resultTitle = document.getElementById("modalTitle");
var resultSubtitle = document.getElementById("modalMessage");
var playAgainBtn = document.getElementById("modalPrimaryBtn");
var changeLevelFromResultBtn = document.getElementById("modalSecondaryBtn");
var resultCloseBtn = document.getElementById("modalCloseX");

/* Congratulations is the SAME #overlay popup as Game Over (Pac-Man's
   handleLevelWin reuses it). overlayMode says which result it shows, so its
   three shared buttons and the × do the right thing for each. */
var overlayMode = "gameover"; // "gameover" | "win"
var modalCoinsEl = document.getElementById("modalCoins");
var modalPrevBtn = document.getElementById("modalPrevBtn");
/* Which level the popup is currently reporting on — Previous is relative to
   it, so it is recorded when the popup opens. */
var lastClearedLevel = 1;

var toastEl = document.getElementById("toast");
var howToPlayScreen = document.getElementById("howToPlayScreen");
var howToPlayClose = document.getElementById("howToPlayClose");

var btnLeft = document.getElementById("btnLeft");
var btnRight = document.getElementById("btnRight");
var btnDown = document.getElementById("btnDown");
var btnRotate = document.getElementById("btnRotate");

/* ---------- Toast ---------- */
var toastTimer = null;
function showToast(message, duration) {
  toastEl.textContent = message;
  toastEl.classList.remove("hidden");
  requestAnimationFrame(function () {
    toastEl.classList.add("show");
  });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () {
    toastEl.classList.remove("show");
    setTimeout(function () {
      toastEl.classList.add("hidden");
    }, 200);
  }, duration || 1400);
}

/* ---------- Level select grid ---------- */
function buildLevelGrid() {
  var furthest = getFurthestUnlockedLevel();
  var stars = getStars();
  levelGridEl.innerHTML = "";
  for (var lvl = 1; lvl <= TOTAL_LEVELS; lvl++) {
    (function (level) {
      var isOpen = isLevelUnlocked(level);
      /* Every locked level can be individually unlocked with 5 ads - but only
         after a 24-hour reset has happened at least once and only while the
         level before it is locked too (see isLevelAdUnlockable). The tile looks
         exactly like any other padlock; only the tap does something. */
      var adUnlockable = !isOpen && isLevelAdUnlockable(level);
      var isCurrent = isOpen && level === furthest;
      var isReached = isOpen && !isCurrent;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "level-tile"
        + (!isOpen ? " locked" : "")
        + (isReached ? " reached" : "")
        + (isCurrent ? " current" : "")
        + (adUnlockable ? " ad-unlockable" : "");
      btn.disabled = !isOpen && !adUnlockable;
      if (levelUnlockInProgress) btn.disabled = true; // ads playing — whole grid waits (Pac-Man)
      btn.setAttribute("aria-label", isOpen ? "Start at level " + level
        : adUnlockable ? "Level " + level + " locked - watch " + RECOVER_ADS_REQUIRED + " ads to unlock"
        : "Level " + level + " locked");
      if (!isOpen) {
        btn.innerHTML = '<span class="level-lock" aria-hidden="true">&#128274;</span><span class="level-num">' + level + "</span>";
        if (adUnlockable) {
          btn.title = "Watch " + RECOVER_ADS_REQUIRED + " ads to unlock this level and continue the game";
          btn.addEventListener("click", function () {
            if (levelUnlockInProgress) return;
            SFX.uiClick();
            showUnlockConfirm(level);
          });
        }
      } else {
        var earned = stars[level] || 0;
        var starStr = "";
        for (var i = 0; i < 3; i++) starStr += i < earned ? "\u2605" : "\u2606";
        // Pacman-style: number on top, speed name in middle, stars below.
        // Stars only render when earned (matches original behaviour) so a
        // freshly-unlocked level reads as "ready to play" without empty stars.
        btn.innerHTML =
          '<span class="level-num">' + level + '</span>' +
          '<span class="level-speed">' + getLevelName(level) + '</span>' +
          (earned ? '<span class="level-stars">' + starStr + "</span>" : "");
        btn.title = "Level " + level + ": " + getLevelName(level);
        btn.addEventListener("click", function () {
          SFX.uiClick();
          chosenStartLevel = level;
          showGameScreen();
        });
      }
      levelGridEl.appendChild(btn);
    })(lvl);
  }
  progressTextEl.textContent = "Level " + furthest + " of " + TOTAL_LEVELS + " unlocked";
  fitLevelNames();
}

/* ---------- Level names always stay inside their tile ----------
   The tiles are sized by the grid (square on most screens), so their width
   moves with the screen while the names do not: "STEADY STACK" needs ~72px
   at the designed size and a phone tile can be 47-60px wide. Each name that
   doesn't fit is adjusted on its own, gentlest step first, and a name that
   already fits is left exactly as designed:
     1. shrink it on one line, by at most 15%;
     2. else wrap it at its space onto two lines ("STEADY / STACK") at the
        designed size, shrinking only if two lines still don't fit;
     3. else (one long word) keep it whole on one line, smaller;
     4. only if none of that fits, allow a word to break.
   "Fits" means the text is inside the tile's border box horizontally AND
   the number, name and stars together still fit its height. Runs whenever
   the tiles are on screen with a new size: the grid being (re)built, the
   screen opening, fonts finishing loading, a resize or a rotation. */
var LEVEL_NAME_MIN_PX = 6;
var LEVEL_NAME_EDGE_PX = 2; // smallest gap kept between the text and the tile's border

function levelTileFits(tile, nameEl) {
  var cs = getComputedStyle(tile);
  var T = tile.getBoundingClientRect();
  var left = T.left + parseFloat(cs.borderLeftWidth) + LEVEL_NAME_EDGE_PX;
  var right = T.right - parseFloat(cs.borderRightWidth) - LEVEL_NAME_EDGE_PX;
  var top = T.top + parseFloat(cs.borderTopWidth);
  var bottom = T.bottom - parseFloat(cs.borderBottomWidth);
  // The name's TEXT (a Range sees the glyphs even where they spill past the
  // span), so a name that sat inside the tile in the original design is
  // judged as fitting and left exactly as it was.
  var rg = document.createRange();
  rg.selectNodeContents(nameEl);
  var R = rg.getBoundingClientRect();
  if (R.left < left - 0.5 || R.right > right + 0.5) return false;
  if (R.top < top - 0.5 || R.bottom > bottom + 0.5) return false;
  // ...and the number and stars still fit the tile's height around it.
  var parts = tile.children;
  for (var i = 0; i < parts.length; i++) {
    var r = parts[i].getBoundingClientRect();
    if (!r.width && !r.height) continue; // hidden part (e.g. stars on small tiles)
    if (r.top < top - 0.5 || r.bottom > bottom + 0.5) return false;
  }
  return true;
}

function setLevelNameSize(nameEl, px) {
  // The designed sizes are !important rules, so the new size goes through a
  // variable that the .is-fit rule in style.css reads (an inline font-size
  // would lose to them).
  nameEl.style.setProperty("--lvl-name-fs", px + "px");
  nameEl.classList.add("is-fit");
}

function fitOneLevelName(tile, nameEl) {
  nameEl.style.removeProperty("--lvl-name-fs");
  nameEl.classList.remove("is-fit", "is-wrapped", "is-broken", "is-tight");
  if (levelTileFits(tile, nameEl)) return;
  var base = parseFloat(getComputedStyle(nameEl).fontSize) || 8;
  var f;
  // 1. one line, at most 15% smaller
  for (f = base - 0.25; f >= base * 0.85; f -= 0.25) {
    setLevelNameSize(nameEl, f);
    if (levelTileFits(tile, nameEl)) return;
  }
  // 2. two lines at the space, designed size first, then smaller
  if (/\s/.test(nameEl.textContent.trim())) {
    nameEl.classList.add("is-wrapped");
    for (f = base; f >= LEVEL_NAME_MIN_PX; f -= 0.25) {
      setLevelNameSize(nameEl, f);
      if (levelTileFits(tile, nameEl)) return;
    }
    nameEl.classList.remove("is-wrapped");
  }
  // 3. one long word: keep it whole on one line, smaller still
  for (f = base * 0.85; f >= LEVEL_NAME_MIN_PX; f -= 0.25) {
    setLevelNameSize(nameEl, f);
    if (levelTileFits(tile, nameEl)) return;
  }
  // ...with the letters closed up (the name style spaces them 0.04em, ~2px
  // across a long word — on the narrowest tiles that is the difference).
  nameEl.classList.add("is-tight");
  for (f = base * 0.85; f >= LEVEL_NAME_MIN_PX; f -= 0.25) {
    setLevelNameSize(nameEl, f);
    if (levelTileFits(tile, nameEl)) return;
  }
  // 4. last resort, only if nothing above fits: let a word break
  nameEl.classList.add("is-wrapped", "is-broken");
  for (f = base; f >= LEVEL_NAME_MIN_PX; f -= 0.25) {
    setLevelNameSize(nameEl, f);
    if (levelTileFits(tile, nameEl)) return;
  }
}

function fitLevelNames() {
  if (!levelGridEl || levelScreen.classList.contains("hidden")) return;
  var tiles = levelGridEl.querySelectorAll(".level-tile");
  for (var i = 0; i < tiles.length; i++) {
    var nameEl = tiles[i].querySelector(".level-speed");
    if (nameEl) fitOneLevelName(tiles[i], nameEl);
  }
}

(function watchLevelNames() {
  var raf = 0;
  function schedule() {
    if (raf) return;
    raf = requestAnimationFrame(function () { raf = 0; fitLevelNames(); });
  }
  window.addEventListener("resize", schedule, { passive: true });
  window.addEventListener("orientationchange", function () {
    schedule();
    setTimeout(fitLevelNames, 350);
    setTimeout(fitLevelNames, 1000); // phones that report the new size late
  });
  if (window.visualViewport) window.visualViewport.addEventListener("resize", schedule);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitLevelNames);
})();

/* ---------- Shop screen ---------- */
function buildShop() {
  var owned = getOwnedSkins();
  shopGridEl.innerHTML = "";
  SKINS.forEach(function (skin) {
    var isOwned = owned.owned.indexOf(skin.id) !== -1;
    var isSelected = owned.selected === skin.id;
    var card = document.createElement("div");
    card.className = "shop-card" + (isSelected ? " selected" : "");
    var swatch =
      '<div class="shop-swatch">' +
      Object.keys(skin.colors)
        .map(function (k) {
          return '<span style="background:' + skin.colors[k] + '"></span>';
        })
        .join("") +
      "</div>";
    var btnHtml;
    if (isSelected) {
      btnHtml = '<button type="button" class="btn btn-ghost" disabled>Equipped</button>';
    } else if (isOwned) {
      btnHtml = '<button type="button" class="btn" data-action="select" data-id="' + skin.id + '">Equip</button>';
    } else {
      btnHtml =
        '<button type="button" class="btn" data-action="buy" data-id="' + skin.id + '">Buy &middot; ' + skin.cost + " \u{1FA99}</button>";
    }
    card.innerHTML = '<div class="shop-name">' + skin.name + "</div>" + swatch + btnHtml;
    shopGridEl.appendChild(card);
  });
}

shopGridEl.addEventListener("click", function (e) {
  var btn = e.target.closest ? e.target.closest("button[data-action]") : null;
  if (!btn) return;
  var id = btn.getAttribute("data-id");
  var action = btn.getAttribute("data-action");
  var owned = getOwnedSkins();
  var skin = null;
  for (var i = 0; i < SKINS.length; i++) if (SKINS[i].id === id) skin = SKINS[i];
  if (!skin) return;
  if (action === "buy") {
    if (!spendCoins(skin.cost)) {
      showToast("Not enough coins", 1300);
      return;
    }
    owned.owned.push(id);
    owned.selected = id;
    saveSkins(owned);
    applySkin(id);
    SFX.levelUp();
    showToast("Unlocked " + skin.name + "!", 1500);
  } else if (action === "select") {
    owned.selected = id;
    saveSkins(owned);
    applySkin(id);
    SFX.uiClick();
  }
  buildShop();
});

/* ---------- Achievements (now the Shop's second tab) ---------- */
function buildAchievements() {
  var earned = getAchievements();
  achievementsListEl.innerHTML = "";
  ACHIEVEMENTS.forEach(function (a) {
    var isUnlocked = !!earned[a.id];
    var card = document.createElement("div");
    card.className = "achievement-card " + (isUnlocked ? "unlocked" : "locked");
    card.innerHTML =
      '<span class="achievement-icon">' + (isUnlocked ? a.icon : "\u{1F512}") + '</span>' +
      '<div class="achievement-body"><div class="achievement-name">' + a.name + '</div>' +
      '<div class="achievement-desc">' + a.desc + " &middot; +" + a.coins + " coins</div></div>";
    achievementsListEl.appendChild(card);
  });
}

/* ---------- Shop tabs: Skins <-> Achievements ---------- */
function renderShopTab(tab) {
  activeShopTab = tab;
  [].slice.call(shopTabsEl.querySelectorAll(".shop-tab")).forEach(function (t) {
    t.classList.toggle("active", t.getAttribute("data-tab") === tab);
  });
  if (tab === "achievements") {
    buildAchievements();
    shopGridEl.classList.add("hidden");
    achievementsListEl.classList.remove("hidden");
  } else {
    buildShop();
    achievementsListEl.classList.add("hidden");
    shopGridEl.classList.remove("hidden");
  }
}

shopTabsEl.addEventListener("click", function (e) {
  var btn = e.target.closest ? e.target.closest(".shop-tab") : null;
  if (!btn) return;
  SFX.uiClick();
  renderShopTab(btn.getAttribute("data-tab"));
});

/* ---------- Screen navigation ---------- */
function hideAllScreens() {
  /* Leaving the game screen always clears Pause (Pac-Man's showScreen()). */
  if (typeof setPaused === "function") setPaused(false, true);
  if (typeof gameOverTimer !== "undefined" && gameOverTimer) { clearTimeout(gameOverTimer); gameOverTimer = null; }
  gameScreen.classList.remove("pm-active");
  startScreen.classList.add("hidden");
  levelScreen.classList.add("hidden");
  gameScreen.classList.add("hidden");
  shopScreen.classList.add("hidden");
  howToPlayScreen.classList.add("hidden");
  resultOverlay.classList.add("hidden");
  setRailsHiddenForOverlay(false);
  if (typeof hideGameOverAds === "function") hideGameOverAds();
  if (typeof hideLevelCompleteBannerAd === "function") hideLevelCompleteBannerAd();
  /* The two gutter cards are position:fixed and live OUTSIDE every screen, so
     hiding the screens left them sitting there — the menu would come up with
     the game's ad cards still on it, and they only went when something else
     happened to re-run the fit. That lingering is what looked like the old
     screen taking an age to leave. They are put away with everything else
     now; showGameScreen()'s own fit brings them straight back. */
  if (typeof hideSideRails === "function") hideSideRails();
}

function showStartScreen() {
  isPlaying = false;
  tetris.clearTimers();
  hideAllScreens();
  startScreen.classList.remove("hidden");
  updateCoinDisplays();
}

function showLevelScreen() {
  buildLevelGrid();
  isPlaying = false;
  tetris.clearTimers();
  hideAllScreens();
  levelScreen.classList.remove("hidden");
  fitLevelNames(); // the grid was built while hidden: measure it now it's shown
}

function showShopScreen() {
  // Always opens back on the Skins tab; renderShopTab() builds whichever
  // grid is active and hides the other one.
  renderShopTab("skins");
  isPlaying = false;
  tetris.clearTimers();
  hideAllScreens();
  shopScreen.classList.remove("hidden");
  updateCoinDisplays();
}

/* ===== Play-field grid: sized from the room the board actually gets =====

   WHAT CHANGED AND WHY (read this before touching the numbers below).

   This used to be four hand-tuned fixed grids — 46x28 desktop, 46x72
   landscape-tablet, 24x44 phone, 24x60 portrait-tablet — and a pickers'
   function that guessed which one suited the window. Two problems came out
   of that, and they were the same problem twice:

   1. THE PIECES WERE TINY. The grid was fixed, so the cell size was
      whatever fell out of "board size / column count". At 46 columns a
      1168px-wide black box gives 24px cells; a 1024px landscape tablet,
      where the box came out 368px wide, gave 7.6px cells — a whole
      tetromino was smaller than a stat pill.
   2. THE BOX DIDN'T FILL ITS SPACE. A fixed grid has a fixed aspect ratio,
      and the space available for the board does not: whichever of the two
      is tighter wins, and the other dimension is left as dead space. On a
      1024x768 landscape tablet the box was 368x224 in an area 372x667 —
      443px of unused height under it.

   The fix for both is the same: stop fixing the grid and derive it from the
   space, at game-start, from a real measurement of #boardArea.

     columns = round(availW / TARGET_CELL_PX)   -> sets how big a cell is
     rows    = round(columns * availH / availW) -> sets the box's aspect

   Because the rows come from the area's own aspect ratio, the board's
   natural ratio MATCHES the area's, so fitBoardToViewport() ends up
   width-bound and height-bound at the same time: the black box fills the
   room in BOTH directions instead of letterboxing in one of them. And
   because the columns come from a target cell size, the cells stay the
   size they were asked to be no matter how big or small the box is.

   So: to make the falling pieces bigger or smaller, change TARGET_CELL_PX
   and nothing else. Do NOT go back to editing raw grid dimensions — that
   is what made the pieces shrink every time the board grew. */

/* The on-screen size, in CSS pixels, that one cell should come out at.
   Everything else here is derived from it. 40px was picked against the
   measured before/after: at 46 columns the desktop board rendered 24px
   cells and a landscape tablet 7.6px; 40px roughly doubles the desktop
   piece and more than quintuples the tablet one, while still leaving a
   desktop-width box ~29 columns across (i.e. the wide play-field this game
   is built around is kept — it is not being turned into a 10-wide classic
   Tetris except on screens too narrow for anything else). */
var TARGET_CELL_PX = 15;

/* Guard rails on the derived grid, so an unusual window can't produce a
   field that is unplayable rather than merely small.
   COLS_MIN 10 is classic Tetris width — the narrowest a line clear should
   ever ask for. COLS_MAX 30 keeps an ultrawide monitor from turning a line
   into a 40-block ask.
   ROWS_MIN is the interesting one: a short-and-wide window (laptop with
   lots of browser chrome, phone on its side) can ask for as few as 8 rows
   from the aspect ratio alone, and a field that shallow tops out before
   the player can do anything. 14 is the floor on a normal screen; on a
   genuinely tiny board area (landscape phone) 14 rows would force the box
   to go height-bound and narrow, which is worse than a shallow field, so
   the floor drops to 10 there. */
var GRID_COLS_MIN = 10;
/* 40, was 30. The cap exists so a line never needs an absurd number of
   blocks, but it had quietly become the thing DECIDING the cell size on a
   wide screen: at TARGET_CELL_PX 25 a 1152px board asks for 46 columns,
   the cap held it at 30, and the cell came out 38px — the target was being
   ignored and the pieces stayed large no matter how far the target was
   lowered. 40 lets the target be honoured on a desktop while still keeping
   a line inside something a player can plausibly fill. */
var GRID_COLS_MAX = 40;
/* Was 60, raised there specifically to fill a portrait tablet's narrow
   column (~250px) against its full height (~1000-1200px) without
   letterboxing — see the git history for that math. In practice a cap that
   high produces a field like 17x60 or 20x48 on real portrait phones and
   tablets: a sliver-thin column where the falling piece is a handful of
   ~7-8px squares lost at the top of a huge empty shaft ("bilkul nechay ja
   raha hai, blocks dikh hi nahi rahay" — the board runs on forever and the
   piece is too small to read). A filled-but-illegible box is worse than a
   legible one with a little letterboxing, so this is capped back down.
   30 keeps portrait fields close to a classic Tetris aspect (roughly
   1:2-1:3) no matter how tall the column gets — the excess height is left
   as empty space above/below the board (#boardArea centers it) rather than
   being turned into more, smaller rows. */
var GRID_ROWS_MAX = 30;
function gridRowsMin(availH) {
  return availH < 300 ? 10 : 14;
}

function clampInt(v, lo, hi) {
  v = Math.round(v);
  if (!isFinite(v)) v = lo;
  return Math.max(lo, Math.min(hi, v));
}

/* The width and height #boardArea really has for the board, measured with
   the same two overrides fitBoardToViewport() applies before IT measures —
   or this reads the leftovers of the PREVIOUS run's fit instead of the room
   on offer now:
     --game-col-max  is the ad reservation (window-width only, so it is safe
                     to set before anything else has been measured)
     --board-fit-w   is the column pull-in to the LAST board's width, which
                     has to be released or the column only ever gets
                     narrower, run after run.
   Called from showGameScreen() AFTER the game screen is un-hidden, so these
   are real numbers rather than the zeros a display:none subtree returns. */
function measureBoardArea() {
  if (!boardAreaEl || !gameScreen || gameScreen.classList.contains("hidden")) return null;
  /* The stage rectangle is the room the board really has: everything between
     the ad rails / leaderboard, and above the bottom bar. Deriving the grid
     from it (instead of from the flow column) is what makes cols x rows match
     the black box's real aspect, so the box fills that room edge to edge. */
  if (typeof stageRect === "function") {
    var st = stageRect();
    if (st && st.w > 40 && st.h > 40) return { w: st.w, h: st.h };
  }
  var budget = boardWidthBudget();
  gameScreen.style.setProperty(
    "--game-col-max",
    budget === Infinity ? "none" : Math.round(budget) + "px"
  );
  gameScreen.style.setProperty("--board-fit-w", "100%");
  void gameScreen.offsetWidth; // force the reflow so the reads below are real
  var w = Math.min(boardAreaEl.clientWidth, budget);
  var h = boardAreaEl.clientHeight;
  if (!(w > 40) || !(h > 40)) return null;
  return { w: w, h: h };
}

/* Fallback for the (rare) case where the area can't be measured — the same
   arithmetic against an estimate of the window instead. The 250px is the
   chrome above and below the board (header, objective line, the arrows/Next
   row, the hint) plus the wrapper's padding; it only has to be close, since
   fitBoardToViewport() does the exact fitting afterwards either way. */
function estimateBoardArea() {
  var budget = boardWidthBudget();
  var w = Math.min(budget === Infinity ? viewW() : budget, viewW()) - 40;
  var h = viewH() - 250;
  return { w: Math.max(200, w), h: Math.max(200, h) };
}

/* columns x rows for a given area. Split out from applyGridForOrientation()
   so it can be reasoned about (and unit-checked) on its own. */
function gridForArea(availW, availH) {
  var cols = clampInt(availW / TARGET_CELL_PX, GRID_COLS_MIN, GRID_COLS_MAX);
  var rowsMin = gridRowsMin(availH);
  var wantRows = cols * (availH / availW);
  var rows = clampInt(wantRows, rowsMin, GRID_ROWS_MAX);
  /* If the row count had to be clamped, the grid's aspect no longer matches
     the area's — which is exactly the letterboxing this whole function
     exists to avoid. Re-deriving the columns FROM the clamped row count
     restores the match; the cells come out a little off TARGET_CELL_PX as
     the price, which is the right thing to give up (a filled box with
     slightly smaller cells beats a half-empty one with exact cells). */
  if (Math.round(wantRows) !== rows) {
    cols = clampInt(rows * (availW / availH), GRID_COLS_MIN, GRID_COLS_MAX);
  }
  return { cols: cols, rows: rows };
}

/* Decided ONCE per game start, from the room available at that moment — not
   re-decided mid-game on every resize. The grid defines actual gameplay (how
   many blocks make a line, how deep the well is), so it has to stay fixed
   for the length of a run; only fitBoardToViewport()'s CSS-transform scale
   should react to live resizing after that, exactly as it already does.
   Rotating the device mid-game keeps the grid it started with, just
   rescaled — the same as any other window resize. */
function applyGridForOrientation() {
  var area = measureBoardArea() || estimateBoardArea();
  /* Through quantiseArea() for the same reason regridToViewport() uses it:
     if the two derived their grids from differently-rounded numbers, the
     board a game starts with and the board a resize settles on would not
     match for the same window, and the first resize would rebuild the field
     for no reason. */
  var q = quantiseArea(area);
  var g = gridForArea(q.w, q.h);

  tetris.canvasWidth = g.cols * tetris.pSize;
  tetris.canvasHeight = g.rows * tetris.pSize;

  /* #canvas's CSS width/height is the "natural" pre-transform size that
     fitBoardToViewport() measures — it has to match tetris.canvasWidth /
     canvasHeight exactly or the 20px grid lines and the squares stop
     agreeing about where the pieces are (see the note on #canvas in
     style.css). The stylesheet's own value is only a pre-JS fallback for the
     very first paint; this sets the real one every time. */
  var canvasEl = document.getElementById("canvas");
  if (canvasEl) {
    canvasEl.style.width = tetris.canvasWidth + "px";
    canvasEl.style.height = tetris.canvasHeight + "px";
  }
}

/* ===== Re-deriving the grid on a window change =====

   applyGridForOrientation() above runs ONCE, at game start. For a long time
   that was the whole story, and the comment above it said so proudly: the
   grid defines gameplay, so freezing it for the length of a run keeps a
   resize from changing the rules underneath the player.

   Freezing it also produced the single worst-looking bug in this layout, and
   it took a screenshot to spot because it never reproduces on a window that
   sits still. Start a game on a small phone viewport, then switch the device
   size (which is exactly what anyone testing responsiveness does, and what a
   real player does by rotating): the board keeps the grid it was born with,
   so its aspect no longer matches the room it is in, and it letterboxes —
   a short, wide black box stranded in the middle of a tall column with 150px
   of dead space above and below it.

   It broke the ads at the same time, for the same reason and less
   obviously. fitSideRailsToViewport() decides whether a gutter card fits by
   measuring the widest the BOARD could get; a board frozen at a wide grid
   claims width it no longer deserves, the leftover gutter measures too
   narrow, and both cards are hidden. "Tablet par dono side ad nahi aa raha"
   and "black box ki height nahi barhi" were one bug wearing two hats.

   So the grid is re-derived when the room changes shape enough to matter,
   and the field is remapped underneath it (see remapField). The original
   concern is still respected — the rules do not shift under a player who
   isn't resizing anything — via the fill test below: a grid that still fills
   at least REGRID_FILL_TOLERANCE of the area in both directions is left
   completely alone.

   ----- Why the bar is where it is -----
   It was 0.9, and 0.9 was too eager. Remapping is not free: columns that
   fall outside the new field are DISCARDED, so every rebuild costs the
   player part of their stack. At 0.9 an ordinary change of window — 1150
   wide to 1024 and back, which is what anyone comparing screen sizes does —
   rebuilt the field twice, and the board that came back was not the board
   that left. That is the "screen change karne par sab change ho jata hai"
   report: not a placement bug, the field being rebuilt under the stack.

   ----- Two wrong answers, and the one in between -----
   The bar was 0.9, then briefly "only on an orientation flip", and that
   second version was the worse mistake, so it is worth recording what it
   broke. Freezing the grid for the length of a run does stop the field
   being rebuilt under the player — but it makes the LAYOUT depend on where
   the run started instead of on the screen it is being viewed on. Measured
   at 1150x765, all three of these were the same window:

     started at 1150x765  ->  734x678, grid 39x36
     started at 1920x1080 ->  737x626, grid 40x34
     started at 1024x768  ->  602x678, grid 32x36

   One viewport, three different boards, two of them not filling the column.
   That is "screen change karne par sab sizes increase decrease ho rahe hain"
   — the sizes were not wobbling, they were carrying history. A given screen
   has to produce a given board, every time, whatever route got you there.

   ----- Why "rebuild when it stops fitting" was still not deterministic ---
   The fill test was the last piece of history left in here, and it is the
   one that survived the previous fix. The rule was "rebuild only if the
   CURRENT grid now fills less than 90% of the area", which means the grid
   you end up with depends on the grid you arrived with. Land on 1150x765
   carrying a grid that happens to fill 95% of it and nothing rebuilds — you
   keep a grid that is not the one 1150x765 would have produced on its own.
   Every intermediate size while dragging a window is one more chance to get
   stuck on a near-enough grid, which is why "mobile pe jaake wapas tablet pe
   aane se size badal jata hai" kept happening after the orientation fix.

   So there is no comparison against the old grid at all now. The grid is
   computed from the area and applied if it differs, full stop — a pure
   function of the room available, and the room is a pure function of the
   window. Same screen, same board, by construction rather than by luck.

   What replaces the fill tolerance's job (not disturbing a game over a
   phone's address bar sliding away) is QUANTISATION: the area is rounded to
   GRID_AREA_STEP before the grid is derived, so small wobbles land in the
   same bucket and produce the same grid. It is a weaker guarantee than the
   old tolerance and deliberately so — a big enough chrome change is a real
   change of room and now behaves like one. applyGridForOrientation() rounds
   through the same function, so the grid a game STARTS with and the grid a
   resize arrives at are the same grid for the same window. */
var GRID_AREA_STEP = 24;

function quantiseArea(area) {
  return {
    w: Math.round(area.w / GRID_AREA_STEP) * GRID_AREA_STEP,
    h: Math.round(area.h / GRID_AREA_STEP) * GRID_AREA_STEP
  };
}

/* True only for the instant between showGameScreen() starting a run and
   tetris.init() building that run's field (see showGameScreen). */
var startingNewRun = false;

function regridToViewport() {
  if (!isPlaying || !tetris.canvas) return false;
  /* While a new run is being set up, the field still holds the PREVIOUS
     run's stack — on Retry after a Game Over that is the dead stack that
     ended the game. Remapping it into a grid of a different shape (a turn
     from portrait to landscape makes the field shorter: 16x30 -> 34x21)
     pushed it up to the spawn row, remapField() called gameOver(), and the
     Game Over popup reopened over the freshly restarted level. That field
     is about to be thrown away and rebuilt by applyGridForOrientation() +
     tetris.init(), so there is nothing here to remap. */
  if (startingNewRun) return false;
  if (!tetris.boardWidth || !tetris.boardHeight) return false;

  var area = measureBoardArea();
  if (!area) return false;

  var q = quantiseArea(area);
  var g = gridForArea(q.w, q.h);
  if (g.cols === tetris.boardWidth && g.rows === tetris.boardHeight) return false;

  remapField(g.cols, g.rows);
  return true;
}

/* Rebuilds the field at a new column/row count WITHOUT throwing the player's
   stack away.
   Two anchors decide where the old contents land:
     - horizontally CENTRED (dx), because a stack that jumped to one edge on
       every resize would read as the game losing track of it;
     - vertically anchored to the FLOOR (dy = nh - oh), because that is the
       only edge the stack is actually attached to. Anchoring to the top
       instead would leave it hanging in mid-air over a new gap.
   Anything that falls outside the new field is discarded — unavoidable when
   the field gets narrower, and the honest behaviour: a block that has no
   column to live in cannot be kept.
   The piece still in the air is not remapped at all, just re-spawned. It has
   no stack relationship to preserve, and re-spawning sidesteps every
   half-off-the-edge and mid-rotation case for free. */
function remapField(nw, nh) {
  var t = tetris;
  var ow = t.boardWidth;
  var oh = t.boardHeight;
  var dx = Math.floor((nw - ow) / 2);
  var dy = nh - oh;

  /* Stop the clock BEFORE touching anything, and clear the landed flag.
     This is not belt-and-braces — without it the remap loses a race with
     gameLoop() and ends the run. The window: a piece touches down, the loop
     sets curComplete, and its next tick commits that piece by calling
     markBoardShape(curX, curY, curShape). If a resize lands inside that
     window, the remap has already moved curX/curY to the SPAWN position, so
     the loop dutifully stamps the landed piece into the top row instead of
     where it actually came to rest — and the very next initShapes() spawns
     into those cells, finds them occupied and calls game over. It shows up
     as "the game ends when I resize", with a stack nowhere near the top.
     Pausing closes the window; resetting curComplete makes sure the piece
     the remap re-spawns starts out as falling, not as already landed. */
  var wasActive = t.isActive === 1;
  if (wasActive) t.pause();
  t.curComplete = false;

  t.removeCur();

  var newBoard = [];
  for (var i = 0; i < nw * nh; i++) newBoard.push(0);

  var kept = [];
  for (var k = 0; k < t.sqs.length; k++) {
    var sq = t.sqs[k];
    var x = parseInt(sq.style.left, 10) / t.pSize + dx;
    var y = parseInt(sq.style.top, 10) / t.pSize + dy;
    if (x < 0 || x >= nw || y < 0 || y >= nh) {
      if (sq.parentNode) sq.parentNode.removeChild(sq);
      continue;
    }
    sq.style.left = x * t.pSize + "px";
    sq.style.top = y * t.pSize + "px";
    newBoard[x + y * nw] = 1;
    kept.push(sq);
  }

  t.sqs = kept;
  t.board = newBoard;
  t.boardWidth = nw;
  t.boardHeight = nh;
  t.canvasWidth = nw * t.pSize;
  t.canvasHeight = nh * t.pSize;
  t.spawnX = Math.max(1, Math.floor(nw / 2) - 2);

  var canvasEl = document.getElementById("canvas");
  if (canvasEl) {
    canvasEl.style.width = t.canvasWidth + "px";
    canvasEl.style.height = t.canvasHeight + "px";
  }

  if (!t.curShape) return;
  t.setCurCoords(t.spawnX, t.spawnY);
  if (t.isCollision(t.curX, t.curY, t.curShape)) {
    /* The stack now reaches the spawn row — the same condition initShapes()
       treats as the end of the run, so it is treated the same way here. */
    t.gameOver();
    return;
  }
  t.drawShape(t.curX, t.curY, t.curShape);
  if (wasActive) t.play();
}
function showGameScreen() {
  hideAllScreens();
  gameScreen.classList.remove("hidden");
  gameScreen.classList.add("pm-active"); // Pac-Man's #gameScreen.active hook for the stats rules
  levelBadgeGame.textContent = levelBadgeLabel(chosenStartLevel);
  isPlaying = true;
  // Fresh run: the ad continue, the free new-game, the free ad power-up and
  // the one-per-entry restart ad are all available again. restartAdUsedThisRun
  // is reset here unconditionally, same as Pac-Man's startLevel() — the
  // restart click handler itself is the one place that re-sets it right back
  // to true immediately after, for that one entry only (see restartBtn below).
  restartAdUsedThisRun = false;
  if (restartBtn) restartBtn.disabled = false;
  refreshContinueButton();
  /* Settle the header/stats rows before the grid is measured — same reason
     as in refitAfterViewportChange(): #boardArea's height depends on how
     tall the header ended up, and that isn't decided until a fit pass runs.
     Without this the FIRST game of a session derives its grid from the
     chrome heights the screen had while it was hidden. */
  startingNewRun = true;
  try {
    if (typeof fitEverything === "function") fitEverything();
  } finally {
    startingNewRun = false;
  }
  applyGridForOrientation();
  tetris.init(chosenStartLevel);
  /* After init: Prev/Next are judged against the level just loaded. They used
     to be judged before it, i.e. against the PREVIOUS level. */
  updateLevelNavButtons();
  updateCoinDisplays();
  if (typeof fitEverything === "function") {
    fitEverything();
    /* Again next frame. This call happens in the same tick the game screen is
       revealed, so the header's widths are still whatever they were while it
       was hidden — and the merge decision is measured from those widths.
       One frame later the row has really been laid out. */
    requestAnimationFrame(function () {
      fitEverything();
      /* One self-correction, here only — never on a resize (regridToViewport()
         mid-run would throw stack blocks away, see its own comment). A game
         that loads ALREADY in its final shape (landscape from the first
         paint, e.g. opened directly on a sideways device/BrowserStack) never
         fires a resize or an orientationchange — those are the only other
         places a regrid gets triggered — so applyGridForOrientation()'s one
         measurement above is the only chance the grid gets. That measurement
         runs before THIS frame's layout (fonts swapping in, the header's
         merge state) has necessarily finished settling, and a grid derived
         from a slightly-off area is exactly what letterboxes: the board
         locks to an aspect that doesn't match the room it actually ends up
         with, and nothing else was ever going to notice, because nothing
         else re-checks it on a screen that never resizes again. The field is
         still empty at this point (right after tetris.init(), before the
         first piece has landed anywhere), so re-deriving it here costs
         nothing a player would notice. */
      if (typeof regridToViewport === "function" && regridToViewport()) {
        fitEverything();
      }
      /* One frame is enough on a warm desktop repaint, but not always on a
         real phone: web fonts swapping in, the ad rail images decoding and
         the mobile browser's own address-bar chrome settling can all still
         be in flight this soon after the game screen first appears. That is
         exactly the gap an orientationchange closes -- rotating away and
         back runs this same fit+regrid pair again, later, after everything
         has actually settled, which is why "rotate karke wapis portrait pe
         aana" fixes stats/black-box sizing that looked wrong on the very
         first portrait load. Re-running it here, on the same delay
         refitAfterViewportChange() already trusts for a viewport change,
         gives the first load that same second chance automatically instead
         of requiring an actual rotation to get it. */
      setTimeout(function () {
        if (!isPlaying || gameScreen.classList.contains("hidden")) return;
        fitEverything();
        if (typeof regridToViewport === "function" && regridToViewport()) {
          fitEverything();
        }
      }, 250);
    });
  }
  loadBannerAd();
}

/* ---------- In-game Prev / Restart / Next (v96) ----------------------------
   Pac-Man's game screen keeps Prev/Restart/Next live in the control bar the
   whole time a level is being played, not just on the Level Complete popup —
   this gives Tetris the same three. Restart plays a single rewarded "restart"
   ad (placement already defined in AD_UNITS, just never wired to anything
   before now) once per level-entry. Prev/Next reuse the exact rule Select
   Level's tiles already enforce — isLevelUnlocked()/isLevelAdUnlockable()
   — via goToLevelGated(), so jumping levels from mid-game can never bypass the
   5-ads recover gate a locked, post-reset level would otherwise require. */
function updateLevelNavButtons() {
  if (!tetris) return;
  var lvl = tetris.level;
  function reachable(target) {
    return target >= 1 && target <= TOTAL_LEVELS &&
      (isLevelUnlocked(target) || isLevelAdUnlockable(target));
  }
  if (prevLevelBtn) prevLevelBtn.disabled = !reachable(lvl - 1);
  if (nextLevelBtn) nextLevelBtn.disabled = !reachable(lvl + 1);
}

/* Same ads gate as Level Select, for every way of jumping to a specific level
   (in-game Prev / Next, the Congratulations popup's Previous): unlocked -> go
   straight there; locked but ad-unlockable (the exact rule Select Level's tiles
   use) -> the same "watch 5 ads" confirm; locked and not ad-unlockable ->
   no-op. Routing them all through here is what stops a level being reached for
   free by a side door. opts.onConfirm runs only once the player commits to the
   ads, so backing out of the dialog leaves whatever popup called it untouched. */
function goToLevelGated(level, opts) {
  opts = opts || {};
  var unlockable = level >= 1 && level <= TOTAL_LEVELS && !levelUnlockInProgress;
  if (unlockable && isLevelUnlocked(level)) {
    if (opts.onGo) opts.onGo();
    chosenStartLevel = level;
    showGameScreen();
  } else if (unlockable && isLevelAdUnlockable(level)) {
    showUnlockConfirm(level, opts);
  } else if (opts.onCancel) {
    opts.onCancel();
  }
}

/* In-game Prev / Next. The board is frozen while the "watch 5 ads" dialog
   (and then the ads) is up -- it used to keep dropping pieces behind it --
   and carries on if the player cancels. */
function goToLevelFromGame(level) {
  if (adIsPlaying || !isPlaying) return;
  SFX.uiClick();
  var wasRunning = tetris.isActive === 1;
  if (wasRunning) tetris.pause();
  goToLevelGated(level, {
    onCancel: function () {
      if (wasRunning && isPlaying && !gamePaused && !adIsPlaying) tetris.resume();
    }
  });
}

if (prevLevelBtn) {
  prevLevelBtn.addEventListener("click", function () { goToLevelFromGame(tetris.level - 1); });
}
if (nextLevelBtn) {
  nextLevelBtn.addEventListener("click", function () { goToLevelFromGame(tetris.level + 1); });
}

if (restartBtn) {
  restartBtn.addEventListener("click", function () {
    if (adIsPlaying || !isPlaying) return;
    if (restartAdUsedThisRun) return; // one per level-entry, see the flag's own comment
    restartBtn.disabled = true; // no double-clicks while the ad is up
    tetris.pause(); // the board must not keep playing underneath the ad
    var levelToRestart = tetris.level;
    playVideoAd({
      placement: "restart",
      rewardText: "Watch the ad to restart this level."
    }).then(function () {
      chosenStartLevel = levelToRestart;
      showGameScreen();
      // showGameScreen() just reset the flag to false for this fresh entry —
      // reasserted here so THIS particular entry, the restart itself, is the
      // one exception to that.
      restartAdUsedThisRun = true;
      restartBtn.disabled = true;
    });
  });
}

/* Side cards come DOWN while the result dialog is up, and go back when it
   closes. The dialog is a moment where the player has stopped and is being
   asked to choose — a pair of gutter cards flanking it competes with that,
   and the dialog carries its own MREC anyway, so the two placements were
   stacking on one screen.
   Toggled by class rather than by re-running the fit, so nothing has to be
   recomputed and the rails come back at exactly the size they left. */
function setRailsHiddenForOverlay(hidden) {
  var rails = document.querySelectorAll(".ad-rail");
  for (var i = 0; i < rails.length; i++) {
    rails[i].classList.toggle("rails-hidden-for-overlay", !!hidden);
  }
}

/* Pac-Man's handleGameOver(), step for step: the game-over sound has
   already played (tetris.gameOver), then after the same 150ms beat the popup
   is filled in and shown. The side ad cards are NOT taken down — Pac-Man
   leaves them up, dimmed under the popup's backdrop, and so does this. */
var gameOverTimer = null;
function showGameOver() {
  setPaused(false, true);
  clearTimeout(gameOverTimer);
  gameOverTimer = setTimeout(function () {
    gameOverTimer = null;
    if (gameScreen.classList.contains("hidden")) return; // left the game in the meantime
    overlayMode = "gameover";
    // Same dialog as Congratulations: its coins line, MREC and Previous are
    // not part of Game Over, and the MREC's rotation stops here (Pac-Man).
    if (modalCoinsEl) modalCoinsEl.classList.add("hidden");
    if (typeof hideLevelCompleteBannerAd === "function") hideLevelCompleteBannerAd();
    setModalPrevLevel(0);
    resultTitle.textContent = "Game Over \u{1F480}";
    resultSubtitle.textContent = "You scored " + tetris.score + " on Level " + tetris.level + ". Try again?";
    playAgainBtn.textContent = "\u{1F501} Retry Level";
    changeLevelFromResultBtn.textContent = "\u{1F5FA} Level Select";
    refreshContinueButton();
    resultOverlay.classList.remove("hidden");
  }, 150);
}

/* ---------- Congratulations: Pac-Man's handleLevelWin(), step for step ----------
   The level-up sound has already played (checkLevel), then after the same
   150ms beat the SAME #overlay popup as Game Over opens, filled in the way
   Pac-Man fills it:
     "🎉 Congratulations!"
     "Level N cleared with a score of X. Level N+1 is now unlocked."
       (after the last level: "You finished all 35 levels with a score of X!")
     "+N 🪙 coins"
     the 300x250 MREC, rotating every 5s while the popup is open
     ONE row: "Next Level ➡" · "⬅ Level N" (from level 2 up) · "🗺 Levels"
       (after the last level the first button is "🗺 Levels" too)
   The side ad cards stay up, dimmed under the backdrop, as in Pac-Man.
   Everything Tetris works out on a clear — coins and their bonuses, the
   star rating, the unlock — is unchanged (checkLevel). */
var levelCompleteTimer = null;
function showLevelComplete() {
  var justCleared = tetris.lastCompletedLevel || tetris.level - 1;
  var reward = tetris.lastLevelReward || { total: 0 };
  var isLast = justCleared >= TOTAL_LEVELS;
  lastClearedLevel = justCleared;
  clearTimeout(levelCompleteTimer);
  levelCompleteTimer = setTimeout(function () {
    levelCompleteTimer = null;
    if (gameScreen.classList.contains("hidden")) return; // left the game in the meantime
    overlayMode = "win";
    resultTitle.textContent = "\u{1F389} Congratulations!";
    resultSubtitle.textContent = isLast
      ? "You finished all " + TOTAL_LEVELS + " levels with a score of " + tetris.score + "!"
      : "Level " + justCleared + " cleared with a score of " + tetris.score + ". Level " + (justCleared + 1) + " is now unlocked.";
    if (modalCoinsEl) {
      modalCoinsEl.textContent = "+" + reward.total + " \u{1FA99} coins";
      modalCoinsEl.classList.remove("hidden");
    }
    if (continueAdBtn) continueAdBtn.classList.add("hidden");
    if (continueNote) continueNote.classList.add("hidden");
    if (typeof loadLevelCompleteBannerAd === "function") loadLevelCompleteBannerAd();
    /* Short labels: Pac-Man lays these out in ONE row under the 300px MREC. */
    playAgainBtn.textContent = isLast ? "\u{1F5FA} Levels" : "Next Level \u27A1";
    playAgainBtn.disabled = false;
    changeLevelFromResultBtn.textContent = "\u{1F5FA} Levels";
    setModalPrevLevel(justCleared > 1 ? justCleared - 1 : 0);
    resultOverlay.classList.remove("hidden");
    updateCoinDisplays();
  }, 150);
}

/* Pac-Man's setModalPrevLevel(): the Previous button is off by default and
   switched on only by the Congratulations popup, labelled with the level it
   goes to. It goes through the same ads gate as Select Level. */
function setModalPrevLevel(level) {
  if (!modalPrevBtn) return;
  if (!level || level < 1) {
    modalPrevBtn.classList.add("hidden");
    modalPrevBtn.dataset.level = "";
    return;
  }
  modalPrevBtn.textContent = "\u2B05 Level " + level;
  modalPrevBtn.dataset.level = String(level);
  modalPrevBtn.classList.remove("hidden");
}

function closeResultOverlay() {
  clearTimeout(levelCompleteTimer);
  levelCompleteTimer = null;
  resultOverlay.classList.add("hidden");
  setRailsHiddenForOverlay(false);
  if (typeof hideLevelCompleteBannerAd === "function") hideLevelCompleteBannerAd();
}

/* ---------- Pause ----------
   Pac-Man's pause, same to same: NO popup. The board stays on screen,
   frozen, and the Pause button itself turns into a yellow "▶ Resume"
   (.is-paused) — press it again (or Esc / P) to carry on exactly where the
   piece was. Leaving the game screen always clears it (hideAllScreens). */
var gamePaused = false;

function setPaused(next, silent) {
  gamePaused = !!next;
  if (pauseBtn) {
    /* Icon and word in separate spans so the narrow bar tiers can hide the
       word and keep the icon — identical to Pac-Man's setPaused(). */
    pauseBtn.innerHTML = gamePaused
      ? '<span class="ico">\u25B6</span><span class="lbl">Resume</span>'
      : '<span class="ico">\u23F8</span><span class="lbl">Pause</span>';
    pauseBtn.setAttribute("aria-pressed", String(gamePaused));
    pauseBtn.setAttribute("title", gamePaused ? "Resume" : "Pause");
    pauseBtn.setAttribute("aria-label", gamePaused ? "Resume" : "Pause");
    pauseBtn.classList.toggle("is-paused", gamePaused);
  }
  if (silent) return; // flag + button only; the game loop is left alone
  if (gamePaused) {
    tetris.pause();
  } else if (isPlaying && !gameScreen.classList.contains("hidden")) {
    tetris.resume();
  }
}

function togglePause() {
  if (!isPlaying || adIsPlaying) return;
  if (!resultOverlay.classList.contains("hidden")) return;
  /* Nothing to pause between a cleared level and its popup (or behind any
     other dialog): the drop loop is already stopped there. Toggling anyway
     used to restart the loop behind the Congratulations popup. */
  if (!gamePaused && tetris.isActive !== 1) return;
  setPaused(!gamePaused);
}

/* ---------- How to play screen ----------
   A full screen now, same as Pac-Man — not a popup. It can be opened from
   the start screen's tile or the level list's "?", and closing it (the ×
   or "Got it") should go back to whichever one it was opened from, not
   always to the start screen. Same howToReturnScreen pattern Pac-Man's
   openHowToPlay(from)/back-btn pair uses. */
var howToReturnScreen = "start";
function openHowToPlay(from) {
  howToReturnScreen = from || "start";
  isPlaying = false;
  tetris.clearTimers();
  hideAllScreens();
  howToPlayScreen.classList.remove("hidden");
}
function closeHowToPlay() {
  if (howToReturnScreen === "level") {
    showLevelScreen();
  } else {
    showStartScreen();
  }
}

/* ---------- Event bindings ---------- */
/* Play picks up where the player left off — at the highest level they have
   unlocked, not back at level 1. Unlocking a level is what earns the right to
   start there, so sending Play to level 1 every time made that pointless and
   forced a detour through Select Level. Select Level is still there for
   choosing any earlier one. */
playBtn.addEventListener("click", function () {
  chosenStartLevel = Math.min(TOTAL_LEVELS, Math.max(1, getUnlockedLevel()));  // contiguous progress, never an out-of-order ads level
  showGameScreen();
});
selectLevelBtn.addEventListener("click", showLevelScreen);
backToStartBtn.addEventListener("click", showStartScreen);
shopBtn.addEventListener("click", showShopScreen);

backToStartFromShopBtn.addEventListener("click", showStartScreen);

pauseBtn.addEventListener("click", togglePause);
exitBtn.addEventListener("click", function () {
  showStartScreen();
});

playAgainBtn.addEventListener("click", function () {
  if (overlayMode === "win") { onCongratulationsNext(); return; }
  resultOverlay.classList.add("hidden");
  setRailsHiddenForOverlay(false);
  /* Pac-Man's Retry Level is startLevel(currentLevel): the level the run was
     lost on, not the one the run was started from. */
  if (tetris && tetris.level) chosenStartLevel = Math.min(TOTAL_LEVELS, Math.max(1, tetris.level));
  showGameScreen();
});
changeLevelFromResultBtn.addEventListener("click", function () {
  resultOverlay.classList.add("hidden");
  setRailsHiddenForOverlay(false);
  showLevelScreen();
});
resultCloseBtn.addEventListener("click", function () {
  resultOverlay.classList.add("hidden");
  setRailsHiddenForOverlay(false);
  showLevelScreen();
});

/* Congratulations' first button — Pac-Man: Next Level (after a level that is
   an ad gate, the "level_complete" video plays first), or "🗺 Levels" after
   the last level. Next Level carries the run on into the next level exactly
   as Tetris always has (board cleared, same run), rather than a fresh start. */
function onCongratulationsNext() {
  var clearedLevel = lastClearedLevel || tetris.lastCompletedLevel || tetris.level - 1;
  if (clearedLevel >= TOTAL_LEVELS) {
    closeResultOverlay();
    showLevelScreen();
    return;
  }

  function proceedToNextLevel() {
    closeResultOverlay();
    tetris.clearBoardForNextLevel();
    tetris.initShapes();
    isPlaying = true;
    tetris.isActive = 1;
    tetris.play();
    // A new level-entry, same as showGameScreen() — the restart ad and the
    // Prev/Next disabled states both belong to the level just entered, not
    // the one just cleared. The continue is per attempt, too (Pac-Man's
    // startLevel resets it).
    restartAdUsedThisRun = false;
    if (restartBtn) restartBtn.disabled = false;
    updateLevelNavButtons();
    loadBannerAd();
  }

  if (isAdGateLevel(clearedLevel)) {
    // Pac-Man: the popup stays up behind the ad and goes when the next
    // level starts.
    playAgainBtn.disabled = true;
    playVideoAd({
      placement: "level_complete",
      rewardText: "Level " + clearedLevel + " cleared \u2014 your reward is next!"
    }).then(function () {
      playAgainBtn.disabled = false;
      proceedToNextLevel();
    });
  } else {
    proceedToNextLevel();
  }
}

/* "⬅ Level N" — the level before the one just cleared, through the same ads
   gate as Select Level (goToLevelGated). The popup is closed only once the
   player actually goes (or commits to the ads) — cancelling the 5-ads dialog
   leaves it exactly as it was. */
if (modalPrevBtn) {
  modalPrevBtn.addEventListener("click", function () {
    var level = Number(modalPrevBtn.dataset.level) || 0;
    if (!level) return;
    goToLevelGated(level, {
      onGo: closeResultOverlay,
      onConfirm: closeResultOverlay
    });
  });
}

document.getElementById("howToPlayBtnStart").addEventListener("click", function () {
  SFX.uiClick();
  openHowToPlay("start");
});
document.getElementById("howToPlayBtnLevel").addEventListener("click", function () {
  SFX.uiClick();
  openHowToPlay("level");
});
/* howToPlayBtnGame was removed from the in-game header (the user asked for
   the "?" button gone from here) — How to Play is still reachable from the
   start screen and the level list, just not mid-game any more. */
howToPlayClose.addEventListener("click", function () {
  SFX.uiClick();
  closeHowToPlay();
});
/* The "Got it" button at the foot of the list does exactly what the × in
   the corner does — it is just the one that is still on screen once you
   have scrolled to the end of the instructions. */
var howToPlayGotIt = document.getElementById("howToPlayGotIt");
if (howToPlayGotIt) {
  howToPlayGotIt.addEventListener("click", function () {
    SFX.uiClick();
    closeHowToPlay();
  });
}

/* ---------- Touch / on-screen controls ---------- */
function padMove(dir) {
  if (!isPlaying || tetris.isActive !== 1) return;
  tetris.move(dir);
  if (dir === "L" || dir === "R" || dir === "D") SFX.move();
  if (dir === "RT") SFX.rotate();
}
btnLeft.addEventListener("click", function () { padMove("L"); });
btnRight.addEventListener("click", function () { padMove("R"); });
btnDown.addEventListener("click", function () { padMove("D"); });
btnRotate.addEventListener("click", function () { padMove("RT"); });

/* ---------- Initial setup ---------- */
applySkin(getOwnedSkins().selected);
updateCoinDisplays();

/* Every sound toggle on the page, not one. There are two now — the menu
   corner and the in-game header — and they must never disagree: muting from
   the game and then going back to the menu has to show a muted icon there
   too, or the player is looking at a control that is lying about the state
   it reports. Collecting them into a list means adding a third anywhere
   costs nothing. */
var soundToggleBtns = [
  document.getElementById("soundToggleBtn"),
  document.getElementById("soundToggleBtnGame")
].filter(Boolean);

function refreshSoundIcon() {
  var on = SFX.isEnabled();
  soundToggleBtns.forEach(function (btn) {
    btn.innerHTML = on ? "&#128266;" : "&#128263;";
    btn.classList.toggle("muted", !on);
    btn.setAttribute("aria-pressed", on ? "false" : "true");
  });
}

refreshSoundIcon();
soundToggleBtns.forEach(function (btn) {
  btn.addEventListener("click", function () {
    SFX.toggle();
    refreshSoundIcon();
    if (SFX.isEnabled()) SFX.uiClick();
  });
});

/* ===================== Session watcher =====================
   Keeps the 24-hour window honest even if the tab stays open for days:
   checks on a timer, on tab focus, and whenever the page becomes visible. */
/* Same order and branches as Pac-Man's checkSession(): re-apply cosmetics
   and coins, then ONLY if a level was in progress drop back to the menu;
   Select Level / Shop just redraw in place. Then the 24-hour popup. */
function handleSessionExpired() {
  chosenStartLevel = 1;
  applySkin(getOwnedSkins().selected);
  updateCoinDisplays();
  // If a level was in progress, drop back to the menu with a fresh start.
  if (!gameScreen.classList.contains("hidden")) {
    isPlaying = false;
    try {
      tetris.clearTimers();
    } catch (e) {}
    closeAdOverlay();
    closeRecoverModal();
    showStartScreen();
  }
  if (!levelScreen.classList.contains("hidden")) buildLevelGrid();
  if (!shopScreen.classList.contains("hidden")) renderShopTab(activeShopTab);
  showSessionOverToast();
}

/* The 24-hour popup -- Pac-Man's showSessionToast(), same to same: its own
   .session-toast pill (not the shared #toast), created on first use and
   appended to <body>, same text, shown for 3200ms. Shown both when the reset
   happens while the game is open and when it happened while it was closed. */
var sessionToastEl = null;
function showSessionOverToast() {
  if (!sessionToastEl) {
    sessionToastEl = document.createElement("div");
    sessionToastEl.className = "session-toast";
    document.body.appendChild(sessionToastEl);
  }
  sessionToastEl.textContent = "\u23F0 24-hour session over \u2014 progress reset, starting fresh";
  sessionToastEl.classList.add("show");
  clearTimeout(sessionToastEl._hideTimer);
  sessionToastEl._hideTimer = setTimeout(function () { sessionToastEl.classList.remove("show"); }, 3200);
}

function sessionTick() {
  if (checkSessionReset()) handleSessionExpired();
}

if (sessionResetOnLoad) {
  sessionResetOnLoad = false;
  showSessionOverToast();
}
setInterval(sessionTick, 30000);
window.addEventListener("focus", sessionTick);
document.addEventListener("visibilitychange", function () {
  if (!document.hidden) sessionTick();
});

/* Auto-pause when the tab / app goes to the background — Pac-Man's
   visibilitychange rule. Without it the drop loop kept running (throttled)
   while the player was in another app, so they came back to pieces that had
   fallen and locked unseen, or to a Game Over they never played. Only a live,
   unpaused level is paused; a popup, an ad, or a board that is already
   paused is left exactly as it was. The player resumes with the Pause button
   (or Esc / P), same as any other pause. */
function pauseWhenHidden() {
  if (!document.hidden) return;
  if (!isPlaying || adIsPlaying || gamePaused) return;
  if (tetris.isActive !== 1) return;
  if (gameScreen.classList.contains("hidden")) return;
  setPaused(true);
}
document.addEventListener("visibilitychange", pauseWhenHidden);
window.addEventListener("pagehide", function () {
  // iOS can skip visibilitychange when the app is swiped away.
  if (isPlaying && !adIsPlaying && !gamePaused && tetris.isActive === 1) setPaused(true);
});

/* ===================== Viewport lock / board auto-fit =====================
   The page itself never scrolls, so the board group is scaled down to
   whatever space is left between the header and the bottom of the screen. */
/* Cap raised above 1: the side ads are a fixed 300x600 card and no longer
   swallow the whole gutter, so wide screens have genuine room left over —
   the board grows into it instead of leaving it blank. Shared, because the
   side-card fitter uses it to work out the board's widest possible size. */
/* Raised from 2.4. The board is normally limited by the HEIGHT it has, so
   this cap only bites on short-and-wide windows — where it was holding the
   black box narrower than the room beside it actually allowed. */
var MAX_BOARD_SCALE = 3.2;

var boardAreaEl = document.getElementById("boardArea");
var tetrisEl = document.getElementById("tetris");

/* How wide the board is allowed to get.
   The two 300x600 gutter cards are shown at their true size or not at all, so
   on a window with room for them the BOARD has to yield, not the ads —
   otherwise a wider play-field quietly squeezes them out and the game falls
   back to the small card under the board.
   This is deliberately a function of the window width alone: it does not look
   at whether the ads are currently on screen, so the board and the ads can
   never end up chasing each other's measurements. */
/* Raised from 330 to 470. 330 was set when this only had to leave room for
   the BOARD; but the same budget also decides the header column, and the
   header has to fit the level badge, four stat pills and Pause/?/x on ONE
   line. A measured sweep of every width from 320 to 1920 showed the ad
   layout picking the largest card scale that still cleared 330 — which at
   ~920-1040px left the header only 135-175px for the pills, forcing the
   text down to ~0.45rem to stay on one line. That is the "stats adhay dikh
   nahi rahay" case: technically one line, far too small to read.
   470 is the measured figure at which the pills clear a readable size at
   every width in that sweep. The ads do not disappear — they scale down one
   step further in that band, which costs them a little width and buys the
   header the room it needs. */
var BOARD_MIN_W_WITH_RAILS = 200; // below this the board wins and the ads go.
                                    // 380 -> 200, matching OrbitMaze's
                                    // RAIL_MIN_BOARD_W: the board may get
                                    // small, but the ad keeps its size.
                                    // Was 470, then briefly tried 400 and reverted after
                                    // a sweep showed 0.01rem stats — but that sweep had a
                                    // bug: it used a FIXED height=800 while sweeping width
                                    // down to 320px, so anything under 800px width was
                                    // actually testing PORTRAIT mode (crossed at width=
                                    // height), not landscape, and the merge/split math
                                    // this constant governs doesn't apply there at all. A
                                    // corrected sweep (height scaled to stay landscape at
                                    // every width) shows the true worst case stays at the
                                    // intended 0.65rem floor all the way down to 420, and
                                    // is actually BETTER (0.70rem) at 380-400. Lowered to
                                    // let more landscape tablet widths qualify for the ad.

/* false = the gutter cards are ONLY ever drawn at exactly 300x600, and are
           left out entirely on a window that cannot take that box.
   true  = the same card is allowed to scale down proportionally (still 1:2,
           never cropped) so it shows on short windows too.

   Default true, because on a lot of real laptops a true 300x600 simply
   cannot fit and the slot would sit empty forever.
   The consequence, so it isn't a surprise: a 300x600 needs 610px of BROWSER
   viewport height — not screen height. Tabs, address bar and bookmarks take
   100-200px, so a 1366x768 laptop often gives the page only ~560px and the
   cards will correctly stay out. Run adCheck() in the console to see the
   viewport the page is actually getting. */
/* Matched to OrbitMaze. The card is BUILT at 300x600 and, where a window
   cannot take it whole, the same card is scaled down as one piece — still
   exactly 1:2, never cropped, never stretched. Size is tried before count at
   every step of the ladder, so a window that can hold ONE full-size card
   never gets TWO smaller ones instead. */
var RAIL_ALLOW_SCALE_DOWN = true;

/* Two ways of sharing the width with the gutter cards: the roomy one, and a
   squeezed one used only when the roomy one would leave the board too small.
   Having the squeezed fallback matters — with a single fixed reservation
   there was a dead band (roughly 1030-1250px wide) where the roomy layout was
   rejected for being too tight and nothing was tried in its place, so the
   cards simply vanished on a lot of ordinary laptop windows. */
/* One spacing only, and it agrees with outerMargin/innerMargin below (16/20).
   The old "squeezed" second entry used gap 12 against an innerMargin of 20 —
   exactly the disagreement the comment warns about, which let railLayout()
   claim a card fitted while the measured room came up short, so the plan said
   yes and the placement said no and nothing was drawn. With the count now
   able to drop from two to one, a tighter second spacing buys nothing that
   dropping a card doesn't. */
/* OrbitMaze's gutter reservation, band for band. It is not a constant there:
   the screen padding and the ad-to-board gap both widen with the window, so
   a wide monitor keeps a generous margin while a small one gives nearly all
   of it to the play area.
   Matching it band for band is what makes the two games' COLUMNS — and so
   the black box inside them — come out the same width on the same screen. A
   flat 10/10 here was handing Tetris ~108px more column than OrbitMaze on a
   1918px window, which is exactly the width difference between the two. */
function railSpacing() {
  var vw = viewW();
  /* v97: "pacman jesa — dono side ki ads bilkul window edge pe, negative
     space na ho". Pac-Man's side rails sit flush to the browser's own edge
     (RAIL_EDGE = 0 there); Tetris's edge used to be 10/12/12 across these
     same three bands, which is exactly the strip of empty margin outside
     each card the screenshot was pointing at. Dropping edge to 0 on all
     three matches Pac-Man everywhere this function is read from (railLayout()
     below, and the outerMargin the placement math in fitSideRailsToViewport()
     uses) — the gap between a card and the board (below) is untouched, only
     the gap between a card and the true window edge goes away. */
  if (vw <= 1023) return { edge: 0, gap: 10 };   // OrbitMaze: padX 20 + gap 10
  if (vw <= 1279) return { edge: 0, gap: 14 };   // OrbitMaze: padX 24 + gap 14
  /* Desktop used to be edge 28 + gap clamp(16, vw*0.024, 46) — 374px of
     reservation on each side of a 1920px window, which left the column
     1172. That was copied from OrbitMaze band for band so the two games'
     black boxes would come out the same width, and it is being changed on
     purpose: OrbitMaze's board is a fixed square that cannot use extra
     width, and Tetris's grid is derived from whatever room it is given, so
     the same reservation that is generous there is just unused screen here.
     Measured at 1920: 28px of outer margin and a 46px gap were holding 88px
     of column the board would otherwise have filled.
     Edge is 0, same as Pac-Man's rails and Tetris's own tablet layout
     (RAIL_TABLET_EDGE) already are — the cards sit flush against the
     browser edge, with clear air kept only between themselves and the
     board, and the rest goes to the board. */
  return { edge: 0, gap: Math.max(18, Math.min(30, vw * 0.014)) };
}

/* Kept as an array so the loops below read the same as before; the single
   entry is now width-dependent. edge MUST match outerMargin and gap MUST
   match innerMargin — both read from railSpacing() too, so they cannot
   drift apart. */
function railLayouts() {
  return [railSpacing()];
}

/* Which of the two fits this window, or null if neither does. Deliberately a
   function of the window width alone — it never looks at what the ads or the
   board are currently doing, so the two can't chase each other's numbers. */
/* True phones get no side gutter at all — OrbitMaze's RAIL_MIN_WINDOW_W. At
   phone widths a 300px card leaves the board less than it needs, and the
   MREC in the dialogs already carries that screen. */
/* Back to 620 after a wrong turn worth recording: this was raised to 1100
   to make the board bigger on a tablet, which did work — by removing the
   side cards from every tablet. That was not the ask. The board was meant
   to grow into the SPARE space beside it, not into the advertising.
   The cards stay; the space they were leaving is dealt with by
   RAIL_TIGHT_MAX_W below instead. */
var RAIL_MIN_WINDOW_W = 540;

/* ===== Minesweeper's sizing rule for the landscape side rails =====
   Three caps applied at once, smallest wins:
     1. never larger than the IAB unit itself (300px wide);
     2. never wider than half the usable viewport HEIGHT — the unit is 1:2,
        so capping the width at (h - 32) / 2 is what keeps its 600px of
        height on the screen rather than running off it;
     3. never wider than half of what is left once RAIL_GAME_RESERVE has
        been set aside for the board between the two rails.

   The third cap is the one this game did not have. The old ladder asked
   only "does a board of at least BOARD_MIN_W_WITH_RAILS still fit", which
   a 1280px window passes with two full 300x600s — so the pair stayed at
   full size and took 600px of that window. Minesweeper starts stepping the
   cards down from about 1340px: measured, 270x540 at 1280 and 205x410 at
   1150, against a flat 300x600 here.

   Continuous, not stepped. The old [1, 0.85, 0.7, ...] ladder jumped, so a
   window between two rungs took the smaller card and left the difference as
   empty gutter. This lands on whatever the window allows.

   PORTRAIT IS NOT TOUCHED. portraitRailLayout() still runs its own dual-card
   placement for tablets held upright, which was asked for specifically and
   is a different question from how a landscape gutter is sized. */
/* Was 740. That reservation guaranteed the board a generous minimum width,
   which — now that tabletRailLayout() no longer siphons landscape tablets
   off into a single big card — left both side ads scaled down quite small
   (~140px each on a 1024px window) while the board itself stayed large.
   Lowered so the two cards come out bigger/more legible and the board
   takes up correspondingly less of a landscape screen ("grid ki height or
   weight km kar dou landscape mai"); BOARD_MIN_W_WITH_RAILS below is the
   real floor that stops the board disappearing, so this can safely give
   more of the width to the ads without the board becoming unplayable. */
var RAIL_GAME_RESERVE = 600;   // px kept clear for the board between the rails
var RAIL_VIEWPORT_CHROME = 32; // the 1rem of frame padding above and below

/* ===== TABLET IN LANDSCAPE: one full-height card, not two shrunken ones ===
   A sideways tablet is the one shape where the symmetric desktop layout
   gives the worst of both worlds. Worked through at 1150x765, which is a
   real one:

     capW = min(300, (765-32)/2, (1150-740)/2) = 205
     -> TWO cards at scale 0.68, i.e. 204x408 each, and 690px of board.

   So the window spends 460px on advertising and gets two undersized units
   for it, while ~350px of vertical space beside each card sits empty
   because the card is 1:2 and the gutter is not. Dropping to ONE card on
   the right and letting it take the FULL height of the window turns the
   same 460px into a single 370x740 impression — a bigger, more legible
   unit, in the standard 1:2 shape, with no dead space above or below it —
   and still leaves the board a wider column than it had before (~750px).
   That is the two-column shape the other games use on this size of screen.

   Scaled UP past 300x600 rather than capped at it: this is one image drawn
   at exactly 1:2, so enlarging it whole is the same unit at a different
   size, never a crop or a stretch. The cap that matters is the ASPECT, and
   it is held on both axes below.

   Deliberately bounded to the tablet band and to landscape:
     - portrait tablets already have their own dual-card placement
       (portraitRailLayout()), which was asked for specifically;
     - above RAIL_TABLET_MAX_W a window can hold two cards at or near full
       size, where the symmetric layout is the better answer and stays;
     - below RAIL_TABLET_MIN_H (landscape phones) there is no height worth
       filling, so nothing changes there either.
   ===================================================================== */
var RAIL_TABLET_MIN_W = 540;   // same floor as RAIL_MIN_WINDOW_W: below it, no gutter
var RAIL_TABLET_MAX_W = 1279;  // above it, the two-card desktop layout takes over
var RAIL_TABLET_MIN_H = 480;   // landscape phones fall through to the old path
/* Thin on purpose. This is a two-column layout with nothing on the far side
   of the card, so every pixel of margin out here is a pixel of dead screen
   edge — and, because the card's width follows its height, a pixel of
   margin costs the BOARD two: one from the reservation and one from the
   gap. 6px still reads as a deliberate inset rather than the card falling
   off the screen. */
var RAIL_TABLET_EDGE = 0;      // gap from the window's edge, left and right
var RAIL_TABLET_GAP = 8;      // gap between the card and the game column
var RAIL_TABLET_BOARD_MIN_W = 420; // the card gives way before the board does

/* Matches Pacman's isTouchDevice(): a real phone/tablet, as opposed to a
   desktop window that just happens to be narrow. Pacman's standard keys
   its single-vs-pair rail decision off this ("singleSide = isTouchDevice()
   || vw < RAIL_MIN_WINDOW_W") rather than off width alone, so a touch
   device stays single-sided no matter how wide it gets — only a plain
   desktop window is ever allowed to grow back into two cards. */
function isTouchDevice() {
  return window.matchMedia("(pointer: coarse)").matches;
}

/* TABLET = a touch screen that is not a phone (short side over 500px — the
   same line Pac-Man's isPhoneWidth() draws) and no bigger than a large
   tablet. Only these get Pac-Man's tablet geometry below; phones and desktop
   windows keep their existing layout untouched. */
function isPmTablet() {
  var vw = viewW(), vh = viewH();
  return isTouchDevice() && Math.min(vw, vh) > 500 && Math.max(vw, vh) <= 1400;
}

function tabletRailLayout() {
  /* RE-ENABLED for v71: "tablet mai 1 side ad ho baki side pura blackbox ho".
     A landscape tablet gets ONE 300x600 card on the right, with the game
     column taking the FULL remaining width. The previous two-card layout
     squeezed the column to ~552px on a 1024px tablet and the stats row
     ended up half-cut as a result; one card frees the column back to
     ~790px+, which gives the header room to fit on one line at a readable
     size. Two-card desktop layout still kicks in above RAIL_TABLET_MAX_W —
     but only for a non-touch window. Pacman's standard ("1 side pr hi ad
     raho, dono side pr nahi") never brings the second card back just
     because a rotated phone/tablet happens to be wide (a landscape iPad
     Pro, a big Android tablet, a foldable); the ceiling below is a desktop
     rule only, and the black box grows into the space the dropped card
     would have used instead. */
  if (!AD_SIZES || !AD_SIZES.VERTICAL_BANNER) return null;
  var vw = viewW();
  var vh = viewH();
  if (vh > vw) return null; // portrait has its own placement
  var touch = isTouchDevice();
  if (vw < RAIL_TABLET_MIN_W) return null;
  if (!touch && vw > RAIL_TABLET_MAX_W) return null;
  if (vh < RAIL_TABLET_MIN_H) return null;

  var full = AD_SIZES.VERTICAL_BANNER;
  var edge = RAIL_TABLET_EDGE;
  var gap = RAIL_TABLET_GAP;

  /* Height first, width second — the card is sized by the axis it is
     trying to fill, then the other axis follows from the 1:2 ratio. */
  var cardH = vh - edge * 2;
  var cardW = cardH / 2;

  /* ...unless that would leave the board less than a board. Then the WIDTH
     becomes the binding constraint and the height follows instead, so the
     ratio survives either way round. */
  var maxCardW = vw - RAIL_TABLET_BOARD_MIN_W - edge * 2 - gap;
  if (cardW > maxCardW) {
    cardW = maxCardW;
    cardH = cardW * 2;
  }

  var scale = roundScale(cardW / full.w);
  if (scale < RAIL_MIN_SCALE) return null; // too small to be a real impression

  cardW = full.w * scale;
  cardH = full.h * scale;

  return {
    sides: 1,
    tablet: true,
    edge: edge,
    gap: gap,
    cardW: cardW,
    cardH: cardH,
    scale: scale,
    /* What is left for the game column, measured in the same space the body
       padding reserves below — the two must agree exactly, or the column is
       squeezed twice and a strip of the left region goes unused. */
    budget: vw - edge * 2 - gap - cardW
  };
}

function railLayout() {
  if (!AD_SIZES || !AD_SIZES.VERTICAL_BANNER) return null;
  if (viewW() < RAIL_MIN_WINDOW_W) return null;
  var tablet = tabletRailLayout();
  if (tablet) return tablet;
  var full = AD_SIZES.VERTICAL_BANNER.w;

  /* The widest a card can actually RENDER at this window's height.
     A 300x600 card is only ever drawn whole (1:2, never cropped), so on a
     short window the renderer (fitSideRailsToViewport) scales it down by
     HEIGHT: vRoom = viewH - 8 (topSafe 4 + bottom 4 when the card clears
     the column), scale = vRoom / 600, width = scale * 300 = (viewH-8)/2.
     The budget math below used the PLANNED width (up to the full 300) even
     when the card could never render that wide — on a phone in landscape
     (844x390) it reserved 2x(10+300+10) = 640px for two cards that actually
     draw at ~191px each, stranding ~240px of dead reservation and squeezing
     the board column to 204px. Capping the planned width at the rendered
     width makes the reservation match reality: same two cards on screen,
     and the board gets the width the cards were never going to use.
     ("black box ko increase karo negative space cover ho taky") */
  var renderCapW = Math.min(full, (viewH() - 8) / 2);

  /* Phones only ever get ONE side rail, never two — a phone in landscape
     has barely enough width for the board as it is, and two gutters (even
     scaled down) were eating into it just to show a second, smaller
     impression. "mobile mai dono side ad, 1 side aye, dusri side wala
     remove kr k black box increase kar do" — so on a real phone (per
     adDeviceType()) the two-sided fast path and ladder below are skipped
     entirely and the code drops straight to the one-sided ladder, which
     hands every pixel the second gutter used to reserve back to the
     board. Tablets and desktops are untouched — this only short-circuits
     the phone case. */
  var mobileSingleSide = adDeviceType() === "mobile";

  if (!mobileSingleSide) {
    var capW = Math.min(
      full,
      (viewH() - RAIL_VIEWPORT_CHROME) / 2,
      (viewW() - RAIL_GAME_RESERVE) / 2
    );
    if (capW > 0) {
      var mwScale = Math.floor((capW / full) * 100) / 100;
      if (mwScale >= 0.45) {
        var mwCardW = full * mwScale;
        var LM = railSpacing();
        var mwBudget = viewW() - 2 * (LM.edge + mwCardW + LM.gap);
        if (mwBudget >= BOARD_MIN_W_WITH_RAILS) {
          return { sides: 2, edge: LM.edge, gap: LM.gap, budget: mwBudget, cardW: mwCardW };
        }
      }
    }
  }

  // Fallback: the old ladder, for windows the rule above cannot satisfy.
  var steps = RAIL_ALLOW_SCALE_DOWN ? [1, 0.85, 0.7, 0.55, 0.45] : [1];
  /* TWO SIDES, every step, before ONE SIDE is even considered. This used to
     be a single loop that checked two-sided THEN one-sided at each step in
     turn, so a full-size (step 1) one-sided card returned immediately and a
     window that could only just fail two full cards never got to find out
     that two SMALLER cards (step .85, .7, ...) would have fit — it showed
     one big card on the right and nothing on the left even when there was
     plenty of room for a second, shrunk one ("dusri side bhi ad dikhao").
     Two real cards, even scaled down, is a better impression than one big
     one with the other gutter sitting empty, so every step's two-sided
     option is tried first; only once ALL of them have failed does the
     one-sided ladder run. Skipped outright on a phone (mobileSingleSide) —
     see the note above. */
  for (var j = 0; !mobileSingleSide && j < steps.length; j++) {
    /* renderCapW clamp: on a short window every rung plans a card wider
       than it can draw (step 1 at 844x390 plans 300, draws 191), which made
       the whole ladder reserve space the screen never fills. The clamp is
       inert wherever the window is tall enough for the planned card —
       renderCapW is full width there, so desktop/tablet landscape math is
       byte-for-byte what it always was. */
    var cardW = Math.min(full * steps[j], renderCapW);
    var LAYOUTS = railLayouts();
    for (var i = 0; i < LAYOUTS.length; i++) {
      var L = LAYOUTS[i];
      var twoBudget = viewW() - 2 * (L.edge + cardW + L.gap);
      if (twoBudget >= BOARD_MIN_W_WITH_RAILS) {
        return { sides: 2, edge: L.edge, gap: L.gap, budget: twoBudget, cardW: cardW };
      }
    }
  }
  /* ONE card, right side only. Only reached once no two-sided option, at any
     scale, fits — one real 300x600 (or a scaled step of it) beats none, and
     it is what the portrait path has always done. */
  for (var j2 = 0; j2 < steps.length; j2++) {
    var cardW1 = Math.min(full * steps[j2], renderCapW); // same render cap as the two-sided ladder
    var LAYOUTS1 = railLayouts();
    for (var k = 0; k < LAYOUTS1.length; k++) {
      var L1 = LAYOUTS1[k];
      /* The wrapper's left offset counts here and not in the two-sided case:
         two cards leave the column CENTRED, so the window's own edges are the
         right reference, but one card pins the column to the LEFT — and the
         wrapper has its own max-width and auto margins, so it does not start
         at the window edge on a wide screen. */
      var oneBudget = viewW() - portraitLeftOffset() - (L1.edge + cardW1 + L1.gap);
      if (oneBudget >= BOARD_MIN_W_WITH_RAILS) {
        return { sides: 1, edge: L1.edge, gap: L1.gap, budget: oneBudget, cardW: cardW1 };
      }
    }
  }
  return null;
}

function boardWidthBudget() {
  if (viewH() > viewW()) {
    // Portrait: the symmetric two-sided math below assumes a desktop-shaped
    // gutter on both sides, which a portrait tablet doesn't have to give.
    var P = portraitRailLayout();
    return P ? P.budget : Infinity;
  }
  var L = railLayout();
  /* Nothing fits: don't reserve anything, let the board have the whole width.

     NOT corrected for the wrapper's inset, unlike the portrait path. That
     correction was tried here and reverted immediately: on a 768x518
     landscape tablet it collapsed the board from 423px wide to 125px. The
     two paths are not symmetric — portrait computes its own budget from the
     card geometry, while railLayout() has already reserved the gutters in
     window space and its budget is consumed differently downstream, so
     subtracting the inset a second time takes the same width off twice.
     Whatever is leaving a gap on a landscape tablet, it is not this. */
  return L ? L.budget : Infinity;
}

// The real phone/tablet dividing line for this feature.
// the board must keep at least this much width either way.
// Two cards costs more room than one, so it needs a
// below this the card is too small to read — skip it
/* The column doesn't start at the raw viewport edge, and padding-left alone
   isn't the whole story either: .wrapper has its own max-width (760px in
   the 700-899px band, since only .game-screen — not .wrapper — is widened
   there), and below that width .wrapper is ITSELF centred by its
   margin:0 auto, which adds a second offset on top of its padding. Reading
   the wrapper's actual rendered left edge captures both in one measurement
   instead of assuming padding is the only thing there. Shared by both the
   dual- and single-sided layouts below, so they can't disagree about it. */
function portraitLeftOffset() {
  var wrapperEl = document.querySelector(".wrapper");
  if (!wrapperEl) return 0;
  var wr = wrapperEl.getBoundingClientRect();
  var wcs = getComputedStyle(wrapperEl);
  return wr.left + (parseFloat(wcs.paddingLeft) || 0);
}

function portraitRailLayout() {
  /* RETIRED — "tablet portrait view pr top pr leaderboard wala ad lagaoo".
     Portrait tablets now use the LEADERBOARD-AT-TOP fallback (the same
     placeLeaderboardTop() layout a phone in portrait already gets) instead
     of the pair of side cards this function used to plan. The side cards
     squeezed the board into a tall sliver on every portrait tablet width
     (measured at 820x1180: two ~210px cards and a ~340px column between
     them), while the leaderboard leaves the column at its full CSS cap
     (620px) and costs only ~90px of height — the board comes out wide AND
     tall, which is the better trade on this shape of screen.
     Returning null here is the whole change: fitPortraitAd() falls through
     to placeLeaderboardTop() on its own, boardWidthBudget() hands the
     column its full width (Infinity), and LANDSCAPE is untouched —
     railLayout() never calls this. Phones are unaffected either way: they
     never passed the PORTRAIT_AD_MIN_WINDOW check below, so they were
     always on the leaderboard fallback already. */
  return null;
}

/* True only when the portrait grid is the one in play AND there is a real
   single-side layout for it — the two conditions the rest of this feature
   is gated on, kept in one place so they can't drift apart. */
function portraitAdActive() {
  return viewH() > viewW() && !!portraitRailLayout();
}

/* Positions the portrait ad card(s) — one on the right for a phone-width
   column, or one on EACH side for a tablet-width column with room to
   spare (see the two loops in portraitRailLayout()). Simpler than the
   landscape version above regardless of which: one scale for however many
   cards there are (never two different scales fighting for the same
   width), anchored with position:fixed to the true edges of the viewport
   (same .ad-rail mechanism, same --ad-scale transform). */
function fitPortraitAd() {
  if (!adRailLeft || !adRailRight) return;
  var screenEl = document.querySelector(".game-screen");

  /* Portrait never uses the tablet-landscape reservation, and a rotation
     from landscape to portrait arrives here with it still set — so it is
     cleared on the way in rather than left for the branch that happens to
     notice. */
  setRailReserve(0, 0);

  var P = portraitAdActive() ? portraitRailLayout() : null;
  if (!P) {
    adRailLeft.style.display = "none";
    adRailRight.style.display = "none";
    // Hand the column back to the plain centred layout (see below for what
    // this override is and why it needs clearing when there's no ad to
    // make room for).
    if (screenEl) screenEl.style.alignSelf = "";
    // No side gutter (phone width, or a narrow portrait tablet) — but there
    // is real height under the board once it has taken what it needs, so a
    // single wide LEADER_BOARD goes there instead of showing nothing at
    // all. See the long note above placeLeaderboardTop().
    placeLeaderboardTop();
    return;
  }

  // A real side ad fits (portrait tablet) — the leaderboard fallback is
  // only for the width this window does NOT have.
  hideLeaderboardTop();

  var scale = P.scale;
  var cardW = P.cardW;
  var cardH = AD_SIZES.VERTICAL_BANNER.h * scale;
  var top = Math.max(4, (viewH() - cardH) / 2);

  adRailRight.style.display = "";
  adRailRight.style.right = "auto";
  adRailRight.style.left = Math.round(viewW() - P.edge - cardW) + "px";
  adRailRight.style.top = Math.round(top) + "px";
  adRailRight.style.setProperty("--ad-scale", String(scale));

  if (P.sides === 2) {
    /* Symmetric reservation, so the column stays in its NORMAL centred
       position (align-items: center on .wrapper, untouched) — the freed
       width is a matching block on both sides, which is exactly where a
       centred column already leaves room. */
    if (screenEl) screenEl.style.alignSelf = "";
    adRailLeft.style.display = "";
    adRailLeft.style.right = "auto";
    adRailLeft.style.left = Math.round(P.edge) + "px";
    adRailLeft.style.top = Math.round(top) + "px";
    adRailLeft.style.setProperty("--ad-scale", String(scale));
  } else {
    adRailLeft.style.display = "none";
    /* One-sided only: the column is centred in .wrapper by default — right
       for every other screen, but wrong here: a centred column of the
       REDUCED width mirrors the freed-up space as an equal gap on the LEFT
       too, so the ad (anchored to the true right edge) ends up overlapping
       the board instead of sitting in space the board actually gave up.
       flex-start pins the column to the left instead, so the freed width
       is a single block on the right — exactly where the ad is. Only
       touches .game-screen, not .wrapper, so every other screen (start,
       level select, shop) keeps its normal centred layout untouched. */
    if (screenEl) screenEl.style.alignSelf = "flex-start";
  }
}

/* ---------- LEADER_BOARD 970x90 above the board ----------
   The top-edge counterpart of --rail-reserve-left/--rail-reserve-right: a
   phone (or a portrait window narrower than PORTRAIT_AD_MIN_WINDOW) has no
   width to give a side gutter, but it does have HEIGHT once the board has
   taken what it needs. Rather than carry no ad at all on that shape of
   screen, a single wide-short IAB LEADER_BOARD goes above the board
   instead, and a band of height is reserved for it out of the page's own
   content box via --rail-reserve-top — so the board simply gets a shorter
   column to work with, exactly the way it already copes with a narrower
   one from the side reserves. Same fixed-box + transform:scale(--ad-scale)
   pattern as the side rails, so the 970:90 shape never changes, only ever
   scaled down as a whole. Same fallback Pac-Man uses for this shape of
   screen, and the two use the same unit and the same margins. */
function placeLeaderboardTop() {
  if (!adLeaderboardEl || !adLeaderboardEl.innerHTML) {
    // Nothing to show yet (ad still in flight, or none configured) — leave
    // no band reserved rather than holding empty space for a card that
    // isn't there.
    document.body.style.setProperty("--rail-reserve-top", "0px");
    if (adLeaderboardEl) adLeaderboardEl.classList.remove("is-shown");
    stopLeaderboardCarousel();
    return false;
  }

  var vw = viewW();
  /* Tablet: Pac-Man's placeLeaderboardTop() leaves no side margin (its
     RAIL_EDGE is 0), so the card spans the full width. */
  /* Pac-Man's RAIL_EDGE is 0 on every device, so the card spans the full
     width everywhere (it was 5px each side here off tablets). */
  var lbSideMargin = 0;
  var scale = Math.min(1, (vw - 2 * lbSideMargin) / AD_LEADER_W);
  scale = Math.floor(Math.max(0, scale) * 1000) / 1000;
  if (scale < LEADER_MIN_SCALE) {
    document.body.style.setProperty("--rail-reserve-top", "0px");
    adLeaderboardEl.classList.remove("is-shown");
    stopLeaderboardCarousel();
    return false;
  }

  var cardW = Math.round(AD_LEADER_W * scale);
  var cardH = Math.round(AD_LEADER_H * scale);
  document.body.style.setProperty("--rail-reserve-top", (cardH + 2 * LEADERBOARD_MARGIN) + "px");

  adLeaderboardEl.style.left = Math.round((vw - cardW) / 2) + "px";
  adLeaderboardEl.style.top = LEADERBOARD_MARGIN + "px";
  adLeaderboardEl.style.setProperty("--ad-scale", String(scale));
  adLeaderboardEl.classList.add("is-shown");

  startLeaderboardCarousel();
  return true;
}

/* Used whenever a side ad (or no ad at all, e.g. game screen hidden) takes
   over — a rotation to landscape, a portrait tablet wide enough for a real
   side gutter, or leaving the game screen entirely. Self-contained so every
   call site that stops showing a side ad can also call this without having
   to know the leaderboard's own internals. */
function hideLeaderboardTop() {
  if (!adLeaderboardEl) return;
  adLeaderboardEl.classList.remove("is-shown");
  stopLeaderboardCarousel();
  document.body.style.setProperty("--rail-reserve-top", "0px");
}

function fitBoardToViewport() {
  if (!boardAreaEl || !tetrisEl) return;
  if (gameScreen.classList.contains("hidden")) return;

  /* Narrow the whole game column to the same budget, not just the board.
     The header and stats rows span the column, and a column wider than the
     board reaches out over the gutters — which forces the gutter cards to
     start below it and can cost them the ~600px of height they need. Pulling
     the column in lets the cards use the full window height. */
  var budget = boardWidthBudget();
  /* The column is never squeezed below MIN_GAME_COL, even when the board's
     own budget is smaller: the header row (logo, level name, Pause, ?, x)
     cannot shrink past its content, so a narrower column doesn't shrink it —
     it just makes it overflow sideways, straight under the ad cards. The
     board still uses the smaller budget; only the column has a floor. */
  gameScreen.style.setProperty(
    "--game-col-max",
    budget === Infinity ? "none" : Math.round(budget) + "px"
  );

  /* Release the column's pull-in BEFORE measuring. --board-fit-w narrows the
     column to the board's own width, and boardArea sits inside that column —
     so measuring available width while it is still applied measures the
     result of the last fit, not the room actually on offer.
     With the old square field that was harmless: the board was always
     height-bound, so availW never decided anything. A field wider than it is
     tall can be width-bound, and then it runs away — each pass measures the
     column the previous pass shrank, so the board loses a little every time
     and keeps shrinking while the window sits still. */
  gameScreen.style.setProperty("--board-fit-w", "100%");
  void gameScreen.offsetWidth; // force the reflow so the reads below are real

  // Measure at natural size first, then scale to fit.
  tetrisEl.style.setProperty("--board-scale", "1");
  var naturalW = tetrisEl.offsetWidth;
  var naturalH = tetrisEl.offsetHeight;
  if (!naturalW || !naturalH) return;

  var availW = Math.min(boardAreaEl.clientWidth, boardWidthBudget());
  var availH = boardAreaEl.clientHeight;
  var scale = Math.min(availW / naturalW, availH / naturalH, MAX_BOARD_SCALE);
  /* Floored to three decimals, not two. Two decimals throws away up to 1%
     of the fit, and 1% of a 1170px column is the ~20px strip that was
     showing either side of the black box on a desktop — the board was being
     rounded down to a scale it did not need to settle for. Three decimals
     keeps the same "never round UP past what fits" guarantee (a floor still
     never overflows) while cutting the loss to ~1px. */
  scale = Math.max(0.4, Math.floor(scale * 1000) / 1000);
  tetrisEl.style.setProperty("--board-scale", String(scale));

  /* Match the column's actual width to the board's actual on-screen width.
     The board is usually HEIGHT-bound (its aspect ratio is fixed, so the
     tighter of the two fit ratios above is normally the height one), which
     leaves it narrower than the column it sits in — the header spans the
     full column width, the black box doesn't, and the gap between them
     reads as visually "not matching". Pulling the column in to the board's
     real width fixes that; never narrower than the header's own natural
     content width (buttons/text), so nothing overlaps or wraps. Stable
     under repeated calls: once the column matches the board, width and
     height give the same scale ratio next time, so it doesn't keep
     shrinking on every re-fit. */
  var actualBoardW = naturalW * scale;
  gameScreen.style.setProperty("--board-fit-w", Math.round(actualBoardW) + "px");
}

/* Stretches the bottom bar to the window: 6px in from each edge, the same
   as Pac-Man. The bar lives inside the (narrower, centred) game column, so
   the difference between the column's edges and the window's edges becomes
   a negative margin on each side (--bar-ml / --bar-mr in style.css). */
function syncBarToViewport() {
  var row = document.querySelector(".game-screen .under-board-controls");
  var gs = document.getElementById("gameScreen");
  if (!row || !gs || gs.classList.contains("hidden")) return;
  var inset = 6;
  document.body.classList.toggle("pm-tablet", isPmTablet());
  var r = gs.getBoundingClientRect();
  if (!r.width) return;
  var vw = document.documentElement.clientWidth || window.innerWidth;
  row.style.setProperty("--bar-ml", Math.max(0, r.left - inset).toFixed(1) + "px");
  row.style.setProperty("--bar-mr", Math.max(0, vw - inset - r.right).toFixed(1) + "px");
  /* Tablet: Pac-Man's bar runs edge to edge with its 8px frame on BOTH
     sides. Whatever the column left over on the right is closed here. */
  if (isPmTablet()) {
    var rr = row.getBoundingClientRect();
    var short = (vw - 8) - rr.right;
    if (Math.abs(short) >= 0.5) {
      var mr = parseFloat(row.style.getPropertyValue("--bar-mr")) || 0;
      row.style.setProperty("--bar-mr", Math.max(0, mr + short).toFixed(1) + "px");
    }
  }
}

/* v92: the bottom row (Level, Lines, Coins, Next, joystick, power-ups, sound /
   pause / exit) always stays on ONE line. On a phone the column is narrower
   than the row's natural width, so instead of wrapping it is scaled down
   uniformly with CSS zoom until it fits. Wide columns measure natural <=
   available and stay at zoom 1, so tablets / desktops are untouched. */
function fitBottomRow() {
  /* The bar is a full-width Pac-Man-style card now (see the PAC-MAN STYLE
     GAME BAR block at the end of style.css) and re-flows into two rows on a
     phone, so the old "zoom the row until it fits" step is retired. */
  var rowNow = document.querySelector(".game-screen .under-board-controls");
  var groupNow = rowNow && rowNow.querySelector(".stats-group");
  if (groupNow) groupNow.style.zoom = "1";
  syncBarToViewport();
  fitTabletStats();
}

/* Tablet only (body.pm-tablet): the stats are sized in style.css from the
   bar's shared control height (see "TABLET GAME BAR" there). If extreme
   values -- Level 35 with a 5-digit coin balance, say -- would run past
   the stats' column, this steps the stats' TEXT down just enough to fit
   (--tab-stat-fit < 1). Chip heights stay equal to the buttons', and with
   normal values the factor stays 1. Layout only; no game state is read
   or changed. */
function fitTabletStats() {
  var gs = document.getElementById("gameScreen");
  var left = gs && gs.querySelector(".under-board-controls .pm-bar-left");
  if (!gs || !left) return;
  if (!document.body.classList.contains("pm-tablet") || gs.classList.contains("hidden")) {
    gs.style.removeProperty("--tab-stat-fit");
    return;
  }
  var fit = 1;
  gs.style.setProperty("--tab-stat-fit", "1");
  for (var i = 0; i < 6; i++) {
    var need = left.scrollWidth, have = left.clientWidth;
    if (!need || !have || need <= have) break;
    fit = Math.max(0.6, Math.floor(Math.min(fit - 0.02, fit * (have - 1) / need) * 100) / 100);
    gs.style.setProperty("--tab-stat-fit", String(fit));
    if (fit <= 0.6) break;
  }
}

(function watchTabletStats() {
  if (typeof MutationObserver === "undefined") return;
  var targets = document.querySelectorAll(
    "#gameScreen .under-board-controls #statLines, #gameScreen .under-board-controls .coin-display"
  );
  if (!targets.length) return;
  var queued = false;
  var mo = new MutationObserver(function () {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () { queued = false; fitTabletStats(); });
  });
  Array.prototype.forEach.call(targets, function (el) {
    mo.observe(el, { childList: true, characterData: true, subtree: true });
  });
})();

(function watchLevelBadge() {
  var badge = document.getElementById("levelNumGame");
  if (!badge || typeof MutationObserver === "undefined") return;
  new MutationObserver(function () { fitBottomRow(); })
    .observe(badge, { childList: true, characterData: true, subtree: true });
})();

/* fitBoardToViewport() changes #tetris's transform, which has a CSS
   transition (smooth resize) — its getBoundingClientRect() doesn't reach
   the NEW size until that transition finishes. Measuring the board for
   the side rails immediately after calling it (same tick) was reading the
   board's PRE-resize geometry, sizing/positioning the rails wrong — most
   visibly on short/landscape screens, where the wrong (too-tall) rail
   ended up overlapping the header buttons. This waits the transition out
   first, then fits the rails against the board's real, final size. */
/* The two gutter cards and the under-board card are alternatives, never both.
   fitSideRailsToViewport() decides first, from a measurement that does not
   depend on the under-board card at all (see the note in there), so this
   sequence settles in one pass instead of the two fighting each other. */
function fitEverything() {
  fitSideRailsToViewport();

  /* Order matters, and it was wrong. fitHeaderRow() decides whether the stats
     sit on the level-badge line or drop to a row of their own — which changes
     the header's HEIGHT by ~50px. fitBoardToViewport() measures the height
     left for the board. Running the board first measured the OLD header, so
     when the row then merged, the ~50px it freed was never handed to the
     board: it just sat there as empty space above the black box, and nothing
     re-measured until the next window resize.
     Header first, then the board. The second pass is because the board's
     width pulls the column in, which changes the room the row has — so the
     row is asked again against the column it actually ended up with. The
     latch inside fitHeaderRow() is what stops the two trading answers. */
  fitBottomRow();
  fitBoardToViewport();
  fitBottomRow();
  fitBoardToViewport();
  fitBottomRow();

  setTimeout(fitSideRailsToViewport, 180); // re-place once the board transition ends
}

/* The old header-row fitters (fitHeaderRow / fitStatsRow and their
   width-band tables) were removed: they measured a .header / .stats-bar
   that no longer exists — the level badge and stats moved into the bottom
   control bar (.under-board-controls), which re-flows on its own — so every
   call returned on its first line. */

/* =====================  STANDARD IAB AD SIZES  =========================
   Every STATIC (image) ad in the game is rendered at one of these exact
   pixel sizes and then scaled uniformly to fit — it is never stretched to
   whatever space happens to be free, so the creative always keeps the
   standard aspect ratio on phone, tablet and desktop alike.

     VERTICAL_BANNER  300 x 600  half-page / skyscraper
     MREC             300 x 250  medium rectangle

   One size per placement, and the placement decides which. The gutters
   either side of the board are the only space tall enough for a half-page,
   so they get the VERTICAL_BANNER. The Level Complete dialog gets the MREC:
   the dialog is ~520px tall in total, so a 600px unit is taller than the
   whole popup and pushes the buttons below the fold — the medium rectangle
   is the IAB size that placement is actually for.

   MREC used to be drawn by buildMrecCard() without appearing here at all,
   which meant the code RENDERED 300x250 while every declaration about it
   — AD_PLACEMENT_SIZE, the catalogue entries, adCheck() — still said
   VERTICAL_BANNER. Harmless while the creatives are local files, and not
   harmless the moment AD_SOURCE is 'server': the request would ask an ad
   server for a half-page and drop whatever came back into a 300x250 box.
   ===================================================================== */
var AD_SIZES = {
  VERTICAL_BANNER: { w: 300, h: 600 },
  MREC:            { w: 300, h: 250 }
};

/* IAB LEADER_BOARD 970x90 — used by placeLeaderboardTop() instead of the
   VERTICAL_BANNER pair when a phone/narrow-portrait window has no gutter
   for them at all (see portraitRailLayout() — below PORTRAIT_AD_MIN_WINDOW
   there is currently no side ad). Same unit and same fallback Pac-Man uses
   for exactly this shape of screen. */
var AD_LEADER_W = 970;
var AD_LEADER_H = 90;
/* Below this the card is too small to read — skip it rather than show an
   illegible sliver. Matches Pac-Man's floor for the same unit. */
var LEADER_MIN_SCALE = 0.22;
/* Equal gap placeLeaderboardTop() leaves above the card AND between it and
   the board — a card pinned flush to the screen's own top edge reads as
   "stuck there" rather than placed. */
var LEADERBOARD_MARGIN = 5;

/* The gutter cards hold themselves to a higher bar than that. A tablet in
   portrait leaves just enough room either side for a ~140px-wide sliver of a
   300x600 — technically "fits", but unreadable, and it also suppressed the
   under-board card, which on that same tablet has room for a full-size
   300x250. So below this the gutter cards stand down and let the under-board
   card take the impression instead. */
var RAIL_MIN_SCALE = 0.34;

/* How far in from the window edge the gutter cards sit, per the layout that
   fits. Small on purpose: they belong at the edges of the screen, leaving the
   middle to the board. */
function railEdgeMargin() {
  var L = railLayout();
  return L ? L.edge : railSpacing().edge;
}

function roundScale(s) {
  return Math.floor(s * 1000) / 1000;
}

/* Takes the card's strip out of the PAGE's content box (see the padding on
   body in style.css). Called on every fit pass, including the ones that end
   with no card at all — a reservation left behind after the layout has moved
   on is a permanently narrowed page, so it is always written, never only
   when there is something to reserve for. */
function setRailReserve(left, right) {
  var s = document.body.style;
  s.setProperty("--rail-reserve-left", Math.round(left || 0) + "px");
  s.setProperty("--rail-reserve-right", Math.round(right || 0) + "px");
}

/* ---------- VERTICAL_BANNER 300x600 in the left / right gutters ----------
   Measures the REAL leftover gutter beside the board group (canvas + the
   Next/Power-ups column) with getBoundingClientRect, which is scrollbar
   accurate — unlike a CSS calc(100vw ...) formula, which can come out
   asymmetric because 100vw includes the scrollbar on some browsers.
   Both rails get the SAME scale (whichever side has less room), so the two
   cards are always identical, and each is CENTRED in its own gutter rather
   than stretched across it. */
/* The LAYOUT width, not the visual one. window.innerWidth counts the
   scrollbar; getBoundingClientRect, which every other measurement here comes
   from, does not. Mixing the two makes the right-hand gutter measure wider
   than it really is by exactly the scrollbar's width, so the right card sits
   further out than the left one — the two side gaps come out unequal on any
   window that happens to be showing a scrollbar, and equal on any that is
   not. clientWidth/clientHeight are on the same footing as the rects. */
function viewW() {
  return document.documentElement.clientWidth || window.innerWidth;
}
function viewH() {
  return document.documentElement.clientHeight || window.innerHeight;
}

function fitSideRailsToViewport() {
  if (!adRailLeft || !adRailRight) return;
  /* Same guard the landscape path below has always had (via groupEl's
     offsetWidth being 0 while hidden) — needed here too, and needed FIRST:
     .ad-rail is position:fixed, entirely outside #gameScreen's own hidden
     subtree, so nothing about .game-screen being display:none stops it
     from rendering. Skipping this check let fitPortraitAd() run (and the
     ad rail show, floating over the menu) whenever a resize fired while
     the player was on the start or level-select screen in a portrait,
     ad-qualifying window — a plain window resize does that, not just
     starting a game. */
  if (gameScreen.classList.contains("hidden")) {
    adRailLeft.style.display = "none";
    adRailRight.style.display = "none";
    setRailReserve(0, 0);
    hideLeaderboardTop();
    var wrapperElReset = document.querySelector(".wrapper");
    if (wrapperElReset) wrapperElReset.style.maxWidth = "";
    return;
  }

  // Do not expose an empty or previous creative while the new screen's ads are
  // still loading. This removes the one-frame banner flash during navigation.
  var railReadyLeft = adRailLeft.classList.contains("ad-ready");
  var railReadyRight = adRailRight.classList.contains("ad-ready");
  if (!railReadyLeft && !railReadyRight && !(adLeaderboardEl && adLeaderboardEl.innerHTML)) {
    adRailLeft.style.display = "none";
    adRailRight.style.display = "none";
    setRailReserve(0, 0);
    hideLeaderboardTop();
    return;
  }

  /* Portrait is a different shape of problem (one side's worth of spare
     width, not two), so it gets its own function rather than a branch
     threaded through the landscape math below — see fitPortraitAd() and
     the long comment above portraitRailLayout(). fitPortraitAd() owns the
     leaderboard fallback too (placeLeaderboardTop()/hideLeaderboardTop()),
     since it is the one that knows whether a real side gutter exists. */
  if (viewH() > viewW()) {
    fitPortraitAd();
    return;
  }
  /* Landscape: the leaderboard is a portrait-only fallback (there is always
     real width for the side rails here — see tabletRailLayout()/railLayout()
     below) — clear it so a rotation out of portrait never leaves the band
     reserved, or the card showing, behind it. */
  hideLeaderboardTop();
  var groupEl = document.getElementById("tetris");
  var screenEl = document.querySelector(".game-screen");
  if (!groupEl || !screenEl || !boardAreaEl) return;
  if (groupEl.offsetWidth === 0) return;

  /* ---------- TABLET LANDSCAPE: game left, one full-height card right ----
     Placed from the plan alone, without measuring the board at all. That is
     the point of it: the long path below positions the cards against the
     board's live box, so the board's width depends on the card and the
     card's position depends on the board, and the whole file above is the
     scaffolding that keeps those two from chasing each other. Here the
     window's own height and width decide everything — the card's size, the
     strip reserved for it, and what the column gets — so there is nothing
     left to converge on. See tabletRailLayout(). */
  var tablet = tabletRailLayout();
  if (tablet) {
    adRailLeft.style.display = "none";
    adRailRight.style.display = railReadyRight ? "" : "none";
    /* Centred, NOT alignSelf:flex-start as the other one-card layout does.
       That override exists because there the column is still laid out
       across the full window and has to be shoved clear of the card by
       hand. Here the reservation below has already removed the card's strip
       from the page, so the column's normal centring is centring in the
       left region — which is what puts an equal margin either side of the
       board instead of a fat one on the right. */
    screenEl.style.alignSelf = "";
    setRailReserve(tablet.edge, tablet.edge + tablet.cardW + tablet.gap);

    adRailRight.style.right = "auto";
    adRailRight.style.left = Math.round(viewW() - tablet.edge - tablet.cardW) + "px";
    adRailRight.style.top = Math.round(Math.max(0, (viewH() - tablet.cardH) / 2)) + "px";
    adRailRight.style.setProperty("--ad-scale", String(tablet.scale));
    return;
  }
  setRailReserve(0, 0);

  var SIZE = AD_SIZES.VERTICAL_BANNER; // 300 x 600, or the 300x250 fallback below
  /* Read from the same function railLayout() plans with, so the two can never
     disagree — a disagreement here is what makes the real on-screen gutter
     bigger than either number says. */
  var spacing = railSpacing();
  var outerMargin = spacing.edge; // gap from the browser's own edge
  var innerMargin = spacing.gap;  // gap from the board

  /* VISIBILITY is decided against the WIDEST the board could ever get, not
     against how wide it happens to be right now.
     Why: the under-board card takes height off the board, which makes the
     board narrower, which widens this gutter. Measuring the live board would
     mean the two cards each depend on the other's state — they flip-flop, or,
     in the wrong order, both vanish. offsetWidth ignores the board's scale
     transform, so it gives the untransformed group width; multiplying by the
     scale cap gives a ceiling that never moves, whatever else is on screen. */
  /* The ceiling on how wide the board can ever get: capped by the column
     width, by MAX_BOARD_SCALE, and — usually the real limit — by how much
     HEIGHT the board area has, because the play-field's width is locked to
     its height. The under-board card's height is added back in so this number
     does not shift depending on whether that card happens to be on screen;
     that is what stops the two ad slots fighting over the same space. */
  var areaH = boardAreaEl.clientHeight;
  var maxGroupW = groupEl.offsetWidth * Math.min(
    screenEl.clientWidth / groupEl.offsetWidth,
    areaH / groupEl.offsetHeight,
    MAX_BOARD_SCALE
  );
  var plan = railLayout();
  var sides = plan ? plan.sides : 2;

  /* Pinned BEFORE anything is measured. The one-sided layout moves the whole
     column left, and every measurement below depends on where it actually
     sits — reading them while the column was still centred and only shifting
     it afterwards would measure a layout that no longer exists. */
  screenEl.style.alignSelf = sides === 1 ? "flex-start" : "";

  /* .wrapper itself is capped at max-width:760px and centred in the window
     (see .wrapper in style.css) — fine normally, since the game column is
     centred inside it too and both centre lines match. But the one-sided
     phone layout pins the column to .wrapper's OWN left edge, not the
     window's: once the phone's landscape width is over 760px (which is
     most of them — an iPhone 12/13 is 844, a Pixel 5 is 851), .wrapper's
     own centring margin becomes a strip of dead space to the LEFT of the
     board that this alignSelf never reaches, while the ad card on the
     right is placed against the real window edge and eats into .wrapper's
     matching right-hand margin instead. Lifting the cap only for this
     layout lets .wrapper span the full width, so flex-start actually lands
     the board at the window's true left edge and the black box gets that
     strip back. ("landscape mai left side negative space ari waha tak
     black box increase karo") */
  var wrapperEl = document.querySelector(".wrapper");
  if (wrapperEl) wrapperEl.style.maxWidth = (sides === 1 && !tablet) ? "none" : "";

  /* leftOffset is the wrapper's real left edge (it has its own max-width and
     auto margins, so it is not at the window edge on a wide screen) — the
     same stable reading the portrait path uses. Stable matters: reading the
     column's LIVE box would make the card depend on the board's current width
     while the board's width already depends on the card, and the two would
     chase each other. */
  var leftOffset = portraitLeftOffset();
  var centreX = viewW() / 2;
  var leftStart = outerMargin;
  var leftRoom = Math.max(0, centreX - maxGroupW / 2 - innerMargin - leftStart);
  var rightStart = centreX + maxGroupW / 2 + innerMargin;
  /* One-sided: only the RIGHT gutter holds a card, and the column is pinned
     left rather than centred — so the room is everything past the column's
     own width, not the half-width either side of centre. The centred maths
     measured space a single card never sits in and came up short. */
  var rightRoom = sides === 1
    ? Math.max(0, viewW() - outerMargin - (leftOffset + maxGroupW) - innerMargin)
    : Math.max(0, viewW() - outerMargin - rightStart);
  var room = sides === 1 ? rightRoom : Math.min(leftRoom, rightRoom);

  /* Vertical room: from the top of the board AREA down to the bottom of the
     window. Starting at the board area (not at the top of the page) keeps the
     card clear of the header and the stats row, which span a wider column
     than the board does — measured from the top of the page, a card on a
     short/landscape screen lands on top of the Pause button. The area's TOP
     doesn't move when the under-board card appears (only its height does), so
     this stays stable too. */
  /* Normally the card must start below the board AREA, keeping it clear of
     the header and stats rows. But those rows only span the centre column —
     once the card sits far enough out at the window edge to miss that column
     altogether, it can use the full height of the window instead, which is
     often the difference between a scaled-down card and a true 300x600. */
  var colLeftStable = sides === 1 ? leftOffset : centreX - maxGroupW / 2;
  var colRightStable = sides === 1 ? leftOffset + maxGroupW : centreX + maxGroupW / 2;
  /* Margins kept as thin as is sensible: every pixel here raises the window
     height the exact-size card needs, and on a laptop those are the pixels
     that decide whether it shows at all. */
  var plannedW = (plan && plan.cardW) || SIZE.w;
  var edgeM = railEdgeMargin();
  /* Does EVERY card being shown clear the centre column horizontally? If so
     it cannot collide with the header or the stats row, and the full window
     height is available to it.
     The old test only checked the LEFT card, so a one-sided layout — where
     there is no left card and the column is pinned left — never passed it.
     topSafe stayed down at the top of the board area, vRoom came out around
     550, and with scaling off that is under 600: the card was hidden on every
     window, which is what "the ad isn't showing" was. */
  var clearsColumn = sides === 1
    ? (viewW() - edgeM - plannedW) >= colRightStable + 10
    : ((edgeM + plannedW) <= colLeftStable - 10 && (viewW() - edgeM - plannedW) >= colRightStable + 10);
  var topSafe = clearsColumn ? 4 : boardAreaEl.getBoundingClientRect().top;
  var vRoom = Math.max(0, viewH() - topSafe - 4);

  /* A true 300x600 whenever the window can take one. Where it can't, the SAME
     card is scaled down as a whole — still exactly 1:2, never cropped, never
     stretched, never swapped for a different-shaped unit. It is the 300x600
     creative either way, just drawn smaller.
     This matters more than it sounds: a 300x600 needs 610px of BROWSER
     viewport height, and browser chrome (tabs, address bar, bookmarks) eats
     100-200px of a laptop screen — so a 1366x768 laptop often gives the page
     only ~560px, and "exact size or nothing" meant nothing at all.
     Set RAIL_ALLOW_SCALE_DOWN to false to go back to exact-size-only. */
  var scale = room >= SIZE.w && vRoom >= SIZE.h ? 1 : 0;

  if (scale === 0 && RAIL_ALLOW_SCALE_DOWN) {
    /* Capped by the width the layout PLANNED for, not just by the room that
       happens to be free. The column was sized around that planned width, so
       a card that quietly grows past it ends up sitting on top of the header. */
    var planned = railLayout();
    var plannedMax = planned ? planned.cardW / SIZE.w : 1;
    scale = roundScale(Math.min(room / SIZE.w, vRoom / SIZE.h, plannedMax, 1));
    if (scale < RAIL_MIN_SCALE) scale = 0; // too small to read — leave it empty
  }

  if (scale === 0) {
    // Not enough gutter for a full-size card (phones, most tablets in
    // portrait) — hide via inline style, which overrides the CSS default
    // outright. No smaller unit takes its place — see the note above.
    adRailLeft.style.display = "none";
    adRailRight.style.display = "none";
    screenEl.style.alignSelf = "";
    return;
  }

  adRailLeft.style.display = sides === 1 || !railReadyLeft ? "none" : "";
  adRailRight.style.display = railReadyRight ? "" : "none";

  var cardW = SIZE.w * scale;
  var cardH = SIZE.h * scale;
  /* Vertically centred on the BOARD rather than on the window, so the three
     columns sit on a common centre line instead of the cards floating higher
     than the play-field. Clamped so it can still never run off either end. */
  /* Centred in the WINDOW, so the space above and below the card matches the
     space to its left and right. Centring on the board put the card's middle
     level with the play-field, but the play-field is not in the middle of the
     window — the header and stats rows sit above it — so the card ended up
     with ~150px ofabove and 18px below on a 1024x768 tablet. The clamp is
     kept: it still cannot ride up under the header or off the bottom. */
  /* Centred in the window, with topSafe as a PREFERENCE rather than an
     override.
     The old line applied Math.max(topSafe, ...) LAST, so it won the argument
     against the "don't go past the bottom" clamp inside it. Whenever topSafe
     was the top of the board area (roughly 150px down) rather than 4, the
     card was pushed to 150 no matter how short the window was — on a 720px
     window that puts its bottom edge at 750, i.e. 30px off the screen, with
     all the empty space stacked above it. Clamping to maxTop last means the
     card sits as low as topSafe asks for only while it still fits, and stays
     fully on screen either way. */
  var maxTop = Math.max(0, viewH() - cardH - 4);
  var top = (viewH() - cardH) / 2;
  top = Math.min(Math.max(top, Math.min(topSafe, maxTop)), maxTop);

  /* Pinned to the BACK of its gutter -- outerMargin in from the window edge
     -- rather than centred between the window edge and the board. Widening
     the black box (see tetris.canvasWidth) eats into the gutter from the
     board side, and a centred card just shrank with it, leaving a strip of
     uncovered space sitting unused at the outer edge on every resize.
     Anchoring to the back edge instead means that strip is always the
     card's own space: the gutter can lose width right up against the board
     without the card drifting or leaving empty margin behind it. */
  /* The band is measured from the game COLUMN, not from the board. The column
     is wider than the board (it carries the header and the stats row), and a
     card centred against the board's edge lands underneath that header. */
  var colRect = screenEl.getBoundingClientRect();

  /* Measured to the BOARD, not to the game column.
     The column is noticeably wider than the black box — it carries the header
     and the stats row — so a card centred against the COLUMN edge looks
     off-centre to the eye, which only ever compares it against the board:
     32px to the window edge but 64px of visible space to the box. Anchoring
     against the board's own edge (via leftEdge/rightEdge below) keeps the
     card's forward edge lined up with what the eye actually compares it to.
     The card cannot drift under the header as a result: it is centred
     vertically in the window and the topSafe clamp above still holds it clear
     of the header row. */
  var boardRect = document.getElementById("canvas").getBoundingClientRect();
  var leftEdge = boardRect.width > 0 ? boardRect.left : colRect.left;
  var rightEdge = boardRect.width > 0 ? boardRect.right : colRect.right;

  var leftGutter = Math.max(0, leftEdge);
  var rightGutter = Math.max(0, viewW() - rightEdge);

  var placements = [
    /* Clamped so a wide-open gutter still doesn't drift past the point where
       it would have been centred -- outerMargin is a FLOOR on how close to
       the edge it sits, not a rule that it must always touch that floor. */
    { el: adRailRight, left: rightEdge + Math.max(rightGutter - cardW - outerMargin, (rightGutter - cardW) / 2) }
  ];
  if (sides === 2) {
    placements.push({ el: adRailLeft, left: Math.min(outerMargin, (leftGutter - cardW) / 2) });
  }
  placements.forEach(function (item) {
    item.el.style.right = "auto";
    item.el.style.left = Math.round(item.left) + "px";
    item.el.style.top = Math.round(top) + "px";
    item.el.style.setProperty("--ad-scale", String(scale));
  });
}



/* Run tetrisAdDebug() in the console to see exactly what the layout decided
   and, when no card is showing, why. */
window.tetrisAdDebug = function () {
  var L = railLayout();
  var vh = viewH();
  return {
    viewport: viewW() + " x " + vh,
    orientation: viewH() > viewW() ? "portrait" : "landscape",
    adSize: "gutters 300x600 (VERTICAL_BANNER); Level Complete popup 300x250 (MREC) — each scaled as one piece when needed",
    adsPlanned: L ? L.sides : 0,
    minWindowHeight: 608,
    fullSizeHeightOk: vh >= 608,
    boardFloor: BOARD_MIN_W_WITH_RAILS,
    leftShown: adRailLeft ? adRailLeft.style.display !== "none" : null,
    rightShown: adRailRight ? adRailRight.style.display !== "none" : null,
    why: L ? "ok" : "window too narrow (or below the phone floor) for a card"
  };
};

var fitTimer = null;
function scheduleFit() {
  clearTimeout(fitTimer);
  fitTimer = setTimeout(refitAfterViewportChange, 80);
}

/* The resize path, in the order the two steps have to happen.
   regridToViewport() decides whether the FIELD still suits the room (and
   rebuilds it if not); fitEverything() then scales and places everything
   against whatever field came out of that. Running them the other way round
   fits the old field and leaves the new one unplaced until the next resize —
   which is a resize that may never come. */
/* v95: "game over jb popup ata tou black box chota ho jata hai" -- and,
   specifically, "watch ad karne k baad" (after watching the continue ad).
   A result-style popup (.result-overlay: Game Over / Pause / Level Complete
   / Recover), the How to Play modal, or the fullscreen video ad overlay
   (#adOverlay) is scrollable/full-takeover content appearing over a
   fixed-position layer -- on a phone that alone is often enough for the
   browser's own address-bar chrome to show or hide, which fires the
   visualViewport "resize" listener below (scheduleFit -> here) with a
   SHORTER height than the game screen actually has. Regridding against
   that borrowed, temporary height rebuilds the play field smaller -- and
   nothing ever re-measures afterwards to grow it back, so the shrink
   outlives the popup/ad that caused it.
   #adOverlay matters on its own: clicking "Watch Ad & Continue" hides
   resultOverlay BEFORE the ad even starts playing, so a check that only
   knew about resultOverlay saw "nothing open" for the whole length of the
   ad -- the exact window the user reported the shrink happening in.
   While one of these is open the board is covered anyway, so there is
   nothing for a regrid to usefully do; skipping it here and catching up
   once the popup/ad actually closes (see watchOverlaysForRefit below) means
   the field is only ever sized against the real, settled viewport. */
function blockingOverlayOpen() {
  var ids = ["overlay", "confirmOverlay", "adOverlay"];
  for (var i = 0; i < ids.length; i++) {
    var el = document.getElementById(ids[i]);
    if (el && !el.classList.contains("hidden")) return true;
  }
  return false;
}

/* Rotation is NOT the case the v95 note above guards against, and must not
   be skipped. That note is about the browser's own chrome (address bar /
   toolbar) sliding in or out because a popup opened: it changes only the
   HEIGHT, and only temporarily. A portrait <-> landscape turn changes the
   WIDTH and the orientation, permanently — skipping it left the board, the
   bar and the ads at their PORTRAIT sizes behind a Game Over / Level
   Complete / ad screen opened before the turn (Pac-Man re-fits under its
   popups on every real change and only ignores a few-px wobble).
   So: while a popup is open, a height-only change is still ignored exactly
   as before; any change of orientation or width re-fits at once. */
var lastRefitW = viewW();
var lastRefitLandscape = viewW() > viewH();
function overlayRefitShouldWait() {
  if (!blockingOverlayOpen()) return false;
  var w = viewW(), land = w > viewH();
  return land === lastRefitLandscape && Math.abs(w - lastRefitW) < 3;
}

function refitAfterViewportChange() {
  if (overlayRefitShouldWait()) return;
  lastRefitW = viewW();
  lastRefitLandscape = lastRefitW > viewH();
  /* Re-render the level pill's text (full "Level 7" vs short "L7") since a
     rotation or resize can cross the mobile-portrait threshold mid-game. */
  if (levelBadgeGame && tetris && tetris.level) {
    levelBadgeGame.textContent = levelBadgeLabel(tetris.level);
  }
  /* Fit FIRST, then regrid, then fit again — three steps, and the leading
     one is not redundant.
     regridToViewport() measures #boardArea, whose height is "the column
     minus the header, the objective line, the controls row and the hint".
     Several of those settle only when fitEverything() runs: fitHeaderRow()
     decides whether the header is one line or two, and fitStatsRow() sizes
     the pills. Measuring before that pass reads the OLD chrome heights
     against the NEW window, so the grid comes out derived from an area that
     never existed — visible as a board that is a row or two short of
     filling, on exactly the windows where the header changes shape.
     The trailing fit is what scales and places the new field. */
  fitEverything();
  if (typeof regridToViewport === "function" && regridToViewport()) {
    fitEverything();
  }
}

/* ---------- Keep the cards attached to the board ----------
   The cards are positioned against the board's MEASURED box, so anything that
   moves the board after they are placed leaves them behind. Several things
   do, and each lands at its own moment: the ad images decoding, the stats row
   settling to its fitted size (which changes the header's height, and so the
   board's), a restore from the back/forward cache, and a cold load simply
   laying out in a different order to a warm one. That is why it showed up on
   REFRESH rather than every time.
   Rather than chase each trigger, the board itself is watched: whenever its
   box changes, the cards are placed again. The depth guard is what makes that
   safe — placing the cards can itself resize the board, so without it the
   observer and the fitter would keep waking each other up. */
var railFitDepth = 0;
function refitSideRails() {
  /* 8, was 2 — Pac-Man's ceiling. The ad band, the board's width and the
     header's tier feed each other; 2 passes was sometimes cut off before
     that settled, leaving the board at the size of the first, unconverged
     pass. A ceiling for the rare case, not a budget spent every time. */
  if (railFitDepth > 8) return;
  railFitDepth++;
  try {
    fitSideRailsToViewport();
  } finally {
    railFitDepth--;
  }
}

if (typeof ResizeObserver === "function") {
  var boardWatcher = new ResizeObserver(function () { refitSideRails(); });
  var boardEl = document.getElementById("canvas");
  if (boardEl) boardWatcher.observe(boardEl);
}

/* Companion to blockingOverlayOpen() above: refitAfterViewportChange() skips
   its work while a popup is open, so this is what catches up once it
   closes -- against the real viewport, not whatever it was while the popup
   was covering the screen. */
(function watchOverlaysForRefit() {
  if (typeof MutationObserver === "undefined") return;
  var ids = ["overlay", "confirmOverlay", "adOverlay"];
  ids.forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    var wasHidden = el.classList.contains("hidden");
    new MutationObserver(function () {
      var isHidden = el.classList.contains("hidden");
      if (!wasHidden && isHidden) {
        scheduleFit(); // just closed -- refit against the real viewport
      }
      wasHidden = isHidden;
    }).observe(el, { attributes: true, attributeFilter: ["class"] });
  });
})();

window.addEventListener("resize", scheduleFit);
window.addEventListener("orientationchange", function () {
  /* Same two-step as a resize (see refitAfterViewportChange): a rotation is
     the single biggest change of shape the board area ever sees, so it is the
     LAST place that should skip the regrid check.
     Pac-Man's pattern: one pass right away, plus an unconditional follow-up
     at 350ms for phones whose browser fires this event BEFORE it has finished
     re-laying the page out (the first read is the stale portrait size). The
     rotation watcher at the end of this file covers devices slower still. */
  scheduleFit();
  setTimeout(refitAfterViewportChange, 350);
});
window.addEventListener("load", refitSideRails);
// A back/forward-cache restore does not re-run the script, so it needs its own
window.addEventListener("pageshow", function () { refitSideRails(); });
if (document.fonts && document.fonts.ready) {
  /* Full pass, not just the rails: the merge decision is measured from the
     level name's and the buttons' real widths, and those are fallback-font
     widths until this resolves. */
  document.fonts.ready.then(function () { fitEverything(); });
}
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", scheduleFit);
}

/* Block any stray page-level dragging (pull-to-refresh, rubber-banding)
   while still allowing the level/shop lists to scroll internally. */
document.addEventListener(
  "touchmove",
  function (e) {
    var el = e.target;
    while (el && el !== document.body) {
      if (el.scrollHeight > el.clientHeight + 1) {
        var style = window.getComputedStyle(el).overflowY;
        if (style === "auto" || style === "scroll") return;
      }
      el = el.parentElement;
    }
    if (e.cancelable) e.preventDefault();
  },
  { passive: false }
);



fitEverything();
window.addEventListener("load", fitEverything);

/* =======================================================================
   ADS
   =======================================================================
   >>> THE ONLY BLOCK YOU NEED TO EDIT LATER IS "AD SOURCE CONFIG" BELOW <<<

   Two sources are supported:

   1. AD_SOURCE = "json"   (currently active)
      Ads are read from a JSON catalogue (sponsor-media.json). Works with no ad-server
      running — good for testing and for online creatives.
      -> Point AD_JSON_URL at your own hosted JSON when you have one:
             var AD_JSON_URL = "https://your-domain.com/sponsor-media.json";

   2. AD_SOURCE = "server"  (the live Airfi VOD ad-server)
      GET {base}/ads?ad_type=&placement=&device_type=&video_title=
      Response: { id, title, adType, campaignId, advertiser, duration,
                  isSkippable, nonSkippableSeconds, streamUrl }
      404 { error: "NO_ADS" } -> no ad available, the slot stays silent.
      -> Set AD_SERVER_DEFAULT to the confirmed Airfi host/port. For testing,
         index.html?adServer=http://10.0.0.5:3010 still overrides it, but only
         for an address adServerAllowed() accepts (this site, the default,
         localhost or a private LAN address) — so a link can never point the
         game at someone else's server. Add production hosts to
         AD_SERVER_ALLOWED_HOSTS.

   Both sources use the same ad object shape, so switching is a one-line
   change and nothing else in the game needs to be touched.
   ======================================================================= */

/* =========================== AD SOURCE CONFIG =========================== */
var AD_SOURCE = "json";                       // "json"  |  "server"
var AD_JSON_URL = "sponsor-media.json";       // same catalogue file Pac-Man uses
var AD_SERVER_DEFAULT = "http://localhost:3010"; // Airfi base URL (port TBC)
/* ======================================================================== */

var AD_ENDPOINT = "/ads";
var AD_SERVER_KEY = "tetrisAdServer";
var AD_LOAD_TIMEOUT_MS = 12000;

/* --- Ad placement rules ------------------------------------------------ */
function isAdGateLevel(level) {
  // Pac-Man's isAdGateLevel(): an ad on Next Level after every 3rd level.
  return level % 3 === 0;
}

/* Inline copy of sponsor-media.json — used only when that file cannot be
   read (for example when index.html is opened straight from disk with
   file://, where browsers block fetch). Keep the two identical. */
var AD_FALLBACK_CATALOGUE = {
  "ads": [
    {
      "id": "tt-continue-1",
      "adType": "video",
      "advertiser": "Continue Sponsor",
      "duration": 30,
      "isSkippable": true,
      "nonSkippableSeconds": 10,
      "streamUrl": "ad-video-3.mp4",
      "placements": [
        "continue"
      ]
    },
    {
      "id": "tt-continue-2",
      "adType": "video",
      "advertiser": "Continue Sponsor",
      "duration": 25,
      "isSkippable": true,
      "nonSkippableSeconds": 10,
      "streamUrl": "ad-video-6.mp4",
      "placements": [
        "continue"
      ]
    },
    {
      "id": "tt-restart-1",
      "adType": "video",
      "advertiser": "Restart Sponsor",
      "duration": 36,
      "isSkippable": true,
      "nonSkippableSeconds": 10,
      "streamUrl": "ad-video-4.mp4",
      "placements": [
        "restart"
      ]
    },
    {
      "id": "tt-restart-2",
      "adType": "video",
      "advertiser": "Restart Sponsor",
      "duration": 27,
      "isSkippable": true,
      "nonSkippableSeconds": 10,
      "streamUrl": "ad-video-5.mp4",
      "placements": [
        "restart"
      ]
    },
    {
      "id": "tt-levelgate-1",
      "adType": "video",
      "advertiser": "Level Sponsor",
      "duration": 16,
      "isSkippable": true,
      "nonSkippableSeconds": 10,
      "streamUrl": "ad-video-2.mp4",
      "placements": [
        "level_complete",
        "interstitial"
      ]
    },
    {
      "id": "tt-levelgate-2",
      "adType": "video",
      "advertiser": "Level Sponsor",
      "duration": 27,
      "isSkippable": true,
      "nonSkippableSeconds": 10,
      "streamUrl": "ad-video-5.mp4",
      "placements": [
        "level_complete",
        "interstitial"
      ]
    },
    {
      "id": "tt-recover-1",
      "adType": "video",
      "advertiser": "Progress Sponsor",
      "duration": 16,
      "isSkippable": true,
      "nonSkippableSeconds": 10,
      "streamUrl": "ad-video-2.mp4",
      "placements": [
        "level_recover"
      ]
    },
    {
      "id": "tt-recover-2",
      "adType": "video",
      "advertiser": "Progress Sponsor",
      "duration": 30,
      "isSkippable": true,
      "nonSkippableSeconds": 10,
      "streamUrl": "ad-video-3.mp4",
      "placements": [
        "level_recover"
      ]
    },
    {
      "id": "tt-recover-3",
      "adType": "video",
      "advertiser": "Progress Sponsor",
      "duration": 36,
      "isSkippable": true,
      "nonSkippableSeconds": 10,
      "streamUrl": "ad-video-4.mp4",
      "placements": [
        "level_recover"
      ]
    },
    {
      "id": "tt-recover-4",
      "adType": "video",
      "advertiser": "Progress Sponsor",
      "duration": 27,
      "isSkippable": true,
      "nonSkippableSeconds": 10,
      "streamUrl": "ad-video-5.mp4",
      "placements": [
        "level_recover"
      ]
    },
    {
      "id": "tt-recover-5",
      "adType": "video",
      "advertiser": "Progress Sponsor",
      "duration": 25,
      "isSkippable": true,
      "nonSkippableSeconds": 10,
      "streamUrl": "ad-video-6.mp4",
      "placements": [
        "level_recover"
      ]
    },
    {
      "id": "tt-recover-6",
      "adType": "video",
      "advertiser": "Progress Sponsor",
      "duration": 67,
      "isSkippable": true,
      "nonSkippableSeconds": 10,
      "streamUrl": "ad-video-1.mp4",
      "placements": [
        "level_recover"
      ]
    },
    {
      "id": "tt-banner-creditkey",
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
      "id": "tt-rail-creditkey",
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
      "imageUrl": "ad-creditkey-banner.png"
    },
    {
      "id": "tt-leader-creditkey",
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
      "id": "tt-rail-creditkey-2",
      "adType": "image",
      "adSize": "VERTICAL_BANNER",
      "advertiser": "Credit Key",
      "title": "Credit Key",
      "subtitle": "Buy Now, Pay On Your Terms",
      "rating": 4.5,
      "ctaText": "Learn more",
      "bgFrom": "#0b1450",
      "bgTo": "#1e3a8a",
      "streamUrl": "ad-creditkey-banner-2.png",
      "clickUrl": "",
      "placements": [
        "banner"
      ],
      "imageUrl": "ad-creditkey-banner-2.png"
    },
    {
      "id": "tt-rail-creditkey-3",
      "adType": "image",
      "adSize": "VERTICAL_BANNER",
      "advertiser": "Credit Key",
      "title": "Credit Key",
      "subtitle": "Buy Now, Pay On Your Terms",
      "rating": 4.5,
      "ctaText": "Learn more",
      "bgFrom": "#0b1450",
      "bgTo": "#1e3a8a",
      "streamUrl": "ad-creditkey-banner-3.png",
      "clickUrl": "",
      "placements": [
        "banner"
      ],
      "imageUrl": "ad-creditkey-banner-3.png"
    },
    {
      "id": "tt-leader-creditkey-2",
      "adType": "image",
      "adSize": "LEADER_BOARD",
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
      "imageUrl": "ad-creditkey-leaderboard-2.png"
    },
    {
      "id": "tt-leader-creditkey-3",
      "adType": "image",
      "adSize": "LEADER_BOARD",
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
      "imageUrl": "ad-creditkey-leaderboard-3.png"
    },
    {
      "id": "tt-banner-creditkey-2",
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
      "adSize": "MREC",
      "imageUrl": "ad-creditkey-mrec-2.png"
    },
    {
      "id": "tt-banner-creditkey-3",
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
      "adSize": "MREC",
      "imageUrl": "ad-creditkey-mrec-3.png"
    }
  ]
};

/* Hosts the ad-server address may point at, besides this site itself,
   AD_SERVER_DEFAULT and local/LAN test machines. */
var AD_SERVER_ALLOWED_HOSTS = [];

function adServerAllowed(base) {
  var u;
  try { u = new URL(base, window.location.href); } catch (e) { return false; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  if (u.origin === window.location.origin) return true;
  try { if (u.origin === new URL(AD_SERVER_DEFAULT).origin) return true; } catch (e) {}
  var h = u.hostname;
  if (AD_SERVER_ALLOWED_HOSTS.indexOf(h) !== -1) return true;
  return h === "localhost" || h === "127.0.0.1" || /^10\./.test(h) || /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h);
}

function getAdServerBase() {
  var fromQuery = null;
  try {
    fromQuery = new URLSearchParams(window.location.search).get("adServer");
  } catch (e) {}
  if (fromQuery && adServerAllowed(fromQuery)) {
    try { gameStore.setItem(AD_SERVER_KEY, fromQuery); } catch (e) {}
    return fromQuery.replace(/\/+$/, "");
  }
  var stored = null;
  try { stored = gameStore.getItem(AD_SERVER_KEY); } catch (e) {}
  if (stored && !adServerAllowed(stored)) stored = null;
  return (stored || AD_SERVER_DEFAULT).replace(/\/+$/, "");
}

/* ---------- Ad data is untrusted ----------
   Ads come from a JSON file or an ad server, and their text is placed into
   the page as HTML. Text is escaped where it is inserted (escHtml), and
   every ad passes through sanitizeAd() once, where it enters the game:
   links and media must be http(s) or a plain relative path (no
   javascript:, data: or other schemes), colours must be colours. */
function escHtml(v) {
  return String(v).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}
function safeAdUrl(u) {
  if (typeof u !== "string") return "";
  u = u.trim();
  if (/^https?:\/\//i.test(u)) return u;
  if (/^\/\//.test(u)) return "";                       // protocol-relative: refuse
  if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return "";          // any other scheme
  return u;                                                // relative path
}
function safeAdColor(c) {
  if (typeof c !== "string") return "";
  c = c.trim();
  return /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\)|[a-z]{3,20})$/i.test(c) ? c : "";
}
function sanitizeAd(ad) {
  if (!ad || typeof ad !== "object") return null;
  var out = Object.assign({}, ad);
  ["streamUrl", "imageUrl"].forEach(function (k) {
    if (k in out) { var v = safeAdUrl(out[k]); if (v) out[k] = v; else delete out[k]; }
  });
  if ("clickUrl" in out) {
    // A click opens a new tab: absolute http(s) only.
    if (typeof out.clickUrl === "string" && /^https?:\/\//i.test(out.clickUrl.trim())) out.clickUrl = out.clickUrl.trim();
    else delete out.clickUrl;
  }
  ["bgFrom", "bgTo"].forEach(function (k) {
    if (k in out) { var v = safeAdColor(out[k]); if (v) out[k] = v; else delete out[k]; }
  });
  ["title", "subtitle", "advertiser", "ctaText"].forEach(function (k) {
    if (k in out && out[k] != null) out[k] = String(out[k]);
  });
  if ("rating" in out) out.rating = Number(out.rating) || 0;
  return out;
}

/* Relative paths (like "/ad/:id") are resolved against the ad-server base;
   absolute http(s) URLs are used as-is. */
function resolveAdMediaUrl(streamUrl) {
  if (!streamUrl) return "";
  if (/^https?:\/\//i.test(streamUrl)) return streamUrl;
  if (AD_SOURCE === "json" && streamUrl.charAt(0) !== "/") return streamUrl; // local file
  return getAdServerBase() + (streamUrl.charAt(0) === "/" ? "" : "/") + streamUrl;
}

function adDeviceType() {
  return /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? "mobile" : "desktop";
}

function adIsImage(ad) {
  if (!ad) return false;
  if (ad.adType && String(ad.adType).toLowerCase() === "image") return true;
  return /\.(png|jpe?g|gif|webp|avif)(\?|$)/i.test(ad.streamUrl || "");
}

/* ---------- Source 1: JSON catalogue ---------- */
var adCataloguePromise = null;
var adRotation = {}; // one counter per placement, so ads rotate instead of repeat

function loadAdCatalogue() {
  if (adCataloguePromise) return adCataloguePromise;
  adCataloguePromise = fetch(AD_JSON_URL, { cache: "no-store" })
    .then(function (res) {
      if (!res.ok) throw new Error("bad status");
      return res.json();
    })
    .then(function (data) {
      if (!data || !data.ads || !data.ads.length) throw new Error("empty");
      return data;
    })
    .catch(function () {
      return AD_FALLBACK_CATALOGUE; // file:// or missing file -> use the built-in list
    });
  return adCataloguePromise;
}

function pickAdFromCatalogue(data, placement, wantImage) {
  var list = (data.ads || []).filter(function (ad) {
    if (!ad || !ad.streamUrl) return false;
    if (wantImage !== undefined && adIsImage(ad) !== wantImage) return false;
    if (ad.placements && ad.placements.length) return ad.placements.indexOf(placement) !== -1;
    return true;
  });
  if (!list.length) return null;
  var i = (adRotation[placement] || 0) % list.length;
  adRotation[placement] = (i + 1) % list.length;
  // A sanitized copy, tagged with its place in the rotation for the carousel dots.
  return Object.assign(sanitizeAd(list[i]), { _slot: i, _slots: list.length });
}

/* Fetch one ad. Resolves with the ad object, or null when none is available.
   opts: { placement, adType, wantImage } */
function fetchAd(opts) {
  opts = opts || {};
  var placement = opts.placement || "interstitial";

  if (AD_SOURCE !== "server") {
    return loadAdCatalogue().then(function (data) {
      return pickAdFromCatalogue(data, placement, opts.wantImage);
    });
  }

  var qs =
    "?ad_type=" + encodeURIComponent(opts.adType || "video") +
    "&placement=" + encodeURIComponent(placement) +
    "&device_type=" + encodeURIComponent(adDeviceType()) +
    "&video_title=" + encodeURIComponent("Tetris");

  return fetch(getAdServerBase() + AD_ENDPOINT + qs, { cache: "no-store" })
    .then(function (res) {
      if (!res.ok) return null; // includes 404 NO_ADS
      return res.json();
    })
    .then(function (ad) {
      ad = sanitizeAd(ad);
      if (!ad || !ad.streamUrl) return null;
      return ad;
    })
    .catch(function () {
      return null; // server down / offline -> stay silent
    });
}

/* ---------- Fullscreen interstitial / rewarded ad player ---------- */
var adOverlay = document.getElementById("adOverlay");
var adVideo = document.getElementById("adVideo");
var adImage = document.getElementById("adImage");
var adStatus = document.getElementById("adStatus");
var adBadge = document.getElementById("adBadge");
var adAdvertiser = document.getElementById("adAdvertiser");
var adCountdown = document.getElementById("adCountdown");
var adSkipBtn = document.getElementById("adSkipBtn");
var adUnmuteBtn = document.getElementById("adUnmuteBtn");
var adRewardNote = document.getElementById("adRewardNote");
var adResChip = document.getElementById("adRes");

var adIsPlaying = false;

/* Shows the creative's real pixel size in the semi-transparent chip. */
function showAdResolution(el, chipEl) {
  if (!el || !chipEl) return;
  var w = el.videoWidth || el.naturalWidth || 0;
  var h = el.videoHeight || el.naturalHeight || 0;
  chipEl.textContent = w && h ? w + " \u00D7 " + h : "";
}

function closeAdOverlay() {
  adIsPlaying = false;
  try {
    adVideo.pause();
    adVideo.removeAttribute("src");
    adVideo.load();
  } catch (e) {}
  adImage.removeAttribute("src");
  adImage.classList.add("hidden");
  adVideo.classList.add("hidden");
  adOverlay.classList.add("hidden");
  adOverlay.setAttribute("aria-hidden", "true");
  adSkipBtn.classList.add("hidden");
  adUnmuteBtn.classList.add("hidden");
  adCountdown.textContent = "";
  adResChip.textContent = "";
  adAdvertiser.textContent = "";
  adRewardNote.textContent = "";
}

/**
 * Play a fullscreen video ad.
 * opts: { placement, rewardText }
 * Always resolves (never rejects) with { shown: Boolean }.
 * When no ad is available the overlay closes instantly and the caller
 * continues as if the ad had been watched — the player is never blocked.
 */
function playVideoAd(opts) {
  opts = opts || {};
  return new Promise(function (resolve) {
    if (adIsPlaying) {
      resolve({ shown: false });
      return;
    }
    adIsPlaying = true;

    // Open the overlay in a loading state.
    adOverlay.classList.remove("hidden");
    adOverlay.setAttribute("aria-hidden", "false");
    adStatus.classList.remove("hidden");
    adStatus.textContent = "Loading ad\u2026";
    adBadge.textContent = "\u25CF Ad Playing"; // Pac-Man's badge text, from the first frame
    adSkipBtn.classList.add("hidden");
    adUnmuteBtn.classList.add("hidden");
    adCountdown.textContent = "";
    adResChip.textContent = "";
    adAdvertiser.textContent = "";
    adRewardNote.textContent = opts.rewardText || "";

    var settled = false;
    var loadTimer = null;
    var cleanup = function () {};

    function finish(shown) {
      if (settled) return;
      settled = true;
      clearTimeout(loadTimer);
      cleanup();
      closeAdOverlay();
      resolve({ shown: !!shown });
    }

    fetchAd({ placement: opts.placement || "interstitial", adType: "video" }).then(function (ad) {
      if (settled) return;
      if (!ad) {
        finish(false); // no ad available — silent, no error shown
        return;
      }

      var duration = Number(ad.duration) || 0;
      var skippable = ad.isSkippable === true;
      var skipAfter = Math.max(0, Number(ad.nonSkippableSeconds) || 0);

      adAdvertiser.textContent = ad.advertiser || ad.title || "";
      adBadge.textContent = "\u25CF Ad Playing"; // Pac-Man: "\u25CF Ad Playing"

      /* ---- Image creative: shown for `duration` seconds with a countdown ---- */
      if (adIsImage(ad)) {
        adVideo.classList.add("hidden");
        adImage.classList.remove("hidden");
        var imgSeconds = duration || 8;
        var imgTick = null;

        var onImgLoad = function () {
          adStatus.classList.add("hidden");
          showAdResolution(adImage, adResChip);
        };
        var onImgError = function () { finish(false); };
        var onImgSkip = function () { finish(true); };

        cleanup = function () {
          clearInterval(imgTick);
          adImage.removeEventListener("load", onImgLoad);
          adImage.removeEventListener("error", onImgError);
          adSkipBtn.removeEventListener("click", onImgSkip);
        };

        adImage.addEventListener("load", onImgLoad);
        adImage.addEventListener("error", onImgError);
        adSkipBtn.addEventListener("click", onImgSkip);
        adImage.src = resolveAdMediaUrl(ad.streamUrl);

        var left = imgSeconds;
        adCountdown.textContent = left + "s";
        imgTick = setInterval(function () {
          left--;
          adCountdown.textContent = Math.max(0, left) + "s";
          if (skippable && imgSeconds - left >= skipAfter) adSkipBtn.classList.remove("hidden");
          if (left <= 0) finish(true);
        }, 1000);

        loadTimer = setTimeout(function () {
          if (!settled && !adImage.complete) finish(false);
        }, AD_LOAD_TIMEOUT_MS);
        return;
      }

      /* ---- Video creative ---- */
      adImage.classList.add("hidden");
      adVideo.classList.remove("hidden");

      var onLoaded = function () {
        adStatus.classList.add("hidden");
        showAdResolution(adVideo, adResChip);
      };
      var onTime = function () {
        var total = duration || adVideo.duration || 0;
        var left = Math.max(0, Math.ceil(total - adVideo.currentTime));
        adCountdown.textContent = total ? left + "s" : "";
        if (skippable && adVideo.currentTime >= skipAfter) {
          adSkipBtn.classList.remove("hidden");
        } else if (skippable) {
          adSkipBtn.classList.add("hidden");
        }
      };
      var onEnded = function () { finish(true); };
      var onError = function () {
        if (adVideo.error) finish(false); // ignore stale/empty error events
      };
      var onSkip = function () { finish(true); };
      var onUnmute = function () {
        adVideo.muted = false;
        adVideo.volume = 1;
        adUnmuteBtn.classList.add("hidden");
      };

      var tryPlay = function () {
        var p = adVideo.play();
        if (!p || typeof p.catch !== "function") return;
        p.catch(function (err) {
          if (err && err.name === "NotAllowedError") {
            // Browser blocked sound-on autoplay — fall back to muted playback.
            adVideo.muted = true;
            adUnmuteBtn.classList.remove("hidden");
            var retry = adVideo.play();
            if (retry && typeof retry.catch === "function") retry.catch(function () {});
          }
          // AbortError etc: harmless, "canplay" retries below.
        });
      };
      var onCanPlay = function () {
        if (adVideo.paused) tryPlay();
      };

      cleanup = function () {
        adVideo.removeEventListener("loadedmetadata", onLoaded);
        adVideo.removeEventListener("timeupdate", onTime);
        adVideo.removeEventListener("ended", onEnded);
        adVideo.removeEventListener("error", onError);
        adVideo.removeEventListener("canplay", onCanPlay);
        adSkipBtn.removeEventListener("click", onSkip);
        adUnmuteBtn.removeEventListener("click", onUnmute);
      };

      adVideo.addEventListener("loadedmetadata", onLoaded);
      adVideo.addEventListener("timeupdate", onTime);
      adVideo.addEventListener("ended", onEnded);
      adVideo.addEventListener("error", onError);
      adVideo.addEventListener("canplay", onCanPlay);
      adSkipBtn.addEventListener("click", onSkip);
      adUnmuteBtn.addEventListener("click", onUnmute);

      adVideo.muted = false;
      adVideo.src = resolveAdMediaUrl(ad.streamUrl); // follows the 302 itself
      tryPlay();

      // Bail out if the media never starts (bad URL, offline server, ...).
      loadTimer = setTimeout(function () {
        if (!settled && adVideo.currentTime === 0) finish(false);
      }, AD_LOAD_TIMEOUT_MS);
    });
  });
}

/* ---------- Side rail static image ads (browser gutters, wide screens) ----
   VERTICAL_BANNER 300x600 cards centred in the left/right gutter beside the
   board — the only real empty space on a wide game screen.
   These same #adRailLeft/#adRailRight elements are also used for
   the Game Over screen; the SAME creative just keeps showing there too
   (no separate reload/swap on loss), so the ad never changes out from
   under the player mid-attempt. Hidden below 1080px width, where there's
   no real gutter to use (see hideAllScreens() / hideGameOverAds() for the
   phone/tablet Game-Over-only inline card instead). */
function loadBannerAd() {
  loadGameplaySideRails();
  loadLeaderboardAd();
}

function loadGameplaySideRails() {
  // Never let the previous screen's creative survive the transition.
  [adRailLeft, adRailRight].forEach(function (el) {
    if (!el) return;
    el.classList.add("hidden");
    el.classList.remove("ad-ready");
    el.innerHTML = "";
    el.style.background = "";
  });

  var pending = [];
  [adRailLeft, adRailRight].forEach(function (el) {
    if (!el) return;
    pending.push(fetchAd({ placement: "banner", adType: "image", wantImage: true }).then(function (ad) {
      if (!ad || !adIsImage(ad)) return;
      buildRailCard(el, ad);
    }));
  });

  Promise.all(pending).then(function () {
    if (!gameScreen || gameScreen.classList.contains("hidden")) return;
    if (typeof fitSideRailsToViewport === "function") fitSideRailsToViewport();
    startRailCarousel();
  });
}

/* ---------- LEADER_BOARD 970x90 static ad (phone/narrow-portrait fallback,
   above the board) ----------
   Fetched independently of the two side rails: whichever slot actually has
   a real gutter to show in is decided by fitPortraitAd()/fitSideRailsToViewport()
   at layout time, not here — this only gets the creative onto the element
   so a placement pass has something to show the moment it needs to. */
function loadLeaderboardAd() {
  if (!adLeaderboardEl) return;
  fetchAd({ placement: "leaderboard", adType: "image", wantImage: true }).then(function (ad) {
    if (!ad) {
      adLeaderboardEl.innerHTML = "";
      hideLeaderboardTop();
      return;
    }
    buildLeaderboardCard(adLeaderboardEl, ad);
    // Content just arrived — re-run the placement decision now that there
    // is something to show (the earlier pass, at page load, found the slot
    // empty and left it hidden with no band reserved).
    if (typeof fitSideRailsToViewport === "function") fitSideRailsToViewport();
    /* fitSideRailsToViewport() is what just grew --rail-reserve-top from 0
       to the leaderboard card's height (see placeLeaderboardTop()), which
       shrinks the box #boardArea has to work with. But the board itself was
       already sized by fitBoardToViewport() BEFORE that reservation existed
       — at the original page-load pass, this ad had not arrived yet, so the
       board was fit to the full, unreserved height. Nothing re-ran that fit
       afterwards, so the board kept its old, too-tall size and simply ran
       past the bottom of the now-shorter box, clipped by #boardArea's own
       overflow:hidden ("block bilkul neechay ghus gaya dikh hi nhi raha").
       Re-fitting here, the same header-then-board order fitEverything()
       uses, shrinks the board down to what actually still fits. */
    if (typeof fitBoardToViewport === "function") fitBoardToViewport();
  });
}

/* =======================================================================
   CAROUSELS — every image placement rotates to its next creative every 5s
   instead of sitting on one, exactly the beat Pac-Man's rail/leaderboard/
   modal-banner carousels run on. Self-stopping: each tick checks the slot
   is still actually visible before both fetching and painting, so a missed
   call to stop*Carousel() never leaves a timer quietly ticking against a
   card nobody can see.
   ======================================================================= */
/* One dot per creative in the rotation, the one showing highlighted. (It was
   always three dots with the second lit, whatever was on screen.) */
function adDotsHtml(ad) {
  if (!ad || !(ad._slots > 1)) return "";
  var h = '<div class="ad-dots" aria-hidden="true">';
  for (var i = 0; i < ad._slots; i++) h += '<i class="' + (i === ad._slot ? "on" : "") + '"></i>';
  return h + "</div>";
}

function slideRailCard(el, ad) {
  if (!el || !ad) return Promise.resolve();
  if (!ad.imageUrl) { buildRailCard(el, ad); return Promise.resolve(); }
  var oldImg = el.querySelector('.ad-unit-img');
  if (!oldImg) { buildRailCard(el, ad); return Promise.resolve(); }
  el.classList.add('ad-sliding');
  var track = document.createElement('div');
  track.className = 'ad-slide-track';
  var current = oldImg.cloneNode(true);
  var next = document.createElement('img');
  next.className = 'ad-unit-img'; next.width = 300; next.height = 600;
  next.alt = ad.advertiser || 'Advertisement'; next.src = resolveAdMediaUrl(ad.imageUrl);
  track.appendChild(current); track.appendChild(next);
  el.innerHTML = ''; el.appendChild(track); el.insertAdjacentHTML('beforeend', adDotsHtml(ad));
  el.style.background = ad.bgFrom || '#1b2437';
  el.classList.toggle('ad-rail--clickable', !!ad.clickUrl);
  el.onclick = ad.clickUrl ? function(){ window.open(ad.clickUrl, '_blank', 'noopener'); } : null;
  return new Promise(function(resolve){
    requestAnimationFrame(function(){ requestAnimationFrame(function(){ track.classList.add('slide-next'); }); });
    setTimeout(function(){
      el.innerHTML = '<img class="ad-unit-img" src="' + escHtml(resolveAdMediaUrl(ad.imageUrl)) + '" width="300" height="600" alt="' + escHtml(ad.advertiser || 'Advertisement') + '" />' + adDotsHtml(ad);
      el.classList.remove('ad-sliding'); resolve();
    }, 430);
  });
}

function slideLeaderboardCard(el, ad) {
  if (!el || !ad) return Promise.resolve();
  if (!ad.imageUrl) { buildLeaderboardCard(el, ad); return Promise.resolve(); }
  var oldImg = el.querySelector('.ad-unit-img');
  if (!oldImg) { buildLeaderboardCard(el, ad); return Promise.resolve(); }
  el.classList.add('ad-sliding');
  var track = document.createElement('div'); track.className = 'ad-slide-track';
  var current = oldImg.cloneNode(true);
  var next = document.createElement('img');
  next.className='ad-unit-img'; next.width=970; next.height=90; next.alt=ad.advertiser || 'Advertisement'; next.src=resolveAdMediaUrl(ad.imageUrl);
  track.appendChild(current); track.appendChild(next);
  el.innerHTML=''; el.appendChild(track); el.insertAdjacentHTML('beforeend', adDotsHtml(ad));
  el.classList.add('has-image-ad'); el.style.background=ad.bgFrom || '#1b2437';
  el.classList.toggle('clickable', !!ad.clickUrl); el.onclick=ad.clickUrl ? function(){window.open(ad.clickUrl,'_blank','noopener');} : null;
  return new Promise(function(resolve){
    requestAnimationFrame(function(){requestAnimationFrame(function(){track.classList.add('slide-next');});});
    setTimeout(function(){
      el.innerHTML='<img class="ad-unit-img" src="'+escHtml(resolveAdMediaUrl(ad.imageUrl))+'" width="970" height="90" alt="'+escHtml(ad.advertiser || 'Advertisement')+'" />'+adDotsHtml(ad);
      el.classList.remove('ad-sliding'); resolve();
    },430);
  });
}

var railCarouselTimer = null;
var modalBannerCarouselTimer = null;

function stopRailCarousel() {
  if (railCarouselTimer) {
    clearInterval(railCarouselTimer);
    railCarouselTimer = null;
  }
}

function startRailCarousel() {
  if (railCarouselTimer) return; // already running
  railCarouselTimer = setInterval(function () {
    var shown = [adRailLeft, adRailRight].filter(function (el) {
      return el && !el.classList.contains("hidden");
    });
    if (!shown.length) {
      stopRailCarousel();
      return;
    }
    // One fetch per visible card, chained so the round-robin advances once
    // per card rather than both landing on the same returned ad.
    var chain = Promise.resolve();
    shown.forEach(function (el) {
      chain = chain.then(function () {
        return fetchAd({ placement: "banner", adType: "image", wantImage: true }).then(function (ad) {
          if (!ad || !adIsImage(ad) || el.classList.contains("hidden")) return;
          return slideRailCard(el, ad);
        });
      });
    });
  }, 5000);
}

/* ---------- Leaderboard carousel ----------
   Same 5s beat and the same self-stopping shape as startRailCarousel()
   above: every tick checks the card is still actually on screen (is-shown)
   before fetching and painting, so a missed call to stopLeaderboardCarousel()
   never leaves a timer quietly ticking against a card nobody can see. */
var leaderboardCarouselTimer = null;

function stopLeaderboardCarousel() {
  if (leaderboardCarouselTimer) {
    clearInterval(leaderboardCarouselTimer);
    leaderboardCarouselTimer = null;
  }
}

function startLeaderboardCarousel() {
  if (leaderboardCarouselTimer) return; // already running
  leaderboardCarouselTimer = setInterval(function () {
    if (!adLeaderboardEl || !adLeaderboardEl.classList.contains("is-shown")) {
      stopLeaderboardCarousel();
      return;
    }
    fetchAd({ placement: "leaderboard", adType: "image", wantImage: true }).then(function (ad) {
      // Re-check on the far side of the fetch — the card may have been
      // hidden (rotation, popup) while it was in flight.
      if (!ad || !adLeaderboardEl.classList.contains("is-shown")) return;
      slideLeaderboardCard(adLeaderboardEl, ad);
      /* Re-running the full placement (scale, left, top, the reserved
         band) rather than trusting the box to still be exactly where the
         first placement left it — same reasoning as re-running
         fitSideRailsToViewport() after a rail carousel tick. */
      placeLeaderboardTop();
    });
  }, 5000);
}

function stopModalBannerCarousel() {
  if (modalBannerCarouselTimer) {
    clearInterval(modalBannerCarouselTimer);
    modalBannerCarouselTimer = null;
  }
}

function startModalBannerCarousel() {
  if (modalBannerCarouselTimer) return; // already running
  modalBannerCarouselTimer = setInterval(function () {
    var overlayEl = document.getElementById("overlay");
    if (
      !levelCompleteBannerEl ||
      levelCompleteBannerEl.classList.contains("hidden") ||
      !overlayEl ||
      overlayEl.classList.contains("hidden")
    ) {
      stopModalBannerCarousel();
      return;
    }
    fetchModalBannerAd().then(function (ad) {
      if (!ad) return;
      if (levelCompleteBannerEl.classList.contains("hidden")) return;
      if (overlayEl.classList.contains("hidden")) {
        stopModalBannerCarousel();
        return;
      }
      swapModalBannerCard(levelCompleteBannerEl, ad);
    });
  }, 5000);
}

/* ---------- Static banner ad shown inside the Level Complete popup ---------- */
var levelCompleteBannerEl = document.getElementById("modalBannerAd");

/* Pac-Man's buildBannerCard() for the Congratulations MREC: one <img> at the
   exact IAB 300x250, plus its slot dots, in Pac-Man's own markup
   (.banner-ad-card / .ad-unit-img / .ad-dots, "pm-" prefixed). The unit
   scales down as a whole on narrow popups (CSS), keeping 6:5. */
function fetchModalBannerAd() {
  return fetchAd({ placement: "level_complete_banner", wantImage: true }).catch(function () { return null; });
}
function modalBannerDotsHtml(ad) {
  if (!ad || !(ad._slots > 1)) return "";
  var h = '<div class="pm-ad-dots" aria-hidden="true">';
  for (var i = 0; i < ad._slots; i++) h += "<i" + (i === ad._slot ? ' class="pm-on"' : "") + "></i>";
  return h + "</div>";
}
function buildModalBannerCard(el, ad) {
  el.className = "pm-banner-ad-card";
  el.removeAttribute("aria-hidden");
  el.onclick = ad.clickUrl ? function () { window.open(ad.clickUrl, "_blank", "noopener"); } : null;
  el.innerHTML =
    '<img class="pm-ad-unit-img" src="' + escHtml(resolveAdMediaUrl(ad.imageUrl || ad.streamUrl)) + '" width="300" height="250" alt="' +
    escHtml(ad.advertiser || "Advertisement") + '" />' + modalBannerDotsHtml(ad);
}
/* Pac-Man's swapAdCard(): fade out, swap, fade back in. */
function swapModalBannerCard(el, ad) {
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce || !el.innerHTML) { buildModalBannerCard(el, ad); return; }
  el.classList.add("pm-ad-fading");
  setTimeout(function () {
    buildModalBannerCard(el, ad);
    el.classList.add("pm-ad-fading");
    requestAnimationFrame(function () { requestAnimationFrame(function () { el.classList.remove("pm-ad-fading"); }); });
  }, 260);
}

function hideLevelCompleteBannerAd() {
  if (!levelCompleteBannerEl) return;
  levelCompleteBannerEl.className = "pm-banner-ad-card hidden";
  levelCompleteBannerEl.setAttribute("aria-hidden", "true");
  levelCompleteBannerEl.onclick = null;
  levelCompleteBannerEl.innerHTML = "";
  stopModalBannerCarousel();
}

function loadLevelCompleteBannerAd() {
  if (!levelCompleteBannerEl) return;
  fetchModalBannerAd().then(function (ad) {
    if (!ad) {
      hideLevelCompleteBannerAd(); // nothing configured — keep the slot out of the layout
      stopModalBannerCarousel();
      return;
    }
    buildModalBannerCard(levelCompleteBannerEl, ad);
    // Card is up — start rotating it, same 5s beat as the side rails.
    startModalBannerCarousel();
  });
}

/* =======================================================================
   STATIC IMAGE ADS — two app-install cards floating in the gutters either
   side of the board, at the one and only static size, VERTICAL_BANNER
   300x600. They run during play and stay up through Game Over. Where the
   gutters cannot take a real 300x600, no static card is shown.
   ======================================================================= */
var adRailLeft = document.getElementById("adRailLeft");
var adRailRight = document.getElementById("adRailRight");
var adLeaderboardEl = document.getElementById("adLeaderboard");

function starString(rating) {
  var rounded = Math.round(rating || 4.5);
  return "\u2605".repeat(Math.min(5, rounded)) + "\u2606".repeat(Math.max(0, 5 - rounded));
}

/* ---------- railCardHtml / buildRailCard — identical to Pac-Man's ----------
   A creative with `imageUrl` is a whole-unit STATIC IMAGE: one file that is
   already the full 300x600, drawn as a single <img> and nothing else — that
   is what an IAB static unit is, and it removes every way a card could come
   out blank (no gradient to compute, no icon to place, no text to lay out).
   Creatives without `imageUrl` get the assembled card instead, built to the
   same 300x600 box, same classes, same solid (not gradient) background as
   Pac-Man's side rails — so the two games' carousels are visually the same
   card, not two different designs sharing a name. */
function railCardHtml(ad) {
  var stars = starString(ad.rating);
  return (
    '<div class="ad-rail-art">' +
      '<span class="ad-rail-tag">AD</span>' +
      '<div class="ad-rail-icon"><img alt="" src="' + escHtml(resolveAdMediaUrl(ad.streamUrl)) + '"></div>' +
      '<div class="ad-rail-title">' + escHtml(ad.title || ad.advertiser || "Sponsored") + "</div>" +
      '<div class="ad-rail-stars">' + stars + "</div>" +
      '<div class="ad-rail-subtitle">' + escHtml(ad.subtitle || "Free \u00b7 Sponsored") + "</div>" +
      '<div class="ad-rail-sponsored">Sponsored</div>' +
    "</div>" +
    '<button type="button" class="ad-rail-cta">' + escHtml(ad.ctaText || "Learn More") + "</button>"
  );
}

function buildRailCard(el, ad) {
  ad = ad || {};
  el.classList.add("hidden");
  el.classList.remove("ad-ready");
  el.classList.toggle("ad-rail--clickable", !!ad.clickUrl);
  el.onclick = ad.clickUrl
    ? function () { window.open(ad.clickUrl, "_blank", "noopener"); }
    : null;
  el.classList.remove("hidden");
  el.setAttribute("aria-hidden", "false");

  if (ad.imageUrl) {
    el.style.background = ad.bgFrom || "#1b2437";
    el.innerHTML =
      '<img class="ad-unit-img" src="' + escHtml(resolveAdMediaUrl(ad.imageUrl)) + '" width="300" height="600" alt="' +
      escHtml(ad.advertiser || "Advertisement") + '" />' + adDotsHtml(ad);
    var img = el.querySelector(".ad-unit-img");
    var reveal = function () {
      if (!img || !img.isConnected) return;
      el.classList.remove("hidden");
      el.classList.add("ad-ready");
      el.setAttribute("aria-hidden", "false");
      if (typeof fitSideRailsToViewport === "function") fitSideRailsToViewport();
    };
    if (img.complete && img.naturalWidth) reveal();
    else img.addEventListener("load", reveal, { once: true });
    return;
  }

  // Solid background, not a gradient — a two-colour diagonal across a card
  // this small, scaled down further on a narrow window, reads as mismatched
  // colour bands rather than one ad unit.
  el.style.background = ad.bgFrom || "#6a3fb5";
  el.innerHTML = railCardHtml(ad);
  el.classList.remove("hidden");
  el.classList.add("ad-ready");
  el.setAttribute("aria-hidden", "false");
}

/* ---------- leaderboardCardHtml / buildLeaderboardCard ----------
   Same assembled-card idea as railCardHtml() above, laid out as a row
   instead of a column: tag, icon, title+subtitle, CTA, left to right —
   identical to Pac-Man's LEADER_BOARD card. There is no bundled 970x90
   raster creative, so unlike buildRailCard() this always draws the
   assembled version, never a whole-unit <img>. */
function leaderboardCardHtml(ad) {
  return (
    '<span class="ad-leaderboard-tag">AD</span>' +
    '<div class="ad-leaderboard-icon"><img alt="" src="' + escHtml(resolveAdMediaUrl(ad.streamUrl)) + '"></div>' +
    '<div class="ad-leaderboard-text">' +
      '<div class="ad-leaderboard-title">' + escHtml(ad.title || ad.advertiser || "Sponsored") + "</div>" +
      '<div class="ad-leaderboard-subtitle">' + escHtml(ad.subtitle || "Free \u00b7 Sponsored") + "</div>" +
    "</div>" +
    '<button type="button" class="ad-leaderboard-cta">' + escHtml(ad.ctaText || "Learn More") + "</button>"
  );
}

function buildLeaderboardCard(el, ad) {
  if (!el || !ad) return;
  el.classList.add("hidden");
  el.classList.remove("ad-ready");
  el.classList.toggle("clickable", !!ad.clickUrl);
  el.classList.toggle("has-image-ad", !!ad.imageUrl);
  el.onclick = ad.clickUrl
    ? function () { window.open(ad.clickUrl, "_blank", "noopener"); }
    : null;
  if (ad.imageUrl) {
    el.style.background = ad.bgFrom || "#1b2437";
    el.innerHTML = '<img class="ad-unit-img" src="' + escHtml(resolveAdMediaUrl(ad.imageUrl)) + '" width="970" height="90" alt="' + escHtml(ad.advertiser || "Advertisement") + '" />' + adDotsHtml(ad);
    var img = el.querySelector(".ad-unit-img");
    var reveal = function () {
      if (!img || !img.isConnected) return;
      el.classList.remove("hidden");
      el.classList.add("ad-ready");
      el.setAttribute("aria-hidden", "false");
      if (typeof fitSideRailsToViewport === "function") fitSideRailsToViewport();
    };
    if (img.complete && img.naturalWidth) reveal();
    else img.addEventListener("load", reveal, { once: true });
    return;
  }
  el.style.background = ad.bgFrom || "#6a3fb5";
  el.innerHTML = leaderboardCardHtml(ad);
  el.classList.remove("hidden");
  el.classList.add("ad-ready");
}

/* Called whenever the app leaves the Game Over screen, from anywhere. */
/* Hides just the two side rails — used while the Congratulations popup is
   open, so it isn't competing for attention with ads on both sides. The
   rails come back (with fresh content) once play resumes: loadBannerAd()
   is already called from every path that leaves this popup (Next Level,
   the continue-ad flow, etc.), and buildRailCard() un-hides them itself. */
function hideSideRails() {
  stopRailCarousel();
  [adRailLeft, adRailRight].forEach(function (el) {
    if (!el) return;
    el.classList.add("hidden");
    el.classList.remove("ad-ready");
    el.innerHTML = "";
    el.style.background = "";
  });
  // Same treatment for the phone/narrow-portrait fallback — hidden while
  // the popup is up, and it comes back (with fresh content) the next time
  // loadBannerAd() runs, same as the two side rails.
  stopLeaderboardCarousel();
  if (adLeaderboardEl) {
    adLeaderboardEl.classList.remove("is-shown", "ad-ready");
    adLeaderboardEl.classList.add("hidden");
    adLeaderboardEl.innerHTML = "";
    adLeaderboardEl.style.background = "";
  }
  /* fitPortraitAd() left-aligns .game-screen (align-self) to make room for
     the single right-side ad instead of centring it — see the comment on
     that override in fitPortraitAd(). It only ever gets set back to normal
     by that same function running again with a fresh, ad-qualifying
     measurement, which does not happen on every path away from the game
     screen. Clearing it here, alongside the rest of the rail cleanup,
     means the start/level-select/shop screens always get the plain
     centred .game-screen back regardless of which button left the game. */
  if (gameScreen) gameScreen.style.alignSelf = "";
}

function hideGameOverAds() {
  stopRailCarousel();
  [adRailLeft, adRailRight].forEach(function (el) {
    if (!el) return;
    el.classList.add("hidden");
    el.setAttribute("aria-hidden", "true");
    el.onclick = null;
    el.innerHTML = "";
    el.style.background = "";
  });
  stopLeaderboardCarousel();
  if (adLeaderboardEl) {
    adLeaderboardEl.classList.remove("is-shown");
    adLeaderboardEl.onclick = null;
    adLeaderboardEl.innerHTML = "";
    adLeaderboardEl.style.background = "";
  }
  document.body.style.setProperty("--rail-reserve-top", "0px");
}

/* ---------- Game over: unlimited ad-powered continues ----------
   Watch Ad & Continue is offered on EVERY Game Over -- there is no cap. */
var continueAdInFlight = false; // guards a double-click while the ad plays
var continueAdBtn = document.getElementById("continueAdBtn");
var continueNote = document.getElementById("continueNote");

function refreshContinueButton() {
  if (!continueAdBtn || !continueNote) return;
  // Always offered -- no limit on ad-based continues.
  continueAdBtn.classList.remove("hidden");
  continueAdBtn.disabled = false;
  continueNote.classList.remove("hidden");
  continueNote.textContent = "Watch a short ad to pick up right where you were.";
}

if (continueAdBtn) {
  continueAdBtn.addEventListener("click", function () {
    if (continueAdInFlight) return;
    continueAdInFlight = true;
    continueAdBtn.disabled = true;
    resultOverlay.classList.add("hidden");
    setRailsHiddenForOverlay(false);
    hideGameOverAds();
    playVideoAd({
      placement: "continue",
      rewardText: "Watch the ad to continue this run \u2014 score and level are kept."
    }).then(function () {
      continueAdInFlight = false;
      // Resume the same run: board wiped, score / level / lines-so-far kept.
      // (It used to go through the next-level reset, which zeroed the lines
      // already cleared on this level.)
      tetris.clearBoard();
      tetris.initShapes();
      isPlaying = true;
      tetris.isActive = 1;
      tetris.play();
      loadBannerAd();
      // No toast here: play has already resumed, and Pac-Man's continue
      // doesn't pop anything over the game either.
    });
  });
}

/* ---------- Unlock a single locked level by watching ads ----------
   Pac-Man's unlock flow, same to same (showUnlockConfirm() +
   unlockLevelViaAds() in Pac-Man's script.js):
     1. Tapping an ad-unlockable locked level (Select Level tile, in-game
        Prev / Next, the Congratulations popup's Previous) does NOT start the
        ads. It pops the confirmation dialog first — "📺 Unlock Level N",
        "Watch 5 ads to unlock this level and continue the game.", "You'll
        watch 5 short ads back to back, then Level N unlocks and you can play
        it." — so the player opts in.
     2. Cancel just closes the dialog. Whatever was behind it (e.g. the
        Congratulations popup) is left exactly as it was.
     3. OK closes the dialog, runs the caller's onConfirm (its chance to
        dismiss its own popup now that the player has committed), and plays
        UNLOCK_ADS_REQUIRED video ads back to back — never fewer, and none
        can be tapped past, because each one waits on the previous ad's
        promise. While they play the whole level grid is disabled.
     4. After the fifth, ONLY that level is unlocked (nothing before or
        after it changes) and the player is dropped straight into it.
   Which levels are ad-unlockable is the same rule Pac-Man uses — see
   isLevelAdUnlockable() at the top of this file. The ads themselves are
   Tetris's own "level_recover" creatives, played by the same playVideoAd()
   every other ad in the game uses (skippable after 10 seconds, exactly like
   Pac-Man's "recover" ads). */
var UNLOCK_ADS_REQUIRED = RECOVER_ADS_REQUIRED; // 5
var levelUnlockInProgress = false;

var confirmOverlayEl = document.getElementById("confirmOverlay");
var confirmTitleEl = document.getElementById("confirmTitle");
var confirmMessageEl = document.getElementById("confirmMessage");
var confirmSubMessageEl = document.getElementById("confirmSubMessage");
var confirmOkBtn = document.getElementById("confirmOkBtn");
var confirmCancelBtn = document.getElementById("confirmCancelBtn");

function showUnlockConfirm(level, opts) {
  var onConfirm = opts && opts.onConfirm ? opts.onConfirm : null;
  var onCancel = opts && opts.onCancel ? opts.onCancel : null;
  if (levelUnlockInProgress) { if (onCancel) onCancel(); return; }
  if (!confirmOverlayEl) {
    // Safety net: if the dialog markup is ever missing, fall straight
    // through to the ad sequence rather than stranding the player on a
    // tile that does nothing.
    if (onConfirm) onConfirm();
    unlockLevelViaAds(level);
    return;
  }

  confirmTitleEl.textContent = "\u{1F4FA} Unlock Level " + level;
  confirmMessageEl.textContent =
    "Watch " + UNLOCK_ADS_REQUIRED + " ads to unlock this level and continue the game.";
  if (confirmSubMessageEl) {
    confirmSubMessageEl.textContent =
      "You'll watch " + UNLOCK_ADS_REQUIRED + " short ads back to back, then Level " + level + " unlocks and you can play it.";
    confirmSubMessageEl.classList.remove("hidden");
  }

  // Clone-and-replace: guarantees a stale OK / Cancel handler from the last
  // tile the player tapped is gone before the new one is wired, so the
  // right level always gets unlocked.
  var freshOk = confirmOkBtn.cloneNode(true);
  confirmOkBtn.replaceWith(freshOk);
  confirmOkBtn = freshOk;
  var freshCancel = confirmCancelBtn.cloneNode(true);
  confirmCancelBtn.replaceWith(freshCancel);
  confirmCancelBtn = freshCancel;

  var close = function () { confirmOverlayEl.classList.add("hidden"); };

  confirmOkBtn.addEventListener("click", function () {
    close();
    if (onConfirm) onConfirm();
    unlockLevelViaAds(level);
  });
  confirmCancelBtn.addEventListener("click", function () {
    close();
    if (onCancel) onCancel();
  });

  confirmOverlayEl.classList.remove("hidden");
}

function unlockLevelViaAds(level) {
  if (levelUnlockInProgress) return;
  levelUnlockInProgress = true;
  buildLevelGrid(); // redraw so every tile is briefly non-interactive while ads play

  var watched = 0;
  function playNext() {
    watched++;
    return playVideoAd({
      placement: "level_recover",
      rewardText: "Watching ad " + watched + " of " + UNLOCK_ADS_REQUIRED + " to unlock Level " + level + "\u2026"
    }).then(function () { return watched < UNLOCK_ADS_REQUIRED ? playNext() : null; });
  }

  playNext().then(function () {
    levelUnlockInProgress = false;
    unlockLevelOnly(level); // unlocks ONLY this level — nothing before it changes
    buildLevelGrid(); // redraw: level+1 immediately drops off the ads list
    chosenStartLevel = level;
    showGameScreen(); // Pac-Man: startLevel(level)
  });
}

function closeRecoverModal() {
  if (confirmOverlayEl) confirmOverlayEl.classList.add("hidden");
}

/* ---------- Ad self-check ----------------------------------------------
   Run  adCheck()  in the browser console on the game screen to see, in one
   line, exactly what the ad layout decided and why. */
function adCheck() {
  function box(el) {
    if (!el) return "missing";
    var cs = getComputedStyle(el);
    var r = el.getBoundingClientRect();
    if (cs.display === "none") return "hidden (display)";
    if (cs.visibility === "hidden") return "hidden (dialog open)";
    if (!el.innerHTML) return "empty (no creative loaded)";
    return Math.round(r.width) + "x" + Math.round(r.height);
  }
  var L = railLayout();
  var sp = railSpacing();
  var minW = 2 * (sp.edge + AD_SIZES.VERTICAL_BANNER.w + sp.gap) + BOARD_MIN_W_WITH_RAILS;
  var minH = AD_SIZES.VERTICAL_BANNER.h + 8;

  var exactFits = viewW() >= minW && viewH() >= minH;
  var why;
  if (!L) {
    why = "no room for the cards at all on this window";
  } else if (exactFits) {
    why = "ok - true 300x600";
  } else {
    why = "window too small for a true 300x600 (needs " + minW + "x" + minH +
      ", has " + viewW() + "x" + viewH() +
      ") - card shown scaled, same 1:2 shape";
  }

  var info = {
    viewport: viewW() + "x" + viewH(),
    needsAtLeast: minW + "x" + minH,
    verdict: why,
    adSource: AD_SOURCE,
    sideCardLeft: box(adRailLeft),
    sideCardRight: box(adRailRight),
    levelCompleteCard: box(levelCompleteBannerEl) + " (MREC 300x250)"
  };
  console.table(info);
  return info;
}
window.adCheck = adCheck;

/* ======================================================================
   PAC-MAN BOARD/AD ALIGNMENT OVERRIDE — TETRIS
   Match the verified Pac-Man screenshot geometry: side banner cards start
   at the board's top edge and end at its bottom edge; the stats/control bar
   extends under the complete ad + board group. Ad creatives remain native
   300x600 and are uniformly scaled to the board height, never stretched.
   ====================================================================== */
(function installPacmanGameplayFrame() {
  var previousFitRails = fitSideRailsToViewport;

  function syncBarSpan(boardRect) {
    var row = document.querySelector('.under-board-controls');
    var gs = document.getElementById('gameScreen');
    if (!row || !gs || !boardRect) return;
    var leftEdge = boardRect.left;
    var rightEdge = boardRect.right;
    var lr = adRailLeft && adRailLeft.style.display !== 'none' ? adRailLeft.getBoundingClientRect() : null;
    var rr = adRailRight && adRailRight.style.display !== 'none' ? adRailRight.getBoundingClientRect() : null;
    if (lr && lr.width > 0) leftEdge = Math.min(leftEdge, lr.left);
    if (rr && rr.width > 0) rightEdge = Math.max(rightEdge, rr.right);
    var gsRect = gs.getBoundingClientRect();
    row.style.setProperty('--pac-rail-left', Math.max(0, gsRect.left - leftEdge).toFixed(1) + 'px');
    row.style.setProperty('--pac-rail-right', Math.max(0, rightEdge - gsRect.right).toFixed(1) + 'px');
  }

  function alignRailsToBoard() {
    if (!gameScreen || gameScreen.classList.contains('hidden')) return;
    if (document.body.classList.contains('stage-fill')) return; // the stage controller owns rail placement now
    var board = document.getElementById('canvas-frame') || document.getElementById('canvas');
    if (!board) return;
    var br = board.getBoundingClientRect();
    if (!(br.width > 20 && br.height > 20)) return;

    var gap = 8;
    var boardH = br.height;
    var desiredScale = boardH / 600;
    var leftRoom = Math.max(0, br.left - gap - 6);
    var rightRoom = Math.max(0, viewW() - br.right - gap - 6);
    var shownLeft = adRailLeft && adRailLeft.style.display !== 'none';
    var shownRight = adRailRight && adRailRight.style.display !== 'none';

    /* Keep the existing rail decision (one/two/none), but make the visible
       card height equal to the board height whenever the corresponding gutter
       can accommodate it. If a gutter is tighter, scale the SAME 300x600
       unit down proportionally instead of cropping it. */
    /* v98 (Pac-Man's is-tall card): the WIDTH decides the scale, the board's
       HEIGHT decides how long the box is. Before, the card was scaled by
       height and then capped by width, so on a wide window it stopped ~180px
       short of the board's bottom and left a dead strip under each ad. Now
       the creative keeps its 1:2 shape at the top and the box below it is
       filled with the creative's own colour (.is-tall in style.css). */
    var maxScale = desiredScale; // never taller than the board itself
    if (shownLeft) maxScale = Math.min(maxScale, leftRoom / 300);
    if (shownRight) maxScale = Math.min(maxScale, rightRoom / 300);
    if (!isFinite(maxScale) || maxScale <= 0) return;
    maxScale = Math.floor(maxScale * 1000) / 1000;
    var tallH = Math.max(600, Math.round(boardH / maxScale));
    var isTall = tallH > 601;

    if (shownLeft) {
      adRailLeft.style.top = Math.round(br.top) + 'px';
      /* Flush to the window's own left edge — any room the card does not need
         goes between it and the board, not outside it. */
      adRailLeft.style.left = '6px';
      adRailLeft.style.setProperty('--ad-scale', String(maxScale));
      adRailLeft.style.setProperty('--ad-h', tallH + 'px');
      adRailLeft.classList.toggle('is-tall', isTall);
    }
    if (shownRight) {
      adRailRight.style.top = Math.round(br.top) + 'px';
      /* Flush to the window's own right edge, same reason. */
      adRailRight.style.left = Math.round(Math.max(br.right + gap, viewW() - 6 - 300 * maxScale)) + 'px';
      adRailRight.style.setProperty('--ad-scale', String(maxScale));
      adRailRight.style.setProperty('--ad-h', tallH + 'px');
      adRailRight.classList.toggle('is-tall', isTall);
    }

    /* If the rail decision left an unused side, clear its placement. */
    if (!shownLeft && adRailLeft) {
      adRailLeft.style.removeProperty('top');
      adRailLeft.style.removeProperty('left');
    }
    if (!shownRight && adRailRight) {
      adRailRight.style.removeProperty('top');
      adRailRight.style.removeProperty('left');
    }

    syncBarSpan(br);
    syncBarToViewport();
  }

  fitSideRailsToViewport = function () {
    previousFitRails();
    /* The Pac-Man screenshot's geometry is measured from the final board, so
       wait one frame for fitBoardToViewport()/CSS transform to settle. */
    requestAnimationFrame(function () {
      alignRailsToBoard();
      requestAnimationFrame(alignRailsToBoard);
    });
  };

  window.addEventListener('resize', function () {
    requestAnimationFrame(alignRailsToBoard);
    requestAnimationFrame(syncBarToViewport);
  }, { passive: true });
  window.addEventListener('orientationchange', function () {
    setTimeout(alignRailsToBoard, 120);
  }, { passive: true });

  window.tetrisPacmanFrameSync = alignRailsToBoard;
})();


/* ======================================================================
   STAGE FILL — the black box covers ALL the room between the ads
   ----------------------------------------------------------------------
   Pac-Man's maze is sized to the rectangle left over once the ad rails (or
   the top leaderboard) and the bottom bar have taken their share, so there
   is never a gap beside it. Tetris used to size the box from its flow
   column and a uniform scale, which left 40-65px strips either side on
   tablets, short laptops and landscape phones.

   Here the rectangle is worked out first, from the window alone:
     top     6px, or under the leaderboard when one is showing
     bottom  6px above the bottom bar
     left    6px, or just past the left rail when one is showing
     right   6px, or just before the right rail when one is showing
   Rails are 300x600 units scaled by min(1, stageHeight / 600) — Pac-Man's
   rule — and stretched to the same height as the box (--ad-h / .is-tall).
   The grid is then derived from that rectangle's aspect (measureBoardArea),
   and the box is scaled to cover it exactly. Any left-over fraction of a
   cell (<2%) is absorbed by a slightly non-uniform scale, invisible to the
   eye but enough to close the last gap.
   ====================================================================== */
var STAGE_M = 6;      // gap to the window edge / bar / leaderboard
var STAGE_GAP = 8;    // gap between a rail and the box

/* Which rails show is decided from the WINDOW ALONE (railLayout() reads no
   board geometry), never from how wide the board currently is. The older
   board-measuring path could hide both cards whenever the box had grown wide
   — and now that the box fills the whole stage it always would. Landscape
   only: portrait keeps its leaderboard-on-top placement untouched. */
function stageDecideRails() {
  if (!gameScreen || gameScreen.classList.contains("hidden")) return;
  if (viewH() > viewW()) return;
  var plan = null;
  try { plan = railLayout(); } catch (e) { plan = null; }
  var sides = plan ? plan.sides : 0;
  if (sides >= 1) hideLeaderboardTop();
  adRailRight.style.display = sides >= 1 ? "" : "none";
  adRailLeft.style.display = sides === 2 ? "" : "none";
  if (sides === 0) placeLeaderboardTop();
}

function stageRailShown(el) {
  return !!el && el.style.display !== "none" && getComputedStyle(el).display !== "none";
}

function stageRect() {
  if (!gameScreen || gameScreen.classList.contains("hidden")) return null;
  var de = document.documentElement;
  var vw = de.clientWidth || window.innerWidth;
  var bar = document.querySelector(".game-screen .under-board-controls");
  if (!bar) return null;
  var barR = bar.getBoundingClientRect();
  if (!barR.height) return null;

  /* Tablet: Pac-Man's numbers — 8px frame at the screen edges, the
     leaderboard's own 5px margin plus that 8px frame below the top card,
     and 6px (Pac-Man's row gap) above the bar. Everything else keeps 6px. */
  /* Pac-Man's frame on every device now (it was tablets only): 8px at the
     screen edges, and the leaderboard's 5px margin plus that 8px frame
     below the top card. */
  var tabletPm = true;
  var edgeM = tabletPm ? 8 : STAGE_M;
  var top = edgeM;
  var lb = adLeaderboardEl;
  if (lb && lb.classList.contains("is-shown")) {
    var lr = lb.getBoundingClientRect();
    if (lr.height) top = Math.max(top, Math.round(lr.bottom) + (tabletPm ? LEADERBOARD_MARGIN + 8 : STAGE_M));
  }
  /* Pac-Man's row gap above the bar: 6px, 4px on a short landscape screen. */
  var bottom = Math.round(barR.top) - ((viewW() > viewH() && viewH() <= 520) ? 4 : STAGE_M);
  var h = bottom - top;
  if (h < 40) return null;

  var railScale = Math.max(0.2, Math.min(1, h / 600));
  var railW = Math.round(300 * railScale);
  var left = edgeM, right = vw - edgeM;
  var showL = stageRailShown(adRailLeft), showR = stageRailShown(adRailRight);
  if (showL) left = edgeM + railW + STAGE_GAP;
  if (showR) right = vw - edgeM - railW - STAGE_GAP;
  var w = right - left;
  if (w < 40) return null;
  return { left: left, right: right, top: top, bottom: bottom, w: w, h: h,
           railScale: railScale, railW: railW, showL: showL, showR: showR, edgeM: edgeM };
}

function fillStage() {
  if (!tetrisEl || !gameScreen || gameScreen.classList.contains("hidden")) return;
  var st = stageRect();
  if (!st) return;
  var frame = document.getElementById("canvas-frame");
  var canvasEl = document.getElementById("canvas");
  if (!frame || !canvasEl) return;

  /* Natural (untransformed) size of the framed field: canvas + 2x2px border. */
  var nw = canvasEl.offsetWidth + 4;
  var nh = canvasEl.offsetHeight + 4;
  if (!nw || !nh) return;

  /* Measure where the flow puts #tetris with NO transform, so the correction
     below is exact whatever the column/wrapper did around it. */
  var prevTr = tetrisEl.style.transition;
  tetrisEl.style.transition = "none";
  tetrisEl.style.transformOrigin = "0 0";
  tetrisEl.style.transform = "none";
  var natural = frame.getBoundingClientRect();
  var x0 = natural.left, y0 = natural.top;

  var sx = st.w / nw;
  var sy = st.h / nh;
  tetrisEl.style.transform =
    "translate(" + (st.left - x0).toFixed(2) + "px," + (st.top - y0).toFixed(2) + "px) " +
    "scale(" + sx.toFixed(4) + "," + sy.toFixed(4) + ")";
  void tetrisEl.offsetWidth;
  tetrisEl.style.transition = prevTr;

  document.body.classList.add("stage-fill");
  window.__tetrisStage = st;
  placeStageRails(st);
  syncBarToViewport();
}

function placeStageRails(st) {
  var tall = Math.max(600, Math.round(st.h / st.railScale));
  var isTall = tall > 601;
  var edgeM = st.edgeM || STAGE_M;
  if (st.showL) {
    adRailLeft.style.left = edgeM + "px";
    adRailLeft.style.top = Math.round(st.top) + "px";
    adRailLeft.style.setProperty("--ad-scale", String(st.railScale));
    adRailLeft.style.setProperty("--ad-h", tall + "px");
    adRailLeft.classList.toggle("is-tall", isTall);
  }
  if (st.showR) {
    adRailRight.style.right = "auto";
    adRailRight.style.left = Math.round(document.documentElement.clientWidth - edgeM - st.railW) + "px";
    adRailRight.style.top = Math.round(st.top) + "px";
    adRailRight.style.setProperty("--ad-scale", String(st.railScale));
    adRailRight.style.setProperty("--ad-h", tall + "px");
    adRailRight.classList.toggle("is-tall", isTall);
  }
}

/* =====================================================================
   PAC-MAN AD GEOMETRY (landscape phones, laptops, desktops)
   ---------------------------------------------------------------------
   Pac-Man's layoutLandscapeGame(), number for number, for every landscape
   window that is not a touch tablet (tablets keep the tablet path above,
   which already matches Pac-Man's single right-hand card):
     - frame: 8px in from the window (wrapper 4 + screen 4);
     - Hm, the board height: from that frame down to the bar, less Pac-Man's
       row gap (6px, 4px on short landscape) and, on a desktop window that
       shows Pac-Man's keyboard hint (wider than 1024, taller than 700,
       mouse pointer), that hint line and its 4px gap;
     - card width min(300, Hm/2), scale floored to 1/1000;
     - one card or two by Pac-Man's own test (two only if the board would
       otherwise be wider than 1.4x its height and two still leave it at
       least square); one card sits on the right;
     - board width capped at 2x its height except on phones, any extra
       split into equal margins; cards 8px from the board;
     - no card under 0.22 scale -> the top leaderboard, as before.
   Only geometry: which creatives play and when is untouched.
   ===================================================================== */
var PM_FRAME = 8, PM_AD_GAP = 8, PM_MIN_SCALE = 0.22, PM_TWO_IF_WIDER = 1.4,
    PM_TWO_MIN_ASPECT = 1.0, PM_MAX_ASPECT = 2.0, PM_HINT_H = 13.8125, PM_HINT_GAP = 4;

function pmLandscapeApplies() {
  if (viewH() > viewW()) return false;
  if (typeof isPmTablet === "function" && isPmTablet()) return false;
  return true;
}
function pmShowsHint() {
  var vw = viewW(), vh = viewH();
  return vw > 1024 && vh > 700 && !!(window.matchMedia && window.matchMedia("(pointer: fine)").matches);
}
function pmLandscapePlan() {
  if (!pmLandscapeApplies()) return null;
  var bar = document.querySelector(".game-screen .under-board-controls");
  if (!bar) return null;
  var barR = bar.getBoundingClientRect();
  if (!barR.height) return null;
  var vw = document.documentElement.clientWidth || window.innerWidth;
  var vh = viewH();
  var rowGap = vh <= 520 ? 4 : 6;
  var hint = pmShowsHint() ? PM_HINT_H + PM_HINT_GAP : 0;
  var innerH = barR.top - rowGap - hint - PM_FRAME;
  var Hm = Math.floor(innerH);
  var innerW = vw - 2 * PM_FRAME;
  if (!(Hm > 40) || !(innerW > 40)) return null;

  var cardW = Math.min(300, Math.floor(Hm / 2));
  var n = 1;
  var w1 = innerW - (cardW + PM_AD_GAP);
  var w2 = innerW - 2 * (cardW + PM_AD_GAP);
  if (w2 >= Hm * PM_TWO_MIN_ASPECT && w1 > Hm * PM_TWO_IF_WIDER) n = 2;
  var scale = Math.floor((cardW / 300) * 1000) / 1000;
  if (scale < PM_MIN_SCALE) return { sides: 0 };
  cardW = 300 * scale;

  var phone = Math.min(viewW(), viewH()) <= 500;
  var mazeW = Math.floor(innerW - n * (cardW + PM_AD_GAP));
  if (!phone) mazeW = Math.min(mazeW, Math.floor(Hm * PM_MAX_ASPECT));
  var groupW = mazeW + n * (cardW + PM_AD_GAP);
  var lead = Math.max(0, Math.floor((innerW - groupW) / 2));
  var mazeX = PM_FRAME + lead + (n === 2 ? cardW + PM_AD_GAP : 0);
  var top = PM_FRAME + (innerH - Hm) / 2;
  return {
    sides: n, scale: scale, cardW: cardW, Hm: Hm, top: top,
    mazeX: mazeX, mazeW: mazeW,
    leftX: Math.round(PM_FRAME + lead),
    rightX: Math.round(mazeX + mazeW + PM_AD_GAP),
    hint: hint > 0
  };
}

(function installPmAdGeometry() {
  var baseDecide = stageDecideRails, baseRect = stageRect, basePlace = placeStageRails;
  var hintEl = document.querySelector(".game-screen .hint-text");

  function placeHint(st) {
    if (!hintEl) return;
    if (st && st.pm && st.pm.hint) {
      hintEl.classList.add("pm-hint-shown");
      hintEl.style.left = Math.round(st.left) + "px";
      hintEl.style.width = Math.round(st.w) + "px";
      hintEl.style.top = (st.top + st.h + PM_HINT_GAP).toFixed(2) + "px";
    } else {
      hintEl.classList.remove("pm-hint-shown");
    }
  }

  stageDecideRails = function () {
    if (!gameScreen || gameScreen.classList.contains("hidden")) return;
    if (!pmLandscapeApplies()) { placeHint(null); return baseDecide(); }
    var plan = pmLandscapePlan();
    var sides = plan ? plan.sides : 0;
    if (sides >= 1) hideLeaderboardTop();
    adRailRight.style.display = sides >= 1 ? "" : "none";
    adRailLeft.style.display = sides === 2 ? "" : "none";
    if (sides === 0) placeLeaderboardTop();
  };

  stageRect = function () {
    if (!gameScreen || gameScreen.classList.contains("hidden")) return null;
    var plan = pmLandscapePlan();
    if (!plan || !plan.sides) { placeHint(null); return baseRect(); }
    var st = {
      left: plan.mazeX, right: plan.mazeX + plan.mazeW,
      top: plan.top, bottom: plan.top + plan.Hm,
      w: plan.mazeW, h: plan.Hm,
      railScale: plan.scale, railW: plan.cardW,
      showL: plan.sides === 2, showR: true, edgeM: PM_FRAME, pm: plan
    };
    placeHint(st);
    return st;
  };

  placeStageRails = function (st) {
    if (!st || !st.pm) return basePlace(st);
    var p = st.pm;
    var railTop = Math.max(2, Math.round(p.top));
    var adH = Math.max(1, Math.round(p.Hm / Math.max(p.scale, 0.001)));
    var isTall = p.Hm > 600 * p.scale + 1;
    function put(el, x) {
      el.style.right = "auto";
      el.style.left = x + "px";
      el.style.top = railTop + "px";
      el.style.setProperty("--ad-scale", String(p.scale));
      el.style.setProperty("--ad-h", adH + "px");
      el.classList.toggle("is-tall", isTall);
    }
    if (p.sides === 2) put(adRailLeft, p.leftX);
    else { adRailLeft.style.removeProperty("left"); adRailLeft.style.removeProperty("top"); }
    put(adRailRight, p.rightX);
  };
})();

(function installStageFill() {
  var prevFit = fitEverything;
  var busy = false;

  function run() {
    if (busy) return;
    busy = true;
    try {
      /* Grid first (a pure function of the stage), then the cover. */
      if (typeof regridToViewport === "function" && isPlaying) {
        try { regridToViewport(); } catch (e) {}
      }
      fillStage();
    } finally { busy = false; }
  }

  fitEverything = function () {
    prevFit();
    run();
    requestAnimationFrame(run);
    setTimeout(run, 200);
  };

  /* The earlier Pac-Man frame override re-places rails from the board's box;
     the stage owns that now, so it is stood down. */
  window.tetrisPacmanFrameSync = function () { run(); };
  if (typeof fitSideRailsToViewport === "function") {
    var prevRails = fitSideRailsToViewport;
    fitSideRailsToViewport = function () {
      prevRails();
      stageDecideRails();
      requestAnimationFrame(function () { fillStage(); });
    };
  }
  window.addEventListener("resize", function () { requestAnimationFrame(run); }, { passive: true });
  window.addEventListener("orientationchange", function () { setTimeout(run, 260); }, { passive: true });
  window.tetrisFillStage = run;
})();

/* =====================================================================
   JOYSTICK SIZE — a little bigger, always inside the bottom bar
   ---------------------------------------------------------------------
   The stylesheet decides a base size per screen tier. On top of that:
     tablets  -> the stylesheet's tablet size (scales with the screen);
     phones   -> 4px bigger than the base;
     desktop  -> the base size is kept (it is already the largest).
   Whatever the tier, the ring is never taller than the bar (1px clear top
   and bottom) and never overlaps the stats or the buttons either side of
   it — if the bigger size would touch a neighbour it steps back down.
   It is also re-centred vertically in the bar, which stops the desktop
   joystick hanging below the bar's bottom edge.
   ===================================================================== */
(function joystickSizer() {
  var PROPS = ["width", "height", "--joy", "flex-basis", "min-width", "min-height"];
  function rectsOverlap(a, b) {
    return a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
  }
  function apply(joy, px) {
    PROPS.forEach(function (p) {
      joy.style.setProperty(p, px + "px", "important");
    });
  }
  function size() {
    var joy = document.getElementById("joystick");
    var bar = document.querySelector("#gameScreen .under-board-controls");
    if (!joy || !bar || !gameScreen || gameScreen.classList.contains("hidden")) return;
    PROPS.forEach(function (p) { joy.style.removeProperty(p); });
    joy.style.removeProperty("translate");
    var base = Math.round(joy.getBoundingClientRect().width);
    var barR = bar.getBoundingClientRect();
    if (!base || !barR.height) return;

    var touch = isTouchDevice();
    var tablet = isPmTablet();
    var target;
    /* Tablets: the stylesheet's tablet block (body.pm-tablet) sizes the
       joystick to the screen (--tab-joy), so that size is kept as is. */
    if (tablet) target = base;
    else if (touch) target = base + 4;
    else target = base;
    var room = Math.floor(barR.height) - 2;
    if (touch && target > room) target = Math.max(Math.min(base, room), room);

    var neighbours = Array.prototype.filter.call(bar.querySelectorAll(".pm-header-title-group, .pm-scoreboard > *, .board-actions > *"), function (el) {
      return !joy.contains(el) && el.getBoundingClientRect().width > 0;
    });
    for (var tries = 0; tries < 12; tries++) {
      apply(joy, target);
      var jr = joy.getBoundingClientRect();
      var hit = neighbours.some(function (el) { return rectsOverlap(jr, el.getBoundingClientRect()); });
      if (!hit || target <= base) break;
      target -= 2;
    }
    if (target === base && !tablet) PROPS.forEach(function (p) { joy.style.removeProperty(p); });

    /* Centre it in the bar vertically. */
    var jr2 = joy.getBoundingClientRect();
    var dy = (barR.top + barR.height / 2) - (jr2.top + jr2.height / 2);
    if (Math.abs(dy) >= 0.5) joy.style.setProperty("translate", "0 " + dy.toFixed(1) + "px");
  }
  var queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () { queued = false; size(); });
  }
  if (typeof fitEverything === "function") {
    var prevFit = fitEverything;
    fitEverything = function () {
      prevFit.apply(this, arguments);
      schedule();
      setTimeout(size, 260);
    };
  }
  window.addEventListener("resize", schedule, { passive: true });
  window.addEventListener("orientationchange", function () { setTimeout(size, 300); }, { passive: true });
  window.tetrisSizeJoystick = size;
})();

/* =====================================================================
   ROTATION LOCK-IN — same sizes after every portrait <-> landscape turn
   ---------------------------------------------------------------------
   Pac-Man parity. On a real phone the browser reports the NEW viewport
   size some time after `orientationchange` / `resize` have fired — how
   long depends on the handset (the rotation animation alone is 300-500ms,
   some Android browsers take longer). Every fixed-delay refit above
   (80 / 120 / 250 / 260 / 300 / 350ms) could land inside that gap, measure
   the OLD shape, and lock it in: the board stayed portrait-sized in a
   landscape window, or the top leaderboard was stretched to the new width,
   and no further event ever came to correct it. Desktop windows and
   emulators never show this, because their new size is correct the
   instant the event fires.

   So instead of guessing a delay, the layout viewport (viewW/viewH — the
   one source every measurement uses) is watched for a short window after
   any rotation/resize, and the full refit runs again as soon as the size
   the page is REALLY laid out at differs from the size the last fit was
   done for — once it has held for two frames, so an animation mid-step is
   not mistaken for the result. A final unconditional pass closes the
   window. When nothing is stale this does nothing extra: the sizes already
   match, so the very same fit (and the very same sizes) stands.
   Only WHEN the existing fit runs changes here; how it sizes anything is
   untouched.
   ===================================================================== */
(function rotationLockIn() {
  var WATCH_ROTATE_MS = 2000;
  var WATCH_RESIZE_MS = 1000;
  var fitW = viewW(), fitH = viewH();
  var lastW = fitW, lastH = fitH;
  var until = 0, raf = 0;

  function refitAt(w, h) {
    fitW = w;
    fitH = h;
    refitAfterViewportChange();
  }

  function tick() {
    raf = 0;
    var w = viewW(), h = viewH();
    var held = w === lastW && h === lastH;
    lastW = w;
    lastH = h;
    if (held && (Math.abs(w - fitW) >= 2 || Math.abs(h - fitH) >= 2)) refitAt(w, h);
    if (performance.now() < until) {
      raf = requestAnimationFrame(tick);
    } else {
      refitAt(w, h); // closing pass, unconditional (Pac-Man's follow-up fit)
    }
  }

  function watch(ms) {
    until = Math.max(until, performance.now() + ms);
    if (!raf) raf = requestAnimationFrame(tick);
  }

  /* Fits that run on their own (screen changes, scheduleFit) also record
     the size they were done at, so the watcher compares against the real
     last fit and not just the last one it triggered itself. */
  var prevRefit = refitAfterViewportChange;
  refitAfterViewportChange = function () {
    fitW = viewW();
    fitH = viewH();
    return prevRefit.apply(this, arguments);
  };

  window.addEventListener("orientationchange", function () { watch(WATCH_ROTATE_MS); }, { passive: true });
  if (window.screen && screen.orientation && screen.orientation.addEventListener) {
    screen.orientation.addEventListener("change", function () { watch(WATCH_ROTATE_MS); });
  }
  window.addEventListener("resize", function () { watch(WATCH_RESIZE_MS); }, { passive: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", function () { watch(WATCH_RESIZE_MS); });
  }
  window.addEventListener("pageshow", function () { watch(WATCH_RESIZE_MS); });
})();
})();
