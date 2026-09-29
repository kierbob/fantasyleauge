(function () {
  'use strict';

  var STORAGE_KEY = 'statline:game';
  var BEST_KEY = 'statline:best';
  var CHOICES = 4;
  var PLAYERS = window.PLAYERS || [];

  var $app = document.getElementById('app');
  var $quit = document.getElementById('quit');

  var state = load() || setupState(1, ['Player 1', 'Player 2'], 10);

  // ---------- helpers ----------

  function setupState(count, names, perPlayer) {
    return { phase: 'setup', count: count, names: names, perPlayer: perPlayer };
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

  function getBest() {
    try { return Number(localStorage.getItem(BEST_KEY + ':' + state.perPlayer)) || 0; } catch (e) { return 0; }
  }

  function setBest(n) {
    try { localStorage.setItem(BEST_KEY + ':' + state.perPlayer, String(n)); } catch (e) { /* storage unavailable */ }
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function shuffle(list) {
    for (var i = list.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = list[i]; list[i] = list[j]; list[j] = tmp;
    }
    return list;
  }

  function initials(name) {
    return name.split(/\s+/).map(function (w) { return w[0]; }).join('').slice(0, 3).toUpperCase();
  }

  function headshot(p) {
    return '<div class="face big-face"><span>' + esc(initials(p.name)) + '</span>' +
      '<img src="https://cdn.nba.com/headshots/nba/latest/260x190/' + p.id + '.png" alt="" onerror="this.remove()"></div>';
  }

  // ---------- rules ----------

  // Two wrong answers from the same position make it harder to guess from the stat shape alone.
  function makeChoices(answer) {
    var pos = PLAYERS[answer].pos;
    var others = shuffle(PLAYERS.map(function (_, i) { return i; }).filter(function (i) { return i !== answer; }));
    var same = others.filter(function (i) { return PLAYERS[i].pos === pos; }).slice(0, 2);
    var rest = others.filter(function (i) { return same.indexOf(i) === -1; });
    return shuffle([answer].concat(same, rest.slice(0, CHOICES - 1 - same.length)));
  }

  function startGame(count, names, perPlayer) {
    state = {
      phase: 'question',
      count: count,
      names: names,
      perPlayer: perPlayer,
      scores: names.slice(0, count).map(function () { return 0; }),
      streaks: names.slice(0, count).map(function () { return 0; }),
      deck: shuffle(PLAYERS.map(function (_, i) { return i; })),
      q: -1,
      current: null,
      history: []
    };
    nextQuestion();
  }

  function totalQuestions() { return state.perPlayer * state.count; }

  function nextQuestion() {
    state.q++;
    if (state.q >= totalQuestions()) {
      state.phase = 'done';
      state.current = null;
      if (state.count === 1 && state.scores[0] > getBest()) {
        state.newBest = true;
        setBest(state.scores[0]);
      }
      return;
    }
    var p = state.deck.pop();
    state.current = { p: p, choices: makeChoices(p), picked: null, fact: PLAYERS[p].facts[Math.floor(Math.random() * PLAYERS[p].facts.length)] };
    state.phase = 'question';
  }

  function answer(i) {
    var c = state.current;
    if (c.picked !== null) return;
    c.picked = i;
    var who = state.q % state.count;
    var right = i === c.p;
    if (right) {
      state.scores[who]++;
      state.streaks[who]++;
    } else {
      state.streaks[who] = 0;
    }
    state.history.push({ p: c.p, who: who, right: right });
    state.phase = 'answered';
  }

  // ---------- rendering ----------

  function render() {
    try {
      $quit.hidden = state.phase === 'setup';
      if (state.phase === 'setup') $app.innerHTML = renderSetup();
      else if (state.phase === 'done') $app.innerHTML = renderDone();
      else $app.innerHTML = renderScores() + renderQuestion();
    } catch (e) {
      // A saved game this version can't draw: start over instead of a blank page.
      console.error(e);
      state = setupState(1, ['Player 1', 'Player 2'], 10);
      $quit.hidden = true;
      $app.innerHTML = renderSetup();
    }
    save();
  }

  function renderSetup() {
    var best = getBest();
    return '<section class="panel setup">' +
      '<h2>Guess the Stat Line</h2>' +
      '<ul class="rules">' +
        '<li>You see a player\'s <b>career</b> points, rebounds and assists per game.</li>' +
        '<li>Pick who it is from 4 choices. Watch out: two of the wrong answers play the same position.</li>' +
        '<li>With 2 players you take turns. Most right answers wins.</li>' +
      '</ul>' +
      '<div class="field">Players' +
        '<div class="segmented">' +
          '<button type="button" data-action="count" data-count="1"' + (state.count === 1 ? ' class="on"' : '') + '>Solo</button>' +
          '<button type="button" data-action="count" data-count="2"' + (state.count === 2 ? ' class="on"' : '') + '>2 players</button>' +
        '</div>' +
      '</div>' +
      (state.count === 2
        ? '<label class="field">Player 1<input id="name0" maxlength="16" value="' + esc(state.names[0]) + '"></label>' +
          '<label class="field">Player 2<input id="name1" maxlength="16" value="' + esc(state.names[1]) + '"></label>'
        : '') +
      '<div class="field">Questions' + (state.count === 2 ? ' each' : '') +
        '<div class="segmented">' + [5, 10, 20].map(function (n) {
          return '<button type="button" data-action="per" data-per="' + n + '"' + (state.perPlayer === n ? ' class="on"' : '') + '>' + n + '</button>';
        }).join('') + '</div>' +
      '</div>' +
      (state.count === 1 && best ? '<p class="muted">Your best: ' + best + ' / ' + state.perPlayer + '</p>' : '') +
      '<button type="button" class="primary big" data-action="start">Start</button>' +
    '</section>';
  }

  function renderScores() {
    var who = state.q % state.count;
    var qNum = state.count === 1 ? state.q + 1 : Math.floor(state.q / 2) + 1;
    if (state.count === 1) {
      return '<div class="sl-bar"><span>Question <b>' + qNum + '</b> / ' + state.perPlayer + '</span>' +
        '<span>Score <b>' + state.scores[0] + '</b>' + (state.streaks[0] > 1 ? ' · 🔥 ' + state.streaks[0] : '') + '</span></div>';
    }
    return '<section class="teams">' + state.scores.map(function (s, t) {
      return '<div class="team team-' + t + (t === who ? ' acting' : '') + '">' +
        '<div class="team-head"><span class="team-name">' + esc(state.names[t]) + '</span>' +
        '<span class="money">' + s + '</span></div>' +
        '<div class="muted small">' + (state.streaks[t] > 1 ? '🔥 ' + state.streaks[t] + ' in a row' : 'Question ' + qNum + ' / ' + state.perPlayer) + '</div>' +
      '</div>';
    }).join('') + '</section>';
  }

  function renderQuestion() {
    var c = state.current;
    var p = PLAYERS[c.p];
    var who = state.q % state.count;
    var answered = c.picked !== null;

    var html = '<section class="mystery' + (answered ? '' : ' pop') + '">' +
      '<div class="mystery-top"><span class="chip">' + p.pos + '</span>' +
      '<span class="mystery-no">' + (state.count === 2 ? esc(state.names[who]) + '\'s turn' : 'Career averages') + '</span></div>' +
      '<div class="statline">' +
        stat(p.ppg, 'PTS') + stat(p.rpg, 'REB') + stat(p.apg, 'AST') +
      '</div>' +
      '<div class="hint-label">Whose career stat line is this?</div>' +
    '</section>';

    html += '<section class="choices team-' + (state.count === 2 ? who : 0) + '">' + c.choices.map(function (i) {
      var cls = 'choice';
      if (answered) {
        if (i === c.p) cls += ' right';
        else if (i === c.picked) cls += ' wrong';
        else cls += ' dim';
      }
      return '<button type="button" class="' + cls + '" data-action="answer" data-i="' + i + '"' + (answered ? ' disabled' : '') + '>' +
        esc(PLAYERS[i].name) + '</button>';
    }).join('') + '</section>';

    if (answered) {
      var right = c.picked === c.p;
      var last = state.q + 1 >= totalQuestions();
      html += '<section class="panel answer ' + (right ? 'is-right' : 'is-wrong') + '">' +
        '<div class="answer-head">' + headshot(p) +
          '<div><div class="answer-verdict">' + (right ? 'Correct!' : 'Nope!') + '</div>' +
          '<div class="answer-name">' + esc(p.name) + '</div></div></div>' +
        '<div class="muted">' + esc(c.fact) + '</div>' +
        '<button type="button" class="primary big wide" data-action="next">' + (last ? 'See results' : 'Next') + '</button>' +
      '</section>';
    }
    return html;
  }

  function stat(value, label) {
    return '<div class="stat"><span class="stat-val">' + value.toFixed(1) + '</span><span class="stat-lbl">' + label + '</span></div>';
  }

  function renderDone() {
    var html = '<section class="panel result">';
    if (state.count === 1) {
      var s = state.scores[0];
      var pct = s / state.perPlayer;
      var msg = pct === 1 ? 'Perfect. Are you an NBA scout?' : pct >= 0.8 ? 'Hall of Fame level.' :
        pct >= 0.5 ? 'Solid rotation player.' : pct >= 0.3 ? 'Deep bench.' : 'Straight to the G League.';
      html += '<div class="result-title">' + s + ' / ' + state.perPlayer + '</div>' +
        '<div class="muted">' + msg + (state.newBest ? ' New best!' : '') + '</div>';
    } else {
      var a = state.scores[0], b = state.scores[1];
      var winner = a === b ? null : (a > b ? 0 : 1);
      html = '<section class="panel result' + (winner === null ? '' : ' team-' + winner) + '">' +
        '<div class="result-title">' + (winner === null ? "It's a tie!" : '🏆 ' + esc(state.names[winner]) + ' wins') + '</div>' +
        '<div class="muted">' + esc(state.names[0]) + ' ' + a + ' – ' + b + ' ' + esc(state.names[1]) + '</div>';
    }
    html += '</section>';

    html += '<section class="panel skipped"><div class="skipped-title">The answers</div>' + state.history.map(function (h) {
      var p = PLAYERS[h.p];
      return '<div class="skipped-row"><span>' + (h.right ? '✅ ' : '❌ ') + esc(p.name) +
        (state.count === 2 ? ' <span class="muted">(' + esc(state.names[h.who]) + ')</span>' : '') + '</span>' +
        '<span class="muted">' + p.ppg.toFixed(1) + ' / ' + p.rpg.toFixed(1) + ' / ' + p.apg.toFixed(1) + '</span></div>';
    }).join('') + '</section>';

    html += '<div class="actions">' +
      '<button type="button" class="ghost big" data-action="setup">Settings</button>' +
      '<button type="button" class="primary big" data-action="again">Play again</button></div>';
    return html;
  }

  // ---------- events ----------

  function readNames() {
    [0, 1].forEach(function (i) {
      var input = document.getElementById('name' + i);
      if (!input) return;
      state.names[i] = input.value.trim() || 'Player ' + (i + 1);
    });
  }

  $app.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-action]');
    if (!btn || btn.disabled) return;
    var action = btn.dataset.action;

    if (action === 'count') {
      readNames();
      state.count = Number(btn.dataset.count);
    } else if (action === 'per') {
      readNames();
      state.perPlayer = Number(btn.dataset.per);
    } else if (action === 'start') {
      readNames();
      startGame(state.count, state.names, state.perPlayer);
    } else if (action === 'answer') {
      answer(Number(btn.dataset.i));
    } else if (action === 'next') {
      nextQuestion();
    } else if (action === 'again') {
      startGame(state.count, state.names, state.perPlayer);
    } else if (action === 'setup') {
      state = setupState(state.count, state.names, state.perPlayer);
    }
    render();
    if (action === 'answer') {
      var panel = $app.querySelector('.answer');
      if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else if (action === 'next') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });

  $quit.addEventListener('click', function () {
    if (state.phase !== 'done' && !confirm('Quit this game?')) return;
    state = setupState(state.count, state.names, state.perPlayer);
    render();
  });

  render();
})();
