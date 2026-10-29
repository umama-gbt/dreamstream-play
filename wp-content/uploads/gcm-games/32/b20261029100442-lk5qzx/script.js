/* =======================================================================
   ORBIT MAZE — built on the Pac-Man shell
   -----------------------------------------------------------------------
   Everything shared between the games (screens, coins, 24-hour session,
   level unlocks, the 5-ads unlock, video / banner / leaderboard / side
   ads, popups, the game bar and its joystick, the responsive
   board-and-ads layout, pause) is Pac-Man's code, kept as close to the
   original as the game allows.
   What is Orbit Maze's own: the 35 mazes and 5 worlds, the maze generator,
   the tilt physics, marbles, black holes, the per-maze time limit, the
   coin rewards, the shop's items, the sounds and the resume-from-here
   continue.
   ======================================================================= */

/* localStorage can throw (Safari private mode, sandboxed iframes, storage
   disabled, quota). Every read/write goes through here and a failure just
   means "nothing saved". */
const store = {
  get(key) { try { return localStorage.getItem(key); } catch (e) { return null; } },
  set(key, val) { try { localStorage.setItem(key, val); } catch (e) {} },
  remove(key) { try { localStorage.removeItem(key); } catch (e) {} },
};

/* Carousel timers: declared first because showScreen()'s very first call at
   start-up reaches the functions that read them (see Pac-Man). */
let leaderboardCarouselTimer = null;
let railCarouselTimer = null;
let modalBannerCarouselTimer = null;

// ---------- Board / bar ----------
const boardEl = document.getElementById("gameBoard");
const mazeFitEl = document.getElementById("mazeFit");
const mazeElement = document.getElementById("maze");
const endElement = document.getElementById("end");
const timeEl = document.getElementById("time");
const marblesEl = document.getElementById("marbles");
const levelTitleEl = document.getElementById("levelTitle");
const restartBtn = document.getElementById("restartBtn");
const prevLevelBtn = document.getElementById("prevLevelBtn");
const nextLevelBtn = document.getElementById("nextLevelBtn");
const exitBtn = document.getElementById("exitBtn");
const muteBtns = document.querySelectorAll(".mute-btn");

// ---------- Screens ----------
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

// ---------- Result popup (Congratulations / Game Over) ----------
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

// ---------- "Watch 5 ads to unlock" confirmation ----------
const confirmOverlayEl   = document.getElementById("confirmOverlay");
const confirmTitleEl     = document.getElementById("confirmTitle");
const confirmMessageEl   = document.getElementById("confirmMessage");
const confirmSubMessageEl = document.getElementById("confirmSubMessage");
let   confirmOkBtn       = document.getElementById("confirmOkBtn");
let   confirmCancelBtn   = document.getElementById("confirmCancelBtn");

// ===================== COINS =====================
const COINS_KEY = "orbitmaze_coins";
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
const TOTAL_LEVELS = 35;

// ---------- Unlocked levels ----------
// A SET of level numbers the player can currently start, not a single
// "unlocked up to here" pointer. That distinction matters once ads can
// unlock one specific level out of order (see UNLOCK_ADS_REQUIRED below):
// unlocking level 6 must NOT imply 2-5 are also playable, which a scalar
// frontier can't express but a set can. Level 1 is always available and is
// never actually stored.
const UNLOCKED_KEY = "orbitmaze_unlockedLevels";

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
const COMPLETED_KEY = "orbitmaze_completedLevels";

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
// Recorded only when the player really plays a level — their first tilt
// on it (see applyTilt()) — never when a level is merely
// unlocked, whether by winning the one before it or by watching ads.
// Cleared with the rest of the session progress on a 24-hour reset.
const LAST_PLAYED_KEY = "orbitmaze_lastPlayedLevel";

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
// Progress (unlocked/completed levels, coins, equipped / unlocked shop
// items) resets 24 hours after the session started. Sound preference is a
// device setting, not game progress, so it's deliberately excluded.
const SESSION_START_KEY = "orbitmaze_sessionStart";
const SESSION_LENGTH_MS = 24 * 60 * 60 * 1000;
const SESSION_KEYS = [UNLOCKED_KEY, COMPLETED_KEY, LAST_PLAYED_KEY, COINS_KEY, "orbitmaze_equipped", "orbitmaze_unlocked_items"];

// Separate from SESSION_KEYS on purpose: this flag must survive the wipe
// it gets set by, because it's what tells buildLevelGrid() a 24-hour reset
// has happened at least once. Only then does tapping a locked level offer
// the 5-ads unlock — before the first reset, locked levels behave exactly
// as they always did (a plain padlock, no ads, reached only by winning
// your way there). Once true it stays true; there's no scenario where it
// should go back to false.
const RESET_HAPPENED_KEY = "orbitmaze_resetHappened";

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
      stopLevelPlay();
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
/* The 24-hour message goes through the same toast as every other message
   (it used to be a second, line-for-line copy of showToast()). */
function showSessionToast() {
  showToast("\u23F0 24-hour session over \u2014 progress reset, starting fresh");
}

setInterval(checkSession, 30000);
/* (Coming back to the tab also checks the session — see the single
   visibilitychange handler in the init code.) */
window.addEventListener("focus", checkSession);

/* ===================== Math utils (from the original engine) ===================== */
Math.minmax = (value, limit) => Math.max(Math.min(value, limit), -limit);

const distance2D = (p1, p2) => Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);

/* Text from sponsor-media.json goes into innerHTML; escape it so a title such
   as "Save <50%" (or a hostile catalogue) can never inject markup. */
const escHtml = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* One place that makes an ad slot clickable (was copy-pasted 6 times). */
function wireAdClick(el, ad) {
  el.classList.toggle("clickable", !!ad.clickUrl);
  el.onclick = ad.clickUrl ? () => window.open(ad.clickUrl, "_blank", "noopener") : null;
}

const getAngle = (p1, p2) => {
  let angle = Math.atan((p2.y - p1.y) / (p2.x - p1.x));
  if (p2.x - p1.x < 0) angle += Math.PI;
  return angle;
};

const closestItCanBe = (cap, ball) => {
  let angle = getAngle(cap, ball);
  const deltaX = Math.cos(angle) * (wallW / 2 + ballSize / 2);
  const deltaY = Math.sin(angle) * (wallW / 2 + ballSize / 2);
  return { x: cap.x + deltaX, y: cap.y + deltaY };
};

const rollAroundCap = (cap, ball) => {
  let impactAngle = getAngle(ball, cap);
  let heading = getAngle({ x: 0, y: 0 }, { x: ball.velocityX, y: ball.velocityY });
  let impactHeadingAngle = impactAngle - heading;

  const velocityMagnitude = distance2D({ x: 0, y: 0 }, { x: ball.velocityX, y: ball.velocityY });
  const velocityMagnitudeDiagonalToTheImpact = Math.sin(impactHeadingAngle) * velocityMagnitude;
  const closestDistance = wallW / 2 + ballSize / 2;
  const rotationAngle = Math.atan(velocityMagnitudeDiagonalToTheImpact / closestDistance);

  const deltaFromCap = {
    x: Math.cos(impactAngle + Math.PI - rotationAngle) * closestDistance,
    y: Math.sin(impactAngle + Math.PI - rotationAngle) * closestDistance,
  };

  const x = ball.x;
  const y = ball.y;
  const velocityX = ball.x - (cap.x + deltaFromCap.x);
  const velocityY = ball.y - (cap.y + deltaFromCap.y);
  const nextX = x + velocityX;
  const nextY = y + velocityY;

  return { x, y, velocityX, velocityY, nextX, nextY };
};

const slow = (number, difference) => {
  if (Math.abs(number) <= difference) return 0;
  if (number > difference) return number - difference;
  return number + difference;
};

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ===================== Constants ===================== */
const pathW = 42;   // Path width -- wide enough that a marble can be steered
                     // around a black hole rather than it blocking the lane outright
const wallW = 12;   // Wall width
const ballSize = 14;
const holeSize = 14; // small enough (relative to pathW) to leave room to pass by
const unit = pathW + wallW;

/* ===================== Level definitions ===================== */
/* ---------- Level table ----------
   Levels 1-5 used to be a bare 4x4 with NO holes at all — four cells across,
   nothing to steer around, and the first real obstacle did not appear until
   level 7. The board starts at 6x5 with two holes now, so there is something
   to play against from the first level, and the ramp runs smoothly from
   there to 18x18 with 34.
   The table is built to be non-decreasing in every column: no level is ever
   smaller, emptier or more generous with time than the one before it. The
   old table dipped in places (11 was smaller than 10), which read as the
   game going backwards. Holes are also capped at a fifth of the cells so a
   board can never be so crowded that there is no room to roll. */
const LEVELS = [
  { id: 1,  cols:  6, rows:  5, balls: 1, holes:  2, timeLimit:  35 },
  { id: 2,  cols:  6, rows:  5, balls: 1, holes:  3, timeLimit:  40 },
  { id: 3,  cols:  7, rows:  6, balls: 2, holes:  4, timeLimit:  45 },
  { id: 4,  cols:  7, rows:  6, balls: 2, holes:  5, timeLimit:  50 },
  { id: 5,  cols:  7, rows:  7, balls: 2, holes:  6, timeLimit:  55 },
  { id: 6,  cols:  8, rows:  7, balls: 2, holes:  7, timeLimit:  60 },
  { id: 7,  cols:  8, rows:  7, balls: 3, holes:  8, timeLimit:  65 },
  { id: 8,  cols:  8, rows:  8, balls: 3, holes:  9, timeLimit:  70 },
  { id: 9,  cols:  9, rows:  8, balls: 3, holes: 10, timeLimit:  75 },
  { id: 10, cols:  9, rows:  8, balls: 3, holes: 10, timeLimit:  80 },
  { id: 11, cols: 10, rows:  9, balls: 4, holes: 11, timeLimit:  85 },
  { id: 12, cols: 10, rows:  9, balls: 4, holes: 12, timeLimit:  90 },
  { id: 13, cols: 10, rows: 10, balls: 4, holes: 13, timeLimit:  95 },
  { id: 14, cols: 11, rows: 10, balls: 4, holes: 14, timeLimit: 100 },
  { id: 15, cols: 11, rows: 10, balls: 4, holes: 15, timeLimit: 105 },
  { id: 16, cols: 11, rows: 11, balls: 4, holes: 16, timeLimit: 110 },
  { id: 17, cols: 12, rows: 11, balls: 4, holes: 17, timeLimit: 115 },
  { id: 18, cols: 12, rows: 12, balls: 4, holes: 18, timeLimit: 120 },
  { id: 19, cols: 12, rows: 12, balls: 4, holes: 19, timeLimit: 120 },
  { id: 20, cols: 13, rows: 12, balls: 4, holes: 20, timeLimit: 125 },
  { id: 21, cols: 13, rows: 13, balls: 4, holes: 21, timeLimit: 130 },
  { id: 22, cols: 13, rows: 13, balls: 4, holes: 22, timeLimit: 135 },
  { id: 23, cols: 14, rows: 13, balls: 4, holes: 23, timeLimit: 140 },
  { id: 24, cols: 14, rows: 14, balls: 4, holes: 24, timeLimit: 145 },
  { id: 25, cols: 14, rows: 14, balls: 4, holes: 25, timeLimit: 150 },
  { id: 26, cols: 15, rows: 15, balls: 4, holes: 26, timeLimit: 155 },
  { id: 27, cols: 15, rows: 15, balls: 4, holes: 26, timeLimit: 160 },
  { id: 28, cols: 16, rows: 15, balls: 4, holes: 27, timeLimit: 165 },
  { id: 29, cols: 16, rows: 16, balls: 4, holes: 28, timeLimit: 170 },
  { id: 30, cols: 16, rows: 16, balls: 4, holes: 29, timeLimit: 175 },
  { id: 31, cols: 17, rows: 16, balls: 4, holes: 30, timeLimit: 180 },
  { id: 32, cols: 17, rows: 17, balls: 4, holes: 31, timeLimit: 185 },
  { id: 33, cols: 17, rows: 17, balls: 4, holes: 32, timeLimit: 190 },
  { id: 34, cols: 18, rows: 18, balls: 4, holes: 33, timeLimit: 195 },
  { id: 35, cols: 18, rows: 18, balls: 4, holes: 34, timeLimit: 200 },
];
const RAMP_START_LEVEL = 5; // levels 1-5 stay at baseline physics, difficulty ramp begins after level 5

// Beyond bigger mazes, levels from #6 onward also get physically harder to
// control: gravity ramps up and the surface gets progressively more
// slippery (less friction), so marbles overshoot more easily.
function difficultyPhysics(levelId) {
  if (levelId <= RAMP_START_LEVEL) {
    return { gravity: 2, friction: 0.01 };
  }
  const t = (levelId - RAMP_START_LEVEL) / (TOTAL_LEVELS - RAMP_START_LEVEL); // 0 -> 1 from level 6 to 35
  return {
    gravity: 2 + t * 0.35,          // 2.00 -> 2.35
    friction: 0.01 - t * 0.0045,    // 0.0100 -> 0.0055 (more slippery later)
  };
}

/* ===================== Procedural maze generator ===================== */
// Randomized depth-first "perfect maze": guarantees a single connected
// path between every cell, so the puzzle is always solvable.
function carveMaze(cols, rows) {
  const visited = Array.from({ length: rows }, () => Array(cols).fill(false));
  const right = Array.from({ length: rows }, () => Array(cols).fill(true));  // wall to the right of [r][c]
  const bottom = Array.from({ length: rows }, () => Array(cols).fill(true)); // wall below [r][c]

  const stack = [[0, 0]];
  visited[0][0] = true;

  while (stack.length) {
    const [r, c] = stack[stack.length - 1];
    const options = [];
    if (r > 0 && !visited[r - 1][c]) options.push([r - 1, c, "top"]);
    if (r < rows - 1 && !visited[r + 1][c]) options.push([r + 1, c, "bottom"]);
    if (c > 0 && !visited[r][c - 1]) options.push([r, c - 1, "left"]);
    if (c < cols - 1 && !visited[r][c + 1]) options.push([r, c + 1, "right"]);

    if (!options.length) { stack.pop(); continue; }

    const [nr, nc, dir] = options[Math.floor(Math.random() * options.length)];
    if (dir === "right") right[r][c] = false;
    else if (dir === "left") right[r][c - 1] = false;
    else if (dir === "bottom") bottom[r][c] = false;
    else if (dir === "top") bottom[r - 1][c] = false;

    visited[nr][nc] = true;
    stack.push([nr, nc]);
  }

  return { right, bottom };
}

function buildMazeConfig(level) {
  const { cols, rows, balls: ballCount, holes: holeCount } = level;
  /* Cell size per axis. The table's mazes use square cells (unit x unit);
     to fill a board whose shape the grid cannot match exactly, the cells may
     be stretched a little along one axis (never shrunk) — see
     mazeShapeForBoard(). Walls, marbles and holes keep their sizes. */
  const ux = level.unitX || unit;
  const uy = level.unitY || unit;
  const { right, bottom } = carveMaze(cols, rows);

  const raw = [];
  // Outer border
  raw.push({ column: 0, row: 0, horizontal: true, length: cols });
  raw.push({ column: 0, row: rows, horizontal: true, length: cols });
  raw.push({ column: 0, row: 0, horizontal: false, length: rows });
  raw.push({ column: cols, row: 0, horizontal: false, length: rows });
  // Internal walls left standing by the maze carve
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols - 1; c++)
      if (right[r][c]) raw.push({ column: c + 1, row: r, horizontal: false, length: 1 });
  for (let r = 0; r < rows - 1; r++)
    for (let c = 0; c < cols; c++)
      if (bottom[r][c]) raw.push({ column: c, row: r + 1, horizontal: true, length: 1 });

  const walls = raw.map(w => ({
    x: w.column * ux,
    y: w.row * uy,
    horizontal: w.horizontal,
    length: w.length * (w.horizontal ? ux : uy),
  }));

  const mazeWidth = cols * ux;
  const mazeHeight = rows * uy;
  const endSize = Math.round(Math.max(40, Math.min(70, Math.min(mazeWidth, mazeHeight) * 0.22)));

  const cornerCells = [
    { column: 0, row: 0 },
    { column: cols - 1, row: 0 },
    { column: 0, row: rows - 1 },
    { column: cols - 1, row: rows - 1 },
  ];
  const ballCells = cornerCells.slice(0, ballCount);
  const ballStarts = ballCells.map(({ column, row }) => ({
    x: column * ux + ux / 2,
    y: row * uy + uy / 2,
  }));

  const centerCol = (cols - 1) / 2, centerRow = (rows - 1) / 2;
  const excluded = new Set(ballCells.map(c => `${c.column},${c.row}`));
  const candidates = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (excluded.has(`${c},${r}`)) continue;
      if (Math.abs(c - centerCol) < 1 && Math.abs(r - centerRow) < 1) continue;
      candidates.push({ column: c, row: r });
    }
  }
  const holeCells = shuffle(candidates).slice(0, holeCount);
  // From level 15 on, some holes become moving obstacles instead of static
  // ones — a genuinely new hazard type, not just "more of the same". Each
  // oscillates back and forth within its own cell (bounded so it can never
  // drift into a wall), on whichever axis has more room to move.
  const movingShare = level.id >= 25 ? 0.6 : level.id >= 15 ? 0.35 : 0;
  const movingCount = Math.round(holeCells.length * movingShare);
  const movingSet = new Set(shuffle(holeCells.map((_, i) => i)).slice(0, movingCount));
  const holes = holeCells.map(({ column, row }, i) => {
    const baseX = column * ux + ux / 2;
    const baseY = row * uy + uy / 2;
    const moving = movingSet.has(i);
    return {
      x: baseX,
      y: baseY,
      baseX,
      baseY,
      moving,
      axis: Math.random() < 0.5 ? "x" : "y",
      range: (pathW - holeSize) / 2 - 2, // stays inside this cell's open path
      speed: 0.9 + Math.random() * 0.6, // radians/sec
      phase: Math.random() * Math.PI * 2,
    };
  });

  return { walls, holes, mazeWidth, mazeHeight, endSize, ballStarts };
}


// ===================== WORLDS (Orbit Maze's own) =====================
// 35 mazes in 5 worlds of 7, each with its own palette. A world's palette is
// the maze's look whenever no Shop maze theme overrides it.
const WORLDS = [
  { id: "grass",  name: "Grass",  from: 1,  to: 7,  dot: "#4a9d3f", wall: "#5c7a3a", bg: "#eef7e6", path: "#f7fbf2" },
  { id: "desert", name: "Desert", from: 8,  to: 14, dot: "#d99b3f", wall: "#a9713b", bg: "#fbf0da", path: "#fff8ea" },
  { id: "ice",    name: "Ice",    from: 15, to: 21, dot: "#4fb3d9", wall: "#3d6f8a", bg: "#e7f6fb", path: "#f4fcff" },
  { id: "space",  name: "Space",  from: 22, to: 28, dot: "#8c6fd9", wall: "#463466", bg: "#231b3a", path: "#352a52" },
  { id: "lava",   name: "Lava",   from: 29, to: 35, dot: "#e2543f", wall: "#7a2213", bg: "#2c1210", path: "#41180f" },
];
function worldForLevel(levelId) {
  return WORLDS.find((w) => levelId >= w.from && levelId <= w.to) || WORLDS[0];
}

// ===================== SHOP (Orbit Maze's items, Pac-Man's shop) =====================
const SHOP_ITEMS = {
  ball: [
    { id: "classic", name: "Classic", cost: 0, color: "#64748f" },
    { id: "ruby", name: "Ruby", cost: 80, color: "#e2543f" },
    { id: "emerald", name: "Emerald", cost: 80, color: "#3fae6a" },
    { id: "sapphire", name: "Sapphire", cost: 120, color: "#3f7fd9" },
    { id: "amber", name: "Amber", cost: 120, color: "#e2a13f" },
    { id: "amethyst", name: "Amethyst", cost: 160, color: "#8c5fd9" },
    { id: "gold", name: "Gold", cost: 220, color: "#d9b23f" },
  ],
  maze: [
    { id: "default", name: "World Default", cost: 0, wall: "", bg: "", path: "", isDefault: true },
    { id: "lagoon", name: "Lagoon", cost: 100, wall: "#2a9d8f", bg: "#e0f7f5", path: "#f2fdfc" },
    { id: "coral", name: "Coral Reef", cost: 100, wall: "#c65b6c", bg: "#fbe9ec", path: "#fff5f6" },
    { id: "mint", name: "Mint", cost: 140, wall: "#3a8a6e", bg: "#e6f7f0", path: "#f3fcf9" },
    { id: "royal", name: "Royal", cost: 180, wall: "#4b3f8c", bg: "#eae7fb", path: "#f5f3ff" },
  ],
  trail: [
    { id: "none", name: "None", cost: 0, icon: "🚫" },
    { id: "spark", name: "Spark Trail", cost: 100, icon: "✨", color: "#e2a13f" },
    { id: "glow", name: "Glow Trail", cost: 100, icon: "🌟", color: "#4fb3d9" },
    { id: "smoke", name: "Smoke Trail", cost: 150, icon: "💨", color: "#8c8c9c" },
  ],
};

function getEquippedMap() {
  try { return JSON.parse(store.get("orbitmaze_equipped")) || {}; } catch (e) { return {}; }
}
function setEquippedId(cat, id) {
  const eq = getEquippedMap();
  eq[cat] = id;
  store.set("orbitmaze_equipped", JSON.stringify(eq));
}
function getEquippedId(cat) {
  return getEquippedMap()[cat] || SHOP_ITEMS[cat][0].id;
}
function getUnlockedItemsMap() {
  try { return JSON.parse(store.get("orbitmaze_unlocked_items")) || {}; } catch (e) { return {}; }
}
function isItemUnlocked(cat, id) {
  return (getUnlockedItemsMap()[cat] || []).includes(id);
}
function unlockItem(cat, id) {
  const u = getUnlockedItemsMap();
  if (!u[cat]) u[cat] = [];
  if (!u[cat].includes(id)) u[cat].push(id);
  store.set("orbitmaze_unlocked_items", JSON.stringify(u));
}

let currentBallColor = SHOP_ITEMS.ball[0].color;
let currentTrail = SHOP_ITEMS.trail[0];
let currentMazePalette = null; // null = the world's own palette

function applyEquippedCosmetics() {
  const ballItem = SHOP_ITEMS.ball.find((x) => x.id === getEquippedId("ball")) || SHOP_ITEMS.ball[0];
  currentBallColor = ballItem.color;
  document.documentElement.style.setProperty("--ball-color", currentBallColor);
  currentTrail = SHOP_ITEMS.trail.find((x) => x.id === getEquippedId("trail")) || SHOP_ITEMS.trail[0];
  const mazeItem = SHOP_ITEMS.maze.find((x) => x.id === getEquippedId("maze")) || SHOP_ITEMS.maze[0];
  currentMazePalette = mazeItem.isDefault ? null : mazeItem;
}

let activeShopTab = "ball";
function swatchStyleFor(cat, item) {
  if (cat === "ball") return "background:radial-gradient(circle at 32% 30%, #ffffff 0%, " + item.color + " 62%);";
  if (cat === "maze") {
    if (item.isDefault) return "background:linear-gradient(135deg,#4a9d3f,#d99b3f,#4fb3d9,#8c6fd9,#e2543f);";
    return "background:linear-gradient(135deg," + item.wall + "," + item.bg + ");";
  }
  return "background:#f3ece4;";
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
    if (cat === "trail") swatch.textContent = item.icon;

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
        SFX.click();
        setEquippedId(cat, item.id);
        applyEquippedCosmetics();
        renderShop(cat);
      });
    } else {
      btn.textContent = "Buy · " + item.cost + " 🪙";
      btn.classList.add("buy");
      btn.disabled = getCoins() < item.cost;
      btn.addEventListener("click", () => {
        if (spendCoins(item.cost)) {
          SFX.click();
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

// ===================== SOUND =====================
/* Pac-Man's Sound button and mute setting (a device setting that survives
   the 24-hour reset); Orbit Maze's own generated effects. */
let audioCtx = null;
const MUTE_STORAGE_KEY = "orbitmaze_soundMuted";
let soundMuted = store.get(MUTE_STORAGE_KEY) === "1";

function getAudioContext() {
  if (soundMuted) return null;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) audioCtx = new Ctx();
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
if (muteBtns.length) {
  muteBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      setMuted(!soundMuted);
      if (!soundMuted) SFX.click();
    });
  });
}

const SFX = (function () {
  const lastPlayed = {};
  function beep(freq, duration, type, volume, delay) {
    const c = getAudioContext();
    if (!c) return;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type || "sine";
    osc.frequency.value = freq;
    const now = c.currentTime + (delay || 0);
    gain.gain.setValueAtTime(volume || 0.07, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(now);
    osc.stop(now + duration);
  }
  // a marble resting on a wall is re-detected every frame — never a buzz
  function throttled(key, fn, gapMs) {
    const now = performance.now();
    if (!lastPlayed[key] || now - lastPlayed[key] > gapMs) {
      lastPlayed[key] = now;
      fn();
    }
  }
  return {
    click() { beep(600, 0.04, "sine", 0.05); },
    grab() { beep(420, 0.05, "triangle", 0.05); },
    wallBounce() { throttled("wall", () => beep(220, 0.05, "square", 0.04), 90); },
    ballCollide() { throttled("ball", () => beep(340, 0.05, "square", 0.05), 90); },
    win() {
      beep(523, 0.1, "triangle", 0.09);
      beep(659, 0.12, "triangle", 0.09, 0.1);
      beep(784, 0.18, "triangle", 0.1, 0.2);
    },
    lose() {
      beep(196, 0.2, "sawtooth", 0.07);
      beep(147, 0.3, "sawtooth", 0.07, 0.17);
    },
    countdown() { beep(880, 0.07, "square", 0.05); },
  };
})();

// ===================== PAUSE (Pac-Man) =====================
/* Freezes the maze where it is: marbles stop, the clock stops, the joystick
   and keys do nothing; the same button becomes Resume. No pause popup. */
let gamePaused = false;
const pauseBtn = document.getElementById("pauseBtn");

function setPaused(next) {
  if (next && !gamePaused && (gameOver || adIsPlaying)) return;
  gamePaused = next;
  if (pauseBtn) {
    pauseBtn.innerHTML = gamePaused
      ? '<span class="ico">\u25B6</span><span class="lbl">Resume</span>'
      : '<span class="ico">\u23F8</span><span class="lbl">Pause</span>';
    pauseBtn.setAttribute("aria-pressed", String(gamePaused));
    pauseBtn.classList.toggle("is-paused", gamePaused);
  }
  if (gamePaused) releaseTilt(true);
  if (boardEl) boardEl.classList.toggle("is-paused", gamePaused);
}
if (pauseBtn) pauseBtn.addEventListener("click", () => setPaused(!gamePaused));

// ===================== GAME STATE =====================
let levelCfg = LEVELS[0];       // the level-table row being played
let currentConfig = null;       // its generated maze
let currentPhysics = null;
let previousTimestamp;
let gameInProgress = false;     // the physics loop is running
let gameOver = true;            // no level is being played right now
let levelWon = false;
let accelerationX, accelerationY, frictionX, frictionY;
let balls = [];
let collisionCount = 0;         // marble-to-marble only — for the no-collision bonus
let ballElements = [];
let holeElements = [];
let marblesHome = 0;
let tiltActive = false;

/* True when the board must stand still even though the game screen is up —
   Pac-Man's isBoardFrozen(): paused, a video ad, or the 5-ads dialog. */
function isBoardFrozen() {
  return gamePaused || adIsPlaying ||
    (!!confirmOverlayEl && !confirmOverlayEl.classList.contains("hidden"));
}

// ===================== TIMER (per maze, counting down) =====================
let secondsElapsed = 0;
let secondsRemaining = 0;
let currentTimeLimit = 0;
let timerInterval = null;

function formatTime(total) {
  const t = Math.max(0, total);
  return Math.floor(t / 60) + ":" + String(t % 60).padStart(2, "0");
}
function startTimer() {
  if (timerInterval) return;
  timerInterval = setInterval(() => {
    if (gameOver || isBoardFrozen() || !screens.game.classList.contains("active")) return;
    secondsElapsed += 1;
    secondsRemaining = currentTimeLimit - secondsElapsed;
    updateUI();
    if (secondsRemaining <= 5 && secondsRemaining > 0) SFX.countdown();
    if (secondsRemaining <= 0) handleGameOver("time");
  }, 1000);
}
function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
}
function resetTimer(limitSeconds) {
  stopTimer();
  currentTimeLimit = limitSeconds;
  secondsElapsed = 0;
  secondsRemaining = limitSeconds;
}

function stopLevelPlay() {
  gameInProgress = false;
  stopLoop();
  stopTimer();
  releaseTilt(true);
  gameOver = true;
}

// ===================== THE BOARD =====================
/* ---------- Fit the maze to the board ----------
   The maze is built at its natural size and scaled as one piece to fill the
   box Pac-Man gives its board, up as well as down.
   A tilted maze takes more room than a flat one: lifting one corner towards
   the player (and tilting on both axes at once) pushes its outline past the
   flat outline by up to ~15%. A fixed safety margin for that left a band of
   empty board around every maze, and still let the corners be cut off on a
   diagonal tilt. Instead, the flat maze fills the board, and while it is
   tilted the scale is brought down by exactly what that tilt needs (worked
   out from the four corners), so nothing is ever clipped. */
const FIT_MARGIN = 0.985;      // a hair of air inside the frame
const PERSPECTIVE_K = 3;       // perspective = 3x the maze's longer side
let tiltRY = 0, tiltRX = 0;    // the maze's current tilt, in degrees

function tiltGrowth(mw, mh, ryDeg, rxDeg) {
  if (!ryDeg && !rxDeg) return { gx: 1, gy: 1 };
  const P = PERSPECTIVE_K * Math.max(mw, mh);
  const a = (ryDeg * Math.PI) / 180, b = (-rxDeg * Math.PI) / 180;
  let mx = 0, my = 0;
  [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([sx, sy]) => {
    const x0 = (sx * mw) / 2, y0 = (sy * mh) / 2;
    // CSS "rotateY(a) rotateX(b)": rotateX acts on the point first
    const y1 = y0 * Math.cos(b), z1 = y0 * Math.sin(b);
    const x2 = x0 * Math.cos(a) + z1 * Math.sin(a);
    const z2 = -x0 * Math.sin(a) + z1 * Math.cos(a);
    const f = P / (P - z2);
    mx = Math.max(mx, Math.abs(x2 * f));
    my = Math.max(my, Math.abs(y1 * f));
  });
  return { gx: Math.max(1, mx / (mw / 2)), gy: Math.max(1, my / (mh / 2)) };
}

function fitMaze() {
  if (!boardEl || !mazeFitEl || !currentConfig) return;
  const cs = getComputedStyle(boardEl);
  const W = boardEl.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
  const H = boardEl.clientHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0);
  if (!(W > 0) || !(H > 0)) return;
  const mw = currentConfig.mazeWidth, mh = currentConfig.mazeHeight;
  const g = tiltGrowth(mw, mh, tiltRY, tiltRX);
  const s = Math.min(W / (mw * g.gx), H / (mh * g.gy)) * FIT_MARGIN;
  mazeFitEl.style.width = mw + "px";
  mazeFitEl.style.height = mh + "px";
  mazeFitEl.style.perspective = Math.round(PERSPECTIVE_K * Math.max(mw, mh)) + "px";
  mazeFitEl.style.transform = "translate(-50%, -50%) scale(" + Math.max(0.05, s).toFixed(4) + ")";
}

/* Every change of tilt goes through here: it turns the maze and re-fits it. */
function setMazeTilt(ry, rx) {
  tiltRY = ry;
  tiltRX = rx;
  mazeElement.style.transform = `rotateY(${ry}deg) rotateX(${-rx}deg)`;
  fitMaze();
}

/* Pac-Man sizes its canvas to the box its column leaves (boardHostBox), and
   the side rails / leaderboard are then placed against that box. The board
   element here takes exactly the same box. */
function resizeBoard() {
  if (!boardEl) return;
  const box = boardHostBox();
  if (box.w > 0 && box.h > 0) {
    boardEl.style.width = Math.floor(box.w) + "px";
    boardEl.style.height = Math.floor(box.h) + "px";
    boardEl.style.maxWidth = "100%";
    boardEl.style.maxHeight = "100%";
  }
  reshapeIfNotStarted();
  fitMaze();
  fitStats();
}

/* A maze nobody has touched yet follows the board if the board changes
   shape — the phone is turned, or the ads settle a moment after the level
   opened. Once the first tilt has happened the maze is the player's and is
   never swapped; it is only re-scaled. */
let currentShape = "";
function reshapeIfNotStarted() {
  if (!currentConfig || gameOver || gameInProgress || secondsElapsed > 0) return;
  const shape = mazeShapeForBoard(levelCfg);
  const key = shape.cols + "x" + shape.rows + "@" + shape.unitX.toFixed(1) + "x" + shape.unitY.toFixed(1);
  if (key === currentShape) return;
  currentShape = key;
  currentConfig = buildMazeConfig(shape);
  buildBoard();
}

function buildBoard() {
  previousTimestamp = undefined;
  gameInProgress = false;
  accelerationX = accelerationY = frictionX = frictionY = undefined;
  collisionCount = 0;
  marblesHome = 0;

  // world palette, or an equipped Shop maze theme
  const palette = currentMazePalette || worldForLevel(levelCfg.id);
  boardEl.style.setProperty("--maze-wall", palette.wall);
  boardEl.style.setProperty("--maze-bg", palette.bg);
  boardEl.classList.toggle("is-dark-world", !currentMazePalette && ["space", "lava"].includes(worldForLevel(levelCfg.id).id));
  mazeElement.style.width = currentConfig.mazeWidth + "px";
  mazeElement.style.height = currentConfig.mazeHeight + "px";
  tiltRY = tiltRX = 0;
  mazeElement.style.transform = "rotateY(0deg) rotateX(0deg)";
  endElement.style.width = currentConfig.endSize + "px";
  endElement.style.height = currentConfig.endSize + "px";

  mazeElement.querySelectorAll(".ball, .wall, .black-hole, .trail-dot").forEach((el) => el.remove());
  ballElements = [];
  holeElements = [];

  balls = currentConfig.ballStarts.map(({ x, y }) => ({ x, y, velocityX: 0, velocityY: 0 }));
  balls.forEach(({ x, y }) => {
    const ball = document.createElement("div");
    ball.className = "ball";
    ball.style.cssText = `left:${x}px; top:${y}px;`;
    mazeElement.appendChild(ball);
    ballElements.push(ball);
  });

  currentConfig.walls.forEach(({ x, y, horizontal, length }) => {
    const wall = document.createElement("div");
    wall.className = "wall";
    wall.style.cssText = `left:${x}px; top:${y}px; width:${wallW}px; height:${length}px; transform: rotate(${horizontal ? -90 : 0}deg);`;
    mazeElement.appendChild(wall);
  });

  currentConfig.holes.forEach(({ x, y, moving }) => {
    const hole = document.createElement("div");
    hole.className = "black-hole" + (moving ? " black-hole--moving" : "");
    hole.style.cssText = `left:${x}px; top:${y}px;`;
    mazeElement.appendChild(hole);
    holeElements.push(hole);
  });

  mazeElement.appendChild(endElement); // the ring stays on top
  fitMaze();
}

// ===================== TRAIL EFFECTS (shop) =====================
/* The Shop sold trails but nothing drew them. Each marble now leaves a short
   fading trail of dots in the equipped trail's colour. */
let lastTrailAt = 0;
function dropTrail(timestamp) {
  if (!currentTrail || currentTrail.id === "none") return;
  if (timestamp - lastTrailAt < 45) return;
  lastTrailAt = timestamp;
  balls.forEach((b) => {
    if (Math.abs(b.velocityX) + Math.abs(b.velocityY) < 0.25) return;
    const dot = document.createElement("div");
    dot.className = "trail-dot trail-" + currentTrail.id;
    dot.style.cssText = `left:${b.x}px; top:${b.y}px; --trail:${currentTrail.color};`;
    dot.addEventListener("animationend", () => dot.remove());
    mazeElement.insertBefore(dot, mazeElement.firstChild);
  });
}

// ===================== TILT: joystick + keyboard =====================
/* Orbit Maze's controls feed this one function: a tilt of -1..1 on each
   axis, where 1 is the original game's full tilt (22 degrees). */
const MAX_TILT_DEG = 22;
function applyTilt(nx, ny) {
  if (gameOver || isBoardFrozen() || !screens.game.classList.contains("active")) return;
  if (!tiltActive) {
    tiltActive = true;
    SFX.grab();
    setLastPlayedLevel(currentLevel);
    if (!gameInProgress) {
      gameInProgress = true;
      startTimer();
      startLoop();
    }
  }
  const rotationY = Math.max(-1, Math.min(1, nx)) * MAX_TILT_DEG;
  const rotationX = Math.max(-1, Math.min(1, ny)) * MAX_TILT_DEG;
  setMazeTilt(rotationY, rotationX);
  const gravity = currentPhysics ? currentPhysics.gravity : 2;
  const friction = currentPhysics ? currentPhysics.friction : 0.01;
  accelerationX = gravity * Math.sin((rotationY / 180) * Math.PI);
  accelerationY = gravity * Math.sin((rotationX / 180) * Math.PI);
  frictionX = gravity * Math.cos((rotationY / 180) * Math.PI) * friction;
  frictionY = gravity * Math.cos((rotationX / 180) * Math.PI) * friction;
}

/* Let go: the maze springs back level and the marbles roll on, slowed by
   friction, exactly like letting go of a real tilt-maze. */
let resetJoystickKnob = () => {};
function releaseTilt(force) {
  if (force) { keysHeld.clear(); resetJoystickKnob(); }
  if (!tiltActive) return;
  tiltActive = false;
  setMazeTilt(0, 0);
  const gravity = currentPhysics ? currentPhysics.gravity : 2;
  const friction = currentPhysics ? currentPhysics.friction : 0.01;
  if (accelerationX !== undefined) {
    accelerationX = 0;
    accelerationY = 0;
    frictionX = gravity * friction;
    frictionY = gravity * friction;
  }
}

/* Pac-Man's joystick (same markup, look and pointer handling), driving the
   tilt instead of a direction: the knob's offset is the tilt. Full tilt is
   reached at 80% of the radius, as in the original game's joystick. */
function initJoystick(joystickEl, joystickBase, joystickKnob) {
  if (!joystickEl || !joystickBase || !joystickKnob) return;
  let joyActive = false;
  let joyCenter = { x: 0, y: 0 };
  let joyRadius = 1;
  const KNOB_TRAVEL = 0.6;
  const FULL_TILT_AT = 0.8;
  /* A thumb resting on the stick wobbles a few px; inside this fraction of the
     radius the maze stays level instead of jittering. */
  const DEAD_ZONE = 0.1;
  const setKnob = (dx, dy) => {
    joystickKnob.style.transform = `translate(${dx * KNOB_TRAVEL}px, ${dy * KNOB_TRAVEL}px)`;
  };
  resetJoystickKnob = () => {
    joyActive = false;
    joystickEl.classList.remove("is-dragging");
    setKnob(0, 0);
  };
  const onPointerDown = (e) => {
    if (!screens.game.classList.contains("active") || gameOver || isBoardFrozen()) {
      try { joystickEl.releasePointerCapture(e.pointerId); } catch (_) {}
      return;
    }
    e.preventDefault();
    joyActive = true;
    joystickEl.classList.add("is-dragging");
    const rect = joystickBase.getBoundingClientRect();
    joyCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    joyRadius = rect.width / 2;
    onPointerMove(e);
  };
  const onPointerMove = (e) => {
    if (!joyActive) return;
    const rawX = e.clientX - joyCenter.x;
    const rawY = e.clientY - joyCenter.y;
    let dx = rawX, dy = rawY;
    const dist = Math.hypot(dx, dy);
    if (dist > joyRadius) { dx = (dx / dist) * joyRadius; dy = (dy / dist) * joyRadius; }
    setKnob(dx, dy);
    const dead = joyRadius * DEAD_ZONE;
    if (Math.hypot(rawX, rawY) < dead) { releaseTilt(); return; }
    const full = joyRadius * FULL_TILT_AT;
    applyTilt(rawX / full, rawY / full);
  };
  const onPointerUp = (e) => {
    if (!joyActive) return;
    resetJoystickKnob();
    releaseTilt();
    try { joystickEl.releasePointerCapture(e.pointerId); } catch (_) {}
  };
  joystickEl.addEventListener("pointerdown", (e) => {
    try { joystickEl.setPointerCapture(e.pointerId); } catch (_) {}
    onPointerDown(e);
  });
  joystickEl.addEventListener("pointermove", onPointerMove);
  joystickEl.addEventListener("pointerup", onPointerUp);
  joystickEl.addEventListener("pointercancel", onPointerUp);
  joystickEl.addEventListener("lostpointercapture", onPointerUp);
  joystickEl.addEventListener("click", (e) => e.preventDefault());
  joystickEl.addEventListener("contextmenu", (e) => e.preventDefault());
}
initJoystick(
  document.getElementById("joystick"),
  document.getElementById("joystickBase"),
  document.getElementById("joystickKnob")
);

/* Keyboard tilt (arrows / WASD), held keys combine for diagonals. */
const keysHeld = new Set();
const KEY_DIRS = {
  ArrowUp: [0, -1], w: [0, -1], W: [0, -1],
  ArrowDown: [0, 1], s: [0, 1], S: [0, 1],
  ArrowLeft: [-1, 0], a: [-1, 0], A: [-1, 0],
  ArrowRight: [1, 0], d: [1, 0], D: [1, 0],
};
function tiltFromKeys() {
  let nx = 0, ny = 0;
  keysHeld.forEach((k) => { nx += KEY_DIRS[k][0]; ny += KEY_DIRS[k][1]; });
  nx = Math.max(-1, Math.min(1, nx));
  ny = Math.max(-1, Math.min(1, ny));
  if (nx || ny) applyTilt(nx, ny);
  else releaseTilt();
}
document.addEventListener("keyup", (e) => {
  if (!KEY_DIRS[e.key]) return;
  // releasing either case of a letter lets go of both
  [e.key, e.key.toLowerCase(), e.key.toUpperCase()].forEach((k) => keysHeld.delete(k));
  if (screens.game.classList.contains("active")) tiltFromKeys();
});
window.addEventListener("blur", () => releaseTilt(true));

// ===================== UI + LEVEL LIFECYCLE =====================
function updateUI() {
  /* Two forms of the clock: "1:05" and, for the narrowest phone bars where
     every pixel beside the joystick counts, plain seconds "65". */
  timeEl.innerHTML = '<span class="t-long">' + formatTime(secondsRemaining) +
    '</span><span class="t-short">' + Math.max(0, secondsRemaining) + "</span>";
  marblesEl.textContent = marblesHome + "/" + levelCfg.balls;
  boardEl.classList.toggle("time-low", !gameOver && secondsRemaining > 0 && secondsRemaining <= 5);
  /* Split so a very narrow bar can drop the word and keep the number
     ("Level 7" -> "L7"), as in Pac-Man. */
  levelTitleEl.innerHTML =
    '<span class="lvl-word">Level</span><span class="lvl-num">' + currentLevel + "</span>";
  prevLevelBtn.disabled = currentLevel <= 1;
  nextLevelBtn.disabled = !isLevelUnlocked(currentLevel + 1);
  fitStats();
}

/* ---------- The maze takes the board's shape ----------
   The level table gives each maze a size (columns x rows). The SAME number
   of cells is laid out in the shape of the board it is played on, so a tall
   phone gets a tall maze and a wide desktop a wide one, and the maze fills
   the board instead of sitting in a band across its middle. Cells, marbles,
   holes, time and physics are all unchanged; only the grid's proportions
   follow the screen. */
function mazeShapeForBoard(level) {
  const cells = level.cols * level.rows;
  const W = boardEl ? boardEl.clientWidth : 0;
  const H = boardEl ? boardEl.clientHeight : 0;
  if (!(W > 0) || !(H > 0)) return level;
  const aspect = W / H;
  let cols = Math.max(4, Math.round(Math.sqrt(cells * aspect)));
  let rows = Math.max(4, Math.round(cells / cols));
  // never fewer cells than the table asks for
  while (cols * rows < cells) { if (cols / rows < aspect) cols++; else rows++; }
  /* A whole number of cells rarely matches the board's shape exactly (a
     6 x 5 grid on a 1.4 : 1 board left ~115px bands either side). The cells
     are stretched along the short axis to close that gap — by at most 25%,
     and never shrunk, so corridors only ever get roomier. */
  const STRETCH_MAX = 1.25;
  const gridAspect = cols / rows;
  let unitX = unit, unitY = unit;
  if (gridAspect < aspect) unitX = unit * Math.min(STRETCH_MAX, aspect / gridAspect);
  else unitY = unit * Math.min(STRETCH_MAX, gridAspect / aspect);
  return Object.assign({}, level, { cols, rows, unitX, unitY });
}

/* ---------- Keep the readouts clear of the joystick ----------
   Pac-Man's bar holds "Score 0 / Lives 3"; Orbit Maze's "200 / 0/4" can be
   a few pixels wider on the narrowest phones. When the stats would run under
   the joystick, their text is eased down (never below 80%) until they fit;
   on every other screen nothing changes and Pac-Man's sizes stand. */
function fitStats() {
  const sb = document.querySelector("#gameScreen .scoreboard");
  const joy = document.getElementById("joystick");
  if (!sb || !joy || !screens.game.classList.contains("active")) return;
  const kids = [...sb.children];
  kids.forEach((c) => c.style.removeProperty("font-size"));
  const jl = joy.getBoundingClientRect().left;
  if (!(jl > 0)) return;
  const base = kids.map((c) => parseFloat(getComputedStyle(c).fontSize) || 12);
  let k = 1;
  const right = () => Math.max(...kids.map((c) => c.getBoundingClientRect().right));
  while (right() > jl - 4 && k > 0.8) {
    k -= 0.04;
    kids.forEach((c, i) => c.style.setProperty("font-size", (base[i] * k).toFixed(2) + "px", "important"));
  }
}

function startLevel(level) {
  currentLevel = Math.min(Math.max(level, 1), TOTAL_LEVELS);
  levelCfg = LEVELS[currentLevel - 1];
  stopLevelPlay();
  /* the board's box has to be known before the maze is shaped: show the
     game screen and size the board first (Pac-Man's order), then build */
  hideOverlay();
  showScreen("game");
  resizeBoard();
  const shape = mazeShapeForBoard(levelCfg);
  currentShape = shape.cols + "x" + shape.rows + "@" + shape.unitX.toFixed(1) + "x" + shape.unitY.toFixed(1);
  currentConfig = buildMazeConfig(shape);
  currentPhysics = difficultyPhysics(levelCfg.id);
  gameOver = false;
  levelWon = false;
  resetTimer(levelCfg.timeLimit);
  resumeSnapshot = null;
  restartAdUsedThisRun = false;
  restartBtn.disabled = false;
  buildBoard();
  updateUI();
  resizeBoard();
  // second fit after the rails / bar have settled (Pac-Man's double rAF)
  requestAnimationFrame(() => requestAnimationFrame(resizeBoard));
}

/* ===================== Ball-to-ball collisions ===================== */
// Two marbles are never allowed to occupy (or pass through) the same spot:
// when they touch, push them apart and swap the velocity along the line
// connecting their centers (equal-mass elastic bounce), so with 2+ balls
// they stay two separate marbles instead of visually merging into one.
function resolveBallCollisions(allBalls) {
  const minDist = ballSize; // sum of both radii
  const restitution = 0.85; // slight energy loss on bounce, feels natural

  for (let i = 0; i < allBalls.length; i++) {
    for (let j = i + 1; j < allBalls.length; j++) {
      const a = allBalls[i];
      const b = allBalls[j];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let dist = Math.sqrt(dx * dx + dy * dy);

      if (dist >= minDist) continue;

      if (dist === 0) {
        // Exactly coincident (rare) - nudge apart on an arbitrary axis.
        dx = 0.01;
        dy = 0;
        dist = 0.01;
      }

      const nx = dx / dist;
      const ny = dy / dist;

      // Separate so the marbles are just touching, not overlapping.
      const overlap = minDist - dist;
      a.x -= (nx * overlap) / 2;
      a.y -= (ny * overlap) / 2;
      b.x += (nx * overlap) / 2;
      b.y += (ny * overlap) / 2;

      // Swap the velocity component along the collision normal.
      const avn = a.velocityX * nx + a.velocityY * ny;
      const bvn = b.velocityX * nx + b.velocityY * ny;

      /* Only a real impact counts. Two marbles resting against each other on
         a tilted board overlap by a hair every frame; that used to add a
         "collision" (and a click sound) 60 times a second, wiping out the
         no-collision bonus for marbles that never actually hit. */
      if (avn - bvn > 0.05) {
        collisionCount++;
        SFX.ballCollide();
      }
      const avtX = a.velocityX - avn * nx;
      const avtY = a.velocityY - avn * ny;
      const bvtX = b.velocityX - bvn * nx;
      const bvtY = b.velocityY - bvn * ny;

      a.velocityX = avtX + bvn * nx * restitution;
      a.velocityY = avtY + bvn * ny * restitution;
      b.velocityX = bvtX + avn * nx * restitution;
      b.velocityY = bvtY + avn * ny * restitution;
    }
  }
}

/* ===================== Wall collision =====================
   One routine for both wall directions. It used to be written out twice —
   once for horizontal walls (x along the wall, y across it) and once more,
   letter-swapped, for vertical walls — 60 near-identical lines where a fix
   made to one copy could silently miss the other. The axis names are now
   picked once per wall; the steps and their order are exactly the original
   engine's (rounded end-cap first, then the far cap, then the flat side). */
function collideWithWall(ball, wall) {
  const H = wall.horizontal;
  const along = H ? "x" : "y";          // the axis the wall runs along
  const across = H ? "y" : "x";         // the axis it blocks
  const nextAlong = H ? "nextX" : "nextY";
  const nextAcross = H ? "nextY" : "nextX";
  const velAcross = H ? "velocityY" : "velocityX";
  const wallAcross = wall[across];

  if (ball[nextAcross] + ballSize / 2 < wallAcross - wallW / 2 ||
      ball[nextAcross] - ballSize / 2 > wallAcross + wallW / 2) return;

  const wallStart = { x: wall.x, y: wall.y };
  const wallEnd = H ? { x: wall.x + wall.length, y: wall.y } : { x: wall.x, y: wall.y + wall.length };
  const startAlong = wallStart[along];
  const endAlong = wallEnd[along];

  // rounded cap at the start of the wall
  if (ball[nextAlong] + ballSize / 2 >= startAlong - wallW / 2 && ball[nextAlong] < startAlong) {
    rollOffCap(ball, wallStart);
  }
  // rounded cap at the end of the wall
  if (ball[nextAlong] - ballSize / 2 <= endAlong + wallW / 2 && ball[nextAlong] > endAlong) {
    rollOffCap(ball, wallEnd);
  }
  // the flat side
  if (ball[nextAlong] >= startAlong && ball[nextAlong] <= endAlong) {
    if (ball[nextAcross] < wallAcross) ball[nextAcross] = wallAcross - wallW / 2 - ballSize / 2;
    else ball[nextAcross] = wallAcross + wallW / 2 + ballSize / 2;
    ball[across] = ball[nextAcross];
    ball[velAcross] = -ball[velAcross] / 3;
    if (Math.abs(ball[velAcross]) > 0.15) SFX.wallBounce();
  }
}
function rollOffCap(ball, cap) {
  const distance = distance2D(cap, { x: ball.nextX, y: ball.nextY });
  if (distance < ballSize / 2 + wallW / 2) {
    const closest = closestItCanBe(cap, { x: ball.nextX, y: ball.nextY });
    const rolled = rollAroundCap(cap, { x: closest.x, y: closest.y, velocityX: ball.velocityX, velocityY: ball.velocityY });
    Object.assign(ball, rolled);
  }
}

/* ===================== One physics loop, never two =====================
   The loop re-queues itself every frame. Starting it from a tilt, a resume
   or a continue while a frame from the previous level was still queued used
   to leave TWO loops running — marbles moved at double speed. Every start
   now cancels whatever frame is queued first. */
let loopHandle = 0;
function scheduleLoop() {
  loopHandle = window.requestAnimationFrame(main);
}
function startLoop() {
  window.cancelAnimationFrame(loopHandle);
  previousTimestamp = undefined;
  scheduleLoop();
}
function stopLoop() {
  window.cancelAnimationFrame(loopHandle);
  loopHandle = 0;
}

/* One axis of the original engine's velocity step. Flat: friction can only
   slow the marble. Tilted: accelerate, apply friction against the tilt, clamp.
   (The X and Y axes used to be written out separately and had drifted apart:
   X was clamped twice, Y once.) */
function stepVelocity(v, change, frictionDelta, maxV) {
  if (change === 0) return slow(v, frictionDelta);
  return Math.minmax(v + change - Math.sign(change) * frictionDelta, maxV);
}

/* After a Continue the marbles are put back where they were, and a MOVING
   hole may be sitting right on one of them — the very next frame used to
   end the run again before the player could touch anything. Holes are
   harmless for this long after a continue. */
const CONTINUE_GRACE_MS = 1500;
let holeGraceUntil = 0;

function main(timestamp) {
  if (!gameInProgress) return;

  /* Pac-Man's freeze: paused, an ad, or the unlock dialog in front of the
     board. Keep the loop alive but advance nothing, and forget the clock so
     the first frame after resuming is not charged for the whole pause. */
  if (isBoardFrozen() || !screens.game.classList.contains("active")) {
    previousTimestamp = undefined;
    scheduleLoop();
    return;
  }

  if (previousTimestamp === undefined) {
    previousTimestamp = timestamp;
    scheduleLoop();
    return;
  }

  const maxVelocity = 2.4;
  // capped so a stalled frame can never carry a marble through a wall
  const timeElapsed = Math.min(3, (timestamp - previousTimestamp) / 16);

  // Moving obstacles: oscillate within their own cell (see buildMazeConfig),
  // then push the new position into the DOM so they're visible moving too.
  if (currentConfig.holes.some((h) => h.moving)) {
    const t = timestamp / 1000;
    currentConfig.holes.forEach((hole, hi) => {
      if (!hole.moving) return;
      const offset = Math.sin(t * hole.speed + hole.phase) * hole.range;
      if (hole.axis === "x") hole.x = hole.baseX + offset;
      else hole.y = hole.baseY + offset;
      holeElements[hi].style.left = hole.x + "px";
      holeElements[hi].style.top = hole.y + "px";
    });
  }

  try {
    if (accelerationX !== undefined && accelerationY !== undefined) {
      const velocityChangeX = accelerationX * timeElapsed;
      const velocityChangeY = accelerationY * timeElapsed;
      const frictionDeltaX = frictionX * timeElapsed;
      const frictionDeltaY = frictionY * timeElapsed;

      balls.forEach((ball) => {
        ball.velocityX = stepVelocity(ball.velocityX, velocityChangeX, frictionDeltaX, maxVelocity);
        ball.velocityY = stepVelocity(ball.velocityY, velocityChangeY, frictionDeltaY, maxVelocity);

        ball.nextX = ball.x + ball.velocityX;
        ball.nextY = ball.y + ball.velocityY;

        currentConfig.walls.forEach((wall) => collideWithWall(ball, wall));

        if (levelCfg.holes > 0 && performance.now() >= holeGraceUntil) {
          currentConfig.holes.forEach((hole, hi) => {
            const distance = distance2D(hole, { x: ball.nextX, y: ball.nextY });
            if (distance <= holeSize / 2) {
              holeElements[hi].style.backgroundColor = "red";
              throw new Error("The ball fell into a hole");
            }
          });
        }

        ball.x = ball.x + ball.velocityX;
        ball.y = ball.y + ball.velocityY;
      });

      resolveBallCollisions(balls);

      balls.forEach(({ x, y }, index) => {
        ballElements[index].style.cssText = `left:${x}px; top:${y}px;`;
      });
      dropTrail(timestamp);
    }

    const centerX = currentConfig.mazeWidth / 2;
    const centerY = currentConfig.mazeHeight / 2;
    const home = balls.filter((ball) => distance2D(ball, { x: centerX, y: centerY }) < currentConfig.endSize / 2).length;
    if (home !== marblesHome) { marblesHome = home; updateUI(); }
    if (home === balls.length) {
      handleLevelWin();
    } else {
      previousTimestamp = timestamp;
      scheduleLoop();
    }
  } catch (error) {
    if (error.message === "The ball fell into a hole") {
      handleGameOver("hole");
    } else {
      throw error;
    }
  }
}
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
  const host = boardEl ? boardEl.parentElement : null;
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

/* ---------- Board shape range (Pac-Man's numbers) ----------
   Pac-Man's ad layout reads the narrowest and widest shapes its board can be
   drawn in (minBoardAspect / maxBoardAspect, from its camera tilt range) to
   decide one rail or two and how tall the leaderboard band may be. The same
   two numbers are kept here, so the ads land exactly where Pac-Man's do. */
function minBoardAspect() {
  const r = (76 * Math.PI) / 180;
  return 28 / (31 * Math.sin(r) + 0.28 * Math.cos(r));
}
function maxBoardAspect() {
  const r = (44 * Math.PI) / 180;
  return 28 / (31 * Math.sin(r) + 0.28 * Math.cos(r));
}

function boardBoxNoBand() {
  const gs = document.getElementById("gameScreen");
  const host = boardEl ? boardEl.parentElement : null;
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
  wireAdClick(el, ad);
  el.classList.remove("hidden");

  /* MREC, 300x250. Same reasoning as the side rails: one <img> at the exact
     IAB size beats four stacked elements that each have to land in the right
     place. The unit scales down as a whole on narrow popups, keeping 6:5. */
  if (ad.imageUrl) {
    el.removeAttribute("style");
    el.innerHTML =
      '<img class="ad-unit-img" src="' + escHtml(ad.imageUrl) + '" width="300" height="250" alt="' +
      escHtml(ad.advertiser || "Advertisement") + '" />' + adDotsHtml(ad);
    return;
  }

  const bgFrom = ad.bgFrom || "#6a3fb5";
  const title = escHtml(ad.title || ad.advertiser || "Sponsored");
  const subtitle = escHtml(ad.subtitle || "Free \u00b7 Sponsored");
  const cta = escHtml(ad.ctaText || "Learn More");
  const rating = Math.round(ad.rating || 4.5);
  const stars = "\u2605".repeat(Math.min(5, rating)) + "\u2606".repeat(Math.max(0, 5 - rating));

  el.removeAttribute("style");
  el.innerHTML =
    /* Solid background, not a gradient: a two-tone diagonal across a small
       card reads as two different-coloured strips once the unit is scaled
       down rather than as one card, which is what "different colours top
       and bottom" was. One flat colour stays one colour at any scale. */
    '<div class="ad-mrec" style="background:' + escHtml(bgFrom) + '">' +
      '<span class="ad-mrec-tag">AD</span>' +
      '<div class="ad-mrec-icon"><img alt="" src="' + escHtml(ad.streamUrl) + '"></div>' +
      '<div class="ad-mrec-title">' + title + "</div>" +
      '<div class="ad-mrec-stars">' + stars + "</div>" +
      '<div class="ad-mrec-sub">' + subtitle + "</div>" +
      '<button type="button" class="ad-mrec-cta">' + cta + "</button>" +
    "</div>";

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


/* The win / Game Over popups open after a 150ms beat (Pac-Man). The timer is
   kept so anything that leaves the board inside those 150ms can cancel it. */
let resultPopupTimer = null;

/* Orbit Maze's own reward: 20 for the clear, +15 with a quarter of the time
   still left, +10 with no marble-to-marble collisions; paid on every clear. */
function levelCoinReward() {
  let coins = 20;
  if (secondsRemaining >= currentTimeLimit * 0.25) coins += 15;
  if (collisionCount === 0) coins += 10;
  return coins;
}

function handleLevelWin() {
  gameInProgress = false;
  stopLoop();
  stopTimer();
  releaseTilt(true);
  gameOver = true;
  levelWon = true;
  setPaused(false);
  updateUI();
  SFX.win();
  markLevelCompleted(currentLevel);
  const coinsEarned = levelCoinReward();
  addCoins(coinsEarned);
  const clearedTime = formatTime(secondsElapsed);
  const spareTime = formatTime(secondsRemaining);

  clearTimeout(resultPopupTimer);
  resultPopupTimer = setTimeout(() => {
    resultPopupTimer = null;
    const isLast = currentLevel >= TOTAL_LEVELS;
    const clearedLevel = currentLevel;

    modalTitle.textContent = "\u{1F389} Congratulations!";
    /* Same length as Pac-Man's line, so the popup keeps Pac-Man's size:
       the time left over stands where Pac-Man puts the score. */
    modalMessage.textContent = isLast
      ? `You cleared all ${TOTAL_LEVELS} mazes! The last one took ${clearedTime}.`
      : `Level ${clearedLevel} cleared with ${spareTime} to spare. Level ${clearedLevel + 1} is now unlocked.`;
    modalCoins.textContent = `+${coinsEarned} \u{1FA99} coins`;
    modalCoins.classList.remove("hidden");
    continueAdBtn.classList.add("hidden");
    continueNote.classList.add("hidden");
    loadLevelCompleteBanner();

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
               level was already earned by clearing this one. */
            modalPrimaryBtn.disabled = false;
            startLevel(clearedLevel + 1);
          });
        } else {
          startLevel(clearedLevel + 1);
        }
      },
      () => goToLevelSelect()
    );
    setModalPrevLevel(clearedLevel > 1 ? clearedLevel - 1 : 0);
    overlay.classList.remove("hidden");
  }, 150);
}

/* ---------- Resume-from-here continue ----------
   Game Over (a marble in a black hole, or the clock at zero) can be undone
   by watching an ad, with NO limit (Pac-Man). Orbit Maze's own part is kept:
   the run picks up exactly where it broke — same maze, same holes, every
   marble back on its spot — and, Pac-Man's "full lives" rule, the FULL time
   limit goes back on the clock. Marbles are put back at rest, so the one
   that was lost is not carried straight back into the same hole. */
let resumeSnapshot = null;

function takeResumeSnapshot() {
  if (!balls || !balls.length) { resumeSnapshot = null; return; }
  resumeSnapshot = {
    levelId: currentLevel,
    collisions: collisionCount,
    elapsedBefore: secondsElapsed,
    balls: balls.map((b) => ({ x: b.x, y: b.y })),
  };
}

function restoreFromSnapshot(snap) {
  collisionCount = snap.collisions;
  accelerationX = accelerationY = frictionX = frictionY = undefined;
  setMazeTilt(0, 0);
  holeElements.forEach((hole) => { hole.style.backgroundColor = ""; });
  balls.forEach((b, i) => {
    const saved = snap.balls[i];
    if (!saved) return;
    b.x = saved.x;
    b.y = saved.y;
    b.velocityX = 0;
    b.velocityY = 0;
    if (ballElements[i]) ballElements[i].style.cssText = `left:${saved.x}px; top:${saved.y}px;`;
  });
  previousTimestamp = undefined;
}

function handleGameOver(reason) {
  if (gameOver) return;
  takeResumeSnapshot();
  gameInProgress = false;
  stopLoop();
  stopTimer();
  releaseTilt(true);
  gameOver = true;
  setPaused(false);
  updateUI();
  SFX.lose();
  clearTimeout(resultPopupTimer);
  resultPopupTimer = setTimeout(() => {
    resultPopupTimer = null;
    modalTitle.textContent = "Game Over \u{1F480}";
    modalMessage.textContent = reason === "hole"
      ? "A marble fell into a hole. Try again?"
      : "Time's up on this maze. Try again?";
    modalCoins.classList.add("hidden");
    modalBannerAd.classList.add("hidden");
    modalBannerAd.innerHTML = "";
    stopModalBannerCarousel();

    continueAdBtn.classList.remove("hidden");
    continueAdBtn.disabled = false;
    continueNote.classList.remove("hidden");
    continueNote.textContent = "Watch a short ad to pick up right where you were \u2014 with the full " +
      formatTime(levelCfg.timeLimit) + " back on the clock.";

    wireModalButtons(
      "\u{1F501} Retry Level",
      "\u{1F5FA} Level Select",
      () => startLevel(currentLevel),
      () => goToLevelSelect()
    );
    overlay.classList.remove("hidden");
  }, 150);
}

let continueAdInFlight = false;
function grantContinue() {
  if (continueAdInFlight || !gameOver || levelWon) return;
  continueAdInFlight = true;
  continueAdBtn.disabled = true;
  overlay.classList.add("hidden");
  stopModalBannerCarousel();
  playVideoAd({
    placement: "continue",
    rewardText: "Watch the ad to carry on from here \u2014 every marble stays where it was.",
  }).then((res) => {
    continueAdInFlight = false;
    /* No ad shown -> no continue. Back to the Game Over popup. */
    if (!res || !res.shown) {
      continueAdBtn.disabled = false;
      continueNote.textContent = "The ad couldn't load, so no continue was given. Please try again.";
      overlay.classList.remove("hidden");
      return;
    }
    const snap = resumeSnapshot && resumeSnapshot.levelId === currentLevel ? resumeSnapshot : null;
    if (snap) restoreFromSnapshot(snap);
    holeGraceUntil = performance.now() + CONTINUE_GRACE_MS;
    resetTimer(levelCfg.timeLimit);
    gameOver = false;
    updateUI();
    gameInProgress = true;
    startTimer();
    startLoop();
  });
}
if (continueAdBtn) {
  continueAdBtn.addEventListener("click", grantContinue);
}
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
    startLevel(currentLevel);
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
  if (typeof setPaused === "function") setPaused(false);
  Object.values(screens).forEach((s) => s.classList.remove("active"));
  screens[name].classList.add("active");
  // Sound should only ever be heard during actual gameplay — stop it the
  // moment we're on any other screen (menu, level select, how-to-play).
  if (name !== "game") {
    stopLevelPlay();
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

/* Orbit Maze's five worlds take the place of Pac-Man's difficulty words:
   the tile you can start from says which world it is in. The class keys
   keep Pac-Man's colour hooks (the fifth world reuses "expert"). */
function getDifficultyTier(level) {
  const w = worldForLevel(level);
  const key = { grass: "easy", desert: "medium", ice: "hard", space: "expert", lava: "expert" }[w.id];
  return { key, label: w.name };
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

// ===================== KEYBOARD =====================
// Escape / P toggle Pause; arrows / WASD tilt the maze (Pac-Man's keys).
document.addEventListener("keydown", (e) => {
  if (!screens.game.classList.contains("active")) return;
  if (e.key === "Escape" || e.key === "p" || e.key === "P") {
    e.preventDefault();
    if (!overlay.classList.contains("hidden") || adIsPlaying ||
        !confirmOverlayEl.classList.contains("hidden")) return;
    setPaused(!gamePaused);
    return;
  }
  if (KEY_DIRS[e.key]) {
    e.preventDefault();
    if (!overlay.classList.contains("hidden")) return;
    keysHeld.add(e.key);
    tiltFromKeys();
  }
});

// ===================== INIT =====================
checkSession();
applyEquippedCosmetics();
updateCoinDisplays();
setMuted(soundMuted);
buildLevelGrid();
showScreen("menu");

/* Page-visibility: a live maze is auto-paused when the tab / app goes to
   the background, so the player comes back to a paused board with the
   clock stopped (Pac-Man). */
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    releaseTilt(true);
    if (screens.game.classList.contains("active") && !gameOver && !adIsPlaying) {
      setPaused(true);
    }
  } else {
    // coming back: has the 24-hour session run out meanwhile?
    checkSession();
    if (screens.game.classList.contains("active")) resizeBoard();
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
/* Equal gap placeLeaderboardTop() leaves above the portrait leaderboard AND
   between it and the maze — 10px reads as a card that has been placed, the
   4px RAIL_EDGE this used to sit at read as one stuck to the screen edge. */
const LEADERBOARD_MARGIN = 5;
/* Short side at or below this = a phone (isPhoneWidth()). */
const PHONE_NO_RAIL_MAX_W = 500;


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
      '<div class="ad-rail-icon"><img alt="" src="' + escHtml(ad.streamUrl) + '"></div>' +
      '<div class="ad-rail-title">' + escHtml(ad.title || ad.advertiser || "Sponsored") + "</div>" +
      '<div class="ad-rail-stars">' + stars + "</div>" +
      '<div class="ad-rail-subtitle">' + escHtml(ad.subtitle || "Free \u00b7 Sponsored") + "</div>" +
      '<div class="ad-rail-sponsored">Sponsored</div>' +
    "</div>" +
    '<button type="button" class="ad-rail-cta">' + escHtml(ad.ctaText || "Learn More") + "</button>"
  );
}

/* A creative with `imageUrl` is a whole-unit STATIC IMAGE: one file that is
   already the full 300x600, drawn as a single <img> and nothing else. That is
   what an IAB static unit is, and it removes every way a card could come out
   blank — there is no gradient to compute, no icon to place, no four pieces of
   text to lay out. Creatives without `imageUrl` still get the old assembled
   card, so a catalogue that only supplies an icon keeps working. */
function buildRailCard(el, ad) {
  wireAdClick(el, ad);

  if (ad.imageUrl) {
    el.style.background = ad.bgBottom || ad.bgFrom || "#1b2437"; // not setAttribute("style"): that would wipe left/top/--ad-scale
    el.innerHTML =
      '<img class="ad-unit-img" src="' + escHtml(ad.imageUrl) + '" width="300" height="600" alt="' +
      escHtml(ad.advertiser || "Advertisement") + '" />';
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
    '<div class="ad-leaderboard-icon"><img alt="" src="' + escHtml(ad.streamUrl) + '"></div>' +
    '<div class="ad-leaderboard-text">' +
      '<div class="ad-leaderboard-title">' + escHtml(ad.title || ad.advertiser || "Sponsored") + "</div>" +
      '<div class="ad-leaderboard-subtitle">' + escHtml(ad.subtitle || "Free \u00b7 Sponsored") + "</div>" +
    "</div>" +
    '<button type="button" class="ad-leaderboard-cta">' + escHtml(ad.ctaText || "Learn More") + "</button>"
  );
}

function buildLeaderboardCard(el, ad) {
  if (!el || !ad) return;
  wireAdClick(el, ad);

  // Same whole-unit static image path as buildRailCard(): a creative with
  // imageUrl is already the full 970x90, drawn as a single <img>. The
  // assembled layout's 0 22px side padding (breathing room for the tag,
  // icon, text and CTA) would otherwise inset a full-bleed image by 22px
  // on each side, so this class drops it to 0 for the image case only.
  el.classList.toggle("has-image-ad", !!ad.imageUrl);
  if (ad.imageUrl) {
    el.style.background = ad.bgFrom || "#1b2437"; // not setAttribute("style"): that would wipe left/top/--ad-scale
    el.innerHTML =
      '<img class="ad-unit-img" src="' + escHtml(ad.imageUrl) + '" width="970" height="90" alt="' +
      escHtml(ad.advertiser || "Advertisement") + '" />' + adDotsHtml(ad);
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

/* ---------- One slide transition for every rotating ad slot ----------
   The leaderboard and the side rails used to carry two copies of this
   routine. The copies had drifted: only the leaderboard honoured "reduce
   motion" (the rails slid regardless), the rail copy carried a dead
   empty-dots variable, and both built the finished image by pasting the
   advertiser's name into an HTML string. One routine now serves both, builds
   the image as an element (the name is set as text, never as markup) and
   honours reduce-motion everywhere. */
function makeAdImg(ad, w, h) {
  const img = document.createElement("img");
  img.className = "ad-unit-img";
  img.width = w;
  img.height = h;
  img.alt = ad.advertiser || "Advertisement";
  img.src = ad.imageUrl;
  return img;
}
function slideAdCard(el, ad, opts) {
  if (!el || !ad) return Promise.resolve();
  if (!ad.imageUrl) return swapAdCard(el, () => opts.build(el, ad));
  const oldImg = el.querySelector(".ad-unit-img");
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!oldImg || reduce) {
    opts.build(el, ad);
    return Promise.resolve();
  }
  el.classList.add("ad-sliding");
  const track = document.createElement("div");
  track.className = "ad-slide-track";
  track.appendChild(oldImg.cloneNode(true));
  track.appendChild(makeAdImg(ad, opts.w, opts.h));
  el.innerHTML = "";
  el.appendChild(track);
  el.style.background = opts.bg;
  wireAdClick(el, ad);
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => track.classList.add("slide-next")));
    setTimeout(() => {
      // keep only the creative that slid in (plus its dots, if the slot has them)
      el.innerHTML = "";
      el.appendChild(makeAdImg(ad, opts.w, opts.h));
      if (opts.dots) el.insertAdjacentHTML("beforeend", opts.dots(ad));
      el.classList.remove("ad-sliding");
      resolve();
    }, 430);
  });
}
function slideLeaderboardCard(el, ad) {
  return slideAdCard(el, ad, {
    w: 970, h: 90, bg: (ad && ad.bgFrom) || "#1b2437",
    build: buildLeaderboardCard, dots: adDotsHtml,
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
  return slideAdCard(el, ad, {
    w: 300, h: 600, bg: (ad && (ad.bgBottom || ad.bgFrom)) || "#1b2437",
    build: buildRailCard,
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
  resizeBoard();
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
  const canvasEl = document.getElementById("gameBoard");

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
  const watchedBoard = document.getElementById("gameBoard");
  if (watchedBoard) boardWatcher.observe(watchedBoard);
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
