// Vault Raiders — game rules.
// This file knows nothing about screens or buttons. It only holds the game
// state and the rules for changing it, so the host's browser can run the
// real game for online play.
//
// Every card is double-sided: the front shows one treasure, the back shows
// three different treasures, one of which is the real one. Each turn the
// player either Secures (flips the top card into their own stash and vaults
// any matching set) or Raids (flips it against someone else's stash and
// steals the matching set into their own stash).

(function (root) {
  'use strict';

  const COPIES = 12;   // of each treasure
  const DEAL = 4;      // cards in each starting stash
  const GOAL = 10;     // vault cards needed to win
  const GOAL_TWO = 15; // ... in a two-player game

  const TREASURES = {
    gold: { name: 'Gold Coins', icon: '🪙', color: 'Gold' },
    gems: { name: 'Magic Gems', icon: '💎', color: 'Blue' },
    potions: { name: 'Potions', icon: '🧪', color: 'Green' },
    weapons: { name: 'Weapons', icon: '⚔️', color: 'Red' },
    scrolls: { name: 'Spell Scrolls', icon: '📜', color: 'Purple' },
    eggs: { name: 'Dragon Eggs', icon: '🥚', color: 'Orange' },
    relics: { name: 'Royal Relics', icon: '👑', color: 'Magenta' },
  };
  const TYPES = Object.keys(TREASURES);

  // The two decoy treasures on each card's back, as steps around the list of
  // seven treasures. These 12 pairs (every pair from 1–6 except 1+6, 2+5 and
  // 3+4) give each treasure 12 different backs, and every treasure shows up
  // as a decoy exactly 24 times, so no back gives a treasure away.
  const DECOY_STEPS = [[1, 2], [1, 3], [1, 4], [1, 5], [2, 3], [2, 4], [2, 6], [3, 5], [3, 6], [4, 5], [4, 6], [5, 6]];

  // ---------- Deck ----------

  function buildDeck() {
    const deck = [];
    TYPES.forEach((type, t) => {
      DECOY_STEPS.forEach(([a, b], k) => {
        const back = [t, (t + a) % 7, (t + b) % 7].sort((x, y) => x - y).map((i) => TYPES[i]);
        deck.push({ id: `${type}-${k + 1}`, type, back });
      });
    });
    return deck;
  }

  function shuffle(cards, random = Math.random) {
    const a = cards.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ---------- Helpers ----------

  const label = (type) => `${TREASURES[type].icon} ${TREASURES[type].name}`;
  const nameOf = (state, i) => state.players[i].name;
  const goal = (state) => (state.players.length === 2 ? GOAL_TWO : GOAL);
  const countOf = (list, type) => list.filter((c) => c && c.type === type).length;
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  // The three treasures shown on the back of the top card of the Dungeon Deck.
  function topBack(state) {
    const top = state.deck[state.deck.length - 1];
    return top ? top.back : null;
  }

  // How many of each treasure `viewer` hasn't seen yet: 12, minus every card
  // face up in a stash, minus the viewer's own vault.
  function unseen(state, viewer) {
    const left = {};
    TYPES.forEach((t) => { left[t] = COPIES; });
    const count = (list) => list.forEach((c) => { if (c && c.type) left[c.type]--; });
    state.stash.forEach(count);
    if (viewer !== null && viewer !== undefined) count(state.vault[viewer]);
    TYPES.forEach((t) => { left[t] = Math.max(0, left[t]); });
    return left;
  }

  // The chance that the top card is each of the three treasures on its back,
  // as far as `viewer` can tell (more unseen copies = more likely).
  function chances(state, viewer) {
    const back = topBack(state);
    if (!back) return {};
    const left = unseen(state, viewer);
    const total = back.reduce((n, t) => n + left[t], 0);
    const out = {};
    back.forEach((t) => { out[t] = total ? left[t] / total : 1 / back.length; });
    return out;
  }

  // For a player about to choose: how likely each move is to work, and how
  // many cards it would win on average.
  function options(state, player) {
    const p = chances(state, player);
    const back = topBack(state) || [];
    const judge = (stash) => {
      const hits = back.filter((t) => countOf(stash, t) > 0);
      return {
        hits,
        chance: hits.reduce((n, t) => n + p[t], 0),
        expected: hits.reduce((n, t) => n + p[t] * (countOf(stash, t) + 1), 0),
      };
    };
    return {
      chances: p,
      secure: judge(state.stash[player]),
      raids: state.players.map((q) => q.id).filter((i) => i !== player).map((target) => ({ target, ...judge(state.stash[target]) })),
    };
  }

  function addEvent(state, text, extra = {}) {
    const ev = { seq: ++state.seq, text, private: {}, ...extra };
    state.log.push(ev);
    state.lastEvent = ev;
    return ev;
  }

  // ---------- Setup ----------

  function createGame({ players, teaching = false, random = Math.random, first }) {
    const n = players.length;
    if (n < 2 || n > 6) throw new Error('Vault Raiders needs 2 to 6 players.');
    const starter = first === undefined ? Math.floor(random() * n) : first;
    const deck = shuffle(buildDeck(), random);
    const state = {
      players: players.map((p, i) => ({ id: i, name: p.name, isBot: !!p.isBot })),
      teaching,
      stash: players.map(() => deck.splice(-DEAL)), // face up: everyone can see them
      vault: players.map(() => []),                 // secured cards: only the count is public
      deck,                                         // the Dungeon Deck (top = end of the array)
      turn: starter,
      starter,
      again: false,      // two-player game: the last raid worked, so the same player goes again
      phase: 'turn',
      winners: [],
      winner: null,
      endReason: '',
      log: [],
      seq: 0,
      lastEvent: null,
      random,
    };
    const two = n === 2 ? ` Two players: first to ${GOAL_TWO} vault cards wins, and a successful raid earns another turn.` : '';
    addEvent(state, `Everyone has a stash of ${DEAL} treasures. ${nameOf(state, starter)} goes first.${two}`);
    return state;
  }

  // ---------- Turns ----------

  function checkTurn(state, player) {
    if (state.phase !== 'turn') throw new Error('The game is over.');
    if (player !== state.turn) throw new Error(`It's ${nameOf(state, state.turn)}'s turn.`);
    if (!state.deck.length) throw new Error('The Dungeon Deck is empty.');
  }

  // Secure Your Treasure: flip the top card into your own stash. If it
  // matches, the whole set goes into your vault.
  function secure(state, player) {
    checkTurn(state, player);
    const card = state.deck.pop();
    const who = nameOf(state, player);
    const mine = state.stash[player];
    const matches = mine.filter((c) => c.type === card.type);
    if (matches.length) {
      state.stash[player] = mine.filter((c) => c.type !== card.type);
      state.vault[player].push(card, ...matches);
      const total = matches.length + 1;
      addEvent(state, `${who} secured their treasure and revealed ${label(card.type)}. It matches, so ${who} moves ${total} ${TREASURES[card.type].name} cards into their vault (${state.vault[player].length} in the vault now).`,
        { kind: 'secure', big: true, player, card, success: true, count: total });
    } else {
      mine.push(card);
      addEvent(state, `${who} secured their treasure and revealed ${label(card.type)}. No match, so it joins ${who}'s stash.`,
        { kind: 'secure', big: true, player, card, success: false, count: 0 });
    }
    if (state.vault[player].length >= goal(state)) return finish(state, [player], `${who} has ${state.vault[player].length} cards in their vault and claims the dungeon's greatest hoard!`);
    endTurn(state, false);
  }

  // Raid an Adventurer: flip the top card against another player's stash.
  // A match steals the card and their whole set into your own stash.
  function raid(state, player, target) {
    checkTurn(state, player);
    if (!Number.isInteger(target) || target === player || !state.players[target]) throw new Error('Choose another adventurer to raid.');
    const card = state.deck.pop();
    const who = nameOf(state, player);
    const them = nameOf(state, target);
    const theirs = state.stash[target];
    const matches = theirs.filter((c) => c.type === card.type);
    if (matches.length) {
      state.stash[target] = theirs.filter((c) => c.type !== card.type);
      state.stash[player].push(card, ...matches);
      const total = matches.length + 1;
      const two = state.players.length === 2;
      addEvent(state, `${who} raided ${them} and revealed ${label(card.type)}. It matches! ${who} takes ${total} ${TREASURES[card.type].name} cards into their own stash.${two && state.deck.length ? ` ${who} takes another turn!` : ''}`,
        { kind: 'raid', big: true, player, target, card, success: true, count: total });
      endTurn(state, two);
    } else {
      theirs.push(card);
      addEvent(state, `${who} raided ${them} and revealed ${label(card.type)}. No match, so the raid fails and the card joins ${them}'s stash.`,
        { kind: 'raid', big: true, player, target, card, success: false, count: 0 });
      endTurn(state, false);
    }
  }

  function endTurn(state, again) {
    if (!state.deck.length) return deckEmpty(state);
    state.again = again;
    if (!again) state.turn = (state.turn + 1) % state.players.length;
  }

  // Players in final order: most vault cards, then most stash cards.
  function ranking(state) {
    return state.players.map((p) => p.id).sort((a, b) => (state.vault[b].length - state.vault[a].length) || (state.stash[b].length - state.stash[a].length) || (a - b));
  }

  function deckEmpty(state) {
    const order = ranking(state);
    const best = order[0];
    const tied = (i) => state.vault[i].length === state.vault[best].length;
    const winners = order.filter((i) => tied(i) && state.stash[i].length === state.stash[best].length);
    const names = winners.map((i) => nameOf(state, i));
    let why;
    if (winners.length > 1) why = `The Dungeon Deck is empty. ${names.join(' and ')} tie with ${plural(state.vault[best].length, 'vault card')} and ${plural(state.stash[best].length, 'stash card')}, and share the victory!`;
    else if (order.filter(tied).length > 1) why = `The Dungeon Deck is empty. ${names[0]} is tied for the most vault cards (${state.vault[best].length}) and wins with the most cards left in their stash (${state.stash[best].length}).`;
    else why = `The Dungeon Deck is empty. ${names[0]} wins with the most vault cards (${state.vault[best].length}).`;
    finish(state, winners, why);
  }

  function finish(state, winners, why) {
    state.phase = 'gameOver';
    state.again = false;
    state.winners = winners;
    state.winner = winners.length === 1 ? winners[0] : null;
    state.endReason = why;
    addEvent(state, why, { kind: 'win' });
  }

  // ---------- For screens and online play ----------

  // Who the game is waiting on.
  function waitingFor(state) {
    return state.phase === 'turn' ? [state.turn] : [];
  }

  // What one player is allowed to see: the fronts in the Dungeon Deck and
  // other players' vaults stay hidden (only the top card's back shows).
  function viewFor(state, player) {
    const { random, ...rest } = state;
    const view = JSON.parse(JSON.stringify(rest));
    const over = state.phase === 'gameOver';
    view.deck = view.deck.map((c, k) => (k === view.deck.length - 1 ? { back: c.back } : null));
    view.vault = view.vault.map((v, i) => (i === player || over ? v : v.map(() => null)));
    return view;
  }

  // One entry point for moves coming from buttons or from online players.
  function applyAction(state, player, action) {
    switch (action && action.type) {
      case 'secure': return secure(state, player);
      case 'raid': return raid(state, player, action.target);
      default: throw new Error('Unknown move.');
    }
  }

  const api = {
    COPIES, DEAL, GOAL, GOAL_TWO, TREASURES, TYPES, DECOY_STEPS,
    buildDeck, shuffle, label, goal, countOf, topBack, unseen, chances, options,
    createGame, secure, raid, ranking, waitingFor, viewFor, applyAction,
  };
  root.VR = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
