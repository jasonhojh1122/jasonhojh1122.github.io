/* steam.js — the Steam page. Reads data/library.json, hangs every game on the
   board as a print, and keeps the tools, the counts, the address bar and the
   lightbox in step with one another. The wall behind the sheet drifts up
   slowly as the page scrolls, as on Works. Nothing else. */

(function () {
  'use strict';

  var root = document.documentElement;
  root.classList.remove('no-js');
  root.classList.add('js');

  var still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* --- the wall ------------------------------------------------------ */
  /* The frame is taller than the window by --drift (works.css). It slides
     up by exactly that much between the top and the bottom of the page. */

  (function () {
    var frame = document.querySelector('.ground .frame');
    if (!frame || still) return;

    var travel = 0, range = 1, ticking = false;

    function measure() {
      travel = frame.offsetHeight - window.innerHeight;
      range  = Math.max(1, root.scrollHeight - window.innerHeight);
      place();
    }
    function place() {
      ticking = false;
      var y = Math.min(1, Math.max(0, window.scrollY / range));
      frame.style.transform = 'translate3d(0,' + (-y * travel).toFixed(1) + 'px,0)';
    }
    window.addEventListener('scroll', function () {
      if (!ticking) { ticking = true; requestAnimationFrame(place); }
    }, { passive: true });
    window.addEventListener('resize', measure);
    /* The body is held to the window's height (base.css), so it is the
       sheet that grows with the content, and the sheet that is watched. */
    if (window.ResizeObserver) new ResizeObserver(measure).observe(document.querySelector('.sheet') || document.body);
    measure();
  })();

  /* --- pieces of the page ---------------------------------------------- */

  function $(id) { return document.getElementById(id); }

  var shelf   = $('shelf');
  var empty   = $('empty');
  var counts  = $('counts');
  var showing = $('showing');
  var find    = $('find');
  var clear   = $('clear');
  var toggle  = $('counts-toggle');
  var picks   = Array.prototype.slice.call(document.querySelectorAll('.pick'));
  var lists   = {};
  Array.prototype.forEach.call(document.querySelectorAll('[data-list]'), function (el) { lists[el.dataset.list] = el; });
  var bars    = {};
  Array.prototype.forEach.call(document.querySelectorAll('[data-count]'), function (el) { bars[el.dataset.count] = el; });

  /* --- words and numbers ------------------------------------------------ */

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var FAVORITE = 'Favorite';   /* stands among the tags, though it is not one */

  function num(n) { return n.toLocaleString('en-US'); }

  /* "17 h"; a little more exactly under ten hours */
  function hours(minutes) {
    if (!minutes) return '0 h';
    var h = minutes / 60;
    return (h < 10 ? h.toFixed(1) : num(Math.round(h))) + ' h';
  }
  function longHours(minutes) {
    if (!minutes) return 'never';
    var h = minutes / 60;
    if (h < 1) return minutes + ' min';
    return (h < 10 ? h.toFixed(1) : num(Math.round(h))) + ' hours';
  }

  /* dates in the site's order: 2004 Nov 16 */
  function ymd(d) { return d.getFullYear() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getDate(); }
  function whenPlayed(unix) { return unix ? ymd(new Date(unix * 1000)) : 'never'; }
  /* Steam writes "16 Nov, 2004"; anything else stays as written ("To be announced") */
  function released(s) {
    if (!s) return 'not known';
    var m = String(s).match(/(\d{1,2})\s+(\w{3}),?\s+(\d{4})/);
    if (!m) return s;
    return m[3] + ' ' + m[2] + ' ' + Number(m[1]);
  }
  function releaseTime(s) {
    var m = String(s || '').match(/(\d{1,2})\s+(\w{3}),?\s+(\d{4})/);
    if (!m) return 0;
    var d = new Date(Number(m[3]), Math.max(0, MONTHS.indexOf(m[2])), Number(m[1]));
    return d.getTime();
  }

  /* the store writes its descriptions with entities in them */
  var decoder = document.createElement('textarea');
  function plain(s) { decoder.innerHTML = s || ''; return decoder.value; }

  /* --- the playtime stretches -------------------------------------------- */

  var STRETCHES = [
    { key: '0h',      label: 'Never played',  test: function (h) { return h === 0; } },
    { key: '<1h',     label: 'Under 1 h',     test: function (h) { return h > 0 && h < 1; } },
    { key: '1-10h',   label: '1 to 10 h',     test: function (h) { return h >= 1 && h < 10; } },
    { key: '10-50h',  label: '10 to 50 h',    test: function (h) { return h >= 10 && h < 50; } },
    { key: '50-100h', label: '50 to 100 h',   test: function (h) { return h >= 50 && h < 100; } },
    { key: '100h+',   label: '100 h and more', test: function (h) { return h >= 100; } }
  ];
  function stretchOf(g) {
    var h = g.playtimeForever / 60;
    for (var i = 0; i < STRETCHES.length; i++) if (STRETCHES[i].test(h)) return STRETCHES[i].key;
    return null;
  }

  var SORTS = [
    { key: 'last-played',    label: 'Last played',     by: function (a, b) { return b.lastPlayed - a.lastPlayed; } },
    { key: 'playtime-desc',  label: 'Most played',     by: function (a, b) { return b.playtimeForever - a.playtimeForever; } },
    { key: 'playtime-asc',   label: 'Least played',    by: function (a, b) { return a.playtimeForever - b.playtimeForever; } },
    { key: 'name-asc',       label: 'Name, A to Z',    by: function (a, b) { return a.name.localeCompare(b.name); } },
    { key: 'name-desc',      label: 'Name, Z to A',    by: function (a, b) { return b.name.localeCompare(a.name); } },
    { key: 'release-newest', label: 'Newest release',  by: function (a, b) { return releaseTime(b.releaseDate) - releaseTime(a.releaseDate); } },
    { key: 'release-oldest', label: 'Oldest release',  by: function (a, b) { return releaseTime(a.releaseDate) - releaseTime(b.releaseDate); } },
    { key: 'achievements',   label: 'Achievements',    by: function (a, b) { return share(b) - share(a); } }
  ];
  function share(g) { return g.achievements && g.achievements.total ? g.achievements.unlocked / g.achievements.total : 0; }
  function sortNamed(key) {
    for (var i = 0; i < SORTS.length; i++) if (SORTS[i].key === key) return SORTS[i];
    return SORTS[0];
  }

  /* --- state --------------------------------------------------------------- */

  var state = { q: '', genres: [], tags: [], playtime: [], sort: 'last-played', counts: false };
  var games = [], filtered = [], tiles = {};
  var genreCount = {}, tagCount = {}, stretchCount = {};

  function readURL() {
    var p = new URLSearchParams(window.location.search);
    state.q        = p.get('q') || '';
    state.sort     = p.get('sort') || 'last-played';
    state.genres   = (p.get('genres') || '').split(',').filter(Boolean);
    state.tags     = (p.get('tags') || '').split(',').filter(Boolean);
    state.playtime = (p.get('playtime') || '').split(',').filter(Boolean);
    state.counts   = p.get('counts') === '1' || p.get('charts') === '1';
  }
  function writeURL() {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.sort !== 'last-played') p.set('sort', state.sort);
    if (state.genres.length) p.set('genres', state.genres.join(','));
    if (state.tags.length) p.set('tags', state.tags.join(','));
    if (state.playtime.length) p.set('playtime', state.playtime.join(','));
    if (state.counts) p.set('counts', '1');
    var qs = p.toString();
    history.replaceState(null, '', qs ? '?' + qs : window.location.pathname);
  }
  function filtering() { return !!(state.q || state.genres.length || state.tags.length || state.playtime.length); }

  function toggleIn(list, value) {
    var i = list.indexOf(value);
    if (i >= 0) list.splice(i, 1); else list.push(value);
  }

  /* --- loading ----------------------------------------------------------- */

  readURL();
  find.value = state.q;

  fetch('./data/library.json')
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (data) {
      games = data.games || [];
      tally();
      profile(data.meta || {});
      buildTiles();
      buildPickers();
      buildCounts();
      update();
    })
    .catch(function () {
      $('summary').textContent = 'The library could not be loaded. Try again in a moment.';
    });

  function tally() {
    games.forEach(function (g) {
      (g.genres || []).forEach(function (x) { genreCount[x] = (genreCount[x] || 0) + 1; });
      (g.tags || []).forEach(function (x) { tagCount[x] = (tagCount[x] || 0) + 1; });
      var s = stretchOf(g);
      if (s) stretchCount[s] = (stretchCount[s] || 0) + 1;
    });
    var favs = games.filter(function (g) { return g.favorite; }).length;
    if (favs) tagCount[FAVORITE] = favs;
  }

  /* --- the notice ---------------------------------------------------------- */

  function profile(meta) {
    var p = meta.profile || {};
    var pic = $('avatar').querySelector('img');
    if (p.personaName) $('persona').textContent = p.personaName + "'s library";
    if (p.avatarUrl) { pic.src = p.avatarUrl; pic.alt = p.personaName || ''; }
    if (p.level && p.xpNeededToLevelUp != null) {
      var xp = $('xp'), need = p.xp + p.xpNeededToLevelUp;
      $('level').textContent = 'Level ' + num(p.level);
      xp.querySelector('.fill').style.setProperty('--w', (need ? 100 * p.xp / need : 0).toFixed(1) + '%');
      xp.querySelector('.tally').textContent = num(p.xp) + ' of ' + num(need) + ' XP';
      xp.hidden = false;
    }

    var played = 0, minutes = 0, got = 0, all = 0;
    games.forEach(function (g) {
      if (g.playtimeForever > 0) played++;
      minutes += g.playtimeForever || 0;
      if (g.achievements) { got += g.achievements.unlocked; all += g.achievements.total; }
    });
    var stat = {};
    Array.prototype.forEach.call(document.querySelectorAll('[data-stat]'), function (e) { stat[e.dataset.stat] = e; });
    stat.games.textContent  = num(games.length);
    stat.hours.textContent  = num(Math.round(minutes / 60)) + ' h';
    stat.played.textContent = num(played) + ' / ' + num(games.length - played);
    stat.ach.textContent    = all ? Math.round(100 * got / all) + '%' : 'none';
    $('stats').hidden = false;
    $('summary').hidden = true;
  }

  /* --- the prints ---------------------------------------------------------- */
  /* Every game gets its print once; updating the board only rearranges them,
     so a picture that has loaded stays loaded. */

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function buildTiles() {
    games.forEach(function (g) {
      var li = el('li', 'tile');
      var a = el('a', 'print' + (g.favorite ? ' is-fav' : ''));
      a.href = 'https://store.steampowered.com/app/' + g.appid + '/';
      a.dataset.appid = g.appid;

      var pic = el('span', 'pic');
      if (g.headerImage) {
        var img = el('img');
        img.src = g.headerImage;
        img.alt = '';
        img.width = 460; img.height = 215;
        img.loading = 'lazy';
        img.decoding = 'async';
        pic.appendChild(img);
      } else {
        pic.classList.add('is-void');
        pic.appendChild(el('span', null, g.name));
      }

      /* the label band: name, whether it is being played, the hours */
      var label = el('span', 'label');
      label.appendChild(el('span', 'what', g.name));
      if (g.playtime2Weeks > 0) label.appendChild(el('span', 'status', 'Playing'));
      label.appendChild(el('span', 'hrs', hours(g.playtimeForever)));

      /* the slip under it, as on the old card: who made it, when it came
         out, when it was last played, what it is, and the achievements */
      var slip = el('span', 'slip');
      slip.appendChild(fact('By', g.developer || 'not known'));
      slip.appendChild(fact('Released', released(g.releaseDate)));
      slip.appendChild(fact('Last played', whenPlayed(g.lastPlayed)));
      slip.appendChild(fact('Genres', (g.genres || []).slice(0, 3).join(', ') || 'none'));
      slip.appendChild(fact('Tags', (g.tags || []).slice(0, 3).join(', ') || 'none'));
      var ach = el('span', 'row ach');
      if (g.achievements && g.achievements.total) {
        var m = el('span', 'meter'), f = el('span', 'fill');
        f.style.setProperty('--w', (100 * g.achievements.unlocked / g.achievements.total).toFixed(1) + '%');
        m.appendChild(f);
        ach.appendChild(m);
        ach.appendChild(el('span', 'tally', num(g.achievements.unlocked) + ' of ' + num(g.achievements.total)));
      } else {
        ach.appendChild(el('span', 'k', 'No achievements'));
      }
      slip.appendChild(ach);

      a.appendChild(pic);
      a.appendChild(label);
      a.appendChild(slip);
      a.appendChild(el('span', 'shade'));
      a.title = g.name;
      li.appendChild(a);
      tiles[g.appid] = li;
    });
  }

  /* one line of the note: a small key on the left, the value on the right */
  function fact(key, value) {
    var r = el('span', 'row');
    r.appendChild(el('span', 'k', key));
    r.appendChild(el('span', 'v', value));
    return r;
  }

  /* --- the pickers ----------------------------------------------------------- */

  function row(kind, name, value, label, count, checked) {
    var l = el('label');
    var input = el('input');
    input.type = kind;
    input.name = name;
    input.value = value;
    input.checked = checked;
    l.appendChild(input);
    l.appendChild(el('span', null, label));
    if (count != null) l.appendChild(el('span', 'n', num(count)));
    return l;
  }

  function buildPickers() {
    fillGenres('');
    fillTags('');

    lists.playtime.replaceChildren.apply(lists.playtime, STRETCHES.map(function (s) {
      return row('checkbox', 'playtime', s.key, s.label, stretchCount[s.key] || 0, state.playtime.indexOf(s.key) >= 0);
    }));

    lists.sort.replaceChildren.apply(lists.sort, SORTS.map(function (s) {
      return row('radio', 'sort', s.key, s.label, null, state.sort === s.key);
    }));
  }

  /* the genres, in alphabetical order; the little search in the pane
     narrows them */
  function fillGenres(sift) {
    var needle = sift.trim().toLowerCase();
    var rows = Object.keys(genreCount).sort()
      .filter(function (x) { return !needle || x.toLowerCase().indexOf(needle) >= 0; })
      .map(function (x) { return row('checkbox', 'genres', x, x, genreCount[x], state.genres.indexOf(x) >= 0); });
    if (!rows.length) rows.push(el('div', 'none', 'No genre is called that.'));
    lists.genres.replaceChildren.apply(lists.genres, rows);
  }

  /* the tags, most common first, with Favorite at the head; the same
     little search narrows them */
  function fillTags(sift) {
    var needle = sift.trim().toLowerCase();
    var tags = Object.keys(tagCount).filter(function (t) { return t !== FAVORITE; })
      .sort(function (a, b) { return tagCount[b] - tagCount[a] || a.localeCompare(b); });
    if (tagCount[FAVORITE]) tags.unshift(FAVORITE);
    var rows = tags.filter(function (t) { return !needle || t.toLowerCase().indexOf(needle) >= 0; })
      .map(function (t) { return row('checkbox', 'tags', t, t, tagCount[t], state.tags.indexOf(t) >= 0); });
    if (!rows.length) rows.push(el('div', 'none', 'No tag is called that.'));
    lists.tags.replaceChildren.apply(lists.tags, rows);
  }

  /* what each button says: its name, and how many are chosen */
  function labelPickers() {
    $('pick-genres').querySelector('summary').textContent   = 'Genres'   + (state.genres.length   ? ' (' + state.genres.length   + ')' : '');
    $('pick-tags').querySelector('summary').textContent     = 'Tags'     + (state.tags.length     ? ' (' + state.tags.length     + ')' : '');
    $('pick-playtime').querySelector('summary').textContent = 'Playtime' + (state.playtime.length ? ' (' + state.playtime.length + ')' : '');
    $('pick-sort').querySelector('summary').textContent     = 'Sort: ' + sortNamed(state.sort).label;
  }

  /* a pane keeps inside the window: if it would run off the right edge it
     hangs from its button's right corner instead */
  function placePane(pick) {
    var pane = pick.querySelector('.pane');
    pane.classList.remove('is-right');
    if (pane.getBoundingClientRect().right > window.innerWidth - 8) pane.classList.add('is-right');
  }

  picks.forEach(function (pick) {
    pick.addEventListener('toggle', function () {
      if (!pick.open) return;
      picks.forEach(function (o) { if (o !== pick) o.open = false; });
      placePane(pick);
      var sift = pick.querySelector('.sift');
      if (sift && window.matchMedia('(hover: hover)').matches) sift.focus();
    });
  });
  document.addEventListener('click', function (e) {
    picks.forEach(function (pick) { if (pick.open && !pick.contains(e.target)) pick.open = false; });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var open = picks.filter(function (p) { return p.open; });
    if (!open.length) return;
    open.forEach(function (p) { p.open = false; });
    open[0].querySelector('summary').focus();
  });

  /* --- the tools speaking to the state ------------------------------------------ */

  var typing;
  find.addEventListener('input', function () {
    clearTimeout(typing);
    typing = setTimeout(function () { state.q = find.value.trim(); update(); }, 120);
  });
  $('tools').addEventListener('submit', function (e) { e.preventDefault(); });

  document.addEventListener('change', function (e) {
    var input = e.target;
    if (!input.matches('.rows input')) return;
    if (input.name === 'sort') { state.sort = input.value; $('pick-sort').open = false; }
    else if (input.name in state) toggleIn(state[input.name], input.value);
    update();
  });

  lists.genres.parentNode.querySelector('.sift').addEventListener('input', function (e) { fillGenres(e.target.value); });
  lists.tags.parentNode.querySelector('.sift').addEventListener('input', function (e) { fillTags(e.target.value); });

  function clearAll() {
    state.q = ''; find.value = '';
    state.genres = []; state.tags = []; state.playtime = [];
    update();
    find.focus();
  }
  clear.addEventListener('click', clearAll);
  empty.querySelector('[data-clear]').addEventListener('click', clearAll);

  toggle.addEventListener('click', function () {
    state.counts = !state.counts;
    update();
  });

  /* --- the counts ----------------------------------------------------------------- */

  function topOf(countMap, n) {
    return Object.keys(countMap).sort(function (a, b) { return countMap[b] - countMap[a] || a.localeCompare(b); }).slice(0, n);
  }

  function bar(name, label, value, count, most) {
    var li = el('li');
    var b = el('button');
    b.type = 'button';
    b.dataset.name = name;
    b.dataset.value = value;
    b.appendChild(el('span', 'lab', label));
    var track = el('span', 'track');   /* not .bar: base.css uses that for a phone's bars */
    track.style.setProperty('--w', (100 * count / most).toFixed(1) + '%');
    b.appendChild(track);
    b.appendChild(el('span', 'n', num(count)));
    li.appendChild(b);
    return li;
  }

  function buildCounts() {
    var genres = topOf(genreCount, 15), most = genres.length ? genreCount[genres[0]] : 1;
    bars.genres.replaceChildren.apply(bars.genres, genres.map(function (x) { return bar('genres', x, x, genreCount[x], most); }));

    var plainTags = {};
    Object.keys(tagCount).forEach(function (t) { if (t !== FAVORITE) plainTags[t] = tagCount[t]; });
    var tags = topOf(plainTags, 15); most = tags.length ? plainTags[tags[0]] : 1;
    bars.tags.replaceChildren.apply(bars.tags, tags.map(function (x) { return bar('tags', x, x, plainTags[x], most); }));

    most = Math.max.apply(null, STRETCHES.map(function (s) { return stretchCount[s.key] || 0; }).concat([1]));
    bars.playtime.replaceChildren.apply(bars.playtime, STRETCHES.map(function (s) { return bar('playtime', s.key, s.label, stretchCount[s.key] || 0, most); }));
  }

  counts.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-name]');
    if (!b) return;
    toggleIn(state[b.dataset.name], b.dataset.value);
    update();
  });

  function markCounts() {
    Object.keys(bars).forEach(function (name) {
      var chosen = state[name];
      bars[name].classList.toggle('has-pick', chosen.length > 0);
      Array.prototype.forEach.call(bars[name].querySelectorAll('button'), function (b) {
        b.setAttribute('aria-pressed', chosen.indexOf(b.dataset.value) >= 0 ? 'true' : 'false');
      });
    });
  }

  /* --- drawing the board ------------------------------------------------------------ */

  function matches(g) {
    if (state.q) {
      var q = state.q.toLowerCase();
      var hay = [g.name, g.developer, g.shortDescription, g.releaseDate].concat(g.genres || [], g.tags || []);
      if (!hay.some(function (s) { return s && String(s).toLowerCase().indexOf(q) >= 0; })) return false;
    }
    if (state.genres.length && !state.genres.some(function (x) { return (g.genres || []).indexOf(x) >= 0; })) return false;
    if (state.tags.length && !state.tags.some(function (x) { return x === FAVORITE ? g.favorite : (g.tags || []).indexOf(x) >= 0; })) return false;
    if (state.playtime.length && state.playtime.indexOf(stretchOf(g)) < 0) return false;
    return true;
  }

  function update() {
    filtered = games.filter(matches).sort(sortNamed(state.sort).by);

    shelf.replaceChildren.apply(shelf, filtered.map(function (g) { return tiles[g.appid]; }));
    empty.hidden = filtered.length > 0 || !games.length;

    showing.textContent = filtering()
      ? num(filtered.length) + ' of ' + num(games.length)
      : num(games.length) + ' games';
    clear.hidden = !filtering();

    counts.hidden = !state.counts;
    toggle.setAttribute('aria-expanded', state.counts ? 'true' : 'false');
    markCounts();

    /* the pickers reflect the state, whichever tool changed it */
    Array.prototype.forEach.call(document.querySelectorAll('.rows input'), function (input) {
      input.checked = input.name === 'sort' ? state.sort === input.value : state[input.name].indexOf(input.value) >= 0;
    });
    labelPickers();
    writeURL();
  }

  /* --- the lift ------------------------------------------------------------------------ */
  /* Pointing at a print lifts it off the wall and tilts it after the pointer,
     the edge nearest the pointer coming forward. It throws a shadow, and the
     prints beside it darken along the edge that its raised side leans over.
     On touch, holding a print for a moment does the same until it is let go. */

  (function () {
    if (still) return;
    var MAX = 12;                    /* degrees of tilt at a print's edge */
    var lifted = null, shaded = [];

    function columns() { return getComputedStyle(shelf).gridTemplateColumns.split(' ').length; }

    function lift(print, x, y) {
      var r = print.getBoundingClientRect();
      var px = (x - r.left) / r.width, py = (y - r.top) / r.height;
      var ry = (px - 0.5) * 2 * MAX;   /* right of centre: the right edge goes back */
      var rx = (0.5 - py) * 2 * MAX;   /* above centre: the top edge goes back */
      if (lifted !== print) {
        drop();
        lifted = print;
        print.classList.add('is-lifted');
        print.parentNode.classList.add('is-lifted');
      }
      print.style.transform = 'translateY(-4px) scale(1.04) rotateX(' + rx.toFixed(2) + 'deg) rotateY(' + ry.toFixed(2) + 'deg)';
      cast(print, rx, ry);
    }

    /* the neighbours: the raised edge of the print leans over the print on
       that side, so that one darkens along the edge they share */
    function cast(print, rx, ry) {
      var tiles = Array.prototype.slice.call(shelf.children);
      var i = tiles.indexOf(print.parentNode), n = columns();
      var falls = [
        { on: i % n > 0 ? tiles[i - 1] : null,                   edge: 'right',  weight: ry > 0 ? ry / MAX : 0 },
        { on: i % n < n - 1 ? tiles[i + 1] : null,               edge: 'left',   weight: ry < 0 ? -ry / MAX : 0 },
        { on: i - n >= 0 ? tiles[i - n] : null,                  edge: 'bottom', weight: rx < 0 ? -rx / MAX : 0 },
        { on: i + n < tiles.length ? tiles[i + n] : null,        edge: 'top',    weight: rx > 0 ? rx / MAX : 0 }
      ];
      var now = [];
      falls.forEach(function (f) {
        if (!f.on) return;
        var shade = f.on.querySelector('.shade');
        if (!shade) return;
        if (f.weight < 0.05) { shade.style.opacity = '0'; return; }
        shade.className = 'shade from-' + f.edge;
        shade.style.opacity = Math.min(1, f.weight).toFixed(2);
        now.push(shade);
      });
      shaded.forEach(function (sh) { if (now.indexOf(sh) < 0) sh.style.opacity = '0'; });
      shaded = now;
    }

    function drop() {
      if (!lifted) return;
      lifted.style.transform = '';
      lifted.classList.remove('is-lifted');
      lifted.parentNode.classList.remove('is-lifted');
      lifted = null;
      shaded.forEach(function (sh) { sh.style.opacity = '0'; });
      shaded = [];
    }

    if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
      shelf.addEventListener('mousemove', function (e) {
        var print = e.target.closest('.print');
        if (print) lift(print, e.clientX, e.clientY); else drop();
      });
      shelf.addEventListener('mouseleave', drop);
    }

    /* touch: a short hold starts the tilt; a finger that moves on before
       then is scrolling, and is left alone */
    var hold = null, held = null, sx = 0, sy = 0;
    shelf.addEventListener('touchstart', function (e) {
      var print = e.target.closest('.print');
      if (!print) return;
      var t = e.touches[0];
      sx = t.clientX; sy = t.clientY; held = null;
      clearTimeout(hold);
      hold = setTimeout(function () { held = print; lift(print, t.clientX, t.clientY); }, 200);
    }, { passive: true });
    shelf.addEventListener('touchmove', function (e) {
      var t = e.touches[0];
      if (!held) {
        if (Math.abs(t.clientX - sx) > 10 || Math.abs(t.clientY - sy) > 10) clearTimeout(hold);
        return;
      }
      e.preventDefault();
      lift(held, t.clientX, t.clientY);
    }, { passive: false });
    function letGo() { clearTimeout(hold); held = null; drop(); }
    shelf.addEventListener('touchend', letGo);
    shelf.addEventListener('touchcancel', letGo);
  })();

  /* --- back to the top ---------------------------------------------------------------- */

  var totop = $('totop'), farDown = false;
  window.addEventListener('scroll', function () {
    var far = window.scrollY > window.innerHeight * 1.5;
    if (far !== farDown) { farDown = far; totop.hidden = !far; }
  }, { passive: true });
  totop.addEventListener('click', function () {
    window.scrollTo({ top: 0, behavior: still ? 'auto' : 'smooth' });
    find.focus({ preventScroll: true });
  });

  /* --- lightbox: one game with its note on the mat -------------------------------------- */

  var light = $('light');
  if (!light || typeof light.showModal !== 'function') return;

  var field = {};
  Array.prototype.forEach.call(light.querySelectorAll('[data-field]'), function (e) { field[e.dataset.field] = e; });
  var at = 0, opener = null;

  function show(i) {
    at = (i + filtered.length) % filtered.length;
    var g = filtered[at];

    var img = field.name.closest('.light-fig').querySelector('img');
    img.classList.toggle('is-void', !g.headerImage);
    if (g.headerImage) img.src = g.headerImage; else img.removeAttribute('src');
    img.alt = '';

    field.name.textContent = g.name;
    field.favorite.hidden = !g.favorite;
    field.playing.hidden = !(g.playtime2Weeks > 0);
    field.developer.textContent = g.developer || '';
    field.developer.hidden = !g.developer;

    field.released.textContent = released(g.releaseDate);
    field.lastPlayed.textContent = whenPlayed(g.lastPlayed);
    field.played.textContent = longHours(g.playtimeForever);
    hideRow(field.recent, !(g.playtime2Weeks > 0));
    field.recent.textContent = longHours(g.playtime2Weeks);

    var a = g.achievements;
    hideRow(field.achievements, !a || !a.total);
    if (a && a.total) {
      field.achievements.querySelector('.fill').style.setProperty('--w', (100 * a.unlocked / a.total).toFixed(1) + '%');
      field.achievements.querySelector('.tally').textContent = num(a.unlocked) + ' of ' + num(a.total);
    }

    field.description.textContent = plain(g.shortDescription);
    chips(field.genres, 'genres', g.genres || []);
    chips(field.tags, 'tags', g.tags || []);
    field.store.href = 'https://store.steampowered.com/app/' + g.appid + '/';

    light.querySelector('.light-fig').scrollTop = 0;
    if (!light.open) light.showModal();
  }
  /* a fact and its label go together */
  function hideRow(dd, hide) { dd.hidden = hide; dd.previousElementSibling.hidden = hide; }

  /* the genres and the tags, each a small ruled chip; pressing one narrows
     the board to it, and one already chosen is shown inked */
  function chips(section, name, values) {
    section.hidden = !values.length;
    var box = section.querySelector('.links');
    box.replaceChildren.apply(box, values.map(function (v) {
      var b = el('button', null, v);
      b.type = 'button';
      b.dataset.name = name;
      b.dataset.value = v;
      b.setAttribute('aria-pressed', state[name].indexOf(v) >= 0 ? 'true' : 'false');
      return b;
    }));
  }
  light.addEventListener('click', function (e) {
    var b = e.target.closest('.chips button');
    if (!b) return;
    toggleIn(state[b.dataset.name], b.dataset.value);
    b.setAttribute('aria-pressed', state[b.dataset.name].indexOf(b.dataset.value) >= 0 ? 'true' : 'false');
    update();
  });

  shelf.addEventListener('click', function (e) {
    var a = e.target.closest('.print');
    if (!a) return;
    e.preventDefault();
    opener = a;
    var id = Number(a.dataset.appid);
    for (var i = 0; i < filtered.length; i++) if (filtered[i].appid === id) { show(i); break; }
  });

  light.addEventListener('click', function (e) {
    var step = e.target.closest('[data-step]');
    if (step) { show(at + Number(step.dataset.step)); return; }
    if (e.target.closest('[data-close]') || e.target === light) light.close();
  });
  light.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight') show(at + 1);
    if (e.key === 'ArrowLeft')  show(at - 1);
  });
  light.addEventListener('close', function () {
    if (opener) opener.focus({ preventScroll: false });
  });
})();
