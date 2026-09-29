(function () {
  'use strict';

  var POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];
  var SLOTS_PER_POSITION = 2;
  var TOTAL = POSITIONS.length * SLOTS_PER_POSITION;
  var STORAGE_KEY = 'guess-my-ten:roster';
  var MAX_RESULTS = 40;

  // window.NBA_PLAYERS rows are [nba id, full name, active (1/0)]
  var players = (window.NBA_PLAYERS || []).map(function (p) {
    return { id: p[0], name: p[1], active: p[2] === 1, key: normalize(p[1]) };
  });
  var byId = {};
  players.forEach(function (p) { byId[p.id] = p; });

  var roster = load();
  var activeSlot = null;

  var $roster = document.getElementById('roster');
  var $count = document.getElementById('count');
  var $picker = document.getElementById('picker');
  var $pickerSlot = document.getElementById('picker-slot');
  var $search = document.getElementById('search');
  var $activeOnly = document.getElementById('active-only');
  var $results = document.getElementById('results');

  function normalize(s) {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[.'’]/g, '').toLowerCase();
  }

  function slotId(pos, i) { return pos + '-' + i; }

  function load() {
    try {
      var saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      return saved && typeof saved === 'object' ? saved : {};
    } catch (e) {
      return {};
    }
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(roster)); } catch (e) { /* storage unavailable */ }
  }

  function headshot(id) {
    return 'https://cdn.nba.com/headshots/nba/latest/260x190/' + id + '.png';
  }

  function initials(name) {
    return name.split(/\s+/).map(function (w) { return w[0]; }).join('').slice(0, 3).toUpperCase();
  }

  function avatar(player, className) {
    var wrap = document.createElement('div');
    wrap.className = className;
    wrap.textContent = initials(player.name);
    var img = new Image();
    img.alt = '';
    img.loading = 'lazy';
    img.onload = function () { wrap.textContent = ''; wrap.appendChild(img); };
    img.src = headshot(player.id);
    return wrap;
  }

  function render() {
    $roster.innerHTML = '';
    var filled = 0;

    POSITIONS.forEach(function (pos) {
      var row = document.createElement('section');
      row.className = 'pos-row';

      var label = document.createElement('div');
      label.className = 'pos-label';
      label.textContent = pos;
      row.appendChild(label);

      for (var i = 0; i < SLOTS_PER_POSITION; i++) {
        var id = slotId(pos, i);
        var player = byId[roster[id]];
        if (player) filled++;
        row.appendChild(player ? filledSlot(id, player) : emptySlot(id, pos));
      }
      $roster.appendChild(row);
    });

    $count.textContent = filled + ' / ' + TOTAL;
    $count.classList.toggle('done', filled === TOTAL);
  }

  function emptySlot(id, pos) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'slot empty';
    btn.setAttribute('aria-label', 'Add ' + pos);
    btn.innerHTML = '<span class="plus">+</span>';
    btn.addEventListener('click', function () { openPicker(id); });
    return btn;
  }

  function filledSlot(id, player) {
    var card = document.createElement('div');
    card.className = 'slot filled';

    var pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'slot-body';
    pick.title = 'Change player';
    pick.appendChild(avatar(player, 'slot-img'));
    var name = document.createElement('div');
    name.className = 'slot-name';
    name.textContent = player.name;
    pick.appendChild(name);
    pick.addEventListener('click', function () { openPicker(id); });

    var remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove';
    remove.setAttribute('aria-label', 'Remove ' + player.name);
    remove.textContent = '✕';
    remove.addEventListener('click', function () {
      delete roster[id];
      save();
      render();
    });

    card.appendChild(pick);
    card.appendChild(remove);
    return card;
  }

  function openPicker(id) {
    activeSlot = id;
    var parts = id.split('-');
    $pickerSlot.textContent = parts[0] + (Number(parts[1]) === 0 ? ' · Starter' : ' · Bench');
    $search.value = '';
    renderResults();
    $picker.showModal();
    $search.focus();
  }

  function search(query) {
    var tokens = normalize(query).split(/\s+/).filter(Boolean);
    var activeOnly = $activeOnly.checked;
    var out = [];
    for (var i = 0; i < players.length; i++) {
      var p = players[i];
      if (activeOnly && !p.active) continue;
      if (tokens.every(function (t) { return p.key.indexOf(t) !== -1; })) out.push(p);
    }
    if (!tokens.length) return out.filter(function (p) { return p.active; }).slice(0, MAX_RESULTS);

    var q = tokens.join(' ');
    function score(p) {
      var s = 0;
      if (p.key === q) s += 100;
      if (p.key.indexOf(q) === 0) s += 40;
      if (p.key.split(' ').some(function (w) { return w.indexOf(tokens[0]) === 0; })) s += 20;
      if (p.active) s += 30;
      return s;
    }
    out.sort(function (a, b) { return score(b) - score(a) || a.name.localeCompare(b.name); });
    return out.slice(0, MAX_RESULTS);
  }

  function renderResults() {
    var list = search($search.value);
    var taken = {};
    Object.keys(roster).forEach(function (k) { if (k !== activeSlot) taken[roster[k]] = true; });

    $results.innerHTML = '';
    if (!list.length) {
      var none = document.createElement('li');
      none.className = 'no-results';
      none.textContent = 'No players found';
      $results.appendChild(none);
      return;
    }

    list.forEach(function (p) {
      var li = document.createElement('li');
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'result';
      btn.disabled = !!taken[p.id];
      btn.appendChild(avatar(p, 'result-img'));

      var text = document.createElement('div');
      text.className = 'result-text';
      var name = document.createElement('div');
      name.className = 'result-name';
      name.textContent = p.name;
      var meta = document.createElement('div');
      meta.className = 'result-meta';
      meta.textContent = taken[p.id] ? 'Already on your team' : (p.active ? 'Current' : 'Former');
      text.appendChild(name);
      text.appendChild(meta);
      btn.appendChild(text);

      btn.addEventListener('click', function () {
        roster[activeSlot] = p.id;
        save();
        render();
        $picker.close();
      });
      li.appendChild(btn);
      $results.appendChild(li);
    });
  }

  $search.addEventListener('input', renderResults);
  $activeOnly.addEventListener('change', renderResults);
  $search.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    var first = $results.querySelector('.result:not([disabled])');
    if (first) first.click();
  });
  // Close when tapping the backdrop
  $picker.addEventListener('click', function (e) { if (e.target === $picker) $picker.close(); });
  $picker.addEventListener('close', function () { activeSlot = null; });

  document.getElementById('reset').addEventListener('click', function () {
    if (!Object.keys(roster).length || !confirm('Clear all 10 slots?')) return;
    roster = {};
    save();
    render();
  });

  render();
})();
