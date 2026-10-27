/* =======================================================================
   HANGMAN — built on the Pac-Man shell
   -----------------------------------------------------------------------
   Everything shared between the games (screens, coins, 24-hour session,
   level unlocks, the 5-ads unlock, video / banner / leaderboard / side
   ads, popups, the game bar, the responsive board-and-ads layout) is
   Pac-Man's code, kept as close to the original as the game allows.
   What is Hangman's own: the word packs, the 40 levels and their words,
   the wrong-guess allowance per level, the figure, the keyboard, the
   coin rewards, the "+2 guesses" continue and the shop's items.
   ======================================================================= */

/* The board: a plain element sized by resizeBoard() to fill its column,
   exactly the box Pac-Man fits its maze canvas into. */
const boardEl = document.getElementById("gameBoard");

/* localStorage can throw (Safari private mode, sandboxed iframes, storage
   disabled, quota). Every read/write goes through here instead and a
   failure just means "nothing saved". */
const store = {
  get(key) { try { return localStorage.getItem(key); } catch (e) { return null; } },
  set(key, val) { try { localStorage.setItem(key, val); } catch (e) {} },
  remove(key) { try { localStorage.removeItem(key); } catch (e) {} },
};

/* Ad carousel timers — declared first because showScreen()'s very first,
   synchronous call reaches the code that reads them. */
let leaderboardCarouselTimer = null;
let railCarouselTimer = null;
let modalBannerCarouselTimer = null;

const levelTitleEl = document.getElementById("levelTitle");
const packIconEl = document.getElementById("packIcon");
const packNameEl = document.getElementById("packName");
const guessesLeftEl = document.getElementById("guessesLeft");
const restartBtn = document.getElementById("restartBtn");
const prevLevelBtn = document.getElementById("prevLevelBtn");
const nextLevelBtn = document.getElementById("nextLevelBtn");
const exitBtn = document.getElementById("exitBtn");
const muteBtns = document.querySelectorAll(".mute-btn");

// screens
const screens = {
  menu: document.getElementById("menuScreen"),
  howto: document.getElementById("howToPlayScreen"),
  categories: document.getElementById("categoryScreen"),
  levelSelect: document.getElementById("levelSelectScreen"),
  shop: document.getElementById("shopScreen"),
  game: document.getElementById("gameScreen"),
};

const playBtn = document.getElementById("playBtn");
const levelSelectBtn = document.getElementById("levelSelectBtn");
const howToPlayBtn = document.getElementById("howToPlayBtn");
const levelGrid = document.getElementById("levelGrid");
const categoryGrid = document.getElementById("categoryGrid");
const shopBtn = document.getElementById("shopBtn");
const shopTabsEl = document.getElementById("shopTabs");
const shopGrid = document.getElementById("shopGrid");
const coinCountMenu = document.getElementById("coinCountMenu");
const coinCountShop = document.getElementById("coinCountShop");
const coinCountGame = document.getElementById("coinCountGame");

const figureSvg = document.getElementById("figure-container");
const figureParts = document.querySelectorAll("#figure-container .figure-part");
const wordEl = document.getElementById("word");
const wrongLettersEl = document.getElementById("wrongLetters");
const keyboardEl = document.getElementById("keyboard");

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
const COINS_KEY = "hangman_coins";
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
const TOTAL_LEVELS = 40;

// ---------- Unlocked levels ----------
// A SET of level numbers the player can currently start, not a single
// "unlocked up to here" pointer. That distinction matters once ads can
// unlock one specific level out of order (see UNLOCK_ADS_REQUIRED below):
// unlocking level 6 must NOT imply 2-5 are also playable, which a scalar
// frontier can't express but a set can. Level 1 is always available and is
// never actually stored.
const UNLOCKED_KEY = "hangman_unlockedLevels";

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
const COMPLETED_KEY = "hangman_completedLevels";

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
// input on it (see handleGuess()) — never when a level is merely
// unlocked, whether by winning the one before it or by watching ads.
// Cleared with the rest of the session progress on a 24-hour reset.
const LAST_PLAYED_KEY = "hangman_lastPlayedLevel";

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
const SESSION_START_KEY = "hangman_sessionStart";
const SESSION_LENGTH_MS = 24 * 60 * 60 * 1000;
const SESSION_KEYS = [UNLOCKED_KEY, COMPLETED_KEY, LAST_PLAYED_KEY, COINS_KEY, "hangman_equipped", "hangman_unlocked_items",
  "hangman_unlockedPacks", "hangman_selectedPack", "hangman_gateOwed"];

// Separate from SESSION_KEYS on purpose: this flag must survive the wipe
// it gets set by, because it's what tells buildLevelGrid() a 24-hour reset
// has happened at least once. Only then does tapping a locked level offer
// the 5-ads unlock — before the first reset, locked levels behave exactly
// as they always did (a plain padlock, no ads, reached only by winning
// your way there). Once true it stays true; there's no scenario where it
// should go back to false.
const RESET_HAPPENED_KEY = "hangman_resetHappened";

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
      playable = false;
      hideOverlay();
      showScreen("menu");
    }
    if (screens.levelSelect.classList.contains("active")) buildLevelGrid();
    if (screens.categories.classList.contains("active")) buildCategoryGrid();
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


// ===================== WORDS: 40 LEVELS x 5 PACKS =====================
/* Every pack shares the same 40 levels and the same difficulty; picking a
   pack only changes which words appear. Each level is a pool of two words,
   so replaying a level does not always show the same one.
   Difficulty climbs two ways at once:
   - the words: in Hangman a SHORT word with RARE letters is the hard one
     (few blanks to go on, few vowels, letters like J Q X Z K Y W V), so
     levels move from familiar 6-8 letter words (1-10) to words with rarer
     letters (11-20), to short words full of them (21-30), to the shortest,
     rarest words of all (31-40: lynx, oryx, kyiv, lux, fez ...);
   Every level allows the same 6 wrong guesses; the words alone make the
   later levels harder. */
const TIER_MAX_WRONG = [6, 6, 6, 6, 6, 6, 6, 6]; // every level: 6 wrong guesses
function getMaxWrongForLevel(level) {
  const tier = Math.min(Math.floor((level - 1) / 5), TIER_MAX_WRONG.length - 1);
  return TIER_MAX_WRONG[tier];
}

const CATEGORIES = [
  {
    id: "animals", name: "Animals", icon: "\u{1F43E}", cost: 0, unlockMode: "free", color: "#2f9e5c",
    words: [
      ["rabbit", "turtle"], ["monkey", "donkey"], ["parrot", "badger"], ["beaver", "falcon"], ["pigeon", "hamster"],
      ["lobster", "penguin"], ["leopard", "panther"], ["gorilla", "cheetah"], ["octopus", "pelican"], ["dolphin", "vulture"],
      ["giraffe", "walrus"], ["iguana", "coyote"], ["jaguar", "toucan"], ["alpaca", "ferret"], ["weasel", "hyena"],
      ["python", "viper"], ["skunk", "hippo"], ["bison", "moose"], ["koala", "zebra"], ["gecko", "llama"],
      ["jackal", "kestrel"], ["wombat", "marmot"], ["quokka", "dingo"], ["okapi", "ocelot"], ["narwhal", "axolotl"],
      ["sphynx", "gazelle"], ["bobcat", "caribou"], ["jerboa", "kinkajou"], ["mink", "sloth"], ["tapir", "puma"],
      ["lynx", "oryx"], ["ibex", "gnu"], ["yak", "emu"], ["jay", "wren"], ["newt", "wasp"],
      ["quail", "squid"], ["zebu", "kudu"], ["puffin", "muskox"], ["jackdaw", "waxwing"], ["quetzal", "oxpecker"],
    ],
  },
  {
    id: "food", name: "Food", icon: "\u{1F354}", cost: 80, unlockMode: "coins", color: "#e2972e",
    words: [
      ["cheese", "butter"], ["muffin", "cookie"], ["waffle", "pretzel"], ["noodles", "pancake"], ["lettuce", "spinach"],
      ["avocado", "peanut"], ["biscuit", "custard"], ["sausage", "burger"], ["omelette", "porridge"], ["lasagna", "risotto"],
      ["broccoli", "zucchini"], ["yogurt", "ketchup"], ["mustard", "vinegar"], ["walnut", "cashew"], ["papaya", "guava"],
      ["kebab", "gravy"], ["salsa", "jelly"], ["bagel", "scone"], ["taco", "nacho"], ["curry", "chili"],
      ["quiche", "falafel"], ["couscous", "gnocchi"], ["tofu", "kimchi"], ["paprika", "nutmeg"], ["wasabi", "tahini"],
      ["fudge", "jerky"], ["squash", "kiwi"], ["quinoa", "okra"], ["yam", "fig"], ["kale", "leek"],
      ["jam", "yolk"], ["kumquat", "quince"], ["jujube", "jicama"], ["kefir", "pizza"], ["gyro", "wrap"],
      ["zest", "whey"], ["vodka", "quark"], ["lox", "ziti"], ["kohlrabi", "jalapeno"], ["schnitzel", "jambalaya"],
    ],
  },
  {
    id: "objects", name: "Objects", icon: "\u{1F4E6}", cost: 0, unlockMode: "ad", color: "#8b5cf6",
    words: [
      ["pencil", "wallet"], ["basket", "candle"], ["mirror", "bottle"], ["hammer", "needle"], ["blanket", "ladder"],
      ["kettle", "pillow"], ["bucket", "helmet"], ["trumpet", "compass"], ["scissors", "anchor"], ["lantern", "magnet"],
      ["envelope", "cushion"], ["zipper", "buckle"], ["whistle", "wrench"], ["vase", "broom"], ["kayak", "yoyo"],
      ["jigsaw", "puzzle"], ["thimble", "shovel"], ["quilt", "sofa"], ["jacket", "gloves"], ["faucet", "towel"],
      ["jukebox", "sextant"], ["abacus", "easel"], ["kazoo", "banjo"], ["sickle", "pliers"], ["wok", "jug"],
      ["vise", "awl"], ["axe", "saw"], ["key", "box"], ["quiver", "yoke"], ["zither", "oboe"],
      ["fez", "wig"], ["jar", "urn"], ["kiln", "vat"], ["lyre", "fife"], ["quill", "tuxedo"],
      ["jackknife", "xylophone"], ["javelin", "buzzer"], ["skewer", "gizmo"], ["jigger", "whisk"], ["squeegee", "gyroscope"],
    ],
  },
  {
    id: "places", name: "Places", icon: "\u{1F5FA}\uFE0F", cost: 200, unlockMode: "coins", color: "#1fa7ae",
    words: [
      ["castle", "desert"], ["forest", "valley"], ["harbor", "bridge"], ["canyon", "island"], ["museum", "temple"],
      ["village", "garden"], ["airport", "palace"], ["library", "market"], ["station", "cottage"], ["theater", "prison"],
      ["glacier", "volcano"], ["jungle", "meadow"], ["swamp", "marsh"], ["plaza", "mosque"], ["fjord", "bazaar"],
      ["kiosk", "motel"], ["quay", "pier"], ["oasis", "lagoon"], ["zoo", "gym"], ["tundra", "savanna"],
      ["jetty", "wharf"], ["abbey", "crypt"], ["grotto", "knoll"], ["bayou", "delta"], ["vineyard", "ravine"],
      ["gazebo", "pagoda"], ["pueblo", "igloo"], ["citadel", "kibbutz"], ["souk", "wadi"], ["dyke", "dune"],
      ["fiji", "oslo"], ["peru", "cuba"], ["qatar", "quito"], ["kyiv", "iraq"], ["laos", "mali"],
      ["chad", "oman"], ["yemen", "kuwait"], ["zagreb", "jakarta"], ["zambia", "gabon"], ["djibouti", "kyrgyzstan"],
    ],
  },
  {
    id: "science", name: "Science", icon: "\u{1F52C}", cost: 0, unlockMode: "ad", color: "#e2555f",
    words: [
      ["planet", "energy"], ["magnet", "liquid"], ["oxygen", "fossil"], ["gravity", "mineral"], ["molecule", "protein"],
      ["battery", "circuit"], ["crystal", "current"], ["nucleus", "neutron"], ["comet", "meteor"], ["vaccine", "enzyme"],
      ["quartz", "hydrogen"], ["plasma", "vacuum"], ["helium", "carbon"], ["zinc", "iron"], ["lunar", "sulfur"],
      ["photon", "quark"], ["genome", "axon"], ["virus", "fungi"], ["xylem", "phloem"], ["joule", "watt"],
      ["kelvin", "ohm"], ["lens", "prism"], ["algae", "yeast"], ["lymph", "bile"], ["pixel", "byte"],
      ["kinetic", "vortex"], ["boson", "muon"], ["cobalt", "radium"], ["zygote", "embryo"], ["quasar", "pulsar"],
      ["ion", "gene"], ["flux", "volt"], ["lux", "erg"], ["hertz", "azimuth"], ["oxide", "alkali"],
      ["krypton", "xenon"], ["zenith", "phylum"], ["jurassic", "quantum"], ["gneiss", "schist"], ["zymurgy", "pyroxene"],
    ],
  },
];

const WORD_COIN_REWARD = 25;
const NO_WRONG_BONUS = 20;

// ===================== WORD PACKS: UNLOCKED / SELECTED =====================
const PACKS_KEY = "hangman_unlockedPacks";
const SELECTED_PACK_KEY = "hangman_selectedPack";

function getUnlockedPacks() {
  try {
    const stored = JSON.parse(store.get(PACKS_KEY));
    if (Array.isArray(stored)) return stored;
  } catch (e) {}
  return [];
}
function isPackUnlocked(id) {
  const pack = CATEGORIES.find((c) => c.id === id);
  if (!pack) return false;
  return pack.unlockMode === "free" || getUnlockedPacks().includes(id);
}
function unlockPack(id) {
  const list = getUnlockedPacks();
  if (!list.includes(id)) {
    list.push(id);
    store.set(PACKS_KEY, JSON.stringify(list));
  }
}
function getSelectedCategory() {
  const id = store.get(SELECTED_PACK_KEY);
  const pack = CATEGORIES.find((c) => c.id === id);
  return pack && isPackUnlocked(pack.id) ? pack : CATEGORIES[0];
}
function setSelectedCategory(id) {
  store.set(SELECTED_PACK_KEY, id);
}

/* One rewarded ad unlocks an ad pack — asked first with the same
   confirmation dialog the 5-ads level unlock uses, and only unlocked if the
   ad actually played. */
let packAdInFlight = false;
function unlockPackWithAd(pack, after) {
  if (packAdInFlight) return;
  confirmTitleEl.textContent = "\u{1F4FA} Unlock " + pack.name;
  confirmMessageEl.textContent = "Watch 1 ad to unlock the " + pack.name + " word pack.";
  if (confirmSubMessageEl) {
    confirmSubMessageEl.textContent = "It stays unlocked until the 24-hour reset.";
    confirmSubMessageEl.classList.remove("hidden");
  }
  const freshOk = confirmOkBtn.cloneNode(true);
  confirmOkBtn.replaceWith(freshOk);
  confirmOkBtn = freshOk;
  const freshCancel = confirmCancelBtn.cloneNode(true);
  confirmCancelBtn.replaceWith(freshCancel);
  confirmCancelBtn = freshCancel;
  const close = () => confirmOverlayEl.classList.add("hidden");
  confirmCancelBtn.addEventListener("click", close);
  confirmOkBtn.addEventListener("click", () => {
    // A second tap on OK (before the dialog closes) must not start a second ad.
    if (packAdInFlight) return;
    close();
    packAdInFlight = true;
    playVideoAd({
      placement: "recover",
      rewardText: "Watch the ad to unlock the " + pack.name + " word pack.",
    }).then((res) => {
      packAdInFlight = false;
      if (!res || !res.shown) {
        showToast("The ad couldn't load \u2014 " + pack.name + " was not unlocked. Please try again.");
        return;
      }
      unlockPack(pack.id);
      showToast(pack.icon + " " + pack.name + " unlocked!");
      if (after) after();
    });
  });
  confirmOverlayEl.classList.remove("hidden");
}

function buyPack(pack, after) {
  if (spendCoins(pack.cost)) {
    unlockPack(pack.id);
    playPurchaseSound();
    showToast(pack.icon + " " + pack.name + " unlocked!");
    if (after) after();
  }
}

/* The pack card: the shop's item card (swatch, name, one button), so the
   Category screen and the shop's Word Packs tab read as the same object. */
function buildPackCard(pack, { onPlay, rebuild, selectedId }) {
  const unlocked = isPackUnlocked(pack.id);
  const cell = document.createElement("div");
  cell.className = "shop-item pack-item" + (unlocked && pack.id === selectedId ? " equipped-item" : "") +
    (unlocked ? "" : " is-locked");

  const swatch = document.createElement("div");
  swatch.className = "shop-item-swatch pack-swatch";
  swatch.textContent = unlocked ? pack.icon : "\u{1F512}";

  const name = document.createElement("div");
  name.className = "shop-item-name";
  name.textContent = pack.name;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "shop-item-btn";

  if (unlocked) {
    if (onPlay) {
      btn.textContent = "\u25B6 Play";
      btn.classList.add("equip");
      btn.addEventListener("click", (e) => { e.stopPropagation(); onPlay(pack); });
      cell.classList.add("is-clickable");
      cell.addEventListener("click", () => onPlay(pack));
    } else {
      btn.textContent = "Unlocked";
      btn.classList.add("equipped");
      btn.disabled = true;
    }
  } else if (pack.unlockMode === "ad") {
    btn.textContent = "\u25B6 Watch Ad";
    btn.classList.add("buy");
    btn.addEventListener("click", (e) => { e.stopPropagation(); unlockPackWithAd(pack, rebuild); });
  } else {
    btn.textContent = "Buy \u00b7 " + pack.cost + " \u{1FA99}";
    btn.classList.add("buy");
    btn.disabled = getCoins() < pack.cost;
    btn.addEventListener("click", (e) => { e.stopPropagation(); buyPack(pack, rebuild); });
  }

  cell.appendChild(swatch);
  cell.appendChild(name);
  cell.appendChild(btn);
  return cell;
}

// ===================== CATEGORY SCREEN =====================
function buildCategoryGrid() {
  const line = document.getElementById("categoryProgressLine");
  const unlockedCount = CATEGORIES.filter((c) => isPackUnlocked(c.id)).length;
  if (line) line.textContent = unlockedCount + " of " + CATEGORIES.length + " word packs unlocked";
  const selectedId = getSelectedCategory().id;
  categoryGrid.innerHTML = "";
  CATEGORIES.forEach((pack) => {
    categoryGrid.appendChild(buildPackCard(pack, {
      selectedId,
      rebuild: buildCategoryGrid,
      onPlay: (p) => {
        setSelectedCategory(p.id);
        goToLevelSelect();
      },
    }));
  });
}

function goToCategories() {
  hideOverlay();
  updateCoinDisplays();
  buildCategoryGrid();
  showScreen("categories");
}

// ===================== SHOP / UNLOCKABLES =====================
const SHOP_ITEMS = {
  figure: [
    { id: "classic", name: "Classic", cost: 0, color: "#08293d" },
    { id: "blue", name: "Cool Blue", cost: 100, color: "#2f6fed" },
    { id: "neon", name: "Neon Green", cost: 150, color: "#22c55e" },
    { id: "gold", name: "Golden", cost: 200, color: "#d4a017" },
    { id: "shadow", name: "Shadow Purple", cost: 250, color: "#8b5cf6" },
  ],
  background: [
    { id: "classic", name: "Classic", cost: 0, bg: "", dark: false },
    { id: "meadow", name: "Sunny Meadow", cost: 100, bg: "linear-gradient(160deg, #e3f7d9 0%, #b9e4a4 100%)", dark: false },
    { id: "night", name: "Night Sky", cost: 150, bg: "linear-gradient(160deg, #232a52 0%, #0d1128 100%)", dark: true },
    { id: "desert", name: "Desert Dune", cost: 150, bg: "linear-gradient(160deg, #fbe8c6 0%, #edc078 100%)", dark: false },
    { id: "space", name: "Deep Space", cost: 250, bg: "linear-gradient(160deg, #35225c 0%, #100a24 100%)", dark: true },
  ],
};

function getEquippedMap() {
  try {
    return JSON.parse(store.get("hangman_equipped")) || {};
  } catch (e) {
    return {};
  }
}
function setEquippedId(cat, id) {
  const eq = getEquippedMap();
  eq[cat] = id;
  store.set("hangman_equipped", JSON.stringify(eq));
}
function getEquippedId(cat) {
  const eq = getEquippedMap();
  return eq[cat] || SHOP_ITEMS[cat][0].id;
}
function getUnlockedItemsMap() {
  try {
    return JSON.parse(store.get("hangman_unlocked_items")) || {};
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
  store.set("hangman_unlocked_items", JSON.stringify(u));
}

function applyEquippedCosmetics() {
  const fig = SHOP_ITEMS.figure.find((x) => x.id === getEquippedId("figure")) || SHOP_ITEMS.figure[0];
  const bg = SHOP_ITEMS.background.find((x) => x.id === getEquippedId("background")) || SHOP_ITEMS.background[0];
  if (boardEl) {
    // The Classic figure is the logo's dark navy; on a dark background it
    // would vanish, so there it is drawn in a light tint instead.
    const figColor = bg.dark && fig.id === "classic" ? "#e6f7fa" : fig.color;
    boardEl.style.setProperty("--figure-color", figColor);
    boardEl.style.background = bg.bg || "";
    boardEl.classList.toggle("on-dark-bg", !!bg.dark);
  }
}

let activeShopTab = "figure";
function swatchStyleFor(cat, item) {
  if (cat === "figure") return "background:" + item.color + ";";
  if (cat === "background") return "background:" + (item.bg || "linear-gradient(160deg,#ffffff,#eef6f8)") + ";border:1px solid rgba(28,43,66,0.14);";
  return "background:#e9ecef;";
}
function renderShop(cat) {
  activeShopTab = cat;
  [...shopTabsEl.querySelectorAll(".shop-tab")].forEach((t) => t.classList.toggle("active", t.dataset.cat === cat));
  shopGrid.innerHTML = "";
  if (cat === "packs") {
    CATEGORIES.forEach((pack) => {
      shopGrid.appendChild(buildPackCard(pack, { rebuild: () => renderShop("packs"), selectedId: null }));
    });
    return;
  }
  const equippedId = getEquippedId(cat);
  SHOP_ITEMS[cat].forEach((item) => {
    const unlocked = item.cost === 0 || isItemUnlocked(cat, item.id);
    const cell = document.createElement("div");
    cell.className = "shop-item" + (equippedId === item.id ? " equipped-item" : "");

    const swatch = document.createElement("div");
    swatch.className = "shop-item-swatch";
    swatch.setAttribute("style", swatchStyleFor(cat, item));

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
      btn.textContent = "Buy \u00b7 " + item.cost + " \u{1FA99}";
      btn.classList.add("buy");
      btn.disabled = getCoins() < item.cost;
      btn.addEventListener("click", () => {
        if (spendCoins(item.cost)) {
          unlockItem(cat, item.id);
          setEquippedId(cat, item.id);
          applyEquippedCosmetics();
          playPurchaseSound();
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
/* Hangman's own tones, synthesised with the Web Audio API (no files).
   Muting is Pac-Man's: one setting, every .mute-btn shows it. */
let audioCtx = null;
const MUTE_STORAGE_KEY = "hangman_soundMuted";
let soundMuted = store.get(MUTE_STORAGE_KEY) === "1";

function getAudioContext() {
  if (soundMuted) return null;
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx();
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

function playTone(freq, duration, type = "sine", startGain = 0.18, delay = 0) {
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    const startAt = ctx.currentTime + delay;
    gain.gain.setValueAtTime(startGain, startAt);
    gain.gain.exponentialRampToValueAtTime(0.001, startAt + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(startAt);
    osc.stop(startAt + duration);
  } catch (err) {
    /* audio unsupported or blocked — fail silently */
  }
}
function playCorrectSound() { playTone(720, 0.1, "triangle", 0.16); }
function playWrongSound() { playTone(160, 0.3, "sawtooth", 0.16); }
function playWinSound() {
  playTone(660, 0.14, "sine", 0.16, 0);
  playTone(880, 0.14, "sine", 0.16, 0.12);
  playTone(1100, 0.22, "sine", 0.16, 0.24);
}
function playGameOverSound() {
  playTone(300, 0.18, "sawtooth", 0.16, 0);
  playTone(220, 0.18, "sawtooth", 0.16, 0.14);
  playTone(140, 0.3, "sawtooth", 0.16, 0.28);
}
function playCoinSound() {
  playTone(1046.5, 0.09, "triangle", 0.14, 0);
  playTone(1318.5, 0.14, "triangle", 0.14, 0.08);
}
function playPurchaseSound() {
  playTone(523.25, 0.1, "square", 0.12, 0);
  playTone(783.99, 0.16, "square", 0.12, 0.1);
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
      if (!soundMuted) playCorrectSound();
    });
  });
}

// ===================== GAME STATE =====================
let selectedWord = "";
let correctLetters = [];
let wrongLetters = [];
let playable = false;   // the board takes guesses
let gameOver = true;    // the attempt has ended (won or out of guesses)
// "+2 guesses" continue: one use per attempt; a fresh start resets both.
let bonusWrongAllowance = 0;  // extra wrong guesses those ads added
let figureBase = 0;           // wrong guesses already "paid off" by a refill

/* ---------- Pause ----------
   Same button and rules as Pac-Man: it freezes the board (no guesses are
   taken, the keyboard greys out) and the button turns into Resume. */
let gamePaused = false;
const pauseBtn = document.getElementById("pauseBtn");

function setPaused(next, silent) {
  if (next && !gamePaused && (gameOver || adIsPlaying)) return;
  gamePaused = next;
  if (pauseBtn) {
    pauseBtn.innerHTML = gamePaused
      ? '<span class="ico">\u25B6</span><span class="lbl">Resume</span>'
      : '<span class="ico">\u23F8</span><span class="lbl">Pause</span>';
    pauseBtn.setAttribute("aria-pressed", String(gamePaused));
    pauseBtn.classList.toggle("is-paused", gamePaused);
  }
  if (boardEl) boardEl.classList.toggle("is-paused", gamePaused);
  refreshKeyboardState();
}
if (pauseBtn) pauseBtn.addEventListener("click", () => setPaused(!gamePaused));

/* Nothing on the board reacts while it is paused, while an ad or the
   unlock dialog is in front of it, or while a result popup is up. */
function isBoardFrozen() {
  return gamePaused || adIsPlaying ||
    (!!confirmOverlayEl && !confirmOverlayEl.classList.contains("hidden")) ||
    (!!overlay && !overlay.classList.contains("hidden"));
}

function getEffectiveMaxWrong() {
  return getMaxWrongForLevel(currentLevel) + bonusWrongAllowance;
}

function updateUI() {
  const pack = getSelectedCategory();
  levelTitleEl.innerHTML =
    '<span class="lvl-word">Level</span><span class="lvl-num">' + currentLevel + "</span>";
  if (packIconEl) packIconEl.textContent = pack.icon;
  if (packNameEl) packNameEl.textContent = pack.name;
  if (guessesLeftEl) guessesLeftEl.textContent = Math.max(0, getEffectiveMaxWrong() - wrongLetters.length);
  prevLevelBtn.disabled = currentLevel <= 1;
  nextLevelBtn.disabled = !isLevelUnlocked(currentLevel + 1);
}

function startLevel(level) {
  currentLevel = Math.min(Math.max(level, 1), TOTAL_LEVELS);
  const pack = getSelectedCategory();
  const pool = pack.words[currentLevel - 1];
  selectedWord = pool[Math.floor(Math.random() * pool.length)];
  correctLetters = [];
  wrongLetters = [];
  playable = true;
  gameOver = false;
  bonusWrongAllowance = 0;
  figureBase = 0;
  restartAdUsedThisRun = false;
  restartBtn.disabled = false;
  applyEquippedCosmetics();
  buildKeyboard();
  hideOverlay();
  showScreen("game");
  renderWord();
  renderWrongLetters();
  updateUI();
  resizeBoard();
  /* Same double-rAF settle as Pac-Man: the side ads narrow the column a
     frame or two after the screen appears, so the board is fitted again
     once that has landed. */
  requestAnimationFrame(() => requestAnimationFrame(() => resizeBoard()));
}

/* ---------- The every-3rd-level ad, owed until it is watched ----------
   Clearing level 3, 6, 9 ... means the next level is entered behind a
   short ad. The debt is SAVED, so it is paid whichever way the player goes
   in — the popup's Next Level, the bar's Next, the Level Select tile or the
   5-ads unlock — not only from the popup. Like Pac-Man, the game moves on
   even if that ad cannot load: the level was already earned. */
const GATE_OWED_KEY = "hangman_gateOwed";
function getGateOwedLevel() {
  const n = Number(store.get(GATE_OWED_KEY));
  return Number.isInteger(n) && n >= 1 && n <= TOTAL_LEVELS ? n : 0;
}
let gateAdInFlight = false;
function enterLevel(level, { closeOverlay } = {}) {
  if (gateAdInFlight) return;
  if (getGateOwedLevel() !== level) {
    if (closeOverlay) hideOverlay();
    startLevel(level);
    return;
  }
  gateAdInFlight = true;
  if (modalPrimaryBtn) modalPrimaryBtn.disabled = true;
  playVideoAd({
    placement: "level_gate",
    rewardText: "Level " + (level - 1) + " cleared \u2014 your reward is next!",
  }).then(() => {
    gateAdInFlight = false;
    if (modalPrimaryBtn) modalPrimaryBtn.disabled = false;
    store.remove(GATE_OWED_KEY);
    startLevel(level);
  });
}

// ===================== BOARD =====================
function buildKeyboard() {
  keyboardEl.innerHTML = "";
  for (let i = 97; i <= 122; i++) {
    const letter = String.fromCharCode(i);
    const key = document.createElement("button");
    key.className = "key";
    key.type = "button";
    key.textContent = letter;
    key.dataset.letter = letter;
    key.addEventListener("click", () => handleGuess(letter));
    keyboardEl.appendChild(key);
  }
}

function refreshKeyboardState() {
  if (!keyboardEl) return;
  keyboardEl.querySelectorAll(".key").forEach((key) => {
    const letter = key.dataset.letter;
    const used = correctLetters.includes(letter) || wrongLetters.includes(letter);
    key.classList.toggle("correct", correctLetters.includes(letter));
    key.classList.toggle("wrong", wrongLetters.includes(letter));
    key.disabled = used || !playable || gamePaused;
  });
}

function renderWord() {
  wordEl.innerHTML = selectedWord
    .split("")
    .map((letter) => `<span class="letter">${correctLetters.includes(letter) ? letter : ""}</span>`)
    .join("");
  layoutBoardContent();
}

function renderWrongLetters() {
  wrongLettersEl.innerHTML =
    '<span class="hm-wrong-label">Wrong</span>' +
    (wrongLetters.length
      ? wrongLetters.map((l) => `<span class="hm-wrong-letter">${l}</span>`).join("")
      : '<span class="hm-wrong-none">\u2014</span>');
  figureParts.forEach((part, index) => {
    // After a full refill the figure is drawn afresh from the next miss.
    part.style.display = index < wrongLetters.length - figureBase ? "block" : "none";
  });
  if (guessesLeftEl) guessesLeftEl.textContent = Math.max(0, getEffectiveMaxWrong() - wrongLetters.length);
  refreshKeyboardState();
}

function handleGuess(letter) {
  if (!playable || gameOver || isBoardFrozen()) return;
  if (letter < "a" || letter > "z" || letter.length !== 1) return;
  setLastPlayedLevel(currentLevel);

  if (correctLetters.includes(letter) || wrongLetters.includes(letter)) {
    showToast("You have already entered this letter");
    return;
  }
  if (selectedWord.includes(letter)) {
    correctLetters.push(letter);
    playCorrectSound();
    renderWord();
    refreshKeyboardState();
    if (selectedWord.split("").every((l) => correctLetters.includes(l))) {
      playable = false;
      refreshKeyboardState();
      handleLevelWin();
    }
  } else {
    wrongLetters.push(letter);
    playWrongSound();
    renderWrongLetters();
    if (wrongLetters.length >= getEffectiveMaxWrong()) {
      playable = false;
      refreshKeyboardState();
      handleGameOver();
    }
  }
}

/* ---------- Fitting the board's contents to the board ----------
   resizeBoard() gives the board the exact box Pac-Man gives its maze; this
   lays the figure, word and keyboard out inside it (see the three shapes
   below). Sizes come from the box itself, so nothing inside ever scrolls
   or spills whatever the screen. */
const KEY_MAX = 84;   // largest key on big screens
const KEY_MIN = 22;

/* The keyboard for one candidate layout: the biggest key that fits the
   space that layout leaves for it. */
function fitKeys(colW, kbH, cols, rows, gap, ratio) {
  const keyW = Math.min(KEY_MAX, (colW - (cols - 1) * gap) / cols);
  const keyH = Math.min(keyW * ratio, (kbH - (rows - 1) * gap) / rows, KEY_MAX * 0.92);
  return { keyW, keyH, size: Math.min(keyW, keyH / Math.min(ratio, 1)) };
}

function layoutBoardContent() {
  if (!boardEl) return;
  const w = boardEl.clientWidth;
  const h = boardEl.clientHeight;
  if (!(w > 0 && h > 0)) return;

  const pad = Math.round(Math.max(8, Math.min(26, Math.min(w, h) * 0.035)));
  const gap = Math.round(Math.max(3, Math.min(10, Math.min(w, h) * 0.012)));
  const innerW = w - 2 * pad;
  const innerH = h - 2 * pad;

  /* Three ways to lay the board out; the one that gives the biggest keys
     while leaving the figure a fair share of the board wins:
     tall  - figure on top, word, then a 9x3 keyboard (portrait boards)
     wide  - figure left, word + 9x3 keyboard right (square-ish / wide)
     strip - figure left of the word, a 13x2 keyboard across the full
             width underneath (short, wide boards: phones in landscape) */
  const FIG_RATIO = 190 / 230;     // the figure's own width / height
  const figH = (bw, bh) => Math.max(0, Math.min(bh, bw / FIG_RATIO));
  const tallKb = fitKeys(innerW, innerH * 0.32, 9, 3, gap, 1.15);
  const wideCol = (innerW - pad) * 0.62;
  const wideKb = fitKeys(wideCol, innerH * 0.5, 9, 3, gap, 0.95);
  const stripKb = fitKeys(innerW, innerH * 0.4, 13, 2, gap, 0.95);
  const candidates = [
    { shape: "tall", cols: 9, rows: 3, colW: innerW, ...tallKb,
      fig: figH(innerW, innerH - 3 * tallKb.keyH - innerH * 0.2) },
    { shape: "wide", cols: 9, rows: 3, colW: wideCol, ...wideKb,
      fig: figH((innerW - pad) * 0.38, innerH) },
    { shape: "strip", cols: 13, rows: 2, colW: (innerW - pad) * 0.66, ...stripKb,
      fig: figH((innerW - pad) * 0.34, innerH - 2 * stripKb.keyH - gap) },
  ];
  const aspect = w / h;
  // Portrait boards keep the stacked layout; the others compete.
  const pool = aspect < 0.95 ? [candidates[0]]
    : aspect < 1.15 ? candidates
    : candidates.slice(1);
  /* Keys first: any layout whose keys are a comfortable size (44px, or as
     close to it as this board allows) qualifies; among those the one that
     draws the biggest figure wins. */
  const KEY_COMFORT = 44;
  const bestKey = Math.max(...pool.map((c) => c.size));
  const need = Math.min(KEY_COMFORT, bestKey - 0.5);
  let best = null;
  pool.forEach((c) => {
    if (c.size >= need && (!best || c.fig > best.fig)) best = c;
  });
  boardEl.dataset.shape = best.shape;

  const keyW = Math.max(KEY_MIN, best.keyW);
  const keyH = Math.max(KEY_MIN, best.keyH);
  const keyFs = Math.max(11, Math.min(30, keyH * 0.44));

  // Word: every letter on one line when it fits; the longest words wrap
  // only in the narrowest boards.
  const n = Math.max(1, selectedWord.length);
  const wordW = best.shape === "tall" ? innerW : best.colW;
  const slotGap = Math.max(2, Math.min(7, wordW * 0.008));
  let letterW = Math.min(72, (wordW - n * slotGap * 2) / n);
  letterW = Math.max(15, letterW);
  const letterFs = Math.max(14, Math.min(60, letterW * 1.1, h * 0.085));
  const letterH = Math.round(letterFs * 1.45);

  const st = boardEl.style;
  st.setProperty("--hm-pad", pad + "px");
  st.setProperty("--hm-gap", gap + "px");
  st.setProperty("--kb-cols", String(best.cols));
  st.setProperty("--key-w", Math.floor(keyW) + "px");
  st.setProperty("--key-h", Math.floor(keyH) + "px");
  st.setProperty("--key-fs", keyFs.toFixed(1) + "px");
  st.setProperty("--slot-gap", slotGap.toFixed(1) + "px");
  st.setProperty("--letter-w", Math.floor(letterW) + "px");
  st.setProperty("--letter-h", letterH + "px");
  st.setProperty("--letter-fs", letterFs.toFixed(1) + "px");
  st.setProperty("--wrong-fs", Math.max(12, Math.min(26, letterFs * 0.6)).toFixed(1) + "px");
}

/* Pac-Man fits its canvas to boardHostBox(); the board does the same, and
   fills the whole box — a word game has no fixed shape to keep. */
function resizeBoard() {
  if (!boardEl) return;
  const box = boardHostBox();
  if (!(box.w > 0 && box.h > 0)) return;
  boardEl.style.width = Math.floor(box.w) + "px";
  boardEl.style.height = Math.floor(box.h) + "px";
  layoutBoardContent();
}

/* The narrowest and widest shapes the board is laid out for. The side-ad
   layout reads these the way it reads the maze's in Pac-Man: a card beside
   the board must leave it at least minBoardAspect() wide, and the
   leaderboard band may take height until the board reaches maxBoardAspect(). */
function minBoardAspect() { return 0.9; }
function maxBoardAspect() { return 1.6; }

/* Physical keyboard: letters guess; Escape pauses / resumes. (Pac-Man also
   pauses on P, which is a letter here.) */
document.addEventListener("keydown", (e) => {
  if (!screens.game.classList.contains("active")) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  // A held key auto-repeats: only the first press counts.
  if (e.repeat) return;
  if (e.key === "Escape") {
    e.preventDefault();
    if (!overlay.classList.contains("hidden") || adIsPlaying ||
        !confirmOverlayEl.classList.contains("hidden")) return;
    setPaused(!gamePaused);
    return;
  }
  const k = (e.key || "").toLowerCase();
  if (k.length === 1 && k >= "a" && k <= "z") {
    e.preventDefault();
    handleGuess(k);
  }
});

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

// ===================== WIN / GAME OVER =====================
/* The same popup, buttons, 150ms beat and MREC as Pac-Man's
   handleLevelWin() / handleGameOver(); only the words and the rewards are
   Hangman's. */
function handleLevelWin() {
  gameOver = true;
  playable = false;
  playWinSound();
  /* Coins are paid only the FIRST time a level is cleared (same rule as
     Pac-Man), so replaying an easy level cannot be farmed. */
  const firstClear = !isLevelCompleted(currentLevel);
  markLevelCompleted(currentLevel);
  let coinsEarned = 0;
  const flawless = wrongLetters.length === 0; // +NO_WRONG_BONUS on a first clear
  if (firstClear) {
    coinsEarned = WORD_COIN_REWARD + (flawless ? NO_WRONG_BONUS : 0);
    addCoins(coinsEarned);
    playCoinSound();
  }
  const clearedLevel = currentLevel;
  const word = selectedWord.toUpperCase();
  /* Every 3rd level: the next level is owed an ad (see enterLevel()). */
  if (isAdGateLevel(clearedLevel) && clearedLevel < TOTAL_LEVELS) {
    store.set(GATE_OWED_KEY, String(clearedLevel + 1));
  }
  updateUI();

  clearTimeout(resultPopupTimer);
  resultPopupTimer = setTimeout(() => {
    resultPopupTimer = null;
    const isLast = clearedLevel >= TOTAL_LEVELS;

    modalTitle.textContent = "\u{1F389} Congratulations!";
    modalMessage.textContent = isLast
      ? `The word was ${word} \u2014 you finished all ${TOTAL_LEVELS} levels!`
      : `Level ${clearedLevel} cleared: ${word}. Level ${clearedLevel + 1} is now unlocked.`;
    modalCoins.textContent = coinsEarned > 0
      ? `+${coinsEarned} \u{1FA99} coins`
      : "Already cleared \u2014 coins are paid on the first clear only";
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
        // The owed every-3rd-level ad (if any) plays inside enterLevel().
        enterLevel(clearedLevel + 1);
      },
      () => goToLevelSelect()
    );
    setModalPrevLevel(clearedLevel > 1 ? clearedLevel - 1 : 0);
    overlay.classList.remove("hidden");
  }, 150);
}

/* Game Over's "Watch Ad & Continue", always offered (like Pac-Man's
   "3 fresh lives"): every ad gives all 6 guesses back and a fresh figure,
   as many times as the player likes. The word, the letters found and the
   letters already tried are kept. */
function nextContinueReward() {
  return getMaxWrongForLevel(currentLevel);
}

function handleGameOver() {
  gameOver = true;
  playable = false;
  playGameOverSound();
  clearTimeout(resultPopupTimer);
  resultPopupTimer = setTimeout(() => {
    resultPopupTimer = null;
    modalTitle.textContent = "Game Over \u{1F480}";
    modalMessage.textContent = `Level ${currentLevel}: out of guesses. Try again?`;
    modalCoins.classList.add("hidden");
    modalBannerAd.classList.add("hidden");
    modalBannerAd.innerHTML = "";
    stopModalBannerCarousel();

    continueAdBtn.classList.remove("hidden");
    continueAdBtn.disabled = false;
    continueNote.classList.remove("hidden");
    continueNote.textContent = "Watch a short ad to get all " + nextContinueReward() + " guesses back on this same word.";

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
  if (continueAdInFlight || !gameOver || playable) return;
  const reward = nextContinueReward();
  continueAdInFlight = true;
  continueAdBtn.disabled = true;
  overlay.classList.add("hidden");
  stopModalBannerCarousel();
  playVideoAd({
    placement: "continue",
    rewardText: "Watch the ad to get all " + reward + " guesses back \u2014 the word and your letters are kept.",
  }).then((res) => {
    continueAdInFlight = false;
    // No ad shown -> no continue. Back to the Game Over popup.
    if (!res || !res.shown) {
      continueAdBtn.disabled = false;
      continueNote.textContent = "The ad couldn't load, so no extra guesses were given. Please try again.";
      overlay.classList.remove("hidden");
      return;
    }
    // All guesses back: the misses so far are added to the allowance (so 6
    // are left again) and the figure starts over.
    bonusWrongAllowance = wrongLetters.length;
    figureBase = wrongLetters.length;
    gameOver = false;
    playable = true;
    renderWrongLetters();
    updateUI();
    showToast("All " + reward + " guesses back \u2014 keep going!");
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
    enterLevel(level, { closeOverlay });
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

/* Hangman's order: word pack first, then the level. Both Play and Select
   Level open the pack list; picking a pack opens its levels. */
playBtn.addEventListener("click", () => {
  goToCategories();
});

levelSelectBtn.addEventListener("click", () => {
  goToCategories();
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
    const target = inHowTo ? howToReturnScreen : btn.dataset.target;
    if (target === "categories") goToCategories();
    else if (target === "levelSelect") goToLevelSelect();
    else {
      if (target === "menu") updateCoinDisplays();
      showScreen(target);
    }
    if (inHowTo) howToReturnScreen = "menu";
  });
});

/* Four tiers of ten, one per step of the wrong-guess allowance:
   6 / 5 / 4 / 3 wrong guesses (see TIER_MAX_WRONG). */
function getDifficultyTier(level) {
  if (level <= 10) return { key: "easy", label: "Easy" };
  if (level <= 20) return { key: "medium", label: "Medium" };
  if (level <= 30) return { key: "hard", label: "Hard" };
  return { key: "expert", label: "Expert" };
}

function buildLevelGrid() {
  const furthest = getFurthestUnlockedLevel();

  /* "Level X of 30 unlocked" — the same fact the padlocks carry, said once
     instead of leaving it to be counted. X is the furthest level the
     player currently has access to. */
  const progressLine = document.getElementById("levelProgressLine");
  if (progressLine) {
    const pack = getSelectedCategory();
    progressLine.textContent = pack.icon + " " + pack.name + " \u00b7 Level " + furthest + " of " + TOTAL_LEVELS + " unlocked";
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
        enterLevel(i);
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
    enterLevel(level);
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
updateCoinDisplays();
setMuted(soundMuted);
buildKeyboard();
buildLevelGrid();
showScreen("menu");

/* A live level is paused when the tab / app goes to the background, so the
   player comes back to a paused board (same rule as Pac-Man). */
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    if (screens.game.classList.contains("active") && !gameOver && !adIsPlaying) {
      setPaused(true);
    }
  } else if (screens.game.classList.contains("active")) {
    resizeBoard();
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
/* Hangman only: Pac-Man's maze can shrink to any size, but 26 letter keys
   need room. On short landscape phones two cards would leave the board too
   narrow for keys a thumb can hit (under ~28px), so the board must keep
   at least this width before a second card is added (else one card), and
   before one card is shown (else the card shrinks or gives way to the
   leaderboard band, exactly as Pac-Man does when there is no room). */
const BOARD_MIN_W_TWO_ADS = 440;
const BOARD_MIN_W_ONE_AD = 360;
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
  if (w2 >= Hm * LAND_TWO_MIN_ASPECT && w1 > Hm * LAND_TWO_IF_WIDER &&
      w2 >= BOARD_MIN_W_TWO_ADS) n = 2;

  /* A single card must still leave the maze its narrowest natural shape; if
     it does not (a very narrow landscape window), the card gives it back. */
  if (n === 1 && w1 < Math.max(Hm * minAspect, BOARD_MIN_W_ONE_AD)) {
    cardW = Math.floor(innerW - gap - Math.max(Hm * minAspect, BOARD_MIN_W_ONE_AD));
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
  var catBtn = document.getElementById("categoryHelpBtn");
  if (catBtn) catBtn.addEventListener("click", function () { openHowToPlay("categories"); });
})();
