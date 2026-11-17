// Online connections between devices, using PeerJS (WebRTC).
// The host's browser runs the real game; everyone else connects to it
// directly with a room code. PeerJS's free public server only helps the
// devices find each other; game messages go straight between browsers.

(function (root) {
  'use strict';

  const PREFIX = 'vaultraiders-room-';
  const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O, they look like 1 and 0
  const JOIN_TIMEOUT = 15000; // ms to wait for a connection before giving up

  // Relay servers (TURN) carry the game when two devices can't connect directly,
  // which is common between different networks. Put them here as
  // { urls, username, credential }. With none listed, only direct links work.
  const RELAY_SERVERS = [];

  function peerOptions() {
    if (!RELAY_SERVERS.length) return {};
    return { config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, ...RELAY_SERVERS] } };
  }

  function available() {
    return typeof root.Peer === 'function';
  }

  function makeCode() {
    let code = '';
    for (let i = 0; i < 4; i++) code += LETTERS[Math.floor(Math.random() * LETTERS.length)];
    return code;
  }

  function friendly(err) {
    switch (err && err.type) {
      case 'peer-unavailable': return 'No game found with that code. Check the code, and that the host still has the game open.';
      case 'network':
      case 'server-error':
      case 'socket-error':
      case 'socket-closed': return 'Could not reach the game server. Check your internet connection.';
      case 'browser-incompatible': return 'This browser does not support online play.';
      default: return 'Connection problem' + (err && err.type ? ` (${err.type})` : '') + '.';
    }
  }

  // Keep the link to PeerJS's matchmaking server alive if it drops.
  function keepAlive(peer) {
    peer.on('disconnected', () => { if (!peer.destroyed) peer.reconnect(); });
  }

  // Open a room. handlers: onReady(code), onData(conn, msg), onDisconnect(conn), onError(message)
  function host(handlers) {
    let peer;
    let tries = 0;
    function attempt() {
      const code = makeCode();
      peer = new root.Peer(PREFIX + code, peerOptions());
      keepAlive(peer);
      peer.on('open', () => handlers.onReady(code));
      peer.on('connection', (conn) => {
        conn.on('data', (msg) => handlers.onData(conn, msg));
        conn.on('close', () => handlers.onDisconnect(conn));
        conn.on('error', () => handlers.onDisconnect(conn));
      });
      peer.on('error', (err) => {
        if (err.type === 'unavailable-id' && tries++ < 5) {
          peer.destroy();
          attempt(); // that code is taken, try another
        } else {
          handlers.onError(friendly(err));
        }
      });
    }
    attempt();
    return { close: () => peer && peer.destroy() };
  }

  // Join a room. handlers: onOpen(), onData(msg), onClose(), onError(message)
  function join(code, handlers) {
    const peer = new root.Peer(peerOptions());
    let conn = null;
    let opened = false;
    let gaveUp = false;

    // Stop trying and tell the player. Destroying the peer closes the connection,
    // so gaveUp keeps that from also being reported as a lost connection.
    function fail(message) {
      if (gaveUp) return;
      gaveUp = true;
      clearTimeout(timer);
      peer.destroy();
      handlers.onError(message);
    }
    const noLink = 'Could not connect to the host. Check that the room code is right and the host still has the game open, then tap Join to try again.';
    const timer = setTimeout(() => fail(noLink), JOIN_TIMEOUT);

    keepAlive(peer);
    peer.on('open', () => {
      conn = peer.connect(PREFIX + code.toUpperCase(), { reliable: true });
      conn.on('open', () => {
        opened = true;
        clearTimeout(timer);
        handlers.onOpen();
      });
      conn.on('data', handlers.onData);
      conn.on('close', () => {
        if (gaveUp) return;
        if (opened) handlers.onClose();
        else fail(noLink);
      });
      conn.on('error', () => { if (!opened) fail(noLink); });
    });
    peer.on('error', (err) => {
      if (opened) handlers.onError(friendly(err));
      else fail(friendly(err));
    });
    return {
      send: (msg) => { if (conn && conn.open) conn.send(msg); },
      close: () => {
        gaveUp = true;
        clearTimeout(timer);
        peer.destroy();
      },
    };
  }

  root.Net = { available, host, join };
})(window);
