// ============================================================================
// Breakout — 35 Levels, Coins, Power-ups, Unlockables, 24h Session
// ----------------------------------------------------------------------------
// UI, responsive layout, ads, popups and level unlocking follow the shared
// Pac-Man standard (same structure, same rules, same ad units). Breakout's own
// gameplay — bricks, paddle, ball physics, power-ups, combos, stars, coins at
// risk — is unchanged. Lives and Game Over follow Pac-Man: 3 lives per
// attempt, and Watch Ad & Continue restores all 3, as often as needed.
// ============================================================================

/* localStorage can throw (Safari private mode, sandboxed iframes, quota).
   Every read/write goes through here so a blocked storage just means
   "nothing saved" instead of a dead game. */
const store = {
  get(key) { try { return localStorage.getItem(key); } catch (e) { return null; } },
  set(key, val) { try { localStorage.setItem(key, val); } catch (e) {} },
  remove(key) { try { localStorage.removeItem(key); } catch (e) {} },
};

/* Carousel timers are declared first: showScreen() runs during start-up and
   reaches code that reads them. */
let leaderboardCarouselTimer = null;
let railCarouselTimer = null;
let modalBannerCarouselTimer = null;

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

/* ctx.roundRect() draws every brick, the paddle and the power-up chips, but it
   only arrived in Safari 16 / Chrome 99. On an older iPhone or tablet the very
   first draw threw "roundRect is not a function" and the board stayed blank.
   This fills it in (uniform radius, which is all the game uses). */
if (typeof CanvasRenderingContext2D !== "undefined" && !CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
    const rad = Math.max(0, Math.min(Number(r) || 0, Math.abs(w) / 2, Math.abs(h) / 2));
    this.moveTo(x + rad, y);
    this.arcTo(x + w, y, x + w, y + h, rad);
    this.arcTo(x + w, y + h, x, y + h, rad);
    this.arcTo(x, y + h, x, y, rad);
    this.arcTo(x, y, x + w, y, rad);
    this.closePath();
    return this;
  };
}

const scoreEl = document.getElementById("score");
const livesEl = document.getElementById("lives");
const levelTitleEl = document.getElementById("levelTitle");
const restartBtn = document.getElementById("restartBtn");
const prevLevelBtn = document.getElementById("prevLevelBtn");
const nextLevelBtn = document.getElementById("nextLevelBtn");
const exitBtn = document.getElementById("exitBtn");
const muteBtns = document.querySelectorAll(".mute-btn");

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
const shopBtn = document.getElementById("shopBtn");
const shopTabsEl = document.getElementById("shopTabs");
const shopGrid = document.getElementById("shopGrid");
const coinCountMenu = document.getElementById("coinCountMenu");
const coinCountShop = document.getElementById("coinCountShop");
const coinCountGame = document.getElementById("coinCountGame");

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
let continueAdBtn = document.getElementById("continueAdBtn");

const confirmOverlayEl = document.getElementById("confirmOverlay");
const confirmTitleEl = document.getElementById("confirmTitle");
const confirmMessageEl = document.getElementById("confirmMessage");
const confirmSubMessageEl = document.getElementById("confirmSubMessage");
let confirmOkBtn = document.getElementById("confirmOkBtn");
let confirmCancelBtn = document.getElementById("confirmCancelBtn");

// ===================== COINS =====================
const COINS_KEY = "bo_coins";
function getCoins() {
  return parseInt(store.get(COINS_KEY), 10) || 0;
}
function setCoins(v) {
  store.set(COINS_KEY, String(Math.max(0, Math.round(v))));
  updateCoinDisplays();
}
function addCoins(n) {
  setCoins(getCoins() + n);
}
function spendCoins(n) {
  if (getCoins() < n) return false;
  setCoins(getCoins() - n);
  return true;
}
function updateCoinDisplays() {
  const c = getCoins();
  if (coinCountMenu) coinCountMenu.textContent = c;
  if (coinCountShop) coinCountShop.textContent = c;
  if (coinCountGame) coinCountGame.textContent = c;
  fitGameStats();
}

/* The in-game coin chip shows the full number whenever it fits. On a narrow
   phone a 5-digit balance would run past the stats column into the paddle buttons,
   so only there, and only in the bar, it is written compactly ("12.3k").
   The menu and the shop always show the full number. */
function compactNumber(n, level) {
  if (n < 1000) return String(n);
  if (n < 1e6) return level === 1 ? (Math.floor(n / 100) / 10).toFixed(1).replace(/\.0$/, "") + "k" : Math.floor(n / 1000) + "k";
  return level === 1 ? (Math.floor(n / 1e5) / 10).toFixed(1).replace(/\.0$/, "") + "M" : Math.floor(n / 1e6) + "M";
}
function setScoreText() {
  scoreEl.textContent = score;
  fitGameStats();
}
function fitGameStats() {
  if (!coinCountGame || !screens.game.classList.contains("active")) return;
  const c = getCoins();
  const left = document.querySelector("#gameScreen .bar-left");
  const joy = document.getElementById("paddlePad");
  const chip = coinCountGame.closest(".game-coin-pill");
  const ctrls = [...document.querySelectorAll("#gameScreen .game-controls > *")];
  const fits = () => {
    const pad = joy.getBoundingClientRect();
    const limit = Math.min(left.getBoundingClientRect().right, pad.left - 2);
    // ...and the paddle keys must still clear the first visible control button.
    const first = ctrls.find((el) => el.offsetParent !== null);
    const clear = !first || pad.right <= first.getBoundingClientRect().left + 0.5;
    return chip.getBoundingClientRect().right <= limit && clear;
  };
  /* Shortened one step at a time until the stats fit beside the paddle keys:
     coins 12345 -> 12.3k -> 12k, then the SCORE the same way (a 4-5 digit
     score late in a level used to push the coin chip under the keys / clip
     it, because only the coins were ever shortened), then the coin pill
     drops its icon. Full numbers come back whenever there is room. */
  coinCountGame.textContent = c;
  scoreEl.textContent = score;
  if (chip) chip.classList.remove("coin-pill-tight");
  if (joy) joy.style.removeProperty("--key-min");
  if (!left || !chip || !joy || fits()) return;
  coinCountGame.textContent = compactNumber(c, 1);
  if (fits()) return;
  coinCountGame.textContent = compactNumber(c, 2);
  if (fits()) return;
  scoreEl.textContent = compactNumber(score, 1);
  if (fits()) return;
  scoreEl.textContent = compactNumber(score, 2);
  if (fits()) return;
  chip.classList.add("coin-pill-tight"); // the gold pill alone says "coins"
  if (fits()) return;
  // Very last resort on the narrowest phones: the paddle keys give up a few
  // pixels each (never below 26px wide; they stay full height).
  for (const km of [30, 28, 26]) {
    joy.style.setProperty("--key-min", km + "px");
    if (fits()) return;
  }
}

// ===================== LEVEL / PROGRESS =====================
const TOTAL_LEVELS = 35;

/* Unlocked levels are a SET (Pac-Man standard), not a single "highest level"
   number, so the ads unlock after a 24-hour reset can open one specific level
   without implying every level before it. Level 1 is always available. */
const UNLOCKED_KEY = "bo_unlockedLevels";
const COMPLETED_KEY = "bo_completedLevels";
const LAST_PLAYED_KEY = "bo_lastPlayedLevel";

/* One-time migration from the old single-number save ("maxUnlockedLevel"),
   so a player's existing progress carries over. */
(function migrateLegacyProgress() {
  const legacy = parseInt(store.get("maxUnlockedLevel"), 10);
  if (legacy && !store.get(UNLOCKED_KEY)) {
    const max = Math.min(TOTAL_LEVELS, Math.max(1, legacy));
    const unlocked = [];
    const completed = [];
    for (let i = 1; i <= max; i++) unlocked.push(i);
    for (let i = 1; i < max; i++) completed.push(i);
    store.set(UNLOCKED_KEY, JSON.stringify(unlocked));
    store.set(COMPLETED_KEY, JSON.stringify(completed));
  }
  store.remove("maxUnlockedLevel");
  const legacyStart = store.get("sessionStart");
  if (legacyStart && !store.get("bo_sessionStart")) store.set("bo_sessionStart", legacyStart);
  store.remove("sessionStart");
  const legacySound = store.get("bo_soundEnabled");
  if (legacySound !== null && store.get("bo_soundMuted") === null) {
    store.set("bo_soundMuted", legacySound === "0" ? "1" : "0");
  }
  store.remove("bo_soundEnabled");
})();

function readLevelList(key) {
  try {
    const stored = JSON.parse(store.get(key));
    if (Array.isArray(stored)) return stored.filter((n) => n >= 1 && n <= TOTAL_LEVELS);
  } catch (e) {}
  return null;
}

function getUnlockedLevels() {
  return readLevelList(UNLOCKED_KEY) || [1];
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

function getCompletedLevels() {
  return readLevelList(COMPLETED_KEY) || [];
}

function isLevelCompleted(level) {
  return getCompletedLevels().includes(level);
}

// Winning a level marks it cleared and unlocks the next one for free.
function markLevelCompleted(level) {
  const completed = getCompletedLevels();
  if (!completed.includes(level)) {
    completed.push(level);
    store.set(COMPLETED_KEY, JSON.stringify(completed));
  }
  unlockLevel(level + 1);
}

function getLastPlayedLevel() {
  const n = Number(store.get(LAST_PLAYED_KEY));
  return Number.isInteger(n) && n >= 1 && n <= TOTAL_LEVELS ? n : null;
}

function setLastPlayedLevel(level) {
  if (getLastPlayedLevel() !== level) store.set(LAST_PLAYED_KEY, String(level));
}

// The level the menu's Play button starts: the last level actually played
// (if still unlocked), else the end of the unbroken run of unlocked levels.
function getResumeLevel() {
  const last = getLastPlayedLevel();
  if (last && isLevelUnlocked(last)) return last;
  let level = 1;
  while (level < TOTAL_LEVELS && isLevelUnlocked(level + 1)) level++;
  return level;
}

// ===================== LEVEL-GATE AD OWED =====================
/* Clearing every 3rd level (3, 6, 9 ...) owes one "level_gate" ad before the
   NEXT level can be played (Pac-Man shows it on the popup's Next Level).
   The debt is saved, so it can't be skipped by leaving the popup and picking
   that level from Level Select, the Play button, the in-game Next / Prev or
   a reload — every way into a level goes through playLevel(), which plays
   the ad first and only then starts the level. Cleared with the rest of the
   session progress on a 24-hour reset. */
const GATE_PENDING_KEY = "bo_gateAdPending";
function getGatePending() {
  return readLevelList(GATE_PENDING_KEY) || [];
}
function isGateAdOwed(level) {
  return getGatePending().includes(level);
}
function setGateAdOwed(level, owed) {
  const list = getGatePending().filter((n) => n !== level);
  if (owed && level >= 1 && level <= TOTAL_LEVELS) list.push(level);
  store.set(GATE_PENDING_KEY, JSON.stringify(list));
}

// ===================== STARS (best result per level, 1-3) =====================
const STARS_KEY = "bo_stars";
function getStarsMap() {
  try {
    return JSON.parse(store.get(STARS_KEY)) || {};
  } catch (e) {
    return {};
  }
}
function getStars(lvl) {
  return getStarsMap()[lvl] || 0;
}
function setStars(lvl, stars) {
  const m = getStarsMap();
  if (!m[lvl] || m[lvl] < stars) {
    m[lvl] = stars;
    store.set(STARS_KEY, JSON.stringify(m));
  }
}
/* Filled stars and dimmed ones, both drawn with the shared star icon so they
   look the same on every device. */
function starsHtml(n) {
  let h = "";
  for (let i = 0; i < 3; i++) h += i < n ? "★" : '<span style="opacity:.28">★</span>';
  return h;
}

// ===================== 24-HOUR SESSION =====================
// Progress (levels, stars, coins, shop items) resets 24 hours after the
// session started. The sound preference is a device setting and survives.
const SESSION_START_KEY = "bo_sessionStart";
const SESSION_LENGTH_MS = 24 * 60 * 60 * 1000;
const SESSION_KEYS = [UNLOCKED_KEY, COMPLETED_KEY, LAST_PLAYED_KEY, COINS_KEY, STARS_KEY, "bo_equipped", "bo_unlocked", "bo_gateAdPending"];

/* Survives the wipe it is set by: it is what tells Level Select a reset has
   happened at least once, which is when the watch-5-ads unlock appears. */
const RESET_HAPPENED_KEY = "bo_resetHappened";

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

function checkSession() {
  const start = readSessionStart();
  if (!start) {
    startNewSession();
    return;
  }
  if (start + SESSION_LENGTH_MS - Date.now() <= 0) {
    wipeSessionProgress();
    applyEquippedSkins();
    updateCoinDisplays();
    // A level in progress drops back to the menu with a fresh start.
    if (screens.game.classList.contains("active")) {
      stopGame();
      hideOverlay();
      showScreen("menu");
    }
    if (screens.levelSelect.classList.contains("active")) buildLevelGrid();
    if (screens.shop.classList.contains("active")) renderShop(activeShopTab);
    showSessionToast();
  }
}

let sessionToastEl = null;
function showToast(text, duration) {
  if (!sessionToastEl) {
    sessionToastEl = document.createElement("div");
    sessionToastEl.className = "session-toast";
    document.body.appendChild(sessionToastEl);
  }
  sessionToastEl.textContent = text;
  /* Same toast as Pac-Man; during play it is lifted to sit just above the game
     bar so it never lands on the ◀ ▶ paddle buttons in the bar's centre. */
  const bar = screens.game.classList.contains("active") ? document.querySelector("#gameScreen .header") : null;
  const barTop = bar ? bar.getBoundingClientRect().top : 0;
  sessionToastEl.style.bottom = bar && barTop > 0 ? Math.round(window.innerHeight - barTop + 10) + "px" : "";
  sessionToastEl.classList.add("show");
  clearTimeout(sessionToastEl._hideTimer);
  sessionToastEl._hideTimer = setTimeout(() => sessionToastEl.classList.remove("show"), duration || 3200);
}
function showSessionToast() {
  showToast("\u23F0 24-hour session over \u2014 progress reset, starting fresh");
}

setInterval(checkSession, 30000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) checkSession();
});
window.addEventListener("focus", checkSession);

// ===================== SHOP / UNLOCKABLES =====================
const SHOP_ITEMS = {
  paddle: [
    { id: "classic", name: "Classic", cost: 0, color: "#ee6c4d" },
    { id: "ocean", name: "Ocean", cost: 60, color: "#4ea8de" },
    { id: "mint", name: "Mint", cost: 60, color: "#56cfe1" },
    { id: "sunset", name: "Sunset", cost: 110, gradient: ["#ff9a76", "#ff477e"] },
    { id: "galaxy", name: "Galaxy", cost: 150, gradient: ["#7b2ff7", "#f107a3"] },
    { id: "gold", name: "Gold", cost: 200, gradient: ["#ffd670", "#ff9f1c"] },
  ],
  ball: [
    { id: "classic", name: "Classic", cost: 0, color: "#3d5a80" },
    { id: "ember", name: "Ember", cost: 50, color: "#ff477e" },
    { id: "lime", name: "Lime", cost: 50, color: "#57cc99" },
    { id: "ice", name: "Ice", cost: 90, color: "#48bfe3" },
    { id: "gold", name: "Gold", cost: 130, color: "#ffb703" },
    { id: "rainbow", name: "Rainbow", cost: 220, rainbow: true },
  ],
  brick: [
    { id: "pastel", name: "Pastel", cost: 0, colors: ["#fbf8cc", "#fde4cf", "#ffcfd2", "#f1c0e8", "#cfbaf0", "#a3c4f3", "#90dbf4"] },
    { id: "neon", name: "Neon", cost: 90, colors: ["#f72585", "#b5179e", "#7209b7", "#560bad", "#3a0ca3", "#4361ee", "#4cc9f0"] },
    { id: "candy", name: "Candy", cost: 90, colors: ["#ff70a6", "#ff9770", "#ffd670", "#e9ff70", "#70d6ff", "#a1ffce", "#faf3dd"] },
    { id: "mono", name: "Mono Blue", cost: 120, colors: ["#caf0f8", "#ade8f4", "#90e0ef", "#48cae4", "#00b4d8", "#0096c7", "#0077b6"] },
    { id: "forest", name: "Forest", cost: 120, colors: ["#d8f3dc", "#b7e4c7", "#95d5b2", "#74c69d", "#52b788", "#40916c", "#2d6a4f"] },
  ],
  background: [
    { id: "default", name: "Classic White", cost: 0, css: "#ffffff" },
    { id: "sky", name: "Sky", cost: 40, css: "linear-gradient(180deg,#caf0f8,#ffffff)" },
    { id: "peach", name: "Peach", cost: 40, css: "linear-gradient(180deg,#ffe5d9,#ffffff)" },
    { id: "mint", name: "Mint", cost: 70, css: "linear-gradient(180deg,#d8f3dc,#ffffff)" },
    { id: "lavender", name: "Lavender", cost: 70, css: "linear-gradient(180deg,#e5d4ff,#ffffff)" },
  ],
};

let currentPaddleSkin = SHOP_ITEMS.paddle[0];
let currentBallSkin = SHOP_ITEMS.ball[0];
let currentBrickColors = SHOP_ITEMS.brick[0].colors;

function getEquipped() {
  try {
    return JSON.parse(store.get("bo_equipped")) || {};
  } catch (e) {
    return {};
  }
}
function setEquippedId(cat, id) {
  const eq = getEquipped();
  eq[cat] = id;
  store.set("bo_equipped", JSON.stringify(eq));
}
function getEquippedId(cat) {
  return getEquipped()[cat] || SHOP_ITEMS[cat][0].id;
}
function getUnlockedMap() {
  try {
    return JSON.parse(store.get("bo_unlocked")) || {};
  } catch (e) {
    return {};
  }
}
function isUnlocked(cat, id) {
  return (getUnlockedMap()[cat] || []).includes(id);
}
function unlockItem(cat, id) {
  const u = getUnlockedMap();
  if (!u[cat]) u[cat] = [];
  if (!u[cat].includes(id)) u[cat].push(id);
  store.set("bo_unlocked", JSON.stringify(u));
}

function applyEquippedSkins() {
  currentPaddleSkin = SHOP_ITEMS.paddle.find((x) => x.id === getEquippedId("paddle")) || SHOP_ITEMS.paddle[0];
  currentBallSkin = SHOP_ITEMS.ball.find((x) => x.id === getEquippedId("ball")) || SHOP_ITEMS.ball[0];
  const brickItem = SHOP_ITEMS.brick.find((x) => x.id === getEquippedId("brick")) || SHOP_ITEMS.brick[0];
  currentBrickColors = brickItem.colors;
  const bgItem = SHOP_ITEMS.background.find((x) => x.id === getEquippedId("background")) || SHOP_ITEMS.background[0];
  canvas.style.background = bgItem.css;
}

function swatchBg(cat, item) {
  if (cat === "background") return item.css;
  if (item.gradient) return `linear-gradient(120deg, ${item.gradient[0]}, ${item.gradient[1]})`;
  if (item.rainbow) return "linear-gradient(90deg,#ff0000,#ff9900,#33ff00,#00fffb,#df00ff,#ff0000)";
  if (item.colors) return `linear-gradient(90deg, ${item.colors.map(shadeBrick).join(",")})`;
  return item.color || "#cccccc";
}

let activeShopTab = "paddle";
function renderShop(cat) {
  activeShopTab = cat;
  [...shopTabsEl.querySelectorAll(".shop-tab")].forEach((t) => t.classList.toggle("active", t.dataset.cat === cat));
  shopGrid.innerHTML = "";
  const equippedId = getEquippedId(cat);
  SHOP_ITEMS[cat].forEach((item) => {
    const unlocked = item.cost === 0 || isUnlocked(cat, item.id);
    const cell = document.createElement("div");
    cell.className = "shop-item" + (equippedId === item.id ? " equipped-item" : "");

    const swatch = document.createElement("div");
    swatch.className = "shop-item-swatch";
    swatch.style.background = swatchBg(cat, item);

    const name = document.createElement("div");
    name.className = "shop-item-name";
    name.textContent = item.name;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "shop-item-btn";

    if (equippedId === item.id) {
      btn.textContent = "Equipped";
      btn.classList.add("equipped");
      btn.disabled = true;
    } else if (unlocked) {
      btn.textContent = "Equip";
      btn.classList.add("equip");
      btn.addEventListener("click", () => {
        setEquippedId(cat, item.id);
        applyEquippedSkins();
        renderShop(cat);
      });
    } else {
      btn.textContent = "Buy · " + item.cost + " 🪙";
      btn.classList.add("buy");
      btn.disabled = getCoins() < item.cost;
      btn.addEventListener("click", () => {
        if (spendCoins(item.cost)) {
          unlockItem(cat, item.id);
          setEquippedId(cat, item.id);
          applyEquippedSkins();
          renderShop(cat);
        }
      });
    }

    cell.appendChild(swatch);
    cell.appendChild(name);
    cell.appendChild(btn);
    shopGrid.appendChild(cell);
  });
}
[...shopTabsEl.querySelectorAll(".shop-tab")].forEach((tab) => {
  tab.addEventListener("click", () => renderShop(tab.dataset.cat));
});
shopBtn.addEventListener("click", () => {
  updateCoinDisplays();
  renderShop(activeShopTab);
  showScreen("shop");
});

// ===================== SOUND =====================
// Generated tones (no audio files). Mute is a device preference, so it is
// not part of the 24-hour wipe. Same Sound button behaviour as Pac-Man.
const MUTE_STORAGE_KEY = "bo_soundMuted";
let soundMuted = store.get(MUTE_STORAGE_KEY) === "1";
let audioCtx = null;

function getAudioCtx() {
  if (soundMuted) return null;
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx();
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

function setMuted(muted) {
  soundMuted = muted;
  store.set(MUTE_STORAGE_KEY, muted ? "1" : "0");
  muteBtns.forEach((btn) => {
    btn.textContent = muted ? "\u{1F507}" : "\u{1F50A}";
    btn.classList.toggle("is-muted", muted);
    btn.setAttribute("aria-pressed", String(muted));
  });
}
muteBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    setMuted(!soundMuted);
    if (!soundMuted) playTone(520, 0.1, "triangle", 0, 0.16); // confirmation blip
  });
});

function playTone(freq, duration, type = "sine", startTime = 0, volume = 0.2) {
  const ctxA = getAudioCtx();
  if (!ctxA) return;
  const osc = ctxA.createOscillator();
  const gain = ctxA.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const now = ctxA.currentTime + startTime;
  gain.gain.setValueAtTime(volume, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
  osc.connect(gain);
  gain.connect(ctxA.destination);
  osc.start(now);
  osc.stop(now + duration);
}

function playBrickSound() {
  playTone(500 + Math.random() * 300, 0.12, "square", 0, 0.12);
}
function playStartSound() {
  playTone(440, 0.1, "triangle", 0, 0.16);
  playTone(660, 0.15, "triangle", 0.1, 0.16);
}
function playPaddleSound() {
  playTone(220, 0.08, "triangle", 0, 0.1);
}
function playWallSound() {
  playTone(160, 0.06, "triangle", 0, 0.08);
}
function playWinSound() {
  const notes = [523.25, 659.25, 783.99, 1046.5, 1318.51];
  notes.forEach((f, i) => playTone(f, 0.28, "triangle", i * 0.12, 0.2));
  playTone(1567.98, 0.4, "sine", 0.55, 0.12);
}
function playLoseSound() {
  const notes = [392, 329.63, 261.63, 196];
  notes.forEach((f, i) => playTone(f, 0.3, "sawtooth", i * 0.15, 0.15));
}
function playLoseLifeSound() {
  playTone(300, 0.15, "sawtooth", 0, 0.15);
  playTone(220, 0.2, "sawtooth", 0.1, 0.12);
}
function playPowerupSound() {
  playTone(600, 0.08, "square", 0, 0.16);
  playTone(900, 0.1, "square", 0.07, 0.16);
}

// ===================== PAUSE =====================
// Freezes the board without leaving it (Pac-Man standard). The loop keeps
// drawing but stops stepping, and power-up timers stop with it.
let gamePaused = false;
const pauseBtn = document.getElementById("pauseBtn");

function setPaused(next) {
  // Nothing live to pause: a won / lost board, or an ad in front of it.
  if (next && !gamePaused && (!isPlaying || adIsPlaying)) return;
  gamePaused = next;
  pauseBtn.innerHTML = gamePaused
    ? '<span class="ico">\u25B6</span><span class="lbl">Resume</span>'
    : '<span class="ico">\u23F8</span><span class="lbl">Pause</span>';
  pauseBtn.setAttribute("aria-pressed", String(gamePaused));
  pauseBtn.classList.toggle("is-paused", gamePaused);
  if (gamePaused) {
    releasePaddleButtons();
    paddle.dx = 0;
  }
}
pauseBtn.addEventListener("click", () => setPaused(!gamePaused));

// ===================== GAME STATE =====================
const MAX_LEVEL = TOTAL_LEVELS;
// Lives (Pac-Man standard): 3 per attempt. Losing the ball costs one and the
// next ball waits on the paddle; losing the last one is Game Over, where a
// watched ad restores all 3 lives and the SAME attempt carries on (bricks,
// score and combo untouched) — no limit on how many times. Stars depend on
// how many ad-continues were used.
const START_LIVES = 3;
const CONTINUE_LIVES = 3;
let lives = START_LIVES;
let currentLevel = 1;
let score = 0;
let continuesUsedThisLevel = 0;
// Coins from bricks are "at risk" for the whole attempt: banked as you play,
// but clawed back if you give up from Game Over (Retry / Level Select / X).
let coinsEarnedThisAttempt = 0;
let lastOverlayWasWin = false;
let combo = 0;
let isPlaying = false;
let frameCount = 0;
let serving = false; // ball waiting on the paddle for a launch (after a lost life or a continue)
let ballBaseSpeed = 4;
let playedThisAttempt = false;

/* Game clock: advances only while the simulation steps (not while paused or
   under an ad), so power-up timers never run out behind a pause. One step is
   one original Breakout frame (1/60 s). */
const STEP_MS = 1000 / 60;
let simMs = 0;

// ---------- Playfield ----------
/* Breakout's playfield is 750 wide, exactly as before, so every brick, the
   paddle and the ball keep their original sizes and positions. What used to
   be a fixed 750x460 box now takes the shape of the space it is given, the
   way Pac-Man's board fills its box: on a tall (portrait) screen the field
   gets taller below the bricks; on a very wide screen it gets wider and the
   brick wall stays centred. The drawing is always uniformly scaled — never
   stretched. */
const BASE_W = 750;
const BASE_H = 460;
const FIELD_MIN_ASPECT = 0.4;  // tallest field ever drawn (w/h)
const FIELD_MAX_ASPECT = 2.2;  // widest field ever drawn (w/h)
const FIELD = { w: BASE_W, h: BASE_H };
let renderScaleX = 1;
let renderScaleY = 1;

// Game Objects — supports multiple simultaneous balls (Multi-ball power-up)
const MAX_BALLS = 6;
let balls = [];
const paddle = { x: 0, y: 0, w: 100, h: 12, baseW: 100, speed: 8, dx: 0 };

let brickRowCount = 5;
const brickColumnCount = 9;
const brickInfo = { w: 66, h: 18, padding: 8, offsetX: 38, offsetY: 30 };
let bricks = [];
let bricksBottomY = brickInfo.offsetY;

function brickOffsetX() {
  return brickInfo.offsetX + (FIELD.w - BASE_W) / 2;
}

// --- Falling power-up capsules & their timed effects ---
const POWERUP_TYPES = ["multiball", "bigpaddle", "slowball", "fireball", "bomb"];
const DROP_CHANCE = 0.16;
const POWERUP_ICON = { multiball: "⚪", bigpaddle: "↔", slowball: "🐢", fireball: "🔥", bomb: "💣" };
const POWERUP_COLOR = { multiball: "#4ea8de", bigpaddle: "#95d5b2", slowball: "#90dbf4", fireball: "#ff9770", bomb: "#2b2d42" };
const EFFECT_DURATION = { bigpaddle: 10000, slowball: 8000, fireball: 8000 };
let drops = [];
let effectEndsAt = { bigpaddle: 0, slowball: 0, fireball: 0 };

function computeLevelCoins(lvl) {
  return Math.round(25 + ((lvl - 1) * 25) / (MAX_LEVEL - 1)); // 25..50 across levels 1..35
}

// --- Difficulty Tiers & Layouts (35 levels) ---
// Every level starts from Breakout's 5-row wall and grows from there:
//  1-6   beginner  5 rows, single-hit bricks, slow ball, wide paddle
//  7-12  fast      5 -> 6 rows, single-hit, simple shapes, quicker ball
// 13-19  strong    6 rows, 2-hit (then 3-hit) bricks in the centre
// 20-26  moving    6 -> 7 rows, sliding rows, armoured top rows
// 27-32  complex   7 rows, patterned gaps, 3/2/1-hit layers, sliding rows
// 33-35  boss      8 rows, mostly 3-hit, sliding top rows
// Ball speed and paddle width move smoothly across all 35 levels.
function getTier(lvl) {
  if (lvl <= 6) return "beginner";
  if (lvl <= 12) return "fast";
  if (lvl <= 19) return "strong";
  if (lvl <= 26) return "moving";
  if (lvl <= 32) return "complex";
  return "boss";
}

function ballSpeedForLevel(lvl) {
  return 3.3 + (lvl - 1) * 0.135; // 3.3 on level 1 -> 7.8 on level 35
}

function paddleWidthForLevel(lvl) {
  // 130 on level 1, narrowing steadily to 76 on level 35.
  return Math.round(130 - (lvl - 1) * 1.6);
}

function getLevelPlan(lvl) {
  const tier = getTier(lvl);
  const mid = (brickColumnCount - 1) / 2;
  const none = () => false;
  switch (tier) {
    case "beginner": {
      // 5 full rows on 1-3; from 4 a simple shape opens a few gaps.
      const shapes = [
        none,
        none,
        none,
        (i, j) => j === 4 && (i === 0 || i === 8),                 // trimmed corners
        (i, j) => j >= 3 && Math.abs(i - mid) > 6 - j,               // soft pyramid base
        (i, j) => i === 4 && j >= 2,                                 // centre channel
      ];
      return { rows: 5, gap: shapes[lvl - 1], hits: () => 1, moving: none };
    }
    case "fast": {
      const rows = lvl <= 9 ? 5 : 6;
      const shapes = [
        (i, j) => (i + j) % 4 === 0,                                 // diagonal gaps
        (i, j) => j % 2 === 1 && i % 2 === 0,                        // bricked rows
        (i) => i === 2 || i === 6,                                   // two channels
        (i, j) => Math.abs(i - mid) + j > 7,                         // inverted pyramid
        (i, j) => (i + j) % 3 === 0,                                 // tighter diagonals
        none,                                                        // solid 6-row wall
      ];
      return { rows, gap: shapes[lvl - 7], hits: () => 1, moving: none };
    }
    case "strong": {
      const core = lvl <= 16 ? 1 : 2;           // how far the armour spreads from the centre
      const strong = lvl <= 16 ? 2 : 3;         // hits for the armoured bricks
      return {
        rows: 6,
        gap: lvl % 2 === 0 ? (i, j) => j === 5 && i % 2 === 1 : none,
        hits: (i, j) => (Math.abs(i - mid) <= core ? (j <= 3 ? strong : 2) : 1),
        moving: none,
      };
    }
    case "moving": {
      const rows = lvl <= 22 ? 6 : 7;
      return {
        rows,
        gap: (i, j) => j === rows - 1 && i % 3 === 0,
        hits: (i, j) => (j <= (lvl <= 23 ? 1 : 2) ? 2 : 1),
        moving: (i, j) => (lvl <= 22 ? j === 2 : j % 2 === 0),
      };
    }
    case "complex":
      return {
        rows: 7,
        gap: (i, j) => (i + j) % (lvl <= 29 ? 6 : 5) === 0,
        hits: (i, j) => (j <= 1 ? 3 : j <= 3 ? 2 : 1),
        moving: (i, j) => j % 2 === 1,
      };
    case "boss":
    default:
      return {
        rows: 8,
        gap: (i, j) => j === 7 && i % 2 === 0,
        hits: (i, j) => (j <= (lvl === 35 ? 6 : 5) ? 3 : 2),
        moving: (i, j) => j <= (lvl === 35 ? 3 : 2) && i % 2 === 0,
      };
  }
}

function makeBall(x, y, dx, dy) {
  return { x, y, size: 8, dx, dy };
}

/* Start (or restart) a level. Same rules as before; the screen is shown and
   the board fitted FIRST so the bricks are laid out in the field's real size. */
function setupLevel(lvl) {
  currentLevel = Math.min(Math.max(lvl, 1), MAX_LEVEL);
  score = 0;
  lives = START_LIVES;
  continuesUsedThisLevel = 0;
  coinsEarnedThisAttempt = 0;
  combo = 0;
  drops = [];
  effectEndsAt = { bigpaddle: 0, slowball: 0, fireball: 0 };
  serving = false;
  frameCount = 0;
  simMs = 0;
  releasePaddleButtons();
  paddle.dx = 0;
  playedThisAttempt = false;
  restartAdUsedThisRun = false;
  restartBtn.disabled = false;
  lastOverlayWasWin = false;

  hideOverlay();
  closeAdOverlay();
  showScreen("game");
  fitSideRails();
  resizeBoard(true);

  // Difficulty scaling (spread smoothly across the 35 levels)
  ballBaseSpeed = ballSpeedForLevel(currentLevel);
  paddle.baseW = paddleWidthForLevel(currentLevel);
  paddle.w = paddle.baseW;

  paddle.x = FIELD.w / 2 - paddle.w / 2;
  paddle.y = FIELD.h - 20;
  balls = [
    makeBall(FIELD.w / 2, FIELD.h - 30, ballBaseSpeed * (Math.random() > 0.5 ? 1 : -1), -ballBaseSpeed),
  ];

  // Bricks (rows, gaps, strength and movement come from the level's tier)
  const plan = getLevelPlan(currentLevel);
  const offX = brickOffsetX();
  brickRowCount = plan.rows;
  bricks = [];
  for (let i = 0; i < brickColumnCount; i++) {
    bricks[i] = [];
    for (let j = 0; j < brickRowCount; j++) {
      if (plan.gap(i, j, brickColumnCount, brickRowCount)) continue;
      const x = i * (brickInfo.w + brickInfo.padding) + offX;
      const y = j * (brickInfo.h + brickInfo.padding) + brickInfo.offsetY;
      const maxHits = plan.hits(i, j, brickColumnCount, brickRowCount);
      bricks[i].push({
        x,
        baseX: x,
        y,
        row: j,
        w: brickInfo.w,
        h: brickInfo.h,
        rowColor: shadeBrick(currentBrickColors[j % currentBrickColors.length]),
        maxHits,
        hits: maxHits,
        moving: plan.moving(i, j, brickColumnCount, brickRowCount),
        movePhase: (i + j) * 0.7,
        visible: true,
        fireCooldown: 0,
      });
    }
  }
  bricksBottomY = brickInfo.offsetY + brickRowCount * (brickInfo.h + brickInfo.padding);

  isPlaying = true;
  playStartSound();
  updateUI();
  updateCoinDisplays();
  // Let the ad rails / bar settle for two frames, then fit once more.
  requestAnimationFrame(() => requestAnimationFrame(() => fitSideRails()));
}

/* Stops the simulation without touching the board (Exit, 24h reset). */
function stopGame() {
  isPlaying = false;
  serving = false;
  releasePaddleButtons();
  paddle.dx = 0;
}

function updateUI() {
  setScoreText();
  livesEl.textContent = lives;
  levelTitleEl.innerHTML = '<span class="lvl-word">Level</span><span class="lvl-num">' + currentLevel + "</span>";
  // Disabled unless the previous level can actually be reached (played, or
  // unlocked with ads after a 24h reset) — it used to look enabled and do
  // nothing when that level was still locked.
  prevLevelBtn.disabled = currentLevel <= 1 ||
    !(isLevelUnlocked(currentLevel - 1) || isLevelAdUnlockable(currentLevel - 1));
  nextLevelBtn.disabled = currentLevel >= MAX_LEVEL || !(isLevelUnlocked(currentLevel + 1) || isLevelAdUnlockable(currentLevel + 1));
}

// ===================== BOARD FITTING =====================
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

/* The box the board may occupy: its column, less the hint line under it. */
function boardHostBox() {
  const host = canvas.parentElement;
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

/* The column's height as it would be with NO ad band reserved (computed, not
   measured by mutating the layout). Same as Pac-Man. */
function boardBoxNoBand() {
  const gs = screens.game;
  const host = canvas.parentElement;
  if (!gs || !host) return { w: 0, h: 0 };
  const cs = getComputedStyle(gs);
  const band = parseFloat(cs.getPropertyValue("--ad-band")) || 0;
  const padT = parseFloat(cs.paddingTop) || 0;
  const padB = parseFloat(cs.paddingBottom) || 0;
  const colGap = parseFloat(cs.rowGap) || 0;
  const hdr = gs.querySelector(".header");
  const hdrH = hdr ? hdr.offsetHeight : 0;
  let inner = gs.clientHeight - padT - padB + band - hdrH - (hdrH ? colGap : 0);
  const hint = host.querySelector(".hint");
  if (hint && hint.offsetParent !== null) {
    const g = parseFloat(getComputedStyle(host).rowGap) || 0;
    inner -= hint.offsetHeight + g;
  }
  return { w: layoutSize(host).w, h: Math.max(40, inner) };
}

/* The narrowest board shape the landscape ad layout should leave (same value
   Pac-Man's maze uses), and the widest classic shape the portrait leaderboard
   band may squeeze the board down to. */
function minBoardAspect() {
  return 0.93;
}
function maxBoardAspect() {
  return BASE_W / BASE_H;
}

/* Re-map everything on the field when its size changes mid-level (rotation,
   window resize): x stays centred with the brick wall, y below the bricks is
   scaled into the new height so the ball and paddle keep their place. */
function setFieldSize(W, H) {
  const oldW = FIELD.w;
  const oldH = FIELD.h;
  if (W === oldW && H === oldH) return;
  FIELD.w = W;
  FIELD.h = H;
  const dx = (W - oldW) / 2;
  const top = bricksBottomY;
  const mapY = (y) => (y <= top || oldH <= top ? y : top + ((y - top) * (H - top)) / (oldH - top));
  bricks.forEach((col) => col.forEach((b) => { b.x += dx; b.baseX += dx; }));
  balls.forEach((b) => { b.x += dx; b.y = mapY(b.y); });
  drops.forEach((d) => { d.x += dx; d.y = mapY(d.y); });
  paddle.x = Math.max(0, Math.min(W - paddle.w, paddle.x + dx));
  paddle.y = H - 20;
}

let lastCssW = 0;
let lastCssH = 0;
function resizeBoard(force) {
  if (!screens.game.classList.contains("active")) return;
  fitGameStats();
  const box = boardHostBox();
  if (!(box.w > 0 && box.h > 0)) return;
  let cssW = Math.floor(box.w);
  let cssH = Math.floor(box.h);
  const a = cssW / cssH;
  if (a > FIELD_MAX_ASPECT) cssW = Math.floor(cssH * FIELD_MAX_ASPECT);
  else if (a < FIELD_MIN_ASPECT) cssH = Math.floor(cssW / FIELD_MIN_ASPECT);
  if (force || cssW !== lastCssW || cssH !== lastCssH) {
    lastCssW = cssW;
    lastCssH = cssH;
    canvas.style.width = cssW + "px";
    canvas.style.height = cssH + "px";
  }
  const innerW = canvas.clientWidth || cssW;
  const innerH = canvas.clientHeight || cssH;
  const aspect = innerW / innerH;
  let W;
  let H;
  if (aspect >= BASE_W / BASE_H) {
    H = BASE_H;
    W = Math.round(BASE_H * aspect);
  } else {
    W = BASE_W;
    H = Math.round(BASE_W / aspect);
  }
  setFieldSize(W, H);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const bw = Math.max(1, Math.round(innerW * dpr));
  const bh = Math.max(1, Math.round(innerH * dpr));
  if (canvas.width !== bw) canvas.width = bw;
  if (canvas.height !== bh) canvas.height = bh;
  renderScaleX = bw / W;
  renderScaleY = bh / H;
  draw();
}

// ===================== RENDERING =====================
function drawBallInstance(b) {
  ctx.beginPath();
  ctx.arc(b.x, b.y, b.size, 0, Math.PI * 2);
  ctx.fillStyle = currentBallSkin.rainbow ? `hsl(${(frameCount * 4) % 360}, 85%, 60%)` : currentBallSkin.color;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.22)";
  ctx.stroke();
  ctx.closePath();
}

function drawPaddle() {
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.18)";
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 2;
  ctx.beginPath();
  ctx.roundRect(paddle.x, paddle.y, paddle.w, paddle.h, 6);
  if (currentPaddleSkin.gradient) {
    const g = ctx.createLinearGradient(paddle.x, 0, paddle.x + paddle.w, 0);
    g.addColorStop(0, currentPaddleSkin.gradient[0]);
    g.addColorStop(1, currentPaddleSkin.gradient[1]);
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = currentPaddleSkin.color;
  }
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.28)";
  ctx.stroke();
  ctx.closePath();
  ctx.restore();
}

// Strong bricks get a darker fill while they still have hits left.
/* Bricks are drawn a touch darker than the theme values (lightness -7%,
   same hue and saturation) so the pale themes read clearly on the white
   board. Only bricks (and their shop swatch) use these colours. */
function shadeBrick(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  let r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  // Lightness down 7%, hue and saturation kept, so a pastel stays a pastel.
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, sat = 0, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  l *= 0.93;
  const hue = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  if (sat === 0) { r = g = b = l; } else {
    const q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat, p = 2 * l - q;
    r = hue(p, q, h + 1 / 3); g = hue(p, q, h); b = hue(p, q, h - 1 / 3);
  }
  const ch = (v) => Math.round(v * 255).toString(16).padStart(2, "0");
  return "#" + ch(r) + ch(g) + ch(b);
}
const STRONG_BRICK_SHADES = { 3: shadeBrick("#5c677d"), 2: shadeBrick("#8d99ae") };

function drawBricks() {
  bricks.forEach((col) => {
    col.forEach((b) => {
      if (!b.visible) return;
      ctx.beginPath();
      ctx.roundRect(b.x, b.y, b.w, b.h, 4);
      ctx.fillStyle = b.hits > 1 ? STRONG_BRICK_SHADES[b.hits] || STRONG_BRICK_SHADES[2] : b.rowColor;
      ctx.fill();
      ctx.closePath();
      if (b.moving) {
        ctx.save();
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = "#2b2d42";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(b.x + 1, b.y + 1, b.w - 2, b.h - 2, 3);
        ctx.stroke();
        ctx.restore();
      }
    });
  });
}

function drawDrops() {
  drops.forEach((d) => {
    ctx.beginPath();
    ctx.roundRect(d.x - 15, d.y - 11, 30, 22, 7);
    ctx.fillStyle = POWERUP_COLOR[d.type] || "#b8c0ff";
    ctx.fill();
    ctx.font = "13px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(POWERUP_ICON[d.type] || "?", d.x, d.y + 1);
  });
}

/* Active power-up timers: the same dark chips with a draining bar that used to
   sit in a strip above the canvas, now drawn in the board's top-left corner
   (above the brick wall) so they cost the board no height. */
const TRAY_DEFS = [
  { key: "bigpaddle", icon: "↔", duration: EFFECT_DURATION.bigpaddle },
  { key: "slowball", icon: "🐢", duration: EFFECT_DURATION.slowball },
  { key: "fireball", icon: "🔥", duration: EFFECT_DURATION.fireball },
];
function drawPowerupTray() {
  let x = 6;
  TRAY_DEFS.forEach((def) => {
    const endsAt = effectEndsAt[def.key];
    if (!(endsAt && endsAt > simMs)) return;
    const remain = Math.max(0, Math.min(1, (endsAt - simMs) / def.duration));
    ctx.beginPath();
    ctx.roundRect(x, 5, 62, 20, 10);
    ctx.fillStyle = "rgba(43, 45, 66, 0.9)";
    ctx.fill();
    ctx.font = "12px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(def.icon, x + 13, 15.5);
    ctx.fillStyle = "rgba(255, 255, 255, 0.25)";
    ctx.beginPath();
    ctx.roundRect(x + 24, 13, 30, 4, 2);
    ctx.fill();
    ctx.fillStyle = "#90dbf4";
    ctx.beginPath();
    ctx.roundRect(x + 24, 13, Math.max(0.5, 30 * remain), 4, 2);
    ctx.fill();
    x += 68;
  });
}

function draw() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(renderScaleX, 0, 0, renderScaleY, 0, 0);
  drawBricks();
  drawPaddle();
  balls.forEach(drawBallInstance);
  drawDrops();
  drawPowerupTray();
}

// ===================== GAME RULES (unchanged) =====================
function overlaps(ball, rect) {
  return (
    ball.x + ball.size > rect.x &&
    ball.x - ball.size < rect.x + rect.w &&
    ball.y + ball.size > rect.y &&
    ball.y - ball.size < rect.y + rect.h
  );
}

function maybeDropPowerup(b) {
  if (Math.random() < DROP_CHANCE) {
    const type = POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)];
    drops.push({ x: b.x + b.w / 2, y: b.y + b.h / 2, type });
  }
}

function hitBrick(b) {
  b.hits -= 1;
  if (b.hits <= 0) {
    b.visible = false;
    score += 20;
    combo += 1;
    const coinGain = 2 + (combo >= 3 ? 3 : 0);
    addCoins(coinGain);
    coinsEarnedThisAttempt += coinGain;
    if ([3, 5, 8, 12, 16, 20, 25].includes(combo)) showToast(`🔥 ${combo}x Combo!`, 900);
    maybeDropPowerup(b);
  } else {
    score += 10;
  }
  setScoreText();
  playBrickSound();
}

function triggerBomb() {
  let maxRow = -1;
  bricks.forEach((col) => col.forEach((b) => { if (b.visible && b.row > maxRow) maxRow = b.row; }));
  if (maxRow === -1) return;
  bricks.forEach((col) =>
    col.forEach((b) => {
      if (b.visible && b.row === maxRow) {
        b.visible = false;
        b.hits = 0;
        score += 20;
        addCoins(2);
        coinsEarnedThisAttempt += 2;
      }
    })
  );
  setScoreText();
  playBrickSound();
}

function activatePowerup(type) {
  playPowerupSound();
  const now = simMs;
  switch (type) {
    case "multiball": {
      const extra = [];
      balls.forEach((b) => {
        if (balls.length + extra.length + 2 <= MAX_BALLS) {
          const speed = Math.hypot(b.dx, b.dy) || ballBaseSpeed;
          const angle = Math.atan2(b.dy, b.dx);
          extra.push(makeBall(b.x, b.y, speed * Math.cos(angle + 0.5), speed * Math.sin(angle + 0.5)));
          extra.push(makeBall(b.x, b.y, speed * Math.cos(angle - 0.5), speed * Math.sin(angle - 0.5)));
        }
      });
      balls = balls.concat(extra);
      showToast("⚪ Multi-ball!", 1300);
      break;
    }
    case "bigpaddle":
      effectEndsAt.bigpaddle = now + EFFECT_DURATION.bigpaddle;
      showToast("↔ Bigger Paddle!", 1300);
      break;
    case "slowball":
      if (!(effectEndsAt.slowball > now)) {
        balls.forEach((b) => { b.dx *= 0.6; b.dy *= 0.6; });
      }
      effectEndsAt.slowball = now + EFFECT_DURATION.slowball;
      showToast("🐢 Slow Ball!", 1300);
      break;
    case "fireball":
      effectEndsAt.fireball = now + EFFECT_DURATION.fireball;
      showToast("🔥 Fireball!", 1300);
      break;
    case "bomb":
      triggerBomb();
      showToast("💣 Boom!", 1300);
      break;
  }
}

function updateDrops() {
  drops.forEach((d) => (d.y += 2.4));
  drops = drops.filter((d) => {
    if (d.y - 11 > FIELD.h) return false;
    if (d.y + 11 >= paddle.y && d.y - 11 <= paddle.y + paddle.h && d.x >= paddle.x - 8 && d.x <= paddle.x + paddle.w + 8) {
      activatePowerup(d.type);
      return false;
    }
    return true;
  });
}

function checkEffectExpiry(now) {
  if (effectEndsAt.slowball && now > effectEndsAt.slowball) {
    /* Back to the level's normal speed, same direction. Dividing by 0.6 used
       to speed up balls that were never slowed (a multi-ball split or a fresh
       serve during the slow spell), and the speed kept compounding. */
    balls.forEach((b) => {
      const sp = Math.hypot(b.dx, b.dy);
      if (sp > 0) { b.dx = (b.dx / sp) * ballBaseSpeed; b.dy = (b.dy / sp) * ballBaseSpeed; }
    });
    effectEndsAt.slowball = 0;
  }
  if (effectEndsAt.bigpaddle && now > effectEndsAt.bigpaddle) effectEndsAt.bigpaddle = 0;
  if (effectEndsAt.fireball && now > effectEndsAt.fireball) effectEndsAt.fireball = 0;
}

function getPaddleWidth(now) {
  return effectEndsAt.bigpaddle > now ? paddle.baseW * 1.5 : paddle.baseW;
}

function launchBall() {
  if (!serving || !isPlaying || isBoardFrozen()) return;
  serving = false;
  const sp = effectEndsAt.slowball > simMs ? ballBaseSpeed * 0.6 : ballBaseSpeed;
  balls.forEach((b) => {
    b.dx = sp * (Math.random() > 0.5 ? 1 : -1);
    b.dy = -sp;
  });
}

/* One original Breakout frame of simulation. */
function step() {
  frameCount++;
  simMs += STEP_MS;
  const now = simMs;
  if (!playedThisAttempt) {
    playedThisAttempt = true;
    setLastPlayedLevel(currentLevel);
  }

  checkEffectExpiry(now);
  const fireActive = effectEndsAt.fireball > now;

  bricks.forEach((col) => {
    col.forEach((b) => {
      if (b.visible && b.moving) b.x = b.baseX + Math.sin(frameCount * 0.03 + b.movePhase) * 18;
      if (b.fireCooldown > 0) b.fireCooldown--;
    });
  });

  paddle.w = getPaddleWidth(now);
  paddle.x += paddle.dx;
  if (paddle.x + paddle.w > FIELD.w) paddle.x = FIELD.w - paddle.w;
  if (paddle.x < 0) paddle.x = 0;

  if (serving) {
    balls.forEach((b) => {
      b.x = paddle.x + paddle.w / 2;
      b.y = paddle.y - b.size - 2;
    });
  } else {
    balls.forEach((b) => {
      b.x += b.dx;
      b.y += b.dy;
    });

    /* Walls: the ball is put back inside the field and sent AWAY from the
       wall, rather than just having its direction flipped. A plain flip could
       leave a fast ball outside the wall after its bounce, flip it straight
       back next frame, and pin it sliding along the wall forever — a level
       that can never be finished. */
    balls.forEach((b) => {
      if (b.x - b.size < 0) {
        b.x = b.size;
        b.dx = Math.abs(b.dx);
        playWallSound();
      } else if (b.x + b.size > FIELD.w) {
        b.x = FIELD.w - b.size;
        b.dx = -Math.abs(b.dx);
        playWallSound();
      }
      if (b.y - b.size < 0) {
        b.y = b.size;
        b.dy = Math.abs(b.dy);
        playWallSound();
      }
    });

    balls.forEach((b) => {
      if (b.dy > 0 && overlaps(b, paddle)) {
        b.y = paddle.y - b.size;
        playPaddleSound();
        combo = 0;
        const hitPos = (b.x - (paddle.x + paddle.w / 2)) / (paddle.w / 2);
        const clampedHit = Math.max(-1, Math.min(1, hitPos));
        const bounceAngle = clampedHit * ((60 * Math.PI) / 180);
        const speed = Math.hypot(b.dx, b.dy);
        b.dx = speed * Math.sin(bounceAngle);
        b.dy = -speed * Math.cos(bounceAngle);
        const minDx = speed * 0.25;
        if (Math.abs(b.dx) < minDx) b.dx = clampedHit < 0 ? -minDx : minDx;
      }
    });
  }

  if (!serving) balls.forEach((ball) => collideBricks(ball, fireActive));

  updateDrops();

  // A cleared wall wins even if the last ball drops out on the same frame.
  if (!bricks.some((col) => col.some((b) => b.visible))) {
    winLevel();
    return;
  }

  if (!serving) {
    const before = balls.length;
    balls = balls.filter((b) => b.y - b.size <= FIELD.h);
    if (balls.length === 0 && before > 0) loseLife();
  }
}

/* Ball vs bricks for one frame.
   Fireball: burns through every brick it touches (each brick at most once per
   6 frames), no bounce.
   Normal: the ball hits ONE brick — the one it overlaps most — and bounces off
   the side it actually came in through (left/right or top/bottom, whichever
   it is least deep into), and is pushed back out of it. This replaces a plain
   "dy *= -1" for every overlapping brick, which (a) never bounced sideways, so
   a ball entering a brick from the side flipped dy every frame and ploughed
   straight through, spending all 3 hits of an armoured brick in 3 frames; and
   (b) on a seam between two bricks flipped dy twice, cancelling the bounce, so
   the ball broke both and carried on up through the wall. */
function collideBricks(ball, fireActive) {
  let best = null;
  let bestArea = 0;
  for (const col of bricks) {
    for (const b of col) {
      if (!b.visible || !overlaps(ball, b)) continue;
      if (fireActive) {
        if (!(b.fireCooldown > 0)) {
          hitBrick(b);
          b.fireCooldown = 6;
        }
        continue;
      }
      const ox = Math.min(ball.x + ball.size, b.x + b.w) - Math.max(ball.x - ball.size, b.x);
      const oy = Math.min(ball.y + ball.size, b.y + b.h) - Math.max(ball.y - ball.size, b.y);
      if (ox * oy > bestArea) {
        bestArea = ox * oy;
        best = { b, ox, oy };
      }
    }
  }
  if (!best) return;
  const { b, ox, oy } = best;
  if (ox < oy) {
    // came in through the left or right side
    if (ball.x < b.x + b.w / 2) { ball.x -= ox; ball.dx = -Math.abs(ball.dx); }
    else { ball.x += ox; ball.dx = Math.abs(ball.dx); }
  } else {
    // came in through the top or bottom
    if (ball.y < b.y + b.h / 2) { ball.y -= oy; ball.dy = -Math.abs(ball.dy); }
    else { ball.y += oy; ball.dy = Math.abs(ball.dy); }
  }
  hitBrick(b);
}

/* The last ball fell: one life gone. With lives left, a fresh ball waits on
   the paddle for a launch (Space / tap / ◀ ▶ / arrow keys); with none left
   it is Game Over. */
function loseLife() {
  lives = Math.max(0, lives - 1);
  combo = 0;
  updateUI();
  if (lives <= 0) {
    ballLost();
    return;
  }
  drops = [];
  balls = [makeBall(paddle.x + paddle.w / 2, paddle.y - 10, 0, 0)];
  serving = true;
  playLoseLifeSound();
}

/* Board stands still: paused, or a video ad / the unlock dialog in front. */
function isBoardFrozen() {
  return gamePaused || adIsPlaying || !confirmOverlayEl.classList.contains("hidden");
}

/* Fixed 60-steps-per-second clock (Pac-Man standard): one step is exactly one
   original Breakout frame, so the game plays at the same speed on a 60 Hz,
   90 Hz or 120 Hz screen. */
const MAX_SUBSTEPS = 8;
let lastTs = 0;
let stepAcc = 0;
function loop(ts) {
  if (screens.game.classList.contains("active")) {
    if (isBoardFrozen() || !isPlaying) {
      lastTs = 0;
      stepAcc = 0;
    } else {
      if (!lastTs) lastTs = ts;
      stepAcc = Math.min(stepAcc + (ts - lastTs), STEP_MS * MAX_SUBSTEPS);
      lastTs = ts;
      let steps = 0;
      while (stepAcc >= STEP_MS - 1 && steps < MAX_SUBSTEPS && isPlaying) {
        step();
        stepAcc -= STEP_MS;
        steps++;
      }
    }
    draw();
  } else {
    lastTs = 0;
    stepAcc = 0;
  }
  requestAnimationFrame(loop);
}

// ===================== VIDEO / BANNER ADS (Pac-Man standard) =====================
// - "continue"              -> Game Over -> Watch Ad & Continue (no limit; restores 3 lives)
// - "restart"               -> in-game Restart button (once per attempt)
// - "level_gate"            -> every 3rd level, when Next Level is pressed
// - "recover"               -> Level Select, unlocking a level after a 24-hour
//                              reset (5 plays in a row, skippable after 10s)
// - "level_complete_banner" -> MREC 300x250 inside the Congratulations popup
// - "banner"                -> VERTICAL_BANNER 300x600 beside the board
// - "leaderboard"           -> LEADER_BOARD 970x90 above the board
// Read from sponsor-media.json, with this built-in copy as the fallback when
// it can't be fetched (e.g. opening index.html via file://).
const SPONSOR_JSON_URL = "sponsor-media.json";
const AD_LOAD_TIMEOUT_MS = 12000;

const SPONSOR_FALLBACK_CATALOGUE = {
  "ads": [
    {
      "id": "bo-continue-1",
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
      "id": "bo-continue-2",
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
      "id": "bo-restart-1",
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
      "id": "bo-restart-2",
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
      "id": "bo-levelgate-1",
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
      "id": "bo-recover-1",
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
      "id": "bo-banner-creditkey",
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
      "id": "bo-banner-creditkey-2",
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
      "id": "bo-banner-creditkey-3",
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
      "id": "bo-rail-creditkey",
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
      "id": "bo-rail-creditkey-2",
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
      "id": "bo-rail-creditkey-3",
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
      "id": "bo-leader-creditkey",
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
      "id": "bo-leader-creditkey-2",
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
      "id": "bo-leader-creditkey-3",
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
 * { shown: boolean } — if no ad is available or it fails to load, the
 * overlay closes instantly and the caller continues as normal; the player
 * is never blocked.
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

    function finish(shown) {
      if (settled) return;
      settled = true;
      clearTimeout(loadTimer);
      cleanup();
      closeAdOverlay();
      resolve({ shown: !!shown });
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
      const onEnded = () => finish(true);
      const onError = () => {
        if (adVideoEl.error) finish(false);
      };
      const onSkip = () => finish(true);
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

      adVideoEl.muted = soundMuted;
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

// Every-3rd-level gate (Pac-Man standard): an ad plays when the player
// presses Next Level after clearing level 3, 6, 9 ...
function isAdGateLevel(level) {
  return level % 3 === 0;
}

/* The win / Game Over popups open after a short beat; the timer is kept so
   anything that leaves the board first (Exit, 24h reset) can cancel it. */
let resultPopupTimer = null;

function winLevel() {
  isPlaying = false;
  serving = false;
  paddle.dx = 0;
  coinsEarnedThisAttempt = 0; // level cleared — coins are safe now
  markLevelCompleted(currentLevel);
  if (isAdGateLevel(currentLevel) && currentLevel < MAX_LEVEL) setGateAdOwed(currentLevel + 1, true);

  const stars = continuesUsedThisLevel === 0 ? 3 : continuesUsedThisLevel === 1 ? 2 : 1;
  setStars(currentLevel, stars);

  let coinsEarned = computeLevelCoins(currentLevel);
  if (continuesUsedThisLevel === 0) coinsEarned += 15; // cleared without a continue
  if (stars === 3) coinsEarned += 10;                  // 3-star bonus
  addCoins(coinsEarned);
  playWinSound();
  updateUI();

  clearTimeout(resultPopupTimer);
  resultPopupTimer = setTimeout(() => {
    resultPopupTimer = null;
    const isLast = currentLevel >= MAX_LEVEL;
    const clearedLevel = currentLevel;
    lastOverlayWasWin = true;

    modalTitle.textContent = "\u{1F389} Congratulations!";
    // Pac-Man's wording, so the popup keeps Pac-Man's size. The stars ride on
    // the coins line instead of taking a row of their own.
    modalMessage.textContent = isLast
      ? `You finished all ${MAX_LEVEL} levels with a score of ${score}!`
      : `Level ${clearedLevel} cleared with a score of ${score}. Level ${clearedLevel + 1} is now unlocked.`;
    modalCoins.innerHTML = `<span class="modal-coins-stars" aria-label="${stars} of 3 stars">${starsHtml(stars)}</span>+${coinsEarned} \u{1FA99} coins`;
    modalCoins.classList.remove("hidden");
    continueAdBtn.classList.add("hidden");
    continueNote.classList.add("hidden");
    loadLevelCompleteBanner();

    wireModalButtons(
      isLast ? "\u{1F5FA} Levels" : "Next Level \u27A1",
      "\u{1F5FA} Levels",
      () => {
        if (isLast) {
          goToLevelSelect();
          return;
        }
        // The level-gate ad (if owed) plays inside playLevel().
        playLevel(clearedLevel + 1, {
          gateText: `Level ${clearedLevel} cleared \u2014 your reward is next!`,
          lockBtn: modalPrimaryBtn,
        });
      },
      () => goToLevelSelect()
    );
    setModalPrevLevel(clearedLevel > 1 ? clearedLevel - 1 : 0);
    overlay.classList.remove("hidden");
  }, 150);
}

function ballLost() {
  combo = 0;
  isPlaying = false;
  paddle.dx = 0;
  playLoseSound();
  clearTimeout(resultPopupTimer);
  resultPopupTimer = setTimeout(() => {
    resultPopupTimer = null;
    lastOverlayWasWin = false;
    modalTitle.textContent = "Game Over \u{1F480}";
    modalMessage.textContent = `You scored ${score} on Level ${currentLevel}. Try again?`;
    modalCoins.classList.add("hidden");
    modalBannerAd.classList.add("hidden");
    modalBannerAd.innerHTML = "";
    stopModalBannerCarousel();

    // Always offered — there is no cap on ad-based continues (Pac-Man).
    continueAdBtn.classList.remove("hidden");
    continueAdBtn.disabled = false;
    continueNote.classList.remove("hidden");
    continueNote.textContent = "Watch a short ad to pick up right where you were \u2014 with " +
      CONTINUE_LIVES + " fresh lives.";

    wireModalButtons(
      "\u{1F501} Retry Level",
      "\u{1F5FA} Level Select",
      () => {
        forfeitAttemptCoins();
        setupLevel(currentLevel);
      },
      () => {
        forfeitAttemptCoins();
        goToLevelSelect();
      }
    );
    overlay.classList.remove("hidden");
  }, 150);
}

/* Giving up from Game Over without continuing claws back that attempt's
   brick coins (Breakout rule). */
function forfeitAttemptCoins() {
  if (coinsEarnedThisAttempt > 0) {
    const amount = coinsEarnedThisAttempt;
    setCoins(getCoins() - amount);
    coinsEarnedThisAttempt = 0;
    showToast(`Gave up without a continue \u2014 ${amount} \u{1FA99} from this attempt were forfeited.`, 2400);
  }
}

let continueAdInFlight = false;
function grantContinue() {
  // Only guards against a double tap while the ad is playing — never a cap.
  if (continueAdInFlight || isPlaying) return;
  continueAdInFlight = true;
  continueAdBtn.disabled = true;
  overlay.classList.add("hidden");
  stopModalBannerCarousel();
  playVideoAd({
    placement: "continue",
    rewardText: "Watch the ad to continue this attempt \u2014 score and bricks are kept.",
  }).then((res) => {
    continueAdInFlight = false;
    // No ad shown -> no continue (Pac-Man rule). Back to the Game Over popup.
    if (!res || !res.shown) {
      continueAdBtn.disabled = false;
      continueNote.textContent = "The ad couldn't load, so no continue was given. Please try again.";
      overlay.classList.remove("hidden");
      return;
    }
    continuesUsedThisLevel += 1;
    // All 3 lives back on EVERY continue (Pac-Man). The SAME attempt resumes:
    // bricks/score/combo untouched, the ball waits on the paddle for a launch.
    lives = CONTINUE_LIVES;
    drops = [];
    balls = [makeBall(paddle.x + paddle.w / 2, paddle.y - 10, 0, 0)];
    serving = true;
    isPlaying = true;
    updateUI();
  });
}
continueAdBtn.addEventListener("click", grantContinue);

// ===================== CONTROLS =====================
/* Paddle buttons ◀ ▶ (no joystick). They sit in the centre of the game bar,
   where Pac-Man keeps its move control. Holding one moves the paddle at its
   normal speed for as long as it is held; releasing, sliding off or losing
   the touch stops it. Pointer events cover touch, mouse and pen alike, and
   pointer capture keeps a held press alive if the finger drifts a little.
   Pressing either one also launches a ball waiting on the paddle. Nothing
   moves while the board is frozen (paused, ad, unlock dialog). */
/* What is held right now, from the on-screen keys AND the keyboard. The
   paddle's direction is always worked out from all of it, so pressing Left
   while Right is still down, then letting Right go, keeps moving left (it
   used to stop dead, because any key-up simply zeroed the speed). */
const paddleHeld = { left: false, right: false };
const keysHeld = { left: false, right: false };
function applyHeldPaddle() {
  if (isBoardFrozen()) { paddle.dx = 0; return; }
  const right = paddleHeld.right || keysHeld.right;
  const left = paddleHeld.left || keysHeld.left;
  paddle.dx = ((right ? 1 : 0) - (left ? 1 : 0)) * paddle.speed;
}
function releasePaddleButtons() {
  paddleHeld.left = false;
  paddleHeld.right = false;
  keysHeld.left = false;
  keysHeld.right = false;
  document.querySelectorAll(".paddle-btn.is-held").forEach((el) => el.classList.remove("is-held"));
}
(function initPaddleButtons() {
  [["paddleLeftBtn", "left"], ["paddleRightBtn", "right"]].forEach(([id, side]) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    const down = (e) => {
      if (!screens.game.classList.contains("active")) return;
      e.preventDefault();
      if (isBoardFrozen()) return;
      try { btn.setPointerCapture(e.pointerId); } catch (_) {}
      paddleHeld[side] = true;
      btn.classList.add("is-held");
      applyHeldPaddle();
      launchBall();
    };
    const up = (e) => {
      if (!paddleHeld[side]) return;
      paddleHeld[side] = false;
      btn.classList.remove("is-held");
      try { btn.releasePointerCapture(e.pointerId); } catch (_) {}
      applyHeldPaddle();
    };
    btn.addEventListener("pointerdown", down);
    btn.addEventListener("pointerup", up);
    btn.addEventListener("pointercancel", up);
    btn.addEventListener("lostpointercapture", up);
    btn.addEventListener("click", (e) => e.preventDefault());
    btn.addEventListener("contextmenu", (e) => e.preventDefault());
  });
})();

/* Keyboard: Breakout's keys (arrows / A D move, Space / Up launch) plus the
   shared Escape / P pause. */
const RIGHT_KEYS = ["Right", "ArrowRight", "d", "D"];
const LEFT_KEYS = ["Left", "ArrowLeft", "a", "A"];
const MOVE_KEYS = [...RIGHT_KEYS, ...LEFT_KEYS];
document.addEventListener("keydown", (e) => {
  // Escape closes the "Unlock Level" dialog (same as Cancel), on any screen.
  if (e.key === "Escape" && !confirmOverlayEl.classList.contains("hidden") && !adIsPlaying) {
    e.preventDefault();
    confirmCancelBtn.click();
    return;
  }
  if (!screens.game.classList.contains("active")) return;
  if (e.key === "Escape" || e.key === "p" || e.key === "P") {
    e.preventDefault();
    if (!overlay.classList.contains("hidden") || adIsPlaying || !confirmOverlayEl.classList.contains("hidden")) return;
    setPaused(!gamePaused);
    return;
  }
  // With a popup or dialog open the keys belong to its buttons: Space / Enter
  // must press the focused button, not be swallowed as "launch the ball".
  if (!overlay.classList.contains("hidden") || !confirmOverlayEl.classList.contains("hidden")) return;
  if (isBoardFrozen()) return;
  if (RIGHT_KEYS.includes(e.key)) keysHeld.right = true;
  else if (LEFT_KEYS.includes(e.key)) keysHeld.left = true;
  applyHeldPaddle();
  if ([...MOVE_KEYS, " ", "ArrowUp"].includes(e.key)) {
    if (e.key === " " || e.key.startsWith("Arrow")) e.preventDefault();
    launchBall();
  }
});
document.addEventListener("keyup", (e) => {
  if (RIGHT_KEYS.includes(e.key)) keysHeld.right = false;
  else if (LEFT_KEYS.includes(e.key)) keysHeld.left = false;
  else return;
  applyHeldPaddle();
});

/* Drag directly on the board to move the paddle to the finger. */
function movePaddleToClientX(clientX) {
  const rect = canvas.getBoundingClientRect();
  const border = canvas.clientLeft || 0;
  const w = canvas.clientWidth || rect.width;
  const x = ((clientX - rect.left - border) * FIELD.w) / w;
  paddle.x = Math.max(0, Math.min(FIELD.w - paddle.w, x - paddle.w / 2));
}
canvas.addEventListener("touchstart", (e) => {
  if (!isPlaying || isBoardFrozen()) return;
  e.preventDefault();
  movePaddleToClientX(e.touches[0].clientX);
  launchBall();
}, { passive: false });
canvas.addEventListener("touchmove", (e) => {
  if (!isPlaying || isBoardFrozen()) return;
  e.preventDefault();
  movePaddleToClientX(e.touches[0].clientX);
}, { passive: false });
canvas.addEventListener("click", () => {
  if (isPlaying) launchBall();
});

// ===================== IN-GAME BUTTONS =====================
/* Restart, gated behind one ad per attempt (Pac-Man standard). */
let restartAdUsedThisRun = false;
restartBtn.addEventListener("click", () => {
  if (restartAdUsedThisRun) return;
  restartBtn.disabled = true;
  playVideoAd({
    placement: "restart",
    rewardText: "Watch the ad to restart this level.",
  }).then((res) => {
    if (!res || !res.shown) {
      restartBtn.disabled = false;
      showToast("The ad couldn't load \u2014 level not restarted. Please try again.");
      return;
    }
    setupLevel(currentLevel);
    restartAdUsedThisRun = true;
    restartBtn.disabled = true;
  });
});

/* Prev / Next / the popup's "⬅ Level N" all go through the same gate as a
   Level Select tile: unlocked -> play; ad-unlockable -> confirm + 5 ads;
   otherwise nothing. */
/* The one way into an unlocked level. If a level-gate ad is owed for it
   (see isGateAdOwed), that ad plays first and the level starts only once it
   has been shown; if it couldn't load, nothing is skipped — the player stays
   where they were and can try again. */
let gateAdInFlight = false;
function playLevel(level, { gateText, lockBtn, onStart } = {}) {
  if (gateAdInFlight) return;
  if (!isGateAdOwed(level)) {
    if (onStart) onStart();
    setupLevel(level);
    return;
  }
  gateAdInFlight = true;
  if (lockBtn) lockBtn.disabled = true;
  playVideoAd({
    placement: "level_gate",
    rewardText: gateText || `Watch the ad to play Level ${level}.`,
  }).then((res) => {
    gateAdInFlight = false;
    if (lockBtn) lockBtn.disabled = false;
    if (!res || !res.shown) {
      showToast(`The ad couldn't load \u2014 Level ${level} needs it before you can play. Please try again.`);
      return;
    }
    setGateAdOwed(level, false);
    if (onStart) onStart();
    setupLevel(level);
  });
}

function goToLevelGated(level, { closeOverlay } = {}) {
  if (level < 1 || level > TOTAL_LEVELS || levelUnlockInProgress) return;
  if (isLevelUnlocked(level)) {
    playLevel(level, { onStart: closeOverlay ? hideOverlay : null });
    return;
  }
  if (isLevelAdUnlockable(level)) {
    showUnlockConfirm(level, { onConfirm: closeOverlay ? hideOverlay : null });
  }
}

prevLevelBtn.addEventListener("click", () => goToLevelGated(currentLevel - 1));
nextLevelBtn.addEventListener("click", () => goToLevelGated(currentLevel + 1));
exitBtn.addEventListener("click", () => {
  stopGame();
  goToLevelSelect();
});

// ===================== SCREEN NAVIGATION =====================
function showScreen(name) {
  if (!screens[name]) return;
  if (gamePaused) setPaused(false);
  Object.values(screens).forEach((s) => s.classList.remove("active"));
  screens[name].classList.add("active");
  if (name !== "game") {
    stopGame();
    if (name === "menu") updateCoinDisplays();
  }
  document.body.classList.toggle("in-game", name === "game");
  if (name === "game") loadSideRails();
  else hideSideRails();
}

function goToLevelSelect() {
  hideOverlay();
  buildLevelGrid();
  showScreen("levelSelect");
}

playBtn.addEventListener("click", () => {
  getAudioCtx(); // unlock audio on the first user gesture
  playLevel(getResumeLevel());
});

levelSelectBtn.addEventListener("click", () => {
  getAudioCtx();
  goToLevelSelect();
});

let howToReturnScreen = "menu";
function openHowToPlay(from) {
  howToReturnScreen = from || "menu";
  showScreen("howto");
}
howToPlayBtn.addEventListener("click", () => openHowToPlay("menu"));
document.getElementById("levelHelpBtn").addEventListener("click", () => openHowToPlay("levelSelect"));

document.querySelectorAll(".back-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const inHowTo = !!btn.closest("#howToPlayScreen");
    showScreen(inHowTo ? howToReturnScreen : btn.dataset.target);
    if (inHowTo) howToReturnScreen = "menu";
  });
});

// ===================== LEVEL SELECT =====================
/* Breakout's own difficulty tiers, shown on the startable tile with the
   shared colour scale. */
const TIER_LABEL = {
  beginner: { key: "easy", label: "Easy" },
  fast: { key: "medium", label: "Fast" },
  strong: { key: "hard", label: "Strong" },
  moving: { key: "hard", label: "Moving" },
  complex: { key: "expert", label: "Complex" },
  boss: { key: "expert", label: "Boss" },
};

function buildLevelGrid() {
  const furthest = getFurthestUnlockedLevel();
  const progressLine = document.getElementById("levelProgressLine");
  if (progressLine) progressLine.textContent = "Level " + furthest + " of " + TOTAL_LEVELS + " unlocked";

  levelGrid.innerHTML = "";
  for (let i = 1; i <= TOTAL_LEVELS; i++) {
    const btn = document.createElement("button");
    const tier = TIER_LABEL[getTier(i)];
    btn.className = `level-btn diff-${tier.key}`;
    const completed = isLevelCompleted(i);
    const unlocked = isLevelUnlocked(i);
    const adUnlockable = isLevelAdUnlockable(i);
    if (completed) btn.classList.add("completed");
    else if (unlocked) btn.classList.add("unlocked");
    else btn.classList.add("locked");

    const st = getStars(i);
    if (completed) {
      btn.innerHTML = `<span class="level-num">${i}</span>` +
        (st > 0 ? `<span class="level-stars">${starsHtml(st)}</span>` : "");
    } else if (unlocked) {
      btn.innerHTML = `<span class="level-num">${i}</span><span class="level-diff">${tier.label}</span>`;
    } else {
      btn.innerHTML = `<span class="level-lock">🔒</span><span class="level-num">${i}</span>`;
    }
    if (adUnlockable) btn.title = "Watch " + UNLOCK_ADS_REQUIRED + " ads to unlock this level and continue the game";
    else if (unlocked && isGateAdOwed(i)) btn.title = "Watch a short ad to play this level";
    if (levelUnlockInProgress) btn.disabled = true;
    btn.addEventListener("click", () => {
      if (levelUnlockInProgress) return;
      if (unlocked) playLevel(i);
      else if (adUnlockable) showUnlockConfirm(i);
    });
    levelGrid.appendChild(btn);
  }
}

/* ---------- Unlock a locked level by watching 5 ads (after a 24h reset) ---------- */
const UNLOCK_ADS_REQUIRED = 5;
let levelUnlockInProgress = false;

function showUnlockConfirm(level, { onConfirm } = {}) {
  if (levelUnlockInProgress) return;
  confirmTitleEl.textContent = "\u{1F4FA} Unlock Level " + level;
  confirmMessageEl.textContent = "Watch " + UNLOCK_ADS_REQUIRED + " ads to unlock this level and continue the game.";
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
  stopGame();
  buildLevelGrid();

  let watched = 0;
  function playNext() {
    watched++;
    return playVideoAd({
      placement: "recover",
      rewardText: "Watching ad " + watched + " of " + UNLOCK_ADS_REQUIRED + " to unlock Level " + level + "\u2026",
    }).then((res) => {
      if (!res || !res.shown) return false; // one failed ad stops the sequence, no unlock
      return watched < UNLOCK_ADS_REQUIRED ? playNext() : true;
    });
  }

  playNext().then((ok) => {
    levelUnlockInProgress = false;
    if (!ok) {
      buildLevelGrid();
      if (screens.game.classList.contains("active")) goToLevelSelect();
      showToast("An ad couldn't load \u2014 Level " + level + " was not unlocked. Please try again.");
      return;
    }
    unlockLevel(level);
    buildLevelGrid();
    setupLevel(level);
  });
}

// ===================== OVERLAY / MODAL =====================
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
  modalPrimaryBtn.replaceWith(newPrimary);
  modalPrimaryBtn = newPrimary;
  modalPrimaryBtn.disabled = false;
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

modalCloseX.addEventListener("click", () => {
  if (!lastOverlayWasWin) forfeitAttemptCoins();
  hideOverlay();
  goToLevelSelect();
});

/* =====================  AD PLACEMENT DURING PLAY (Pac-Man standard)  =====================
   Landscape: one or two IAB VERTICAL_BANNER 300x600 cards beside the board,
   sized from the board's height and scaled as a whole (never cropped or
   stretched). Portrait, or landscape too cramped for a side card: one IAB
   LEADER_BOARD 970x90 above the board, in a band reserved out of the board's
   height. Every card rotates every 5 seconds. This is Pac-Man's placement
   code unchanged; only the board it measures is Breakout's 2D canvas
   (syncBarToMaze() -> resizeBoard()). The CSS variables it sets (--maze-w,
   --maze-x, --ad-band) keep Pac-Man's names so the shared stylesheet applies
   as-is. */
const AD_RAIL_W = 300;
const AD_RAIL_H = 600;

const AD_LEADER_W = 970;
const AD_LEADER_H = 90;
const LEADER_MIN_SCALE = 0.22;

const RAIL_EDGE = 0;
const LEADERBOARD_MARGIN = 5;

const PHONE_NO_RAIL_MAX_W = 500;

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

  el.style.background = ad.bgFrom || "#6a3fb5";
  el.innerHTML = railCardHtml(ad);
}

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

  el.classList.toggle("has-image-ad", !!ad.imageUrl);
  if (ad.imageUrl) {
    el.style.background = ad.bgFrom || "#1b2437"; // not setAttribute("style"): that would wipe left/top/--ad-scale
    el.innerHTML =
      '<img class="ad-unit-img" src="' + ad.imageUrl + '" width="970" height="90" alt="' +
      (ad.advertiser || "Advertisement") + '" />' + adDotsHtml(ad);
    return;
  }

  el.style.background = ad.bgFrom || "#6a3fb5";
  el.innerHTML = leaderboardCardHtml(ad);
}

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
  if (leaderboardCarouselTimer) return;
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

  el.innerHTML = '';
  el.appendChild(track);
  el.style.background = ad.bgBottom || ad.bgFrom || '#1b2437';
  el.classList.toggle('clickable', !!ad.clickUrl);
  el.onclick = ad.clickUrl ? () => window.open(ad.clickUrl, '_blank', 'noopener') : null;

  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      track.classList.add('slide-next');
    }));
    setTimeout(() => {
      
      el.innerHTML = '<img class="ad-unit-img" src="' + ad.imageUrl + '" width="300" height="600" alt="' +
        (ad.advertiser || 'Advertisement') + '" />';
      el.classList.remove('ad-sliding');
      resolve();
    }, 430);
  });
}

function startRailCarousel() {
  if (railCarouselTimer) return;
  railCarouselTimer = setInterval(() => {
    const shown = railEls().filter((el) => el && el.classList.contains("is-shown"));
    if (!shown.length) {
      stopRailCarousel();
      return;
    }

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
          if (!ad || !el.classList.contains("is-shown")) return null;
          return slideRailCard(el, ad);
        })
      )
    );

    chain.then(() => fitSideRails()).catch(() => {});
  }, 5000);
}

function stopModalBannerCarousel() {
  if (modalBannerCarouselTimer) {
    clearInterval(modalBannerCarouselTimer);
    modalBannerCarouselTimer = null;
  }
}

function startModalBannerCarousel() {
  if (modalBannerCarouselTimer) return;
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
      if (modalBannerAd.classList.contains("hidden")) return;
      if (overlayEl.classList.contains("hidden")) {
        stopModalBannerCarousel();
        return;
      }
      swapAdCard(modalBannerAd, () => buildBannerCard(modalBannerAd, ad));
    });
  }, 5000);
}

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
    .catch(() => {});
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
  
  const wrapperEl = document.querySelector(".wrapper");
  if (wrapperEl) wrapperEl.style.removeProperty("--ad-gutter-right");
  syncBarToMaze();
}

function placeLeaderboardTop() {
  const adLeaderboardEl = document.getElementById("adLeaderboard");
  const gs = document.getElementById("gameScreen");
  if (!adLeaderboardEl || !gs || !adLeaderboardEl.innerHTML) return false;

  const vp = layoutViewport();

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
  gs.style.removeProperty("--game-edge-margin");
  
  const wrapTop = document.querySelector(".wrapper");
  if (wrapTop) wrapTop.style.removeProperty("--ad-gutter-right");
  
  gs.style.setProperty("--ad-band", (cardH + 2 * LEADERBOARD_MARGIN) + "px");

  const left = Math.round((vp.w - cardW) / 2);
  const top = LEADERBOARD_MARGIN;
  adLeaderboardEl.style.left = left + "px";
  adLeaderboardEl.style.top = top + "px";
  adLeaderboardEl.style.setProperty("--ad-scale", String(scale));
  adLeaderboardEl.classList.add("is-shown");

  railEls().forEach((el) => el && el.classList.remove("is-shown"));
  
  stopRailCarousel();
  startLeaderboardCarousel();

  syncBarToMaze();
  return true;
}

function syncBarToMaze() {
  const gs = document.getElementById("gameScreen");
  if (!gs || !gs.classList.contains("active")) return;
  resizeBoard(true);
}

function fitSideRailsInner() {
  const [adRailLeft, adRailRight] = railEls();
  if (!adRailLeft || !adRailRight) return;
  const gs = document.getElementById("gameScreen");
  if (!gs || !gs.classList.contains("active") || !adRailLeft.innerHTML) {
    hideSideRails();
    return;
  }

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

const LAND_AD_GAP = 8;
const LAND_MIN_SCALE = 0.22;
const LAND_TWO_IF_WIDER = 1.4;
const LAND_TWO_MIN_ASPECT = 1.0;
const LAND_MAX_ASPECT = 2.0;

function layoutLandscapeGame(gs, adRailLeft, adRailRight) {
  const wrapperEl = document.querySelector(".wrapper");
  const canvasEl = document.getElementById("gameCanvas");

  gs.style.removeProperty("--ad-band");
  gs.style.removeProperty("--game-max");
  gs.style.removeProperty("--maze-max");
  gs.style.removeProperty("--game-edge-margin");
  gs.style.removeProperty("--phone-bar-w");
  gs.style.removeProperty("--bar-w");
  gs.style.removeProperty("--tablet-ad-extend");
  if (wrapperEl) wrapperEl.style.removeProperty("--ad-gutter-right");

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

  let n = 1;
  const w1 = innerW - (cardW + gap);
  const w2 = innerW - 2 * (cardW + gap);
  if (w2 >= Hm * LAND_TWO_MIN_ASPECT && w1 > Hm * LAND_TWO_IF_WIDER) n = 2;

  if (n === 1 && w1 < Hm * minAspect) {
    cardW = Math.floor(innerW - gap - Hm * minAspect);
  }

  let scale = Math.floor((cardW / AD_RAIL_W) * 1000) / 1000;
  if (scale < LAND_MIN_SCALE) {
    
    gs.style.removeProperty("--maze-w");
    gs.style.removeProperty("--maze-x");
    if (!placeLeaderboardTop()) hideSideRails();
    return;
  }
  cardW = AD_RAIL_W * scale;
  const cardH = AD_RAIL_H * scale;

  let mazeW = Math.floor(innerW - n * (cardW + gap));
  if (!isPhoneWidth()) {
    mazeW = Math.min(mazeW, Math.floor(Hm * LAND_MAX_ASPECT));
  }
  const groupW = mazeW + n * (cardW + gap);
  const lead = Math.max(0, Math.floor((innerW - groupW) / 2));

  const mazeX = innerL + lead + (n === 2 ? cardW + gap : 0);
  gs.style.setProperty("--maze-w", mazeW + "px");
  gs.style.setProperty("--maze-x", Math.round(mazeX - innerL) + "px");

  gs.style.removeProperty("--ad-band");
  syncBarToMaze();

  let railTop = 2;
  let railH = Math.min(Hm, Math.floor(cardH));
  if (canvasEl) {
    railTop = Math.max(2, Math.round(layoutOffset(canvasEl).top));
    railH = Math.max(1, Math.round(layoutSize(canvasEl).h));
  }
  
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

  startRailCarousel();

  const adLeaderboardEl = document.getElementById("adLeaderboard");
  if (adLeaderboardEl) adLeaderboardEl.classList.remove("is-shown");
  stopLeaderboardCarousel();
}

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
  if (boardEl && boardEl.parentElement) boardWatcher.observe(boardEl.parentElement);
}

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

window.addEventListener("orientationchange", () => {
  scheduleRailFit(true);
  setTimeout(() => fitSideRails(), 350);
});
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", () => scheduleRailFit(false));
}
window.addEventListener("load", fitSideRails);
window.addEventListener("pageshow", () => fitSideRails());
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => fitSideRails());


// ===================== INIT =====================
checkSession();
applyEquippedSkins();
updateCoinDisplays();
setMuted(soundMuted);
buildLevelGrid();
showScreen("menu");
requestAnimationFrame(loop);

/* Auto-pause a live level when the tab / app goes to the background, so the
   player comes back to a paused board (Pac-Man standard). */
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    if (screens.game.classList.contains("active") && isPlaying && !adIsPlaying) setPaused(true);
    releasePaddleButtons();
    paddle.dx = 0;
    lastTs = 0;
    stepAcc = 0;
  } else if (screens.game.classList.contains("active")) {
    lastTs = 0;
    stepAcc = 0;
    resizeBoard(true);
  }
});
// A held key or button can't outlive the window losing focus (alt-tab, app
// switch): its key-up / pointer-up would never arrive.
window.addEventListener("blur", () => {
  releasePaddleButtons();
  paddle.dx = 0;
});
