


	class Celula {
		constructor (x, y, w) {
			this.x = x;
			this.y = y;
			this.w = w;

			this.flag    = null;
			this.covered = true;

			this.neighborsList  = [];
			this.neighborsCount = 0;
		}

		draw (ctx, tileSize, box) {
			// Flat rendering (no sprite sheet): flush cell fill + hairline
			// border, same visual language as the Sudoku board. Covered cells
			// are handled by the caller (drawCell in routines.js) — this only
			// draws revealed cells.
			// `box` is where the cell sits on screen (routines.js cellBox): the
			// fill covers the whole box, and the mine / flag / number is drawn
			// in a square centred in it, so it is never stretched.
			let _el = this,
			    b   = box || { x: _el.x * tileSize, y: _el.y * tileSize, w: tileSize, h: tileSize },
			    s   = Math.min(b.w, b.h),
			    x   = b.x + (b.w - s) / 2,
			    y   = b.y + (b.h - s) / 2;
			tileSize = s;

			if (_el.neighborsCount === -1) {
				// Mine cell
				if (_el.detonated) {
					// The mine the player hit: a red flag on the red cell.
					MSDraw.cellBgRect(ctx, b.x, b.y, b.w, b.h, MS_PALETTE.errorBg, MS_PALETTE.error);
					MSDraw.flag(ctx, x, y, tileSize, MS_PALETTE.hitFlag, MS_PALETTE.hitFlagPole);
				} else {
					MSDraw.cellBgRect(ctx, b.x, b.y, b.w, b.h, MS_PALETTE.cardBg, MS_PALETTE.gridLine);
					MSDraw.mine(ctx, x, y, tileSize, MS_PALETTE.textDark);
				}
				return;
			}

			if (_el.flag === 'bombFlag') {
				// Revealed at game-over: this tile was wrongly flagged.
				MSDraw.cellBgRect(ctx, b.x, b.y, b.w, b.h, MS_PALETTE.cardBg, MS_PALETTE.gridLine);
				MSDraw.flag(ctx, x, y, tileSize, MS_PALETTE.textMid, MS_PALETTE.textMid);
				MSDraw.strike(ctx, x, y, tileSize, MS_PALETTE.error);
				return;
			}

			MSDraw.cellBgRect(ctx, b.x, b.y, b.w, b.h, MS_PALETTE.cardBg, MS_PALETTE.gridLine);
			if (_el.neighborsCount > 0) {
				MSDraw.number(ctx, x, y, tileSize, _el.neighborsCount);
			}
		}

		revealIt (matriz) {
			this.covered = false;

			if (this.neighborsCount === 0) {
				this.floodFill(matriz);
			}
		}

		floodFill (matriz) {
			var _el = this;

			for (var i = -1; i <= 1; i++) {
				if (!matriz[_el.y + i]) continue;
				for (var j = -1; j <= 1; j++) {
					var celula = matriz[_el.y + i][_el.x + j];
					if (!celula || !i && !j) continue;
					if (celula.neighborsCount >= 0 && celula.covered) {
						celula.revealIt(matriz);
					}
				}
			}
		}
	}


