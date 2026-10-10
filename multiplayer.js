/* Host-authoritative duel. PeerJS provides signaling; gameplay uses WebRTC. */
(() => {
  const $ = id => document.getElementById(id);
  const status = $('networkStatus');
  const actions = ['left', 'right', 'jump', 'attack', 'skill', 'heal', 'extra', 'ultimate', 'meteor'];
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
  let hostCharacterId = null, guestCharacterId = null, guestPendingCharacterId = null;
  let selectionFirst = null;
  let onlineMatchStarted = false;
  function selectionTurn() {
    if (!selectionFirst || hostCharacterId !== null && guestCharacterId !== null) return null;
    if (hostCharacterId === null && guestCharacterId === null) return selectionFirst;
    return hostCharacterId === null ? 'host' : 'guest';
  }
  function localCharacterId() {
    return mode === 'host' ? hostCharacterId : mode === 'guest'
      ? guestPendingCharacterId || guestCharacterId
      : 1;
  }
  function onlineControlKey(characterId, action) {
    const character = players[characterId - 1];
    const playerOne = players[0];
    if (characterId === 1) {
      return character.controls[action === 'extra' ? 'hook' : action];
    }
    if (action === 'extra') return playerOne.controls.hook;
    if (action === 'heal') return playerOne.controls.ultimate;
    if (action === 'meteor') return 'f';
    return playerOne.controls[action];
  }
  function controlKey(player, action) {
    return mode === 'local' ? player.controls[action] : onlineControlKey(player.id, action);
  }
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
    return controlKey(player, action);
  }
  function apply(player, action, down) {
    if (!actions.includes(action)) return;
    if (action === 'ultimate' && player.id !== 1) return;
    if (action === 'heal' && player.id !== 2) return;
    if (action === 'meteor' && player.id !== 2) return;
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
    if (action === 'meteor') useMeteorStrike(player);
  }
  function input(action, down) {
    if (mode === 'host' && !localCharacterId()) return;
    if (down === held.has(action)) return;
    if (down) held.add(action); else held.delete(action);
    if (mode === 'guest') { if (connected) send({type:'input', action, down}); }
    else if (mode === 'local' || connected) {
      const playerId = mode === 'local' ? 1 : localCharacterId();
      apply(players[playerId - 1], action, down);
    }
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
    const localId = localCharacterId();
    const localPlayer = localId ? players[localId - 1] : null;
    const selectionReady = mode === 'local' || (hostCharacterId !== null && guestCharacterId !== null &&
      hostCharacterId !== guestCharacterId);
    $('startGame').disabled = mode !== 'local' && (!connected || mode === 'guest' || !selectionReady);
    $('characterSelect').hidden = mode === 'local' || !connected || onlineMatchStarted;
    $('touchControls').hidden = mode !== 'local' && !gameStarted;
    const turn = selectionTurn();
    $('characterSelectStatus').textContent = !selectionFirst
      ? '等待隨機決定選角順序'
      : hostCharacterId !== null && guestCharacterId !== null
        ? `角色已選定：玩家 ${hostCharacterId} 由房主操作，玩家 ${guestCharacterId} 由加入者操作`
        : turn === 'host'
          ? hostCharacterId === null && guestCharacterId === null
            ? '隨機結果：房主先選角'
            : '房主請選擇尚未被選取的角色'
          : turn === 'guest'
            ? hostCharacterId === null && guestCharacterId === null
              ? '隨機結果：加入者先選角'
              : '加入者請選擇尚未被選取的角色'
            : '等待對方完成選角';
    document.querySelectorAll('[data-character]').forEach(button => {
      const characterId = Number(button.dataset.character);
      const ownId = mode === 'host' ? hostCharacterId : guestPendingCharacterId || guestCharacterId;
      const otherId = mode === 'host' ? guestCharacterId : hostCharacterId;
      button.classList.toggle('selected', ownId === characterId);
      button.disabled = !connected || onlineMatchStarted || turn !== mode ||
        (mode === 'guest' && guestPendingCharacterId !== null) ||
        (otherId === characterId && ownId !== characterId);
    });
    document.querySelector('[data-action="skill"]').textContent = localPlayer?.id === 2 ? '波動拳 (G)' : '瞬移 (G)';
    document.querySelector('[data-action="heal"]').hidden = localPlayer?.id !== 2;
    document.querySelector('[data-action="extra"]').textContent = localPlayer?.id === 2 ? '隱分身 (Y)' : '勾索 (Y)';
    document.querySelector('[data-action="meteor"]').hidden = localPlayer?.id !== 2;
    document.querySelector('[data-action="meteor"]').textContent = '隕石 (F)';
    document.querySelector('[data-action="ultimate"]').hidden = localPlayer?.id !== 1;
    document.querySelector('[data-action="ultimate"]').textContent = '大招 (U)';
    $('meteorKeyLabel').textContent = mode === 'guest' ? 'F' : mode === 'host' ? 'F' : '7';
    $('player2LocalControls').hidden = mode !== 'local';
    $('player2OnlineControls').hidden = mode === 'local';
  }
  function stop(text = '已離開連線 · 單機模式') {
    generation++;
    clearTimeout(timeout);
    release();
    connected = false;
    connection?.close(); peer?.destroy();
    peer = connection = null;
    mode = 'local';
    hostCharacterId = guestCharacterId = guestPendingCharacterId = null;
    selectionFirst = null;
    onlineMatchStarted = false;
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
      meteorCooldown: player.meteorCooldown,
      ultimateCooldown: player.ultimateCooldown,
      ultimateState: player.ultimateState,
      attackHit: [...player.attackHit],
    }));
    return {
      type:'state',
      selectionFirst,
      hostCharacterId,
      guestCharacterId,
      onlineMatchStarted,
      players:playerState,
      projectiles:identifiedStates(projectiles.slice(-100)),
      hooks:identifiedStates(hooks.slice(-20)),
      decoys:identifiedStates(decoys.slice(-20)),
      meteors:identifiedStates(meteors),
      craters:identifiedStates(craters),
      effects:identifiedStates(effects
        .filter(effect => ['ring', 'rift', 'void', 'heal', 'flame'].includes(effect.type))
        .slice(-MAX_SYNCED_EFFECTS)),
      gameStarted,
      gameOver,
      matchScore,
      matchOver,
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
    [projectiles,hooks,decoys,meteors,craters,effects].forEach((list,i) => {
      const source = data[['projectiles','hooks','decoys','meteors','craters','effects'][i]];
      if (Array.isArray(source)) list.splice(0,list.length,...source.slice(0,500));
    });
    if (mode === 'guest') {
      const entityPositions = [projectiles, hooks, decoys, meteors, craters, effects].map(entities =>
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
    if (Number.isInteger(data.hostCharacterId) && [1, 2].includes(data.hostCharacterId)) {
      hostCharacterId = data.hostCharacterId;
    }
    if (Number.isInteger(data.guestCharacterId) && [1, 2].includes(data.guestCharacterId)) {
      guestCharacterId = data.guestCharacterId;
      if (guestPendingCharacterId === guestCharacterId) guestPendingCharacterId = null;
    } else {
      guestCharacterId = null;
    }
    if (data.selectionFirst === 'host' || data.selectionFirst === 'guest') {
      selectionFirst = data.selectionFirst;
    }
    onlineMatchStarted = !!data.onlineMatchStarted;
    if (Array.isArray(data.matchScore) && data.matchScore.length === 2 &&
      data.matchScore.every(score => Number.isInteger(score) && score >= 0)) {
      matchScore = data.matchScore;
    }
    matchOver = !!data.matchOver;
    screenShakeTimer = Number(data.screenShakeTimer) || 0;
    message.textContent = String(data.message || '');
    updateHealthUI();
    ui();
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
    [projectiles, hooks, decoys, meteors, craters, effects].forEach((entities, listIndex) => {
      const startPositions = new Map(from.entities[listIndex].map(entity => [entity.networkId, entity]));
      const endPositions = new Map(to.entities[listIndex].map(entity => [entity.networkId, entity]));
      entities.forEach((entity, index) => {
        const networkId = entity.networkId ?? `index-${index}`;
        const start = startPositions.get(networkId);
        const end = endPositions.get(networkId);
        if (!start || !end) return;
        entity.x = start.x + (end.x - start.x) * progress;
        entity.y = start.y + (end.y - start.y) * progress;
      });
    });
  }
  function attach(conn, token) {
    connection = conn;
    conn.on('open', () => {
      if (token !== generation) return;
      clearTimeout(timeout); connected = true; lastSeen = performance.now();
      release(); keys.clear();
      if (mode === 'host') selectionFirst = Math.random() < 0.5 ? 'host' : 'guest';
      status.textContent = '已連線 · 隨機決定選角順序';
      ui();
      if (mode === 'host') send(snapshot(), true);
    });
    conn.on('data', data => {
      if (token !== generation || !connected || !data || typeof data !== 'object') return;
      lastSeen = performance.now();
      if (mode === 'guest' && data.type === 'state') receiveState(data);
      if (mode === 'host' && data.type === 'pick' && !onlineMatchStarted &&
        Number.isInteger(data.characterId) && [1, 2].includes(data.characterId) &&
        selectionTurn() === 'guest' && data.characterId !== hostCharacterId) {
        guestCharacterId = data.characterId;
        hostCharacterId = 3 - guestCharacterId;
        start();
      }
      if (mode === 'host' && data.type === 'input' && typeof data.down === 'boolean' &&
        guestCharacterId !== null) apply(players[guestCharacterId - 1],data.action,data.down);
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
        status.textContent = `房號 ${room} · 等待另一支手機加入`;
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
    if (mode === 'guest' || (mode === 'host' && (!connected || !hostCharacterId ||
      !guestCharacterId || hostCharacterId === guestCharacterId))) return;
    if (gameStarted && !gameOver) return;
    if (mode === 'host') onlineMatchStarted = true;
    release(); keys.clear(); startNextGame();
    ui();
    if (mode === 'host') send(snapshot(), true);
  }
  function chooseCharacter(characterId) {
    if (!connected || onlineMatchStarted || selectionTurn() !== mode || ![1, 2].includes(characterId)) return;
    if (mode === 'host') {
      if (characterId === guestCharacterId) return;
      hostCharacterId = characterId;
      guestCharacterId = 3 - characterId;
      start();
    } else if (mode === 'guest' && characterId !== hostCharacterId) {
      guestPendingCharacterId = characterId;
      send({type:'pick', characterId});
      status.textContent = '已送出角色選擇，等待確認';
    }
    ui();
  }
  $('createRoom').onclick = () => begin(true);
  $('joinRoom').onclick = () => begin(false);
  $('leaveRoom').onclick = () => stop();
  $('startGame').onclick = start;
  document.querySelectorAll('[data-character]').forEach(button => {
    button.addEventListener('click', () => chooseCharacter(Number(button.dataset.character)));
  });
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
    controlKey,
    keyboard(event,down) {
      if (mode === 'local') return false;
      if (event.code === 'Space') { event.preventDefault(); if (down && !event.repeat) start(); return true; }
      const key = event.key.toLowerCase();
      const characterId = localCharacterId();
      const action = characterId && actions.find(a => onlineControlKey(characterId,a) === key);
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
