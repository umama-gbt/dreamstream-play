(function () {
  "use strict";

  /* ---------- Safe storage ----------
     BUG FIX: every save went straight to window.localStorage. Where the
     browser blocks storage — a game embedded in a sandboxed iframe on a game
     portal, Safari with "Block all cookies", some privacy modes — merely
     touching localStorage throws a SecurityError, and the very first call at
     start-up killed the whole game (blank board, dead buttons). This wrapper
     uses localStorage when it works and falls back to memory for the session
     when it doesn't (progress then lasts until the page closes instead of the
     game not starting at all). Also covers a full storage quota on write. */
  const store = (function () {
    let ls = null;
    try {
      ls = window.localStorage;
      ls.setItem("__ms_probe", "1");
      ls.removeItem("__ms_probe");
    } catch (e) {
      ls = null;
    }
    const mem = new Map(); // keys held here when storage is unavailable or a write failed
    return {
      getItem(k) {
        if (mem.has(k)) return mem.get(k);
        try { return ls ? ls.getItem(k) : null; } catch (e) { return null; }
      },
      setItem(k, v) {
        v = String(v);
        try { if (ls) { ls.setItem(k, v); mem.delete(k); return; } } catch (e) {}
        mem.set(k, v);
      },
      removeItem(k) {
        mem.delete(k);
        try { if (ls) ls.removeItem(k); } catch (e) {}
      },
    };
  })();

  // ---------- Level configuration (30 levels) ----------
  // Board size and mine count grow steadily across 30 levels, keeping a
  // realistic mine density (~12% on level 1 up to ~28% on level 30).
  const RAW_LEVELS = [
    [1, 15, 10, 19, "Beginner"],
    [2, 16, 10, 22, "Beginner"],
    [3, 16, 11, 26, "Beginner"],
    [4, 17, 11, 29, "Beginner"],
    [5, 17, 12, 33, "Easy"],
    [6, 18, 12, 37, "Easy"],
    [7, 19, 12, 42, "Easy"],
    [8, 19, 13, 47, "Easy"],
    [9, 20, 13, 51, "Easy"],
    [10, 20, 14, 57, "Medium"],
    [11, 21, 14, 63, "Medium"],
    [12, 21, 15, 69, "Medium"],
    [13, 22, 15, 74, "Medium"],
    [14, 22, 16, 80, "Medium"],
    [15, 23, 16, 85, "Medium"],
    [16, 23, 17, 94, "Hard"],
    [17, 24, 17, 102, "Hard"],
    [18, 24, 18, 111, "Hard"],
    [19, 25, 18, 119, "Hard"],
    [20, 25, 19, 127, "Hard"],
    [21, 26, 19, 135, "Hard"],
    [22, 26, 20, 143, "Hard"],
    [23, 27, 20, 150, "Expert"],
    [24, 27, 21, 160, "Expert"],
    [25, 28, 21, 168, "Expert"],
    [26, 28, 22, 177, "Expert"],
    [27, 29, 22, 186, "Expert"],
    [28, 29, 23, 195, "Expert"],
    [29, 30, 23, 203, "Expert"],
    [30, 31, 24, 211, "Expert"],
  ];
  const LEVELS = RAW_LEVELS.map(([level, cols, rows, bombs, diff]) => ({
    level,
    cols,
    rows,
    bombs,
    diff,
    // rough "fast clear" benchmark, scales with board size
    fastTime: Math.round(20 + cols * rows * 0.55),
  }));
  const TOTAL_LEVELS = LEVELS.length;
  const PROGRESS_KEY = "minesweeperUnlockedLevel"; // pre-v11 scalar save, migrated once (migrateProgress)
  const UNLOCKED_KEY = "minesweeperUnlockedLevels"; // Pac-Man: a SET of playable levels
  const COMPLETED_KEY = "minesweeperCompletedLevels"; // Pac-Man: levels actually won
  const RESET_HAPPENED_KEY = "minesweeperResetHappened"; // survives the wipe it is set by
  const COINS_KEY = "minesweeperCoins";
  const CUSTOM_KEY = "minesweeperCustomizations";
  const SESSION_KEY = "minesweeperSessionStart";
  // Last level the player actually played: where Play resumes. Unlocking a
  // level (by winning or by watching ads) never writes this.
  const LAST_PLAYED_KEY = "minesweeperLastPlayedLevel";
  // Mines a player may hit on one board before it is Game Over.
  const MAX_MISTAKES = 3;
  const SESSION_MS = 24 * 60 * 60 * 1000; // 24 hours

  // ---------- Reward amounts ----------
  const REWARD_COMPLETE = 20;
  const REWARD_NO_MISTAKES = 20;
  const REWARD_FAST = 15;

  // ---------- Customization catalog ----------
  const THEMES = [
    { id: "classic", name: "Classic", cost: 0, bg: "#ECF4FB", grid: "#D8E8F5", swatch: "#ECF4FB" },
    { id: "ocean", name: "Ocean Blue", cost: 60, bg: "#0f3057", grid: "rgba(255,255,255,0.08)", swatch: "#1e5f8c" },
    { id: "forest", name: "Forest Green", cost: 60, bg: "#16321f", grid: "rgba(255,255,255,0.08)", swatch: "#2e6b3e" },
    { id: "sunset", name: "Sunset Orange", cost: 90, bg: "#3a1d0f", grid: "rgba(255,255,255,0.08)", swatch: "#c1571f" },
    { id: "midnight", name: "Midnight Purple", cost: 120, bg: "#1e1330", grid: "rgba(255,255,255,0.08)", swatch: "#5b3d99" },
  ];
  const TILES = [
    { id: "classic", name: "Classic", cost: 0, base: null, base2: null, border: null, swatch: "#d6e4dc" },
    { id: "slate", name: "Slate", cost: 50, base: "#6b7686", base2: "#48515e", border: "#2f3742", swatch: "#5b6675" },
    { id: "sand", name: "Sand", cost: 50, base: "#eccf9a", base2: "#cfa968", border: "#a9803f", swatch: "#e0c08a" },
    { id: "ice", name: "Ice", cost: 80, base: "#d4f0f8", base2: "#9fd3e6", border: "#5fa9c2", swatch: "#bfe6f2" },
    { id: "ruby", name: "Ruby", cost: 110, base: "#eda6ae", base2: "#c96876", border: "#8c3b45", swatch: "#e08a94" },
  ];
  const FLAGS = [
    { id: "classic", name: "Classic Pin", cost: 0, emoji: null, swatch: "\u2691" },
    { id: "red", name: "Red Flag", cost: 40, emoji: "\uD83D\uDEA9", swatch: "\uD83D\uDEA9" },
    { id: "star", name: "Star", cost: 70, emoji: "\u2B50", swatch: "\u2B50" },
    { id: "skull", name: "Skull", cost: 100, emoji: "\uD83D\uDC80", swatch: "\uD83D\uDC80" },
    { id: "diamond", name: "Diamond", cost: 130, emoji: "\uD83D\uDC8E", swatch: "\uD83D\uDC8E" },
  ];
  const CATALOG = { theme: THEMES, tile: TILES, flag: FLAGS };

  // ---------- Flat board palette (matches the Sudoku title's visual style:
  // flush cells, thin hairline borders, no beveled/pixelated sprite look) ----------
  window.MS_PALETTE = {
    fixedBg: "#ECF4FB",
    cardBg: "#FFFFFF",
    gridLine: "#D8E8F5",
    primary: "#3F9BE0",
    primaryDark: "#2A78BC",
    textDark: "#1C3247",
    textMid: "#64798C",
    error: "#E36262",
    errorBg: "#FDEAEA",
    // A mine the player hit: an all-red flag (flag and pole) on the red cell.
    hitFlag: "#E53935",
    hitFlagPole: "#C62828",
    success: "#3FAE55",
    numbers: {
      1: "#2A78BC",
      2: "#3FAE55",
      3: "#E36262",
      4: "#5B3D99",
      5: "#8C3B45",
      6: "#2AA9A0",
      7: "#1C3247",
      8: "#64798C",
    },
  };

  window.MSDraw = {
    cellBgRect(ctx, x, y, w, h, color, gridColor) {
      ctx.fillStyle = color;
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = gridColor || MS_PALETTE.gridLine;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    },
    number(ctx, x, y, size, n) {
      ctx.save();
      ctx.fillStyle = MS_PALETTE.numbers[n] || MS_PALETTE.textDark;
      ctx.font = "700 " + Math.round(size * 0.54) + "px 'Inter', 'Poppins', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(n), x + size / 2, y + size / 2 + size * 0.03);
      ctx.restore();
    },
    flag(ctx, x, y, size, color, poleColor) {
      const cx = x + size * 0.38,
        top = y + size * 0.22,
        bottom = y + size * 0.78;
      ctx.save();
      ctx.strokeStyle = poleColor || MS_PALETTE.textDark;
      ctx.lineWidth = Math.max(1.5, size * 0.06);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(cx, top);
      ctx.lineTo(cx, bottom);
      ctx.stroke();
      ctx.fillStyle = color || MS_PALETTE.error;
      ctx.beginPath();
      ctx.moveTo(cx, top);
      ctx.lineTo(cx + size * 0.34, top + size * 0.12);
      ctx.lineTo(cx, top + size * 0.24);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx - size * 0.14, bottom);
      ctx.lineTo(cx + size * 0.14, bottom);
      ctx.stroke();
      ctx.restore();
    },
    mine(ctx, x, y, size, color) {
      const cx = x + size / 2,
        cy = y + size / 2,
        r = size * 0.24;
      ctx.save();
      ctx.strokeStyle = color || MS_PALETTE.textDark;
      ctx.lineWidth = Math.max(1.2, size * 0.05);
      for (let i = 0; i < 8; i++) {
        const ang = (Math.PI / 4) * i;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(ang) * r * 0.9, cy + Math.sin(ang) * r * 0.9);
        ctx.lineTo(cx + Math.cos(ang) * r * 1.9, cy + Math.sin(ang) * r * 1.9);
        ctx.stroke();
      }
      ctx.fillStyle = color || MS_PALETTE.textDark;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.beginPath();
      ctx.arc(cx - r * 0.35, cy - r * 0.35, r * 0.28, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    },
    question(ctx, x, y, size, color) {
      ctx.save();
      ctx.fillStyle = color || MS_PALETTE.textMid;
      ctx.font = "800 " + Math.round(size * 0.5) + "px 'Inter', 'Poppins', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("?", x + size / 2, y + size / 2 + size * 0.03);
      ctx.restore();
    },
    /* 3D tiles. raised(): an unopened tile as a bevelled key — light top and
       left edges, shaded bottom and right edges, and a soft top-down sheen —
       drawn over whatever the tile's own colour / design is, so it works for
       every theme and tile design. sunken(): an opened tile, faintly pressed
       in. Drawing only: nothing about the cells or the rules changes. */
    raised(ctx, x, y, w, h) {
      const t = Math.max(2, Math.min(5, Math.round(Math.min(w, h) * 0.09)));
      ctx.save();
      const g = ctx.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, "rgba(255,255,255,0.30)");
      g.addColorStop(0.5, "rgba(255,255,255,0)");
      g.addColorStop(1, "rgba(0,0,0,0.07)");
      ctx.fillStyle = g;
      ctx.fillRect(x, y, w, h);
      const edge = (pts, color) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(pts[0], pts[1]);
        for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
        ctx.closePath();
        ctx.fill();
      };
      edge([x, y, x + w, y, x + w - t, y + t, x + t, y + t], "rgba(255,255,255,0.80)");          // top
      edge([x, y, x + t, y + t, x + t, y + h - t, x, y + h], "rgba(255,255,255,0.55)");          // left
      edge([x, y + h, x + t, y + h - t, x + w - t, y + h - t, x + w, y + h], "rgba(0,0,0,0.24)"); // bottom
      edge([x + w, y, x + w, y + h, x + w - t, y + h - t, x + w - t, y + t], "rgba(0,0,0,0.16)"); // right
      ctx.strokeStyle = "rgba(0,0,0,0.14)";
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      ctx.restore();
    },
    sunken(ctx, x, y, w, h) {
      const t = Math.max(1, Math.min(3, Math.round(Math.min(w, h) * 0.05)));
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.09)";
      ctx.fillRect(x + 1, y + 1, w - 2, t);       // top inner shadow
      ctx.fillRect(x + 1, y + 1 + t, t, h - 2 - t); // left inner shadow
      ctx.restore();
    },
    strike(ctx, x, y, size, color) {
      ctx.save();
      ctx.strokeStyle = color || MS_PALETTE.error;
      ctx.lineWidth = Math.max(1.5, size * 0.07);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x + size * 0.18, y + size * 0.18);
      ctx.lineTo(x + size * 0.82, y + size * 0.82);
      ctx.stroke();
      ctx.restore();
    },
  };

  function defaultCustomization() {
    return {
      unlocked: { theme: ["classic"], tile: ["classic"], flag: ["classic"] },
      equipped: { theme: "classic", tile: "classic", flag: "classic" },
    };
  }

  /* BUG FIX (performance): getEquippedItem() is called up to three times for
     every tile on every redraw, and each call used to re-read and JSON-parse
     the saved customization from storage — ~100,000 storage reads a second on
     the biggest board. The parsed state is now kept in memory and refreshed
     whenever it is saved. loadCustomization() still hands callers their own
     copy, so code that edits it before saving can't touch the cache. */
  let customCache = null;
  function currentCustomization() {
    if (!customCache) customCache = parseCustomization();
    return customCache;
  }
  function loadCustomization() {
    return JSON.parse(JSON.stringify(currentCustomization()));
  }
  function parseCustomization() {
    try {
      const raw = JSON.parse(store.getItem(CUSTOM_KEY));
      if (!raw || !raw.unlocked || !raw.equipped) return defaultCustomization();
      ["theme", "tile", "flag"].forEach((cat) => {
        if (!Array.isArray(raw.unlocked[cat]) || !raw.unlocked[cat].includes("classic")) {
          raw.unlocked[cat] = Array.isArray(raw.unlocked[cat]) ? raw.unlocked[cat] : [];
          raw.unlocked[cat].push("classic");
        }
        if (!raw.equipped[cat]) raw.equipped[cat] = "classic";
      });
      return raw;
    } catch (e) {
      return defaultCustomization();
    }
  }

  function saveCustomization(state) {
    store.setItem(CUSTOM_KEY, JSON.stringify(state));
    customCache = JSON.parse(JSON.stringify(state));
    requestDraw(); // a new theme / tile / flag shows on the next frame
  }

  function getEquippedItem(cat) {
    const state = currentCustomization(); // read-only: no copy needed
    const id = state.equipped[cat];
    return CATALOG[cat].find((i) => i.id === id) || CATALOG[cat][0];
  }

  // ---------- Coins ----------
  function getCoins() {
    const v = parseInt(store.getItem(COINS_KEY), 10);
    return isNaN(v) || v < 0 ? 0 : v;
  }

  function addCoins(n) {
    const total = getCoins() + n;
    store.setItem(COINS_KEY, String(total));
    refreshCoinDisplays();
    return total;
  }

  function spendCoins(n) {
    const current = getCoins();
    if (current < n) return false;
    store.setItem(COINS_KEY, String(current - n));
    refreshCoinDisplays();
    return true;
  }

  function refreshCoinDisplays() {
    const c = String(getCoins());
    if (coinCountStart) coinCountStart.textContent = c;
    if (coinCountGame) coinCountGame.textContent = c;
    if (coinCountCustomize) coinCountCustomize.textContent = c;
  }

  // ---------- Progress (Pac-Man model) ----------
  /* Unlocked levels are a SET of level numbers, not one "unlocked up to here"
     number — the same model as Pac-Man. That is what lets the 5-ads unlock
     open ONE level out of order (unlocking level 6 must not make 2-5
     playable). Level 1 is always available. Completed (won) levels are kept
     separately, so a level opened with ads but not yet played is not shown as
     cleared. Normal progression is unchanged: winning a level unlocks the next
     one for free. */
  function readLevelList(key) {
    try {
      const stored = JSON.parse(store.getItem(key));
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
      store.setItem(UNLOCKED_KEY, JSON.stringify(levels));
    }
  }
  function getCompletedLevels() {
    return readLevelList(COMPLETED_KEY) || [];
  }
  function isLevelCompleted(level) {
    return getCompletedLevels().includes(level);
  }
  // On a win: mark it cleared and unlock the next level (Pac-Man markLevelCompleted).
  function markLevelCompleted(level) {
    const completed = getCompletedLevels();
    if (!completed.includes(level)) {
      completed.push(level);
      store.setItem(COMPLETED_KEY, JSON.stringify(completed));
    }
    unlockLevel(level + 1);
  }
  // Furthest level the player can reach: the "Level X of 30 unlocked" line
  // only. Not used to decide whether a level is playable, and NOT where Play
  // goes (a level opened with ads would otherwise hijack the Play button).
  function getFurthestUnlockedLevel() {
    return Math.min(TOTAL_LEVELS, Math.max(1, ...getUnlockedLevels()));
  }

  /* ---------- Where the Play button goes ----------
     BUG FIX: Play used to open the HIGHEST unlocked level. After the 24-hour
     reset, unlocking Level 24 with ads made Play jump to Level 24 even when
     the player had only ever played Level 1. Play now resumes the last level
     the player actually PLAYED. Unlocking a level does not count as playing
     it, and the level that opens by itself after the 5 ads only counts once
     the player touches its board (see startLevel / noteLevelPlayed). */
  function getLastPlayedLevel() {
    const n = parseInt(store.getItem(LAST_PLAYED_KEY), 10);
    return n >= 1 && n <= TOTAL_LEVELS ? n : null;
  }
  function setLastPlayedLevel(level) {
    if (level >= 1 && level <= TOTAL_LEVELS) store.setItem(LAST_PLAYED_KEY, String(level));
  }
  // Furthest level reached by winning in order (1, 2, 3 ... with no gap):
  // levels opened out of order with ads are left out.
  function getFurthestProgressLevel() {
    let level = 1;
    while (level < TOTAL_LEVELS && isLevelUnlocked(level + 1)) level++;
    return level;
  }
  function getPlayButtonLevel() {
    const last = getLastPlayedLevel();
    if (last && isLevelUnlocked(last)) return last;
    // Nothing played yet (or that level was locked again by the 24-hour
    // reset): the furthest level reached in order — the old behaviour for
    // anyone who has never used the ads unlock.
    return getFurthestProgressLevel();
  }
  /* Saves from before this version stored one number ("unlocked up to N").
     Turned into the same progress in the new form: 1..N unlocked, 1..N-1
     cleared. Runs once; nobody loses a level. */
  function migrateProgress() {
    const old = parseInt(store.getItem(PROGRESS_KEY), 10);
    if (store.getItem(UNLOCKED_KEY) === null && old > 1) {
      const n = Math.min(old, TOTAL_LEVELS);
      const unlocked = [], completed = [];
      for (let i = 1; i <= n; i++) unlocked.push(i);
      for (let i = 1; i < n; i++) completed.push(i);
      store.setItem(UNLOCKED_KEY, JSON.stringify(unlocked));
      store.setItem(COMPLETED_KEY, JSON.stringify(completed));
    }
    store.removeItem(PROGRESS_KEY);
  }

  /* ---------- The 5-ads unlock rule (Pac-Man isLevelAdUnlockable) ----------
     A locked level can be unlocked by watching ads ONLY after a 24-hour reset
     has happened at least once, and only when the level right before it is
     still locked too (it sits after a gap). Before the first reset a locked
     level is the ordinary padlock, reached only by winning your way there. */
  function hasSessionEverReset() {
    return store.getItem(RESET_HAPPENED_KEY) === "1";
  }
  function isLevelAdUnlockable(level) {
    return level > 1 && level <= TOTAL_LEVELS && !isLevelUnlocked(level) &&
      hasSessionEverReset() && !isLevelUnlocked(level - 1);
  }

  // ---------- Session (24h progress reset, Pac-Man checkSession) ----------
  /* Session start, or null when missing or unreadable (a corrupt value must
     not stop the reset from ever firing). */
  function readSessionStart() {
    const start = Number(store.getItem(SESSION_KEY));
    return Number.isFinite(start) && start > 0 ? start : null;
  }

  function startNewSession() {
    store.setItem(SESSION_KEY, String(Date.now()));
  }

  /* Progress = unlocked / cleared levels, coins, unlocked and equipped
     customizations — the same things Pac-Man wipes. Sound is a device
     setting and is left alone. The reset flag is set here and never cleared:
     it is what turns the 5-ads unlock on. */
  /* BUG FIX: an ad that was playing when the 24-hour reset fired still ran
     its reward when it ended — the every-3rd-level ad then dropped the
     player into the level the reset had just locked again (bypassing the
     reset), and Continue restored a board behind the menu. Each such ad now
     records this counter when it starts and gives its reward only if no
     reset happened in between. */
  let sessionEpoch = 0;
  function resetAllProgress() {
    sessionEpoch++;
    store.removeItem(UNLOCKED_KEY);
    store.removeItem(COMPLETED_KEY);
    store.removeItem(PROGRESS_KEY);
    store.removeItem(LAST_PLAYED_KEY); // Play goes back to Level 1
    store.removeItem(COINS_KEY); // Pac-Man removes its session keys
    saveCustomization(defaultCustomization());
    store.setItem(RESET_HAPPENED_KEY, "1");
    startNewSession();
  }

  function checkSession() {
    const start = readSessionStart();
    if (!start) {
      startNewSession();
      return;
    }
    if (start + SESSION_MS - Date.now() <= 0) {
      resetAllProgress();
      refreshCoinDisplays();
      // A level in progress ends and the player goes back to the menu.
      if (gameScreen && !gameScreen.classList.contains("hidden")) {
        gameOver = true;
        stopTimer();
        hideOverlay();
        showStartScreen();
      } else if (levelScreen && !levelScreen.classList.contains("hidden")) {
        buildLevelGrid();
      } else if (customizeScreen && !customizeScreen.classList.contains("hidden")) {
        renderCustomizeGrid(activeCustomizeTab);
      }
      // Pac-Man's showSessionToast(): same words, same 3.2s pill.
      showToast("\u23F0 24-hour session over \u2014 progress reset, starting fresh");
    }
  }

  /* ================= GAMEPLAY LAYOUT + DISPLAY ADS (Pac-Man standard) =================
     A port of Pac-Man's fitSideRailsInner() / placeLeaderboardTop() /
     layoutLandscapeGame(), with the same constants, so the ads come out at
     exactly the same size and position as Pac-Man's on every screen:
       - PORTRAIT (h > w): one LEADER_BOARD 970x90 at the top, 5px from the
         edge, scale = min(1, band ceiling / 90, width / 970) floored to 3
         decimals; --ad-band = card height + 10px is reserved so the board
         starts under it. Below scale 0.22 there is no ad.
       - LANDSCAPE: VERTICAL_BANNER 300x600 rails. Card width =
         min(300, board-area height / 2); two cards when one would leave the
         board area wider than 1.4x its height and two still leave >= 1.0x;
         a single card gives width back if the board area would be narrower
         than Pac-Man's narrowest board shape; below scale 0.22 it falls back
         to the leaderboard. Off phones the board area is capped at 2.0x its
         height and [ad | board | ad] is centred as one group. Rails sit 8px
         from the board area, top-aligned to it and exactly as tall; past
         600 x scale the card is lengthened in the creative's own colour.
     Pac-Man's board-shape limits (PAC_MIN/MAX_BOARD_ASPECT) are used as
     constants, so the ad geometry depends only on the screen, never on the
     Minesweeper level — the same screen gives the same ads as Pac-Man.
     The Minesweeper grid is then centred in the board area both ways. */
  var AD_RAIL_W = 300;
  var AD_RAIL_H = 600;
  var AD_LEADER_W = 970;
  var AD_LEADER_H = 90;
  var LEADER_MIN_SCALE = 0.22;
  var LEADERBOARD_MARGIN = 5;
  var RAIL_EDGE = 0;
  var PHONE_NO_RAIL_MAX_W = 500;
  var LAND_AD_GAP = 8;
  var LAND_MIN_SCALE = 0.22;
  var LAND_TWO_IF_WIDER = 1.4;
  var LAND_TWO_MIN_ASPECT = 1.0;
  var LAND_MAX_ASPECT = 2.0;
  var PAC_MIN_BOARD_ASPECT = 0.928785206993315; // Pac-Man minBoardAspect()
  var PAC_MAX_BOARD_ASPECT = 1.2881958922098347; // Pac-Man maxBoardAspect()
  var AD_ROTATE_MS = 5000;
  var AD_SLIDE_MS = 430;
  /* ---------- Sponsor catalogue (Pac-Man's sponsor-media.json standard) ----------
     The same creatives, sizes and placements Pac-Man ships:
       - "banner"                VERTICAL_BANNER 300x600, beside the board
       - "leaderboard"           LEADER_BOARD 970x90, above the board
       - "level_complete_banner" MREC 300x250, inside the Congratulations popup
       - "continue"              video, Game Over -> Watch Ad & Continue
       - "level_gate"            video, Next Level after every 3rd level
     Read from sponsor-media.json beside index.html; this built-in copy is used
     when that file can't be fetched (e.g. opening index.html from file://). */
  var SPONSOR_JSON_URL = "sponsor-media.json";
  var AD_LOAD_TIMEOUT_MS = 12000;
  var SPONSOR_FALLBACK_CATALOGUE = { ads: [
    { id: "ms-continue-1", adType: "video", advertiser: "Continue Sponsor", duration: 67, isSkippable: true, nonSkippableSeconds: 10, streamUrl: "assets/ads/ad-continue-2.mp4", placements: ["continue"] },
    { id: "ms-continue-2", adType: "video", advertiser: "Continue Sponsor", duration: 16, isSkippable: true, nonSkippableSeconds: 10, streamUrl: "assets/ads/ad-continue-3.mp4", placements: ["continue"] },
    { id: "ms-restart-1", adType: "video", advertiser: "Restart Sponsor", duration: 30, isSkippable: true, nonSkippableSeconds: 10, streamUrl: "assets/ads/ad-restart-2.mp4", placements: ["restart"] },
    { id: "ms-restart-2", adType: "video", advertiser: "Restart Sponsor", duration: 36, isSkippable: true, nonSkippableSeconds: 10, streamUrl: "assets/ads/ad-restart-3.mp4", placements: ["restart"] },
    { id: "ms-recover-1", adType: "video", advertiser: "Unlock Sponsor", duration: 25, isSkippable: true, nonSkippableSeconds: 10, streamUrl: "assets/ads/ad-recover-2.mp4", placements: ["recover"] },
    { id: "ms-levelgate-1", adType: "video", advertiser: "Level Sponsor", duration: 27, isSkippable: true, nonSkippableSeconds: 10, streamUrl: "assets/ads/ad-levelgate-2.mp4", placements: ["level_gate"] },
    { id: "ms-mrec-creditkey", adType: "image", adSize: "MREC", advertiser: "Credit Key", bgFrom: "#0b1450", streamUrl: "assets/ads/ad-creditkey-mrec.png", imageUrl: "assets/ads/ad-creditkey-mrec.png", clickUrl: "", placements: ["level_complete_banner"] },
    { id: "ms-mrec-creditkey-2", adType: "image", adSize: "MREC", advertiser: "Credit Key", bgFrom: "#0b1450", streamUrl: "assets/ads/ad-creditkey-mrec-2.png", imageUrl: "assets/ads/ad-creditkey-mrec-2.png", clickUrl: "", placements: ["level_complete_banner"] },
    { id: "ms-mrec-creditkey-3", adType: "image", adSize: "MREC", advertiser: "Credit Key", bgFrom: "#0b1450", streamUrl: "assets/ads/ad-creditkey-mrec-3.png", imageUrl: "assets/ads/ad-creditkey-mrec-3.png", clickUrl: "", placements: ["level_complete_banner"] },
    { id: "ms-rail-creditkey", adType: "image", adSize: "VERTICAL_BANNER", advertiser: "Credit Key", bgFrom: "#0b1450", bgBottom: "#070d59", streamUrl: "assets/ads/ad-creditkey-banner.png", imageUrl: "assets/ads/ad-creditkey-banner.png", clickUrl: "", placements: ["banner"] },
    { id: "ms-rail-creditkey-2", adType: "image", adSize: "VERTICAL_BANNER", advertiser: "Credit Key", bgFrom: "#0b1450", bgBottom: "#091148", streamUrl: "assets/ads/ad-creditkey-banner-2.png", imageUrl: "assets/ads/ad-creditkey-banner-2.png", clickUrl: "", placements: ["banner"] },
    { id: "ms-rail-creditkey-3", adType: "image", adSize: "VERTICAL_BANNER", advertiser: "Credit Key", bgFrom: "#0b1450", bgBottom: "#0d1a6b", streamUrl: "assets/ads/ad-creditkey-banner-3.png", imageUrl: "assets/ads/ad-creditkey-banner-3.png", clickUrl: "", placements: ["banner"] },
    { id: "ms-leader-creditkey", adType: "image", adSize: "LEADER_BOARD", advertiser: "Credit Key", bgFrom: "#0b1450", streamUrl: "assets/ads/ad-creditkey-leaderboard.png", imageUrl: "assets/ads/ad-creditkey-leaderboard.png", clickUrl: "", placements: ["leaderboard"] },
    { id: "ms-leader-creditkey-2", adType: "image", adSize: "LEADER_BOARD", advertiser: "Credit Key", bgFrom: "#0b1450", streamUrl: "assets/ads/ad-creditkey-leaderboard-2.png", imageUrl: "assets/ads/ad-creditkey-leaderboard-2.png", clickUrl: "", placements: ["leaderboard"] },
    { id: "ms-leader-creditkey-3", adType: "image", adSize: "LEADER_BOARD", advertiser: "Credit Key", bgFrom: "#0b1450", streamUrl: "assets/ads/ad-creditkey-leaderboard-3.png", imageUrl: "assets/ads/ad-creditkey-leaderboard-3.png", clickUrl: "", placements: ["leaderboard"] },
  ] };
  function placementList(placement) {
    return SPONSOR_FALLBACK_CATALOGUE.ads.filter(function (ad) { return ad.placements.indexOf(placement) !== -1; });
  }
  /* The side cards and the leaderboard are painted straight from the
     built-in creatives (Pac-Man's loadSideRails() does the same), so they are
     on screen the moment the board is, whatever the network does. */
  var RAIL_CREATIVES = placementList("banner").map(function (ad) {
    return { src: ad.imageUrl, bg: ad.bgBottom || ad.bgFrom, alt: ad.advertiser };
  });
  var LEADER_CREATIVES = placementList("leaderboard").map(function (ad) {
    return { src: ad.imageUrl, bg: ad.bgFrom, alt: ad.advertiser };
  });

  function layoutViewport() {
    var de = document.documentElement;
    return { w: de.clientWidth || window.innerWidth, h: de.clientHeight || window.innerHeight };
  }
  function isPhoneWidth() {
    return Math.min(window.innerWidth || 9999, window.innerHeight || 9999) <= PHONE_NO_RAIL_MAX_W;
  }
  function gsEl() { return document.getElementById("gameScreen"); }
  function boardAreaEl() { return document.querySelector("#gameScreen .board-area"); }

  // ---- Ad cards: same markup idea as Pac-Man (one whole-unit <img>) ----
  var railRR = 0;
  var leaderRR = 0;
  var railTimer = null;
  var leaderTimer = null;
  /* ---- Ads that cannot be shown never take room from the board ----
     BUG FIX (Android): on some phones the board sat in the middle with wide
     empty strips left and right (and an empty band on top in portrait).
     That space was reserved for the side cards / leaderboard even when they
     could not appear: Android browsers with a built-in ad blocker (Samsung
     Internet, Brave, Opera, Firefox / Chrome with blockers, Private DNS
     blocklists) hide those cards or block their images, and a slow or failed
     image load did the same. The layout now only reserves room for a card
     that is really on screen with a creative that loaded; otherwise the
     board gets the full width (or height), exactly as on a screen with no
     ads. A creative whose image fails is skipped from then on, and the
     layout is redone the moment that happens. */
  var failedAdSrc = {};
  function nextRail() {
    for (var k = 0; k < RAIL_CREATIVES.length; k++) {
      var c = RAIL_CREATIVES[railRR % RAIL_CREATIVES.length]; railRR++;
      if (!failedAdSrc[c.src]) return c;
    }
    return null;
  }
  function nextLeader() {
    for (var k = 0; k < LEADER_CREATIVES.length; k++) {
      var i = leaderRR % LEADER_CREATIVES.length; leaderRR++;
      if (!failedAdSrc[LEADER_CREATIVES[i].src]) return { c: LEADER_CREATIVES[i], slot: i };
    }
    return null;
  }
  // The card is in the page and nothing (an ad blocker's stylesheet) hides it.
  function adSlotVisible(el) {
    if (!el || !el.isConnected) return false;
    var had = el.classList.contains("is-shown");
    if (!had) el.classList.add("is-shown");
    var cs = getComputedStyle(el);
    var ok = cs.display !== "none" && cs.visibility !== "hidden" && parseFloat(cs.opacity || "1") > 0.05;
    if (!had) el.classList.remove("is-shown");
    return ok;
  }
  // ...and holds a creative whose image has not failed.
  function adSlotUsable(el) {
    if (!adSlotVisible(el)) return false;
    var img = el.querySelector(".ad-unit-img");
    if (!img) return false;
    var src = img.getAttribute("src");
    if (failedAdSrc[src]) return false;
    if (img.complete && img.naturalWidth === 0 && src) { failedAdSrc[src] = true; return false; }
    return true;
  }
  function watchAdImages(el) {
    if (!el) return;
    var imgs = el.querySelectorAll("img.ad-unit-img");
    for (var k = 0; k < imgs.length; k++) {
      (function (img) {
        if (img.__msWatched) return;
        img.__msWatched = true;
        img.addEventListener("error", function () {
          var src = img.getAttribute("src");
          if (!src || failedAdSrc[src]) return;
          failedAdSrc[src] = true;
          adCreativeFailed();
        });
      })(imgs[k]);
    }
  }
  // Swap a failed creative for one that works (if any), then lay out again.
  var adFailTimer = null;
  function adCreativeFailed() {
    clearTimeout(adFailTimer);
    adFailTimer = setTimeout(function () {
      railEls().forEach(function (el) {
        if (el && !adSlotUsable(el)) buildRail(el, nextRail());
      });
      var lb = document.getElementById("adLeaderboard");
      if (lb && !adSlotUsable(lb)) buildLeader(lb, nextLeader());
      if (typeof scheduleRefit === "function") scheduleRefit();
    }, 30);
  }
  function dotsHtml(slot, n) {
    if (n < 2) return "";
    var h = '<div class="ad-dots" aria-hidden="true">';
    for (var i = 0; i < n; i++) h += "<i" + (i === slot ? ' class="on"' : "") + "></i>";
    return h + "</div>";
  }
  function buildRail(el, c) {
    if (!el) return;
    if (!c) { el.innerHTML = ""; el.classList.remove("is-shown"); return; } // no creative that loads
    el.style.background = c.bg;
    el.innerHTML = '<img class="ad-unit-img" src="' + c.src + '" width="300" height="600" alt="' + (c.alt || "Advertisement") + '" draggable="false" />';
    watchAdImages(el);
  }
  function buildLeader(el, pick) {
    if (!el) return;
    if (!pick) { el.innerHTML = ""; el.classList.remove("is-shown"); return; }
    el.style.background = pick.c.bg;
    el.innerHTML = '<img class="ad-unit-img" src="' + pick.c.src + '" width="970" height="90" alt="' + (pick.c.alt || "Advertisement") + '" draggable="false" />' +
      dotsHtml(pick.slot, LEADER_CREATIVES.length);
    watchAdImages(el);
  }
  /* Pac-Man's carousel motion: the next creative slides in from the side. */
  function slideCard(el, src, w, h, bg, after) {
    var oldImg = el.querySelector(".ad-unit-img");
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!oldImg || reduce) { after(); return; }
    el.classList.add("ad-sliding");
    var track = document.createElement("div");
    track.className = "ad-slide-track";
    var cur = oldImg.cloneNode(true);
    var nxt = document.createElement("img");
    nxt.className = "ad-unit-img"; nxt.width = w; nxt.height = h; nxt.alt = "Advertisement"; nxt.src = src;
    track.appendChild(cur); track.appendChild(nxt);
    el.innerHTML = "";
    el.appendChild(track);
    watchAdImages(el);
    el.style.background = bg;
    requestAnimationFrame(function () { requestAnimationFrame(function () { track.classList.add("slide-next"); }); });
    setTimeout(function () { after(); el.classList.remove("ad-sliding"); }, AD_SLIDE_MS);
  }
  function railEls() { return [document.getElementById("adRailLeft"), document.getElementById("adRailRight")]; }
  function stopRailCarousel() { if (railTimer) { clearInterval(railTimer); railTimer = null; } }
  function stopLeaderboardCarousel() { if (leaderTimer) { clearInterval(leaderTimer); leaderTimer = null; } }
  function startRailCarousel() {
    if (railTimer) return;
    railTimer = setInterval(function () {
      var shown = railEls().filter(function (el) { return el && el.classList.contains("is-shown"); });
      if (!shown.length) { stopRailCarousel(); return; }
      // One creative per visible card, so two cards never show the same ad,
      // and both change together.
      shown.map(function (el) { return [el, nextRail()]; }).forEach(function (pair) {
        if (!pair[1]) return; // every creative failed: keep what is there
        slideCard(pair[0], pair[1].src, 300, 600, pair[1].bg, function () { buildRail(pair[0], pair[1]); });
      });
    }, AD_ROTATE_MS);
  }
  function startLeaderboardCarousel() {
    if (leaderTimer) return;
    leaderTimer = setInterval(function () {
      var el = document.getElementById("adLeaderboard");
      if (!el || !el.classList.contains("is-shown")) { stopLeaderboardCarousel(); return; }
      var pick = nextLeader();
      if (!pick) return;
      slideCard(el, pick.c.src, 970, 90, pick.c.bg, function () { buildLeader(el, pick); });
    }, AD_ROTATE_MS);
  }
  function ensureAdCards() {
    var rails = railEls();
    var lb = document.getElementById("adLeaderboard");
    if (rails[0] && !rails[0].innerHTML) buildRail(rails[0], nextRail());   // left: creative 1
    if (rails[1] && !rails[1].innerHTML) buildRail(rails[1], nextRail());   // right: creative 2
    if (lb && !lb.innerHTML) buildLeader(lb, nextLeader());
  }
  function hideSideRails() {
    railEls().forEach(function (el) { if (el) el.classList.remove("is-shown"); });
    stopRailCarousel();
    var lb = document.getElementById("adLeaderboard");
    if (lb) lb.classList.remove("is-shown");
    stopLeaderboardCarousel();
    var gs = gsEl();
    if (gs) {
      gs.style.removeProperty("--ad-band");
      gs.style.removeProperty("--maze-w");
      gs.style.removeProperty("--maze-x");
    }
  }

  /* The board area's height as it would be with NO ad band reserved —
     worked out from numbers, like Pac-Man's boardBoxNoBand(). */
  function boardBoxNoBand() {
    var gs = gsEl();
    var host = document.querySelector("#gameScreen .game-container");
    if (!gs || !host) return { w: 0, h: 0 };
    var cs = getComputedStyle(gs);
    var band = parseFloat(cs.getPropertyValue("--ad-band")) || 0;
    var padT = parseFloat(cs.paddingTop) || 0;
    var padB = parseFloat(cs.paddingBottom) || 0;
    var rowGap = parseFloat(cs.rowGap) || 0;
    var bar = gs.querySelector(".game-bar");
    var barH = bar ? bar.offsetHeight : 0;
    var inner = gs.clientHeight - padT - padB + band - barH - (barH ? rowGap : 0);
    var hint = host.querySelector(".hint");
    if (hint && hint.offsetParent !== null) {
      inner -= hint.offsetHeight + (parseFloat(getComputedStyle(host).rowGap) || 0);
    }
    return { w: host.offsetWidth, h: Math.max(40, inner) };
  }

  function placeLeaderboardTop() {
    var lb = document.getElementById("adLeaderboard");
    var gs = gsEl();
    if (!lb || !gs || !lb.innerHTML) return false;
    if (!adSlotUsable(lb)) { // hidden by a blocker / image failed: no band
      lb.classList.remove("is-shown");
      stopLeaderboardCarousel();
      gs.style.setProperty("--ad-band", "0px");
      return false;
    }
    var vp = layoutViewport();
    var fullH = boardBoxNoBand().h;
    var gsCs = getComputedStyle(gs);
    var gsPadX = (parseFloat(gsCs.paddingLeft) || 0) + (parseFloat(gsCs.paddingRight) || 0);
    var wrapEl = document.querySelector(".wrapper");
    var wrapCs = wrapEl ? getComputedStyle(wrapEl) : null;
    var wrapPadX = wrapCs ? (parseFloat(wrapCs.paddingLeft) || 0) + (parseFloat(wrapCs.paddingRight) || 0) : 0;
    var wrapInner = Math.min(1400, vp.w) - wrapPadX;
    var boardW = Math.min(1360, wrapInner) - gsPadX;
    var minBoardH = boardW / PAC_MAX_BOARD_ASPECT;
    var bandCeiling = Math.max(0, fullH - minBoardH - 4);
    var scale = Math.min(1, bandCeiling / AD_LEADER_H, (vp.w - 2 * RAIL_EDGE) / AD_LEADER_W);
    scale = Math.floor(Math.max(0, scale) * 1000) / 1000;
    if (scale < LEADER_MIN_SCALE) {
      gs.style.setProperty("--ad-band", "0px");
      return false;
    }
    var cardW = Math.round(AD_LEADER_W * scale);
    var cardH = Math.round(AD_LEADER_H * scale);
    gs.style.removeProperty("--maze-w");
    gs.style.removeProperty("--maze-x");
    gs.style.setProperty("--ad-band", cardH + 2 * LEADERBOARD_MARGIN + "px");
    lb.style.left = Math.round((vp.w - cardW) / 2) + "px";
    lb.style.top = LEADERBOARD_MARGIN + "px";
    lb.style.width = cardW + "px";
    lb.style.height = cardH + "px";
    lb.classList.add("is-shown");
    railEls().forEach(function (el) { if (el) el.classList.remove("is-shown"); });
    stopRailCarousel();
    startLeaderboardCarousel();
    return true;
  }

  function layoutLandscapeGame(gs, railL, railR) {
    gs.style.removeProperty("--ad-band");
    gs.style.removeProperty("--maze-w");
    gs.style.removeProperty("--maze-x");
    var cs = getComputedStyle(gs);
    var padL = parseFloat(cs.paddingLeft) || 0;
    var padR = parseFloat(cs.paddingRight) || 0;
    var innerL = gs.getBoundingClientRect().left + padL;
    var innerW = Math.max(0, gs.clientWidth - padL - padR);
    var Hm = Math.floor(boardBoxNoBand().h);
    if (!(innerW > 0) || !(Hm > 0)) return;

    // Only cards that can really be seen take room (see adSlotUsable).
    var okL = adSlotUsable(railL), okR = adSlotUsable(railR);
    if (!okL && !okR) {
      if (!placeLeaderboardTop()) hideSideRails();
      return;
    }
    if (!okR) { var swap = railR; railR = railL; railL = swap; } // the one that works goes on the right
    var gap = LAND_AD_GAP;
    var cardW = Math.min(AD_RAIL_W, Math.floor(Hm / 2));
    var n = 1;
    var w1 = innerW - (cardW + gap);
    var w2 = innerW - 2 * (cardW + gap);
    if (okL && okR && w2 >= Hm * LAND_TWO_MIN_ASPECT && w1 > Hm * LAND_TWO_IF_WIDER) n = 2;
    if (n === 1 && w1 < Hm * PAC_MIN_BOARD_ASPECT) {
      cardW = Math.floor(innerW - gap - Hm * PAC_MIN_BOARD_ASPECT);
    }
    var scale = Math.floor((cardW / AD_RAIL_W) * 1000) / 1000;
    if (scale < LAND_MIN_SCALE) {
      if (!placeLeaderboardTop()) hideSideRails();
      return;
    }
    cardW = AD_RAIL_W * scale;

    var mazeW = Math.floor(innerW - n * (cardW + gap));
    if (!isPhoneWidth()) mazeW = Math.min(mazeW, Math.floor(Hm * LAND_MAX_ASPECT));
    var groupW = mazeW + n * (cardW + gap);
    var lead = Math.max(0, Math.floor((innerW - groupW) / 2));
    var mazeX = innerL + lead + (n === 2 ? cardW + gap : 0);
    gs.style.setProperty("--maze-w", mazeW + "px");
    gs.style.setProperty("--maze-x", Math.round(mazeX - innerL) + "px");

    // Hang the cards off where the board area really is.
    var area = boardAreaEl();
    var railTop = 2;
    var railH = Math.min(Hm, Math.floor(AD_RAIL_H * scale));
    if (area) {
      var ar = area.getBoundingClientRect();
      railTop = Math.max(2, Math.round(ar.top));
      railH = Math.max(1, Math.round(ar.height));
    }
    var tall = railH > AD_RAIL_H * scale + 1;
    var leftX = Math.round(innerL + lead);
    var rightX = Math.round(mazeX + mazeW + gap);
    var placements = n === 2 ? [[railL, leftX], [railR, rightX]] : [[railR, rightX]];
    if (n === 1 && railL) railL.classList.remove("is-shown");
    placements.forEach(function (pl) {
      var el = pl[0];
      el.style.left = pl[1] + "px";
      el.style.top = railTop + "px";
      el.style.width = cardW + "px";
      el.style.height = railH + "px";
      el.classList.toggle("is-tall", tall);
      el.classList.add("is-shown");
    });
    startRailCarousel();
    var lb = document.getElementById("adLeaderboard");
    if (lb) lb.classList.remove("is-shown");
    stopLeaderboardCarousel();
  }

  /* Places the ads (reserving their room) and returns the board area. */
  function fitGameLayout() {
    var gs = gsEl();
    var rails = railEls();
    if (!gs) return null;
    if (!gameAdsWanted || gs.classList.contains("hidden")) {
      hideSideRails();
      return null;
    }
    ensureAdCards();
    var vp = layoutViewport();
    if (vp.h > vp.w) {
      gs.style.removeProperty("--maze-w");
      gs.style.removeProperty("--maze-x");
      if (!placeLeaderboardTop()) hideSideRails();
    } else {
      layoutLandscapeGame(gs, rails[0], rails[1]);
    }
    var area = boardAreaEl();
    return area ? { w: area.clientWidth, h: area.clientHeight } : null;
  }

  /* ---------- How the board is drawn into its area ----------
     Like Pac-Man's board, the grid fills the board area instead of floating
     in it. Two things make that possible, and neither touches the game:
       - ORIENTATION: on a tall area (portrait phones and tablets) the grid
         is drawn turned on its side — board rows run down the screen as
         columns — so a 15x10 board shows as 10 across x 15 down. Every cell
         keeps exactly the same neighbours, so the game plays the same; it
         is purely how the grid is laid out on screen. Whichever way fills
         more of the area is used, re-decided on every resize / rotation
         without touching the cells.
       - CELL SHAPE: cells take the area's shape instead of being forced
         square, up to 1.9:1 either way (Pac-Man likewise stretches its board
         to fill its box, up to a limit). Numbers, flags and mines are always
         drawn in a square centred in the cell, so they are never stretched.
       - EXACT FILL: cell sizes are kept exact (not rounded down to whole
         pixels), and each cell's edges are rounded to whole pixels instead,
         so the grid spans the whole area like Pac-Man's maze does. Rounding
         every cell DOWN used to leave up to ~25px of empty band beside the
         board on phones, and the old 1.5:1 limit up to ~46px. Regular phones
         never need more than ~1.56:1; 1.9:1 lets every level fill even a
         very narrow foldable cover screen (~1.86:1 needed at 344x882).
     The board view is only used for drawing and for turning a pointer
     position into the cell under it. */
  var CELL_MAX = 104;          // largest cell side (unchanged)
  var CELL_MIN = 6;
  var CELL_MAX_RATIO = 1.9;    // longest side / shortest side of a cell
  /* Phones on their side (short side <= 500px) with no ad card beside the
     board — an ad blocker, or creatives that failed to load — give the board
     an area up to ~3.2:1 (a 21:9 phone, a foldable's cover screen). At 1.9:1
     the grid stopped short and left an empty strip at each side; there the
     cells may widen to 2.6:1 so the grid reaches the full width. Tall cells,
     tablets and desktop keep 1.9:1. */
  var CELL_MAX_WIDE_PHONE = 2.6;
  var boardView = { t: false, tw: 0, th: 0, cols: 0, rows: 0 };

  function solveBoardView(rows, cols, areaW, areaH) {
    var opts = [false, true].map(function (t) {
      var dc = t ? rows : cols, dr = t ? cols : rows;
      var tw = Math.min(CELL_MAX, areaW / dc);
      var th = Math.min(CELL_MAX, areaH / dr);
      var maxWide = isPhoneWidth() ? CELL_MAX_WIDE_PHONE : CELL_MAX_RATIO;
      if (th > tw * CELL_MAX_RATIO) th = tw * CELL_MAX_RATIO;
      if (tw > th * maxWide) tw = th * maxWide;
      tw = Math.max(CELL_MIN, tw);
      th = Math.max(CELL_MIN, th);
      return { t: t, tw: tw, th: th, cols: dc, rows: dr, used: tw * dc * th * dr, stretch: Math.max(tw / th, th / tw) };
    });
    /* An orientation that fills the area completely wins; if both do, the
       one with the less stretched cells. (Before, the normal orientation was
       kept unless turning was 4% better, so on near-square screens such as
       an unfolded foldable a board that ALMOST fitted left a 5-26px empty
       band while the turned board would have filled exactly.) Otherwise the
       old rule: normal unless turning is clearly better. */
    var full = opts.filter(function (o) { return o.used >= areaW * areaH * 0.999; });
    if (full.length) return full.sort(function (a, b) { return a.stretch - b.stretch; })[0];
    return opts[1].used > opts[0].used * 1.04 ? opts[1] : opts[0];
  }

  /* Places the ads, then works out the board view for the area they leave.
     Returns the cell's short side (what cfg.tileSize / cell.w hold). */
  function computeTileSize(rows, cols) {
    var area = fitGameLayout();
    var FRAME = 4; // 2px border each side
    var w = area ? area.w - FRAME : 360;
    var h = area ? area.h - FRAME : 360;
    var v = solveBoardView(rows, cols, w, h);
    boardView = { t: v.t, tw: v.tw, th: v.th, cols: v.cols, rows: v.rows };
    return Math.floor(Math.min(v.tw, v.th)); // whole pixels for icon sizing
  }

  /* Sizes the canvas to the current board view. */
  function applyBoardView() {
    canvas.width = Math.round(boardView.cols * boardView.tw);
    canvas.height = Math.round(boardView.rows * boardView.th);
    content.style.width = canvas.width + "px";
    content.style.height = canvas.height + "px";
    requestDraw(); // resizing a canvas clears it
  }

  /* Where a cell sits on screen. */
  function cellBox(cell) {
    var dc = boardView.t ? cell.y : cell.x;
    var dr = boardView.t ? cell.x : cell.y;
    var x0 = Math.round(dc * boardView.tw), x1 = Math.round((dc + 1) * boardView.tw);
    var y0 = Math.round(dr * boardView.th), y1 = Math.round((dr + 1) * boardView.th);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  /* Which column (or row) a pixel falls in, using exactly the same rounded
     edges cellBox() draws, so a tap always lands on the cell it is drawn on. */
  function indexAt(pos, size, count) {
    var i = Math.floor(pos / size);
    while (i > 0 && Math.round(i * size) > pos) i--;
    while (i < count && Math.round((i + 1) * size) <= pos) i++;
    return i;
  }

  // ---------- DOM refs ----------
  const startScreen = document.getElementById("startScreen");
  const levelScreen = document.getElementById("levelScreen");
  const customizeScreen = document.getElementById("customizeScreen");
  const gameScreen = document.getElementById("gameScreen");
  const wrapperEl = document.querySelector(".wrapper");
  const playBtn = document.getElementById("playBtn");
  const selectLevelBtn = document.getElementById("selectLevelBtn");
  const customizeBtn = document.getElementById("customizeBtn");
  const backToStartBtn = document.getElementById("backToStartBtn");
  const backFromCustomizeBtn = document.getElementById("backFromCustomizeBtn");
  const levelGridEl = document.getElementById("levelGrid");
  const progressTextEl = document.getElementById("progressText");
  const customizeTabsEl = document.getElementById("customizeTabs");
  const customizeGridEl = document.getElementById("customizeGrid");

  const coinCountStart = document.getElementById("coinCountStart");
  const coinCountGame = document.getElementById("coinCountGame");
  const coinCountCustomize = document.getElementById("coinCountCustomize");

  const content = document.getElementById("mineSweeper");
  const levelBadge = document.getElementById("levelBadge");
  const prevLevelNavBtn = document.getElementById("prevLevelNavBtn");
  const nextLevelNavBtn = document.getElementById("nextLevelNavBtn");
  const exitBtn = document.getElementById("exitBtn");
  const resetButton = document.getElementById("resetGame");
  const timerEl = document.getElementById("timerDisplay");
  const mineCountEl = document.getElementById("mineCount");
  const mistakesPill = document.getElementById("mistakesPill");
  const mistakeCountEl = document.getElementById("mistakeCount");

  // Result popup — Pac-Man's #overlay .modal (same ids as Pac-Man)
  const overlay = document.getElementById("overlay");
  const modalTitle = document.getElementById("modalTitle");
  const modalMessage = document.getElementById("modalMessage");
  const modalCoins = document.getElementById("modalCoins");
  const modalRewards = document.getElementById("modalRewards");
  const modalBannerAd = document.getElementById("modalBannerAd");
  const modalCloseX = document.getElementById("modalCloseX");
  const continueAdBtn = document.getElementById("continueAdBtn");
  const continueNote = document.getElementById("continueNote");
  const resultModal = overlay.querySelector(".modal");
  let modalPrimaryBtn = document.getElementById("modalPrimaryBtn");
  let modalSecondaryBtn = document.getElementById("modalSecondaryBtn");
  let modalPrevBtn = document.getElementById("modalPrevBtn");

  // Confirm dialog — Pac-Man's #confirmOverlay
  const confirmOverlayEl = document.getElementById("confirmOverlay");
  const confirmTitleEl = document.getElementById("confirmTitle");
  const confirmMessageEl = document.getElementById("confirmMessage");
  const confirmSubMessageEl = document.getElementById("confirmSubMessage");
  const confirmOkBtn = document.getElementById("confirmOkBtn");
  const confirmCancelBtn = document.getElementById("confirmCancelBtn");

  const toastEl = document.getElementById("toast");
  const howToPlayOverlay = document.getElementById("howToPlayOverlay");
  const howToPlayClose = document.getElementById("howToPlayClose");

  // Video ad overlay — Pac-Man's #adOverlay
  const adOverlayEl = document.getElementById("adOverlay");
  const adVideoEl = document.getElementById("adVideo");
  const adStatusEl = document.getElementById("adStatus");
  const adAdvertiserEl = document.getElementById("adAdvertiser");
  const adCountdownEl = document.getElementById("adCountdown");
  const adSkipBtn = document.getElementById("adSkipBtn");
  const adUnmuteBtn = document.getElementById("adUnmuteBtn");
  const adRewardNoteEl = document.getElementById("adRewardNote");

  const muteBtn = document.getElementById("muteBtn");
  const muteIcon = document.getElementById("muteIcon");

  // ---------- State ----------
  let canvas, ctx;
  let currentLevel = 1;
  let cfg = null;
  let tabuleiro = [];
  let gameStarted = false;
  let gameOver = false;
  let secondsElapsed = 0;
  let timerInterval = null;
  let activeCustomizeTab = "theme";

  // per-attempt reward/revive tracking
  let hadMistake = false; // a WRONG FLAG this attempt (the "No Wrong Flags" bonus)
  let mistakes = 0; // mines hit this attempt; MAX_MISTAKES ends the game
  let levelPlayPending = false; // entered via the ads unlock, board not touched yet
  let preDeathSnapshot = null;
  let lastDetonatedCellRef = null;
  const VIDEO_AD_LEVELS_INTERVAL = 3; // interstitial video ad every 3rd level (3, 6, 9, ...)
  const MUTE_KEY = "minesweeperMuted"; // a device setting: kept through the 24-hour reset, like Pac-Man's
  let isMuted = store.getItem(MUTE_KEY) === "1";


  // ---------- Toast ----------
  let toastTimer = null;
  /* Pac-Man's toast: a dark pill at the bottom centre, 3.2s. */
  function showToast(message, duration) {
    toastEl.textContent = message;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), duration || 3200);
  }

  function random(min = 0, max) {
    return arguments.length < 2 ? Math.floor(Math.random() * min) : Math.floor(Math.random() * (max - min + 1) + min);
  }

  // ---------- Board generation ----------
  function preencherTabuleiro(cols, rows, tileSize) {
    const matrix = Array.from({ length: rows }, (col, y) => Array.from({ length: cols }, (row, x) => new Celula(x, y, tileSize)));
    return lancarBombas(matrix);
  }

  function freeOptions(matriz) {
    var options = [];
    for (var i = 0, lenI = matriz.length; i < lenI; i++) {
      for (var j = 0, lenJ = matriz[i].length; j < lenJ; j++) {
        if (matriz[i][j].neighborsCount !== -1) options.push([i, j]);
      }
    }
    return options;
  }

  function lancarBombas(matriz) {
    var options = freeOptions(matriz);
    while (cfg.bombs > quantidadeBombas(matriz)) {
      var index = random(options.length),
        choice = options.splice(index, 1)[0];
      var celula = matriz[choice[0]][choice[1]];
      if (celula.neighborsCount === 0) {
        celula.neighborsCount = -1;
        celula.detonated = false;
      }
    }
    return lancarIndicadores(matriz);
  }

  function lancarIndicadores(matriz) {
    matriz.forEach((row, y) => {
      row.forEach((celula, x) => {
        if (celula.neighborsCount === -1) return;
        for (var i = -1, indicador = 0; i <= 1; i++) {
          if (!matriz[y + i]) continue;
          for (var j = -1; j <= 1; j++) {
            var vizinha = matriz[y + i][x + j];
            if (!vizinha || (!i && !j)) continue;
            if (vizinha.neighborsCount === -1) indicador++;
          }
        }
        celula.neighborsCount = indicador;
      });
    });
    return matriz;
  }

  function quantidadeBombas(matriz) {
    return matriz.reduce((acc, cur) => acc + cur.filter((cell) => cell.neighborsCount < 0).length, 0);
  }

  // ---------- Drawing ----------
  function clearCanvas(newColor) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawRect(0, 0, canvas.width, canvas.height, newColor || getEquippedItem("theme").bg);
  }

  function drawRect(x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
  }

  function drawEmojiIcon(emoji, x, y, tileSize) {
    ctx.save();
    ctx.font = Math.floor(tileSize * 0.6) + "px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(emoji, x + tileSize / 2, y + tileSize / 2 + 1);
    ctx.restore();
  }

  function drawCustomTileBg(x, y, w, h, design) {
    ctx.fillStyle = design.border;
    ctx.fillRect(x, y, w, h);
    const grad = ctx.createLinearGradient(x, y, x + w, y + h);
    grad.addColorStop(0, design.base);
    grad.addColorStop(1, design.base2);
    ctx.fillStyle = grad;
    ctx.fillRect(x + 1.5, y + 1.5, w - 3, h - 3);
  }

  function drawCell(cell, tileSize) {
    const box = cellBox(cell);
    // Icons go in a square centred in the cell, so they are never stretched.
    const s = Math.min(box.w, box.h),
      x = box.x + (box.w - s) / 2,
      y = box.y + (box.h - s) / 2;

    if (!cell.covered) {
      cell.draw(ctx, tileSize, box);
      MSDraw.sunken(ctx, box.x, box.y, box.w, box.h);
      return;
    }

    // A mine the player hit (a mistake): a red flag on the red cell, so it
    // is clearly marked. It stays flagged underneath, so the mine counter and
    // double-click count it.
    if (cell.locked) {
      MSDraw.cellBgRect(ctx, box.x, box.y, box.w, box.h, MS_PALETTE.errorBg, MS_PALETTE.error);
      MSDraw.flag(ctx, x, y, s, MS_PALETTE.hitFlag, MS_PALETTE.hitFlagPole);
      MSDraw.sunken(ctx, box.x, box.y, box.w, box.h);
      return;
    }

    const tileDesign = getEquippedItem("tile");
    const flagDesign = getEquippedItem("flag");
    const theme = getEquippedItem("theme");

    if (tileDesign.id !== "classic") {
      drawCustomTileBg(box.x, box.y, box.w, box.h, tileDesign);
    } else {
      MSDraw.cellBgRect(ctx, box.x, box.y, box.w, box.h, theme.bg, theme.grid);
    }
    MSDraw.raised(ctx, box.x, box.y, box.w, box.h);

    if (cell.flag === "bombFlag") {
      if (flagDesign.id !== "classic") {
        drawEmojiIcon(flagDesign.emoji, x, y, s);
      } else {
        MSDraw.flag(ctx, x, y, s);
      }
    } else if (cell.flag === "suspect") {
      MSDraw.question(ctx, x, y, s);
    }
  }

  /* ---------- Re-fit the board to the window, mid-game ----------
     Recomputes the layout and the tile size WITHOUT touching the game: the
     mines, flags, covered and revealed cells all live on the cells, and only
     their `w` (the tile size they hit-test and draw against) is updated.
     The ads are placed first (fitGameLayout, inside computeTileSize),
     because the board is measured against the room they leave. */
  function refitBoardToViewport() {
    if (!cfg || !tabuleiro || !gameScreen || gameScreen.classList.contains("hidden")) {
      fitGameLayout();
      return;
    }
    var before = boardView;
    var next = computeTileSize(cfg.rows, cfg.cols);
    if (!next) return;
    if (next === cfg.tileSize && before.t === boardView.t && before.tw === boardView.tw && before.th === boardView.th) return;

    cfg.tileSize = next;
    applyBoardView();
    tabuleiro.forEach(function (row) {
      row.forEach(function (cell) { cell.w = next; });
    });
    draw();
  }

  var refitTimer = null;
  function scheduleRefit() {
    clearTimeout(refitTimer);
    refitTimer = setTimeout(refitBoardToViewport, 90);
  }
  window.addEventListener("resize", scheduleRefit);
  /* iPhone rotation (Pac-Man's fix for the same bug): Safari can fire
     orientationchange / resize while it still reports the PRE-rotation size,
     so a layout taken from that moment is stale — the board came out sized
     for the old orientation, centred with blank space on both sides (or
     without its side ads), and with no later event nothing corrected it.
     As in Pac-Man, three independent triggers now feed the same re-fit, so
     any one of them reading the right size is enough:
       - orientationchange, as before;
       - an unconditional re-fit 350ms after it, once Safari has settled;
       - visualViewport's resize, which reports the real post-rotation (and
         toolbar show / hide) size sooner than window's resize does. */
  window.addEventListener("orientationchange", function () {
    scheduleRefit();
    setTimeout(refitBoardToViewport, 350);
  });
  if (window.visualViewport) window.visualViewport.addEventListener("resize", scheduleRefit);
  window.addEventListener("load", scheduleRefit);
  window.addEventListener("pageshow", scheduleRefit);
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(scheduleRefit);
    document.fonts.ready.then(() => requestDraw()); // numbers re-drawn in Inter once it has loaded
  }
  /* Like Pac-Man's ResizeObserver on its canvas: whenever the board area
     changes size (rotation, bar height tier, address bar), the ads and the
     board are re-fitted with no page reload. */
  if (window.ResizeObserver) {
    var stageEl = document.querySelector("#gameScreen .game-container");
    if (stageEl) new ResizeObserver(scheduleRefit).observe(stageEl, { box: "border-box" });
  }

  function draw() {
    clearCanvas();
    tabuleiro.forEach((row) => row.forEach((cell) => drawCell(cell, cfg.tileSize)));
  }

  /* BUG FIX (performance): update() used to redraw the whole board on every
     animation frame — ~60 times a second, even with nothing changing and even
     while the board was hidden behind the menus — which kept the main thread
     ~100% busy on large boards (heat, battery drain, laggy taps on phones).
     Now the board is drawn only when something marked it changed
     (requestDraw) and only while the game screen is showing. Everything that
     changes what the board looks like calls requestDraw(): input on the
     board, a new board, a resize / rotation, Continue, a new theme, and the
     web font finishing loading. */
  let needsDraw = true;
  function requestDraw() {
    needsDraw = true;
  }
  function update() {
    if (needsDraw && tabuleiro.length && !gameScreen.classList.contains("hidden")) {
      needsDraw = false;
      draw();
    }
    requestAnimationFrame(update);
  }

  // ---------- Game state helpers ----------
  function virgin() {
    return !tabuleiro.some((row) => row.some((celula) => !celula.covered));
  }

  function clearIsUncovered() {
    const coveredCells = tabuleiro.length * tabuleiro[0].length;
    const currentDiscovered = tabuleiro.reduce(
      (acc, cur) => acc + cur.filter((celula) => celula.neighborsCount !== -1 && !celula.covered).length,
      0
    );
    return coveredCells - cfg.bombs === currentDiscovered;
  }

  function noOneIsDetonated() {
    return !tabuleiro.some((row) => row.some((celula) => celula.detonated));
  }

  /* The cell under a pointer position (measured from the board's outer
     edge, as the click handlers do). Reads the board view, so it always
     returns the cell drawn at that spot, whichever way the grid is laid out. */
  function selectedElement(posX, posY) {
    var px = posX - (content.clientLeft || 0);
    var py = posY - (content.clientTop || 0);
    if (px < 0 || py < 0 || !boardView.tw || !boardView.th) return null;
    var dc = indexAt(px, boardView.tw, boardView.cols);
    var dr = indexAt(py, boardView.th, boardView.rows);
    if (dc >= boardView.cols || dr >= boardView.rows) return null;
    var x = boardView.t ? dr : dc;
    var y = boardView.t ? dc : dr;
    return (tabuleiro[y] && tabuleiro[y][x]) || null;
  }

  /* First click is always safe: while the first tile revealed would be a
     mine, a fresh board is dealt. BUG FIX: flags / ? marks placed BEFORE that
     first click were silently lost with the old board (and the mine counter
     kept showing the old count). They are now carried over to the same tiles
     of the new board, and the counter and the "No Wrong Flags" check follow
     the new board. */
  function virginGame(_el, x, y) {
    let marks = null;
    while (_el && _el.neighborsCount === -1 && virgin()) {
      if (!marks) marks = tabuleiro.map((row) => row.map((c) => c.flag));
      tabuleiro = preencherTabuleiro(cfg.cols, cfg.rows, cfg.tileSize);
      _el = selectedElement(x, y);
    }
    if (marks) {
      tabuleiro.forEach((row, yy) => row.forEach((c, xx) => { c.flag = marks[yy][xx]; }));
      hadMistake = tabuleiro.some((row) => row.some((c) => c.flag === "bombFlag" && c.neighborsCount !== -1));
      updateMineCount();
    }
    return _el;
  }

  function tagBombsCovered(matriz, el) {
    matriz.forEach((row) => {
      row.forEach((celula) => {
        if (celula.neighborsCount === -1 && celula.flag) return;
        if (celula.neighborsCount === -1 && !celula.flag) {
          celula.covered = false;
          celula.detonated = celula === el;
        }
        if (celula.neighborsCount >= 0 && celula.flag) {
          celula.covered = false;
        }
      });
    });
  }

  // ---------- Snapshot for ad-continue revive ----------
  function captureDeathSnapshot(triggerCell) {
    preDeathSnapshot = tabuleiro.map((row) => row.map((c) => ({ covered: c.covered, flag: c.flag, detonated: c.detonated })));
    lastDetonatedCellRef = triggerCell;
  }

  // ---------- Timer & mine counter ----------
  function updateTimerDisplay() {
    const m = String(Math.floor(secondsElapsed / 60)).padStart(2, "0");
    const s = String(secondsElapsed % 60).padStart(2, "0");
    timerEl.textContent = m + ":" + s;
  }

  function startTimer() {
    if (timerInterval) return;
    timerInterval = setInterval(() => {
      secondsElapsed++;
      updateTimerDisplay();
    }, 1000);
  }

  function stopTimer() {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  function updateMineCount() {
    const flagged = tabuleiro.reduce((acc, row) => acc + row.filter((c) => c.flag === "bombFlag").length, 0);
    mineCountEl.textContent = String(Math.max(0, cfg.bombs - flagged)).padStart(2, "0");
  }

  // ---------- 3-mistake limit ----------
  function updateMistakesDisplay(bump) {
    if (!mistakeCountEl) return;
    mistakeCountEl.textContent = mistakes + "/" + MAX_MISTAKES;
    if (mistakesPill) {
      mistakesPill.classList.toggle("has-mistakes", mistakes > 0);
      mistakesPill.classList.toggle("last-chance", mistakes >= MAX_MISTAKES - 1);
      mistakesPill.setAttribute("title", "Mistakes: " + mistakes + " of " + MAX_MISTAKES + " (mines hit)");
      mistakesPill.classList.remove("bump");
      if (bump) {
        void mistakesPill.offsetWidth; // restart the animation
        mistakesPill.classList.add("bump");
      }
    }
  }

  /* A mine was hit. Mistakes 1 and 2: the mine is shown and locked (it can't
     be unflagged or hit again) and play goes on. Mistake 3: Game Over, through
     the same flow as before (snapshot for Watch Ad & Continue, every mine
     shown, the popup after the explosion). Returns true when the game ended. */
  function hitMine(cell) {
    mistakes++;
    updateMistakesDisplay(true);
    playExplosionSound();
    if (mistakes >= MAX_MISTAKES) {
      captureDeathSnapshot(cell);
      tagBombsCovered(tabuleiro, cell);
      gameOver = true;
      stopTimer();
      requestDraw();
      setTimeout(() => endGame(false), 900);
      return true;
    }
    cell.flag = "bombFlag";
    cell.locked = true;
    updateMineCount();
    requestDraw();
    const left = MAX_MISTAKES - mistakes;
    showToast("You hit a mine! " + left + (left === 1 ? " mistake" : " mistakes") + " left.");
    return false;
  }

  // ---------- Win / lose ----------
  function checkVictory() {
    if (clearIsUncovered()) endGame(true);
  }

  /* ================= RESULT POPUP (Pac-Man #overlay .modal) =================
     Same card, same button row, same MREC as Pac-Man's Congratulations /
     Game Over popup. The CONTENT and the ACTIONS stay Minesweeper's:
       Win  -> Next Level | Previous level | Play Again, plus the coins earned
               and the reward breakdown (Board Cleared / No Wrong Flags /
               Fast Clear).
       Lose -> Watch Ad & Continue (once per attempt, as before) | Retry Level
               | Level Select.
       X    -> main menu, as before. */
  function renderRewardBreakdown(rewards, total) {
    modalCoins.textContent = "+" + total + " \uD83E\uDE99 coins";
    modalCoins.classList.remove("hidden");
    // Non-breaking inside each bonus, so a line only ever breaks between them.
    modalRewards.textContent = rewards.map((r) => r.label.replace(/ /g, "\u00a0") + "\u00a0+" + r.amount).join(" \u00b7 ");
    modalRewards.classList.remove("hidden");
  }

  /* Clone-and-replace so a listener from the previous popup never lingers
     (Pac-Man's wireModalButtons). */
  function freshButton(btn) {
    const fresh = btn.cloneNode(true);
    btn.replaceWith(fresh);
    return fresh;
  }
  function wireModalButtons(primaryLabel, secondaryLabel, onPrimary, onSecondary) {
    modalPrimaryBtn = freshButton(modalPrimaryBtn);
    modalSecondaryBtn = freshButton(modalSecondaryBtn);
    modalPrevBtn = freshButton(modalPrevBtn);
    modalPrevBtn.classList.add("hidden");
    modalPrimaryBtn.disabled = false;
    modalPrimaryBtn.textContent = primaryLabel;
    modalPrimaryBtn.addEventListener("click", onPrimary);
    if (secondaryLabel) {
      modalSecondaryBtn.textContent = secondaryLabel;
      modalSecondaryBtn.classList.remove("hidden");
      modalSecondaryBtn.addEventListener("click", onSecondary);
    } else {
      modalSecondaryBtn.classList.add("hidden");
    }
  }
  function setModalPrevLevel(level) {
    if (!level || level < 1) { modalPrevBtn.classList.add("hidden"); return; }
    modalPrevBtn.textContent = "\u2B05 Level " + level;
    modalPrevBtn.classList.remove("hidden");
    // Same gate as Level Select (Pac-Man goToLevelGated): a locked level
    // can't be reached for free from here.
    modalPrevBtn.addEventListener("click", () => goToLevelGated(level, { closeOverlay: true }));
  }
  /* The win / Game Over popup opens after Pac-Man's 150ms beat. The timer is
     kept so anything that leaves the board inside it (Exit, New Game, the
     24-hour reset) cancels it, instead of the popup opening on top of Level
     Select or the menu. */
  let resultPopupTimer = null;
  function hideOverlay() {
    clearTimeout(resultPopupTimer);
    resultPopupTimer = null;
    overlay.classList.add("hidden");
    stopModalBannerCarousel();
  }
  function goToLevelSelect() {
    hideOverlay();
    showLevelScreen();
  }

  /* ===== Win / Game Over — Pac-Man's handleLevelWin / handleGameOver =====
     Minesweeper's rules decide WHEN a board is won or lost (unchanged); from
     that moment the flow is Pac-Man's:
       Win  - coins are paid the FIRST time a level is cleared only (Pac-Man's
              anti-farming rule); Minesweeper's own bonuses (Board Cleared /
              No Wrong Flags / Fast Clear) make up that first-clear payout.
              Buttons: Next Level (after every 3rd level the interstitial
              plays first) | <- Level N | Levels. Last level: Levels.
       Lose - Watch Ad & Continue on EVERY Game Over, no cap (Pac-Man), each
              one restores the board as it was before the mine, with that
              mine flagged | Retry Level | Level Select.
       X    - Level Select (Pac-Man). */
  function endGame(won) {
    // A mine's popup is scheduled 900ms after the click (the explosion). If
    // the player has since started a new board or left the game, it is moot.
    if (!won && !gameOver) return;
    if (gameScreen.classList.contains("hidden")) return;
    gameOver = true;
    stopTimer();
    if (won) playWinSound();
    else playLoseSound();

    const level = currentLevel;
    const isLast = level >= TOTAL_LEVELS;
    const clearTime = timerEl.textContent;

    if (won) {
      const firstClear = !isLevelCompleted(level);
      markLevelCompleted(level); // cleared + next level unlocked for free
      syncLevelNavButtons();
      const rewards = [{ label: "Board Cleared", amount: REWARD_COMPLETE }];
      let total = REWARD_COMPLETE;
      if (!hadMistake) {
        rewards.push({ label: "No Wrong Flags", amount: REWARD_NO_MISTAKES });
        total += REWARD_NO_MISTAKES;
      }
      if (secondsElapsed <= cfg.fastTime) {
        rewards.push({ label: "Fast Clear", amount: REWARD_FAST });
        total += REWARD_FAST;
      }
      const coinsEarned = firstClear ? total : 0;
      if (coinsEarned > 0) addCoins(coinsEarned);

      clearTimeout(resultPopupTimer);
      resultPopupTimer = setTimeout(() => {
        resultPopupTimer = null;
        modalTitle.textContent = "\uD83C\uDF89 Congratulations!";
        modalMessage.textContent = isLast
          ? "You finished all " + TOTAL_LEVELS + " levels! Last board cleared in " + clearTime + "."
          : "Level " + level + " cleared in " + clearTime + ". Level " + (level + 1) + " is now unlocked.";
        if (coinsEarned > 0) {
          renderRewardBreakdown(rewards, coinsEarned);
        } else {
          modalCoins.textContent = "Already cleared \u2014 coins are paid on the first clear only";
          modalCoins.classList.remove("hidden");
          modalRewards.classList.add("hidden");
        }
        continueAdBtn.classList.add("hidden");
        continueNote.classList.add("hidden");
        loadLevelCompleteBanner();

        wireModalButtons(
          isLast ? "\uD83D\uDDFA Levels" : "Next Level \u27A1",
          "\uD83D\uDDFA Levels",
          () => {
            if (isLast) { playClickSound(); goToLevelSelect(); return; }
            goToNextLevelFromPopup(level);
          },
          () => { playClickSound(); goToLevelSelect(); }
        );
        // From level 2 on: straight back into the level before this one.
        setModalPrevLevel(level > 1 ? level - 1 : 0);
        resultModal.classList.add("win-modal");
        overlay.classList.remove("hidden");
        fitResultPopup();
      }, 150);
    } else {
      clearTimeout(resultPopupTimer);
      resultPopupTimer = setTimeout(() => {
        resultPopupTimer = null;
        modalTitle.textContent = "Game Over \uD83D\uDC80";
        resultModal.classList.remove("win-modal", "banner-fitted");
        resultModal.style.removeProperty("--win-banner-w");
        modalMessage.textContent = "You hit " + MAX_MISTAKES + " mines on Level " + level + " \u2014 that's the " + MAX_MISTAKES + "-mistake limit. Try again?";
        modalCoins.classList.add("hidden");
        modalRewards.classList.add("hidden");
        modalBannerAd.classList.add("hidden");
        modalBannerAd.innerHTML = "";
        stopModalBannerCarousel();

        // Always offered — no cap on ad-based continues (Pac-Man).
        const canContinue = !!preDeathSnapshot;
        continueAdBtn.classList.toggle("hidden", !canContinue);
        continueAdBtn.disabled = false;
        continueNote.classList.toggle("hidden", !canContinue);
        continueNote.textContent = "Watch a short ad to pick up right where you left off \u2014 the mine you hit gets flagged for you and all " + MAX_MISTAKES + " mistakes are restored.";

        wireModalButtons(
          "\uD83D\uDD01 Retry Level",
          "\uD83D\uDDFA Level Select",
          () => { playClickSound(); hideOverlay(); startLevel(level); },
          () => { playClickSound(); goToLevelSelect(); }
        );
        overlay.classList.remove("hidden");
      }, 150);
    }
  }

  /* Next Level from the Congratulations popup. After every 3rd level the
     interstitial plays first (Pac-Man's "level_gate"); the next level was
     already earned, so the game moves on even if the ad could not load. */
  function goToNextLevelFromPopup(clearedLevel) {
    playClickSound();
    if (modalPrimaryBtn.disabled) return;
    const targetLevel = Math.min(clearedLevel + 1, TOTAL_LEVELS);
    if (clearedLevel % VIDEO_AD_LEVELS_INTERVAL === 0) {
      modalPrimaryBtn.disabled = true;
      const epoch = sessionEpoch;
      playVideoAd({
        placement: "level_gate",
        rewardText: "Level " + clearedLevel + " cleared \u2014 your next board is coming up!",
      }).then(() => {
        modalPrimaryBtn.disabled = false;
        if (epoch !== sessionEpoch) return; // 24-hour reset during the ad: stay where it put the player
        hideOverlay();
        showGameScreen(targetLevel);
      });
    } else {
      hideOverlay();
      showGameScreen(targetLevel);
    }
  }

  /* ================= VIDEO / BANNER ADS (Pac-Man standard) ================= */
  let sponsorCataloguePromise = null;
  function loadSponsorCatalogue() {
    if (sponsorCataloguePromise) return sponsorCataloguePromise;
    sponsorCataloguePromise = fetch(SPONSOR_JSON_URL, { cache: "no-store" })
      .then((res) => { if (!res.ok) throw new Error("bad status"); return res.json(); })
      .then((data) => { if (!data || !data.ads || !data.ads.length) throw new Error("empty"); return data; })
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
      return Object.assign({}, list[i % list.length], { _slot: i % list.length, _slots: list.length });
    });
  }
  function adDotsHtml(ad) {
    if (!ad || !(ad._slots > 1)) return "";
    let h = '<div class="ad-dots" aria-hidden="true">';
    for (let i = 0; i < ad._slots; i++) h += "<i" + (i === ad._slot ? ' class="on"' : "") + "></i>";
    return h + "</div>";
  }
  function swapAdCard(el, build) {
    if (!el) return Promise.resolve();
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || !el.innerHTML) { build(); return Promise.resolve(); }
    el.classList.add("ad-fading");
    return new Promise((resolve) => {
      setTimeout(() => {
        build();
        resolve();
        requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove("ad-fading")));
      }, 260);
    });
  }
  function adIsImage(ad) {
    if (!ad) return false;
    if (ad.adType && String(ad.adType).toLowerCase() === "image") return true;
    return /\.(png|jpe?g|gif|webp|avif)(\?|$)/i.test(ad.streamUrl || "");
  }

  /* ---------- MREC 300x250 inside the Congratulations popup ---------- */
  function buildBannerCard(el, ad) {
    el.classList.toggle("clickable", !!ad.clickUrl);
    el.onclick = ad.clickUrl ? () => window.open(ad.clickUrl, "_blank", "noopener") : null;
    el.classList.remove("hidden");
    el.removeAttribute("style");
    el.innerHTML =
      '<img class="ad-unit-img" src="' + (ad.imageUrl || ad.streamUrl) + '" width="300" height="250" alt="' +
      (ad.advertiser || "Advertisement") + '" />' + adDotsHtml(ad);
    if (el === modalBannerAd) fitResultPopup();
  }

  /* ---------- Congratulations popup: always fits, never scrolls ----------
     The popup keeps Pac-Man's sizes at every breakpoint. On a screen too short
     for all of it (phones on their side, short laptop windows), the MREC is
     the one part that gives way: it is scaled down — whole, still 6:5 — by
     exactly what the card overflows, so the title, message, coins, bonuses
     and buttons all stay visible without scrolling. Re-checked whenever a
     creative is placed and when the window is resized or rotated. */
  const MIN_BANNER_H = 80; // px: the smallest the MREC is drawn
  function fitResultPopup() {
    if (!resultModal) return;
    resultModal.classList.remove("banner-fitted");
    resultModal.style.removeProperty("--win-banner-w");
    if (overlay.classList.contains("hidden") || modalBannerAd.classList.contains("hidden")) return;
    const over = resultModal.scrollHeight - resultModal.clientHeight;
    if (over <= 0) return;
    const h = modalBannerAd.offsetHeight;
    const fitH = Math.max(MIN_BANNER_H, h - over - 2);
    resultModal.style.setProperty("--win-banner-w", Math.floor(fitH * 1.2) + "px");
    resultModal.classList.add("banner-fitted");
  }
  let fitPopupFrame = 0;
  function scheduleFitResultPopup() {
    if (overlay.classList.contains("hidden")) return;
    cancelAnimationFrame(fitPopupFrame);
    fitPopupFrame = requestAnimationFrame(fitResultPopup);
  }
  window.addEventListener("resize", scheduleFitResultPopup);
  window.addEventListener("orientationchange", () => setTimeout(scheduleFitResultPopup, 250));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(scheduleFitResultPopup);
  let modalBannerCarouselTimer = null;
  function stopModalBannerCarousel() {
    if (modalBannerCarouselTimer) { clearInterval(modalBannerCarouselTimer); modalBannerCarouselTimer = null; }
  }
  function startModalBannerCarousel() {
    if (modalBannerCarouselTimer) return;
    modalBannerCarouselTimer = setInterval(() => {
      if (modalBannerAd.classList.contains("hidden") || overlay.classList.contains("hidden")) {
        stopModalBannerCarousel();
        return;
      }
      fetchAd({ placement: "level_complete_banner", adType: "image" }).then((ad) => {
        if (!ad || !adIsImage(ad)) return;
        if (modalBannerAd.classList.contains("hidden")) return;
        if (overlay.classList.contains("hidden")) { stopModalBannerCarousel(); return; }
        swapAdCard(modalBannerAd, () => buildBannerCard(modalBannerAd, ad));
      });
    }, AD_ROTATE_MS);
  }
  function loadLevelCompleteBanner() {
    modalBannerAd.classList.add("hidden");
    modalBannerAd.innerHTML = "";
    fetchAd({ placement: "level_complete_banner", adType: "image" }).then((ad) => {
      if (!ad || !adIsImage(ad) || overlay.classList.contains("hidden") || !gameOver) {
        modalBannerAd.classList.add("hidden");
        modalBannerAd.innerHTML = "";
        stopModalBannerCarousel();
        return;
      }
      buildBannerCard(modalBannerAd, ad);
      startModalBannerCarousel();
    });
  }

  /* ---------- Fullscreen video ad (Pac-Man playVideoAd) ----------
     Always resolves with { shown: boolean }. If no ad is available or it
     fails to load, the overlay closes and the caller decides what happens. */
  let adIsPlaying = false;
  function closeAdOverlay() {
    adIsPlaying = false;
    // A video ad with sound can take Android's audio output away from the
    // game's sound engine: the next tap starts it afresh.
    rebuildAudioOnNextTap();
    try {
      adVideoEl.pause();
      adVideoEl.removeAttribute("src");
      adVideoEl.load();
    } catch (e) {}
    adOverlayEl.classList.add("hidden");
    adSkipBtn.classList.add("ad-hidden");
    adUnmuteBtn.classList.add("ad-hidden");
    adCountdownEl.textContent = "";
    adAdvertiserEl.textContent = "";
    adRewardNoteEl.textContent = "";
  }
  function playVideoAd(opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      if (adIsPlaying || !adOverlayEl) { resolve({ shown: false }); return; }
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
        if (!ad) { finish(false); return; }
        const duration = Number(ad.duration) || 0;
        const skippable = ad.isSkippable === true;
        const skipAfter = Math.max(0, Number(ad.nonSkippableSeconds) || 0);
        adAdvertiserEl.textContent = ad.advertiser || ad.title || "";

        const onLoaded = () => adStatusEl.classList.add("ad-hidden");
        const onTime = () => {
          const totalLen = duration || adVideoEl.duration || 0;
          const left = Math.max(0, Math.ceil(totalLen - adVideoEl.currentTime));
          adCountdownEl.textContent = totalLen ? left + "s" : "";
          if (skippable && adVideoEl.currentTime >= skipAfter) adSkipBtn.classList.remove("ad-hidden");
        };
        const onEnded = () => finish(true);
        const onError = () => { if (adVideoEl.error) finish(false); };
        const onSkip = () => finish(true);
        const onUnmute = () => {
          adVideoEl.muted = false;
          adVideoEl.volume = 1;
          adUnmuteBtn.classList.add("ad-hidden");
        };
        const tryPlay = () => {
          const pr = adVideoEl.play();
          if (!pr || typeof pr.catch !== "function") return;
          pr.catch((err) => {
            if (err && err.name === "NotAllowedError") {
              adVideoEl.muted = true;
              adUnmuteBtn.classList.remove("ad-hidden");
              const retry = adVideoEl.play();
              if (retry && typeof retry.catch === "function") retry.catch(() => {});
            }
          });
        };
        const onCanPlay = () => { if (adVideoEl.paused) tryPlay(); };

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

        adVideoEl.muted = isMuted;
        adVideoEl.src = ad.streamUrl;
        tryPlay();
        loadTimer = setTimeout(() => {
          if (!settled && adVideoEl.currentTime === 0) finish(false);
        }, AD_LOAD_TIMEOUT_MS);
      });
    });
  }

  /* Watch Ad & Continue — the Minesweeper revive, unchanged: the board goes
     back to how it was just before the mine, that mine is flagged, the clock
     resumes, and it can be used once per level attempt. Only the ad itself
     is now Pac-Man's video player; as in Pac-Man, no ad shown = no continue. */
  let continueAdInFlight = false;
  function continueAfterAd() {
    if (continueAdInFlight) return;
    // Only guards a double tap while this ad is playing — never a cap (Pac-Man).
    if (!gameOver || !preDeathSnapshot || !lastDetonatedCellRef) return;
    continueAdInFlight = true;
    continueAdBtn.disabled = true;
    hideOverlay();
    const epoch = sessionEpoch;
    playVideoAd({
      placement: "continue",
      rewardText: "Watch the ad to continue this board \u2014 the mine you hit gets flagged for you and all " + MAX_MISTAKES + " mistakes are restored.",
    }).then((res) => {
      continueAdInFlight = false;
      if (epoch !== sessionEpoch) { continueAdBtn.disabled = false; return; } // reset during the ad
      if (!res || !res.shown) {
        continueAdBtn.disabled = false;
        continueNote.textContent = "The ad couldn't load, so no continue was given. Please try again.";
        continueNote.classList.remove("hidden");
        overlay.classList.remove("hidden");
        return;
      }
      tabuleiro.forEach((row, y) =>
        row.forEach((c, x) => {
          const snap = preDeathSnapshot[y][x];
          c.covered = snap.covered;
          c.flag = snap.flag;
          c.detonated = snap.detonated;
        })
      );
      // re-cover and flag the mine that was clicked, so it can't be hit again
      lastDetonatedCellRef.covered = true;
      lastDetonatedCellRef.flag = "bombFlag";
      lastDetonatedCellRef.locked = true;
      lastDetonatedCellRef.detonated = false;

      preDeathSnapshot = null;
      lastDetonatedCellRef = null;
      gameOver = false;
      // The ad restores every mistake: the counter goes back to 0, so the
      // player again has MAX_MISTAKES mine hits before the next Game Over.
      mistakes = 0;
      updateMistakesDisplay(false);
      updateMineCount();
      requestDraw();
      startTimer();
    });
  }

  /* ---------- Confirm dialog (Pac-Man #confirmOverlay) ---------- */
  /* Like Pac-Man's dialog it closes only through OK or Cancel. While it (or
     the ads it leads to) is up, the board is frozen the way Pac-Man freezes
     its maze: the clock is held, and handed back if the player cancels. */
  let confirmOnOk = null;
  let confirmOnCancel = null;
  let clockHeld = false;
  function holdClock() {
    if (timerInterval) { stopTimer(); clockHeld = true; }
  }
  function releaseClock() {
    if (!clockHeld) return;
    clockHeld = false;
    if (gameStarted && !gameOver && !isPaused && !gameScreen.classList.contains("hidden")) startTimer();
  }
  function showConfirm(title, message, sub, onOk, onCancel) {
    confirmTitleEl.textContent = title;
    confirmMessageEl.textContent = message;
    confirmSubMessageEl.textContent = sub || "";
    confirmSubMessageEl.classList.toggle("hidden", !sub);
    confirmOnOk = onOk;
    confirmOnCancel = onCancel || null;
    holdClock();
    confirmOverlayEl.classList.remove("hidden");
  }
  function closeConfirm() {
    confirmOverlayEl.classList.add("hidden");
    confirmOnOk = null;
    confirmOnCancel = null;
  }
  confirmOkBtn.addEventListener("click", () => {
    const fn = confirmOnOk;
    closeConfirm();
    if (fn) fn();
  });
  confirmCancelBtn.addEventListener("click", () => {
    const fn = confirmOnCancel;
    playClickSound();
    closeConfirm();
    releaseClock();
    if (fn) fn();
  });

  /* ================= 5-ADS LEVEL UNLOCK (Pac-Man) =================
     Tapping an ad-unlockable level asks first (showUnlockConfirm). OK plays
     UNLOCK_ADS_REQUIRED "recover" video ads back to back — each waits for the
     one before — then unlocks ONLY that level and drops the player into it.
     Every level before it stays locked; winning it unlocks the next one
     normally. One ad that fails to load stops the sequence with no unlock. */
  const UNLOCK_ADS_REQUIRED = 5;
  let levelUnlockInProgress = false;

  function showUnlockConfirm(level, opts) {
    if (levelUnlockInProgress) return;
    const onConfirm = opts && opts.onConfirm;
    showConfirm(
      "\u{1F4FA} Unlock Level " + level,
      "Watch " + UNLOCK_ADS_REQUIRED + " ads to unlock this level and continue the game.",
      "You'll watch " + UNLOCK_ADS_REQUIRED + " short ads back to back, then Level " + level + " unlocks and you can play it.",
      () => {
        if (onConfirm) onConfirm();
        unlockLevelViaAds(level);
      }
    );
  }

  function unlockLevelViaAds(level) {
    if (levelUnlockInProgress) return;
    levelUnlockInProgress = true;
    buildLevelGrid(); // every tile waits while the ads play
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
        releaseClock();
        showToast("An ad couldn't load \u2014 Level " + level + " was not unlocked. Please try again.");
        return;
      }
      clockHeld = false;
      unlockLevel(level); // ONLY this level
      buildLevelGrid(); // level + 1 drops off the ads list straight away
      // Opens the level, but unlocking is not playing: Play keeps pointing at
      // the last level actually played until this board is touched.
      showGameScreen(level, { fromAdUnlock: true });
    });
  }

  /* One gate for every way of jumping to a specific level — Level Select,
     the bar's Prev / Next, the popup's "Level N" (Pac-Man goToLevelGated):
     unlocked -> go; locked but ad-unlockable -> the 5-ads offer; otherwise
     nothing, as with a padlocked tile. */
  function goToLevelGated(level, opts) {
    if (level < 1 || level > TOTAL_LEVELS || levelUnlockInProgress) return;
    const closeOverlay = opts && opts.closeOverlay;
    if (isLevelUnlocked(level)) {
      playClickSound();
      if (closeOverlay) hideOverlay();
      showGameScreen(level);
      return;
    }
    if (isLevelAdUnlockable(level)) {
      playClickSound();
      // The calling popup stays up until the player commits with OK.
      showUnlockConfirm(level, { onConfirm: closeOverlay ? hideOverlay : null });
    }
  }

  // ---------- Input handlers ----------
  function onClickGame(event) {
    event.preventDefault();
    if (gameOver) return;
    var _rect = content.getBoundingClientRect();
    var mouseX = event.clientX - _rect.left;
    var mouseY = event.clientY - _rect.top;

    var _el = virginGame(selectedElement(mouseX, mouseY), mouseX, mouseY);
    if (!_el) return;

    if (_el.covered && !_el.flag && noOneIsDetonated() && !clearIsUncovered()) {
      noteLevelPlayed();
      if (!gameStarted) {
        gameStarted = true;
        startTimer();
      }
      if (_el.neighborsCount === -1) {
        hitMine(_el); // a mistake; the 3rd one is Game Over
        return;
      }
      _el.revealIt(tabuleiro);
      playRevealSound();
      checkVictory();
    }
  }

  function onDoubleClick(event) {
    event.preventDefault();
    if (gameOver) return;
    var _rect = content.getBoundingClientRect();
    var mouseX = event.clientX - _rect.left;
    var mouseY = event.clientY - _rect.top;

    var _el = selectedElement(mouseX, mouseY);
    if (!_el || _el.covered || _el.flag) return;
    if (!noOneIsDetonated() || clearIsUncovered()) return;

    var howMany = 0;
    for (var y = -1; y <= 1; y++) {
      if (!tabuleiro[_el.y + y]) continue;
      for (var x = -1; x <= 1; x++) {
        var vizinha = tabuleiro[_el.y + y][_el.x + x];
        if (!vizinha || (!y && !x)) continue;
        if (vizinha.flag === "bombFlag") howMany++;
      }
    }

    if (howMany === _el.neighborsCount) {
      const before = mistakes;
      if (clearAround(_el, tabuleiro)) return; // that was the last mistake
      if (mistakes === before) playRevealSound();
      checkVictory();
    }
  }

  function clearAround(el, matriz) {
    for (var i = -1; i <= 1; i++) {
      if (!matriz[el.y + i]) continue;
      for (var j = -1; j <= 1; j++) {
        var vizinha = matriz[el.y + i][el.x + j];
        if (!vizinha || vizinha.flag === "bombFlag") continue;
        if (vizinha.neighborsCount === -1) {
          // A wrong flag sent the double click onto a mine: a mistake. The
          // rest of the neighbours still open unless the game just ended.
          if (hitMine(vizinha)) return true;
          continue;
        }
        vizinha.revealIt(matriz);
      }
    }
    return false;
  }

  function onRightClickGame(event) {
    event.preventDefault();
    if (gameOver) return;
    var _rect = content.getBoundingClientRect();
    var mouseX = event.clientX - _rect.left;
    var mouseY = event.clientY - _rect.top;

    var _el = selectedElement(mouseX, mouseY);
    if (_el && _el.locked) return; // a mine already hit: it stays marked
    if (_el && _el.covered && noOneIsDetonated() && !clearIsUncovered()) {
      noteLevelPlayed();
      _el.flag = !_el.flag ? "bombFlag" : _el.flag === "bombFlag" ? "suspect" : null;
      if (_el.flag === "bombFlag") {
        playFlagSound();
        if (_el.neighborsCount !== -1) hadMistake = true; // flagged a safe tile: counts as a mistake
      } else if (_el.flag === "suspect") playSuspectSound();
      else playUnflagSound();
      updateMineCount();
    }
  }

  // ---------- Level lifecycle ----------
  let restartAdUsedThisRun = false; // Pac-Man: one ad-gated Restart per level attempt

  // The board has been touched: if this level was opened by the ads unlock,
  // it now counts as played and becomes where Play resumes.
  function noteLevelPlayed() {
    if (!levelPlayPending) return;
    levelPlayPending = false;
    setLastPlayedLevel(currentLevel);
  }

  function startLevel(levelNum, opts) {
    currentLevel = levelNum;
    // Opening a level from Play, Level Select, Prev / Next, Next Level or
    // Retry is playing it, and Play will come back here. The level that opens
    // on its own after the 5-ads unlock waits until its board is touched.
    if (opts && opts.fromAdUnlock) {
      levelPlayPending = true;
    } else {
      levelPlayPending = false;
      setLastPlayedLevel(levelNum);
    }
    // Any fresh entry into a level offers the ad-gated Restart again (Pac-Man).
    restartAdUsedThisRun = false;
    resetButton.disabled = false;
    cfg = Object.assign({}, LEVELS[levelNum - 1]);
    cfg.tileSize = computeTileSize(cfg.rows, cfg.cols);

    gameOver = false;
    gameStarted = false;
    secondsElapsed = 0;
    hadMistake = false;
    mistakes = 0;
    updateMistakesDisplay(false);
    preDeathSnapshot = null;
    lastDetonatedCellRef = null;
    stopTimer();
    updateTimerDisplay();
    setPaused(false);

    applyBoardView();

    tabuleiro = preencherTabuleiro(cfg.cols, cfg.rows, cfg.tileSize);
    requestDraw();

    // Pac-Man title markup, so the breakpoints can turn "Level 1" into "L1".
    levelBadge.innerHTML = '<span class="lvl-word">Level</span><span class="lvl-num">' + cfg.level + "</span>";
    mineCountEl.textContent = String(cfg.bombs).padStart(2, "0");
    prevLevelNavBtn.disabled = currentLevel <= 1;
    syncLevelNavButtons();
    continueAdBtn.classList.add("hidden");
    modalBannerAd.classList.add("hidden");
    hideOverlay();
    refreshCoinDisplays();
  }

  /* Pac-Man's Prev / Next states: Prev is disabled on level 1, Next until
     the next level is unlocked. Disabled buttons stay visible. */
  function syncLevelNavButtons() {
    prevLevelNavBtn.disabled = currentLevel <= 1;
    nextLevelNavBtn.disabled = currentLevel >= TOTAL_LEVELS || !isLevelUnlocked(currentLevel + 1);
  }

  function initCanvasOnce() {
    canvas = document.createElement("canvas");
    canvas.textContent = "Canvas not supported";
    content.appendChild(canvas);
    ctx = canvas.getContext("2d");

    /* The guard sits on the listener rather than on the cover, so a click
       cannot reach a cell even if the cover is mid-transition or a stray
       event arrives from somewhere else. */
    /* ---------- Touch: long-press = flag, double-tap = chord ----------
       BUG FIX: flagging was wired only to "contextmenu" (right click). iPhone
       and iPad Safari never fire that on a long-press, and Chrome's touch
       emulation showed a long-press arriving as a plain click — so on a phone
       a long-press REVEALED the tile and there was no way to place a flag.
       Touch now follows the usual mobile Minesweeper convention: hold a tile
       ~0.45s to cycle flag / ? / clear (the tap that ends the hold is
       swallowed so it can't also reveal the tile), and double-tap a number to
       chord, which iOS needs because it doesn't reliably send dblclick.
       Mouse input is unchanged. Works whichever arrives first on Android:
       our timer or the browser's own long-press contextmenu. */
    var LONG_PRESS_MS = 450, MOVE_TOLERANCE = 10, DOUBLE_TAP_MS = 350;
    var pressTimer = null, pressAt = null, longPressActive = false, suppressClickUntil = 0;
    var lastTap = null, lastTouchChordAt = 0, lastDblclickAt = 0;
    function cancelPress() { clearTimeout(pressTimer); pressTimer = null; }
    function pointAt(x, y) { return { clientX: x, clientY: y, preventDefault: function () {} }; }
    canvas.addEventListener("pointerdown", function (e) {
      if (e.pointerType === "mouse") return;
      cancelPress();
      pressAt = { x: e.clientX, y: e.clientY };
      pressTimer = setTimeout(function () {
        pressTimer = null;
        if (isPaused) return;
        longPressActive = true;
        onRightClickGame(pointAt(pressAt.x, pressAt.y));
        try { if (navigator.vibrate) navigator.vibrate(12); } catch (err) {}
        requestDraw();
      }, LONG_PRESS_MS);
    });
    canvas.addEventListener("pointermove", function (e) {
      if (pressTimer && pressAt && Math.hypot(e.clientX - pressAt.x, e.clientY - pressAt.y) > MOVE_TOLERANCE) cancelPress();
    });
    function endPress(e) {
      cancelPress();
      if (longPressActive) {
        longPressActive = false;
        suppressClickUntil = Date.now() + 400; // the click that follows this release
        lastTap = null;
        return;
      }
      if (e && e.type === "pointerup" && e.pointerType !== "mouse" && !isPaused) {
        var now = Date.now();
        if (lastTap && now - lastTap.t < DOUBLE_TAP_MS && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 24) {
          lastTap = null;
          var px = e.clientX, py = e.clientY;
          // after this tap's own click has been handled (it may reveal the tile first)
          setTimeout(function () {
            if (Date.now() - lastDblclickAt < 300) return; // the browser's dblclick already chorded
            lastTouchChordAt = Date.now();
            onDoubleClick(pointAt(px, py));
            requestDraw();
          }, 0);
        } else {
          lastTap = { t: now, x: e.clientX, y: e.clientY };
        }
      }
    }
    canvas.addEventListener("pointerup", endPress);
    canvas.addEventListener("pointercancel", endPress);

    canvas.addEventListener("click", function (e) {
      if (Date.now() < suppressClickUntil) return;
      if (!isPaused) onClickGame(e);
      requestDraw();
    }, false);
    canvas.addEventListener("dblclick", function (e) {
      if (Date.now() - lastTouchChordAt < 600) return; // a touch double-tap already chorded
      lastDblclickAt = Date.now();
      if (!isPaused) onDoubleClick(e);
      requestDraw();
    }, false);
    canvas.addEventListener("contextmenu", function (e) {
      e.preventDefault();
      if (isPaused) return;
      if (pressTimer || longPressActive) {
        // the browser's own long-press: let it be THE long-press, once
        if (pressTimer) {
          cancelPress();
          longPressActive = true;
          onRightClickGame(e);
          requestDraw();
        }
        return;
      }
      onRightClickGame(e);
      requestDraw();
    }, false);

    update();
  }

  // ---------- Level select grid (Pac-Man buildLevelGrid) ----------
  function buildLevelGrid() {
    const furthest = getFurthestUnlockedLevel();
    levelGridEl.innerHTML = "";
    LEVELS.forEach((lv) => {
      const completed = isLevelCompleted(lv.level);
      const unlocked = isLevelUnlocked(lv.level);
      const adUnlockable = isLevelAdUnlockable(lv.level);
      const btn = document.createElement("button");
      btn.type = "button";
      // Ad-unlockable tiles look exactly like any other locked tile (as in
      // Pac-Man); only what a tap does differs. Tiles are never disabled, so
      // that tap can always fire — except while the unlock ads are playing.
      btn.className = "level-tile diff-" + lv.diff.toLowerCase() +
        (completed ? " completed" : unlocked ? "" : " locked");
      btn.dataset.level = String(lv.level);
      btn.setAttribute("aria-label", unlocked ? "Level " + lv.level + ", " + lv.diff : "Level " + lv.level + " locked");
      btn.innerHTML = unlocked || completed
        ? '<span class="level-num">' + lv.level + "</span>" +
          (unlocked && !completed ? '<span class="level-diff">' + lv.diff + "</span>" : "")
        : '<span class="level-lock" aria-hidden="true">&#128274;</span><span class="level-num">' + lv.level + "</span>";
      if (adUnlockable) btn.title = "Watch " + UNLOCK_ADS_REQUIRED + " ads to unlock this level and continue the game";
      if (levelUnlockInProgress) btn.disabled = true;
      btn.addEventListener("click", () => {
        if (levelUnlockInProgress) return;
        if (unlocked) {
          playClickSound();
          showGameScreen(lv.level);
        } else if (adUnlockable) {
          playClickSound();
          showUnlockConfirm(lv.level);
        }
      });
      levelGridEl.appendChild(btn);
    });
    progressTextEl.textContent = "Level " + furthest + " of " + TOTAL_LEVELS + " unlocked";
  }

  // ---------- Customize screen ----------
  function renderCustomizeGrid(cat) {
    activeCustomizeTab = cat;
    const state = loadCustomization();
    customizeGridEl.innerHTML = "";
    CATALOG[cat].forEach((item) => {
      const owned = state.unlocked[cat].includes(item.id);
      const equipped = state.equipped[cat] === item.id;
      const card = document.createElement("button");
      card.type = "button";
      card.className = "customize-card" + (equipped ? " equipped" : "") + (!owned ? " locked" : "") +
        // Visual only (Pac-Man shop standard): a price you can't afford yet is
        // drawn greyed out. Clicking still does exactly what it did before.
        (!owned && getCoins() < item.cost ? " cant-afford" : "");

      const swatch = document.createElement("div");
      swatch.className = "customize-swatch";
      if (cat === "flag") {
        swatch.textContent = item.swatch;
        swatch.style.background = "var(--surface)";
      } else {
        swatch.style.background = item.swatch;
      }

      const name = document.createElement("div");
      name.className = "customize-name";
      name.textContent = item.name;

      const cost = document.createElement("div");
      cost.className = "customize-cost" + (owned ? " owned" : "");
      // Pac-Man's shop labels: Equipped / Equip / "Buy · 60 🪙".
      cost.textContent = owned ? (equipped ? "Equipped" : "Equip") : "Buy \u00b7 " + item.cost + " \uD83E\uDE99";

      if (equipped) {
        const badge = document.createElement("span");
        badge.className = "customize-badge-equipped";
        badge.textContent = "\u2713";
        card.appendChild(badge);
      }

      card.appendChild(swatch);
      card.appendChild(name);
      card.appendChild(cost);
      card.addEventListener("click", () => onCustomizeCardClick(cat, item));
      customizeGridEl.appendChild(card);
    });
  }

  function onCustomizeCardClick(cat, item) {
    const state = loadCustomization();
    const owned = state.unlocked[cat].includes(item.id);
    if (owned) {
      if (state.equipped[cat] === item.id) return;
      state.equipped[cat] = item.id;
      saveCustomization(state);
      playClickSound();
      showToast(item.name + " equipped");
    } else {
      if (getCoins() < item.cost) {
        showToast("Not enough coins yet \u2014 keep clearing boards!");
        return;
      }
      spendCoins(item.cost);
      state.unlocked[cat].push(item.id);
      state.equipped[cat] = item.id;
      saveCustomization(state);
      playFlagSound();
      showToast("Unlocked " + item.name + "!");
    }
    renderCustomizeGrid(cat);
  }

  customizeTabsEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".customize-tab");
    if (!btn) return;
    customizeTabsEl.querySelectorAll(".customize-tab").forEach((t) => t.classList.remove("active"));
    btn.classList.add("active");
    playClickSound();
    renderCustomizeGrid(btn.dataset.cat);
  });

  // ---------- Screen navigation ----------
  /* `visible` is only whether we are on the game screen at all. Which ad
     shows (rails or leaderboard), how many and how big is fitGameLayout()'s
     call. Menus never show a display ad, and nothing flashes on open. */
  var gameAdsWanted = false;
  function setSideAdsVisible(visible) {
    gameAdsWanted = !!visible;
    document.documentElement.classList.toggle("ms-game", gameAdsWanted);
    fitGameLayout();
  }

  function showStartScreen() {
    hideOverlay();
    closeConfirm();
    startScreen.classList.remove("hidden");
    levelScreen.classList.add("hidden");
    customizeScreen.classList.add("hidden");
    gameScreen.classList.add("hidden");
    wrapperEl.classList.add("menu-mode");
    setSideAdsVisible(false);
    refreshCoinDisplays();
  }

  function showLevelScreen() {
    hideOverlay();
    closeConfirm();
    buildLevelGrid();
    startScreen.classList.add("hidden");
    levelScreen.classList.remove("hidden");
    customizeScreen.classList.add("hidden");
    gameScreen.classList.add("hidden");
    wrapperEl.classList.add("menu-mode");
    setSideAdsVisible(false);
  }

  function showCustomizeScreen() {
    hideOverlay();
    closeConfirm();
    renderCustomizeGrid(activeCustomizeTab);
    startScreen.classList.add("hidden");
    levelScreen.classList.add("hidden");
    customizeScreen.classList.remove("hidden");
    gameScreen.classList.add("hidden");
    wrapperEl.classList.add("menu-mode");
    setSideAdsVisible(false);
    refreshCoinDisplays();
  }

  function showGameScreen(levelNum, opts) {
    startScreen.classList.add("hidden");
    levelScreen.classList.add("hidden");
    customizeScreen.classList.add("hidden");
    gameScreen.classList.remove("hidden");
    wrapperEl.classList.remove("menu-mode");
    setSideAdsVisible(true);
    // Use rAF to ensure the wrapper has committed to game-mode layout
    // before we measure viewport for tile sizing — prevents the "shrink"
    // bug when switching back from menu screens.
    requestAnimationFrame(() => {
      startLevel(levelNum, opts);
    });
  }

  // ---------- How to play modal ----------
  function openHowToPlay() {
    howToPlayOverlay.classList.remove("hidden");
    howToPlayOverlay.setAttribute("aria-hidden", "false");
  }

  function closeHowToPlay() {
    howToPlayOverlay.classList.add("hidden");
    howToPlayOverlay.setAttribute("aria-hidden", "true");
  }

  // ---------- Event bindings ----------
  playBtn.addEventListener("click", () => { getAudioCtx(); playClickSound(); showGameScreen(getPlayButtonLevel()); });
  selectLevelBtn.addEventListener("click", () => { getAudioCtx(); playClickSound(); showLevelScreen(); });
  customizeBtn.addEventListener("click", () => { getAudioCtx(); playClickSound(); showCustomizeScreen(); });
  backToStartBtn.addEventListener("click", () => { playClickSound(); showStartScreen(); });
  backFromCustomizeBtn.addEventListener("click", () => { playClickSound(); showStartScreen(); });

  /* ---------- Pause ----------
     "All Levels" left the header — the result popup and the main menu both
     still reach the level list, so nothing became unreachable, and the two
     buttons that took its place are the ones you actually want mid-game.
     Pausing stops the clock AND covers the grid: a pause you can read the
     board through is a free hint, not a pause. Clicks are refused while it
     is up rather than merely hidden behind the cover, so a stray click that
     lands on the canvas cannot uncover a cell. */
  var isPaused = false;
  var pauseBtnGame = document.getElementById("pauseBtnGame");
  var pauseIconGame = document.getElementById("pauseIconGame");
  var pauseLblGame = document.getElementById("pauseLblGame");
  var pauseCover = document.getElementById("pauseCover");
  var resumeBtn = document.getElementById("resumeBtn");
  var soundBtnGame = document.getElementById("soundBtnGame");
  var soundIconGame = document.getElementById("soundIconGame");

  function setPaused(next) {
    if (!cfg || gameOver) next = false;
    isPaused = !!next;
    if (pauseCover) pauseCover.classList.toggle("hidden", !isPaused);
    if (pauseBtnGame) {
      pauseBtnGame.setAttribute("aria-pressed", isPaused ? "true" : "false");
      pauseBtnGame.setAttribute("aria-label", isPaused ? "Resume game" : "Pause game");
      pauseBtnGame.title = isPaused ? "Resume" : "Pause";
    }
    if (pauseIconGame) pauseIconGame.innerHTML = isPaused ? "&#9654;" : "&#9208;";
    if (pauseLblGame) pauseLblGame.textContent = isPaused ? "Resume" : "Pause";
    if (pauseBtnGame) pauseBtnGame.classList.toggle("is-paused", isPaused);
    if (isPaused) {
      stopTimer();
    } else if (gameStarted && !gameOver) {
      startTimer();
    }
  }

  if (pauseBtnGame) pauseBtnGame.addEventListener("click", function () {
    playClickSound();
    setPaused(!isPaused);
  });
  if (resumeBtn) resumeBtn.addEventListener("click", function () {
    playClickSound();
    setPaused(false);
  });

  /* One mute state, two buttons. The header button and the one on the start
     screen were never going to stay in step if each kept its own flag. */
  function syncSoundIcons() {
    var glyph = isMuted ? "\u{1F507}" : "\u{1F50A}";
    var label = isMuted ? "Unmute sound" : "Mute sound";
    [[muteBtn, muteIcon], [soundBtnGame, soundIconGame]].forEach(function (pair) {
      if (!pair[0]) return;
      pair[0].classList.toggle("muted", isMuted);
      pair[0].setAttribute("aria-label", label);
      if (pair[1]) pair[1].textContent = glyph;
    });
  }
  /* BUG FIX: muting was forgotten on every reload (Pac-Man keeps it), and the
     menu and in-game sound buttons each carried their own copy of the toggle
     (only one of them kept its aria-label right). One toggle, saved. */
  function toggleMute() {
    isMuted = !isMuted;
    store.setItem(MUTE_KEY, isMuted ? "1" : "0");
    syncSoundIcons();
    applyMuteToAudio(); // cuts a sound that is still playing, or lets sound through again
    if (!isMuted) playClickSound();
  }
  if (soundBtnGame) soundBtnGame.addEventListener("click", toggleMute);
  /* ---------- Restart, gated behind one rewarded ad per attempt (Pac-Man) ----------
     Restart plays a "restart" video ad first; the level restarts only if the
     ad was actually shown. One per attempt: after it, the button stays
     disabled until the level is entered fresh (Level Select, Play, Prev /
     Next, moving on after a win) — startLevel() re-arms it, and this handler
     sets it back to used right after its own startLevel() call, exactly as
     Pac-Man does. The clock is held while the ad plays (Pac-Man freezes its
     board during ads) and handed back if the ad can't load.
     (restartAdUsedThisRun is declared above startLevel(), which re-arms it.) */
  resetButton.addEventListener("click", () => {
    if (restartAdUsedThisRun || resetButton.disabled) return;
    playClickSound();
    resetButton.disabled = true; // no double taps while the ad is up
    holdClock();
    const epoch = sessionEpoch;
    playVideoAd({
      placement: "restart",
      rewardText: "Watch the ad to restart this level.",
    }).then((res) => {
      if (epoch !== sessionEpoch) { clockHeld = false; resetButton.disabled = false; return; } // reset during the ad
      if (!res || !res.shown) {
        resetButton.disabled = false;
        releaseClock();
        showToast("The ad couldn't load \u2014 level not restarted. Please try again.");
        return;
      }
      clockHeld = false;
      startLevel(currentLevel);
      restartAdUsedThisRun = true;
      resetButton.disabled = true;
    });
  });
  continueAdBtn.addEventListener("click", () => {
    playClickSound();
    continueAfterAd();
  });
  modalCloseX.addEventListener("click", () => {
    playClickSound();
    goToLevelSelect(); // Pac-Man: the popup's X goes to Level Select
  });

  prevLevelNavBtn.addEventListener("click", () => goToLevelGated(currentLevel - 1));
  nextLevelNavBtn.addEventListener("click", () => goToLevelGated(currentLevel + 1));

  // Pac-Man: Exit goes straight to Level Select — no confirmation popup.
  exitBtn.addEventListener("click", () => {
    playClickSound();
    stopTimer();
    goToLevelSelect();
  });

  muteBtn.addEventListener("click", toggleMute);
  syncSoundIcons(); // show the saved setting from the start

  document.getElementById("howToPlayBtnStart").addEventListener("click", openHowToPlay);
  document.getElementById("howToPlayBtnLevel").addEventListener("click", openHowToPlay);
  howToPlayClose.addEventListener("click", closeHowToPlay);
  // "Got it" (Pac-Man How to Play standard) closes the panel the same way.
  var howToPlayGotIt = document.getElementById("howToPlayGotIt");
  if (howToPlayGotIt) howToPlayGotIt.addEventListener("click", closeHowToPlay);
  howToPlayOverlay.addEventListener("click", (e) => {
    if (e.target === howToPlayOverlay) closeHowToPlay();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !howToPlayOverlay.classList.contains("hidden")) closeHowToPlay();
  });

  // ---------- Sound Engine (generated tones, no external audio files needed) ----------
  /* BUG FIX (Android): sound was silent on many Android phones and browsers.
     The engine made its AudioContext lazily inside the first sound and
     called resume() without waiting for it, which breaks on Android in
     several ways:
       - Android Chrome / Samsung Internet / Firefox only let an AudioContext
         start from a real tap. A context first made outside one (the
         long-press flag timer, the win jingle 150ms after the tap, a tap that
         only counts as a gesture on pointerup) stayed "suspended" for good.
       - resume() is asynchronous on Android: tones scheduled while it was
         still starting were dropped.
       - After the phone is locked, the app is switched, a call comes in, a
         Bluetooth headset connects, or a video ad has played with sound, an
         Android context can be left suspended — or "running" with a dead
         output — and nothing re-armed it.
     Now: every tap anywhere on the page (captured before the game sees it)
     creates / resumes the context and plays a 1-sample silent buffer — the
     standard mobile unlock — until it is running; after the page has been
     hidden or a video ad has played, the next tap builds a fresh context;
     tones wait for a resume that is still in progress (and are dropped, not
     bunched up, if it takes too long); and every tone goes through one
     master volume, so the sound button silences what is already playing. */
  let audioCtx = null;
  let masterGain = null;
  let audioNeedsRebuild = false;
  function createAudioCtx() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      audioCtx = new AC({ latencyHint: "interactive" });
    } catch (e) {
      try { audioCtx = new AC(); } catch (e2) { audioCtx = null; return null; }
    }
    masterGain = audioCtx.createGain();
    masterGain.gain.value = isMuted ? 0 : 1;
    masterGain.connect(audioCtx.destination);
    const ac = audioCtx;
    ac.onstatechange = () => { if (ac === audioCtx && ac.state !== "running") armAudioUnlock(); };
    return audioCtx;
  }
  function resumeAudioCtx(ac) {
    try {
      const pr = ac.resume();
      if (pr && typeof pr.catch === "function") pr.catch(() => {});
      return pr;
    } catch (e) { return null; }
  }
  function getAudioCtx() {
    if (!audioCtx || audioCtx.state === "closed") createAudioCtx();
    if (audioCtx && audioCtx.state !== "running") resumeAudioCtx(audioCtx);
    return audioCtx;
  }

  const AUDIO_UNLOCK_EVENTS = ["pointerdown", "pointerup", "touchstart", "touchend", "mousedown", "click", "keydown"];
  let audioUnlockArmed = false;
  function unlockAudio() {
    if (audioNeedsRebuild) {
      audioNeedsRebuild = false;
      const old = audioCtx;
      audioCtx = null;
      masterGain = null;
      if (old) { try { old.close(); } catch (e) {} }
    }
    const ac = getAudioCtx();
    if (!ac) { disarmAudioUnlock(); return; } // no Web Audio at all
    try {
      // A silent one-sample buffer: what older Android WebViews and
      // Samsung Internet need to really open the audio output.
      const buf = ac.createBuffer(1, 1, 22050);
      const src = ac.createBufferSource();
      src.buffer = buf;
      src.connect(ac.destination);
      src.start(0);
    } catch (e) {}
    if (ac.state === "running") { disarmAudioUnlock(); return; }
    const pr = resumeAudioCtx(ac);
    if (pr && typeof pr.then === "function") {
      pr.then(() => { if (ac === audioCtx && ac.state === "running") disarmAudioUnlock(); }).catch(() => {});
    }
  }
  function armAudioUnlock() {
    if (audioUnlockArmed) return;
    audioUnlockArmed = true;
    AUDIO_UNLOCK_EVENTS.forEach((t) => document.addEventListener(t, unlockAudio, { capture: true, passive: true }));
  }
  function disarmAudioUnlock() {
    if (!audioUnlockArmed) return;
    audioUnlockArmed = false;
    AUDIO_UNLOCK_EVENTS.forEach((t) => document.removeEventListener(t, unlockAudio, { capture: true }));
  }
  /* Leaving the page (lock screen, app switch, incoming call) or a video ad
     with sound can leave Android's audio output dead: the next tap starts a
     fresh context. */
  function rebuildAudioOnNextTap() {
    if (!audioCtx) return;
    audioNeedsRebuild = true;
    armAudioUnlock();
  }
  armAudioUnlock();
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (audioCtx && audioCtx.state === "running") { try { audioCtx.suspend(); } catch (e) {} }
      rebuildAudioOnNextTap();
    }
  });
  window.addEventListener("pagehide", rebuildAudioOnNextTap);
  window.addEventListener("pageshow", (e) => { if (e.persisted) rebuildAudioOnNextTap(); });

  // Sound button: one master volume, so muting also cuts a sound in progress.
  function applyMuteToAudio() {
    if (!masterGain || !audioCtx) return;
    try { masterGain.gain.cancelScheduledValues(0); } catch (e) {}
    masterGain.gain.value = isMuted ? 0 : 1;
  }

  /* BUG FIX: sound effects run in the middle of game actions (a reveal sound
     plays BEFORE the win check). Where Web Audio is missing or refuses to
     start (some in-app webviews), the error used to abort the action — a
     winning reveal could then never trigger the win. Sound is now strictly
     best-effort. */
  function playTone(freq, duration, type, startTime, volume) {
    try {
      playToneUnsafe(freq, duration, type, startTime, volume);
    } catch (e) {}
  }
  const TONE_MAX_WAIT_MS = 350; // a tone still waiting for audio after this is dropped
  function playToneUnsafe(freq, duration, type, startTime, volume) {
    if (isMuted) return;
    const ac = getAudioCtx();
    if (!ac) return;
    if (ac.state === "running") {
      scheduleTone(ac, freq, duration, type, startTime, volume);
      return;
    }
    // Android starts audio asynchronously: play once it is running.
    const askedAt = Date.now();
    const pr = resumeAudioCtx(ac);
    if (pr && typeof pr.then === "function") {
      pr.then(() => {
        if (isMuted || ac !== audioCtx || ac.state !== "running") return;
        if (Date.now() - askedAt > TONE_MAX_WAIT_MS) return;
        try { scheduleTone(ac, freq, duration, type, startTime, volume); } catch (e) {}
      }).catch(() => {});
    }
  }
  function scheduleTone(ac, freq, duration, type, startTime, volume) {
    type = type || "sine";
    startTime = startTime || 0;
    volume = volume === undefined ? 0.2 : volume;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    // A few ms ahead: on Android a tone set to start "now" can already be in
    // the past by the time the audio thread reads it, and is cut short.
    const now = ac.currentTime + 0.01 + startTime;
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(gain);
    gain.connect(masterGain || ac.destination);
    osc.onended = () => { try { osc.disconnect(); gain.disconnect(); } catch (e) {} };
    osc.start(now);
    osc.stop(now + duration);
  }

  function playRevealSound() {
    playTone(500 + Math.random() * 200, 0.08, "triangle", 0, 0.12);
  }

  function playFlagSound() {
    playTone(660, 0.07, "triangle", 0, 0.13);
    playTone(880, 0.06, "triangle", 0.05, 0.1);
  }

  function playSuspectSound() {
    playTone(300, 0.08, "triangle", 0, 0.1);
  }

  function playUnflagSound() {
    playTone(240, 0.07, "triangle", 0, 0.08);
  }

  function playClickSound() {
    playTone(500, 0.06, "triangle", 0, 0.1);
  }

  function playExplosionSound() {
    playTone(80, 0.35, "sawtooth", 0, 0.22);
    playTone(60, 0.4, "square", 0.02, 0.16);
    playTone(45, 0.5, "sine", 0.05, 0.14);
  }

  function playWinSound() {
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.51]; // C5 E5 G5 C6 E6
    notes.forEach((f, i) => playTone(f, 0.28, "triangle", i * 0.12, 0.2));
    playTone(1567.98, 0.4, "sine", 0.55, 0.12); // sparkle
  }

  function playLoseSound() {
    const notes = [392, 329.63, 261.63, 196];
    notes.forEach((f, i) => playTone(f, 0.3, "sawtooth", i * 0.15, 0.15));
  }

  // ---------- Boot ----------
  migrateProgress();
  refreshCoinDisplays();
  checkSession();
  setInterval(checkSession, 30000);
  window.addEventListener("focus", checkSession);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) checkSession();
  });

  /* BUG FIX: start-up used to wait for image.onload of a legacy sprite sheet
     (minesweeper_graphs.png) that nothing draws from any more — the board is
     drawn with vector shapes (MSDraw). If that one PNG failed to load, the
     board canvas was never created and Play threw an error. Start directly. */
  initCanvasOnce();
  buildLevelGrid();
})();
