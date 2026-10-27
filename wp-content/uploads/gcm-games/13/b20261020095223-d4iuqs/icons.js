/* Game icons as SVG — shared by Pac-Man and Sudoku (see icons.css).
   Replaces every icon character (🔊 🔁 ⏸ ▶ 🪙 …) in the page with the matching
   SVG icon, including text the game writes later (e.g. the sound / pause
   toggles and popup titles). Only the PICTURE changes: the game's own code,
   text, sizes and behaviour are untouched — nothing in either game reads
   icon text back. */
(function () {
  "use strict";
  var MAP = {"⏸": "pause", "▶": "play", "⬅": "arrow-left-bold", "➡": "arrow-right-bold", "←": "arrow-left", "→": "arrow-right", "↻": "reload", "✖": "close-bold", "✕": "close", "✔": "check", "★": "star", "●": "dot", "🔊": "speaker", "🔇": "speaker-muted", "🔁": "repeat", "🪙": "coin", "❓": "question", "🔒": "lock", "📺": "tv", "💀": "skull", "🗺": "map", "🏆": "trophy", "🎉": "party", "🚫": "ban", "💫": "dizzy", "✨": "sparkles", "🌟": "glowing-star", "❤": "heart", "⏰": "alarm", "⏱": "stopwatch"};
  var RE = new RegExp("(" + ["⏸", "▶", "⬅", "➡", "←", "→", "↻", "✖", "✕", "✔", "★", "●", "🔊", "🔇", "🔁", "🪙", "❓", "🔒", "📺", "💀", "🗺", "🏆", "🎉", "🚫", "💫", "✨", "🌟", "❤", "⏰", "⏱"].join("|") + ")\uFE0F?", "g");
  var SKIP = { I: 0, SCRIPT: 1, STYLE: 1, TEXTAREA: 1, TITLE: 1, NOSCRIPT: 1, OPTION: 1, svg: 1, SVG: 1 };
  function swapText(node) {
    var t = node.nodeValue, p = node.parentNode;
    if (!t || !p || SKIP[p.nodeName] || p.isContentEditable) return;
    if (p.nodeName === "GI-C") return;             // already an icon
    RE.lastIndex = 0;
    if (!RE.test(t)) return;
    RE.lastIndex = 0;
    var frag = document.createDocumentFragment(), last = 0, m;
    while ((m = RE.exec(t))) {
      if (m.index > last) frag.appendChild(document.createTextNode(t.slice(last, m.index)));
      var i = document.createElement("gi-i");
      i.className = "gi gi-" + MAP[m[1]];
      i.setAttribute("aria-hidden", "true");
      var c = document.createElement("gi-c");
      c.textContent = m[0];
      i.appendChild(c);
      frag.appendChild(i);
      last = m.index + m[0].length;
    }
    if (last < t.length) frag.appendChild(document.createTextNode(t.slice(last)));
    // In a flex / grid box the original text was ONE (anonymous) item; keep it
    // one item, or the box's gap would be added between the icon and the words.
    var d = window.getComputedStyle(p).display;
    if (d.indexOf("flex") !== -1 || d.indexOf("grid") !== -1) {
      var run = document.createElement("gi-run");
      run.appendChild(frag);
      frag = run;
    }
    p.replaceChild(frag, node);
  }
  function scan(root) {
    if (!root) return;
    if (root.nodeType === 3) { swapText(root); return; }
    if (root.nodeType !== 1 && root.nodeType !== 11) return;
    if (SKIP[root.nodeName]) return;
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null), list = [], n;
    while ((n = w.nextNode())) list.push(n);
    for (var k = 0; k < list.length; k++) swapText(list[k]);
  }
  function start() {
    scan(document.body);
    new MutationObserver(function (muts) {
      for (var a = 0; a < muts.length; a++) {
        var mu = muts[a];
        if (mu.type === "characterData") swapText(mu.target);
        else for (var b = 0; b < mu.addedNodes.length; b++) scan(mu.addedNodes[b]);
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start);
})();
