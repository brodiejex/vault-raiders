# 🗝️ Vault Raiders

Flip treasures from the Dungeon Deck. Secure matching sets in your vault, or raid another
adventurer's stash. The back of every card shows three treasures, and one of them is the
real one. The first adventurer to fill their vault wins.

## How to play it

Double-click `index.html` to open it in your web browser. Nothing to install.

- **2–6 players**: any mix of people and computer adventurers.
- **Same device**: every card in this game is face up, so there's no passing the device.
  Just take turns.
- **Teaching mode**: shows the chance of each move working, and what a computer
  adventurer would do.
- **Online**: one person chooses *Host an online game* and shares the 4-letter room code
  (or invite link). Everyone else chooses *Join an online game*.

## The cards (84)

12 each of 🪙 Gold Coins (gold), 💎 Magic Gems (blue), 🧪 Potions (green), ⚔️ Weapons (red),
📜 Spell Scrolls (purple), 🥚 Dragon Eggs (orange) and 👑 Royal Relics (magenta).

The back of each card shows three different treasures, including the real one. The backs
are spread evenly: each treasure has 12 different backs, every treasure appears as a decoy
24 times, and every back could be at least two different treasures.

## A turn

- **🔒 Secure your treasure**: flip the top card into your stash. If it matches, the card
  and all your cards of that treasure go to your vault.
- **🗡️ Raid an adventurer**: pick a player and flip the top card. If it matches their stash,
  you take the card and all their matching cards into *your stash*. If not, they keep the card.

First to **10** vault cards wins (**15** with two players). If the deck runs out, the most
vault cards wins, then the most stash cards. With two players, a successful raid earns
another turn.

## 📺 Playing over a video call

Everything is face up, so just share the game's screen (for example in Google Meet). Every
choice has a number: the player says **1** to Secure, or **2** and a seat number to Raid,
and whoever is at the computer clicks it or types the number on the keyboard.

## How online play works

The host's browser runs the game and sends each player what they're allowed to see (the
deck and other players' vault treasures stay hidden). Devices connect directly using
[PeerJS](https://peerjs.com/) (WebRTC). The host must keep the page open. A player who
drops out can rejoin with the same name, and the host can tap *Let a computer play* on
their seat meanwhile.

## Files

| File | What it does |
|---|---|
| `rules.js` | The game rules: the deck, securing, raiding, winning. No screen code. |
| `bots.js` | How computer adventurers decide between securing and raiding. |
| `game.js` | The screens and buttons, for both same-device and online games. |
| `online.js` | Connects devices for online play. |
| `style.css` | Colors, card designs and layout. |
| `tests/tests.html` | Open in a browser to run the rules checks (includes 400 computer-only games). |

The cards use emoji designs for now. Card pictures can be added later the same way as in
Dungeon's Treasure.
