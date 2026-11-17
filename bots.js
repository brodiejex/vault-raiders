// Computer adventurers: a simple, readable strategy.
// They look at the three treasures on the back of the top card, guess how
// likely each one is from how many copies are still unseen, and pick the
// move worth the most cards on average. They only use what that player could
// know, so they also work on the view an online player receives. A little
// randomness keeps them unpredictable but beatable.

(function (root) {
  'use strict';
  const VR = root.VR || (typeof require !== 'undefined' ? require('./rules.js') : null);

  // Returns { type: 'secure' } or { type: 'raid', target }.
  // steady: always the best-scoring move (used for teaching hints).
  function chooseAction(state, me, { steady = false } = {}) {
    const o = VR.options(state, me);
    const goal = VR.goal(state);
    const two = state.players.length === 2;
    const nearWin = (i) => state.vault[i].length / goal; // 0 … 1

    // Securing: matched cards go straight to the vault. A miss isn't bad,
    // it just adds a card to your stash.
    let best = { move: { type: 'secure' }, score: o.secure.expected + 0.3 * (1 - o.secure.chance) };
    // Winning right now beats everything.
    const canWin = o.secure.hits.some((t) => state.vault[me].length + VR.countOf(state.stash[me], t) + 1 >= goal);
    if (canWin) best.score += 3 * o.secure.chance;

    o.raids.forEach((r) => {
      // Stolen cards land in your stash (not your vault), but also take
      // a set away from someone who might have secured it.
      let score = r.expected * 0.8;
      score *= 1 + nearWin(r.target) * 0.6; // go after the leader
      if (two) score += r.chance * 1.2;      // a hit earns another turn
      // A miss hands them a card.
      score -= (1 - r.chance) * (0.4 + nearWin(r.target) * 0.6);
      if (score > best.score) best = { move: { type: 'raid', target: r.target }, score };
    });

    // Now and then pick something a bit different, like a person might.
    if (!steady && Math.random() < 0.12) {
      const all = [{ type: 'secure' }, ...o.raids.filter((r) => r.chance > 0).map((r) => ({ type: 'raid', target: r.target }))];
      return all[Math.floor(Math.random() * all.length)];
    }
    return best.move;
  }

  const api = { chooseAction };
  root.Bots = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
