/**
 * DreamStream Play — Design B behaviour. No libraries.
 * 1 header menus · 2 featured slider · 3 carousel rows · 4 search & filters · 5 game player
 */
(function () {
	'use strict';

	var $ = function (sel, root) { return (root || document).querySelector(sel); };
	var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
	var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

	/* 1. Header: Categories menu and mobile menu ------------------------ */
	var dd = $('[data-dd]');
	if (dd) {
		var ddBtn = $('[data-dd-btn]', dd);
		var ddPanel = $('[data-dd-panel]', dd);
		var setDd = function (open) {
			ddBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
			ddPanel.classList.toggle('is-open', open);
		};
		ddBtn.addEventListener('click', function () { dd.classList.remove('is-suppressed'); setDd(ddBtn.getAttribute('aria-expanded') !== 'true'); });
		// After a choice, keep the menu shut until the pointer leaves it (hover would reopen it).
		dd.addEventListener('mouseleave', function () { dd.classList.remove('is-suppressed'); });
		document.addEventListener('click', function (e) { if (!dd.contains(e.target)) { setDd(false); } });
		document.addEventListener('keydown', function (e) {
			if (e.key === 'Escape' && ddBtn.getAttribute('aria-expanded') === 'true') { setDd(false); ddBtn.focus(); }
		});
	}

	var menuBtn = $('[data-menu-btn]');
	var mnav = $('[data-mnav]');
	if (menuBtn && mnav) {
		var setMenu = function (open) {
			menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
			mnav.classList.toggle('is-open', open);
		};
		menuBtn.addEventListener('click', function () { setMenu(menuBtn.getAttribute('aria-expanded') !== 'true'); });
		mnav.addEventListener('click', function (e) { if (e.target.closest('a')) { setMenu(false); } });
		document.addEventListener('keydown', function (e) {
			if (e.key === 'Escape' && mnav.classList.contains('is-open')) { setMenu(false); menuBtn.focus(); }
		});
	}

	var search = $('[data-search]');
	var jump = $('[data-search-jump]');
	if (jump) {
		jump.addEventListener('click', function () {
			if (search) {
				search.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
				search.focus({ preventScroll: true });
			} else {
				window.location.href = (window.dsPlay && window.dsPlay.home ? window.dsPlay.home : '/') + '#categories';
			}
		});
	}

	/* 2. Featured slider ------------------------------------------------ */
	var slider = $('[data-slider]');
	if (slider) {
		var track = $('[data-slider-track]', slider);
		var slides = $$('[data-slide]', slider);
		var dots = $$('.ds-dot', slider);
		var thumbs = $$('.ds-thumb', slider);
		var counter = $('[data-slider-count]', slider);
		var n = slides.length;
		var index = 0;
		var timer = null;
		var paused = false;
		var pad = function (v) { return (v < 10 ? '0' : '') + v; };

		var show = function (i) {
			index = (i + n) % n;
			track.style.transform = 'translateX(' + (-index * 100) + '%)';
			slides.forEach(function (s, k) {
				var on = k === index;
				s.setAttribute('aria-hidden', on ? 'false' : 'true');
				if (on) { s.removeAttribute('inert'); } else { s.setAttribute('inert', ''); }
			});
			dots.forEach(function (d, k) {
				var on = k === index;
				d.style.width = on ? '32px' : '12px';
				d.style.background = on ? '#FFE300' : 'rgba(255,255,255,0.4)';
				d.setAttribute('aria-current', on ? 'true' : 'false');
			});
			thumbs.forEach(function (t, k) { t.style.border = '2px solid ' + (k === index ? '#FFE300' : 'rgba(255,255,255,0.2)'); });
			if (counter) { counter.textContent = pad(index + 1) + ' / ' + pad(n); }
		};

		var start = function () {
			if (reduceMotion || n < 2 || timer) { return; }
			timer = setInterval(function () { if (!paused) { show(index + 1); } }, 6000);
		};

		var prev = $('[data-slider-prev]', slider);
		var next = $('[data-slider-next]', slider);
		if (prev) { prev.addEventListener('click', function () { show(index - 1); }); }
		if (next) { next.addEventListener('click', function () { show(index + 1); }); }
		$$('[data-slider-dot]', slider).forEach(function (b) {
			b.addEventListener('click', function () { show(parseInt(b.getAttribute('data-slider-dot'), 10)); });
		});

		slider.addEventListener('mouseenter', function () { paused = true; });
		slider.addEventListener('mouseleave', function () { paused = false; });
		slider.addEventListener('focusin', function () { paused = true; });
		slider.addEventListener('focusout', function () { paused = false; });

		var touchX = null;
		slider.addEventListener('touchstart', function (e) { paused = true; touchX = e.touches[0].clientX; }, { passive: true });
		slider.addEventListener('touchend', function (e) {
			if (touchX === null) { return; }
			var dx = e.changedTouches[0].clientX - touchX;
			if (Math.abs(dx) > 40) { show(index + (dx < 0 ? 1 : -1)); }
			touchX = null;
		});

		show(0);
		start();
	}

	/* 2b. Hero banner rotator ----------------------------------------------- */
	var rot = $('[data-rot]');
	if (rot) {
		var items = $$('[data-rot-item]', rot);
		var at = 0;
		var hold = false;
		var place = function (i) {
			var n2 = items.length;
			at = (i + n2) % n2;
			items.forEach(function (el, k) {
				var d = (k - at + n2) % n2;
				el.setAttribute('data-pos', d === 0 ? 'center' : d === 1 ? 'right' : d === n2 - 1 ? 'left' : 'back');
			});
		};
		items.forEach(function (el, k) {
			el.addEventListener('click', function () { if (el.getAttribute('data-pos') !== 'center') { place(k); } });
		});
		rot.addEventListener('mouseenter', function () { hold = true; });
		rot.addEventListener('mouseleave', function () { hold = false; });
		place(0);
		if (!reduceMotion && items.length > 1) {
			setInterval(function () { if (!hold && !document.hidden) { place(at + 1); } }, 3500);
		}
	}

	/* 3. Carousel rows ---------------------------------------------------- */
	var setupRow = function (row) {
		var vp = $('[data-row-viewport]', row);
		var prev = $('[data-row-prev]', row);
		var next = $('[data-row-next]', row);
		if (!vp) { return; }
		var step = function () {
			var card = $('.ds-card:not([hidden])', vp);
			return card ? card.getBoundingClientRect().width + 24 : vp.clientWidth * 0.8;
		};
		var update = function () {
			var max = vp.scrollWidth - vp.clientWidth - 2;
			var scrollable = max > 0;
			if (prev) { prev.hidden = !scrollable; }
			if (next) { next.hidden = !scrollable; }
			if (prev) { prev.setAttribute('aria-disabled', vp.scrollLeft <= 2 ? 'true' : 'false'); }
			if (next) { next.setAttribute('aria-disabled', vp.scrollLeft >= max ? 'true' : 'false'); }
		};
		if (prev) { prev.addEventListener('click', function () { vp.scrollBy({ left: -step(), behavior: reduceMotion ? 'auto' : 'smooth' }); }); }
		if (next) { next.addEventListener('click', function () { vp.scrollBy({ left: step(), behavior: reduceMotion ? 'auto' : 'smooth' }); }); }
		vp.addEventListener('scroll', update, { passive: true });
		window.addEventListener('resize', update);
		row.dsUpdate = update;
		update();
	};
	var rows = $$('[data-row]');
	rows.forEach(setupRow);

	/* 4. Search and genre filters ---------------------------------------- */
	var chips = $$('[data-chip]');
	var empty = $('[data-empty]');
	var state = { genre: 'all', q: '' };
	var norm = function (v) { return (v || '').toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim(); };

	var apply = function () {
		var q = norm(state.q);
		var shown = 0;
		rows.forEach(function (row) {
			var visible = 0;
			// "Top picks" always lists every game; only the search narrows it.
			var allRow = row.hasAttribute('data-row-all');
			// "All": genre rows with 3+ games and "More games". A category: only that genre's own row.
			var rowAllowed = allRow || (state.genre === 'all'
				? !row.hasAttribute('data-row-small')
				: row.getAttribute('data-genre-row') === state.genre);
			$$('[data-card]', row).forEach(function (card) {
				var genres = (card.getAttribute('data-genres') || '').split(' ');
				var ok = rowAllowed && (allRow || state.genre === 'all' || genres.indexOf(state.genre) !== -1) && (!q || norm(card.getAttribute('data-title')).indexOf(q) !== -1);
				card.hidden = !ok;
				if (ok) { visible++; }
			});
			row.hidden = visible === 0;
			if (!allRow) { shown += visible; }
			var vp = $('[data-row-viewport]', row);
			if (vp) { vp.scrollLeft = 0; }
			if (row.dsUpdate) { row.dsUpdate(); }
		});
		chips.forEach(function (c) { c.setAttribute('aria-pressed', c.getAttribute('data-chip') === state.genre ? 'true' : 'false'); });
		if (empty) {
			empty.hidden = shown > 0 || (state.genre === 'all' && !q);
			var label = $('[data-empty-text]', empty);
			if (label) {
				if (!label.getAttribute('data-default')) { label.setAttribute('data-default', label.textContent); }
				var chip = chips.filter(function (c) { return c.getAttribute('data-chip') === state.genre; })[0];
				label.textContent = (!q && chip && state.genre !== 'all') ? 'No ' + chip.textContent.trim() + ' games yet' : label.getAttribute('data-default');
			}
		}
	};

	var setGenre = function (g, scroll) {
		state.genre = g || 'all';
		apply();
		if (scroll) {
			var target = $('#games');
			if (target) { target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' }); }
		}
	};

	if (rows.length && chips.length) {
		chips.forEach(function (c) { c.addEventListener('click', function () { setGenre(c.getAttribute('data-chip'), false); }); });

		if (search) {
			var t;
			search.addEventListener('input', function () {
				clearTimeout(t);
				t = setTimeout(function () { state.q = search.value; apply(); }, 120);
			});
			search.addEventListener('keydown', function (e) {
				if (e.key === 'Enter') {
					e.preventDefault();
					state.q = search.value; apply();
					var g = $('#games'); if (g) { g.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' }); }
				}
			});
		}

		$$('[data-reset]').forEach(function (b) {
			b.addEventListener('click', function () { state.q = ''; if (search) { search.value = ''; } setGenre('all', false); });
		});

		// Genre links in the header, mobile menu and footer filter in place.
		$$('[data-genre-link]').forEach(function (a) {
			a.addEventListener('click', function (e) {
				e.preventDefault();
				if (dd) { dd.querySelector('[data-dd-panel]').classList.remove('is-open'); dd.querySelector('[data-dd-btn]').setAttribute('aria-expanded', 'false'); dd.classList.add('is-suppressed'); if (document.activeElement && dd.contains(document.activeElement)) { document.activeElement.blur(); } }
				setGenre(a.getAttribute('data-genre-link'), true);
			});
		});

		var params = new URLSearchParams(window.location.search);
		if (params.get('q') && search) { search.value = params.get('q'); state.q = params.get('q'); }
		if (params.get('genre') && chips.some(function (c) { return c.getAttribute('data-chip') === params.get('genre'); })) { state.genre = params.get('genre'); }
		if (state.q || state.genre !== 'all') { apply(); }
	}

	/* 5. Game player ------------------------------------------------------ */
	var player = $('[data-player]');
	if (player) {
		var frameBox = $('[data-player-frame]', player);
		var closeBtn = $('[data-player-close]', player);
		var opener = null;
		var pushed = false;

		var removeFrame = function () { $$('iframe', frameBox).forEach(function (f) { f.remove(); }); };

		var open = function (btn) {
			opener = btn;
			player.setAttribute('aria-label', btn.getAttribute('data-title') || 'Game');
			var f = document.createElement('iframe');
			f.src = btn.getAttribute('data-src');
			f.title = btn.getAttribute('data-title') || 'Game';
			f.setAttribute('sandbox', btn.getAttribute('data-sandbox') || 'allow-scripts');
			f.setAttribute('allow', 'fullscreen; autoplay; gamepad; screen-wake-lock');
			f.setAttribute('allowfullscreen', '');
			f.setAttribute('referrerpolicy', 'no-referrer');
			removeFrame();
			frameBox.appendChild(f);
			player.hidden = false;
			document.body.classList.add('ds-lock');
			history.pushState({ dsGame: true }, '');
			pushed = true;
			closeBtn.focus();
		};

		var close = function (fromBack) {
			if (player.hidden) { return; }
			removeFrame();
			player.hidden = true;
			document.body.classList.remove('ds-lock');
			if (pushed && !fromBack) { history.back(); }
			pushed = false;
			if (opener && document.body.contains(opener)) { opener.focus(); }
		};

		document.addEventListener('click', function (e) {
			var b = e.target.closest('[data-play]');
			if (b) { e.preventDefault(); open(b); }
		});
		closeBtn.addEventListener('click', function () { close(false); });
		document.addEventListener('keydown', function (e) {
			if (player.hidden) { return; }
			if (e.key === 'Escape') { close(false); }
			if (e.key === 'Tab') {
				var f = $('iframe', frameBox);
				var items = [closeBtn].concat(f ? [f] : []);
				var i = items.indexOf(document.activeElement);
				e.preventDefault();
				items[(i + (e.shiftKey ? -1 : 1) + items.length) % items.length].focus();
			}
		});
		window.addEventListener('popstate', function () { if (!player.hidden) { close(true); } });
	}
})();
