(function () {
  'use strict';

  var POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];
  var STORAGE_KEY = 'blind-bid:game';
  var PLAYERS = window.PLAYERS || [];

  var $app = document.getElementById('app');
  var $quit = document.getElementById('quit');
  var $toast = document.getElementById('toast');

  var state = load() || setupState(['Player 1', 'Player 2'], 20);
  var bidAmount = 1; // the bid stepper's value; not saved
  var lastCardShown = null;
  var toastTimer = null;

  // ---------- helpers ----------

  function setupState(names, budget) {
    return { phase: 'setup', names: names, budget: budget };
  }

  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return s && s.phase ? s : null;
    } catch (e) {
      return null;
    }
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* storage unavailable */ }
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function pick(list) { return list[Math.floor(Math.random() * list.length)]; }

  function shuffle(list) {
    for (var i = list.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = list[i]; list[i] = list[j]; list[j] = tmp;
    }
    return list;
  }

  function toast(msg) {
    $toast.textContent = msg;
    $toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { $toast.classList.remove('show'); }, 2600);
  }

  function initials(name) {
    return name.split(/\s+/).map(function (w) { return w[0]; }).join('').slice(0, 3).toUpperCase();
  }

  function headshot(p) {
    return '<div class="face"><span>' + esc(initials(p.name)) + '</span>' +
      '<img src="https://cdn.nba.com/headshots/nba/latest/260x190/' + p.id + '.png" alt="" onerror="this.remove()"></div>';
  }

  function score(p) { return p.ppg + p.rpg + p.apg; }

  // ---------- rules ----------

  function openSlots(t) {
    var slots = state.teams[t].slots;
    return POSITIONS.filter(function (pos) { return !slots[pos]; });
  }

  function isFull(t) { return openSlots(t).length === 0; }

  // Every open slot needs at least $1, so you can't spend money reserved for the rest of your team.
  function maxBid(t) { return state.teams[t].money - (openSlots(t).length - 1); }

  function makeHint(p) {
    var types = ['jersey', 'fact', 'stat'];
    if (p.high) types.push('high');
    var type = pick(types);

    if (type === 'jersey') {
      var nums = p.nums.map(function (n) { return '#' + n; }).join(' · ');
      return { label: p.nums.length > 1 ? 'Jersey numbers' : 'Jersey number', big: nums,
        small: p.nums.length > 1 ? 'wore all of these' : '', short: nums };
    }
    if (type === 'high') {
      return { label: 'Career high', big: String(p.high), small: 'points in one game', short: p.high + '-pt high' };
    }
    if (type === 'stat') {
      var s = pick([['ppg', 'points', 'PPG'], ['rpg', 'rebounds', 'RPG'], ['apg', 'assists', 'APG']]);
      var val = p[s[0]].toFixed(1);
      return { label: 'Career average', big: val, small: s[1] + ' per game', short: val + ' ' + s[2] };
    }
    var fact = pick(p.facts);
    return { label: 'Fact', big: '', small: fact, short: fact };
  }

  function startGame(names, budget) {
    state = {
      phase: 'auction',
      names: names,
      budget: budget,
      teams: names.map(function (name) {
        var slots = {};
        POSITIONS.forEach(function (pos) { slots[pos] = null; });
        return { name: name, money: budget, slots: slots };
      }),
      deck: shuffle(PLAYERS.map(function (_, i) { return i; })),
      skipped: [],
      round: 0,
      card: null,
      won: null,
      revealed: {}
    };
    nextCard();
  }

  function nextCard() {
    if (isFull(0) && isFull(1)) {
      state.phase = 'reveal';
      state.card = null;
      return;
    }
    if (!state.deck.length) {
      state.deck = shuffle(state.skipped.map(function (s) { return s.p; }));
      state.skipped = [];
    }
    var p = state.deck.pop();
    var first = state.round % 2; // who gets asked first alternates every card
    if (isFull(first)) first = 1 - first;
    state.card = { p: p, hint: makeHint(PLAYERS[p]), bid: 0, leader: null, toAct: first, acted: [false, false] };
    state.phase = 'auction';
    bidAmount = 1;
  }

  function bid(amount) {
    var c = state.card;
    var t = c.toAct;
    var other = 1 - t;
    if (amount <= c.bid || amount > maxBid(t)) return;
    c.bid = amount;
    c.leader = t;
    c.acted[t] = true;
    if (isFull(other)) return win(t, '');
    if (maxBid(other) <= c.bid) {
      return win(t, state.teams[other].name + " can't go higher than $" + maxBid(other) + '.');
    }
    c.toAct = other;
    bidAmount = c.bid + 1;
  }

  function pass() {
    var c = state.card;
    var t = c.toAct;
    var other = 1 - t;
    c.acted[t] = true;
    if (c.leader !== null) return win(c.leader, '');
    if (!isFull(other) && !c.acted[other]) {
      c.toAct = other;
      bidAmount = 1;
      return;
    }
    state.skipped.push({ p: c.p, hint: c.hint });
    state.round++;
    toast('Nobody wanted him. Next mystery player!');
    nextCard();
  }

  function win(t, note) {
    var c = state.card;
    state.teams[t].money -= c.bid;
    state.won = { team: t, p: c.p, hint: c.hint, price: c.bid, note: note };
    state.phase = 'place';
    var open = openSlots(t);
    if (open.length === 1) {
      toast('Sold to ' + state.teams[t].name + ' for $' + c.bid + ' → ' + open[0]);
      place(open[0]);
    }
  }

  function place(pos) {
    var w = state.won;
    state.teams[w.team].slots[pos] = { p: w.p, hint: w.hint, price: w.price };
    state.won = null;
    state.round++;
    nextCard();
  }

  // ---------- rendering ----------

  function render() {
    save();
    $quit.hidden = state.phase === 'setup';
    if (state.phase === 'setup') $app.innerHTML = renderSetup();
    else if (state.phase === 'reveal') $app.innerHTML = renderReveal();
    else $app.innerHTML = renderTeams() + renderCard() + (state.phase === 'place' ? renderPlace() : renderAuction());
  }

  function renderSetup() {
    return '<section class="panel setup">' +
      '<h2>Blind draft auction</h2>' +
      '<ul class="rules">' +
        '<li>You each get <b>$' + state.budget + '</b> to build a 5-man team: PG, SG, SF, PF, C.</li>' +
        '<li>A mystery player pops up with one hint: a jersey number, a fact, a stat or a career high.</li>' +
        '<li>Take turns bidding. Pass and the other person can take him. Highest bid wins.</li>' +
        '<li>Nobody finds out who they got until both teams are full.</li>' +
      '</ul>' +
      '<label class="field">Player 1<input id="name0" maxlength="16" value="' + esc(state.names[0]) + '"></label>' +
      '<label class="field">Player 2<input id="name1" maxlength="16" value="' + esc(state.names[1]) + '"></label>' +
      '<div class="field">Budget each' +
        '<div class="stepper">' +
          '<button type="button" data-action="budget" data-step="-5" aria-label="Less">−</button>' +
          '<span class="amount">$' + state.budget + '</span>' +
          '<button type="button" data-action="budget" data-step="5" aria-label="More">+</button>' +
        '</div>' +
      '</div>' +
      '<button type="button" class="primary big" data-action="start">Start</button>' +
    '</section>';
  }

  function renderTeams() {
    var acting = state.phase === 'auction' ? state.card.toAct : state.won.team;
    return '<section class="teams">' + state.teams.map(function (team, t) {
      return '<div class="team team-' + t + (t === acting ? ' acting' : '') + '">' +
        '<div class="team-head"><span class="team-name">' + esc(team.name) + '</span>' +
        '<span class="money">$' + team.money + '</span></div>' +
        POSITIONS.map(function (pos) {
          var s = team.slots[pos];
          return '<div class="mini-slot' + (s ? ' filled' : '') + '"><span class="mini-pos">' + pos + '</span>' +
            (s ? '<span class="mini-hint" title="' + esc(s.hint.short) + '">' + esc(s.hint.short) + '</span>' +
                 '<span class="mini-price">$' + s.price + '</span>'
               : '<span class="mini-empty">empty</span>') +
          '</div>';
        }).join('') +
      '</div>';
    }).join('') + '</section>';
  }

  function renderCard() {
    var c = state.phase === 'place' ? state.won : state.card;
    var h = c.hint;
    var isNew = lastCardShown !== state.round;
    lastCardShown = state.round;
    return '<section class="mystery' + (isNew ? ' pop' : '') + '">' +
      '<div class="mystery-top"><span class="chip">' + PLAYERS[c.p].pos + '</span>' +
      '<span class="mystery-no">Mystery player #' + (state.round + 1) + '</span></div>' +
      '<div class="silhouette">?</div>' +
      '<div class="hint-label">' + esc(h.label) + '</div>' +
      (h.big ? '<div class="hint-big">' + esc(h.big) + '</div>' : '') +
      (h.small ? '<div class="hint-small' + (h.big ? '' : ' fact') + '">' + esc(h.small) + '</div>' : '') +
    '</section>';
  }

  function renderAuction() {
    var c = state.card;
    var t = c.toAct;
    var team = state.teams[t];
    var other = state.teams[1 - t];
    var solo = isFull(1 - t);
    var min = c.bid + 1;
    var max = maxBid(t);
    bidAmount = Math.min(Math.max(bidAmount, min), max);

    var status;
    if (solo) status = esc(other.name) + "'s team is full. Take him for $1 or pass.";
    else if (c.leader === null) status = c.acted[1 - t] ? esc(other.name) + ' passed. No bids yet.' : 'No bids yet.';
    else status = 'Current bid: <b>$' + c.bid + '</b> by ' + esc(state.teams[c.leader].name);

    var controls = solo
      ? '<div class="actions"><button type="button" class="ghost big" data-action="pass">Pass</button>' +
        '<button type="button" class="primary big" data-action="bid" data-amount="1">Take for $1</button></div>'
      : '<div class="stepper">' +
          '<button type="button" data-action="step" data-step="-1"' + (bidAmount <= min ? ' disabled' : '') + ' aria-label="Lower">−</button>' +
          '<span class="amount">$' + bidAmount + '</span>' +
          '<button type="button" data-action="step" data-step="1"' + (bidAmount >= max ? ' disabled' : '') + ' aria-label="Higher">+</button>' +
          '<button type="button" class="ghost max" data-action="max">Max $' + max + '</button>' +
        '</div>' +
        '<div class="actions"><button type="button" class="ghost big" data-action="pass">Pass</button>' +
        '<button type="button" class="primary big" data-action="bid" data-amount="' + bidAmount + '">Bid $' + bidAmount + '</button></div>';

    return '<section class="panel turn team-' + t + '">' +
      '<div class="turn-who">' + esc(team.name) + ', your move</div>' +
      '<div class="turn-status">' + status + '</div>' +
      controls +
    '</section>';
  }

  function renderPlace() {
    var w = state.won;
    var team = state.teams[w.team];
    var natural = PLAYERS[w.p].pos;
    return '<section class="panel turn team-' + w.team + '">' +
      '<div class="turn-who">Sold to ' + esc(team.name) + ' for $' + w.price + '!</div>' +
      (w.note ? '<div class="turn-status">' + esc(w.note) + '</div>' : '') +
      '<div class="turn-status">Pick a spot for him:</div>' +
      '<div class="place-grid">' + openSlots(w.team).map(function (pos) {
        return '<button type="button" class="place' + (pos === natural ? ' natural' : '') + '" data-action="place" data-pos="' + pos + '">' +
          pos + (pos === natural ? '<small>his position</small>' : '') + '</button>';
      }).join('') + '</div>' +
    '</section>';
  }

  function renderReveal() {
    var totalSlots = POSITIONS.length * 2;
    var shown = Object.keys(state.revealed).length;
    var allShown = shown >= totalSlots;
    var totals = state.teams.map(function (team) {
      return POSITIONS.reduce(function (sum, pos) { return sum + score(PLAYERS[team.slots[pos].p]); }, 0);
    });

    var html = '<section class="reveal">' +
      '<h2>' + (allShown ? 'Final teams' : 'Both teams are full. Time to reveal!') + '</h2>' +
      (allShown ? '' : '<p class="muted">Tap a card to flip it.</p>') +
      '<div class="reveal-teams">' + state.teams.map(function (team, t) {
        return '<div class="reveal-team team-' + t + '">' +
          '<div class="team-head"><span class="team-name">' + esc(team.name) + '</span>' +
          '<span class="money">$' + team.money + ' left</span></div>' +
          POSITIONS.map(function (pos) {
            var key = t + '-' + pos;
            var s = team.slots[pos];
            var p = PLAYERS[s.p];
            var open = !!state.revealed[key];
            return '<button type="button" class="flip' + (open ? ' open' : '') + '" data-action="flip" data-key="' + key + '">' +
              '<div class="flip-inner">' +
                '<div class="flip-front"><span class="mini-pos">' + pos + '</span><span class="q">?</span>' +
                  '<span class="flip-hint">' + esc(s.hint.short) + '</span><span class="mini-price">$' + s.price + '</span></div>' +
                '<div class="flip-back"><span class="mini-pos">' + pos + '</span>' + headshot(p) +
                  '<span class="flip-name">' + esc(p.name) + '<small>' + p.ppg.toFixed(1) + ' pts · ' + p.rpg.toFixed(1) + ' reb · ' +
                  p.apg.toFixed(1) + ' ast</small></span><span class="mini-price">$' + s.price + '</span></div>' +
              '</div></button>';
          }).join('') +
          (allShown ? '<div class="team-score">Score <b>' + totals[t].toFixed(1) + '</b></div>' : '') +
        '</div>';
      }).join('') + '</div>';

    if (!allShown) {
      html += '<button type="button" class="ghost big wide" data-action="reveal-all">Reveal everyone</button>';
    } else {
      var diff = Math.abs(totals[0] - totals[1]);
      var winner = totals[0] === totals[1] ? null : (totals[0] > totals[1] ? 0 : 1);
      html += '<div class="panel result' + (winner === null ? '' : ' team-' + winner) + '">' +
        '<div class="result-title">' + (winner === null ? "It's a tie!" : '🏆 ' + esc(state.teams[winner].name) + ' wins by ' + diff.toFixed(1)) + '</div>' +
        '<div class="muted">Score = career points + rebounds + assists per game, added up for all 5 players. Disagree? Argue it out.</div>' +
      '</div>';
      if (state.skipped.length) {
        html += '<div class="panel skipped"><div class="skipped-title">Players nobody bid on</div>' +
          state.skipped.map(function (s) {
            return '<div class="skipped-row"><span>' + esc(PLAYERS[s.p].name) + '</span><span class="muted">' + esc(s.hint.short) + '</span></div>';
          }).join('') + '</div>';
      }
      html += '<div class="actions">' +
        '<button type="button" class="ghost big" data-action="new">New players</button>' +
        '<button type="button" class="primary big" data-action="rematch">Rematch</button></div>';
    }
    return html + '</section>';
  }

  // ---------- events ----------

  $app.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-action]');
    if (!btn || btn.disabled) return;
    var action = btn.dataset.action;

    if (action === 'budget') {
      readNames();
      state.budget = Math.min(100, Math.max(5, state.budget + Number(btn.dataset.step)));
    } else if (action === 'start') {
      readNames();
      startGame(state.names, state.budget);
    } else if (action === 'step') {
      bidAmount += Number(btn.dataset.step);
    } else if (action === 'max') {
      bidAmount = maxBid(state.card.toAct);
    } else if (action === 'bid') {
      bid(Number(btn.dataset.amount));
    } else if (action === 'pass') {
      pass();
    } else if (action === 'place') {
      place(btn.dataset.pos);
    } else if (action === 'flip') {
      state.revealed[btn.dataset.key] = true;
    } else if (action === 'reveal-all') {
      state.teams.forEach(function (_, t) {
        POSITIONS.forEach(function (pos) { state.revealed[t + '-' + pos] = true; });
      });
    } else if (action === 'rematch') {
      startGame(state.names, state.budget);
    } else if (action === 'new') {
      state = setupState(state.names, state.budget);
    }
    render();
  });

  function readNames() {
    [0, 1].forEach(function (i) {
      var input = document.getElementById('name' + i);
      var v = input && input.value.trim();
      state.names[i] = v || 'Player ' + (i + 1);
    });
  }

  $quit.addEventListener('click', function () {
    if (!confirm('Quit this game? Both teams will be lost.')) return;
    state = setupState(state.names, state.budget);
    render();
  });

  render();
})();
