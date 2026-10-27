# Doodle Jump — Pac-Man standard pass

Checked against Pac-Man in a headless browser at desktop, tablet portrait/landscape,
phone portrait/landscape, small (360x640) and large (430x932 / 932x430) phones.

## Changed
- Game Over popup: Watch Ad & Continue is always offered (no 3-per-attempt cap), same as Pac-Man.
  Message shortened to one line ("You scored X / Target on Level N.") — popup now matches Pac-Man to the pixel.
- Congratulations popup: same rows as Pac-Man (title, message, coins line, MREC, buttons).
  Title is always "Congratulations!". Stars and milestone bonus moved onto the single coins line.
  Coins are paid on clear (no Collect step). Removed Collect / "Watch 2 Ads → 2× Coins".
  Removed the extra rule that shrank the popup ad on short landscape screens.
- Shop: added Pac-Man's tab row ("Skins" / "Milestones"). One button per card like Pac-Man;
  Buy is disabled when coins are short; no toasts on buy/equip. Removed the skin-trial ad button.
- How to Play: removed the inner box behind the list (Pac-Man puts the list straight on the card).
  Continue rule text updated.
- sponsor-media.json + built-in fallback catalogue: removed "double_coins" and "skin_trial" placements.

## Verified unchanged / already matching
Logo screen, Select Level, gameplay layout, stats bar, controls, all ad units, Restart ad,
5-ads unlock, 24-hour reset message — no layout differences from before this pass.

## Pass 2 — buttons, typography, shape (style.css only)
Cross-checked every computed CSS property of the menu, Play button, menu buttons,
level/shop/how-to/game-bar/popup elements against Pac-Man at desktop, tablet
portrait/landscape, phone portrait/landscape, 360x640, 430x932 and 932x430.

- Size and type (width, height, padding, radius, font family/size/weight,
  line-height, letter-spacing) were already identical. The visible mismatch came
  from the Doodle colour layer, which gave buttons a solid 3D ledge
  (0 4px 0 / 0 3px 0) and extra 1px borders.
- The colour layer was rewritten to change colour only. Every shadow, border,
  gradient angle and hover/press state now uses Pac-Man's exact values:
  Play 0 4px 14px, menu keys 0 3px 10px, coin pills 0 2px 6px, bar buttons
  borderless 0 3px 8px, shop cards 2px border, popups 0 12px 40px, gradients 135deg.
- Side effect fixed: the extra borders had made Pause/Restart/Exit 2px wider and the
  coins line 2px taller; they now measure the same as Pac-Man's.
- Text Pac-Man draws in dark ink (subtitle, caption, progress line, popup message,
  How-to bold words, stat words) now uses Doodle Jump's dark ink, so it reads at the
  same weight. Locked tiles are fully opaque, and disabled bar buttons use 0.65, as in Pac-Man.

## Pass 3 — bug audit and clean-up
Static lint (ESLint), id/selector cross-checks, a reachability simulation of the
platform generator, a bot that plays every difficulty tier, and end-to-end browser
tests of every flow (play, pause, game over, continue x4, retry, restart ad, level
clear, every-3rd-level ad, prev/next, exit, 5-ads unlock, 24 h reset, mute,
rotation, touch buttons). No console errors.

Fixed
- Levels became impossible to finish (script.js, platform generation). Platforms were
  placed at a random x with a gap of up to 120px, but the doodler can't wrap round the
  screen edge and jumps lower as gravity rises with the level. Simulation: about 6 in 10
  Level-10 runs and nearly every run from Level 20 hit a platform out of reach. Each
  new platform is now placed inside the jump's real reach (same physics as the game),
  with the gap capped at 85% of the jump height. Same gap range on early levels;
  Level 35's cap is 102px. A test bot went from 0 clears above Level 5 to clearing
  every tier.
- Game ran at the wrong speed on 120/144 Hz screens (script.js, game loop). Physics
  advanced once per screen refresh, so a 120 Hz phone/iPad ran the game twice as fast.
  The simulation now runs in fixed 1/60 s steps: measured 120 ticks per 2 s at 60,
  120 and 144 Hz (was 120 / 241 / 289).
- Continue could drop the doodler on a dead end (script.js). The safe platform was
  always centred; it now sits under the nearest platform above, within jumping range.
- After a breaking platform the next one could be a moving one sliding out of reach
  with no chance to wait; that combination is no longer generated.
- The doodler snapped back to facing right whenever the Left key was released; it now
  keeps facing the way it last moved.
- A corrupted saved high score could show "NaN"; it now falls back to 0.
- Milestone skins said "unlocks when you reach Level 10" but unlock on clearing it;
  shop tooltip, How to Play and code comments now say "clear".

Removed (unused)
- script.js: playWinSound(), getLevelCoinReward(), railLimits(), four unused rail
  constants and their comment blocks, two unused locals, the leftover `trial` flag on
  Fire Doodle, and a sentence spliced into the header comment.
- style.css: 34 rules for Pac-Man's joystick and "recoverable" tiles that match nothing
  in Doodle Jump, plus two exact duplicate rules (~200 lines). Layout re-measured
  afterwards: unchanged on every screen and size.

## Pass 4 — controls, 3 lives, platform placement
- Move buttons moved under the thumbs. Landscape: ← at the far left end of the bar,
  → at the far right (one bar-height tall, up to 1.6x wide, shrinking before the bar
  could overflow). Portrait: the move buttons get their own bottom row (two halves on a
  phone, 240px corner pads on a tablet). Nothing covers the board. Checked at 16 sizes
  from 320x568 to 1440x900 and through repeated rotations: no overlaps, no overflow,
  same sizes after rotating back.
- 3 lives per attempt. A fall costs a life (chip pulse, short sound, respawn blinking on
  a safe platform, score kept); the 3rd fall opens Game Over. Continue gives 3 fresh
  lives; Retry / Restart reset to 3. Lives chip added to the bar; How to Play updated.
- Platform placement made comfortable, not just possible: every step is reachable from
  any point of the current platform (and any point of a moving platform's slide), to any
  point of the next one's slide, with a reaction allowance, and gaps of at most 70% of
  the jump height. A bot that reacts late and just steers at the next platform now
  clears Levels 1-35 without a fall (was 2/20 at Level 10, 0/20 from Level 20).
- An ad-unlocked level now counts as played (for the Play button) on the first
  left/right input, not the first climb, since the doodler can climb onto a platform
  straight above with no input.

## Pass 5 — move buttons centred
- The ← → pair now sits on the horizontal centre of the screen, directly below the board,
  on every device and orientation: equal-size buttons, one fixed gap (14px landscape,
  16px portrait). Landscape: one bar row [ stats | ← → | buttons ]. Portrait: the pair
  has its own centred bottom row (about 140x59 phone, 180x64 tablet).
- To keep the pair exactly centred when the stats column is wide, centreMovePad()
  (script.js) compacts the bar only as far as needed: icons instead of words, then Best
  hidden, then "Level 7" -> "L7", then slightly narrower move buttons (never below a
  square), and as a last resort on the smallest screens the in-bar coin count. It re-runs
  on resize, rotation and when the numbers get longer. The same steps stop the portrait
  top row overflowing on 320px phones.
- Lives chip now shows its heart icon between 1000 and 1099px wide too.
- Verified at 17 sizes (320x568 to 1920x1080, both orientations), with 4-digit scores and
  coin counts, and through rotations: 0px off the screen centre, no overlaps, no overflow.

## Pass 6 — standing on platforms, no climbing without input, placement
- Doodler drawn on its platform: squash & stretch now grows from the feet, so the body
  no longer sinks ~3px into the platform on the bounce frame or hovers while falling.
- Landing uses the doodler's feet as drawn. In landscape the board is stretched
  sideways but the doodler is drawn round, so its 36px hit box was up to twice as wide
  as its body and it could "stand" in mid-air past a platform's edge. It now lands only
  when its feet are over the platform, in every orientation (coins use its body width).
- No climbing without input: bouncing in place used to land the doodler on any platform
  overlapping above it — typically 1-2 free climbs, up to 24, per run. Platforms are now
  never placed where a doodler bouncing in place on a platform below could reach them,
  and gaps are kept above half a jump height so only the next platform is ever in range.
  The respawn platform follows the same rule. Hands-off test: 0 climbs at Levels 1-35 in
  portrait and landscape (rare single climbs when a moving platform passes overhead).
- Placement: each step reachable from the middle of the current platform (75% for a
  breaking one, middle of the slide for a moving one), with a reaction allowance;
  gaps 88-115px on Level 1 down to 65-83px on Level 35. A test player that reacts late
  and times moving platforms cleared Levels 10, 20 and 35 without a fall, portrait and
  landscape. Breaking and moving platforms keep roughly their share.
- A crumbled platform comes back if the doodler falls back below it, so missing a jump
  from one can no longer strand the doodler on a platform with nothing reachable above.

## Pass 7 — same-platform restart, 3 mistakes + full ad, green Prev/Next
- After a fall (a lost life, or Watch Ad & Continue) the doodler goes back onto the
  platform it last bounced on, exactly where it is. No platform is added or moved (the
  old "safe platform" generator is removed). A crumbled breaking platform is restored
  for the restart and holds until the player steers. If the platform has scrolled to the
  bottom edge, the view moves down just enough to show it.
- 3 mistakes per attempt (the lives chip). After the 3rd, Game Over offers Watch Ad &
  Continue. The 3 come back only when the ad plays to its end: playVideoAd() now
  reports { shown, completed }, and a skipped or failed ad restores nothing and returns
  to the popup with a message. Repeats every time the limit is reached. How to Play updated.
- Prev / Next turn Doodle Jump green (the Pause colours) while pressed and for 0.9 s after
  a click, so it is clear which one took effect; green focus ring for keyboard use.
  They stay hidden on bars narrower than 700px (portrait phones, small landscape
  phones), as before.
