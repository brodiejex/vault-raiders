// Rules checks. Open tests/tests.html in a browser to run them.

(function (root) {
  'use strict';
  const VR = root.VR;
  const Bots = root.Bots;
  const results = [];
  function test(name, fn) {
    try { fn(); results.push({ name, ok: true }); }
    catch (e) { results.push({ name, ok: false, error: e.message }); }
  }
  function eq(actual, expected, msg) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`${msg || 'Expected'} ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
  }
  function throws(fn, msg) {
    try { fn(); } catch (e) { return; }
    throw new Error(msg || 'Expected an error');
  }

  // Short ways to make cards and rig a game for a test.
  let nextId = 0;
  const c = (type) => ({ id: `${type}-t${nextId++}`, type, back: [type, 'gold', 'gems'] });
  const many = (type, n) => Array.from({ length: n }, () => c(type));
  function rig(stashes, { deck, turn = 0, vault } = {}) {
    const game = VR.createGame({ players: stashes.map((_, i) => ({ name: `P${i}` })), first: turn });
    game.stash = stashes.map((s) => s.slice());
    game.vault = vault ? vault.map((v) => v.slice()) : stashes.map(() => []);
    game.deck = deck ? deck.slice() : many('relics', 10);
    game.turn = turn;
    return game;
  }
  const types = (list) => list.map((x) => x.type).sort();

  test('Deck has 84 cards, 12 of each treasure', () => {
    const deck = VR.buildDeck();
    eq(deck.length, 84);
    eq(new Set(deck.map((x) => x.id)).size, 84);
    VR.TYPES.forEach((t) => eq(deck.filter((x) => x.type === t).length, 12));
  });

  test('Each back shows 3 different treasures, including the real one', () => {
    VR.buildDeck().forEach((card) => {
      eq(new Set(card.back).size, 3, `${card.id} back`);
      if (!card.back.includes(card.type)) throw new Error(`${card.id} back is missing its own treasure`);
    });
  });

  test('Backs are fair: no two cards of a treasure share a back, every treasure is a decoy 24 times', () => {
    const deck = VR.buildDeck();
    VR.TYPES.forEach((t) => {
      const backs = deck.filter((x) => x.type === t).map((x) => x.back.join());
      eq(new Set(backs).size, 12, `${t} backs`);
      eq(deck.filter((x) => x.type !== t && x.back.includes(t)).length, 24, `${t} as decoy`);
    });
    // Every back could be at least 2 different treasures, so it never gives the card away.
    const byBack = {};
    deck.forEach((x) => { (byBack[x.back.join()] = byBack[x.back.join()] || []).push(x.type); });
    Object.values(byBack).forEach((list) => { if (list.length < 2) throw new Error('A back belongs to only one card'); });
  });

  test('Setup: 4 cards in each stash, the rest in the Dungeon Deck', () => {
    const g = VR.createGame({ players: [{ name: 'A' }, { name: 'B' }, { name: 'C' }], first: 1 });
    eq(g.stash.map((s) => s.length), [4, 4, 4]);
    eq(g.vault, [[], [], []]);
    eq(g.deck.length, 72);
    eq(g.turn, 1);
    eq(g.phase, 'turn');
  });

  test('Secure: a match moves the new card and the whole set to the vault', () => {
    const g = rig([[c('gems'), c('gold'), c('gems')], [c('potions')], [c('eggs')]], { deck: [c('relics'), c('gems')] });
    VR.secure(g, 0);
    eq(types(g.vault[0]), ['gems', 'gems', 'gems']);
    eq(types(g.stash[0]), ['gold']);
    eq(g.turn, 1);
    eq(g.lastEvent.success, true);
  });

  test('Secure: no match adds the card to your stash', () => {
    const g = rig([[c('gems')], [c('potions')]], { deck: [c('relics'), c('gold')] });
    VR.secure(g, 0);
    eq(types(g.stash[0]), ['gems', 'gold']);
    eq(g.vault[0], []);
    eq(g.lastEvent.success, false);
  });

  test('Raid: a match takes the card and all their matching cards into your stash', () => {
    const g = rig([[c('gold')], [c('weapons'), c('weapons'), c('eggs')], [c('weapons')]], { deck: [c('relics'), c('weapons')] });
    VR.raid(g, 0, 1);
    eq(types(g.stash[0]), ['gold', 'weapons', 'weapons', 'weapons']);
    eq(types(g.stash[1]), ['eggs']);
    eq(types(g.stash[2]), ['weapons'], 'other players untouched');
    eq(g.vault[0], [], 'raided cards go to the stash, not the vault');
    eq(g.turn, 1);
  });

  test('Raid: no match gives the card to the raided player', () => {
    const g = rig([[c('gold')], [c('eggs')], [c('potions')]], { deck: [c('relics'), c('gold')] });
    VR.raid(g, 0, 1);
    eq(types(g.stash[0]), ['gold']);
    eq(types(g.stash[1]), ['eggs', 'gold']);
    eq(g.lastEvent.success, false);
    eq(g.turn, 1);
  });

  test('You cannot raid yourself, or move out of turn', () => {
    const g = rig([[c('gold')], [c('eggs')]]);
    throws(() => VR.raid(g, 0, 0));
    throws(() => VR.raid(g, 0, 5));
    throws(() => VR.secure(g, 1));
  });

  test('Two players: a successful raid earns another turn, a failed one does not', () => {
    const g = rig([[c('gold')], [c('eggs')]], { deck: [c('relics'), c('potions'), c('eggs')] });
    VR.raid(g, 0, 1);
    eq(g.turn, 0, 'same player again');
    eq(g.again, true);
    VR.raid(g, 0, 1); // potions: no match
    eq(g.turn, 1);
    eq(g.again, false);
  });

  test('Three players: a successful raid does not earn another turn', () => {
    const g = rig([[c('gold')], [c('eggs')], [c('gems')]], { deck: [c('relics'), c('eggs')] });
    VR.raid(g, 0, 1);
    eq(g.turn, 1);
  });

  test('Reaching 10 vault cards wins at once', () => {
    const g = rig([[c('gems'), c('gems')], [c('eggs')], [c('gold')]], { vault: [many('gold', 7), [], []], deck: [c('relics'), c('gems')] });
    VR.secure(g, 0);
    eq(g.vault[0].length, 10);
    eq(g.phase, 'gameOver');
    eq(g.winner, 0);
  });

  test('Two players need 15 vault cards', () => {
    const g = rig([[c('gems'), c('gems')], [c('eggs')]], { vault: [many('gold', 9), []], deck: [c('relics'), c('relics'), c('gems')] });
    VR.secure(g, 0);
    eq(g.vault[0].length, 12);
    eq(g.phase, 'turn', 'not yet');
  });

  test('Empty deck: most vault cards wins', () => {
    const g = rig([[c('gems')], [c('eggs')], [c('gold')]], { vault: [many('gold', 2), many('eggs', 5), many('potions', 3)], deck: [c('relics')] });
    VR.secure(g, 0);
    eq(g.phase, 'gameOver');
    eq(g.winners, [1]);
  });

  test('Empty deck: a tie goes to the most cards left in the stash', () => {
    const g = rig([[c('gems')], [c('eggs'), c('gold'), c('scrolls')], [c('gold')]], { vault: [many('gold', 4), many('eggs', 4), many('potions', 1)], deck: [c('relics')] });
    VR.secure(g, 0); // P0 now has 2 stash cards, P1 has 3
    eq(g.winners, [1]);
  });

  test('Empty deck: a full tie is shared', () => {
    const g = rig([[c('gems')], [c('eggs'), c('gold')]], { vault: [many('gold', 4), many('eggs', 4)], deck: [c('relics')] });
    VR.secure(g, 0);
    eq(g.winners, [0, 1]);
    eq(g.winner, null);
  });

  test('Chances follow the unseen copies of the three treasures on the back', () => {
    const g = rig([many('gold', 6), many('gems', 9)], { deck: [{ id: 'x', type: 'potions', back: ['gold', 'gems', 'potions'] }] });
    const p = VR.chances(g, 0);
    // Unseen: gold 6, gems 3, potions 12.
    eq(Math.round(p.gold * 21), 6);
    eq(Math.round(p.gems * 21), 3);
    eq(Math.round(p.potions * 21), 12);
    const o = VR.options(g, 0);
    eq(o.secure.hits, ['gold']);
    eq(o.raids[0].hits, ['gems']);
  });

  test('Online view hides the deck fronts and other vaults, but shows the top back', () => {
    const g = VR.createGame({ players: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] });
    g.vault[1] = many('gold', 3);
    const v = VR.viewFor(g, 0);
    eq(v.deck.length, g.deck.length);
    eq(v.deck[v.deck.length - 1], { back: g.deck[g.deck.length - 1].back });
    eq(v.deck[0], null);
    eq(v.vault[1], [null, null, null]);
    eq(v.stash[1].length, 4, 'stashes are public');
    eq(v.random, undefined);
    eq(VR.viewFor(g, 1).vault[1].length, 3);
  });

  test('Computer players finish 400 games without breaking a rule', () => {
    let finished = 0;
    for (let n = 0; n < 400; n++) {
      const count = 2 + (n % 5);
      const g = VR.createGame({ players: Array.from({ length: count }, (_, i) => ({ name: `B${i}`, isBot: true })) });
      let steps = 0;
      while (g.phase !== 'gameOver' && steps++ < 200) {
        const who = VR.waitingFor(g)[0];
        // Bots decide from their own view, like an online player would.
        VR.applyAction(g, who, Bots.chooseAction(VR.viewFor(g, who), who));
        const total = g.stash.flat().length + g.vault.flat().length + g.deck.length;
        if (total !== 84) throw new Error(`Cards went missing: ${total}`);
      }
      if (g.phase !== 'gameOver') throw new Error(`Game ${n} did not finish`);
      if (!g.winners.length) throw new Error('Should have a winner');
      finished++;
    }
    eq(finished, 400);
  });

  const box = document.getElementById('results');
  const bad = results.filter((r) => !r.ok);
  box.innerHTML = `<h2 class="${bad.length ? 'bad' : 'ok'}">${results.length - bad.length} of ${results.length} checks passed</h2>`
    + results.map((r) => `<div class="${r.ok ? 'ok' : 'bad'}">${r.ok ? '✔' : '✘'} ${r.name}${r.ok ? '' : ` — ${r.error}`}</div>`).join('');
})(window);
