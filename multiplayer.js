/* Host-authoritative duel. PeerJS provides signaling; gameplay uses WebRTC. */
(() => {
  const $ = id => document.getElementById(id);
  const status = $('networkStatus');
  const actions = ['left', 'right', 'jump', 'attack', 'skill', 'heal', 'extra', 'ultimate'];
  const STATE_UPDATE_INTERVAL = 1000 / 20;
  const GUEST_INTERPOLATION_DELAY = 75;
  const MAX_BUFFERED_STATE_BYTES = 128 * 1024;
  const MAX_SYNCED_EFFECTS = 32;
  let mode = 'local', peer = null, connection = null, generation = 0;
  let connected = false, lastSeen = 0, lastSend = 0, timeout;
  const held = new Set();
  const pointers = new Map();
  const guestPositionBuffer = [];
  const networkIds = new WeakMap();
  let nextNetworkId = 0;
  function identifiedStates(entities) {
    return entities.map(entity => {
      let networkId = networkIds.get(entity);
      if (networkId === undefined) {
        networkId = ++nextNetworkId;
        networkIds.set(entity, networkId);
      }
      return { ...entity, networkId };
    });
  }
  function send(data, isState = false) {
    if (!connection?.open) return;
    if (isState && connection.dataChannel?.bufferedAmount > MAX_BUFFERED_STATE_BYTES) return;
    connection.send(data);
  }
  function controls(player, action) {
    return player.controls[action === 'extra' ? (player.id === 1 ? 'hook' : 'decoy') : action];
  }
  function apply(player, action, down) {
    if (!actions.includes(action)) return;
    if (action === 'ultimate' && player.id !== 1) return;
    const key = controls(player, action);
    if (!down) { keys.delete(key); return; }
    if (!gameStarted || gameOver || keys.has(key)) return;
    keys.add(key);
    if (action === 'jump') jumpPlayer(player);
    if (action === 'attack') attackPlayer(player);
    if (action === 'skill') useSkill(player);
    if (action === 'heal') useHeal(player);
    if (action === 'extra') (player.id === 1 ? useHook : useDecoys)(player);
    if (action === 'ultimate') useUltimate(player);
  }
  function input(action, down) {
    if (down === held.has(action)) return;
    if (down) held.add(action); else held.delete(action);
    if (mode === 'guest') { if (connected) send({type:'input', action, down}); }
    else if (mode === 'local' || connected) apply(players[0], action, down);
  }
  function release() {
    for (const action of [...held]) input(action, false);
    pointers.clear();
    if (mode !== 'guest') keys.clear();
  }
  function ui() {
    $('leaveRoom').hidden = mode === 'local';
    $('createRoom').disabled = $('joinRoom').disabled = mode !== 'local';
    $('roomCode').readOnly = mode !== 'local';
    $('startGame').disabled = mode !== 'local' && (!connected || mode === 'guest');
    document.querySelector('[data-action="skill"]').textContent = mode === 'guest' ? '波動拳' : '瞬移 (G)';
    document.querySelector('[data-action="heal"]').hidden = mode !== 'guest';
    document.querySelector('[data-action="extra"]').textContent = mode === 'guest' ? '隱分身' : '勾索 (Y)';
  }
  function stop(text = '已離開連線 · 單機模式') {
    generation++;
    clearTimeout(timeout);
    release();
    connected = false;
    connection?.close(); peer?.destroy();
    peer = connection = null;
    mode = 'local';
    guestPositionBuffer.length = 0;
    keys.clear(); gameStarted = false;
    message.textContent = '按「開始遊戲」開始單機對戰';
    status.textContent = text;
    ui();
  }
  function snapshot() {
    const playerState = players.map(player => ({
      id: player.id,
      x: player.x,
      y: player.y,
      vx: player.vx,
      vy: player.vy,
      facing: player.facing,
      health: player.health,
      onGround: player.onGround,
      jumpsRemaining: player.jumpsRemaining,
      attackTimer: player.attackTimer,
      hitFlash: player.hitFlash,
      skillCooldown: player.skillCooldown,
      skillCharges: player.skillCharges,
      skillRechargeTimer: player.skillRechargeTimer,
      hookCooldown: player.hookCooldown,
      healCooldown: player.healCooldown,
      decoyCooldown: player.decoyCooldown,
      ultimateCooldown: player.ultimateCooldown,
      ultimateState: player.ultimateState,
      attackHit: [...player.attackHit],
    }));
    return {
      type:'state',
      players:playerState,
      projectiles:identifiedStates(projectiles.slice(-100)),
      hooks:identifiedStates(hooks.slice(-20)),
      decoys:identifiedStates(decoys.slice(-20)),
      effects:identifiedStates(effects
        .filter(effect => ['ring', 'rift', 'void', 'heal', 'flame'].includes(effect.type))
        .slice(-MAX_SYNCED_EFFECTS)),
      gameStarted,
      gameOver,
      screenShakeTimer,
      message:message.textContent,
    };
  }
  function receiveState(data) {
    if (!Array.isArray(data.players) || data.players.length !== 2) return;
    players.forEach((p,i) => {
      const incoming = data.players[i];
      // Keep local identity/control bindings; only copy known simulation fields.
      for (const key of Object.keys(p)) {
        if (['controls','id','color','attackHit'].includes(key)) continue;
        if (typeof incoming[key] === typeof p[key]) p[key] = incoming[key];
      }
      p.attackHit = new Set(incoming.attackHit || []);
    });
    [projectiles,hooks,decoys,effects].forEach((list,i) => {
      const source = data[['projectiles','hooks','decoys','effects'][i]];
      if (Array.isArray(source)) list.splice(0,list.length,...source.slice(0,500));
    });
    if (mode === 'guest') {
      const entityPositions = [projectiles, hooks, decoys, effects].map(entities =>
        entities.map((entity, index) => ({
          networkId: entity.networkId ?? `index-${index}`,
          x: entity.x,
          y: entity.y,
        })),
      );
      guestPositionBuffer.push({
        time: performance.now(),
        players: players.map(({ x, y }) => ({ x, y })),
        entities: entityPositions,
      });
      if (guestPositionBuffer.length > 10) guestPositionBuffer.shift();
    }
    gameStarted = !!data.gameStarted; gameOver = !!data.gameOver;
    screenShakeTimer = Number(data.screenShakeTimer) || 0;
    message.textContent = String(data.message || '');
    updateHealthUI();
  }
  function interpolateGuestPositions(now) {
    if (mode !== 'guest' || guestPositionBuffer.length < 2) return;
    const renderTime = now - GUEST_INTERPOLATION_DELAY;
    while (guestPositionBuffer.length > 2 && guestPositionBuffer[1].time <= renderTime) {
      guestPositionBuffer.shift();
    }
    const [from, to] = guestPositionBuffer;
    const duration = to.time - from.time;
    const progress = duration > 0
      ? Math.max(0, Math.min(1, (renderTime - from.time) / duration))
      : 1;
    players.forEach((player, index) => {
      const start = from.players[index];
      const end = to.players[index];
      player.x = start.x + (end.x - start.x) * progress;
      player.y = start.y + (end.y - start.y) * progress;
    });
    [projectiles, hooks, decoys, effects].forEach((entities, listIndex) => {
      const previous = new Map(from.entities[listIndex].map(entity => [entity.networkId, entity]));
      entities.forEach((entity, index) => {
        const start = previous.get(entity.networkId ?? `index-${index}`);
        if (!start) return;
        entity.x = start.x + (entity.x - start.x) * progress;
        entity.y = start.y + (entity.y - start.y) * progress;
      });
    });
  }
  function attach(conn, token) {
    connection = conn;
    conn.on('open', () => {
      if (token !== generation) return;
      clearTimeout(timeout); connected = true; lastSeen = performance.now();
      release(); keys.clear();
      status.textContent = mode === 'host' ? '已連線 · 你是玩家 1（紅色），可開始遊戲' : '已連線 · 你是玩家 2（藍色），等待房主開始';
      ui();
      if (mode === 'host') send(snapshot(), true);
    });
    conn.on('data', data => {
      if (token !== generation || !connected || !data || typeof data !== 'object') return;
      lastSeen = performance.now();
      if (mode === 'guest' && data.type === 'state') receiveState(data);
      if (mode === 'host' && data.type === 'input' && typeof data.down === 'boolean') apply(players[1],data.action,data.down);
    });
    conn.on('close', () => { if (token === generation) stop('對方已離線，對戰已停止。請重新建立或加入房間。'); });
    conn.on('error', () => { if (token === generation) stop('對戰連線失敗，請重新建立房間。'); });
  }
  function begin(host) {
    const code = $('roomCode').value.trim().toUpperCase();
    if (!host && !/^[A-F0-9]{8}$/.test(code)) { status.textContent = '請輸入完整的 8 碼房號'; return; }
    if (!window.Peer) { status.textContent = '連線程式未載入，請重新整理頁面'; return; }
    stop(); mode = host ? 'host' : 'guest';
    const token = generation;
    const room = host ? [...crypto.getRandomValues(new Uint8Array(4))].map(n=>n.toString(16).padStart(2,'0')).join('').toUpperCase() : code;
    $('roomCode').value = room;
    status.textContent = '正在連線…'; ui();
    try { peer = new Peer(host ? 'fight-v1-'+room : undefined); }
    catch { stop('此瀏覽器無法建立連線，請改用新版 Safari 或 Chrome。'); return; }
    timeout = setTimeout(() => { if (token === generation) stop('連線逾時。請確認房號，或讓兩支手機使用同一個 Wi-Fi 再試。'); }, 25000);
    peer.on('open', () => {
      if (token !== generation) return;
      if (host) {
        clearTimeout(timeout);
        status.textContent = `房號 ${room} · 你是玩家 1，等待另一支手機加入`;
      } else attach(peer.connect('fight-v1-'+room, {reliable:true, serialization:'json'}),token);
    });
    peer.on('connection', conn => {
      if (token !== generation || !host || connection) { conn.on('open',()=>conn.close()); return; }
      attach(conn,token);
      timeout = setTimeout(() => { if (!connected && token === generation) stop('對方連線逾時，請重建房間。'); },25000);
    });
    peer.on('error', error => {
      if (token !== generation) return;
      const reasons = {'peer-unavailable':'找不到房間，請確認房號及房主仍在線上。','unavailable-id':'房號重複，請重新建立房間。'};
      stop(reasons[error.type] || '無法連線。請檢查網路，或改用同一個 Wi-Fi 再試。');
    });
    peer.on('disconnected', () => { if (token === generation && !connected) stop('房間服務已斷線，請重新建立或加入。'); });
  }
  function start() {
    if (mode === 'guest' || (mode === 'host' && !connected)) return;
    if (gameStarted && !gameOver) return;
    release(); keys.clear(); resetGame();
    if (mode === 'host') send(snapshot(), true);
  }
  $('createRoom').onclick = () => begin(true);
  $('joinRoom').onclick = () => begin(false);
  $('leaveRoom').onclick = () => stop();
  $('startGame').onclick = start;
  document.querySelectorAll('[data-action]').forEach(button => {
    button.addEventListener('pointerdown', event => {
      event.preventDefault(); button.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId,button.dataset.action); input(button.dataset.action,true);
    });
    const up = event => {
      const action = pointers.get(event.pointerId); pointers.delete(event.pointerId);
      if (action && ![...pointers.values()].includes(action)) input(action,false);
    };
    ['pointerup','pointercancel','lostpointercapture'].forEach(type => button.addEventListener(type,up));
    button.addEventListener('contextmenu',e=>e.preventDefault());
  });
  window.addEventListener('blur',release);
  document.addEventListener('visibilitychange', () => {
    release();
    if (document.hidden && mode !== 'local') stop('頁面已切換至背景，對戰已停止。回來後請重新連線。');
  });
  window.duel = {
    canSimulate: () => mode === 'local' || (mode === 'host' && connected),
    keyboard(event,down) {
      if (mode === 'local') return false;
      if (event.code === 'Space') { event.preventDefault(); if (down && !event.repeat) start(); return true; }
      const key = event.key.toLowerCase();
      const action = actions.find(a => controls(players[mode === 'guest' ? 1 : 0],a) === key);
      if (action) { event.preventDefault(); if (!event.repeat) input(action,down); }
      return true;
    },
    tick(now) {
      if (!connected) return;
      if (now-lastSeen > 10000) { stop('連線中斷，對戰已停止。請重新連線。'); return; }
      interpolateGuestPositions(now);
      if (now-lastSend >= (mode === 'host' ? STATE_UPDATE_INTERVAL : 1000)) {
        lastSend = now;
        if (mode === 'host') send(snapshot(), true);
        else send({type:'heartbeat'});
      }
    }
  };
  ui();
})();
