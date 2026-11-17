// Vault Raiders — screens for playing on one device or online.
// The rules live in rules.js, the computer players in bots.js and the
// connections in online.js; this file draws the game and reacts to clicks.
//
// Modes:
//   local  — everyone shares this device
//   host   — this browser runs the real game and sends each player their view
//   client — this browser shows the view the host sends and sends back moves
//
// Every stash is face up and the Dungeon Deck shows the same back to
// everyone, so nothing needs hiding on a shared device: no "pass the device"
// screens. That also means a player on a video call can simply watch the
// shared screen. Every choice has a number to say (1 Secure, 2 Raid, then a
// seat number), and the number keys on the keyboard pick it.

(function () {
  'use strict';

  const app = document.getElementById('app');
  const overlay = document.getElementById('overlay');
  const rulesLayer = document.getElementById('rules-layer');
  const BOT_DELAY = 1500; // long enough to see whose turn it is
  const seatNumber = (i) => String(i + 1);
  const BOT_NAMES = ['Grimbold', 'Elowen', 'Thrak', 'Seraphine', 'Pip', 'Morwen', 'Bramble'];

  let mode = 'local';
  let game = null;    // local/host: the real game state; client: this player's view of it
  let ui = {};        // what this screen is showing
  let botTimer = null;
  let teaching = true;
  let numberKeys = null; // number keys for the current choice: { '2': fn, … }

  // Online only
  let net = null;     // connection from online.js
  let me = null;      // this device's seat number
  let roomCode = '';
  let lobby = [];     // host: seats with connections; client: public seat list from the host
  let lastJoin = null;

  // ---------- Small helpers ----------

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nameOf = (i) => esc(game.players[i].name);
  const isHost = () => mode === 'host';
  const online = () => mode === 'host' || mode === 'client';
  const stopTimers = () => clearTimeout(botTimer);
  const T = (type) => VR.TREASURES[type];
  const tLabel = (type) => `${T(type).icon} ${esc(T(type).name)}`;
  const waiting = () => (game ? VR.waitingFor(game) : []);
  const pct = (p) => `${Math.round(p * 100)}%`;
  const humans = () => game.players.filter((p) => !p.isBot).map((p) => p.id);

  // Can this device make the move for seat i?
  function canControl(i) {
    if (!game.players[i] || game.players[i].isBot) return false;
    if (mode === 'local') return true;
    return i === me;
  }

  // Whose vault contents this screen may show (only your own, and only when
  // nobody else is looking at the same screen).
  function seesVault(i) {
    if (mode === 'local') return humans().length === 1 && humans()[0] === i;
    return i === me;
  }

  function storageGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function storageSet(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* storage unavailable */ }
  }

  // Lets the host recognize this browser when it reconnects to a room.
  function deviceId() {
    let id = storageGet('vault.deviceId');
    if (!id) {
      id = Math.random().toString(36).slice(2, 12);
      storageSet('vault.deviceId', id);
    }
    return id;
  }

  // Typing a number on the keyboard picks that button (all choices are one digit).
  document.addEventListener('keydown', (e) => {
    if (!numberKeys || e.target.tagName === 'INPUT' || !/^[0-9]$/.test(e.key)) return;
    const fn = numberKeys[e.key];
    if (!fn) return;
    e.preventDefault();
    fn();
  });

  // ---------- Card pictures ----------

  // The treasure side.
  function cardHtml(card, { extraClass = '', tag = '' } = {}) {
    const t = T(card.type);
    return `<div class="card front t-${card.type} ${extraClass}" title="${esc(t.name)}">
      <div class="icon">${t.icon}</div>
      <div class="title">${esc(t.name)}</div>
      ${tag ? `<div class="card-tag">${tag}</div>` : ''}
    </div>`;
  }

  // The three-treasure side. With no back given, a plain face-down card.
  function backHtml(back, { extraClass = '' } = {}) {
    if (!back) return `<div class="card back plain ${extraClass}"><div class="crest">🗝️</div></div>`;
    return `<div class="card back ${extraClass}" title="One of: ${back.map((b) => esc(T(b).name)).join(', ')}">
      ${back.map((b) => `<div class="band t-${b}"><span class="b-icon">${T(b).icon}</span><span class="b-name">${esc(T(b).name)}</span></div>`).join('')}
    </div>`;
  }

  // A stash or vault, stacked by treasure: 💎×2 🪙×1 …
  function stacksHtml(cards, lit = []) {
    const known = cards.filter(Boolean);
    if (!known.length) return '<span class="small">empty</span>';
    return VR.TYPES.map((type) => {
      const n = VR.countOf(known, type);
      if (!n) return '';
      return `<span class="stack t-${type} ${lit.includes(type) ? 'lit' : ''}" title="${n} ${esc(T(type).name)}">
        <span class="s-icon">${T(type).icon}</span><span class="s-count">×${n}</span></span>`;
    }).join('');
  }

  function showOverlay(html) {
    overlay.innerHTML = `<div class="panel">${html}</div>`;
    overlay.classList.remove('hidden');
  }
  function hideOverlay() {
    numberKeys = null;
    overlay.classList.add('hidden');
    overlay.innerHTML = '';
  }

  // Redraw the current screen for whichever mode we're in.
  function rerender() {
    if (mode === 'local') update();
    else if (isHost()) hostTick();
    else renderOnline();
  }

  // A player's move. Local and host apply it here; a client sends it to the host.
  function act(action) {
    ui.message = '';
    ui.choosing = null;
    if (mode === 'client') return net.send({ t: 'action', action });
    try {
      VR.applyAction(game, action.player, action);
    } catch (e) {
      ui.message = e.message;
    }
    if (isHost()) return hostTick();
    update();
  }

  // ---------- Title screen ----------

  function renderTitle(note = '') {
    leaveOnline();
    hideOverlay();
    app.innerHTML = `
      <div class="setup">
        <h1 class="logo">🗝️ Vault Raiders</h1>
        <p class="tagline">Flip treasures from the Dungeon Deck. Secure matching sets in your vault, or raid
          another adventurer's stash. The back of each card shows three treasures, and one of them is real!
          First to fill their vault wins.</p>
        ${note ? `<p class="error">${esc(note)}</p>` : ''}
        <div class="menu">
          <button class="primary big" id="m-local">🎲 Play on this device</button>
          <button class="secondary big" id="m-host">🏰 Host an online game</button>
          <button class="secondary big" id="m-join">🚪 Join an online game</button>
        </div>
        <button class="link" data-rules>How to play</button>
        <a class="home-link" href="https://brodiegames.netlify.app/">🌙 Back to Game Night</a>
      </div>`;
    document.getElementById('m-local').addEventListener('click', () => renderSetup());
    document.getElementById('m-host').addEventListener('click', () => renderHostStart());
    document.getElementById('m-join').addEventListener('click', () => renderJoin());
    app.querySelector('[data-rules]').addEventListener('click', showRules);
  }

  // ---------- Local setup ----------

  function loadSeats() {
    try {
      const saved = JSON.parse(storageGet('vault.seats'));
      if (Array.isArray(saved) && saved.length >= 2 && saved.length <= 6) return saved;
    } catch (e) { /* ignore */ }
    return [{ name: 'Player 1', isBot: false }, { name: 'Grimbold', isBot: true }, { name: 'Elowen', isBot: true }];
  }

  let seats = loadSeats();

  function renderSetup(error = '') {
    stopTimers();
    hideOverlay();
    mode = 'local';
    game = null;
    app.innerHTML = `
      <div class="setup">
        <h1 class="logo small">🗝️ Vault Raiders</h1>
        <h2>Play on this device</h2>
        <div class="seats">
          ${seats.map((s, i) => `
            <div class="seat">
              <span class="seatno big-seat" title="Seat number">${seatNumber(i)}</span>
              <input data-name="${i}" value="${esc(s.name)}" maxlength="16" aria-label="Player ${i + 1} name">
              <button class="toggle ${s.isBot ? 'bot' : 'human'}" data-toggle="${i}" title="Click to change">${s.isBot ? '🤖 Computer' : '🙂 Person'}</button>
              <button class="icon-btn" data-remove="${i}" ${seats.length <= 2 ? 'disabled' : ''} aria-label="Remove">✕</button>
            </div>`).join('')}
        </div>
        <div class="row">
          <button class="secondary" data-add="human" ${seats.length >= 6 ? 'disabled' : ''}>+ Person</button>
          <button class="secondary" data-add="bot" ${seats.length >= 6 ? 'disabled' : ''}>+ Computer</button>
        </div>
        <p class="small">2 to 6 adventurers, playing in seat order. With 2 players, the first to 15 vault cards wins and a
          successful raid earns another turn.</p>
        <p class="small">📺 <b>Playing over a video call?</b> Every card in this game is face up, so just share this screen.
          Each choice has a number to say: <b>1</b> to Secure, or <b>2</b> and a seat number to Raid.</p>
        <label class="check"><input type="checkbox" id="teaching" ${teaching ? 'checked' : ''}> Teaching mode (chances and hints)</label>
        ${error ? `<p class="error">${esc(error)}</p>` : ''}
        <button class="primary big" id="start">Enter the dungeon</button>
        <button class="link" id="back">← Back</button>
      </div>`;

    app.querySelectorAll('[data-name]').forEach((el) => el.addEventListener('input', () => { seats[+el.dataset.name].name = el.value; }));
    app.querySelectorAll('[data-toggle]').forEach((el) => el.addEventListener('click', () => {
      const s = seats[+el.dataset.toggle];
      s.isBot = !s.isBot;
      renderSetup();
    }));
    app.querySelectorAll('[data-remove]').forEach((el) => el.addEventListener('click', () => { seats.splice(+el.dataset.remove, 1); renderSetup(); }));
    app.querySelectorAll('[data-add]').forEach((el) => el.addEventListener('click', () => {
      const bot = el.dataset.add === 'bot';
      seats.push({ name: bot ? freeBotName(seats) : `Player ${seats.length + 1}`, isBot: bot });
      renderSetup();
    }));
    document.getElementById('teaching').addEventListener('change', (e) => { teaching = e.target.checked; });
    document.getElementById('start').addEventListener('click', startLocalGame);
    document.getElementById('back').addEventListener('click', () => renderTitle());
  }

  function freeBotName(list) {
    const used = new Set(list.map((s) => s.name));
    return BOT_NAMES.find((n) => !used.has(n)) || 'Bot';
  }

  function startLocalGame() {
    seats.forEach((s, i) => { s.name = s.name.trim() || (s.isBot ? 'Bot' : `Player ${i + 1}`); });
    if (!seats.some((s) => !s.isBot)) return renderSetup('At least one person needs to play.');
    storageSet('vault.seats', JSON.stringify(seats));
    mode = 'local';
    game = VR.createGame({ players: seats, teaching });
    ui = { message: '', noticeSeq: game.seq };
    update();
  }

  // ---------- Local game loop: decide what to show next ----------

  function update() {
    stopTimers();
    hideOverlay();
    queueNotices();
    showLocal();
  }

  function showLocal() {
    if (ui.notices && ui.notices.length) return renderNotice();
    if (game.phase === 'gameOver') return renderGameOver();
    if (waiting().some((i) => game.players[i].isBot)) {
      botTimer = setTimeout(() => { botMove(); update(); }, BOT_DELAY);
    }
    renderTable();
  }

  function botMove() {
    const i = game.turn;
    if (game.phase !== 'turn' || !game.players[i].isBot) return;
    try {
      VR.applyAction(game, i, Bots.chooseAction(game, i));
    } catch (e) {
      console.error(e);
    }
  }

  // ---------- Pop-ups: every flip of the Dungeon Deck ----------

  function bigEvents(since) {
    return game.log.filter((e) => e.seq > since && e.big);
  }

  function queueNotices() {
    if (mode !== 'local' || !game) return;
    if (ui.noticeSeq === undefined) ui.noticeSeq = game.seq;
    if (game.seq === ui.noticeSeq) return;
    const fresh = bigEvents(ui.noticeSeq);
    ui.noticeSeq = game.seq;
    if (fresh.length) (ui.notices = ui.notices || []).push(fresh);
  }

  function renderNotice() {
    renderTable();
    showNoticePanel(ui.notices[0], () => {
      ui.notices.shift();
      update();
    });
  }

  function noticeHtml(ev) {
    let icon;
    let headline;
    const who = nameOf(ev.player);
    if (ev.kind === 'secure') {
      icon = ev.success ? '🔒' : '🃏';
      headline = ev.success ? `${who} secures ${ev.count} ${esc(T(ev.card.type).name)}!` : `${who} finds no match`;
    } else {
      icon = ev.success ? '🗡️' : '😬';
      headline = ev.success ? `${who} raids ${nameOf(ev.target)} and steals ${ev.count} ${esc(T(ev.card.type).name)}!` : `${who}'s raid on ${nameOf(ev.target)} fails`;
    }
    return `
      <div class="notice-item">
        <div class="notice-icon">${icon}</div>
        <h2>${headline}</h2>
        <div class="flip">
          ${backHtml(ev.card.back)}
          <div class="flip-arrow">➜</div>
          ${cardHtml(ev.card, { extraClass: 'revealed', tag: ev.success ? 'Match!' : 'No match' })}
        </div>
        <p class="secret-text">${esc(ev.text)}</p>
      </div>`;
  }

  function showNoticePanel(events, done) {
    numberKeys = null;
    showOverlay(`
      <div class="notice">
        ${events.map(noticeHtml).join('')}
        <button class="primary big" id="got-it">Got it</button>
      </div>`);
    const button = document.getElementById('got-it');
    button.addEventListener('click', done);
    button.focus();
  }

  // ---------- Hosting online ----------

  function renderHostStart(error = '') {
    leaveOnline();
    app.innerHTML = `
      <div class="setup">
        <h1 class="logo small">🗝️ Vault Raiders</h1>
        <h2>Host an online game</h2>
        <p class="small">You'll get a room code to share. Keep this page open while you play: your device runs the game.</p>
        <input id="name" class="wide" maxlength="16" placeholder="Your name" value="${esc(storageGet('vault.name') || '')}">
        ${error ? `<p class="error">${esc(error)}</p>` : ''}
        <button class="primary big" id="create">Create room</button>
        <button class="link" id="back">← Back</button>
      </div>`;
    document.getElementById('back').addEventListener('click', () => renderTitle());
    document.getElementById('create').addEventListener('click', () => {
      const name = document.getElementById('name').value.trim();
      if (!name) return renderHostStart('Enter your name first.');
      if (!Net.available()) return renderHostStart('Online play could not load. Check your internet connection and reload the page.');
      storageSet('vault.name', name);
      startHosting(name);
    });
  }

  function startHosting(name) {
    mode = 'host';
    me = 0;
    game = null;
    roomCode = '';
    lobby = [{ name, isHost: true }];
    ui = { message: '' };
    app.innerHTML = '<div class="setup"><h2>Opening a room…</h2></div>';
    net = Net.host({
      onReady: (code) => {
        roomCode = code;
        window.onbeforeunload = () => 'Leaving will end the online game for everyone.';
        hostTick();
      },
      onData: hostReceive,
      onDisconnect: (conn) => {
        const seat = lobby.find((s) => s.conn === conn);
        if (seat) { seat.conn = null; hostTick(); }
      },
      onError: (message) => {
        if (!roomCode) renderHostStart(message);
        else console.warn(message); // players already connected keep playing
      },
    });
  }

  function refuse(conn, message) {
    conn.send({ t: 'refused', message });
    setTimeout(() => conn.close(), 500);
  }

  // Give a seat to a new connection, shutting the old one if it's still hanging on.
  function takeSeat(seat, conn, clientId) {
    const old = seat.conn;
    seat.conn = conn;
    if (clientId) seat.clientId = clientId;
    if (old && old !== conn) {
      try { old.close(); } catch (e) { /* already gone */ }
    }
  }

  function hostReceive(conn, msg) {
    if (!msg || typeof msg !== 'object') return;

    if (msg.t === 'join') {
      const name = String(msg.name || '').trim().slice(0, 16) || 'Adventurer';
      const clientId = String(msg.clientId || '');
      const same = lobby.find((s) => s.name.toLowerCase() === name.toLowerCase());
      // A phone that drops out (screen lock, app switch, Wi-Fi blip) often
      // leaves its old connection looking open on the host for a long time,
      // so "still connected" can't be what blocks someone from coming back.
      const guestSeat = same && !same.isHost && !(same.isBot && !same.replaced);
      if (!game) {
        const sameDevice = guestSeat && clientId && same.clientId === clientId;
        const droppedOut = guestSeat && !(same.conn && same.conn.open);
        if (sameDevice || droppedOut) takeSeat(same, conn, clientId);
        else if (same) return refuse(conn, 'Someone in this room already has that name. Try another.');
        else if (lobby.length >= 6) return refuse(conn, 'This room is full (6 players).');
        else lobby.push({ name, conn, clientId });
      } else {
        // Mid-game, anyone who was playing can come back using the same name.
        if (!guestSeat) {
          return refuse(conn, 'This game has already started. Players who dropped out can rejoin with the same name.');
        }
        takeSeat(same, conn, clientId);
        if (same.replaced) {
          same.replaced = false;
          game.players[lobby.indexOf(same)].isBot = false;
        }
      }
      return hostTick();
    }

    if (msg.t === 'action' && game) {
      const seat = lobby.findIndex((s) => s.conn === conn);
      if (seat < 0 || game.players[seat].isBot) return;
      const action = msg.action || {};
      try {
        VR.applyAction(game, seat, { type: action.type, target: action.target });
      } catch (e) {
        conn.send({ t: 'error', message: e.message });
      }
      hostTick();
    }
  }

  function publicLobby() {
    return lobby.map((s) => ({
      name: s.name,
      isHost: !!s.isHost,
      isBot: !!s.isBot,
      connected: !!s.isHost || !!s.isBot || !!s.replaced || !!(s.conn && s.conn.open),
    }));
  }

  function broadcast() {
    const pub = publicLobby();
    lobby.forEach((s, i) => {
      if (!s.conn || !s.conn.open) return;
      s.conn.send({ t: 'sync', code: roomCode, you: i, lobby: pub, teaching, view: game ? VR.viewFor(game, i) : null });
    });
  }

  // After anything changes on the host: let computers move, send everyone their view, redraw.
  function hostTick() {
    stopTimers();
    if (game && waiting().some((i) => game.players[i].isBot)) {
      botTimer = setTimeout(() => { botMove(); hostTick(); }, BOT_DELAY);
    }
    broadcast();
    renderOnline();
  }

  function startOnlineGame() {
    // Drop anyone who left the lobby before starting.
    lobby = lobby.filter((s) => s.isHost || s.isBot || (s.conn && s.conn.open));
    lobby.forEach((s) => { s.replaced = false; });
    if (lobby.length < 2) return hostTick();
    game = VR.createGame({ players: lobby.map((s) => ({ name: s.name, isBot: !!s.isBot })), teaching });
    ui = { message: '' };
    hostTick();
  }

  // ---------- Joining online ----------

  function renderJoin(error = '', code) {
    leaveOnline();
    const params = new URLSearchParams(location.search);
    const prefill = code || params.get('join') || '';
    app.innerHTML = `
      <div class="setup">
        <h1 class="logo small">🗝️ Vault Raiders</h1>
        <h2>Join an online game</h2>
        <input id="name" class="wide" maxlength="16" placeholder="Your name" value="${esc(storageGet('vault.name') || '')}">
        <input id="code" class="wide code-input" maxlength="4" placeholder="Room code" value="${esc(prefill.toUpperCase())}" autocapitalize="characters">
        ${error ? `<p class="error">${esc(error)}</p>` : ''}
        <button class="primary big" id="join">Join</button>
        <button class="link" id="back">← Back</button>
      </div>`;
    document.getElementById('back').addEventListener('click', () => renderTitle());
    document.getElementById('join').addEventListener('click', () => {
      const name = document.getElementById('name').value.trim();
      const roomInput = document.getElementById('code').value.trim().toUpperCase();
      if (!name) return renderJoin('Enter your name first.', roomInput);
      if (!/^[A-Z]{4}$/.test(roomInput)) return renderJoin('Room codes are 4 letters.', roomInput);
      if (!Net.available()) return renderJoin('Online play could not load. Check your internet connection and reload the page.', roomInput);
      storageSet('vault.name', name);
      connectToRoom(name, roomInput);
    });
  }

  function connectToRoom(name, code) {
    leaveOnline();
    mode = 'client';
    lastJoin = { name, code };
    roomCode = code;
    if (!ui || ui.room !== code) ui = { message: '', room: code };
    app.innerHTML = `<div class="setup"><h2>Joining room ${esc(code)}…</h2></div>`;
    const conn = Net.join(code, {
      onOpen: () => conn.send({ t: 'join', name, clientId: deviceId() }),
      onData: clientReceive,
      onClose: () => { if (net === conn) renderLost(); },
      onError: (message) => {
        if (net !== conn) return;
        if (!game) renderJoin(message, code);
        else renderLost(message);
      },
    });
    net = conn;
  }

  function clientReceive(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'sync') {
      roomCode = msg.code;
      me = msg.you;
      lobby = msg.lobby;
      teaching = msg.teaching;
      game = msg.view;
      return renderOnline();
    }
    if (msg.t === 'error') {
      ui.message = msg.message;
      return renderOnline();
    }
    if (msg.t === 'refused') return renderJoin(msg.message, roomCode);
    if (msg.t === 'kicked') return renderTitle('The host removed you from the room.');
    if (msg.t === 'ended') return renderTitle('The host ended the game.');
  }

  function renderLost(message = '') {
    stopTimers();
    showOverlay(`
      <h2>📡 Lost connection to the host</h2>
      <p>${esc(message || 'The connection dropped. You can try to rejoin; your seat is saved.')}</p>
      <div class="row">
        <button class="primary big" id="rejoin">Rejoin</button>
        <button class="secondary big" id="menu">Main menu</button>
      </div>`);
    document.getElementById('rejoin').addEventListener('click', () => connectToRoom(lastJoin.name, lastJoin.code));
    document.getElementById('menu').addEventListener('click', () => renderTitle());
  }

  // Close any online connection. The host tells everyone the game is over first.
  function leaveOnline() {
    stopTimers();
    window.onbeforeunload = null;
    if (net) {
      const old = net;
      net = null;
      if (mode === 'host') {
        lobby.forEach((s) => { if (s.conn && s.conn.open) s.conn.send({ t: 'ended' }); });
        setTimeout(() => old.close(), 300);
      } else {
        old.close();
      }
    }
    mode = 'local';
    game = null;
    lobby = [];
    me = null;
  }

  // ---------- Online views ----------

  function renderOnline() {
    hideOverlay();
    if (!game) return renderLobby();
    // Each device steps through the flips at its own pace. The game doesn't
    // wait, so nobody holds up the other players.
    if (ui.seenSeq === undefined || ui.seenSeq > game.seq) ui.seenSeq = game.seq; // just arrived, or a new game
    const fresh = bigEvents(ui.seenSeq);
    if (fresh.length) {
      renderTable();
      return showNoticePanel(fresh, () => {
        ui.seenSeq = Math.max(...fresh.map((e) => e.seq));
        renderOnline();
      });
    }
    ui.seenSeq = game.seq;
    if (game.phase === 'gameOver') return renderGameOver();
    renderTable();
  }

  function renderLobby() {
    const host = isHost();
    const list = host ? publicLobby() : lobby;
    const link = `${location.origin}${location.pathname}?join=${roomCode}`;
    const icon = (s) => (s.isHost ? '👑' : s.isBot ? '🤖' : !s.connected ? '📴' : '🟢');
    app.innerHTML = `
      <div class="setup">
        <h1 class="logo small">🗝️ Vault Raiders</h1>
        <div class="room-code">Room code <b>${esc(roomCode)}</b></div>
        <p class="small">Others open the game, choose <b>Join an online game</b> and enter this code, or use this link:</p>
        <div class="seat">
          <input class="link-box" readonly value="${esc(link)}" aria-label="Invite link">
          <button class="secondary" id="copy">Copy</button>
        </div>
        <h3>Adventurers (${list.length}/6)</h3>
        <div class="seats">
          ${list.map((s, i) => `
            <div class="seat lobby-seat">
              <span><span class="seatno">${seatNumber(i)}</span> ${icon(s)} ${esc(s.name)}${i === me ? ' <i>(you)</i>' : ''}</span>
              ${host && i > 0 ? `<button class="icon-btn" data-remove="${i}" aria-label="Remove">✕</button>` : ''}
            </div>`).join('')}
        </div>
        ${host ? `
          <div class="row"><button class="secondary" id="add-bot" ${list.length >= 6 ? 'disabled' : ''}>+ Computer</button></div>
          <label class="check"><input type="checkbox" id="teaching" ${teaching ? 'checked' : ''}> Teaching mode (chances and hints)</label>
          <button class="primary big" id="start" ${list.length < 2 ? 'disabled' : ''}>Enter the dungeon</button>
          ${list.length < 2 ? '<p class="small">Waiting for at least one more adventurer…</p>' : ''}`
        : `<p>Waiting for the host to begin…</p>`}
        ${ui.message ? `<p class="error">${esc(ui.message)}</p>` : ''}
        <button class="link" id="leave">Leave room</button>
      </div>`;

    document.getElementById('copy').addEventListener('click', (e) => {
      const selectIt = () => app.querySelector('.link-box').select();
      if (!navigator.clipboard) return selectIt();
      navigator.clipboard.writeText(link).then(() => { e.target.textContent = 'Copied!'; }, selectIt);
    });
    document.getElementById('leave').addEventListener('click', () => renderTitle());
    if (!host) return;
    app.querySelectorAll('[data-remove]').forEach((el) => el.addEventListener('click', () => {
      const seat = lobby[+el.dataset.remove];
      if (seat.conn && seat.conn.open) {
        seat.conn.send({ t: 'kicked' });
        const c = seat.conn;
        setTimeout(() => c.close(), 300);
      }
      lobby.splice(+el.dataset.remove, 1);
      hostTick();
    }));
    document.getElementById('add-bot').addEventListener('click', () => {
      lobby.push({ name: freeBotName(lobby), isBot: true });
      hostTick();
    });
    document.getElementById('teaching').addEventListener('change', (e) => { teaching = e.target.checked; broadcast(); });
    document.getElementById('start').addEventListener('click', startOnlineGame);
  }

  // ---------- The table ----------

  function guideHtml() {
    const faceUp = (type) => game.stash.reduce((n, s) => n + VR.countOf(s, type), 0);
    return `
      <details class="guide" ${storageGet('vault.guideClosed') ? '' : 'open'}>
        <summary>📜 Treasure reference</summary>
        <table>
          <thead><tr><th>Treasure</th><th>Color</th><th title="Cards showing in everyone's stashes (12 of each in the game)">In stashes</th></tr></thead>
          <tbody>
            ${VR.TYPES.map((t) => `<tr><td class="nowrap"><span class="swatch t-${t}"></span> ${tLabel(t)}</td>
              <td>${esc(T(t).color)}</td><td>${faceUp(t)} / ${VR.COPIES}</td></tr>`).join('')}
          </tbody>
        </table>
        <p class="small"><b>Secure</b>: flip the top card into your stash; a match moves the whole set to your vault.
          <b>Raid</b>: flip it against someone's stash; a match steals the set into your stash, a miss gives them the card.
          First to ${VR.goal(game)} vault cards wins.</p>
      </details>`;
  }

  function statusText() {
    if (game.phase !== 'turn') return '';
    const p = game.turn;
    const again = game.again ? `🔁 Successful raid! ${nameOf(p)} takes another turn. ` : '';
    if (canControl(p)) return again;
    if (game.players[p].isBot) return `${again}🤖 ${nameOf(p)} is thinking…`;
    return `${again}Waiting for ${nameOf(p)} to choose…`;
  }

  function renderTable() {
    numberKeys = null;
    const seatInfo = online() ? (isHost() ? publicLobby() : lobby) : null;
    const back = VR.topBack(game);
    const goal = VR.goal(game);
    const n = game.players.length;
    const next = game.phase === 'turn' && !game.again ? (game.turn + 1) % n : null;

    const chip = (p, i) => {
      const away = seatInfo && seatInfo[i] && !seatInfo[i].connected;
      // The host can hand any guest's seat to a computer at any time (a drop-out
      // doesn't always show), and give it back.
      const guest = isHost() && lobby[i] && !lobby[i].isHost && !(lobby[i].isBot) && game.phase !== 'gameOver';
      let replaceBtn = '';
      if (guest && lobby[i].replaced) replaceBtn = `<button class="tiny" data-unreplace="${i}">↩ Back to ${nameOf(i)}</button>`;
      else if (guest) replaceBtn = `<button class="tiny" data-replace="${i}">🤖 Let a computer play</button>`;
      const vault = game.vault[i];
      const active = game.phase === 'turn' && game.turn === i;
      return `
        <div class="pchip ${active ? 'active' : ''} ${away ? 'away' : ''}">
          <div class="pname"><span class="seatno" title="Seat number">${seatNumber(i)}</span>
            ${p.isBot ? '🤖 ' : ''}${nameOf(i)}${online() && i === me ? ' (you)' : ''}${away ? ' 📴' : ''}
            ${active ? '<span class="tag now-tag">▶ Now</span>' : next === i ? '<span class="tag">Next</span>' : ''}</div>
          <div class="vault" title="Cards in the vault">
            <span>🏦 Vault <b>${vault.length}</b> / ${goal}</span>
            <div class="bar"><i style="width:${Math.min(100, (vault.length / goal) * 100)}%"></i></div>
          </div>
          ${seesVault(i) && vault.length ? `<div class="mine-vault small">Your vault (secret): ${stacksHtml(vault)}</div>` : ''}
          <div class="stash-label">Stash · ${game.stash[i].length} card${game.stash[i].length === 1 ? '' : 's'}</div>
          <div class="stacks">${stacksHtml(game.stash[i], back || [])}</div>
          ${replaceBtn}
        </div>`;
    };

    const log = game.log.slice().reverse();
    const status = statusText();
    const controls = controlsHtml();

    app.innerHTML = `
      <div class="table">
        <header class="topbar">
          <div><b>🗝️ Vault Raiders</b>${roomCode && online() ? ` · Room ${esc(roomCode)}` : ''}</div>
          <div class="top-actions">
            <button class="link" data-rules>Rules</button>
            ${mode === 'local' || isHost() ? `<button class="link" id="teach-toggle">${game.teaching ? 'Teaching: on' : 'Teaching: off'}</button>` : ''}
            <button class="link" id="quit">${online() ? 'Leave' : 'Quit'}</button>
          </div>
        </header>
        <div class="players">${game.players.map(chip).join('')}</div>
        <div class="dungeon">
          <div class="pile">
            ${back ? backHtml(back, { extraClass: 'top-card' }) : '<div class="card empty-pile">empty</div>'}
          </div>
          <div class="pile-label">
            <div><b>${game.deck.length}</b> card${game.deck.length === 1 ? '' : 's'} in the Dungeon Deck</div>
            ${back ? `<div class="small">The top card is <b>one</b> of these three treasures. Stashes with a
              <span class="stack lit sample">glow</span> could match it.</div>` : ''}
          </div>
        </div>
        ${status ? `<div class="status">${status}</div>` : ''}
        <div class="event"><div class="event-text">${game.lastEvent ? esc(game.lastEvent.text) : ''}</div></div>
        ${ui.message ? `<div class="message">${esc(ui.message)}</div>` : ''}
        ${controls.html}
        ${log.length > 1 ? `
          <details class="log">
            <summary>📖 What happened (${log.length})</summary>
            <ol reversed>${log.map((ev) => `<li>${esc(ev.text)}</li>`).join('')}</ol>
          </details>` : ''}
        ${guideHtml()}
      </div>`;

    app.querySelector('[data-rules]').addEventListener('click', showRules);
    app.querySelector('.guide').addEventListener('toggle', (e) => storageSet('vault.guideClosed', e.target.open ? '' : '1'));
    const toggle = document.getElementById('teach-toggle');
    if (toggle) toggle.addEventListener('click', () => {
      game.teaching = !game.teaching;
      teaching = game.teaching;
      rerender();
    });
    document.getElementById('quit').addEventListener('click', () => {
      const question = isHost() ? 'Leave? This ends the game for everyone.' : online() ? 'Leave this game?' : 'Quit this game?';
      if (confirm(question)) renderTitle();
    });
    app.querySelectorAll('[data-replace]').forEach((el) => el.addEventListener('click', () => {
      const i = +el.dataset.replace;
      if (lobby[i].conn && lobby[i].conn.open && !confirm(`Let a computer play for ${game.players[i].name}? They can rejoin to take their seat back.`)) return;
      lobby[i].replaced = true;
      game.players[i].isBot = true;
      hostTick();
    }));
    app.querySelectorAll('[data-unreplace]').forEach((el) => el.addEventListener('click', () => {
      const i = +el.dataset.unreplace;
      lobby[i].replaced = false;
      game.players[i].isBot = false;
      hostTick();
    }));

    controls.bind();
    // Finish choosing who to raid, if that was in progress.
    const c = ui.choosing;
    if (c && game.phase === 'turn' && game.turn === c.player && canControl(c.player)) showChooser();
    else ui.choosing = null;
  }

  // ---------- Choosing a move ----------

  // A short "works if it's 💎 or 🧪" line for a stash.
  function hitsText(hits, stash) {
    if (!hits.length) return '';
    return hits.map((t) => `${T(t).icon} ${esc(T(t).name)} (×${VR.countOf(stash, t)})`).join(' or ');
  }

  function controlsHtml() {
    const empty = { html: '', bind: () => {} };
    if (game.phase !== 'turn') return empty;
    const p = game.turn;
    if (!canControl(p)) return empty;
    const o = VR.options(game, p);
    const mine = game.stash[p];
    const several = mode === 'local' && humans().length > 1;
    const heading = several ? `🎯 ${nameOf(p)}'s turn` : '🎯 Your turn';
    const secureWhy = o.secure.hits.length
      ? `Matches your stash if it's ${hitsText(o.secure.hits, mine)}.`
      : 'None of the three treasures are in your stash, so nothing can be vaulted. The card just joins your stash.';
    const bestRaid = o.raids.reduce((best, r) => (!best || r.expected > best.expected ? r : best), null);
    const raidWhy = bestRaid && bestRaid.chance > 0
      ? `Best chance: ${nameOf(bestRaid.target)} has ${hitsText(bestRaid.hits, game.stash[bestRaid.target])}.`
      : 'No stash has any of the three treasures, so any raid would fail.';
    const chance = (p2) => (game.teaching ? `<span class="chance">${pct(p2)} chance</span>` : '');

    let hint = '';
    if (game.teaching) {
      const pick = Bots.chooseAction(game, p, { steady: true });
      const odds = Object.entries(o.chances).map(([t, x]) => `${T(t).icon} ${pct(x)}`).join(' · ');
      const what = pick.type === 'secure' ? '<b>Secure</b>' : `<b>Raid ${nameOf(pick.target)}</b>`;
      hint = `<p class="hint">💡 The top card is ${odds}, judging by how many of each are still unseen
        (12 of each, minus the ones showing in stashes${seesVault(p) ? ' and your vault' : ''}). A computer adventurer would choose ${what}.</p>`;
    }

    const html = `
      <div class="box">
        <h3>${heading}: say or press a number</h3>
        <div class="actions">
          <button class="action-btn" data-move="secure">
            <span class="num">1</span>
            <span class="a-main"><b>🔒 Secure your treasure</b>
              <span class="a-text">Flip the top card into your stash. If it matches, move the whole set to your vault.</span>
              <span class="a-why">${secureWhy} ${chance(o.secure.chance)}</span></span>
          </button>
          <button class="action-btn" data-move="raid">
            <span class="num">2</span>
            <span class="a-main"><b>🗡️ Raid an adventurer</b>
              <span class="a-text">Pick a player, then flip. If it matches their stash, steal the card and their whole set into your stash. If not, they keep the card.${game.players.length === 2 ? ' A successful raid earns another turn!' : ''}</span>
              <span class="a-why">${raidWhy} ${bestRaid && bestRaid.chance > 0 ? chance(bestRaid.chance) : ''}</span></span>
          </button>
        </div>
        ${hint}
      </div>`;
    const secureNow = () => act({ type: 'secure', player: p });
    const raidNow = () => { ui.choosing = { player: p }; rerender(); };
    const bind = () => {
      app.querySelector('[data-move="secure"]').addEventListener('click', secureNow);
      app.querySelector('[data-move="raid"]').addEventListener('click', raidNow);
      numberKeys = { 1: secureNow, 2: raidNow };
    };
    return { html, bind };
  }

  // Pick who to raid, by seat number.
  function showChooser() {
    const p = ui.choosing.player;
    const o = VR.options(game, p);
    showOverlay(`
      <h2>🗡️ ${mode === 'local' && humans().length > 1 ? `${nameOf(p)}: ` : ''}Who will you raid?</h2>
      <p>Say or press their <b>seat number</b>.</p>
      <div class="flip small-flip">${backHtml(VR.topBack(game))}</div>
      <div class="choices">
        ${o.raids.map((r) => `<button class="choice raid-choice" data-target="${r.target}">
          <span class="choice-top"><span class="seatno">${seatNumber(r.target)}</span> <b>${nameOf(r.target)}</b>
            <span class="small">🏦 ${game.vault[r.target].length}</span></span>
          <span class="stacks">${stacksHtml(game.stash[r.target], VR.topBack(game))}</span>
          <span class="small">${r.hits.length ? `Matches if it's ${hitsText(r.hits, game.stash[r.target])}` : 'Nothing matches: this raid would fail'}
            ${game.teaching ? ` · <b>${pct(r.chance)}</b>` : ''}</span>
        </button>`).join('')}
      </div>
      <button class="link" id="cancel">Cancel</button>`);
    const finish = (t) => act({ type: 'raid', player: p, target: t });
    overlay.querySelectorAll('[data-target]').forEach((el) => el.addEventListener('click', () => finish(+el.dataset.target)));
    document.getElementById('cancel').addEventListener('click', () => { ui.choosing = null; rerender(); });
    numberKeys = Object.fromEntries(o.raids.map((r) => [seatNumber(r.target), () => finish(r.target)]));
  }

  // ---------- End of the game ----------

  function renderGameOver() {
    renderTable();
    const winners = game.winners;
    const order = VR.ranking(game);
    const title = winners.length === 1 ? `🏆 ${nameOf(winners[0])} wins!` : `🏆 ${winners.map(nameOf).join(' and ')} share the victory!`;
    let buttons = '';
    if (mode === 'local') {
      buttons = '<button class="primary big" id="again">Play again</button><button class="secondary big" id="new">New setup</button>';
    } else if (isHost()) {
      buttons = '<button class="primary big" id="again">Play again</button><button class="secondary big" id="lobby">Back to the room</button>';
    } else if (mode === 'client') {
      buttons = '<p>Waiting for the host…</p><button class="secondary big" id="new">Leave</button>';
    }
    showOverlay(`
      <h2 class="crown big-crown">${title}</h2>
      <div class="event ending">${esc(game.endReason)}</div>
      <div class="ranking">
        ${order.map((i, place) => `
          <div class="played ${winners.includes(i) ? 'won' : ''}">
            <div class="by">${winners.includes(i) ? '🏆' : `#${place + 1}`} <b>${nameOf(i)}</b></div>
            <div>🏦 ${game.vault[i].length} in the vault · ${game.stash[i].length} in the stash</div>
            <div class="stacks">${stacksHtml(game.vault[i])}</div>
          </div>`).join('')}
      </div>
      <div class="row">${buttons}</div>`);
    const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
    on('again', mode === 'local' ? startLocalGame : startOnlineGame);
    on('new', () => (mode === 'local' ? renderSetup() : renderTitle()));
    on('lobby', () => { game = null; hostTick(); });
  }

  // ---------- Rules (its own layer, so the game keeps running underneath) ----------

  function showRules() {
    rulesLayer.innerHTML = `
      <div class="panel">
        <h2>How to play Vault Raiders</h2>
        <div class="rules">
          <p><b>The cards:</b> 84 Treasure Cards, 12 each of ${VR.TYPES.map(tLabel).join(', ')}.
            Every card is double-sided. The front shows one treasure. The back shows <b>three different treasures</b>,
            and one of them is the real treasure on the front.</p>
          <div class="flip">${backHtml(['gems', 'potions', 'weapons'])}<div class="flip-arrow">➜</div>${cardHtml({ type: 'potions' })}</div>
          <p><b>Setup:</b> everyone gets 4 cards, treasure side up. This is your <b>Treasure Stash</b>, and everyone can see it.
            The rest form the <b>Dungeon Deck</b>, three-treasure side up, so everyone can see the back of the top card.
            A random player goes first, then play goes around in seat order.</p>
          <p><b>Your turn:</b> choose one action.</p>
          <ul>
            <li><b>🔒 Secure your treasure:</b> flip the top card and add it to your stash. If it matches treasure already in
              your stash, move the new card and <b>all</b> your cards of that treasure into your <b>Treasure Vault</b>.
              If it doesn't match, it just stays in your stash.</li>
            <li><b>🗡️ Raid an adventurer:</b> choose a player, then flip the top card. If it matches treasure in their stash,
              take the new card and <b>all</b> their cards of that treasure into <b>your stash</b> (not your vault).
              If it doesn't match, the card goes into <b>their</b> stash. Oops, you helped them!</li>
          </ul>
          <p><b>Your vault</b> is secret: everyone can see how many cards are in it, but not which treasures.</p>
          <p><b>Tip:</b> look at the three treasures on the back of the top card. Do any match your stash? Someone else's?</p>
          <p><b>Winning:</b> the first player with <b>${VR.GOAL} or more</b> cards in their vault wins at once.
            If the Dungeon Deck runs out first, the most vault cards wins. A tie goes to the tied player with the most cards
            left in their stash.</p>
          <p><b>Two players:</b> the first to <b>${VR.GOAL_TWO}</b> vault cards wins, and when your raid finds a match you
            immediately take another turn. Keep raiding and matching to keep going!</p>
          <p><b>📺 Over a video call:</b> everything is face up, so share the screen. The player says <b>1</b> to Secure,
            or <b>2</b> and a seat number to Raid, and whoever is at the computer clicks it or types the number.</p>
          <p><b>Teaching mode</b> shows the chance of each move working. It counts how many of each of the three
            treasures are still unseen: 12 of each, minus the ones showing in stashes (and in your own vault).</p>
        </div>
        <button class="primary" id="close-rules">Close</button>
      </div>`;
    rulesLayer.classList.remove('hidden');
    document.getElementById('close-rules').addEventListener('click', () => {
      rulesLayer.classList.add('hidden');
      rulesLayer.innerHTML = '';
    });
  }

  // Start: an invite link, or the title screen.
  const params = new URLSearchParams(location.search);
  if (params.get('join')) renderJoin();
  else renderTitle();
})();
