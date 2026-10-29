# Orbit Maze — Bug Report & Change Log

**Files changed:** `script.js`, `style.css`
**Status:** all items below are fixed in this build. Tested in Chromium at 320×568, 360×740, 844×390 (landscape phone), 820×1180 (tablet) and 1440×900 (desktop): no console errors, no horizontal scroll, joystick never overlaps the stats or buttons.

## 1. Joystick size & responsiveness

| Screen | Before | After |
|---|---|---|
| Desktop (mouse) | 54px | 70px |
| Desktop / large touch | 64px | 84px |
| Touch tablet (≥700px wide, ≥600px tall) | 64px | **96px** |
| ≤699px | 56px | 76px |
| ≤559px (portrait phones) | 46px | 66px |
| ≤380px | 46px | 62px |
| ≤339px (iPhone SE 1st gen) | 44px | 56px |
| Landscape phones (height ≤520px) | clamp(44px, 14vh, 60px) | clamp(56px, 19vh, 80px) |

Other improvements:
- Knob grows from 40% → 42% of the base and travels further (0.55 → 0.6 of the radius), so movement is easier to see.
- Invisible 10px touch margin around the stick on touch screens: a thumb landing just outside the ring still grabs it.
- 10% dead-zone in the centre: a resting thumb no longer makes the maze jitter.

## 2. Bugs fixed

| # | Severity | Bug | Fix |
|---|---|---|---|
| B1 | High | **Marbles resting against each other counted as a "collision" every frame** (~60/sec) and played the click sound constantly. This silently destroyed the no-collision bonus even when marbles never actually hit. | Collision is counted / sound played only when the marbles are actually moving into each other (closing speed > 0.05). The push-apart physics is unchanged. |
| B2 | High | **Continue could instantly end the game again.** After watching the continue ad, marbles are restored to their old spot — if a *moving* black hole was on top of one, the very next frame triggered Game Over before the player could touch anything (ad wasted). | 1.5 s hole grace period after a continue (`CONTINUE_GRACE_MS`). |
| B3 | Medium | **X and Y physics were different.** The X-axis velocity was clamped twice (before and after friction), Y only once — so tilting left/right behaved slightly differently from up/down. | Both axes now go through one `stepVelocity()` helper. |
| B4 | Medium | **HTML injection from ad data.** Titles, subtitles, CTA text, image URLs and colours from `sponsor-media.json` were concatenated straight into `innerHTML`. A title like `Save <50%` breaks the card; a hostile catalogue could inject script. | New `escHtml()` used in the MREC, side-rail and leaderboard cards. |
| B5 | Low | Pressing the joystick while paused / during an ad captured the pointer but did nothing, leaving the pointer captured. | Capture is released when the press is refused. |
| B6 | Low | MREC banner (`buildBannerCard`) set `clickable` / `onclick` / un-hid itself **twice**. | Duplicate removed. |
| B7 | Low (visual) | Joystick's **up arrow was green** while the other three were grey-blue. | All four arrows now the same colour. |
| B8 | Low (CSS) | Two separate `@media (max-width: 339px)` blocks fought over the same variables; order made the result hard to predict. | Merged into one block. |

## 3. Duplicate / dead code removed

**style.css (5,101 → ~4,950 lines)**
- 103 joystick width/height/margin/position declarations spread over ~12 old blocks (portrait, tablet, landscape, `data-bar` tiers, side-dock…). They were all overridden by the final "authoritative" bar block, so they did nothing except confuse anyone editing sizes. Joystick size now lives in **one** place: the `--joy` variable.
- 35 rules / media queries that became empty as a result.

**script.js**
- Ad click wiring (`classList.toggle("clickable")` + `window.open`) copy-pasted in 5 places → one `wireAdClick()` helper.
- X/Y velocity code → `stepVelocity()`.
- Unused: `railLimits()`, `RAIL_MIN_SCALE`, `RAIL_GAME_RESERVE`, `RAIL_VIEWPORT_CHROME`, `RAIL_MOBILE_BREATHING`, `continuesUsedThisRun`, the unused `silent` parameter of `setPaused()`, unused `from`/`to` in `railCardHtml()`, plus their stale comments.
- ESLint now reports 0 errors and 0 warnings (was 9 unused-variable warnings).

## 4. Where to tweak later
- Joystick size: change `--joy` in the "Design tokens" section near the end of `style.css` (one value per screen tier).
- Dead-zone / sensitivity: `DEAD_ZONE`, `FULL_TILT_AT`, `KNOB_TRAVEL` in `initJoystick()` in `script.js`.
- Continue protection time: `CONTINUE_GRACE_MS` in `script.js`.
