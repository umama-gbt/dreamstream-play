/**
 * Game Catalog Manager admin scripts.
 * Server data is always inserted with textContent (never as HTML).
 */
(function () {
	'use strict';

	var cfg = window.gcmAdmin || {};
	var t = cfg.i18n || {};

	function el(tag, className, text) {
		var node = document.createElement(tag);
		if (className) { node.className = className; }
		if (text !== undefined && text !== null) { node.textContent = text; }
		return node;
	}

	function formatSize(bytes) {
		if (bytes > 1048576) { return (bytes / 1048576).toFixed(1) + ' MB'; }
		return Math.max(1, Math.round(bytes / 1024)) + ' KB';
	}

	/**
	 * POST to admin-ajax. Calls back with (error, data).
	 */
	function post(action, fields, onDone, onProgress) {
		var data = new FormData();
		data.append('action', action);
		data.append('nonce', cfg.nonce);
		Object.keys(fields).forEach(function (key) { data.append(key, fields[key]); });

		var xhr = new XMLHttpRequest();
		xhr.open('POST', cfg.ajaxUrl);
		if (onProgress && xhr.upload) {
			xhr.upload.onprogress = function (e) {
				if (e.lengthComputable) { onProgress(Math.round(e.loaded / e.total * 100)); }
			};
			xhr.upload.onload = function () { onProgress(100); };
		}
		xhr.onload = function () {
			var json = null;
			try { json = JSON.parse(xhr.responseText); } catch (e) { /* not JSON */ }
			if (json && json.success) { onDone(null, json.data); return; }
			onDone((json && json.data && json.data.message) || t.networkError);
		};
		xhr.onerror = function () { onDone(t.networkError); };
		xhr.send(data);
	}

	function badge(status, label) {
		return el('span', 'gcm-badge gcm-badge--' + status, label);
	}

	/* ------------------------------------------------------------------
	 * Upload Game ZIPs page
	 * ------------------------------------------------------------------ */
	var input = document.querySelector('[data-gcm-zip-input]');
	var queueTable = document.querySelector('[data-gcm-queue]');

	if (input && queueTable) {
		var tbody = queueTable.querySelector('tbody');
		var dropzone = document.querySelector('[data-gcm-dropzone]');
		var queue = [];
		var busy = false;

		var addFiles = function (files) {
			Array.prototype.forEach.call(files, function (file) {
				var row = el('tr');
				var nameCell = el('td');
				nameCell.appendChild(el('strong', '', file.name));
				nameCell.appendChild(el('div', 'gcm-muted', formatSize(file.size)));
				var statusCell = el('td', '', t.waiting);
				var gameCell = el('td', '', '—');
				row.appendChild(nameCell);
				row.appendChild(statusCell);
				row.appendChild(gameCell);
				tbody.appendChild(row);
				queueTable.hidden = false;

				if (!/\.zip$/i.test(file.name)) {
					statusCell.textContent = t.failed + ': ' + t.notZip;
					row.className = 'is-error';
					return;
				}
				if (cfg.maxBytes && file.size > cfg.maxBytes) {
					statusCell.textContent = t.failed + ': ' + t.tooBig;
					row.className = 'is-error';
					return;
				}
				queue.push({ file: file, row: row, statusCell: statusCell, gameCell: gameCell });
			});
			next();
		};

		var next = function () {
			if (busy || !queue.length) { return; }
			busy = true;
			var item = queue.shift();
			item.statusCell.textContent = t.uploading + ' 0%';

			post('gcm_zip_upload', { zip: item.file }, function (error, data) {
				busy = false;
				handleResult(item, error, data);
				next();
			}, function (percent) {
				item.statusCell.textContent = percent < 100 ? t.uploading + ' ' + percent + '%' : t.processing;
			});
		};

		var showAttached = function (item, data) {
			item.row.className = 'is-done';
			item.statusCell.textContent = '';
			item.statusCell.appendChild(badge(data.game.buildStatus, data.game.buildLabel));
			(data.problems || []).forEach(function (problem) {
				item.statusCell.appendChild(el('div', 'gcm-problem', problem));
			});
			item.gameCell.textContent = '';
			item.gameCell.appendChild(el('span', 'gcm-muted', t.attached + ' '));
			var link = el('a', '', data.game.title);
			link.href = data.game.editUrl;
			item.gameCell.appendChild(link);
		};

		var showMatcher = function (item, data) {
			item.row.className = 'is-pending';
			item.statusCell.textContent = data.message;
			item.gameCell.textContent = '';

			var label = el('div', 'gcm-muted', t.chooseGame);
			var select = el('select', 'gcm-match-select');
			select.appendChild(new Option(t.select, ''));

			var suggestedIds = {};
			if (data.suggestions && data.suggestions.length) {
				var group = el('optgroup');
				group.label = t.suggested;
				data.suggestions.forEach(function (s) {
					suggestedIds[s.id] = true;
					group.appendChild(new Option(s.title + ' (' + s.score + '%)', s.id));
				});
				select.appendChild(group);
			}
			var all = el('optgroup');
			all.label = t.allGames;
			(cfg.games || []).forEach(function (g) {
				if (!suggestedIds[g.id]) { all.appendChild(new Option(g.title, g.id)); }
			});
			select.appendChild(all);
			if (data.preselected) { select.value = String(data.preselected); }

			var attach = el('button', 'button button-primary', t.attach);
			attach.type = 'button';
			var discard = el('button', 'button-link button-link-delete', t.discard);
			discard.type = 'button';

			attach.addEventListener('click', function () {
				if (!select.value) { select.focus(); return; }
				attach.disabled = discard.disabled = select.disabled = true;
				item.statusCell.textContent = t.processing;
				post('gcm_zip_attach', { token: data.token, game_id: select.value }, function (error, result) {
					handleResult(item, error, result);
				});
			});

			discard.addEventListener('click', function () {
				attach.disabled = discard.disabled = select.disabled = true;
				post('gcm_zip_discard', { token: data.token }, function () {
					item.row.className = 'is-muted';
					item.statusCell.textContent = t.discarded;
					item.gameCell.textContent = '—';
				});
			});

			var actions = el('div', 'gcm-match-actions');
			actions.appendChild(attach);
			actions.appendChild(discard);
			item.gameCell.appendChild(label);
			item.gameCell.appendChild(select);
			item.gameCell.appendChild(actions);
		};

		var handleResult = function (item, error, data) {
			if (error) {
				item.row.className = 'is-error';
				item.statusCell.textContent = t.failed + ': ' + error;
				return;
			}
			if (data.status === 'attached') {
				showAttached(item, data);
			} else if (data.status === 'needs_match') {
				showMatcher(item, data);
			}
		};

		input.addEventListener('change', function () {
			addFiles(input.files);
			input.value = '';
		});

		if (dropzone) {
			['dragenter', 'dragover'].forEach(function (type) {
				dropzone.addEventListener(type, function (e) {
					e.preventDefault();
					dropzone.classList.add('is-over');
				});
			});
			['dragleave', 'drop'].forEach(function (type) {
				dropzone.addEventListener(type, function () { dropzone.classList.remove('is-over'); });
			});
			dropzone.addEventListener('drop', function (e) {
				e.preventDefault();
				if (e.dataTransfer && e.dataTransfer.files) { addFiles(e.dataTransfer.files); }
			});
		}
	}

	/* ------------------------------------------------------------------
	 * Edit Game screen
	 * ------------------------------------------------------------------ */
	var filesBox = document.querySelector('[data-gcm-files]');

	if (filesBox) {
		var gameId = filesBox.getAttribute('data-game-id');
		var singleInput = filesBox.querySelector('[data-gcm-single-zip]');
		var inlineStatus = filesBox.querySelector('[data-gcm-inline-status]');
		var removeButton = filesBox.querySelector('[data-gcm-remove-files]');

		if (singleInput) {
			singleInput.addEventListener('change', function () {
				var file = singleInput.files[0];
				if (!file) { return; }
				if (cfg.maxBytes && file.size > cfg.maxBytes) {
					inlineStatus.textContent = t.tooBig;
					return;
				}
				singleInput.disabled = true;
				post('gcm_zip_upload', { zip: file, game_id: gameId }, function (error) {
					if (error) {
						singleInput.disabled = false;
						inlineStatus.textContent = t.failed + ': ' + error;
						return;
					}
					window.location.reload();
				}, function (percent) {
					inlineStatus.textContent = percent < 100 ? t.uploading + ' ' + percent + '%' : t.processing;
				});
			});
		}

		if (removeButton) {
			removeButton.addEventListener('click', function () {
				if (!window.confirm(t.confirmRemove)) { return; }
				removeButton.disabled = true;
				post('gcm_remove_files', { game_id: gameId }, function (error) {
					if (error) {
						removeButton.disabled = false;
						window.alert(error);
						return;
					}
					window.location.reload();
				});
			});
		}
	}

	var thumbs = document.querySelector('[data-gcm-thumbs]');
	if (thumbs) {
		thumbs.addEventListener('click', function (e) {
			var button = e.target.closest('[data-gcm-use-thumb]');
			if (!button) { return; }
			button.disabled = true;
			button.textContent = t.saving;
			post('gcm_use_thumbnail', { game_id: thumbs.getAttribute('data-game-id'), path: button.getAttribute('data-gcm-use-thumb') }, function (error) {
				if (error) {
					button.disabled = false;
					window.alert(error);
					return;
				}
				window.location.reload();
			});
		});
	}
})();
