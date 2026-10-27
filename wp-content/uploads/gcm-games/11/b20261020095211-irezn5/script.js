const canvas = document.getElementById("gameCanvas");

/* localStorage can throw (Safari private mode, sandboxed iframes, storage
   disabled, quota). It used to be called directly ~20 times, including at
   start-up, so a blocked storage killed the whole script before the menu
   was even wired. Every read/write goes through here instead and a failure
   just means "nothing saved". */
const store = {
  get(key) { try { return localStorage.getItem(key); } catch (e) { return null; } },
  set(key, val) { try { localStorage.setItem(key, val); } catch (e) {} },
  remove(key) { try { localStorage.removeItem(key); } catch (e) {} },
};

/* Declared here, at the very top, rather than next to
   stopLeaderboardCarousel()/startLeaderboardCarousel() further down which
   are its only two uses — see the comment on stopLeaderboardCarousel() for
   why a `let` used from showScreen()'s very first, synchronous call has to
   be reachable before that call runs, not merely before the functions that
   read it are DEFINED. */
let leaderboardCarouselTimer = null;

/* Same reasoning as leaderboardCarouselTimer above, for the other two
   placements that now rotate on the same 5s beat:
     railCarouselTimer        — the VERTICAL_BANNER 300x600 card(s) beside
                                the maze (one on a phone/tablet, two on a
                                desktop window).
     modalBannerCarouselTimer — the MREC 300x250 inside the Congratulations
                                popup.
   Both are reachable from code that runs during start-up, so they are
   declared here rather than beside the functions that use them. */
let railCarouselTimer = null;
let modalBannerCarouselTimer = null;

const cols = 28;
const rows = 31;

// ===================== 3D RENDERING (Three.js) =====================
// The maze/game LOGIC below still works entirely in grid units (col/row,
// fractional for smooth movement) exactly as before. Only the rendering
// layer at the bottom of this file was changed from a flat 2D canvas
// drawing to a real Three.js 3D scene — walls have height, the camera
// looks down at an angle, and Pac-Man/ghosts are proper 3D shapes.
const CELL = 1; // one Three.js world unit per maze grid cell
/* 0.28, was 0.40, was 0.50, was 0.62.
   This is not a look dial — it is HALF of how much corridor you can see.
   The camera is tilted, so a wall's top face is drawn WALL_HEIGHT / tan(tilt)
   up the screen from its base, and that overhang lands on the corridor tile
   behind it. What is left is the "lane": the strip of corridor that is
   actually visible, and the only place a pellet or Pac-Man can sit without
   touching a block.
   In screen-up units the lane measures  sin(tilt) - WALL_HEIGHT*cos(tilt),
   and a sphere of radius R always projects to a circle of radius R, so
   Pac-Man fits only while 2R <= that. The three numbers below are one
   answer to that inequality, and moving any of them alone breaks it:
     WALL_HEIGHT 0.28 + PAC_R 0.30 -> he clears the lane at every tilt from
     about 52 degrees up, and overlaps by only ~0.05 of a cell on each side
     at the flattest 44. At the old 0.40/0.42 he was 0.84 against a 0.41
     lane — twice the space available, which is why he read as wedged
     between the blocks however well he was centred. */
const WALL_HEIGHT = 0.28;
function worldX(col) { return (col - (cols - 1) / 2) * CELL; }
function worldZ(row) { return (row - (rows - 1) / 2) * CELL; }

const scoreEl = document.getElementById("score");
const livesEl = document.getElementById("lives");
const levelTitleEl = document.getElementById("levelTitle");
const restartBtn = document.getElementById("restartBtn");
const prevLevelBtn = document.getElementById("prevLevelBtn");
const nextLevelBtn = document.getElementById("nextLevelBtn");
const exitBtn = document.getElementById("exitBtn");
const muteBtns = document.querySelectorAll(".mute-btn");

// screens
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

/* ---------- Confirmation dialog elements ----------
   "Watch 5 ads to unlock Level X?" popup. The recoverable tile's click
   handler shows this BEFORE the ads roll, so the player opts in. OK fires
   the unlockLevelViaAds() flow; Cancel just closes the dialog.
   Both buttons get clone-and-replace wiring (same trick as
   wireModalButtons) so a previous OK / Cancel handler from the last tile
   tapped can never leak into the next one. */
const confirmOverlayEl   = document.getElementById("confirmOverlay");
const confirmTitleEl     = document.getElementById("confirmTitle");
const confirmMessageEl   = document.getElementById("confirmMessage");
const confirmSubMessageEl = document.getElementById("confirmSubMessage");
let   confirmOkBtn       = document.getElementById("confirmOkBtn");
let   confirmCancelBtn   = document.getElementById("confirmCancelBtn");

// ===================== COINS =====================
const COINS_KEY = "pacman_coins";
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
}

// ===================== LEVEL / PROGRESS CONFIG =====================
const TOTAL_LEVELS = 30;

// ---------- Unlocked levels ----------
// A SET of level numbers the player can currently start, not a single
// "unlocked up to here" pointer. That distinction matters once ads can
// unlock one specific level out of order (see UNLOCK_ADS_REQUIRED below):
// unlocking level 6 must NOT imply 2-5 are also playable, which a scalar
// frontier can't express but a set can. Level 1 is always available and is
// never actually stored.
const UNLOCKED_KEY = "pacman_unlockedLevels";

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

// The furthest level the player currently has access to — used only for
// the "Level X of 30 unlocked" line. NOT used to decide whether any specific
// level is playable (isLevelUnlocked() is the one source of truth for that),
// and NOT used by the menu's Play button any more (see getResumeLevel()):
// an ads-unlocked level counts toward "furthest" the moment it's unlocked,
// which used to make Play jump to it even if it was never played.
/* The ONE rule for "this locked level can be unlocked with ads": only after
   a 24-hour reset has happened, and only when the level right before it is
   still locked (i.e. it sits after a gap). Level Select's tiles and the
   in-game Prev / Next / popup buttons used to each carry their own copy. */
function isLevelAdUnlockable(level) {
  return level > 1 && level <= TOTAL_LEVELS && !isLevelUnlocked(level) &&
    hasSessionEverReset() && !isLevelUnlocked(level - 1);
}

function getFurthestUnlockedLevel() {
  return Math.min(TOTAL_LEVELS, Math.max(1, ...getUnlockedLevels()));
}

// ---------- Completed levels ----------
// Levels the player has actually WON, tracked separately from "unlocked"
// so a level that was only unlocked with ads (but not yet played) doesn't
// show as cleared, and so winning one level is what unlocks the next.
const COMPLETED_KEY = "pacman_completedLevels";

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

// Called on a level win: marks it cleared and unlocks the next level for
// free — the 24-hour-reset ad gate only ever applies to unlocking a
// locked level from the level-select screen, never to normal progression.
function markLevelCompleted(level) {
  const completed = getCompletedLevels();
  if (!completed.includes(level)) {
    completed.push(level);
    store.set(COMPLETED_KEY, JSON.stringify(completed));
  }
  unlockLevel(level + 1);
}

let currentLevel = 1;

// ---------- Last level actually played (what the Play button resumes) ----------
// Recorded only when the player really plays a level — their first steering
// input on it (see trySetDirection()) — never when a level is merely
// unlocked, whether by winning the one before it or by watching ads.
// Cleared with the rest of the session progress on a 24-hour reset.
const LAST_PLAYED_KEY = "pacman_lastPlayedLevel";

function getLastPlayedLevel() {
  const n = Number(store.get(LAST_PLAYED_KEY));
  return Number.isInteger(n) && n >= 1 && n <= TOTAL_LEVELS ? n : null;
}

function setLastPlayedLevel(level) {
  if (getLastPlayedLevel() !== level) store.set(LAST_PLAYED_KEY, String(level));
}

// The level the menu's Play button starts. The last level actually played,
// if there is one and it's still unlocked; otherwise (fresh session, or a
// save from before this key existed) the end of the unbroken run of unlocked
// levels starting at 1 — i.e. normal win-by-win progression only, so a level
// unlocked out of order with ads is never picked just for being unlocked.
function getResumeLevel() {
  const last = getLastPlayedLevel();
  if (last && isLevelUnlocked(last)) return last;
  let level = 1;
  while (level < TOTAL_LEVELS && isLevelUnlocked(level + 1)) level++;
  return level;
}

// ===================== 24-HOUR SESSION =====================
// Progress (unlocked/completed levels, coins, equipped/unlocked shop
// items) resets 24 hours after the session started. Sound preference is a
// device setting, not game progress, so it's deliberately excluded.
const SESSION_START_KEY = "pacman_sessionStart";
const SESSION_LENGTH_MS = 24 * 60 * 60 * 1000;
const SESSION_KEYS = [UNLOCKED_KEY, COMPLETED_KEY, LAST_PLAYED_KEY, COINS_KEY, "pacman_equipped", "pacman_unlocked_items",
  "pacman_adUnlockCeiling" /* retired key: still cleared so old saves don't keep it */];

// Separate from SESSION_KEYS on purpose: this flag must survive the wipe
// it gets set by, because it's what tells buildLevelGrid() a 24-hour reset
// has happened at least once. Only then does tapping a locked level offer
// the 5-ads unlock — before the first reset, locked levels behave exactly
// as they always did (a plain padlock, no ads, reached only by winning
// your way there). Once true it stays true; there's no scenario where it
// should go back to false.
const RESET_HAPPENED_KEY = "pacman_resetHappened";

function hasSessionEverReset() {
  return store.get(RESET_HAPPENED_KEY) === "1";
}

/* Session start time, or null when missing or unreadable. A corrupt value
   used to come back as NaN, and since NaN <= 0 is false the 24-hour reset
   could then never fire again. */
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
    applyEquippedCosmetics();
    updateCoinDisplays();
    // If a level was in progress, drop back to the menu with a fresh start.
    if (screens.game.classList.contains("active")) {
      gameOver = true;
      stopGhostSiren();
      hideOverlay();
      showScreen("menu");
    }
    if (screens.levelSelect.classList.contains("active")) buildLevelGrid();
    if (screens.shop.classList.contains("active")) renderShop(activeShopTab);
    showSessionToast();
  }
}

let sessionToastEl = null;
/* FIX: generic toast, reused for "ad couldn't load" messages. */
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
  if (!sessionToastEl) {
    sessionToastEl = document.createElement("div");
    sessionToastEl.className = "session-toast";
    document.body.appendChild(sessionToastEl);
  }
  sessionToastEl.textContent = "\u23F0 24-hour session over \u2014 progress reset, starting fresh";
  sessionToastEl.classList.add("show");
  clearTimeout(sessionToastEl._hideTimer);
  sessionToastEl._hideTimer = setTimeout(() => sessionToastEl.classList.remove("show"), 3200);
}

setInterval(checkSession, 30000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) checkSession();
});
window.addEventListener("focus", checkSession);

// ===================== SHOP / UNLOCKABLES =====================
const SHOP_ITEMS = {
  pacman: [
    { id: "classic", name: "Classic", cost: 0, color: "#ffd966" },
    { id: "fire", name: "Fire", cost: 80, color: "#ff6b35" },
    { id: "ice", name: "Ice Blue", cost: 80, color: "#4ecdc4" },
    { id: "grape", name: "Grape", cost: 120, color: "#a374ff" },
    { id: "neon", name: "Neon Green", cost: 120, color: "#39ff8f" },
    { id: "pink", name: "Bubblegum", cost: 150, color: "#ff6bc1" },
    { id: "gold", name: "Gold", cost: 220, color: "#ffd700" },
  ],
  maze: [
    { id: "classic", name: "Classic Blue", cost: 0, wall: "#1c4d85", stroke: "#5fe3ff", bg: "#0d2c52" },
    { id: "sunset", name: "Sunset", cost: 100, wall: "#7a2e5c", stroke: "#ff9e6d", bg: "#3b1030" },
    { id: "forest", name: "Forest", cost: 100, wall: "#1f5c3d", stroke: "#8dffb0", bg: "#0d2818" },
    { id: "candy", name: "Candy", cost: 150, wall: "#a3316b", stroke: "#ffb8de", bg: "#3a0d24" },
    { id: "mono", name: "Monochrome", cost: 150, wall: "#3a3a3a", stroke: "#e0e0e0", bg: "#101010" },
    { id: "lava", name: "Lava", cost: 220, wall: "#5c1a0e", stroke: "#ff7043", bg: "#20080a" },
  ],
  ghosts: [
    { id: "classic", name: "Classic", cost: 0, colors: ["#ff4b4b", "#4bc6ff", "#ff9de2", "#ffb84b", "#9d6bff", "#4bff8f"] },
    { id: "pastel", name: "Pastel", cost: 100, colors: ["#ffb3ba", "#bae1ff", "#ffdfba", "#baffc9", "#e0bbff", "#fff5ba"] },
    { id: "shadows", name: "Shadows", cost: 150, colors: ["#4a4a4a", "#6b6b6b", "#8c8c8c", "#adadad", "#5c5c5c", "#7d7d7d"] },
    { id: "neon", name: "Neon", cost: 180, colors: ["#ff00ff", "#00ffff", "#ffff00", "#ff0080", "#00ff80", "#8000ff"] },
  ],
  effects: [
    { id: "none", name: "None", cost: 0, icon: "🚫" },
    { id: "trail", name: "Motion Trail", cost: 100, icon: "💫" },
    { id: "glow", name: "Glow Aura", cost: 100, icon: "✨" },
    { id: "sparkle", name: "Sparkle Bites", cost: 150, icon: "🌟" },
  ],
};

let currentPacmanColor = SHOP_ITEMS.pacman[0].color;
let currentMazeTheme = SHOP_ITEMS.maze[0];
let currentGhostColors = SHOP_ITEMS.ghosts[0].colors;
let currentEffect = SHOP_ITEMS.effects[0].id;

function getEquippedMap() {
  try {
    return JSON.parse(store.get("pacman_equipped")) || {};
  } catch (e) {
    return {};
  }
}
function setEquippedId(cat, id) {
  const eq = getEquippedMap();
  eq[cat] = id;
  store.set("pacman_equipped", JSON.stringify(eq));
}
function getEquippedId(cat) {
  const eq = getEquippedMap();
  return eq[cat] || SHOP_ITEMS[cat][0].id;
}
function getUnlockedItemsMap() {
  try {
    return JSON.parse(store.get("pacman_unlocked_items")) || {};
  } catch (e) {
    return {};
  }
}
function isItemUnlocked(cat, id) {
  const u = getUnlockedItemsMap();
  return (u[cat] || []).includes(id);
}
function unlockItem(cat, id) {
  const u = getUnlockedItemsMap();
  if (!u[cat]) u[cat] = [];
  if (!u[cat].includes(id)) u[cat].push(id);
  store.set("pacman_unlocked_items", JSON.stringify(u));
}

function applyEquippedCosmetics() {
  const pacItem = SHOP_ITEMS.pacman.find((x) => x.id === getEquippedId("pacman")) || SHOP_ITEMS.pacman[0];
  currentPacmanColor = pacItem.color;
  const mazeItem = SHOP_ITEMS.maze.find((x) => x.id === getEquippedId("maze")) || SHOP_ITEMS.maze[0];
  currentMazeTheme = mazeItem;
  const ghostItem = SHOP_ITEMS.ghosts.find((x) => x.id === getEquippedId("ghosts")) || SHOP_ITEMS.ghosts[0];
  currentGhostColors = ghostItem.colors;
  currentEffect = getEquippedId("effects");
}

let activeShopTab = "pacman";
function swatchStyleFor(cat, item) {
  if (cat === "pacman") return "background:" + item.color + ";";
  if (cat === "maze") return "background:linear-gradient(135deg," + item.wall + "," + item.bg + ");border:2px solid " + item.stroke + ";";
  if (cat === "ghosts") return "background:linear-gradient(90deg," + item.colors.join(",") + ");";
  return "background:#e9ecef;";
}
function renderShop(cat) {
  activeShopTab = cat;
  [...shopTabsEl.querySelectorAll(".shop-tab")].forEach((t) => t.classList.toggle("active", t.dataset.cat === cat));
  shopGrid.innerHTML = "";
  const equippedId = getEquippedId(cat);
  SHOP_ITEMS[cat].forEach((item) => {
    const unlocked = item.cost === 0 || isItemUnlocked(cat, item.id);
    const cell = document.createElement("div");
    cell.className = "shop-item" + (equippedId === item.id ? " equipped-item" : "");

    const swatch = document.createElement("div");
    swatch.className = "shop-item-swatch";
    swatch.setAttribute("style", swatchStyleFor(cat, item));
    if (cat === "effects") swatch.textContent = item.icon;

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
        applyEquippedCosmetics();
        renderShop(cat);
      });
    } else {
      /* "Buy 🪙120" ran together and wrapped mid-label on a phone — the
         button came out as "Buy 🪙" over "120", which is why the wording
         read as out of order. Separated the way Tetris writes the same
         label, and kept on one line by the nowrap rule in the stylesheet. */
      btn.textContent = "Buy · " + item.cost + " 🪙";
      btn.classList.add("buy");
      btn.disabled = getCoins() < item.cost;
      btn.addEventListener("click", () => {
        if (spendCoins(item.cost)) {
          unlockItem(cat, item.id);
          setEquippedId(cat, item.id);
          applyEquippedCosmetics();
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
if (shopTabsEl) {
  [...shopTabsEl.querySelectorAll(".shop-tab")].forEach((tab) => {
    tab.addEventListener("click", () => renderShop(tab.dataset.cat));
  });
}
if (shopBtn) {
  shopBtn.addEventListener("click", () => {
    updateCoinDisplays();
    renderShop(activeShopTab);
    showScreen("shop");
  });
}

// 0: empty, 1: wall, 2: pellet, 3: power pellet
// Simple Pac-Man inspired layout (not 100% original map)
const baseLayout = [
  "1111111111111221111111111111",
  "1222222222112222222222222221",
  "1211212112112112112111112121",
  "1311212112112112112111112131",
  "1222222222222222222222222221",
  "1211212111112111112111112121",
  "1222222112222222221222222221",
  "1111112112111112112111111111",
  "2222222112112222112222222222",
  "1111112112111112112111111111",
  "1222222222222112222222222221",
  "1211112111112111112111112121",
  "1222212222222222222222122221",
  "1111212111110001111122111211",
  "2222212110000000000122112222",
  "1111212112111111121122111111",
  "1222222222222222222222222221",
  "1211212112111112112111112121",
  "1222222112222222221222222221",
  "1111112112111112112111111111",
  "2222222112112222112222222222",
  "1111112112111112112111111111",
  "1222222222222222222222222221",
  "1211112111112111122111112121",
  "1311112222222112222222112131",
  "1222222111112111111122222221",
  "1111112112222222212111111111",
  "1222222222112222112222222221",
  "1211211112112112111111112121",
  "1222222222222222222222222221",
  "1111111111111221111111111111",
];

// Two more maze layouts for levels 11+, each with several extra walls
// carved into the open corridors (so the maze genuinely looks different
// and has fewer wide-open "safe" stretches), not just the same map
// mirrored. The ghost house (rows 13-15) and both tunnels (rows 8, 20)
// are left untouched in every layout so ghost pathing keeps working, and
// every single pellet in every layout (and its mirror) was verified
// reachable via a full BFS before being added here.
const layoutMedium = [
  "1111111111111221111111111111",
  "1222222222112221122222222121",
  "1211212112112112112111112121",
  "1312112111112112112111111131",
  "1222122222212222222222222221",
  "1211212111112111112111112121",
  "1222222112222222212222222121",
  "1111112112111112112111111111",
  "2222222112112222112222222222",
  "1111112112111112112111111111",
  "1222222222222112112222222221",
  "1111112111112111112111112121",
  "1222212222222222222222122221",
  "1111212111110001111122111211",
  "2222212110000000000122112222",
  "1111212112111111121122111111",
  "1222222222222222222222222221",
  "1211212112111112112111112121",
  "1222112112221222211222222121",
  "1111112112111112112111111111",
  "2222222112112222112222222222",
  "1111112112111112112111111111",
  "1221222222222212222222222221",
  "1211212111111111112111112121",
  "1311112122222112222222112131",
  "1222222111112111111122212221",
  "1111112111222222212111111111",
  "1222212222112222112222222221",
  "1211211112112112111111112121",
  "1222222222222222222222222111",
  "1111111111111221111111111111",
];

const layoutComplex = [
  "1111111111111221111111111111",
  "1222212222112222222112222221",
  "1211212112111112111111111121",
  "1311212111112112111111111131",
  "1222222222222222222222222221",
  "1211212111112111111111112121",
  "1222221112222222211122222121",
  "1111112112111112112111111111",
  "2222222112112222112222222222",
  "1111112112111112112111111111",
  "1221112222212112112222222211",
  "1211112111112111112111112121",
  "1222212222222222222222122221",
  "1111212111110001111122111211",
  "2222212110000000000122112222",
  "1111212112111111121122111111",
  "1222222222222222222222222221",
  "1112112111111112112111112121",
  "1222222111122222212222222121",
  "1111112112111112112111111111",
  "2222222112112222112222222222",
  "1111112112111112112111111111",
  "1222222212222222222222222221",
  "1211212111111111112111112111",
  "1311112222122112222222112131",
  "1221122111112111111121122221",
  "1111112111122222212111111111",
  "1221122222112122112222222221",
  "1211211112112112111111112121",
  "1222222222222222222222222121",
  "1111111111111221111111111111",
];

function mirrorLayout(layout) {
  return layout.map((row) => row.split("").reverse().join(""));
}

const mirroredLayout = mirrorLayout(baseLayout);
const mirroredMedium = mirrorLayout(layoutMedium);
const mirroredComplex = mirrorLayout(layoutComplex);

// Which maze shape is in play depends on the difficulty tier (see
// getGhostCountForLevel etc. above): levels 1-10 use the original simple
// layout, 11-20 step up to the medium one, 21-30 use the busiest one.
// Within any given level, it's still mirrored on even levels for the
// per-level variety that already existed.
function getBaseLayoutForLevel(level) {
  if (level <= 10) return baseLayout;
  if (level <= 20) return layoutMedium;
  return layoutComplex;
}
function getMirroredLayoutForLevel(level) {
  if (level <= 10) return mirroredLayout;
  if (level <= 20) return mirroredMedium;
  return mirroredComplex;
}
function getLayoutForLevel(level) {
  return level % 2 === 0 ? getMirroredLayoutForLevel(level) : getBaseLayoutForLevel(level);
}

// Ghost color count (used as more ghosts get added on higher levels) —
// colors themselves come from the equipped Ghost Theme (currentGhostColors).
//
// ===================== DIFFICULTY TIERS =====================
//  1-5   Simple mazes, slow ghosts, fewer hazards
//  6-10  Increased ghost speed and more complex layouts
//  11-15 More ghosts and fewer safe areas
//  16-20 Faster ghosts and more challenging mazes
//  21-25 Complex maze layouts and aggressive ghosts
//  26-30 Expert-level speed and difficult maze designs
function getGhostCountForLevel(level) {
  if (level <= 5) return 2;
  if (level <= 10) return 3;
  if (level <= 15) return 4;
  if (level <= 20) return 5;
  return Math.min(6, currentGhostColors.length); // 21-30
}

function getGhostSpeedForLevel(level) {
  // A speed FLOOR per tier (so crossing a tier boundary is a clear step
  // up, matching "Increased ghost speed" / "Faster ghosts" / "Expert-level
  // speed" at the right levels) plus a small climb within the tier so
  // levels inside it don't all feel identical.
  const tierFloors = [2.2, 2.6, 3.0, 3.5, 4.0, 4.6];
  const tierIndex = Math.min(Math.floor((level - 1) / 5), 5);
  const withinTier = (level - 1) % 5;
  return tierFloors[tierIndex] + withinTier * 0.06;
}

// "Fewer safe areas" (11-15) and "aggressive ghosts" (21-25) are expressed
// as shorter power-pellet safe windows — the pellet still works every
// level, it just buys less breathing room at higher tiers.
function getFrightenSecondsForLevel(level) {
  if (level <= 5) return 10;
  if (level <= 10) return 9;
  if (level <= 15) return 7;
  if (level <= 20) return 6;
  if (level <= 25) return 5;
  return 4; // 26-30
}

// Ghosts also leave the house faster at higher tiers — one more way
// "fewer safe areas" / "aggressive ghosts" actually plays out, not just a
// number in a tooltip.
function getGhostReleaseStaggerForLevel(level) {
  if (level <= 10) return 2200;
  if (level <= 20) return 1600;
  return 1100; // 21-30
}

// Each ghost gets its own small speed variation so they don't all move
// identically — some are a little quicker, some a little slower.
const ghostSpeedMultipliers = [0.85, 1.05, 0.95, 1.1, 0.9, 1.0];

function getPacmanSpeedForLevel(level) {
  // Ghosts are left as-is — this only tunes Pac-Man's own feel: noticeably
  // quicker than the ghosts (so he doesn't feel sluggish to control) while
  // still close enough that a ghost cutting a corner can catch him. Climbs
  // across all 30 levels now (not just the first 20), so he keeps pace
  // with ghosts through the Expert tier too.
  return 4.2 + Math.min(level - 1, 29) * 0.045;
}

// ===================== DIRECTION-INVARIANT VISUAL SPEED =====================
// The grid speed above is the same in all four directions, but the SCREEN
// speed is not: a tilted orthographic camera foreshortens world-Z into
// screen-Y at sin(tilt), and the canvas itself is sometimes stretched
// non-uniformly (boardStretchY > 1) to fill a portrait box. Together those
// two effects make movement along the maze's Y axis (up/down on screen,
// which is world-Z) look faster or slower than movement along the X axis
// (left/right on screen), depending on the canvas aspect.
//
// On a portrait phone, for example, the canvas is taller than the maze's
// natural shape, so each grid-Y step covers MORE pixels vertically than a
// grid-X step covers horizontally — ghosts and Pac-Man look like they rush
// up the screen but crawl across it. That is the asymmetry the player sees
// as "upar tez, left/right slow".
//
// The fix is to scale the grid-Y step by the ratio of pixels-per-world-X
// to pixels-per-world-Z so the on-screen speed comes out equal in every
// direction. The grid-X step is left untouched (it is the baseline), and
// the same factor is applied to Pac-Man AND every ghost so the relative
// speed between them — the thing that actually drives difficulty — is
// preserved. Only the absolute screen speed of the Y axis is brought
// into line with the X axis.
function getAxisSpeedScale() {
  if (!camera || !renderer) return 1;
  const tilt = (cameraTiltDeg * Math.PI) / 180;
  const sinT = Math.sin(tilt);
  const cosT = Math.cos(tilt);
  if (sinT <= 0.001) return 1;
  const frustumW = cols * CELL; // 28 — width of the maze on screen
  const frustumH = rows * CELL * sinT + WALL_HEIGHT * cosT; // maze depth on screen
  if (frustumW <= 0 || frustumH <= 0) return 1;
  const cw = lastCanvasW || (canvas && canvas.clientWidth) || 0;
  const ch = lastCanvasH || (canvas && canvas.clientHeight) || 0;
  if (cw <= 0 || ch <= 0) return 1;
  // Pixels of canvas per one world-X unit (horizontal screen direction)
  const pxPerX = cw / frustumW;
  // Pixels of canvas per one world-Z unit (vertical screen direction).
  // The Z axis is foreshortened by sin(tilt) before it lands on screen-Y,
  // and then frustumH / ch maps world-screen units to canvas pixels.
  const pxPerZ = (ch * sinT) / frustumH;
  if (pxPerZ <= 0) return 1;
  // Scale grid-Y so its on-screen speed matches grid-X.
  const scale = pxPerX / pxPerZ;
  // Clamp so gameplay never changes by more than a reasonable amount either
  // way: a portrait phone with a 0.66 aspect and 60° tilt wants ~0.74,
  // a square canvas wants ~1.11, a wide landscape wants ~1.6+. The clamp
  // keeps the extreme landscape case from making vertical traversal too
  // fast to control.
  return Math.max(0.55, Math.min(1.8, scale));
}

// Extra power pellets ("bara dot") that appear on top of the 4 baked into
// the maze corners. One more of these unlocks every few levels (see
// getExtraPowerPelletsForLevel), so higher levels feel meaningfully
// bigger, not just faster. Coordinates are [row, col] pairs on real pellet
// tiles, verified safe in both the normal and mirrored layouts.
const EXTRA_POWER_PELLET_COORDS = [
  [10, 1], [10, 26], [17, 1], [17, 26], [6, 1], [6, 26], [28, 1], [28, 26],
];

function getExtraPowerPelletsForLevel(level) {
  // One more power pellet unlocks every 3 levels (instead of jumping 2 at a
  // time every 5 levels), so the maze visibly gets more power pellets on a
  // steadier, more frequent schedule as you climb.
  const tier = Math.min(Math.floor((level - 1) / 3), EXTRA_POWER_PELLET_COORDS.length);
  return EXTRA_POWER_PELLET_COORDS.slice(0, tier);
}

let map = [];
let pelletsRemaining = 0;
let currentLayout = baseLayout;

const pacman = {
  x: 1, // start bottom-left
  y: 29,
  dirX: 0,
  dirY: 0,
  nextDirX: 0,
  nextDirY: 0,
  speed: 8, // tiles per second (set per level by getPacmanSpeedForLevel)
};

let ghosts = [];

const ghostStartPositions = [
  { x: 13, y: 14, dirX: 1, dirY: 0 },
  { x: 14, y: 14, dirX: -1, dirY: 0 },
  { x: 12, y: 14, dirX: 1, dirY: 0 },
  { x: 15, y: 14, dirX: -1, dirY: 0 },
  { x: 13, y: 13, dirX: 1, dirY: 0 },
  { x: 14, y: 13, dirX: -1, dirY: 0 },
];

// Ghosts leave the house one at a time instead of all rushing out
// together — each one waits this many milliseconds longer than the last
// before it's allowed to start heading for the gate. Shrinks at higher
// tiers via getGhostReleaseStaggerForLevel() — see buildGhosts().

function buildGhosts(level) {
  const count = getGhostCountForLevel(level);
  const stagger = getGhostReleaseStaggerForLevel(level);
  const mirrored = level % 2 === 0;
  const list = [];
  const releaseBase = simNow;
  for (let i = 0; i < count; i++) {
    const start = ghostStartPositions[i];
    const x = mirrored ? cols - 1 - start.x : start.x;
    const dirX = mirrored ? -start.dirX : start.dirX;
    list.push({
      x,
      y: start.y,
      dirX,
      dirY: start.dirY,
      color: currentGhostColors[i],
      frightened: false,
      eaten: false,
      houseHoldUntil: null,
      inHouse: true, // must leave through the gate — see moveGhostOutOfHouse
      releaseAt: releaseBase + i * stagger,
      speedMult: ghostSpeedMultipliers[i % ghostSpeedMultipliers.length],
      lastX: x,
      lastY: start.y,
      stuckFrames: 0,
    });
  }
  return list;
}

// Center of the ghost pen — eaten ghosts (eyes) race back here, then rejoin the chase.
const GHOST_HOUSE = { x: 13.5, y: 14 };

// Failsafe: eaten-ghost eyes should reach the house within a second or two
// on any level. The BFS pathing + watchdog above handle the overwhelming
// majority of cases, but a rare edge case (two directions tying on
// houseDistanceGrid right as a stall watchdog fires, a direction re-pick
// landing back on the same blocked tile, etc.) can still leave a pair of
// eyes stalled mid-maze indefinitely instead of recovering. Rather than
// chase every last such case, this is a hard ceiling: if an eaten ghost
// hasn't made it home in this long, it's teleported straight there and
// revived — the player sees the eyes vanish and the ghost pop back into
// the pen a beat early, which is far better than a permanently frozen
// ghost stuck in the corridor for the rest of the level.
const EATEN_FORCE_HOME_MS = 4000;

// Base (smallest) visual pen — used at the lowest ghost-count tier (level 1).
// Purely cosmetic — the walkable tiles underneath are unchanged (still
// open/"0" tiles in the maze data) — but the box itself now grows a size
// tier every time a new ghost count tier unlocks, so it never looks too
// cramped for however many ghosts are living in it.
const GHOST_HOUSE_BOX_BASE = {
  left: 12,
  right: 15,
  top: 13,
  bottom: 15,
  gateLeft: 12,
  gateRight: 15,
};

function getGhostHouseBoxForLevel(level) {
  /* One size, every level. This used to grow a tier each time the ghost
     count went up — left edge sliding out to 8, right to 19, bottom to 16 —
     on the reasoning that six ghosts would look cramped in the box two
     ghosts live in. Checked against ghostStartPositions above: all six
     spawn inside x 12-15, y 13-14, which the BASE box (12-15, 13-15)
     already contains with a row to spare. Nothing was ever cramped; the pen
     just changed shape under the player as they progressed, in a maze whose
     one fixed landmark it is supposed to be.
     The `level` argument is kept so callers do not change, and so this
     stays the place to look if the pen ever does need to vary. */
  return {
    left: GHOST_HOUSE_BOX_BASE.left,
    right: GHOST_HOUSE_BOX_BASE.right,
    top: GHOST_HOUSE_BOX_BASE.top,
    bottom: GHOST_HOUSE_BOX_BASE.bottom,
    gateLeft: GHOST_HOUSE_BOX_BASE.gateLeft,
    gateRight: GHOST_HOUSE_BOX_BASE.gateRight,
  };
}

// The pen's RAILS are drawn a cell wider on each side than this box (see
// buildGhostHousePen3D) so the pen reads as a wide rectangle rather than a
// near-square. Pac-Man's/ghosts' movement gating (inGhostHouseBox, used at
// the trySetDirection/ghost-move call sites) stays tied to the narrower box
// above and is untouched by this — this constant is only for deciding which
// wall cells to skip drawing, so a wall block that sits between the old
// (narrow) box edge and the new (wide) rail line doesn't get left standing
// inside the rail outline, where it reads as a stray cube in the pen.
const GHOST_HOUSE_VISUAL_PAD_X = 1;
function inGhostHouseVisualBox(col, row) {
  const box = getGhostHouseBoxForLevel(currentLevel);
  return (
    col >= box.left - GHOST_HOUSE_VISUAL_PAD_X &&
    col <= box.right + GHOST_HOUSE_VISUAL_PAD_X &&
    row >= box.top &&
    row <= box.bottom
  );
}

let score = 0;
/* FIX (running score): the score the current level began with. Moving on
   to the next level from the Congratulations popup carries the total over;
   Retry / Restart put the score back to this value; any other entry
   (Play, Level Select, Prev/Next) starts a fresh run at 0. */
let levelStartScore = 0;
let lives = 3;
let gameOver = false;
let levelWon = false;
let lastTime = 0;
// Simulation runs on a fixed timestep, decoupled from the render frame
// rate — see loop()/stepSimulation() below for why.
const FIXED_DT = 1 / 60;
const MAX_SUBSTEPS = 8;
let updateAccumulator = 0;
/* Game clock in ms. Advances ONLY inside stepSimulation(), so it stands
   still while the game is paused, while an ad or the unlock dialog is over
   the board, and while the tab is in the background. Every gameplay timer
   (power-pellet fright, staggered ghost release, the eaten-eyes pause and
   failsafe) runs on this. They used to run on performance.now() / setTimeout,
   i.e. wall-clock time — so pausing during a power pellet simply burned it,
   and pausing at level start let every ghost out at once on resume. */
let simNow = 0;
let gameTime = 0; // for mouth animation

// --- Power pellet: ghosts turn scared (frightened) for a while, and can be eaten ---
const GHOST_EAT_SCORES = [200, 400, 800, 1600];
let frightenedActive = false;
let frightenedEndsAt = 0; // simNow time the fright ends — see updateFrighten()
let ghostsEatenChain = 0; // resets every time a fresh power pellet is eaten

// Floating "+200" / "+400" / etc. text that pops up right where a ghost was
// eaten, so the chain-scoring bonus is actually visible in the moment
// instead of only showing up as a jump in the corner score total.
let scorePopups = [];

// --- Special effects state (see SHOP_ITEMS.effects) ---
let pacmanTrail = []; // "trail" effect: recent Pac-Man positions, fading out
let sparkleParticles = []; // "sparkle" effect: little bursts when a pellet is eaten

// --- Sound (Web Audio API, no external files) ---
let audioCtx = null;

const MUTE_STORAGE_KEY = "pacman_soundMuted";
let soundMuted = store.get(MUTE_STORAGE_KEY) === "1";

// Master volume multiplier applied to every effect's peak gain, so all
// sounds (pellets, ghosts, win/lose jingles, background pad) are louder.
const MASTER_VOLUME = 1.8;
function vol(peak) {
  return Math.min(peak * MASTER_VOLUME, 1);
}

function getAudioContext() {
  if (soundMuted) return null;
  if (audioCtx) return audioCtx;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  audioCtx = new Ctx();
  return audioCtx;
}

// Actually implements the Sound button: mutes/unmutes and updates its label.
// Muting stops anything currently playing (background pad, ghost siren)
// immediately instead of just blocking future sounds.
function setMuted(muted) {
  soundMuted = muted;
  store.set(MUTE_STORAGE_KEY, muted ? "1" : "0");

  if (muted) stopGhostSiren();

  muteBtns.forEach((btn) => {
    // Icon only in the top bar; the word took space the bar needs for the
    // other controls. The label lives in title/aria-label instead.
    btn.textContent = muted ? "\u{1F507}" : "\u{1F50A}";
    btn.classList.toggle("is-muted", muted);
    btn.setAttribute("aria-pressed", String(muted));
  });
}

if (muteBtns.length) {
  muteBtns.forEach((btn) => {
    btn.addEventListener("click", () => setMuted(!soundMuted));
  });
}

/* ---------- Pause ----------
   Freezes the simulation without leaving the board: the loop keeps drawing
   but stops stepping, and the sound stops so a paused game isn't still
   humming away in the background. */
let gamePaused = false;
const pauseBtn = document.getElementById("pauseBtn");

function setPaused(next, silent) {
  // Nothing live to pause: a won / lost board, or an ad / dialog in front of
  // it. Pausing under the Game Over popup used to leave the game paused
  // after Watch Ad & Continue, frozen behind a "Resume" nobody had asked for.
  if (next && !gamePaused && (gameOver || adIsPlaying)) return;
  gamePaused = next;
  if (pauseBtn) {
    /* Icon and word live in separate spans so a narrow bar can hide the word
       and keep the icon (see the FINAL GAME BAR block in style.css). */
    pauseBtn.innerHTML = gamePaused
      ? '<span class="ico">\u25B6</span><span class="lbl">Resume</span>'
      : '<span class="ico">\u23F8</span><span class="lbl">Pause</span>';
    pauseBtn.setAttribute("aria-pressed", String(gamePaused));
    pauseBtn.classList.toggle("is-paused", gamePaused);
  }
  // The siren restarts on its own from stepSimulation() once ghosts move.
  if (!silent && gamePaused) stopGhostSiren();
}

if (pauseBtn) pauseBtn.addEventListener("click", () => setPaused(!gamePaused));
// Escape / P toggle it too (see the keydown handler further down); leaving
// the game screen always clears it (showScreen()).

/* ---------- The ghosts' own sound: an arcade-style siren ----------
   Sixth version, and this one goes back to where the reference actually is.
   The brief was "like the ghost sound on the freepacman site" — the classic
   cabinet siren, the warbling tone that runs continuously while the ghosts
   are chasing.

   NOTE ON WHERE THIS COMES FROM: nothing is sampled, downloaded or copied
   from that site or any other. Everything below is generated by this file at
   run time from an oscillator and a filter. What is borrowed is the
   TECHNIQUE, which is public and general: old sound chips could not glide a
   pitch, they could only rewrite a frequency register, so an arcade siren is
   a square wave being STEPPED through a short repeating ladder of pitches
   many times a second. That stepping is what makes a sound read as "arcade"
   rather than as a synthesiser sweep, and it is what the five versions
   before this one were all missing.

   How this differs from version 1, which was also continuous and was
   rejected: that was a DRONE — two oscillators holding a fixed interval,
   nothing moving. This is never still. It climbs and falls through
   SIREN_RATIOS eight times a second, and how fast, how high and how loud all
   track the nearest ghost, so it reads as a chase rather than as a hum. It
   also starts and stops exactly where the previous versions did: only while
   a ghost is actually walking, and never on a menu, a pause or an ad.

   Structure: ONE long-lived oscillator, so there are no clicks between
   notes, with a look-ahead scheduler writing the next few notes into the
   audio clock ahead of time. Scheduling from a timer alone (a note per
   setTimeout) drifts audibly — setTimeout is not a clock and a busy frame
   pushes it late, which on a repeating pattern is heard immediately as a
   stumble. Writing ahead of the audio clock keeps it steady no matter what
   the renderer is doing. */

/* One cycle of the warble: up the ladder and back down. Ratios rather than
   fixed frequencies so the whole shape simply transposes when distance moves
   the base pitch. Roughly a major third of total travel — wide enough to
   warble, narrow enough not to sound like a tune. */
/* ===== The warble shape, as a table rather than one hard-coded ladder =====
   Seven versions of this sound were tried before landing here — a drone, a
   detuned pair, square blips, triangle footsteps, filtered noise, and two
   stepped sirens — kept as a table of named variants (rather than one
   hard-coded ladder) so a different one can be swapped in later by changing
   only GHOST_SIREN_VARIANT below, with no other code to touch.

   The current default, "climb", is a real structural change rather than a
   retune. The version before it ran the pitch UP and back DOWN — a
   symmetrical warble, which is a wobble, not a siren. An arcade siren ramps
   up and SNAPS BACK: a sawtooth contour, repeating three or four times a
   second. That reset is the whole character, and it was what was missing.

   Nothing here is sampled or copied from anywhere; it is all generated at
   run time from an oscillator and a filter. What is borrowed is the
   technique, which is public and general — old sound chips could not glide
   a pitch, only rewrite a frequency register, so an arcade siren is a
   square wave STEPPED through a short ladder of pitches many times a
   second. */
const SIREN_VARIANTS = {
  /* Rapid stepped glissando up, then straight back to the bottom. Twelve
     steps over a quarter second reads as a sweep with a chip texture
     rather than as twelve separate notes. */
  climb: { steps: 12, top: 1.5, shape: "up", cycle: 0.26, wave: "square", fifth: false },
  /* Same contour, thickened with a second voice a clean fifth above,
     locked to the same steps. (Not the version-2 failure, which was two
     voices DETUNED and sweeping at different rates against each other;
     that drifts out of tune with itself, this cannot.) */
  climbFifth: { steps: 12, top: 1.5, shape: "up", cycle: 0.26, wave: "square", fifth: true },
  /* Falling instead of rising. Darker; more alarm than chase. */
  dive: { steps: 12, top: 1.5, shape: "down", cycle: 0.26, wave: "square", fifth: false },
  /* Tighter and higher: a fast narrow wobble rather than a wide sweep.
     The least intrusive of the five. */
  flutter: { steps: 6, top: 1.18, shape: "up", cycle: 0.14, wave: "square", fifth: false },
  /* The previous default, kept so it can be compared directly rather than
     from memory: symmetrical up-and-down, slower, softer edge. */
  rocker: { steps: 8, top: 1.42, shape: "updown", cycle: 0.44, wave: "sawtooth", fifth: false }
};
const GHOST_SIREN_VARIANT = "climb";

/* Ratios, not fixed frequencies, so the whole shape simply transposes when
   distance moves the base pitch. Built once per variant and cached. */
const sirenLadderCache = {};
function sirenLadder(v) {
  const key = v.shape + v.steps + v.top;
  if (sirenLadderCache[key]) return sirenLadderCache[key];
  const out = [];
  const n = Math.max(2, v.steps);
  if (v.shape === "updown") {
    const half = Math.max(2, Math.round(n / 2));
    for (let i = 0; i < half; i++) out.push(1 + (v.top - 1) * (i / (half - 1)));
    for (let j = half - 2; j > 0; j--) out.push(out[j]);
  } else {
    for (let k = 0; k < n; k++) out.push(1 + (v.top - 1) * (k / (n - 1)));
    if (v.shape === "down") out.reverse();
  }
  sirenLadderCache[key] = out;
  return out;
}
/* Calibrated by rendering it offline against the chomp, not guessed by ear.
   A siren is CONTINUOUS, so duty cycle — not peak — is what decides whether
   it sits under the chomp or buries it, and that is exactly the trap the
   earlier blip-based versions did not have to worry about.
   Measured over a full second: the chomp runs at an RMS of 0.045 WHILE IT IS
   SOUNDING, but it only sounds for 0.08s at a time. At a level of 0.03 this
   siren renders at 0.046 — as loud as the chomp, but never stopping, which
   would make it the loudest thing in the game by a distance.
   0.009 far / 0.017 close puts it at 0.014-0.026: a third to a half of the
   chomp, present the whole time without ever competing with it. */
const SIREN_LEVEL_BASE = 0.009;
const SIREN_LEVEL_NEAR = 0.008;

let ghostStepTimer = null;
let ghostStepActive = false;
let sirenOsc = null;
let sirenGain = null;
let sirenFilt = null;
let sirenAt = 0;      // audio-clock time the next note is due
let sirenPhase = 0;   // how far through the current variant's ladder we are
let sirenOsc2 = null; // second voice, only for variants with fifth: true

function nearestGhostDistance() {
  let best = Infinity;
  ghosts.forEach((g) => {
    if (g.eaten) return;
    const d = Math.hypot(g.x - pacman.x, g.y - pacman.y);
    if (d < best) best = d;
  });
  return best;
}

/* Writes the next few notes into the audio clock. Called on a timer, but the
   timer only decides WHEN MORE WORK IS DONE — never when a note sounds. */
function pumpSiren() {
  const ctx = getAudioContext();
  if (!ctx || !ghostStepActive || !sirenOsc) return;

  const dist = nearestGhostDistance();
  const near = isFinite(dist) ? Math.max(0, Math.min(1, 1 - dist / 16)) : 0;
  const scared = ghosts.some((g) => g.frightened && !g.eaten);

  /* Hunting: low and menacing. Frightened: up an octave and noticeably
     quicker, which is how the arcade signalled the state flip too. */
  const v = SIREN_VARIANTS[GHOST_SIREN_VARIANT] || SIREN_VARIANTS.climb;
  const ladder = sirenLadder(v);

  const base = (scared ? 420 : 205) + (scared ? 130 : 95) * near;
  /* The variant sets how long one CYCLE takes; the step length falls out of
     how many steps that cycle has. Tying the two together is what lets a
     twelve-step ladder and a six-step one both repeat at a sensible rate
     instead of one of them crawling. Frightened is quicker, and a ghost
     closing in quicker still. */
  const cycle = (scared ? v.cycle * 0.62 : v.cycle) * (1 - 0.22 * near);
  const stepDur = Math.max(0.012, cycle / ladder.length);
  const level = vol(SIREN_LEVEL_BASE + SIREN_LEVEL_NEAR * near);

  /* setTargetAtTime, not setValueAtTime: distance changes every frame, and
     stepping the gain or the filter straight to a new value that often is
     heard as a zipper. This glides to each new target over ~80ms. */
  sirenGain.gain.setTargetAtTime(level, ctx.currentTime, 0.08);
  /* The filter tracks the note so the tone stays consistent as the siren
     transposes, and takes the hardest edge off the square so it sits under
     Pac-Man's chomp instead of on top of it. */
  sirenFilt.frequency.setTargetAtTime(base * 4.5, ctx.currentTime, 0.08);

  if (sirenAt < ctx.currentTime) sirenAt = ctx.currentTime;
  const horizon = ctx.currentTime + 0.4;
  let guard = 0;
  while (sirenAt < horizon && guard++ < 64) {
    // setValueAtTime, never a ramp — the step IS the sound.
    const f = base * ladder[sirenPhase % ladder.length];
    sirenOsc.frequency.setValueAtTime(f, sirenAt);
    // Locked to the same step, so the two voices can never drift apart.
    if (sirenOsc2) sirenOsc2.frequency.setValueAtTime(f * 1.5, sirenAt);
    sirenPhase++;
    sirenAt += stepDur;
  }
}

function startGhostSiren() {
  if (ghostStepActive) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    ctx.resume();

    const v = SIREN_VARIANTS[GHOST_SIREN_VARIANT] || SIREN_VARIANTS.climb;

    sirenOsc = ctx.createOscillator();
    sirenOsc.type = v.wave;
    sirenOsc.frequency.setValueAtTime(205, ctx.currentTime);

    sirenFilt = ctx.createBiquadFilter();
    sirenFilt.type = "lowpass";
    sirenFilt.frequency.setValueAtTime(900, ctx.currentTime);
    sirenFilt.Q.value = 0.7;

    sirenGain = ctx.createGain();
    // From silence, so the siren fades in instead of arriving with a thud.
    sirenGain.gain.setValueAtTime(0.0001, ctx.currentTime);

    sirenOsc.connect(sirenFilt);
    sirenFilt.connect(sirenGain);
    sirenGain.connect(ctx.destination);
    sirenOsc.start();

    if (v.fifth) {
      /* Quieter than the main voice on purpose: a fifth on top is meant to
         thicken the tone, not to be heard as a second note. */
      sirenOsc2 = ctx.createOscillator();
      sirenOsc2.type = v.wave;
      sirenOsc2.frequency.setValueAtTime(307, ctx.currentTime);
      const g2 = ctx.createGain();
      g2.gain.setValueAtTime(0.45, ctx.currentTime);
      sirenOsc2.connect(g2);
      g2.connect(sirenFilt);
      sirenOsc2.start();
    }

    ghostStepActive = true;
    sirenAt = ctx.currentTime;
    sirenPhase = 0;
    pumpSiren();
    ghostStepTimer = setInterval(pumpSiren, 120);
  } catch (_) {
    ghostStepActive = false;
  }
}

function stopGhostSiren() {
  if (ghostStepTimer) clearInterval(ghostStepTimer);
  ghostStepTimer = null;
  ghostStepActive = false;
  const osc = sirenOsc;
  const osc2 = sirenOsc2;
  const gain = sirenGain;
  sirenOsc = null;
  sirenOsc2 = null;
  sirenGain = null;
  sirenFilt = null;
  if (osc2) { try { osc2.stop(audioCtx ? audioCtx.currentTime + 0.12 : 0); } catch (_) {} }
  if (!osc) return;
  try {
    const ctx = audioCtx;
    const now = ctx ? ctx.currentTime : 0;
    if (gain && ctx) {
      /* Fade out rather than cut. Stopping a square wave mid-cycle at full
         amplitude is a click, and this sound starts and stops every time the
         ghosts pause at a junction. cancelScheduledValues first, or the
         pending setTargetAtTime from the last pump fights the fade. */
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
    }
    osc.stop(ctx ? now + 0.12 : 0);
  } catch (_) {
    try { osc.stop(); } catch (_) {}
  }
}

// Classic "wakka-wakka" chomp: alternates between two pitches each pellet.
let pelletToggle = false;
function playPelletSound() {
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    ctx.resume();
    pelletToggle = !pelletToggle;
    const now = ctx.currentTime;

    // Main "wakka" blip, slightly brighter and with a quick pitch flick
    // so each chomp feels crisper instead of a flat square blip.
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "square";
    const baseFreq = pelletToggle ? 760 : 540;
    osc.frequency.setValueAtTime(baseFreq * 1.4, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq, now + 0.045);
    gain.gain.setValueAtTime(vol(0.12), now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
    osc.start(now);
    osc.stop(now + 0.08);

    // Soft high overtone layered on top for a little sparkle.
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.type = "triangle";
    osc2.frequency.setValueAtTime(baseFreq * 2, now);
    gain2.gain.setValueAtTime(vol(0.05), now);
    gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.06);
    osc2.start(now);
    osc2.stop(now + 0.06);
  } catch (_) {}
}

// Per-life hit: a dramatic two-layer power-down sweep.
// A distinct low "gulp/growl" specifically for the moment a ghost actually
// catches Pac-Man — separate from the ghost siren (which plays while
// chasing) and separate from the falling "you lost a life" jingle that
// follows it, so getting caught has its own clear identity.
function playGhostCatchSound() {
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    ctx.resume();
    const now = ctx.currentTime;

    const growl = ctx.createOscillator();
    const gGain = ctx.createGain();
    growl.connect(gGain);
    gGain.connect(ctx.destination);
    growl.type = "sawtooth";
    growl.frequency.setValueAtTime(130, now);
    growl.frequency.exponentialRampToValueAtTime(60, now + 0.22);
    gGain.gain.setValueAtTime(0.001, now);
    gGain.gain.linearRampToValueAtTime(vol(0.18), now + 0.03);
    gGain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
    growl.start(now);
    growl.stop(now + 0.24);

    // Quick "gulp" swallow right after the growl.
    const gulp = ctx.createOscillator();
    const gulpGain = ctx.createGain();
    gulp.connect(gulpGain);
    gulpGain.connect(ctx.destination);
    gulp.type = "sine";
    gulp.frequency.setValueAtTime(180, now + 0.2);
    gulp.frequency.exponentialRampToValueAtTime(70, now + 0.34);
    gulpGain.gain.setValueAtTime(0.001, now + 0.2);
    gulpGain.gain.linearRampToValueAtTime(vol(0.14), now + 0.23);
    gulpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.36);
    gulp.start(now + 0.2);
    gulp.stop(now + 0.36);
  } catch (_) {}
}

function playDeathSound() {
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    ctx.resume();
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.exponentialRampToValueAtTime(50, now + 0.75);
    gain.gain.setValueAtTime(vol(0.16), now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.75);
    osc.start(now);
    osc.stop(now + 0.75);

    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.type = "square";
    osc2.frequency.setValueAtTime(220, now);
    osc2.frequency.exponentialRampToValueAtTime(40, now + 0.75);
    gain2.gain.setValueAtTime(vol(0.08), now);
    gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.75);
    osc2.start(now);
    osc2.stop(now + 0.75);
  } catch (_) {}
}

// Level-win fanfare: a cheerful rising arpeggio finishing on a held chord.
function playWinSound() {
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    ctx.resume();
    const now = ctx.currentTime;
    [523, 659, 784, 1046, 1318].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "square";
      const start = now + i * 0.11;
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(vol(0.1), start);
      gain.gain.exponentialRampToValueAtTime(0.01, start + 0.16);
      osc.start(start);
      osc.stop(start + 0.16);
    });
    // held major chord at the end for a satisfying finish
    const chordStart = now + 5 * 0.11;
    [784, 1046, 1318].forEach((freq) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, chordStart);
      gain.gain.setValueAtTime(vol(0.09), chordStart);
      gain.gain.exponentialRampToValueAtTime(0.01, chordStart + 0.55);
      osc.start(chordStart);
      osc.stop(chordStart + 0.55);
    });
  } catch (_) {}
}

// Eating a scared ghost: a bright, satisfying two-tone ding.
function playGhostEatenSound() {
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    ctx.resume();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "square";
    osc.frequency.setValueAtTime(340, now);
    osc.frequency.exponentialRampToValueAtTime(980, now + 0.15);
    gain.gain.setValueAtTime(vol(0.15), now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
    osc.start(now);
    osc.stop(now + 0.2);

    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.type = "triangle";
    osc2.frequency.setValueAtTime(680, now + 0.03);
    osc2.frequency.exponentialRampToValueAtTime(1470, now + 0.18);
    gain2.gain.setValueAtTime(vol(0.09), now + 0.03);
    gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.22);
    osc2.start(now + 0.03);
    osc2.stop(now + 0.22);
  } catch (_) {}
}

// Game over: a dramatic descending minor run ending on a low sustained thud.
function playGameOverSound() {
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    ctx.resume();
    const now = ctx.currentTime;
    [392, 349, 311, 262].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sawtooth";
      const start = now + i * 0.2;
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(vol(0.14), start);
      gain.gain.exponentialRampToValueAtTime(0.01, start + 0.24);
      osc.start(start);
      osc.stop(start + 0.24);
    });
    const thudStart = now + 4 * 0.2;
    const thud = ctx.createOscillator();
    const thudGain = ctx.createGain();
    thud.connect(thudGain);
    thudGain.connect(ctx.destination);
    thud.type = "sine";
    thud.frequency.setValueAtTime(110, thudStart);
    thud.frequency.exponentialRampToValueAtTime(45, thudStart + 0.9);
    thudGain.gain.setValueAtTime(vol(0.2), thudStart);
    thudGain.gain.exponentialRampToValueAtTime(0.01, thudStart + 0.9);
    thud.start(thudStart);
    thud.stop(thudStart + 0.9);
  } catch (_) {}
}

function initMap(level) {
  currentLayout = getLayoutForLevel(level);
  map = [];
  pelletsRemaining = 0;
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      let val = Number(currentLayout[r][c]);
      if (val === 2 || val === 3) pelletsRemaining++;
      row.push(val);
    }
    map.push(row);
  }
  // Upgrade a handful of regular pellets into extra power pellets on
  // higher levels — total pellet count is unchanged so the win condition
  // still works exactly the same, they just carry more punch.
  getExtraPowerPelletsForLevel(level).forEach(([r, c]) => {
    if (map[r] && map[r][c] === 2) {
      map[r][c] = 3;
    }
  });
  /* FIX (score started at 10): Pac-Man's starting tile held a pellet in
     every maze, and movePacman() ate it on the very first frame, before the
     player pressed anything. The start tile is now empty, like the arcade
     game, so a level always begins at the score it should (0 on a fresh
     run). Uses the same start position resetEntities() puts Pac-Man on. */
  const startCol = level % 2 === 0 ? cols - 1 - 1 : 1;
  const startRow = 29;
  if (map[startRow] && (map[startRow][startCol] === 2 || map[startRow][startCol] === 3)) {
    map[startRow][startCol] = 0;
    pelletsRemaining--;
  }
  computeHouseDistances();
  computeHouseGate();
  rebuildMazeVisual();
}

// True shortest-path distance (in tiles, via BFS through the corridor graph)
// from every open tile back to the ghost house. A straight-line "closest
// point" heuristic can get eaten ghosts trapped bouncing between two tiles
// forever if the nearer-looking tile is actually a dead end, so eaten
// ghosts steer using this instead — guaranteed to always make progress.
let houseDistanceGrid = [];
function computeHouseDistances() {
  houseDistanceGrid = Array.from({ length: rows }, () => new Array(cols).fill(Infinity));
  const startCol = Math.round(GHOST_HOUSE.x);
  const startRow = Math.round(GHOST_HOUSE.y);
  if (isWall(startCol, startRow)) return;

  const queue = [[startCol, startRow]];
  houseDistanceGrid[startRow][startCol] = 0;
  let head = 0;
  while (head < queue.length) {
    const [col, row] = queue[head++];
    const d = houseDistanceGrid[row][col];
    for (const dir of GHOST_DIRS) {
      // Tunnel wraparound: exactly the same rule as actual ghost movement,
      // on BOTH axes now that the board wraps top-to-bottom as well.
      // Without this, an eaten ghost on the far side of a tunnel had no
      // BFS-reachable path home and would get stuck bouncing near the
      // tunnel mouth forever.
      const nc = wrapCol(col + dir.x);
      const nr = wrapRow(row + dir.y);
      if (isWall(nc, nr)) continue;
      if (houseDistanceGrid[nr][nc] > d + 1) {
        houseDistanceGrid[nr][nc] = d + 1;
        queue.push([nc, nr]);
      }
    }
  }
}

function resetEntities(level) {
  const mirrored = level % 2 === 0;
  pacman.x = mirrored ? cols - 1 - 1 : 1;
  pacman.y = 29;
  pacman.dirX = 0;
  pacman.dirY = 0;
  pacman.nextDirX = 0;
  pacman.nextDirY = 0;
  pacman.speed = getPacmanSpeedForLevel(level);

  ghosts = buildGhosts(level);
  buildGhostMeshes();
  frightenedActive = false;
  ghostsEatenChain = 0;
  scorePopups = [];
  pacmanTrail = [];
  sparkleParticles = [];
}

function activateFrighten() {
  const seconds = getFrightenSecondsForLevel(currentLevel);
  frightenedActive = true;
  frightenedEndsAt = simNow + seconds * 1000;
  ghostsEatenChain = 0;
  ghosts.forEach((g) => {
    if (!g.eaten) g.frightened = true;
  });
}

/* Ends the fright once the game clock passes frightenedEndsAt. Checked every
   simulation step instead of on a setTimeout, so it pauses with the game. */
function updateFrighten() {
  if (!frightenedActive || simNow < frightenedEndsAt) return;
  frightenedActive = false;
  ghosts.forEach((g) => {
    if (!g.eaten) g.frightened = false;
  });
}

function eatGhost(ghost) {
  ghost.frightened = false;
  ghost.eaten = true;
  ghost.eatenAt = simNow; // see EATEN_FORCE_HOME_MS failsafe in moveEatenGhost()
  ghost.houseHoldUntil = null;
  const points = GHOST_EAT_SCORES[Math.min(ghostsEatenChain, GHOST_EAT_SCORES.length - 1)];
  ghostsEatenChain++;
  score += points;
  scorePopups.push({ x: ghost.x, y: ghost.y, text: "+" + points, createdAt: performance.now() });
  updateUI();
  playGhostEatenSound();
}

function updateUI() {
  scoreEl.textContent = score;
  livesEl.textContent = lives;
  /* Split so a very narrow bar can drop the word and keep the number: the
     stylesheet turns "Level 7" into "L7" at the xxs tier, which is the
     difference between one row and two on a phone. */
  levelTitleEl.innerHTML =
    '<span class="lvl-word">Level</span><span class="lvl-num">' + currentLevel + "</span>";
  prevLevelBtn.disabled = currentLevel <= 1;
  nextLevelBtn.disabled = !isLevelUnlocked(currentLevel + 1);
}

function startLevel(level, opts) {
  currentLevel = Math.min(Math.max(level, 1), TOTAL_LEVELS);
  const carried = opts && Number.isFinite(opts.startScore) ? Math.max(0, opts.startScore) : 0;
  score = carried;
  levelStartScore = carried;
  lives = 3;
  gameOver = false;
  levelWon = false;
  lastTime = 0;
  continuesUsedThisRun = 0;
  restartAdUsedThisRun = false;
  restartBtn.disabled = false;
  initMap(currentLevel);
  resetEntities(currentLevel);
  updateUI();
  hideOverlay();
  showScreen("game");
  // The maze/camera was fitted while the game screen was still hidden
  // (display:none), so the canvas had zero size and fitCameraToBoard()
  // fell back to a wrong default aspect ratio, stretching the maze wider
  // than the actual canvas. Now that the screen is visible and laid out,
  // re-fit the camera to the real, correct canvas size.
  resize3D(true);
  /* ---------- The "ghosts start blurry, then snap sharp" flash ----------
     showScreen("game") above also kicks off loadSideRails(), which lays
     out the ad rails and — via fitSideRails() -> syncBarToMaze() — narrows
     the board's box to make room for them. That narrowing can still be
     mid-flight (a built-in card swapping for a fetched one, a font finishing
     its swap, the ResizeObserver on #gameCanvas catching up) for a frame or
     two after the resize3D(true) right above this comment, which is forced
     and so applies immediately at whatever size the board reports RIGHT
     NOW — sometimes the pre-narrowing, wider one, which computes a lower
     pixel ratio (see resize3D()'s comment on that). The very next
     fitSideRails() pass then corrects the width and re-fits at the true
     ratio, and that correction is the visible snap.
     A second, later re-fit closes that gap: two animation frames give the
     rail layout and any font swap time to land, so this one measures the
     board's settled box instead of racing it. It's the same double-rAF
     idiom used elsewhere in this file (see the ad-carousel slide trigger)
     for "wait for layout to actually settle before touching this". */
  requestAnimationFrame(() => requestAnimationFrame(() => resize3D(true)));
}


function isWall(col, row) {
  if (row < 0 || row >= rows || col < 0 || col >= cols) return true;
  return map[row][col] === 1;
}

/* ---------- Wrapping in BOTH directions ----------
   The maze has side tunnels (a step past the last column comes back at the
   first) and, since the top and bottom borders were opened at columns 13/14,
   VERTICAL ones too: walking off the top of the board brings you back on at
   the bottom in the same column, and the other way round.
   Everything that steps a tile — Pac-Man, the ghosts, the eaten-ghost eyes,
   the BFS that guides them home — goes through these two helpers, so the two
   kinds of tunnel behave identically and none of them can be written to
   handle one but not the other. */
function wrapCol(col) {
  if (col < 0) return cols - 1;
  if (col >= cols) return 0;
  return col;
}

function wrapRow(row) {
  if (row < 0) return rows - 1;
  if (row >= rows) return 0;
  return row;
}

// Same as isWall, but wraps first — used when deciding which directions a
// ghost may move in, so a tunnel mouth (where col or row goes negative or
// past the last one) is correctly treated as open rather than as a wall.
// Without this, ghosts right at a tunnel edge could never choose to step
// into it and would get stuck bouncing there.
function isWallWrapped(col, row) {
  return map[wrapRow(row)][wrapCol(col)] === 1;
}

/* ---------- Keeping Pac-Man out of the pen ----------
   The pink box drawn around the ghost house is cosmetic only — the comment
   on getGhostHouseBoxForLevel() says so directly, the tiles under it are
   ordinary open floor in the map data. Nothing was actually stopping Pac-Man
   from walking in through the gate and sitting there, which he should never
   be able to do — that gate is for the ghosts, not for him.
   Checked only from Pac-Man's own movement functions below, never from the
   ghosts' — they use isWall / isWallWrapped directly and are untouched by
   this, so they still pass through the gate exactly as before. */
function inGhostHouseBox(col, row) {
  const box = getGhostHouseBoxForLevel(currentLevel);
  return col >= box.left && col <= box.right && row >= box.top && row <= box.bottom;
}

function trySetDirection(dx, dy) {
  pacman.nextDirX = dx;
  pacman.nextDirY = dy;
  // The player is actually playing this level now (not just looking at it
  // after an unlock), so this is the level the menu's Play button resumes.
  if (!gameOver && !levelWon && !gamePaused) setLastPlayedLevel(currentLevel);
}

function handleInput() {
  const centerCol = Math.round(pacman.x);
  const centerRow = Math.round(pacman.y);

  const offsetX = Math.abs(pacman.x - centerCol);
  const offsetY = Math.abs(pacman.y - centerRow);

  // Allow direction change when reasonably aligned, or when stopped so first keypress works
  const aligned = offsetX < 0.35 && offsetY < 0.35;
  const stopped = pacman.dirX === 0 && pacman.dirY === 0;

  if (aligned || stopped) {
    const targetCol = centerCol + pacman.nextDirX;
    const targetRow = centerRow + pacman.nextDirY;
    if (!isWallWrapped(targetCol, targetRow) && !inGhostHouseBox(targetCol, targetRow)) {
      pacman.dirX = pacman.nextDirX;
      pacman.dirY = pacman.nextDirY;
    }
  }
}

function movePacman(deltaSeconds) {
  handleInput();

  // Direction-invariant visual speed — see getAxisSpeedScale() above.
  // The Y-axis (grid-Y, world-Z) step is scaled so on-screen up/down
  // speed matches left/right speed. The X-axis step is the baseline.
  const baseSpeed = pacman.speed * deltaSeconds;
  const speedX = baseSpeed;
  const speedY = baseSpeed * getAxisSpeedScale();
  const prevCol = Math.round(pacman.x);
  const prevRow = Math.round(pacman.y);
  let newX = pacman.x + pacman.dirX * speedX;
  let newY = pacman.y + pacman.dirY * speedY;

  // Tunnel wrap — sideways through the side tunnels, and up/down through the
  // new top/bottom ones. `wrapped` tells the pellet sweep below that the step
  // it is about to walk is not a straight line between two neighbouring
  // tiles, so it must not try to fill in the tiles "in between".
  let wrapped = false;
  if (newX < 0) {
    newX = cols - 1;
    wrapped = true;
  }
  if (newX > cols - 1) {
    newX = 0;
    wrapped = true;
  }
  if (newY < 0) {
    newY = rows - 1;
    wrapped = true;
  }
  if (newY > rows - 1) {
    newY = 0;
    wrapped = true;
  }

  const nextCol = Math.round(newX);
  const nextRow = Math.round(newY);

  if (isWall(nextCol, nextRow) || inGhostHouseBox(nextCol, nextRow)) {
    // Block movement into wall (or the ghosts' own pen); snap back to the
    // corridor tile (the one we're in)
    const dx = pacman.dirX;
    const dy = pacman.dirY;
    pacman.dirX = 0;
    pacman.dirY = 0;
    pacman.x = nextCol - dx;
    pacman.y = nextRow - dy;
    return;
  }

  pacman.x = newX;
  pacman.y = newY;

  // Eat pellets — sweep every tile crossed this frame, not just the tile
  // Pac-Man ends up on. Without this, an unusually large delta (e.g. the
  // browser tab was backgrounded and just came back) could let a fast
  // single-frame jump skip clean over a pellet without ever "touching" it,
  // leaving pelletsRemaining stuck above 0 forever and the win condition
  // never firing even though the player has visibly cleared the maze.
  const endCol = Math.round(pacman.x);
  const endRow = Math.round(pacman.y);
  const stepCol = wrapped || endCol === prevCol ? 0 : endCol > prevCol ? 1 : -1;
  const stepRow = wrapped || endRow === prevRow ? 0 : endRow > prevRow ? 1 : -1;

  let col = wrapped ? endCol : prevCol;
  let row = wrapped ? endRow : prevRow;
  let guard = 0;
  while (guard++ < 200) {
    if (map[row] && (map[row][col] === 2 || map[row][col] === 3)) {
      playPelletSound();
      if (map[row][col] === 2) score += 10;
      if (map[row][col] === 3) {
        score += 50;
        activateFrighten();
      }
      if (currentEffect === "sparkle") {
        const sx = col + 0.5;
        const sy = row + 0.5;
        for (let s = 0; s < 5; s++) {
          const angle = (Math.PI * 2 * s) / 5 + Math.random() * 0.5;
          sparkleParticles.push({
            x: sx,
            y: sy,
            vx: Math.cos(angle) * 0.5,
            vy: Math.sin(angle) * 0.5,
            createdAt: performance.now(),
          });
        }
      }
      map[row][col] = 0;
      pelletsRemaining--;
      hidePelletVisual(row, col);
      updateUI();
    }
    if (col === endCol && row === endRow) break;
    col += stepCol;
    row += stepRow;
  }

  if (pelletsRemaining <= 0) {
    handleLevelWin();
  }
}

const GHOST_DIRS = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

// A ghost can "see" Pac-Man only when they share the same row or column
// with a clear, unbroken corridor between them (no walls in the way) —
// like classic Pac-Man ghost AI, this stops ghosts from beelining toward
// Pac-Man from anywhere on the map regardless of walls between them.
function canGhostSeePacman(ghost) {
  const gr = Math.round(ghost.y);
  const gc = Math.round(ghost.x);
  const pr = Math.round(pacman.y);
  const pc = Math.round(pacman.x);

  if (gr === pr && gc !== pc) {
    const step = pc > gc ? 1 : -1;
    for (let c = gc + step; c !== pc; c += step) {
      if (isWall(c, gr)) return false;
    }
    return true;
  }
  if (gc === pc && gr !== pr) {
    const step = pr > gr ? 1 : -1;
    for (let r = gr + step; r !== pr; r += step) {
      if (isWall(gc, r)) return false;
    }
    return true;
  }
  return false;
}

// A freshly-spawned (or just-revived) ghost is confined to the house and
// must walk out through the single top gate (columns 12-14) — never
// sideways through the side tunnels at columns 9/17, even though those are
// technically walkable too. This is the fix for ghosts "leaving from every
// side": without this, normal wandering AI would happily take whichever
// open exit it stumbled into first.
// Fallback only — see computeHouseGate() below, which is what actually
// drives moveGhostOutOfHouse() on every level. These two match the
// ORIGINAL (non-mirrored) layout's real gate opening and exist only so
// the game never divides by / compares against `undefined` if
// computeHouseGate() somehow hasn't run yet.
const HOUSE_GATE_COL_MIN_FALLBACK = 12;
const HOUSE_GATE_COL_MAX_FALLBACK = 14;
let houseGateColMin = HOUSE_GATE_COL_MIN_FALLBACK;
let houseGateColMax = HOUSE_GATE_COL_MAX_FALLBACK;
const HOUSE_EXIT_ROW = 12; // once a ghost reaches this row it has cleared the gate

/* ---------- Finding the REAL gate opening, per level ----------
   The row just below HOUSE_EXIT_ROW (row 13) is a hand-authored maze row,
   not a symmetric one: in the un-mirrored layout its three open tiles sit
   at columns 12-14, but mirrorLayout() reverses the row character-by-
   character for every even level, and 12-14 is NOT centred on the row's
   true midpoint (13.5) — so on a mirrored level the same three open tiles
   land at columns 13-15 instead. moveGhostOutOfHouse() used to test
   against the columns 12-14 hardcoded above unconditionally, so on every
   mirrored (even-numbered) level a ghost lined up on column 12 — a real
   WALL on that layout — and was sent straight up through it: with no
   wall-check in that function (see the guard added below), it silently
   walked through solid geometry for one row instead of the gate, which
   is what a player sees as a ghost snagging/disappearing at one specific
   spot while leaving the house. Scanning the actual map for the open
   run at row 13, per level, fixes this for both orientations and for any
   future layout, instead of hardcoding one specific maze's numbers.
   Restricted to the house box's own column range (not the full row) so
   it can't pick up an unrelated open corridor tile elsewhere in row 13. */
let houseGateColRow = 13;
function computeHouseGate() {
  const box = getGhostHouseBoxForLevel(currentLevel);
  houseGateColRow = HOUSE_EXIT_ROW + 1;
  let min = null;
  let max = null;
  for (let c = box.left; c <= box.right; c++) {
    if (!isWall(c, houseGateColRow)) {
      if (min === null) min = c;
      max = c;
    }
  }
  houseGateColMin = min !== null ? min : HOUSE_GATE_COL_MIN_FALLBACK;
  houseGateColMax = max !== null ? max : HOUSE_GATE_COL_MAX_FALLBACK;
}

function moveGhostOutOfHouse(ghost, deltaSeconds) {
  const baseSpeed = getGhostSpeedForLevel(currentLevel) * (ghost.speedMult || 1) * deltaSeconds;
  // Direction-invariant visual speed — see getAxisSpeedScale() above.
  // The Y-axis step (grid-Y, which is world-Z) is scaled so the on-screen
  // speed of an "up" / "down" move matches a "left" / "right" move.
  const speedX = baseSpeed;
  const speedY = baseSpeed * getAxisSpeedScale();
  // The threshold uses whichever step is larger so a fast axis never
  // overshoots the tile centre without re-evaluating direction.
  const speed = Math.max(speedX, speedY);

  const centerCol = Math.round(ghost.x);
  const centerRow = Math.round(ghost.y);
  /* Half a step, uncapped. The window has to be at least half of one
     step wide or a ghost can stride straight over a tile centre without
     ever being "aligned" on it — and then it cannot turn there. This used
     to be capped at 0.05 (0.06 for eyes), which is less than half a step
     once a ghost covers more than ~0.1 tile per 1/60s step: from about
     level 16 for eaten eyes (2.2x speed), and on wide screens where the
     vertical step is scaled up. Ghosts then sailed past junctions, and
     eaten eyes missed every turn on their way home until the 4s failsafe
     teleported them. */
  const alignThreshold = speed * 0.5 + 1e-9;
  const alignedX = Math.abs(ghost.x - centerCol) < alignThreshold;
  const alignedY = Math.abs(ghost.y - centerRow) < alignThreshold;

  if (alignedX && alignedY) {
    ghost.x = centerCol;
    ghost.y = centerRow;

    if (centerRow <= HOUSE_EXIT_ROW) {
      // Cleared the gate — hand off to normal chase AI.
      ghost.inHouse = false;
      return;
    }

    // houseGateColMin/Max (see computeHouseGate()) are the REAL open
    // columns for this level's actual layout — not a hardcoded guess —
    // so "lined up with the gate" here always means a genuinely open tile
    // is directly above, on every level and in both mirrored orientations.
    if (centerCol < houseGateColMin) {
      ghost.dirX = 1;
      ghost.dirY = 0;
    } else if (centerCol > houseGateColMax) {
      ghost.dirX = -1;
      ghost.dirY = 0;
    } else if (!isWall(centerCol, centerRow - 1)) {
      // Lined up with the gate and the tile above is genuinely open —
      // head straight up and out.
      ghost.dirX = 0;
      ghost.dirY = -1;
    } else {
      /* Belt-and-suspenders: centerCol falls inside [min, max] but the
         tile directly above is still a wall (e.g. a future layout with a
         gap in the middle of its gate run). Never move into a wall —
         step sideways toward whichever real gate column is closest
         instead of clipping through solid geometry, which is exactly
         the "ghost snags at one specific spot leaving the house" bug
         this function used to have with the old hardcoded columns. */
      const distToMin = Math.abs(centerCol - houseGateColMin);
      const distToMax = Math.abs(centerCol - houseGateColMax);
      ghost.dirX = distToMin <= distToMax ? -1 : 1;
      ghost.dirY = 0;
    }
  }

  const nextX = ghost.x + ghost.dirX * speedX;
  const nextY = ghost.y + ghost.dirY * speedY;
  // Never actually step INTO a wall tile — the pen interior and the gate
  // column range above already keep this from mattering in the common
  // case, but this is the same defensive check moveGhost()/moveEatenGhost()
  // both have, so a ghost leaving the house can never visually clip
  // through a block the way it used to on a mirrored level's gate.
  if (isWall(Math.round(nextX), Math.round(nextY))) {
    ghost.x = centerCol;
    ghost.y = centerRow;
    return;
  }
  ghost.x = nextX;
  ghost.y = nextY;
}

function moveGhost(ghost, deltaSeconds) {
  const baseSpeed = getGhostSpeedForLevel(currentLevel) * (ghost.speedMult || 1) * deltaSeconds;
  // Direction-invariant visual speed — see getAxisSpeedScale() above.
  const speedX = baseSpeed;
  const speedY = baseSpeed * getAxisSpeedScale();
  const speed = Math.max(speedX, speedY);

  const centerCol = Math.round(ghost.x);
  const centerRow = Math.round(ghost.y);
  // Threshold scales with the step size so a fast ghost can never overshoot
  // past the exact tile-center without triggering a direction re-check —
  // see the identical fix (and explanation) in moveEatenGhost().
  // IMPORTANT: this threshold must always stay smaller than the distance
  // the ghost actually travels this frame ("speed" here is already the
  // per-frame step). If it isn't, the ghost snaps back to the exact tile
  // center every single frame, re-rolls a direction, and can never
  // accumulate real movement — which is what made ghosts look frozen/stuck
  // (most obviously in the ghost house) once their speed was slowed down.
  const alignThreshold = speed * 0.5 + 1e-9; // half a step — see moveGhostOutOfHouse()
  const alignedX = Math.abs(ghost.x - centerCol) < alignThreshold;
  const alignedY = Math.abs(ghost.y - centerRow) < alignThreshold;

  // At every tile center, re-evaluate direction so ghosts use every
  // available opening (up/down/left/right), not just the direction
  // they happen to be moving in.
  if (alignedX && alignedY) {
    ghost.x = centerCol;
    ghost.y = centerRow;

    const oppX = -ghost.dirX;
    const oppY = -ghost.dirY;

    const open = GHOST_DIRS.filter(
      (d) => !isWallWrapped(centerCol + d.x, centerRow + d.y)
    );

    if (open.length > 0) {
      const nonReverse = open.filter(
        (d) => !(d.x === oppX && d.y === oppY)
      );
      const pool = nonReverse.length > 0 ? nonReverse : open;

      // Ghosts now chase (or flee, when frightened) using real distance to
      // Pac-Man's current tile almost all the time — not only when there's
      // a perfectly clear, wall-free line to him. Line-of-sight-only was
      // the reason ghosts often looked like they weren't actually coming
      // after him: most of the maze has turns, so they'd rarely qualify
      // and would just wander instead. A clear sightline still makes them
      // a little more locked-on, and a small amount of randomness stays so
      // they don't feel perfectly robotic.
      const sees = canGhostSeePacman(ghost);
      const playSmart = Math.random() < (ghost.frightened ? 0.85 : (sees ? 0.97 : 0.88));
      let choice;
      if (playSmart) {
        let best = pool[0];
        let bestScore = ghost.frightened ? -Infinity : Infinity;
        pool.forEach((d) => {
          const nx = centerCol + d.x;
          const ny = centerRow + d.y;
          const dist = Math.hypot(nx - pacman.x, ny - pacman.y);
          if (ghost.frightened ? dist > bestScore : dist < bestScore) {
            bestScore = dist;
            best = d;
          }
        });
        choice = best;
      } else {
        const continuing = pool.find(
          (d) => d.x === ghost.dirX && d.y === ghost.dirY
        );
        const shouldTurn = !continuing || Math.random() < 0.45;
        choice = shouldTurn
          ? pool[Math.floor(Math.random() * pool.length)]
          : continuing;
      }

      ghost.dirX = choice.x;
      ghost.dirY = choice.y;
    } else {
      ghost.dirX = 0;
      ghost.dirY = 0;
    }
  }

  let newX = ghost.x + ghost.dirX * speedX;
  let newY = ghost.y + ghost.dirY * speedY;

  // Tunnel wrap — must happen before the wall check below, otherwise a
  // ghost stepping into a tunnel mouth would see itself moving toward
  // an "out of bounds" (treated as wall) tile and get stuck bouncing there.
  // Both axes, since the board now wraps top-to-bottom as well as
  // side-to-side.
  if (newX < 0) newX = cols - 1;
  if (newX > cols - 1) newX = 0;
  if (newY < 0) newY = rows - 1;
  if (newY > rows - 1) newY = 0;

  const nextCol = Math.round(newX);
  const nextRow = Math.round(newY);

  if (isWall(nextCol, nextRow)) {
    // Shouldn't normally happen since direction is validated above,
    // but guard anyway: stop exactly at the tile center.
    ghost.x = centerCol;
    ghost.y = centerRow;
    return;
  }

  ghost.x = newX;
  ghost.y = newY;
}

// Safety net: if a ghost that should be actively moving hasn't made real
// progress for about 3/4 of a second (e.g. an unforeseen wall-edge case),
// force it to re-pick a fresh open direction from its current tile instead
// of silently freezing there for the rest of the level.
// An EATEN ghost (just eyes, racing home) is the one case where "any open
// direction" is the wrong rescue: picking randomly can send it further
// from the house, and if it stalls again there it just gets a fresh random
// pick again — wandering rather than arriving, which is exactly what
// "stuck, never reaches the box" looks like from outside. So for an eaten
// ghost this picks the neighbor that's actually closest to home (same
// houseDistanceGrid the normal path-finding uses), and gets a shorter
// watchdog window since it should never legitimately need to explore.
function unstickGhostIfNeeded(ghost, deltaSeconds) {
  const moved = Math.hypot(ghost.x - ghost.lastX, ghost.y - ghost.lastY);
  if (moved > 0.01) {
    ghost.stuckFrames = 0;
    ghost.lastX = ghost.x;
    ghost.lastY = ghost.y;
    return;
  }
  ghost.stuckFrames = (ghost.stuckFrames || 0) + 1;
  const stallLimit = ghost.eaten ? 15 : 45; // ~0.25s for eyes racing home, ~0.75s otherwise
  if (ghost.stuckFrames < stallLimit) return;

  const centerCol = Math.round(ghost.x);
  const centerRow = Math.round(ghost.y);
  ghost.x = centerCol;
  ghost.y = centerRow;
  const open = GHOST_DIRS.filter((d) => !isWallWrapped(centerCol + d.x, centerRow + d.y));
  if (open.length > 0) {
    let choice;
    if (ghost.eaten) {
      choice = open[0];
      let bestDist = Infinity;
      open.forEach((d) => {
        const nx = wrapCol(centerCol + d.x);
        const ny = wrapRow(centerRow + d.y);
        const dist = houseDistanceGrid[ny] ? houseDistanceGrid[ny][nx] : Infinity;
        if (dist < bestDist) {
          bestDist = dist;
          choice = d;
        }
      });
    } else {
      choice = open[Math.floor(Math.random() * open.length)];
    }
    ghost.dirX = choice.x;
    ghost.dirY = choice.y;
  }
  ghost.stuckFrames = 0;
  ghost.lastX = ghost.x;
  ghost.lastY = ghost.y;
}

function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// Eaten ghosts (just eyes) rush straight back to the ghost house, ignoring
// the normal random-turn AI, then rejoin the chase once they arrive.
function moveEatenGhost(ghost, deltaSeconds) {
  // Hard ceiling — see EATEN_FORCE_HOME_MS above. Checked before anything
  // else so it overrides whatever the normal path-home logic below was
  // about to do this frame.
  if (ghost.eatenAt != null && simNow - ghost.eatenAt > EATEN_FORCE_HOME_MS) {
    // GHOST_HOUSE.x is 13.5 — the visual centre of the pen, but not a real
    // tile. moveGhostOutOfHouse() only re-checks direction once the ghost
    // is aligned to a whole tile (see alignedX below), and 13.5 can never
    // satisfy that (it sits exactly 0.5 away from both 13 and 14, forever).
    // Landing there sent the ghost straight up on dirY=-1 with that check
    // never firing again — no wall stop, no exit-the-house handoff, no
    // turning back — which is the "goes up and never comes back" bug.
    // Snapping to the nearest real tile column keeps it exactly where it
    // visually was while making sure the ghost can actually leave again.
    ghost.x = Math.round(GHOST_HOUSE.x);
    ghost.y = GHOST_HOUSE.y;
    ghost.eaten = false;
    ghost.frightened = false;
    ghost.houseHoldUntil = null;
    ghost.inHouse = true;
    ghost.releaseAt = simNow; // already earned its freedom once — no stagger wait
    ghost.dirX = 0;
    ghost.dirY = -1;
    ghost.stuckFrames = 0;
    ghost.lastX = ghost.x;
    ghost.lastY = ghost.y;
    return;
  }

  const baseSpeed = getGhostSpeedForLevel(currentLevel) * 2.2 * deltaSeconds;
  // Direction-invariant visual speed — see getAxisSpeedScale() above.
  // The eaten-ghost rush-home is the place the up/down-vs-left/right
  // asymmetry is most visible (it's a long straight run), so it gets
  // the same compensation as the normal chase.
  const speedX = baseSpeed;
  const speedY = baseSpeed * getAxisSpeedScale();
  const speed = Math.max(speedX, speedY);

  const centerCol = Math.round(ghost.x);
  const centerRow = Math.round(ghost.y);
  // The alignment window has to be at least as wide as a single frame's
  // movement step, otherwise a fast-moving ghost can overshoot straight
  // past the exact tile-center it needed to stop at and re-evaluate a
  // turn — which is what caused ghosts to get stuck bouncing back and
  // forth near a junction instead of turning into the ghost house.
  // Same root-cause fix as moveGhost(): threshold must stay smaller than
  // the actual per-frame step, or the ghost snaps back to center forever
  // and never makes real progress toward the house.
  const alignThreshold = speed * 0.5 + 1e-9; // half a step — see moveGhostOutOfHouse()
  const alignedX = Math.abs(ghost.x - centerCol) < alignThreshold;
  const alignedY = Math.abs(ghost.y - centerRow) < alignThreshold;

  if (alignedX && alignedY) {
    ghost.x = centerCol;
    ghost.y = centerRow;

    // Tight threshold (was 1.2) so the ghost must actually reach the
    // interior pen tile before reviving — 1.2 was loose enough that a
    // ghost sitting right at the gate (one row above the pen) already
    // counted as "arrived", so it never visibly entered the box.
    if (Math.hypot(centerCol - GHOST_HOUSE.x, centerRow - GHOST_HOUSE.y) < 0.6) {
      if (!ghost.houseHoldUntil) {
        // Pause briefly inside the box so it's visibly "home" before
        // heading back out, instead of instantly turning around.
        ghost.houseHoldUntil = simNow + 500;
        ghost.dirX = 0;
        ghost.dirY = 0;
        return;
      }
      if (simNow < ghost.houseHoldUntil) {
        ghost.dirX = 0;
        ghost.dirY = 0;
        return;
      }
      ghost.houseHoldUntil = null;
      ghost.eaten = false;
      // Comes back in its normal (dangerous) form — it does NOT regain
      // "frightened" status even if the power pellet timer is still
      // running. Only ghosts that haven't been eaten yet stay vulnerable
      // during that time; a ghost that already went home and returned is
      // done being frightened for this power pellet.
      ghost.frightened = false;
      ghost.inHouse = true;
      ghost.releaseAt = simNow; // already earned its freedom once — no stagger wait this time
      ghost.dirX = 0;
      ghost.dirY = -1;
      return;
    }

    const open = GHOST_DIRS.filter((d) => !isWallWrapped(centerCol + d.x, centerRow + d.y));
    if (open.length > 0) {
      let best = open[0];
      let bestDist = Infinity;
      open.forEach((d) => {
        // Wrap BOTH axes — the maze also wraps top-to-bottom (see wrapRow),
        // not just left-right. Only wrapping nx here left ny able to land
        // at -1 or `rows`, which made houseDistanceGrid[ny] undefined right
        // next to a vertical tunnel mouth; that direction then fell back to
        // the +1000 straight-line penalty and got skipped even when it was
        // the real shortest way home — the eaten ghost would pick a worse
        // direction there and stall instead of routing straight home.
        const nx = wrapCol(centerCol + d.x);
        const ny = wrapRow(centerRow + d.y);
        // Use real shortest-path distance (BFS through the maze), not
        // straight-line distance, so a dead-end that merely "looks" closer
        // can never trap the ghost bouncing back and forth forever.
        const gridDist = houseDistanceGrid[ny] ? houseDistanceGrid[ny][nx] : Infinity;
        const dist = gridDist !== undefined && gridDist !== Infinity
          ? gridDist
          : Math.hypot(nx - GHOST_HOUSE.x, ny - GHOST_HOUSE.y) + 1000; // never picked if a real path exists
        if (dist < bestDist) {
          bestDist = dist;
          best = d;
        }
      });
      ghost.dirX = best.x;
      ghost.dirY = best.y;
    }
  }

  let newX = ghost.x + ghost.dirX * speedX;
  let newY = ghost.y + ghost.dirY * speedY;

  // Tunnel wrap — must happen before the wall check, same reasoning as
  // in moveGhost(), so an eaten ghost racing home through a tunnel
  // doesn't get stuck bouncing at its mouth. Both axes.
  if (newX < 0) newX = cols - 1;
  if (newX > cols - 1) newX = 0;
  if (newY < 0) newY = rows - 1;
  if (newY > rows - 1) newY = 0;

  const nextCol = Math.round(newX);
  const nextRow = Math.round(newY);

  if (isWall(nextCol, nextRow)) {
    ghost.x = centerCol;
    ghost.y = centerRow;
    return;
  }

  ghost.x = newX;
  ghost.y = newY;
}

function checkCollisions() {
  if (gameOver) return;
  for (const ghost of ghosts) {
    if (distance(ghost, pacman) < 0.7) {
      if (ghost.eaten) {
        continue; // already just eyes heading home — harmless
      }
      if (ghost.frightened) {
        eatGhost(ghost);
        continue;
      }
      playGhostCatchSound();
      playDeathSound();
      lives--;
      updateUI();
      if (lives <= 0) {
        handleGameOver();
      }
      resetEntities(currentLevel);
      break;
    }
  }
}

// ===================== VIDEO / BANNER ADS =====================
// - "continue"              -> Game Over -> Watch Ad & Continue (unlimited; 3 fresh lives each time)
// - "restart"                -> in-game Restart button (once per attempt)
// - "level_gate"             -> every 3rd level, when Next Level is pressed
// - "recover"                -> Level Select, re-unlocking a level the
//                               24-hour reset took back (5 plays in a row,
//                               skippable after 10s each)
// - "level_complete_banner"  -> static image card inside the Congratulations popup
// Ads are read from sponsor-media.json next to this file, with a built-in
// fallback if that can't be fetched (e.g. opening index.html via file://).
// All creatives are bundled locally so playback never depends on reaching
// an outside domain.
const SPONSOR_JSON_URL = "sponsor-media.json";
const AD_LOAD_TIMEOUT_MS = 12000;

const SPONSOR_FALLBACK_CATALOGUE = {
  ads: [
    {
      id: "pm-continue-1",
      adType: "video",
      advertiser: "Continue Sponsor",
      duration: 67,
      isSkippable: true,
      nonSkippableSeconds: 10,
      streamUrl: "ad-continue-2.mp4",
      placements: ["continue"],
    },
    {
      id: "pm-continue-2",
      adType: "video",
      advertiser: "Continue Sponsor",
      duration: 16,
      isSkippable: true,
      nonSkippableSeconds: 10,
      streamUrl: "ad-continue-3.mp4",
      placements: ["continue"],
    },
    {
      id: "pm-restart-1",
      adType: "video",
      advertiser: "Restart Sponsor",
      duration: 30,
      isSkippable: true,
      nonSkippableSeconds: 10,
      streamUrl: "ad-restart-2.mp4",
      placements: ["restart"],
    },
    {
      id: "pm-restart-2",
      adType: "video",
      advertiser: "Restart Sponsor",
      duration: 36,
      isSkippable: true,
      nonSkippableSeconds: 10,
      streamUrl: "ad-restart-3.mp4",
      placements: ["restart"],
    },
    {
      id: "pm-levelgate-1",
      adType: "video",
      advertiser: "Level Sponsor",
      duration: 27,
      isSkippable: true,
      nonSkippableSeconds: 10,
      streamUrl: "ad-levelgate-2.mp4",
      placements: ["level_gate"],
    },
    {
      id: "pm-recover-1",
      adType: "video",
      advertiser: "Unlock Sponsor",
      duration: 25,
      isSkippable: true,
      nonSkippableSeconds: 10,
      streamUrl: "ad-recover-2.mp4",
      placements: ["recover"],
    },
    {
      id: "pm-banner-creditkey",
      adType: "image",
      advertiser: "Credit Key",
      title: "Credit Key",
      subtitle: "Buy Now, Pay On Your Terms",
      ctaText: "Learn more",
      bgFrom: "#0b1450",
      bgTo: "#1e3a8a",
      streamUrl: "ad-creditkey-mrec.png",
      imageUrl: "ad-creditkey-mrec.png",
      placements: ["level_complete_banner"],
    },
    {
      id: "pm-banner-creditkey-2",
      adType: "image",
      adSize: "MREC",
      advertiser: "Credit Key",
      title: "Credit Key",
      subtitle: "Buy Now, Pay On Your Terms",
      ctaText: "Learn more",
      bgFrom: "#0b1450",
      bgTo: "#1e3a8a",
      streamUrl: "ad-creditkey-mrec-2.png",
      imageUrl: "ad-creditkey-mrec-2.png",
      placements: ["level_complete_banner"],
    },
    {
      id: "pm-banner-creditkey-3",
      adType: "image",
      adSize: "MREC",
      advertiser: "Credit Key",
      title: "Credit Key",
      subtitle: "Buy Now, Pay On Your Terms",
      ctaText: "Learn more",
      bgFrom: "#0b1450",
      bgTo: "#1e3a8a",
      streamUrl: "ad-creditkey-mrec-3.png",
      imageUrl: "ad-creditkey-mrec-3.png",
      placements: ["level_complete_banner"],
    },
    /* The VERTICAL_BANNER 300x600 creative for the cards either side of
       the maze. This used to live ONLY in sponsor-media.json, and that is
       why the side cards could come up blank: opening index.html straight
       from disk makes the page a file:// document, browsers refuse to fetch
       from it, the catalogue falls back to this list — and this list had no
       "banner" placement in it at all, so there was nothing to show.
       Keeping it here means the cards do not depend on a fetch succeeding.
       sponsor-media.json still wins when it does load, so swapping creatives
       there works exactly as before. Three Credit Key creatives run in this
       placement, so the 5s rotation visibly cycles through them. */
    {
      id: "pm-rail-creditkey",
      bgBottom: "#070d59",
      adType: "image",
      adSize: "VERTICAL_BANNER",
      advertiser: "Credit Key",
      title: "Credit Key",
      subtitle: "Buy Now, Pay On Your Terms",
      rating: 4.5,
      ctaText: "Learn more",
      bgFrom: "#0b1450",
      bgTo: "#1e3a8a",
      streamUrl: "ad-creditkey-banner.png",
      imageUrl: "ad-creditkey-banner.png",
      placements: ["banner"],
    },
    {
      id: "pm-rail-creditkey-2",
      bgBottom: "#091148",
      adType: "image",
      adSize: "VERTICAL_BANNER",
      advertiser: "Credit Key",
      title: "Credit Key",
      subtitle: "Buy Now, Pay On Your Terms",
      ctaText: "Learn more",
      bgFrom: "#0b1450",
      bgTo: "#1e3a8a",
      streamUrl: "ad-creditkey-banner-2.png",
      imageUrl: "ad-creditkey-banner-2.png",
      placements: ["banner"],
    },
    {
      id: "pm-rail-creditkey-3",
      bgBottom: "#0d1a6b",
      adType: "image",
      adSize: "VERTICAL_BANNER",
      advertiser: "Credit Key",
      title: "Credit Key",
      subtitle: "Buy Now, Pay On Your Terms",
      ctaText: "Learn more",
      bgFrom: "#0b1450",
      bgTo: "#1e3a8a",
      streamUrl: "ad-creditkey-banner-3.png",
      imageUrl: "ad-creditkey-banner-3.png",
      placements: ["banner"],
    },
    /* IAB LEADER_BOARD 970x90 — the single wide banner placeLeaderboardTop()
       shows above the maze when there is no side gutter for the 300x600
       cards. Only Credit Key runs here too, for the same reason as above —
       the demo Word Blitz / Puzzle Quest creatives were removed. */
    {
      id: "pm-leader-creditkey",
      adType: "image",
      adSize: "LEADER_BOARD",
      advertiser: "Credit Key",
      title: "Credit Key",
      subtitle: "Buy Now, Pay On Your Terms",
      ctaText: "Learn more",
      bgFrom: "#0b1450",
      bgTo: "#1e3a8a",
      streamUrl: "ad-creditkey-leaderboard.png",
      imageUrl: "ad-creditkey-leaderboard.png",
      placements: ["leaderboard"],
    },
    {
      id: "pm-leader-creditkey-2",
      adType: "image",
      adSize: "LEADER_BOARD",
      advertiser: "Credit Key",
      title: "Credit Key",
      subtitle: "Buy Now, Pay On Your Terms",
      ctaText: "Learn more",
      bgFrom: "#0b1450",
      bgTo: "#1e3a8a",
      streamUrl: "ad-creditkey-leaderboard-2.png",
      imageUrl: "ad-creditkey-leaderboard-2.png",
      placements: ["leaderboard"],
    },
    {
      id: "pm-leader-creditkey-3",
      adType: "image",
      adSize: "LEADER_BOARD",
      advertiser: "Credit Key",
      title: "Credit Key",
      subtitle: "Buy Now, Pay On Your Terms",
      ctaText: "Learn more",
      bgFrom: "#0b1450",
      bgTo: "#1e3a8a",
      streamUrl: "ad-creditkey-leaderboard-3.png",
      imageUrl: "ad-creditkey-leaderboard-3.png",
      placements: ["leaderboard"],
    },
  ],
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

// Every-3rd-level gate: an ad plays when the player presses Next Level,
// right after clearing a level that's a multiple of 3.
function isAdGateLevel(level) {
  return level % 3 === 0;
}

/* The win / Game Over popups open after a 150ms beat. That timer is kept so
   anything that leaves the board inside those 150ms (Exit, Restart, the
   24-hour reset) can cancel it — otherwise the popup opened on top of
   Level Select or the menu after the player had already left. */
let resultPopupTimer = null;

function handleLevelWin() {
  gameOver = true;
  levelWon = true;
  playWinSound();
  /* FIX (coin farming): coins are paid only the FIRST time a level is
     cleared. Replaying an already-cleared level used to pay 30 every time. */
  const firstClear = !isLevelCompleted(currentLevel);
  markLevelCompleted(currentLevel);

  const coinsEarned = firstClear ? 30 : 0;
  if (coinsEarned > 0) addCoins(coinsEarned);
  const carryScore = score;

  clearTimeout(resultPopupTimer);
  resultPopupTimer = setTimeout(() => {
    resultPopupTimer = null;
    const isLast = currentLevel >= TOTAL_LEVELS;
    const clearedLevel = currentLevel;

    modalTitle.textContent = "\u{1F389} Congratulations!";
    modalMessage.textContent = isLast
      ? `You finished all ${TOTAL_LEVELS} levels with a score of ${score}!`
      : `Level ${clearedLevel} cleared with a score of ${score}. Level ${clearedLevel + 1} is now unlocked.`;
    modalCoins.textContent = coinsEarned > 0
      ? `+${coinsEarned} \u{1FA99} coins`
      : "Already cleared \u2014 coins are paid on the first clear only";
    modalCoins.classList.remove("hidden");
    continueAdBtn.classList.add("hidden");
    continueNote.classList.add("hidden");
    loadLevelCompleteBanner();

    /* Short labels: the Congratulations popup lays its buttons out in ONE
       row now, and that row only has the 300px the MREC above it sets. */
    const primaryLabel = isLast ? "\u{1F5FA} Levels" : "Next Level \u27A1";
    wireModalButtons(
      primaryLabel,
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
            /* The level-gate ad is an interstitial, not a reward: the next
               level was already earned by clearing this one, so the game
               moves on even if the ad could not load. */
            modalPrimaryBtn.disabled = false;
            startLevel(clearedLevel + 1, { startScore: carryScore });
          });
        } else {
          startLevel(clearedLevel + 1, { startScore: carryScore });
        }
      },
      () => goToLevelSelect()
    );
    /* Wired AFTER wireModalButtons, which clears it — from level 2 onward the
       player can drop straight back into the level before this one instead of
       going out to Level Select and back in. */
    setModalPrevLevel(clearedLevel > 1 ? clearedLevel - 1 : 0);
    overlay.classList.remove("hidden");
  }, 150);
}

// Game Over's Watch Ad & Continue has NO limit: it is offered on every Game
// Over, and every successful continue restores the full CONTINUE_LIVES.
// continuesUsedThisRun is only a counter (reset in startLevel()); it never
// blocks the button.
const CONTINUE_LIVES = 3;
let continuesUsedThisRun = 0;

function handleGameOver() {
  gameOver = true;
  playGameOverSound();
  clearTimeout(resultPopupTimer);
  resultPopupTimer = setTimeout(() => {
    resultPopupTimer = null;
    modalTitle.textContent = "Game Over \u{1F480}";
    modalMessage.textContent = `You scored ${score} on Level ${currentLevel}. Try again?`;
    modalCoins.classList.add("hidden");
    modalBannerAd.classList.add("hidden");
    modalBannerAd.innerHTML = "";
    // This dialog is reused for Game Over, where the MREC is not shown —
    // so the rotation started by the Congratulations popup stops here
    // rather than waiting up to 5s to notice the card is hidden.
    stopModalBannerCarousel();

    // Always offered — there is no cap on ad-based continues.
    continueAdBtn.classList.remove("hidden");
    continueAdBtn.disabled = false;
    continueNote.classList.remove("hidden");
    continueNote.textContent = "Watch a short ad to pick up right where you were \u2014 with " +
      CONTINUE_LIVES + " fresh lives.";

    wireModalButtons(
      "\u{1F501} Retry Level",
      "\u{1F5FA} Level Select",
      () => startLevel(currentLevel, { startScore: levelStartScore }),
      () => goToLevelSelect()
    );
    overlay.classList.remove("hidden");
  }, 150);
}

let continueAdInFlight = false;
function grantContinue() {
  // Only guard against a double-click while this ad is playing — never a cap.
  if (continueAdInFlight || !gameOver) return;
  continueAdInFlight = true;
  continueAdBtn.disabled = true;
  overlay.classList.add("hidden");
  stopModalBannerCarousel();
  playVideoAd({
    placement: "continue",
    rewardText: "Watch the ad to continue this attempt \u2014 score and pellets are kept.",
  }).then((res) => {
    continueAdInFlight = false;
    /* FIX: no ad shown -> no continue. Back to the Game Over popup. */
    if (!res || !res.shown) {
      continueAdBtn.disabled = false;
      continueNote.textContent = "The ad couldn't load, so no continue was given. Please try again.";
      overlay.classList.remove("hidden");
      return;
    }
    continuesUsedThisRun += 1;
    // Full 3 lives back on EVERY continue, not just the first.
    lives = CONTINUE_LIVES;
    gameOver = false;
    resetEntities(currentLevel);
    updateUI();
  });
}
if (continueAdBtn) {
  continueAdBtn.addEventListener("click", grantContinue);
}

// ===================== 3D SCENE OBJECTS =====================
let renderer, scene, camera;
let mazeGroup, ghostGroup, trailGroup, popupGroup, sparkleGroup;
let pelletInstMesh = null;
let pelletCellList = [];
let powerCellList = [];
const PELLET_Y = 0.16;
const POWER_PELLET_Y = 0.22;

/* The pellets are placed once when the level is built, but depthLift()
   depends on the camera tilt — and the tilt changes whenever the window does.
   Without this, resizing left every pellet offset by the difference between
   the old tilt and the new one. */
function refreshPelletDepth() {
  if (!pelletInstMesh || !pelletCellList.length) return;
  pelletCellList.forEach(([r, c], i) => {
    /* An eaten pellet has been parked far below the board with a near-zero
       scale. Rewriting its matrix here would put it straight back on the
       board, so the map is the authority: only cells still marked as holding
       a pellet get repositioned. */
    if (!map[r] || map[r][c] !== 2) return;
    dummyObj3D.position.set(worldX(c), PELLET_Y, worldZ(r) + corridorLift(PELLET_Y));
    dummyObj3D.scale.set(1, 1, 1);
    dummyObj3D.rotation.set(0, 0, 0);
    dummyObj3D.updateMatrix();
    pelletInstMesh.setMatrixAt(i, dummyObj3D.matrix);
  });
  pelletInstMesh.instanceMatrix.needsUpdate = true;
}
let powerInstMesh = null;
let pelletRegistry = new Map(); // "row,col" -> { mesh, index, power }
const dummyObj3D = new THREE.Object3D();
let lastCanvasW = 0;
let lastCanvasH = 0;

const trailPelletGeo = new THREE.SphereGeometry(0.18, 8, 8);
const sparkleGeo = new THREE.SphereGeometry(0.06, 6, 6);

// Fixed camera viewing direction (angled 3/4 top-down view — classic "3D maze" look)
/* The board is 28x31 cells, so seen from straight above it is TALLER than it
   is wide. Screens are the other way round, so the board ended up bounded by
   the window's height and stopped well short of the sides — that was the dead
   band of background either side of the maze.
   The tilt is what decides the shape on screen: the flatter the camera, the
   more the depth is foreshortened and the wider the board reads. So instead of
   one fixed angle, fitCameraToBoard() picks the angle that makes the board's
   shape match the space it has been given, within these limits. The board then
   grows out to the full width of its column instead of floating in the middle.
     60 deg = the old near-top-down view (kept for portrait/tall windows)
     44 deg = as flat as it is allowed to get, still a comfortable 3/4 view */
/* 76 (was 60). At 60 the flattest the board could ever look was 28 wide by
   27.2 deep — an aspect of 1.03 — so in a PORTRAIT box (phone, tablet held
   upright) the board ran out of height long before it ran out of box, and the
   leftover was bare page under the maze. Tipping further towards top-down
   takes the board to 0.93, which is most of that band reclaimed, and 76 still
   leaves enough of an angle for the walls to read as 3D. */
const CAMERA_TILT_MAX_DEG = 76;
/* Back to 44 — raising this to 54 last time over-corrected. It fixed the
   wall/pellet overlap, but it did it by shrinking the whole range of shapes
   the board can be drawn in (maxBoardAspect below, at 54°, is only 1.10
   instead of 1.27), and a lot of ordinary screens have a box shape that used
   to land inside that range and now falls outside it — board height-
   constrained, blank down the sides, on screens that used to fill perfectly.
   That is what "maze bht chota ho gaya" was: this constant, not the maze
   itself, on nearly every breakpoint at once.
   WALL_HEIGHT dropping from 0.62 to 0.50 (above) already does the whole job
   on its own: at 44° a 0.50-tall wall reaches about 0.98 units from its own
   centre, just inside the 1.0 to the next tile — so the overlap is gone
   without narrowing the tilt range, and the board is back to filling
   whatever shape its box actually is. */
const CAMERA_TILT_MIN_DEG = 44;

/* ---------- How far the board may be drawn out of its true shape ----------
   The maze grid is 28 cells across and 31 deep, so however the camera is
   tilted the board's drawn shape only ever runs between about 1.27 and 0.90
   wide-to-tall. Most screens' board boxes are not in that range, so the
   board runs out of shape long before it runs out of box, and what is left
   over is bare page — above/below it on a tall box, either side of it on a
   wide one. Tilting alone cannot reach it: fully top-down is 28/31 = 0.903,
   barely past where it already sits. The only thing that reaches it is
   drawing the board out of its true proportions, which means the cells stop
   being square. That is a real cost and it is why this is a CAP: everything
   in the scene stretches with it, Pac-Man's sphere included, so past a point
   the game reads as wrong rather than as tall or wide.
   Was raised and lowered a few times while this file's rotation and ad
   layout were being reworked (2.2 originally, down to 1.18 while chasing a
   portrait distortion bug that turned out to be the rotation itself, back up
   to 1.4, then 1.5). Real-device testing after each of those still showed a
   visible gap down one side of a landscape board — this cap, not the column
   it was given, was what stopped it closing. Restored to 2.2, the original,
   well-measured ceiling: it covers every reported real-device case with
   room to spare, and now that the page is never rotated the board is
   generally being asked to stretch much less than 2.2 allows anyway, since
   it starts from a box shaped like the actual screen rather than the screen
   turned on its side. Set it to 1 to turn the whole thing off and draw the
   board only in its true proportions, at the cost of visible empty margin
   on the screens that need more stretch than that to fill. */
const BOARD_STRETCH_MAX = 2.2;

/* The narrowest (tallest) the board can ever be drawn — the shape it takes at
   the top-down limit. Used to work out how much WIDTH the board needs before
   it can fill the height it has been given. */
function minBoardAspect() {
  const r = (CAMERA_TILT_MAX_DEG * Math.PI) / 180;
  return (cols * CELL) / (rows * CELL * Math.sin(r) + WALL_HEIGHT * Math.cos(r));
}

/* The board's WIDEST (flattest) shape — the one it takes at the top-down
   limit's opposite end, CAMERA_TILT_MIN_DEG. Between this and
   minBoardAspect() is the whole range of shapes the board can be drawn in;
   any box in that range gets the board fitted to it with NOTHING left
   over, on any edge. Used to find the smallest box height the board can
   fully fill, which is what tells the ad band how much room it may take
   without pushing the board off full width. */
function maxBoardAspect() {
  const r = (CAMERA_TILT_MIN_DEG * Math.PI) / 180;
  return (cols * CELL) / (rows * CELL * Math.sin(r) + WALL_HEIGHT * Math.cos(r));
}
let cameraTiltDeg = CAMERA_TILT_MAX_DEG;
/* How much taller than its true shape the board is currently being drawn.
   1 means not at all, which is every landscape screen. */
let boardStretchY = 1;
const camViewDir = new THREE.Vector3(0, 1, 0);
const worldUpV = new THREE.Vector3(0, 1, 0);

function setCameraTilt(deg) {
  const next = Math.max(CAMERA_TILT_MIN_DEG, Math.min(CAMERA_TILT_MAX_DEG, deg));
  const changed = Math.abs(next - cameraTiltDeg) > 0.01;
  cameraTiltDeg = next;
  const r = (cameraTiltDeg * Math.PI) / 180;
  camViewDir.set(0, Math.sin(r), Math.cos(r)).normalize();
  /* depthLift() is a function of this angle, and the pellets bake it in when
     the level is built — so if the angle moves, their baked-in offset is now
     the wrong one and they have to be laid out again. Pac-Man and the ghosts
     look theirs up every frame, so they need nothing here. */
  if (changed) refreshPelletDepth();
}

/* Which tilt makes the board come out the shape of the box it has to live in.
   Looking along the view direction the board measures `cols` across and
   `rows*sin(t) + WALL_HEIGHT*cos(t)` down, so the wanted angle falls out of
     cols / (rows*sin t + WALL_HEIGHT*cos t) = boxAspect
   solved as A*sin t + B*cos t = C. If the box is taller than wide (portrait
   tablet, phone) there is no angle that helps and it stays at the top-down
   limit, exactly as before. */
function tiltForAspect(boxAspect) {
  if (!(boxAspect > 0) || !isFinite(boxAspect)) return CAMERA_TILT_MAX_DEG;
  const A = rows * CELL;
  const B = WALL_HEIGHT;
  const C = (cols * CELL) / boxAspect;
  const R = Math.hypot(A, B);
  const ratio = C / R;
  if (ratio >= 1) return CAMERA_TILT_MAX_DEG;   // wants to be taller than possible
  if (ratio <= -1) return CAMERA_TILT_MIN_DEG;
  const phi = Math.atan2(B, A);
  return ((Math.asin(ratio) - phi) * 180) / Math.PI;
}

setCameraTilt(CAMERA_TILT_MAX_DEG);

/* ---------- Measuring in LAYOUT space ----------
   On a portrait phone the stylesheet rotates <html> by -90deg. Inside that
   rotation getBoundingClientRect() reports SCREEN coordinates, so an element's
   width and height come back THE OTHER WAY ROUND — but style.width and
   style.height are applied in layout space. The board was therefore being
   handed its own height as a width on every phone, which is why it came out
   the wrong shape with a band of empty page beside it.
   offsetWidth / offsetHeight are the element's own border box and an ancestor
   transform does not touch them, so all the box maths below uses those. */
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

/* The column's height as it would be with NO ad band reserved, worked out
   from numbers rather than by temporarily removing the band and measuring.
   The measuring version was correct but it MUTATED the live layout — set the
   band to zero, force a reflow, read, set it back — twice on every call, and
   every call happens inside a ResizeObserver. A browser is free to paint
   between those steps, and the intermediate state is a board at a completely
   different size. That is a real candidate for the screen flashing, and this
   removes it: the band is already known (it is the custom property this file
   set), so the un-reserved height is just the current height plus it back. */
/* ---------- Cancelling the height parallax ----------
   The camera looks down at an angle, so ANYTHING standing above the floor is
   drawn shifted up the screen relative to the floor tile it is actually on.
   Pac-Man is a sphere of radius 0.42 sitting ON the floor, so his centre is
   0.42 up — and at a 60-degree tilt that is a quarter of a tile of apparent
   shift towards the top of the screen. In a corridor exactly one tile wide,
   a quarter tile is the difference between running down the middle and
   looking glued to the wall above him. Same reason the pellets looked stuck
   to the blocks.
   Shifting him back down the board by height / tan(tilt) cancels it exactly:
   the projection maps a point (y = h, z) to h*cos(t) - z*sin(t), so adding
   h/tan(t) to z takes that straight back to the value a flat point at the
   tile centre would have. Purely visual — the collision grid never sees it. */
function depthLift(height) {
  const t = (cameraTiltDeg * Math.PI) / 180;
  const tan = Math.tan(t);
  return tan > 0.001 ? height / tan : 0;
}

/* ---------- ...and then centring in what the walls leave behind ----------
   depthLift() alone was not enough, and the reason is easy to miss: it puts
   an object's centre exactly where the CENTRE OF ITS TILE is on screen —
   which would be right if the tile were fully visible. It isn't.

   The same tilt that lifts Pac-Man also lifts the wall next to him. A wall's
   top face is drawn WALL_HEIGHT / tan(tilt) up the screen from its base, and
   that overhang covers the near edge of the corridor tile behind it. So the
   corridor you can actually see is not a full cell centred on the tile — it
   is (1 - overhang) of a cell, with the missing part all taken off one side.
   Its middle therefore sits half an overhang UP the screen from the tile's
   own middle.

   Measured on a 62-degree desktop view, that is about a seventh of a cell:
   enough that every pellet read as resting against the block below it rather
   than floating in the lane, and enough that Pac-Man looked glued to the
   wall he was running alongside instead of down the middle of the corridor.
   At the flattest tilt it is nearly a third of a cell.

   Subtracting half the wall's own lift moves everything into the middle of
   the gap that is really there. It is the same trick as depthLift, applied
   to the walls' effect instead of the object's own height, and it is purely
   visual — the collision grid still works in whole tiles and never sees it. */
function corridorLift(height) {
  return depthLift(height) - depthLift(WALL_HEIGHT / 2);
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

function disposeObject3D(obj) {
  obj.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
      else child.material.dispose();
    }
  });
}

function init3D() {
  /* Antialiasing only where the pixel ratio is not already doing the job:
     at 2x the buffer is supersampled and MSAA on top of it is close to
     invisible, while still costing a full multisampled colour buffer on
     every frame — which is real money on a board that now fills the screen.
     Read once here because a context's antialias setting is fixed for its
     lifetime. */
  const devicePR = Math.min(window.devicePixelRatio || 1, 2);
  renderer = new THREE.WebGLRenderer({ canvas, antialias: devicePR < 1.5 });
  renderer.setClearColor(0x0d2c52, 1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  scene = new THREE.Scene();
  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);

  // Soft sky/ground ambient wash so colors read nicely everywhere, even in shadow
  // Soft sky/ground ambient wash so colors read nicely everywhere, even in shadow
  const hemi = new THREE.HemisphereLight(0xcfe6ff, 0x14203a, 0.75);
  scene.add(hemi);

  const dirLight = new THREE.DirectionalLight(0xfff3d6, 1.05);
  /* Was (10, 26, 12) — enough sideways offset that a wall's shadow reached
     about 0.37 units past its own footprint on the floor, and the corridor
     tile next to a wall is only 0.5 away from the wall's centre. That put a
     dark cast shadow right across the pellet sitting in it — worse for the
     bigger power pellets, which is what "the dots go inside the wall" turned
     out to be: not a modelling error, a shadow reading as part of the block
     it's cast by, on the exact tile next to it.
     Cutting the sideways offset roughly in half keeps the light angled
     enough for the walls to still look modelled, not flat, while shortening
     that shadow to about 0.15 units — inside the wall's own contact-shadow
     patch, short of the neighbouring tile it used to reach into. */
  dirLight.position.set(5, 28, 6);
  dirLight.castShadow = true;
  /* 512, down from 1024. The map is a whole-scene render from the light's
     point of view, redone every frame, so this is a quarter of that work —
     and what it buys back is the resolution the board is drawn at, which is
     the thing actually visible. The cost is a slightly softer shadow edge. */
  dirLight.shadow.mapSize.set(512, 512);
  dirLight.shadow.camera.left = -22;
  dirLight.shadow.camera.right = 22;
  dirLight.shadow.camera.top = 22;
  dirLight.shadow.camera.bottom = -22;
  dirLight.shadow.camera.near = 1;
  dirLight.shadow.camera.far = 90;
  dirLight.shadow.bias = -0.0025;
  scene.add(dirLight);

  const fillLight = new THREE.DirectionalLight(0x9fc4ff, 0.35);
  fillLight.position.set(-14, 12, -10);
  scene.add(fillLight);

  const rimLight = new THREE.DirectionalLight(0xffe6c2, 0.25);
  rimLight.position.set(0, 8, -18);
  scene.add(rimLight);

  mazeGroup = new THREE.Group();
  scene.add(mazeGroup);
  ghostGroup = new THREE.Group();
  scene.add(ghostGroup);
  trailGroup = new THREE.Group();
  scene.add(trailGroup);
  popupGroup = new THREE.Group();
  scene.add(popupGroup);
  sparkleGroup = new THREE.Group();
  scene.add(sparkleGroup);

  pacman3D = buildPacmanMesh();
  pacman3D.traverse((o) => { o.castShadow = true; });
  scene.add(pacman3D);

  resize3D(true);
  fitCameraToBoard();
  window.addEventListener("resize", () => scheduleRailFit(false));

  /* ---------- WebGL context-loss safety net ----------
     The single most common cause of "suddenly a white screen appeared on
     the maze mid-game" on mobile: the browser/GPU reclaims or resets the
     WebGL drawing context. Triggers include switching tabs, the device
     going to sleep, memory pressure on the GPU, and on iOS Safari the
     context being lost whenever the page is backgrounded for more than a
     few seconds. When the context is lost the canvas is cleared by the
     browser — and on most mobile browsers it shows as a solid WHITE
     rectangle (the canvas backing store is initialised to opaque white
     on those platforms, not transparent).

     Without handlers, the context stays lost forever (or until reload)
     because three.js can't restore it on its own: the WebGL state, all
     the GPU-side buffers, textures and programs that the renderer built
     up over the level are gone, and only a full rebuild brings them
     back. The two listeners below do exactly that — prevent the default
     "lose the context permanently" on `webglcontextlost`, and on
     `webglcontextrestored` re-run the same rebuild path the level start
     uses, then force a redraw so the maze is back on screen within one
     frame of the context being handed back. */
  let contextLost = false;
  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault(); // allows restoration — without this the ctx is gone
    contextLost = true;
    // Pause the simulation clock so the first frame after restore does
    // not get charged for all the time the context was away (a multi-
    // second background could otherwise let Pac-Man or a ghost leap
    // several tiles trying to "catch up").
    lastTime = 0;
    updateAccumulator = 0;
    // Silence the siren — without the renderer running it would otherwise
    // keep buzzing against a frozen frame.
    stopGhostSiren();
  }, false);

  canvas.addEventListener("webglcontextrestored", () => {
    contextLost = false;
    // Re-seed the renderer's clear colour (it lives on the GL context
    // that was just rebuilt, not on the JS-side renderer object) and
    // rebuild every piece of geometry that was uploaded to the GPU.
    const theme = currentMazeTheme;
    const bgColor = new THREE.Color(theme.bg);
    renderer.setClearColor(bgColor, 1);
    scene.background = bgColor;
    scene.fog = new THREE.Fog(bgColor.getHex(), Math.max(cols, rows) * 1.3, Math.max(cols, rows) * 3.2);
    rebuildMazeVisual();
    buildGhostMeshes();
    if (pacman3D) scene.add(pacman3D); // re-attach; the old GPU resources
                                       // were freed by the loss, but the JS
                                       // wrapper is still valid
    resize3D(true);
    draw(); // immediate paint so the user never sees the white blank
  }, false);

  // Helper exposed for the loop: skip rendering while the context is
  // gone, so we don't keep throwing GL calls at a dead context.
  window.__webglContextLost = () => contextLost;
}

// Projects the maze's 3D bounding box into the camera's view plane and sizes
// the orthographic frustum so the whole board fills the frame edge-to-edge
// (expanding to match the canvas aspect ratio instead of leaving blank bars).
function fitCameraToBoard() {
  if (!camera) return;
  const mazeW = cols * CELL;
  const mazeD = rows * CELL;
  const halfW = mazeW / 2;
  const halfD = mazeD / 2;

  /* Step one: how wide and how tall is the space the board has been given.
     The tilt is chosen from that BEFORE anything is projected, so the board
     comes out the shape of its box and fills it, rather than being fitted
     into it afterwards and leaving whatever did not fit as empty background. */
  const boardBox = boardHostBox();
  if (boardBox.w > 0 && boardBox.h > 0) {
    setCameraTilt(tiltForAspect(boardBox.w / boardBox.h));
  }

  const right = new THREE.Vector3().crossVectors(camViewDir, worldUpV).normalize();
  const up = new THREE.Vector3().crossVectors(right, camViewDir).normalize();

  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  [-halfW, halfW].forEach((x) => {
    [0, WALL_HEIGHT].forEach((y) => {
      [-halfD, halfD].forEach((z) => {
        const p = new THREE.Vector3(x, y, z);
        const u = p.dot(right);
        const v = p.dot(up);
        if (u < minU) minU = u;
        if (u > maxU) maxU = u;
        if (v < minV) minV = v;
        if (v > maxV) maxV = v;
      });
    });
  });

  boardStretchY = 1;
  const centerU = (minU + maxU) / 2;
  const centerV = (minV + maxV) / 2;
  /* 1.0 = the maze fills the frame edge to edge. It used to be 1.06, which
     kept a 6% ring of empty floor all the way round the board — that was the
     blank margin inside the box. */
  const padding = 1.0;
  let halfWidthNeeded = ((maxU - minU) / 2) * padding;
  let halfHeightNeeded = ((maxV - minV) / 2) * padding;

  /* Size the CANVAS to the maze's own proportions in real pixels, rather than
     padding the maze out to whatever shape the box happens to be.
     A CSS aspect-ratio alone was not enough: the element is width:100% with a
     max-height, so as soon as the height cap bit, the width stayed at 100%,
     the ratio broke, and the leftover was filled with bare floor — that was
     the colour showing down the sides. Measuring the available box and
     setting an explicit width/height that fits inside it means the canvas
     ratio and the board ratio are identical, so there is nothing left to
     fill. */
  const boardAspect = (maxU - minU) / (maxV - minV);
  if (boardAspect > 0 && isFinite(boardAspect) && boardBox.w > 0 && boardBox.h > 0) {
    /* The largest the board fits at its TRUE shape — inscribed in the box,
       touching on one pair of edges and leaving a gap on the other. */
    let fitW = boardBox.w;
    let fitH = fitW / boardAspect;
    if (fitH > boardBox.h) {
      fitH = boardBox.h;
      fitW = fitH * boardAspect;
    }

    /* ...then out to the edges it was not touching. The gap is on the height
       in a portrait box (tablet held upright) and on the width in a landscape
       one (desktop, and a phone, which is turned a quarter turn and so is
       landscape too) — so this is worked out per axis rather than assumed.
       One of the two is always 1, because the fit above already touches that
       pair of edges. */
    if (BOARD_STRETCH_MAX > 1) {
      const sx = Math.min(boardBox.w / fitW, BOARD_STRETCH_MAX);
      const sy = Math.min(boardBox.h / fitH, BOARD_STRETCH_MAX);
      if (sx > 1.002 || sy > 1.002) {
        boardStretchY = Math.max(sx, sy);
        fitW *= sx;
        fitH *= sy;
      }
    }
    canvas.style.aspectRatio = "auto";
    canvas.style.width = Math.floor(fitW) + "px";
    canvas.style.height = Math.floor(fitH) + "px";
    canvas.style.maxWidth = "100%";
    canvas.style.maxHeight = "100%";
  }

  const rect = layoutSize(canvas);
  const aspect = rect.w && rect.h ? rect.w / rect.h : boardAspect;

  /* Expand the shorter side to match the canvas aspect ratio so the board
     (plus its surrounding floor) always fills the frame — no blank bars.
     Skipped when the canvas was deliberately made taller than the board
     above. This correction is the ONLY thing keeping the drawing
     undistorted: it hands the extra canvas to floor rather than to the
     board. Leaving the frustum at the board's own extents makes the
     viewport map them edge to edge instead, which is the stretch. */
  if (!(boardStretchY > 1.001)) {
    if (halfWidthNeeded / halfHeightNeeded < aspect) {
      halfWidthNeeded = halfHeightNeeded * aspect;
    } else {
      halfHeightNeeded = halfWidthNeeded / aspect;
    }
  }

  camera.left = -halfWidthNeeded;
  camera.right = halfWidthNeeded;
  camera.top = halfHeightNeeded;
  camera.bottom = -halfHeightNeeded;
  /* A tight depth range. The camera sits 60 units out and the board is about
     35 across along the view, so 0.1-200 was spending almost all of the depth
     buffer's precision on empty space either side of it. On a device with a
     16-bit depth buffer that is what turned a 0.02 gap between two surfaces
     into a coin toss — the shimmer/blink over the board. */
  camera.near = 15;
  camera.far = 115;

  const target = new THREE.Vector3()
    .addScaledVector(right, centerU)
    .addScaledVector(up, centerV);
  camera.position.copy(camViewDir).multiplyScalar(60).add(target);
  camera.lookAt(target);
  camera.updateProjectionMatrix();
}

function resize3D(force) {
  if (!renderer) return;
  const rect = layoutSize(canvas);
  const w = Math.max(1, Math.round(rect.w));
  const h = Math.max(1, Math.round(rect.h));
  if (!force && w === lastCanvasW && h === lastCanvasH) return;
  lastCanvasW = w;
  lastCanvasH = h;
  /* ---------- Full device resolution, paid for elsewhere ----------
     This used to cap the drawing buffer by AREA — 2.2 million pixels — and
     ease the pixel ratio down above it. That was aimed at the right problem
     (the board now fills its whole box, so the canvas roughly doubled) but
     it took the payment out of the wrong account. Measured on a 2x screen,
     the effective ratio it left was:
       1024x1366  1.30      853x1280  1.48
        912x1368  1.38      768x1024  1.75
     A ratio of 1.30 means the board is drawn at under half the screen's
     resolution and stretched back up — every wall edge, pellet and ghost
     soft. That is the blur, and it is much more noticeable than the shadow
     detail below.
     So resolution is kept at the device's own, and the per-pixel cost comes
     down instead. A shadow map is a fixed-size render of the whole scene
     from the light, redone every frame, and dropping it from 1024 to 512
     quarters that work while changing only how crisp a shadow's edge is —
     which on a board this size is a few pixels of softness under Pac-Man
     that nobody is looking at. Antialiasing goes the same way once the
     ratio is 2: the buffer is already supersampled at that point and MSAA
     on top of it is close to invisible, so it is only asked for when the
     ratio is low enough to need it.
     Both are decided ONCE, at renderer creation, not here — a WebGL context
     cannot change its antialias setting afterwards, and re-sizing a shadow
     map every resize would thrash the GPU.

     The area ceiling stays, but raised and with a FLOOR under it. The old
     2.2M had no floor, which is how it reached 1.30 — it would have gone on
     dropping. 3.6M with a floor of 1.5 means the softest any board can get
     is three quarters of the screen's resolution instead of under half, and
     because each of those pixels is now much cheaper to shade the total
     comes out close to what the old ceiling cost. Effective ratio by
     screen, old -> new: 1024x1366 1.30 -> 1.66, 912x1368 1.38 -> 1.76,
     853x1280 1.48 -> 1.89, 768x1024 1.75 -> 2.00 (full). */
  const MAX_DRAW_PIXELS = 3.6e6;
  const MIN_RATIO = 1.5;
  const devicePixels = Math.min(window.devicePixelRatio || 1, 2);
  const area = w * h;
  const byArea = area > 0 ? Math.sqrt(MAX_DRAW_PIXELS / area) : devicePixels;
  renderer.setPixelRatio(
    Math.min(devicePixels, Math.max(MIN_RATIO, byArea))
  );
  renderer.setSize(w, h, false);
  fitCameraToBoard();
}

// ===================== MAZE / WALLS / PELLETS =====================
function rebuildMazeVisual() {
  if (!mazeGroup) return;
  while (mazeGroup.children.length) {
    disposeObject3D(mazeGroup.children.pop());
  }
  pelletRegistry.clear();
  pelletInstMesh = null;
  powerInstMesh = null;

  const theme = currentMazeTheme;
  const bgColor = new THREE.Color(theme.bg);
  renderer.setClearColor(bgColor, 1);
  scene.background = bgColor;
  scene.fog = new THREE.Fog(bgColor.getHex(), Math.max(cols, rows) * 1.3, Math.max(cols, rows) * 3.2);

  // Outer floor: generously oversized and a touch darker than the board, so
  // there's always a themed surface filling the frame — never blank canvas.
  const outerColor = bgColor.clone().multiplyScalar(0.72);
  const outerGeo = new THREE.PlaneGeometry(cols * CELL * 3, rows * CELL * 3);
  const outerMat = new THREE.MeshStandardMaterial({ color: outerColor, roughness: 1, metalness: 0 });
  const outerFloor = new THREE.Mesh(outerGeo, outerMat);
  outerFloor.rotation.x = -Math.PI / 2;
  /* -0.12, not -0.02. Two full-size floor planes 0.02 apart, seen almost
     straight down, is a coplanar pair as far as a mobile depth buffer is
     concerned — the two swap which one is in front from frame to frame and
     the board flickers. It is out of sight under the board floor either way,
     so the gap costs nothing. */
  outerFloor.position.y = -0.12;
  outerFloor.receiveShadow = true;
  mazeGroup.add(outerFloor);

  // Board floor
  const floorGeo = new THREE.PlaneGeometry(cols * CELL, rows * CELL);
  const floorMat = new THREE.MeshStandardMaterial({ color: theme.bg, roughness: 0.9, metalness: 0.04 });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  mazeGroup.add(floor);

  // Walls (instanced boxes with height, so the maze reads as real 3D geometry)
  // Wall cells that fall INSIDE the cosmetic ghost house box are skipped:
  // the box has its own themed rails around its footprint (see
  // buildGhostHousePen3D), and leftover wall blocks sticking up inside that
  // frame read as misplaced cubes rather than as part of the pen. The map
  // data is unchanged — Pac-Man still cannot enter the pen (the
  // isWall()/inGhostHouseBox() checks in the movement code are independent of
  // what gets drawn) — only the visual is cleaned up. inGhostHouseBox takes
  // (col, row) = (c, r) argument order.
  const wallCells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (map[r][c] === 1 && !inGhostHouseVisualBox(c, r)) wallCells.push([r, c]);
    }
  }
  /* ---------- Walls ----------
     One block per wall cell, at 0.92 of a cell so the gaps between them read
     as mortar lines. Merging them into long slabs with bevelled caps was
     tried and looked wrong — it stopped reading as Pac-Man — so the SHAPE is
     left exactly as it was and the depth comes from shading instead.
     Each block carries a baked top-to-bottom gradient in its vertex colours:
     the top face is lifted, the side faces fall away towards the floor. That
     is what a real bevel would do to the light, without changing a single
     silhouette, and it costs nothing at render time. */
  const wallGeo = new THREE.BoxGeometry(CELL * 0.92, WALL_HEIGHT, CELL * 0.92);
  const pos = wallGeo.attributes.position;
  const shade = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    // y runs -H/2 (floor) to +H/2 (top); 0 at the base, 1 at the cap
    const t = pos.getY(i) / WALL_HEIGHT + 0.5;
    const v = 0.72 + t * 0.42;          // 0.72 in the shade, 1.14 in the light
    shade[i * 3] = shade[i * 3 + 1] = shade[i * 3 + 2] = v;
  }
  wallGeo.setAttribute("color", new THREE.BufferAttribute(shade, 3));

  const wallMat = new THREE.MeshStandardMaterial({
    color: theme.wall,
    vertexColors: true,
    roughness: 0.44,
    metalness: 0.22,
    emissive: theme.stroke,
    emissiveIntensity: 0.08,
  });
  const wallInst = new THREE.InstancedMesh(wallGeo, wallMat, Math.max(wallCells.length, 1));
  wallCells.forEach(([r, c], i) => {
    dummyObj3D.position.set(worldX(c), WALL_HEIGHT / 2, worldZ(r));
    dummyObj3D.scale.set(1, 1, 1);
    dummyObj3D.updateMatrix();
    wallInst.setMatrixAt(i, dummyObj3D.matrix);
  });
  wallInst.count = wallCells.length;
  wallInst.castShadow = true;
  wallInst.receiveShadow = true;
  mazeGroup.add(wallInst);

  /* A soft dark patch on the floor under each block. Blocks were sitting ON
     the floor without meeting it — nothing tied them down, which is what made
     them look like flat tiles printed on the board rather than objects
     standing on it. This is the contact shadow that does the tying.
     1.06, not 1.16: at 1.16 the patch reached 0.08 units into the path tile
     next door, which is close enough to a pellet sitting there (pellets sit
     at the tile centre, 0.5 from the wall) to shade its near edge — one more
     small piece of "the dot looks like it's touching the wall". 1.06 still
     reaches past the block's own edge enough to read as contact, short of
     the neighbouring tile. */
  const aoGeo = new THREE.PlaneGeometry(CELL * 1.06, CELL * 1.06);
  aoGeo.rotateX(-Math.PI / 2);
  const aoMat = new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    /* Pushed towards the camera in the depth test rather than lifted in the
       world, so the patch is never in a tie with the floor it sits on. */
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const aoInst = new THREE.InstancedMesh(aoGeo, aoMat, Math.max(wallCells.length, 1));
  wallCells.forEach(([r, c], i) => {
    dummyObj3D.position.set(worldX(c), 0.012, worldZ(r));
    dummyObj3D.scale.set(1, 1, 1);
    dummyObj3D.updateMatrix();
    aoInst.setMatrixAt(i, dummyObj3D.matrix);
  });
  aoInst.count = wallCells.length;
  aoInst.renderOrder = -1;
  mazeGroup.add(aoInst);

  // Thin rim outline on top of each wall in the theme's accent color
  const rimGeo = new THREE.BoxGeometry(CELL * 0.96, 0.04, CELL * 0.96);
  const rimMat = new THREE.MeshBasicMaterial({ color: theme.stroke, transparent: true, opacity: 0.55 });
  const rimInst = new THREE.InstancedMesh(rimGeo, rimMat, Math.max(wallCells.length, 1));
  wallCells.forEach(([r, c], i) => {
    dummyObj3D.position.set(worldX(c), WALL_HEIGHT + 0.02, worldZ(r));
    dummyObj3D.scale.set(1, 1, 1);
    dummyObj3D.updateMatrix();
    rimInst.setMatrixAt(i, dummyObj3D.matrix);
  });
  rimInst.count = wallCells.length;
  mazeGroup.add(rimInst);

  // Pellets + power pellets
  pelletCellList = [];
  powerCellList = [];
  const pelletCells = pelletCellList;
  const powerCells = powerCellList;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (map[r][c] === 2) pelletCells.push([r, c]);
      else if (map[r][c] === 3) powerCells.push([r, c]);
    }
  }

  const pelletGeo = new THREE.SphereGeometry(0.075, 8, 8);
  const pelletMat = new THREE.MeshStandardMaterial({ color: 0xffd966, emissive: 0xffd966, emissiveIntensity: 0.5 });
  pelletInstMesh = new THREE.InstancedMesh(pelletGeo, pelletMat, Math.max(pelletCells.length, 1));
  pelletCells.forEach(([r, c], i) => {
    dummyObj3D.position.set(worldX(c), PELLET_Y, worldZ(r) + corridorLift(PELLET_Y));
    dummyObj3D.scale.set(1, 1, 1);
    dummyObj3D.updateMatrix();
    pelletInstMesh.setMatrixAt(i, dummyObj3D.matrix);
    pelletRegistry.set(r + "," + c, { mesh: pelletInstMesh, index: i, power: false });
  });
  pelletInstMesh.count = pelletCells.length;
  mazeGroup.add(pelletInstMesh);

  const powerGeo = new THREE.SphereGeometry(0.17, 12, 12);
  const powerMat = new THREE.MeshStandardMaterial({ color: 0xffd966, emissive: 0xffd966, emissiveIntensity: 0.85 });
  powerInstMesh = new THREE.InstancedMesh(powerGeo, powerMat, Math.max(powerCells.length, 1));
  powerCells.forEach(([r, c], i) => {
    dummyObj3D.position.set(worldX(c), POWER_PELLET_Y, worldZ(r) + corridorLift(POWER_PELLET_Y));
    dummyObj3D.scale.set(1, 1, 1);
    dummyObj3D.updateMatrix();
    powerInstMesh.setMatrixAt(i, dummyObj3D.matrix);
    pelletRegistry.set(r + "," + c, { mesh: powerInstMesh, index: i, power: true });
  });
  powerInstMesh.count = powerCells.length;
  mazeGroup.add(powerInstMesh);

  buildGhostHousePen3D();
  fitCameraToBoard();
}

function hidePelletVisual(row, col) {
  const entry = pelletRegistry.get(row + "," + col);
  if (!entry) return;
  dummyObj3D.position.set(0, -50, 0);
  dummyObj3D.scale.set(0.0001, 0.0001, 0.0001);
  dummyObj3D.updateMatrix();
  entry.mesh.setMatrixAt(entry.index, dummyObj3D.matrix);
  entry.mesh.instanceMatrix.needsUpdate = true;
}

function animatePowerPellets3D() {
  if (!powerInstMesh) return;
  const pulse = 0.85 + 0.25 * Math.sin(gameTime * 4);
  let changed = false;
  pelletRegistry.forEach((entry, key) => {
    if (!entry.power) return;
    const parts = key.split(",");
    const r = Number(parts[0]);
    const c = Number(parts[1]);
    if (!map[r] || map[r][c] !== 3) return; // already eaten — stays hidden
    dummyObj3D.position.set(worldX(c), POWER_PELLET_Y, worldZ(r) + corridorLift(POWER_PELLET_Y));
    dummyObj3D.scale.set(pulse, pulse, pulse);
    dummyObj3D.updateMatrix();
    entry.mesh.setMatrixAt(entry.index, dummyObj3D.matrix);
    changed = true;
  });
  if (changed) powerInstMesh.instanceMatrix.needsUpdate = true;
}

/* ---------- The ghost pen ----------
   WHAT WAS HERE, AND WHY IT WENT.
   The pen used to be drawn as three things stacked on the floor: a
   translucent PLANE (pale pink #ffb8de at 10% opacity), a thin outline
   around it, and a dashed line for the gate. Over a board this dark, a 10%
   pale wash does not read as a tint — it reads as a washed-out WHITE
   rectangle sitting in the middle of the maze, and the 1px outline on top of
   it reads as a grey scratch around that rectangle. That is the white patch
   in the centre of the board: not a WebGL fault, not a z-fighting flicker,
   just a decoration whose colour and opacity made it look like one. Three
   more reasons it had to go rather than be recoloured:
     - It was drawn from box.left/right/top/bottom, which are COSMETIC bounds
       that do not match the map. box.right is column 15 and box.bottom is
       row 15, both of which are solid WALL in the layout, so the plane and
       the outline ran straight through wall blocks.
     - The gate ran the full width of the box (gateLeft 12 = box.left,
       gateRight 15 = box.right), so the two "solid" top segments either side
       of it were zero-length and the entire top edge was dashed.
     - LineBasicMaterial ignores linewidth in WebGL, so none of it could be
       made heavier enough to read as deliberate.
   What replaces it is ONE solid piece of geometry: the gate, a low bar in
   the maze theme's accent colour across the pen's actual doorway, measured
   from the map rather than assumed. Themed, obviously intentional, and it is
   the only part of the pen a player needs to see — the walls around the pen
   are already in the layout.
   The pen's FOOTPRINT is untouched: getGhostHouseBoxForLevel() and
   inGhostHouseBox() are unchanged, so Pac-Man is still kept out of the pen
   and the ghosts still leave it exactly the way they did before. */
function buildGhostHousePen3D() {
  const box = getGhostHouseBoxForLevel(currentLevel);
  const theme = currentMazeTheme;

  // The doorway is the run of non-wall tiles along the pen's top row, read
  // out of the map so the bar can never be drawn across a wall block.
  const row = box.top;
  if (!map[row]) return;
  let first = -1;
  let last = -1;
  for (let c = box.left; c <= box.right; c++) {
    if (map[row][c] !== 1) {
      if (first === -1) first = c;
      last = c;
    }
  }
  if (first === -1) return;

  const xLeft = worldX(first) - CELL / 2;
  const xRight = worldX(last) + CELL / 2;
  const z = worldZ(row) - CELL / 2;

  // Low enough to read as a way out rather than as a fourth wall, and well
  // under WALL_HEIGHT so it never blocks the view into the pen.
  const GATE_H = WALL_HEIGHT * 0.34;
  const GATE_T = CELL * 0.16;

  const gateMat = new THREE.MeshStandardMaterial({
    color: theme.stroke,
    roughness: 0.5,
    metalness: 0.1,
    emissive: theme.stroke,
    emissiveIntensity: 0.3,
  });
  const gate = new THREE.Mesh(
    new THREE.BoxGeometry(xRight - xLeft, GATE_H, GATE_T),
    gateMat
  );
  gate.position.set((xLeft + xRight) / 2, GATE_H / 2, z);
  gate.receiveShadow = true;
  mazeGroup.add(gate);

  /* ---------- Four-sided frame around the ghost house ----------
     The gate above marks the doorway, but the rest of the pen's outline is
     invisible — the floor under it is the same colour as the corridors, so
     there was nothing to tell the player "this rectangle is where ghosts
     live". A thin themed rail along each of the four sides makes the
     footprint read as a box at a glance. The rails sit at floor level and
     stay well below WALL_HEIGHT so they never obscure anything inside the
     pen. */
  // The rails are drawn a cell wider on each side than the gameplay box
  // (box.left/right, used above for the gate scan and unchanged, still
  // governs where Pac-Man is kept out) — see GHOST_HOUSE_VISUAL_PAD_X,
  // which is also what the wall-skip loop above uses so no wall block is
  // left standing inside this wider outline. Purely a visual stretch, so
  // the pen reads as a wide rectangle — the classic ghost-house shape —
  // rather than the near-square footprint the collision box alone gives it.
  const railLeft = box.left - GHOST_HOUSE_VISUAL_PAD_X;
  const railRight = box.right + GHOST_HOUSE_VISUAL_PAD_X;
  const boxXMin = worldX(railLeft) - CELL / 2;
  const boxXMax = worldX(railRight) + CELL / 2;
  const boxZMin = worldZ(box.top) - CELL / 2;
  const boxZMax = worldZ(box.bottom) + CELL / 2;
  const boxWidth = boxXMax - boxXMin;
  const boxDepth = boxZMax - boxZMin;

  const RAIL_H = WALL_HEIGHT * 0.18;   // shorter than the gate, just a line
  const RAIL_T = CELL * 0.10;           // thin enough to read as a line, not a wall
  const RAIL_Y = RAIL_H / 2;

  const railMat = new THREE.MeshStandardMaterial({
    color: theme.stroke,
    roughness: 0.4,
    metalness: 0.2,
    emissive: theme.stroke,
    emissiveIntensity: 0.55,
  });

  // Top rail — drawn behind the gate (the gate sits in front of it on z).
  // The gate reads as the door cut into this top rail.
  const topRail = new THREE.Mesh(
    new THREE.BoxGeometry(boxWidth, RAIL_H, RAIL_T),
    railMat
  );
  topRail.position.set((boxXMin + boxXMax) / 2, RAIL_Y, boxZMin);
  topRail.receiveShadow = true;
  mazeGroup.add(topRail);

  // Bottom rail.
  const bottomRail = new THREE.Mesh(
    new THREE.BoxGeometry(boxWidth, RAIL_H, RAIL_T),
    railMat
  );
  bottomRail.position.set((boxXMin + boxXMax) / 2, RAIL_Y, boxZMax);
  bottomRail.receiveShadow = true;
  mazeGroup.add(bottomRail);

  // Left rail.
  const leftRail = new THREE.Mesh(
    new THREE.BoxGeometry(RAIL_T, RAIL_H, boxDepth),
    railMat
  );
  leftRail.position.set(boxXMin, RAIL_Y, (boxZMin + boxZMax) / 2);
  leftRail.receiveShadow = true;
  mazeGroup.add(leftRail);

  // Right rail.
  const rightRail = new THREE.Mesh(
    new THREE.BoxGeometry(RAIL_T, RAIL_H, boxDepth),
    railMat
  );
  rightRail.position.set(boxXMax, RAIL_Y, (boxZMin + boxZMax) / 2);
  rightRail.receiveShadow = true;
  mazeGroup.add(rightRail);
}

/* ===================== PAC-MAN =====================
   Built as a real character, the same way the ghosts are. Three things were
   wrong with the old one:
     1. It was a hollow sphere-with-a-slice-taken-out drawn DoubleSide, so you
        looked straight through the mouth and saw the inside of the head.
     2. The slice was centred on -X, but facing 0 means travelling +X — so the
        mouth opened out of the BACK of his head, and the pellets went in
        behind him.
     3. There were no eyes at all, which is why he read as a yellow blob next
        to ghosts that have eyes, pupils and a proper silhouette.
   Now: a solid head, two flat jaw faces closing the mouth cavity so the bite
   has an inside, and eyes with pupils that look the way he is travelling. */
let pacman3D = null;

/* 0.30, was 0.42. Sized to the visible corridor rather than to the tile —
   see the long note on WALL_HEIGHT. A sphere's silhouette is 2R at every
   camera angle, so this is the one number that decides whether he sits IN
   the lane or across it. Ghost meshes are scaled to match (GHOST_SCALE), or
   they would tower over him. */
const PAC_R = 0.3;
const PAC_MOUTH_MIN = 0.17;    // half-angle of the bite at its most closed
const PAC_MOUTH_MAX = 0.86;    // ...and at its widest (radians). A big bite:
                               // seen from a camera this far over, a narrow
                               // wedge is only a notch in the silhouette.
const PAC_MOUTH_STEPS = 20;    // how many distinct mouth positions

/* One geometry per mouth position, built the first time it is asked for and
   then reused forever. The old code built a brand new SphereGeometry EVERY
   FRAME and threw the last one away — 60 buffer allocations a second for what
   is really a handful of shapes. */
const pacBodyGeos = [];
function pacMouthAngle(step) {
  return PAC_MOUTH_MIN + (PAC_MOUTH_MAX - PAC_MOUTH_MIN) * (step / (PAC_MOUTH_STEPS - 1));
}
function pacBodyGeo(step) {
  if (!pacBodyGeos[step]) {
    const m = pacMouthAngle(step);
    /* phi = PI is the +X side of the sphere, so starting at PI + m and running
       2PI - 2m leaves the wedge missing from the FRONT of the head, centred
       exactly on the direction he is facing. */
    pacBodyGeos[step] = new THREE.SphereGeometry(PAC_R, 30, 22, Math.PI + m, Math.PI * 2 - m * 2, 0, Math.PI);
  }
  return pacBodyGeos[step];
}

function buildPacmanMesh() {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: currentPacmanColor, roughness: 0.32, metalness: 0.04 });
  const body = new THREE.Mesh(pacBodyGeo(PAC_MOUTH_STEPS - 1), mat);
  group.add(body);

  /* The two cut faces of the wedge. Each is a half-disc through the centre of
     the head, swung open and shut with the jaw, so the mouth is a cavity with
     an inside instead of a hole. */
  const mouthMat = new THREE.MeshStandardMaterial({ color: 0x8a3f1c, roughness: 0.8, metalness: 0, side: THREE.DoubleSide });
  const jawGeo = new THREE.CircleGeometry(PAC_R, 24, -Math.PI / 2, Math.PI);
  const jawA = new THREE.Mesh(jawGeo, mouthMat);
  const jawB = new THREE.Mesh(jawGeo, mouthMat);
  group.add(jawA, jawB);

  /* ---------- The face is on a turntable of its own ----------
     The eyes used to be bolted to the head, on the same side as the mouth.
     That is fine for exactly one direction: coming DOWN the screen he faces
     the camera and you see both eyes and the bite. Going up, both eyes are
     round the back and you are looking at a bare yellow ball; going left or
     right you get one eye and a slot.
     They now live in a group that is counter-rotated every frame by the same
     amount the body is turned, so its net rotation in the world is always
     zero and the face is always pointed at the camera — the way it looks
     coming down the screen is the way it looks in all four directions. The
     BODY still turns, so the bite still opens the way he is travelling. */
  const face = new THREE.Group();
  group.add(face);

  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.22, metalness: 0 });
  const pupilMat = new THREE.MeshStandardMaterial({ color: 0x18213c, roughness: 0.18, metalness: 0 });
  const eyeGeo = new THREE.SphereGeometry(0.1, 14, 12);
  const pupilGeo = new THREE.SphereGeometry(0.052, 10, 8);
  const pupils = [];
  [-1, 1].forEach((side) => {
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(0.225 * side, 0.285, 0.14);
    const pupil = new THREE.Mesh(pupilGeo, pupilMat);
    pupil.position.set(0.235 * side, 0.3, 0.175);
    pupil.userData.home = pupil.position.clone();
    face.add(eye, pupil);
    pupils.push(pupil);
  });

  group.userData = { body, mat, jawA, jawB, face, pupils, facing: 0, step: -1 };
  return group;
}

function updatePacman3D() {
  const px = worldX(pacman.x);
  const pz = worldZ(pacman.y);
  pacman3D.position.set(px, PAC_R, pz + corridorLift(PAC_R));

  const ud = pacman3D.userData;
  let facing = ud.facing;
  if (pacman.dirX === 1) facing = 0;
  else if (pacman.dirX === -1) facing = Math.PI;
  else if (pacman.dirY === 1) facing = Math.PI / 2;
  else if (pacman.dirY === -1) facing = -Math.PI / 2;
  ud.facing = facing;
  pacman3D.rotation.y = -facing;

  /* He only chomps while he is actually travelling. A stopped Pac-Man opening
     and shutting his mouth at nothing looked wrong; stopped, he just closes
     it. The angle is quantised to one of the cached shapes, and the geometry
     is only swapped when that number changes. */
  const moving = pacman.dirX !== 0 || pacman.dirY !== 0;
  const chomp = moving ? 0.5 + 0.5 * Math.sin(gameTime * 16) : 0;
  const step = Math.round(chomp * (PAC_MOUTH_STEPS - 1));
  if (step !== ud.step) {
    ud.step = step;
    ud.body.geometry = pacBodyGeo(step);
    const m = pacMouthAngle(step);
    ud.jawA.rotation.y = m;
    ud.jawB.rotation.y = -m;
  }

  /* Undo the body's turn so the face keeps pointing at the camera. */
  ud.face.rotation.y = facing;

  /* The glance is the one thing that still shows the direction, and because
     the face is unrotated its axes are the screen's: x is across, z is up
     and down the board. */
  ud.pupils.forEach((p) => {
    p.position.copy(p.userData.home);
    p.position.x += pacman.dirX * 0.025;
    p.position.z += pacman.dirY * 0.02;
  });

  ud.mat.color.set(currentPacmanColor);
  if (currentEffect === "glow") {
    ud.mat.emissive.set(currentPacmanColor);
    ud.mat.emissiveIntensity = 0.7;
  } else {
    ud.mat.emissiveIntensity = 0;
  }

  if (currentEffect === "trail") {
    updatePacmanTrail3D(px, pz);
  } else if (trailGroup.children.length) {
    while (trailGroup.children.length) disposeObject3D(trailGroup.children.pop());
    pacmanTrail = [];
  }
}

function updatePacmanTrail3D(px, pz) {
  const now = performance.now();
  pacmanTrail.push({ x: px, z: pz, createdAt: now });
  if (pacmanTrail.length > 14) pacmanTrail.shift();

  while (trailGroup.children.length < pacmanTrail.length) {
    const mat = new THREE.MeshBasicMaterial({ color: currentPacmanColor, transparent: true, opacity: 0.3 });
    trailGroup.add(new THREE.Mesh(trailPelletGeo, mat));
  }
  while (trailGroup.children.length > pacmanTrail.length) {
    disposeObject3D(trailGroup.children.pop());
  }
  pacmanTrail.forEach((t, i) => {
    const age = (now - t.createdAt) / 400;
    const mesh = trailGroup.children[i];
    if (!mesh) return;
    mesh.position.set(t.x, 0.3, t.z);
    mesh.material.opacity = Math.max(0, 0.35 * (1 - age));
    const s = Math.max(0.15, 0.5 * (1 - age * 0.4));
    mesh.scale.set(s, s, s);
  });
}

// ===================== GHOSTS =====================
/* Ghosts are modelled a full cell tall and 0.8 wide, which was in proportion
   with the old 0.42-radius Pac-Man. He is 0.30 now (see PAC_R), so without
   this they would stand a third taller and wider than him — and, like him,
   they would sit across the visible corridor instead of in it. Scaling the
   whole group keeps the model itself untouched. */
const GHOST_SCALE = 0.75;

function buildGhostMesh(color) {
  const group = new THREE.Group();
  group.scale.setScalar(GHOST_SCALE);
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.05 });

  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.4, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), bodyMat);
  dome.position.y = 0.15;
  group.add(dome);

  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.5, 16, 1, true), bodyMat);
  torso.position.y = -0.1;
  group.add(torso);

  const teeth = [];
  const teethCount = 6;
  for (let i = 0; i < teethCount; i++) {
    const ang = (i / teethCount) * Math.PI * 2;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.135, 0.18, 8), bodyMat);
    cone.position.set(Math.cos(ang) * 0.38, -0.36, Math.sin(ang) * 0.38);
    cone.rotation.x = Math.PI;
    group.add(cone);
    teeth.push(cone);
  }

  const eyeGeo = new THREE.SphereGeometry(0.11, 10, 8);
  const pupilGeo = new THREE.SphereGeometry(0.055, 8, 6);
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const pupilMat = new THREE.MeshStandardMaterial({ color: 0x1c3fd6 });
  const leftEye = new THREE.Mesh(eyeGeo, eyeMat); leftEye.position.set(-0.15, 0.22, 0.28);
  const rightEye = new THREE.Mesh(eyeGeo, eyeMat); rightEye.position.set(0.15, 0.22, 0.28);
  const leftPupil = new THREE.Mesh(pupilGeo, pupilMat); leftPupil.position.set(-0.15, 0.22, 0.34);
  const rightPupil = new THREE.Mesh(pupilGeo, pupilMat); rightPupil.position.set(0.15, 0.22, 0.34);
  group.add(leftEye, rightEye, leftPupil, rightPupil);

  group.userData = { dome, torso, teeth, bodyMat, eyeMat, leftEye, rightEye, leftPupil, rightPupil };
  return group;
}

function buildGhostMeshes() {
  if (!ghostGroup) return;
  while (ghostGroup.children.length) {
    disposeObject3D(ghostGroup.children.pop());
  }
  ghosts.forEach((ghost) => {
    const mesh = buildGhostMesh(ghost.color);
    mesh.traverse((o) => { o.castShadow = true; });
    ghost._mesh = mesh;
    ghostGroup.add(mesh);
  });
}

function updateGhost3D(ghost) {
  const mesh = ghost._mesh;
  if (!mesh) return;
  const gx = worldX(ghost.x);
  const gz = worldZ(ghost.y);
  mesh.position.set(gx, 0.34, gz + corridorLift(0.34));

  const ud = mesh.userData;
  const showBody = !ghost.eaten;
  ud.dome.visible = showBody;
  ud.torso.visible = showBody;
  ud.teeth.forEach((t) => { t.visible = showBody; });

  let bodyColor = ghost.color;
  if (ghost.frightened) {
    const msLeft = frightenedEndsAt - simNow;
    const flashing = msLeft < 3000 && Math.floor(performance.now() / 200) % 2 === 0;
    bodyColor = flashing ? "#ffffff" : "#2b55ff";
  }
  ud.bodyMat.color.set(bodyColor);

  const eyeColor = ghost.frightened && !ghost.eaten ? "#ffe6a8" : "#ffffff";
  ud.eyeMat.color.set(eyeColor);

  const lookX = ghost.dirX * 0.05;
  const lookZ = ghost.dirY * 0.05;
  ud.leftPupil.position.set(-0.15 + lookX, 0.22, 0.34 + lookZ);
  ud.rightPupil.position.set(0.15 + lookX, 0.22, 0.34 + lookZ);
}

// ===================== SCORE POPUPS =====================
const SCORE_POPUP_DURATION_MS = 800;

function makeTextSprite(text, color) {
  const c = document.createElement("canvas");
  c.width = 220;
  c.height = 110;
  const c2 = c.getContext("2d");
  /* Same family as everything in the DOM. This used to name Segoe UI,
     which is a Windows-only face — so the floating score numbers were the
     one piece of type in the game that changed typeface per machine. The
     stack mirrors --font in style.css. */
  c2.font = "bold 64px Inter, sans-serif";
  c2.textAlign = "center";
  c2.textBaseline = "middle";
  c2.lineWidth = 10;
  c2.strokeStyle = "rgba(20, 20, 40, 0.9)";
  c2.strokeText(text, 110, 58);
  c2.fillStyle = color;
  c2.fillText(text, 110, 58);
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(3.0, 1.5, 1);
  return sprite;
}

function updateScorePopups3D() {
  const now = performance.now();
  const kept = [];
  scorePopups.forEach((p) => {
    const age = now - p.createdAt;
    if (age >= SCORE_POPUP_DURATION_MS) {
      if (p._sprite) {
        popupGroup.remove(p._sprite);
        p._sprite.material.map.dispose();
        p._sprite.material.dispose();
      }
      return;
    }
    if (!p._sprite) {
      p._sprite = makeTextSprite(p.text, "#ffe066");
      popupGroup.add(p._sprite);
    }
    const t = age / SCORE_POPUP_DURATION_MS;
    p._sprite.position.set(worldX(p.x), 1.3 + t * 1.3, worldZ(p.y));
    p._sprite.material.opacity = Math.max(0, 1 - t);
    kept.push(p);
  });
  scorePopups = kept;
}

// ===================== SPARKLE EFFECT =====================
function updateSparkles3D() {
  const now = performance.now();
  const kept = [];
  sparkleParticles.forEach((p) => {
    const age = now - p.createdAt;
    if (age >= 500) {
      if (p._mesh) disposeObject3D(p._mesh), sparkleGroup.remove(p._mesh);
      return;
    }
    if (!p._mesh) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 1 });
      p._mesh = new THREE.Mesh(sparkleGeo, mat);
      sparkleGroup.add(p._mesh);
    }
    const t = age / 500;
    p._mesh.position.set(worldX(p.x + p.vx * t), 0.3, worldZ(p.y + p.vy * t));
    p._mesh.material.opacity = Math.max(0, 1 - t);
    const s = Math.max(0.2, 1 - t);
    p._mesh.scale.set(s, s, s);
    kept.push(p);
  });
  sparkleParticles = kept;
  if (!sparkleParticles.length) {
    // nothing left to animate this frame
  }
}

/* ---------- Why the actors are drawn twice ----------
   corridorLift() (further up) puts Pac-Man's CENTRE in the middle of the
   visible lane, and for the pellets that was the whole fix — a pellet is
   small enough to fit inside the gap the walls leave.

   Pac-Man is not. He is a sphere 0.84 units across, and at the flattest
   camera angle the visible lane is about 0.59 of a cell: he is comfortably
   taller than the slot he has to sit in, so he overlaps a wall at both ends.
   That on its own would be fine and symmetrical — except the two overlaps
   are not treated the same by the depth buffer. The wall BELOW him is nearer
   the camera, so it is drawn in front and eats his bottom; the wall ABOVE is
   further away, so he is drawn in front of it and keeps his top. The result
   is a dome with a flat-cut bottom, sitting high in the lane and looking
   welded to the wall beside him — which is what stayed wrong after the
   centring fix, and why "abhi bhi box ke saath chipak ke jaata hai".

   Making him smaller would fix it arithmetically and ruin him: he would have
   to drop to about a 0.4-cell ball to fit. So instead the depth buffer is
   cleared after the maze is drawn and the actors are drawn again on top.
   They are then never clipped by a wall, their full round silhouette shows,
   and because that silhouette is already centred by corridorLift() they read
   as running down the middle of the lane exactly like the pellets do.
   Ghosts get the same treatment for the same reason and to keep the two
   looking consistent; between themselves they still sort correctly, since
   the second pass has its own clean depth buffer. */
function draw() {
  // Skip the whole pipeline while the GL context is gone — see the
  // webglcontextlost handler in init3D(). Submitting GL calls against a
  // dead context is a no-op at best and a console-flooding error at
  // worst, and it would mask the actual restore once it happens.
  if (window.__webglContextLost && window.__webglContextLost()) return;
  resize3D();
  updatePacman3D();
  ghosts.forEach(updateGhost3D);
  animatePowerPellets3D();
  updateScorePopups3D();
  if (currentEffect === "sparkle") updateSparkles3D();

  renderer.autoClear = false;
  renderer.clear();
  renderer.render(scene, camera);

  /* Second pass: same scene with the maze hidden, so only the actors are
     submitted. Hiding a group is used rather than camera layers because
     layers would also have to be enabled on every light and on the shadow
     camera to keep the actors lit and casting — three places to keep in
     sync, for the same result.
     scene.background MUST be unset for this pass, and this is the whole
     trick. rebuildMazeVisual() assigns the theme colour to it, and three.js
     treats a scene background as "force clear": WebGLBackground clears the
     colour buffer on every render that has one, no matter what autoClear
     says. Leave it set and the second pass wipes the maze the first pass
     just drew, leaving Pac-Man and the ghosts floating on an empty field —
     which is precisely what happened the first time this was written, and
     it is invisible in the code until you know that autoClear is not the
     only thing that clears. */
  if (mazeGroup) {
    const bg = scene.background;
    scene.background = null;
    mazeGroup.visible = false;
    renderer.clearDepth();
    renderer.render(scene, camera);
    mazeGroup.visible = true;
    scene.background = bg;
  }
}

// One tick of game logic at a fixed timestep. Pulled out of loop() so it
// can be called multiple times per rendered frame (see loop() below) —
// that's what keeps ghosts/Pac-Man moving at the correct real-world speed
// even when the render frame rate itself is low.
function stepSimulation(delta) {
  simNow += delta * 1000;
  updateFrighten();
  movePacman(delta);
  // Clearing the last pellet ends the level right here. The ghosts used to
  // keep moving and colliding for the rest of this step, so a ghost touching
  // Pac-Man on the winning bite cost a life — or fired Game Over on top of
  // the Congratulations popup for a level that had just been marked won.
  if (gameOver) return;
  ghosts.forEach((g) => {
    if (g.eaten) {
      moveEatenGhost(g, delta);
      // Skip the watchdog while it's intentionally paused inside the
      // house (houseHoldUntil) — that's a deliberate stop, not a freeze.
      if (!g.houseHoldUntil || simNow >= g.houseHoldUntil) {
        unstickGhostIfNeeded(g, delta);
      } else {
        g.lastX = g.x;
        g.lastY = g.y;
      }
    } else if (g.inHouse) {
      // Wait its turn — stay put until this ghost's staggered release
      // time arrives, so they leave the house one at a time instead of
      // all rushing out together.
      if (simNow >= (g.releaseAt || 0)) {
        moveGhostOutOfHouse(g, delta);
        unstickGhostIfNeeded(g, delta);
      } else {
        g.lastX = g.x;
        g.lastY = g.y;
      }
    } else {
      moveGhost(g, delta);
      unstickGhostIfNeeded(g, delta);
    }
  });
  checkCollisions();

  /* Ghost footsteps run whenever a ghost is actually ON THE MOVE, not only
     when one has line of sight to Pac-Man — that is what "when they walk"
     means, and the step's own distance falloff is what keeps a ghost on the
     far side of the maze from being loud. An eaten ghost's eyes make no
     sound on the way home. */
  const anyWalking = ghosts.some(
    (g) => !g.eaten && (g.dirX !== 0 || g.dirY !== 0)
  );
  if (anyWalking) {
    startGhostSiren();
  } else {
    stopGhostSiren();
  }
}

/* True when the board must stand still even though the game screen is up:
   paused, or a video ad / the "watch 5 ads" dialog is in front of it. The
   game used to keep running under the Restart ad and under the unlock
   dialog opened from in-game Prev/Next — ghosts could kill Pac-Man while
   the player was watching an ad they had no way to dismiss. */
function isBoardFrozen() {
  return gamePaused || adIsPlaying ||
    (!!confirmOverlayEl && !confirmOverlayEl.classList.contains("hidden"));
}

function loop(timestamp) {
  if (screens.game.classList.contains("active")) {
    if (isBoardFrozen()) {
      // Paused: keep rendering (so the board stays on screen) but advance
      // nothing, and reset the clock so the first frame after resuming
      // doesn't get charged for all the time spent paused.
      lastTime = 0;
      updateAccumulator = 0;
      stopGhostSiren();
      draw();
      requestAnimationFrame(loop);
      return;
    }
    if (!lastTime) lastTime = timestamp;
    const frameDelta = (timestamp - lastTime) / 1000;
    lastTime = timestamp;
    gameTime = timestamp / 1000;

    if (!gameOver) {
      // Fixed-timestep accumulator instead of a straight per-frame delta.
      // A plain per-frame delta (even an uncapped one) ties Pac-Man/ghost
      // speed directly to however fast the browser can actually render —
      // this 3D scene (shadows, many wall meshes, antialiasing) can drop
      // well below 60fps on weaker/mobile hardware, and a slow render
      // rate used to mean slow *gameplay*: every entity moving in
      // near-frozen slow motion, which is exactly what looked like
      // ghosts "getting stuck". Accumulating real elapsed time and
      // draining it in fixed 1/60s steps keeps movement speed tied to
      // the clock, not the frame rate — a low-fps device just gets fewer,
      // larger catch-up bursts of simulation per rendered frame instead
      // of everything crawling.
      // MAX_SUBSTEPS still caps how much can be replayed in one frame, so
      // a genuine stall (tab backgrounded for a while, debugger pause)
      // can't make Pac-Man or a ghost leap through several tiles/walls
      // trying to fully catch up in one go — the leftover time is simply
      // dropped rather than simulated.
      updateAccumulator = Math.min(
        updateAccumulator + frameDelta,
        FIXED_DT * MAX_SUBSTEPS
      );
      let steps = 0;
      // `!gameOver` too: a death or a win inside one substep must end the
      // catch-up burst, or the remaining substeps keep running the ghosts
      // into an already-dead Pac-Man (lives went negative, Game Over fired
      // repeatedly).
      while (updateAccumulator >= FIXED_DT && steps < MAX_SUBSTEPS && !gameOver) {
        stepSimulation(FIXED_DT);
        updateAccumulator -= FIXED_DT;
        steps++;
      }
    } else {
      stopGhostSiren();
      updateAccumulator = 0;
    }

    draw();
  } else {
    lastTime = 0;
    updateAccumulator = 0;
  }
  requestAnimationFrame(loop);
}

/* The joystick feeds the same trySetDirection() the keyboard does, so there
   is one path into the game and no second copy of the turn rules to keep in
   step. The knob is anchored to the base's centre on pointerdown and tracks
   the pointer (clamped to the base's radius). The dominant axis of the
   vector becomes the direction — a tap near the top is "up", a drag to the
   right is "right" — and only CHANGES in direction are forwarded, so
   holding the knob still does not re-issue the same turn and a small wobble
   inside the dead-zone does nothing.
   pointer events carry their own capture, so a thumb that leaves the base
   keeps controlling the knob until release — no need to track mousemove on
   the document, no need to fix the pointer to the base. */
const JOYSTICK_DEADZONE = 0.32; // fraction of the radius below which a press counts as no input
/* Wrapped in a function so the logic is independent of any one element:
   it takes the joystick's root, base and knob, and keeps its own drag state. */
function initJoystick(joystickEl, joystickBase, joystickKnob) {
if (joystickEl && joystickBase && joystickKnob) {
  let joyActive = false;
  let joyCenter = { x: 0, y: 0 };
  let joyRadius = 1;
  let lastDir = null; // "up" | "down" | "left" | "right" | null

  const JOY_VECTORS = {
    up: [0, -1],
    down: [0, 1],
    left: [-1, 0],
    right: [1, 0],
  };

  /* The knob is drawn on a shorter leash than the pointer: the direction is
     read from the full pointer vector, but the knob itself only travels ~55%
     of the way to the rim, so it stays inside the ring and clear of the
     arrows the way it does in the reference design. */
  const KNOB_TRAVEL = 0.55;
  const setKnob = (dx, dy) => {
    joystickKnob.style.transform = `translate(${dx * KNOB_TRAVEL}px, ${dy * KNOB_TRAVEL}px)`;
  };

  const resetKnob = () => {
    joystickEl.classList.remove("is-dragging");
    setKnob(0, 0);
  };

  const directionFromVector = (nx, ny) => {
    // Dominant axis wins — Pac-Man is a 4-way maze, so diagonal presses snap
    // to whichever axis the thumb pushed further along.
    if (Math.abs(nx) > Math.abs(ny)) {
      return nx > 0 ? "right" : "left";
    }
    return ny > 0 ? "down" : "up";
  };

  const onPointerDown = (e) => {
    if (!screens.game.classList.contains("active")) return;
    e.preventDefault();
    joyActive = true;
    joystickEl.classList.add("is-dragging");
    const rect = joystickBase.getBoundingClientRect();
    joyCenter = {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
    joyRadius = rect.width / 2;
    onPointerMove(e);
  };

  const onPointerMove = (e) => {
    if (!joyActive) return;
    // pointermove fires on the element that received pointerdown, but a thumb
    // dragged outside the base still needs to steer — capture makes that
    // automatic, so we just read the current pointer position.
    let dx = e.clientX - joyCenter.x;
    let dy = e.clientY - joyCenter.y;
    const dist = Math.hypot(dx, dy);
    const maxDist = joyRadius;
    if (dist > maxDist) {
      // Clamp to the rim so the knob visually stays inside the base.
      dx = (dx / dist) * maxDist;
      dy = (dy / dist) * maxDist;
    }
    setKnob(dx, dy);

    const nx = dx / maxDist;
    const ny = dy / maxDist;
    if (Math.hypot(nx, ny) < JOYSTICK_DEADZONE) {
      // Inside the dead-zone: do NOT zero the direction. Pac-Man keeps moving
      // in the last requested direction until a wall stops him, matching how
      // a keyboard key works once tapped.
      return;
    }
    const dir = directionFromVector(nx, ny);
    if (dir !== lastDir) {
      lastDir = dir;
      const vec = JOY_VECTORS[dir];
      trySetDirection(vec[0], vec[1]);
    }
  };

  const onPointerUp = (e) => {
    if (!joyActive) return;
    joyActive = false;
    lastDir = null;
    resetKnob();
    try {
      joystickEl.releasePointerCapture(e.pointerId);
    } catch (_) {
      /* releasePointerCapture can throw if capture was never taken — fine. */
    }
  };

  joystickEl.addEventListener("pointerdown", (e) => {
    try {
      joystickEl.setPointerCapture(e.pointerId);
    } catch (_) {
      /* setPointerCapture is missing on very old browsers; the listeners
         below still work without it, they just lose the drag if the thumb
         leaves the element. */
    }
    onPointerDown(e);
  });
  joystickEl.addEventListener("pointermove", onPointerMove);
  joystickEl.addEventListener("pointerup", onPointerUp);
  joystickEl.addEventListener("pointercancel", onPointerUp);
  joystickEl.addEventListener("lostpointercapture", onPointerUp);
  // Stop a press on the joystick from also triggering a synthesised click on
  // whatever element happens to sit under it after the drag, and stop the
  // touch from scrolling or zooming the page.
  joystickEl.addEventListener("click", (e) => e.preventDefault());
  joystickEl.addEventListener("contextmenu", (e) => e.preventDefault());
}
}

initJoystick(
  document.getElementById("joystick"),
  document.getElementById("joystickBase"),
  document.getElementById("joystickKnob")
);

/* One keyboard handler for the game screen: Escape / P pause and resume
   (ignored while the Game Over / Congratulations popup, an ad or the unlock
   dialog is up), arrows / WASD steer. */
document.addEventListener("keydown", (e) => {
  if (!screens.game.classList.contains("active")) return;
  switch (e.key) {
    case "Escape":
    case "p":
    case "P":
      e.preventDefault();
      if (!overlay.classList.contains("hidden") || adIsPlaying ||
          !confirmOverlayEl.classList.contains("hidden")) break;
      setPaused(!gamePaused);
      break;
    case "ArrowUp":
    case "w":
    case "W":
      e.preventDefault();
      trySetDirection(0, -1);
      break;
    case "ArrowDown":
    case "s":
    case "S":
      e.preventDefault();
      trySetDirection(0, 1);
      break;
    case "ArrowLeft":
    case "a":
    case "A":
      e.preventDefault();
      trySetDirection(-1, 0);
      break;
    case "ArrowRight":
    case "d":
    case "D":
      e.preventDefault();
      trySetDirection(1, 0);
      break;
    default:
      break;
  }
});

/* ---------- Restart, gated behind one rewarded ad per attempt ----------
   The same "once per attempt" shape as continueUsedThisRun, and reset
   alongside it inside startLevel() for the same reason: any level entered
   fresh — level select, Play, Next/Prev, moving on after clearing one —
   should offer the ad-gated restart again.
   startLevel(currentLevel) itself calls startLevel() too, though, which would 0-out
   this flag on the very restart that just USED it, making "once" mean
   nothing. So the restart click handler below calls startLevel(currentLevel) and then
   immediately sets this back to true and the button back to disabled,
   overriding startLevel()'s fresh-entry reset for this one specific entry
   — the only startLevel() call in the file that both happens because of
   this flag and needs to leave it the opposite of what startLevel() itself
   just set. */
let restartAdUsedThisRun = false;

restartBtn.addEventListener("click", () => {
  if (restartAdUsedThisRun) return; // one per attempt — see the comment above
  restartBtn.disabled = true; // no double-clicks while the ad is up
  playVideoAd({
    placement: "restart",
    rewardText: "Watch the ad to restart this level.",
  }).then((res) => {
    /* FIX: no ad shown -> no restart; the button is usable again. */
    if (!res || !res.shown) {
      restartBtn.disabled = false;
      showToast("The ad couldn't load \u2014 level not restarted. Please try again.");
      return;
    }
    startLevel(currentLevel, { startScore: levelStartScore });
    // startLevel(currentLevel) -> startLevel() unconditionally sets both of these back
    // to the fresh-entry state (false / enabled) — reasserted here so THIS
    // particular entry, the restart itself, is the one exception to that.
    restartAdUsedThisRun = true;
    restartBtn.disabled = true;
  });
});

/* ---------- Same ads gate as Level Select, for in-game level nav ----------
   Level Select's tiles are the one place a locked level is supposed to be
   reachable at all, and only by watching UNLOCK_ADS_REQUIRED ads first
   (see showUnlockConfirm() / unlockLevelViaAds() further down). The
   in-game Prev/Next buttons and the Congratulations popup's "<- Level N"
   button are three OTHER ways to jump straight to a specific level
   without going through that grid — and since a level can be unlocked
   out of order (ads-unlocking level 20, say, leaves 19 and 21 locked),
   any of the three could otherwise be used to reach a locked level for
   free, skipping the ads Level Select would have required for that same
   level. Routing all three through this one function keeps them
   identical to tapping that level's tile: unlocked -> go straight there;
   locked but ad-unlockable (the exact same rule buildLevelGrid() uses)
   -> show the same confirm-then-watch-ads flow; locked and not yet
   ad-unlockable (only reachable by actually playing your way there) ->
   no-op, same as tapping a plain padlocked tile does today. */
function goToLevelGated(level, { closeOverlay } = {}) {
  if (level < 1 || level > TOTAL_LEVELS || levelUnlockInProgress) return;
  if (isLevelUnlocked(level)) {
    if (closeOverlay) hideOverlay();
    startLevel(level);
    return;
  }
  if (isLevelAdUnlockable(level)) {
    // Don't close the calling overlay (e.g. the Congratulations popup) yet —
    // only do that once the player actually commits to the ads by hitting
    // OK. Hitting Cancel on the "watch 5 ads" dialog now leaves the
    // Congratulations popup exactly as it was, instead of stranding the
    // player on a blank screen behind an already-dismissed popup.
    showUnlockConfirm(level, { onConfirm: closeOverlay ? hideOverlay : null });
  }
}

prevLevelBtn.addEventListener("click", () => {
  goToLevelGated(currentLevel - 1);
});

nextLevelBtn.addEventListener("click", () => {
  goToLevelGated(currentLevel + 1);
});

exitBtn.addEventListener("click", () => {
  goToLevelSelect();
});

// ===================== SCREEN NAVIGATION =====================
function showScreen(name) {
  // Clear any pause first: setPaused() checks which screen is active before
  // touching the music, and doing this before the switch keeps it from
  // starting the music for a screen the player is only passing through.
  // Clearing the flag silently when we're heading anywhere but the game:
  // otherwise leaving a level started the music for an instant before the
  // screen switch stopped it again.
  if (!screens[name]) {
    console.warn("showScreen: unknown screen", name);
    return;
  }
  if (typeof setPaused === "function") setPaused(false, name !== "game");
  Object.values(screens).forEach((s) => s.classList.remove("active"));
  screens[name].classList.add("active");
  // Sound should only ever be heard during actual gameplay — stop it the
  // moment we're on any other screen (menu, level select, how-to-play).
  if (name !== "game") {
    stopGhostSiren();
  }
  /* The game screen gets its own frame rules (full-width bar, safe-area
     padding) keyed on this class — see the FINAL GAME BAR block in style.css. */
  document.body.classList.toggle("in-game", name === "game");
  // The 300x600 side cards belong to gameplay only.
  if (name === "game") {
    if (typeof loadSideRails === "function") loadSideRails();
  } else if (typeof hideSideRails === "function") {
    hideSideRails();
  }

  /* ---- Force-landscape belongs to the MAZE, not to the whole app ----
     A phone held upright gets the page rotated -90deg so the maze can be
     played in landscape (see the FORCE LANDSCAPE block in style.css). That
     rotation was on <html> unconditionally, so the menu, level select,
     shop and how-to-play were rotated too — and inside a rotated element a
     swipe UP maps to the element's horizontal axis, so those screens read
     as not scrolling at all: you push the content the way it does not
     move. The level grid was the worst of them, 30 tiles in a box whose
     usable height was the phone's WIDTH.
     None of those screens needs landscape; they are a portrait column of
     text and buttons and they were fine before any of this. So the class
     the rotation is now keyed on goes on only while the game is showing,
     and the menus stay upright and scroll the way a phone expects. */
  /* The game screen used to be rotated -90deg on a portrait device by the
     .force-landscape class. It isn't any more — a portrait device gets a
     portrait layout and a landscape one gets a landscape layout — so the
     class is removed rather than toggled, in case an old stylesheet or a
     cached page still carries the rule. */
  document.documentElement.classList.remove("force-landscape");
}

function goToLevelSelect() {
  hideOverlay();
  buildLevelGrid();
  showScreen("levelSelect");
}

playBtn.addEventListener("click", () => {
  // Resume the last level actually played — not the highest unlocked one,
  // which could be a level unlocked with ads and never played.
  startLevel(getResumeLevel());
});

levelSelectBtn.addEventListener("click", () => {
  goToLevelSelect();
});

/* How to Play can be opened from two places — the menu tile and the "?" in
   the Level Select corner — and its Close / "Got it" buttons should take the
   player back to whichever one they came from, not always to the menu. */
let howToReturnScreen = "menu";

function openHowToPlay(from) {
  howToReturnScreen = from || "menu";
  showScreen("howto");
}

howToPlayBtn.addEventListener("click", () => {
  openHowToPlay("menu");
});

document.querySelectorAll(".back-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const inHowTo = !!btn.closest("#howToPlayScreen");
    showScreen(inHowTo ? howToReturnScreen : btn.dataset.target);
    if (inHowTo) howToReturnScreen = "menu";
  });
});

function getDifficultyTier(level) {
  if (level <= 8) return { key: "easy", label: "Easy" };
  if (level <= 16) return { key: "medium", label: "Medium" };
  if (level <= 23) return { key: "hard", label: "Hard" };
  return { key: "expert", label: "Expert" };
}

function buildLevelGrid() {
  const furthest = getFurthestUnlockedLevel();

  /* "Level X of 30 unlocked" — the same fact the padlocks carry, said once
     instead of leaving it to be counted. X is the furthest level the
     player currently has access to. */
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
    /* Every locked level can be individually unlocked with ads — but only
       once a 24-hour reset has actually happened at least once (see
       hasSessionEverReset()). Before that, a locked level is the ordinary
       "you haven't earned this yet" padlock: no ads, no interaction,
       reached only by winning your way there. This is deliberately NOT
       limited to a single "furthest level you'd reached before the
       reset" tile — every locked level offers its own 5-ads unlock, and
       unlocking one does not unlock or complete any level before it. */
    /* A locked level is only ad-unlockable when it sits right after a gap —
       i.e. the level immediately before it is STILL locked too. That is
       what "ads let you skip ahead" means: there is nothing to win yet,
       so ads are the only way in. The moment a level is unlocked (by ads
       OR by winning), the level right after it drops out of the ads pool
       and can only be reached by playing and winning that level — this
       applies uniformly to every level, not just the highest one ever
       ad-unlocked, so unlocking level 15 with ads takes 16 off the ads
       list exactly the same way unlocking level 23 takes 24 off it. */
    const adUnlockable = isLevelAdUnlockable(i);
    if (completed) {
      btn.classList.add("completed");
    } else if (unlocked) {
      btn.classList.add("unlocked");
    } else {
      /* Same plain "locked" look before AND after the reset — no special
         color/border and no different icon for the ad-unlockable tiles.
         Only the click behavior differs (see the handler below); the tile
         itself is never disabled so that click can always fire. */
      btn.classList.add("locked");
    }
    /* Number on every tile; padlock above it where it applies. The
       difficulty word comes back on the tile you can actually START from —
       it tells you what you are about to play, which is worth a line there
       and is noise on the tiles you cannot open yet. */
    btn.innerHTML = completed || unlocked
      ? `<span class="level-num">${i}</span>` +
        (unlocked && !completed ? `<span class="level-diff">${tier.label}</span>` : "")
      : `<span class="level-lock">🔒</span><span class="level-num">${i}</span>`;
    if (adUnlockable) btn.title = "Watch " + UNLOCK_ADS_REQUIRED + " ads to unlock this level and continue the game";
    if (levelUnlockInProgress) btn.disabled = true; // ads playing — whole grid waits
    btn.addEventListener("click", () => {
      if (levelUnlockInProgress) return;
      if (unlocked) {
        startLevel(i);
      } else if (adUnlockable) {
        showUnlockConfirm(i);
      }
    });
    levelGrid.appendChild(btn);
  }
}

/* ---------- Unlock a single locked level by watching ads ----------
   Reachable for ANY locked level, but only once a 24-hour reset has
   happened at least once (see hasSessionEverReset() / buildLevelGrid()).
   The tile's tap doesn't start the ads straight away — it pops a
   confirmation dialog (showUnlockConfirm) FIRST, so the player opts in to
   the 5-ad sequence before any video rolls. OK in that dialog runs
   unlockLevelViaAds(), which plays UNLOCK_ADS_REQUIRED video ads back to
   back — never fewer, and the player can't tap ahead to the next one
   early since each call waits on the previous ad's promise — then
   unlocks JUST that level (unlockLevel(), not anything scalar/cascading)
   and drops the player straight into it. Every level before it stays
   locked; winning this level is what unlocks the next one normally, with
   no further ads (see markLevelCompleted()). */
const UNLOCK_ADS_REQUIRED = 5;
let levelUnlockInProgress = false;

/* The tile handler calls this. Shows the dialog and waits for OK / Cancel.
   Cancel just closes this dialog only — whatever was behind it (e.g. the
   Congratulations popup, when called from its "<- Level N" button) is left
   untouched. OK calls onConfirm (if given — this is the caller's chance to
   dismiss its own popup right as the player commits) and then runs
   unlockLevelViaAds(level). */
function showUnlockConfirm(level, { onConfirm } = {}) {
  if (levelUnlockInProgress) return;
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

  // Clone-and-replace, same trick as wireModalButtons: guarantees a stale
  // OK / Cancel handler from the last tile the player tapped is gone
  // before the new one is wired, so the right level always gets unlocked.
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
  buildLevelGrid(); // redraw so every tile is briefly non-interactive while ads play

  let watched = 0;
  function playNext() {
    watched++;
    return playVideoAd({
      placement: "recover",
      rewardText: "Watching ad " + watched + " of " + UNLOCK_ADS_REQUIRED + " to unlock Level " + level + "\u2026",
    }).then((res) => {
      /* FIX: one ad that fails to load stops the sequence with no unlock. */
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
    unlockLevel(level); // unlocks ONLY this level — nothing before it changes
    buildLevelGrid(); // redraw: level+1 immediately drops off the ads list
    startLevel(level);
  });
}

// ===================== OVERLAY / MODAL =====================
// Sets the primary/secondary button labels and click handlers, using the
// same clone-and-replace trick as before to guarantee old listeners from a
// previous overlay don't linger. Does NOT touch title/message/coins/banner
// — callers (handleLevelWin, handleGameOver) set those directly so each
// can show its own extra bits (continue button, banner ad, coins line).
/* The Previous button is off by default and switched on only by the popup
   that wants it. Doing it here, on every wiring, means Game Over can never
   inherit a stray Previous left behind by the last Congratulations. */
function setModalPrevLevel(level) {
  if (!modalPrevBtn) return;
  const fresh = modalPrevBtn.cloneNode(true);
  modalPrevBtn.replaceWith(fresh);
  modalPrevBtn = fresh;

  if (!level || level < 1) {
    modalPrevBtn.classList.add("hidden");
    return;
  }
  modalPrevBtn.textContent = "\u2B05 Level " + level;
  modalPrevBtn.classList.remove("hidden");
  modalPrevBtn.addEventListener("click", () => {
    // Same ads gate as Level Select / the in-game Prev-Next buttons — see
    // goToLevelGated()'s comment. clearedLevel-1 is usually already
    // unlocked (normal progression), but not always: if THIS level was
    // itself reached via an out-of-order ads-unlock, the one before it
    // can still be locked, and this button used to drop the player
    // straight into it for free.
    goToLevelGated(level, { closeOverlay: true });
  });
}

function wireModalButtons(primaryLabel, secondaryLabel, onPrimary, onSecondary) {
  modalPrimaryBtn.textContent = primaryLabel;
  modalSecondaryBtn.textContent = secondaryLabel;
  setModalPrevLevel(0);

  const newPrimary = modalPrimaryBtn.cloneNode(true);
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

if (modalCloseX) {
  modalCloseX.addEventListener("click", () => {
    hideOverlay();
    goToLevelSelect();
  });
}

// ===================== INIT =====================
checkSession();
applyEquippedCosmetics();
init3D();
updateCoinDisplays();
setMuted(soundMuted);
buildLevelGrid();
showScreen("menu");
requestAnimationFrame(loop);

/* ---------- Page-visibility safety net ----------
   A second source of "white screen on the maze mid-game" that the GL
   context-loss handler above does NOT cover: most mobile browsers
   actually pause `requestAnimationFrame` (and WebGL entirely) while the
   tab is hidden, and on resume they:
     - clear the canvas backing store to opaque white on some platforms,
       OR
     - leave the LAST frame visible but then it takes one or two frames
       for the GL pipeline to spin back up, during which the maze still
       looks frozen.
   Listening for visibilitychange and forcing a full resize + redraw on
   return catches both: the immediate redraw repaints the maze before
   the user has a chance to see the white blank, and resetting lastTime
   / accumulator stops the simulation from trying to "catch up" the
   many seconds the tab was hidden in a single huge frame. */
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    // Going away — silence audio and pause the sim clock so nothing
    // accumulates against the time we are about to spend hidden.
    /* FIX: auto-pause a live level when the tab/app goes to the background,
       so the player comes back to a paused board, not a running one. */
    if (screens.game.classList.contains("active") && !gameOver && !adIsPlaying) {
      setPaused(true);
    }
    stopGhostSiren();
    lastTime = 0;
    updateAccumulator = 0;
  } else {
    // Coming back — let the next loop() frame re-establish lastTime
    // from scratch (it sets lastTime = timestamp when lastTime is 0),
    // and force a redraw so the maze is back on screen within one
    // frame instead of waiting for the next scheduled RAF.
    lastTime = 0;
    updateAccumulator = 0;
    if (screens.game.classList.contains("active")) {
      resize3D(true);
      draw();
    }
  }
});

/* =====================  SIDE AD CARDS (VERTICAL_BANNER 300x600)  =========
   Two half-page / skyscraper cards in the space either side of the maze,
   during gameplay only.
   The maze normally stretches the full width of the window, so there is no
   gutter to put anything in — fitSideRails() caps the game column (via
   --game-max) to leave exactly the room the two cards need, then drops them
   in. If the window is too narrow for a real side gutter (portrait tablets,
   phones), placeLeaderboardTop() puts a single IAB LEADER_BOARD 970x90 above
   the board instead — see the comment above that function. Only if even that
   does not fit does the maze keep the whole width with no ad at all.
   ========================================================================= */

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
const RAIL_MIN_SCALE = 0.34;  // below this the card is too small to read.
                              // A safety net rather than a working limit:
                              // the smallest measured across the target
                              // devices is 0.48 (a 145x290 card on a
                              // 320x568 phone).
const RAIL_GAME_RESERVE = 740;   // px kept clear for the game between the rails
/* The frame padding kept above and below the card. Was 32 (1rem each side),
   which is a comfortable margin on a tall window and a real cost on a short
   one: it comes straight off the card's height budget, so a 1024x600 screen
   — exactly the unit's own 600px — was serving a 282x564, and a 1440x586 a
   276x552. Orbit Maze carries 4 and draws 300x600 and 291x582 on those same
   two screens; the two games are meant to place the same unit the same way,
   and it was Pac-Man that was behind.
   4 (2 above, 2 below) matches what Orbit carries, which is what makes the
   two games land on the same drawn size rather than merely a similar one. The
   vertical placement below is relaxed to match — pinning it to a minimum of
   8px from the top would have pushed a 582px card out of a 586px window. */
const RAIL_VIEWPORT_CHROME = 4;
/* The intentional gap left around the SINGLE side-rail card on a phone or
   tablet in landscape (fullBarLayout, singleSide) — 4px above it, 4px below,
   inside whatever room the bar leaves it. Without this the card's height was
   simply capped at aboveBarH itself, so on a short screen the card came out
   EXACTLY as tall as the space above the bar and touched both edges of it —
   measured as a 2px top margin (a rounding artifact of centring in what was
   left, not a deliberate gap) that read, on a real device, as the card
   being wedged flush against the top of the screen with no breathing room.
   RAIL_VIEWPORT_CHROME above does something similar for the two-card desktop
   case; this is the same idea sized for how visible 4px reads on a phone. */
const RAIL_MOBILE_BREATHING = 4;
/* Equal gap placeLeaderboardTop() leaves above the portrait leaderboard AND
   between it and the maze — 10px reads as a card that has been placed, the
   4px RAIL_EDGE this used to sit at read as one stuck to the screen edge.
   Kept as its own constant rather than reusing RAIL_MOBILE_BREATHING: that
   one is a total (split in half by centring), this one is the SAME value
   on both sides directly, and the two units — a portrait band under no
   bar-clearance constraint vs. a landscape card squeezed above one — don't
   need to move together if either is ever retuned. */
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


function railLimits() {
  const vw = layoutViewport().w;
  /* 480 is the floor, measured on the LAYOUT width — which on a rotated
     phone is the screen's long side, so a 320px phone reads as 568 here and
     still gets its card. Below this the side gutter is not worth the name
     and the pair goes under the board instead. */
  if (vw < 480) return { minGame: vw, maxCardW: 0 };

  /* The share each card may take of the width, and how little the board may
     be left with. Only the two-gutter landscape path consults these; the
     lone card on a portrait window or a phone is sized by the room it has,
     not by a share (see fitSideRailsInner). */
  if (vw >= 1200) return { minGame: 640, maxCardW: AD_RAIL_W };
  if (vw >= 900) return { minGame: Math.round(vw * 0.44), maxCardW: Math.round(vw * 0.26) };
  return { minGame: Math.round(vw * 0.44), maxCardW: Math.round(vw * 0.28) };
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
  const from = ad.bgFrom || "#6a3fb5";
  const to = ad.bgTo || "#e8607a";
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
   short enough to cross RAIL_MIN_SCALE. A 970x90 LEADER_BOARD is built for
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
  resize3D(true);
  resize3D(true);
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
     Checked FIRST, before railLimits() below — that function's vw<480
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

/* The help "?" in the Level Select corner. Same page of rules as the menu's
   How to Play tile, and closing it returns to Level Select.
   This used to call showScreen("howToPlay") — but the screens map key is
   "howto", so screens["howToPlay"] was undefined: showScreen() had already
   cleared .active from every screen by then and then threw on the lookup,
   which is why tapping "?" showed nothing (a blank screen). */
(function wireLevelHelpButton() {
  var btn = document.getElementById("levelHelpBtn");
  if (btn) btn.addEventListener("click", function () { openHowToPlay("levelSelect"); });
})();
