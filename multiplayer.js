/* Host-authoritative duel. PeerJS provides signaling; gameplay uses WebRTC. */
(() => {
  const $ = id => document.getElementById(id);
  const status = $('networkStatus');
  const statusTitle = $('networkStatusTitle');
  const statusDetail = $('networkStatusDetail');
  const actions = ['left', 'right', 'jump', 'attack', 'skill', 'heavy', 'vampiric', 'heal', 'extra', 'ultimate', 'meteor', 'defend'];
  const ONLINE_DEFENSE_KEY = 'q';
  const STATE_UPDATE_INTERVAL = 1000 / 20;
  const GUEST_INTERPOLATION_DELAY = 75;
  const MAX_BUFFERED_STATE_BYTES = 128 * 1024;
  const MAX_SYNCED_EFFECTS = 32;
  let mode = 'local', peer = null, connection = null, generation = 0;
  let botDifficulty = 'normal', botPlayerCharacter = 1, botOpponentCharacter = 2;
  const botDifficultySettings = {
    easy: { label: '新手', reaction: 1050, attackChance: 0.22, skillChance: 0.08 },
    normal: { label: '普通', reaction: 700, attackChance: 0.38, skillChance: 0.16 },
    hard: { label: '困難', reaction: 400, attackChance: 0.58, skillChance: 0.28 },
    boss: { label: '魔王', reaction: 180, attackChance: 0.82, skillChance: 0.48 },
  };
  let botActionTimer = 0;
  let connected = false, lastSeen = 0, lastSend = 0, timeout;
  let lastMovementStateSend = 0;
  const held = new Set();
  const pointers = new Map();
  const guestPositionBuffer = [];
  const networkIds = new WeakMap();
  let nextNetworkId = 0;
  let hostCharacterId = null, guestCharacterId = null, guestPendingCharacterId = null;
  let selectionFirst = null;
  let onlineMatchStarted = false;
  let countdownEndsAt = 0, fightTextUntil = 0;
  let lastCountdownSend = 0;
  function setNetworkStatus(state, title, detail) {
    status.dataset.state = state;
    statusTitle.textContent = title;
    statusDetail.textContent = detail;
    $('gameNetworkStatus').textContent = detail ? `${title} · ${detail}` : title;
  }
  function enterBotSetup() {
    $('botPanel').hidden = false;
    $('onlinePanel').hidden = true;
  }
  function startBotGame() {
    mode = 'bot';
    botDifficulty = $('botDifficulty').value;
    release();
    keys.clear();
    botActionTimer = 0;
    startNextGame();
    countdownEndsAt = performance.now() + 3000;
    fightTextUntil = 0;
    message.textContent = '機器人決鬥開始！擊倒對手獲勝。';
    window.duel?.startAudio();
    showGameScreen();
    enterFullscreen();
    setNetworkStatus('connected', '機器人決鬥', `${botDifficultySettings[botDifficulty].label}難度 · 倒數後開始`);
    ui();
  }
  function selectionTurn() {
    if (!selectionFirst || hostCharacterId !== null && guestCharacterId !== null) return null;
    if (hostCharacterId === null && guestCharacterId === null) return selectionFirst;
    return hostCharacterId === null ? 'host' : 'guest';
  }
  function showMenuScreen() {
    $('menuScreen').hidden = false;
    $('gameScreen').hidden = true;
  }
  function showGameScreen() {
    $('menuScreen').hidden = true;
    $('gameScreen').hidden = false;
  }
  async function enterFullscreen() {
    const gameScreen = $('gameScreen');
    if (!gameScreen.requestFullscreen) return;
    try {
      await gameScreen.requestFullscreen();
    } catch (error) {
      const button = $('fullscreenToggle');
      button.title = error instanceof Error ? error.message : '瀏覽器拒絕全螢幕請求';
    }
  }
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await enterFullscreen();
      }
    } catch (error) {
      $('fullscreenToggle').title = error instanceof Error ? error.message : '無法切換全螢幕';
    }
  }
  function updateFullscreenButton() {
    const button = $('fullscreenToggle');
    const supported = Boolean(document.fullscreenEnabled && $('gameScreen').requestFullscreen);
    button.hidden = !supported;
    button.textContent = document.fullscreenElement ? '退出全螢幕' : '進入全螢幕';
  }
  function localCharacterId() {
    return mode === 'host' ? hostCharacterId : mode === 'guest'
      ? guestPendingCharacterId || guestCharacterId
      : mode === 'bot' ? botPlayerCharacter : 1;
  }
  function botPlayerId() { return botPlayerCharacter; }
  function botOpponentId() { return botOpponentCharacter; }
  function onlineControlKey(characterId, action) {
    const character = players[characterId - 1];
    const playerOne = players[0];
    if (action === 'defend') return ONLINE_DEFENSE_KEY;
    if (characterId === 1) {
      if (['heal', 'meteor', 'decoy'].includes(action)) return null;
      return character.controls[action === 'extra' ? 'hook' : action];
    }
    if (['heavy', 'vampiric', 'ultimate'].includes(action)) return null;
    if (action === 'extra') return playerOne.controls.hook;
    if (action === 'heal') return playerOne.controls.ultimate;
    if (action === 'meteor') return 'f';
    return playerOne.controls[action];
  }
  function controlKey(player, action) {
    return mode === 'local' ? player.controls[action] : onlineControlKey(player.id, action);
  }
  function actionInputKey(player, action) {
    return mode === 'local' || mode === 'bot' ? controlKey(player, action) : `online:${player.id}:${action}`;
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
  function syncCountdown(data) {
    if (mode !== 'guest') return;
    const now = performance.now();
    const countdownMs = Number(data.countdownMs);
    const fightTextMs = Number(data.fightTextMs);
    countdownEndsAt = Number.isFinite(countdownMs) && countdownMs > 0
      ? now + countdownMs
      : 0;
    fightTextUntil = countdownEndsAt === 0 && Number.isFinite(fightTextMs) && fightTextMs > 0
      ? now + fightTextMs
      : 0;
  }
  function send(data, isState = false) {
    if (!connection?.open) return;
    if (isState && connection.dataChannel?.bufferedAmount > MAX_BUFFERED_STATE_BYTES) return;
    connection.send(data);
  }
  function apply(player, action, down) {
    if (!actions.includes(action)) return;
    if (action === 'ultimate' && player.id !== 1) return;
    if (action === 'heal' && player.id !== 2) return;
    if (action === 'meteor' && player.id !== 2) return;
    if (action === 'heavy' && player.id !== 1) return;
    if (action === 'vampiric' && player.id !== 1) return;
    const key = actionInputKey(player, action);
    if (!down) { keys.delete(key); return; }
    if (!gameStarted || gameOver ||
      (countdownEndsAt > performance.now() && action !== 'left' && action !== 'right') ||
      keys.has(key)) return;
    keys.add(key);
    if (action === 'jump') jumpPlayer(player);
    if (action === 'attack') attackPlayer(player);
    if (action === 'skill') useSkill(player);
    if (action === 'heavy') useHeavyAttack(player);
    if (action === 'vampiric') useVampiric(player);
    if (action === 'heal') useHeal(player);
    if (action === 'extra') (player.id === 1 ? useHook : useDecoys)(player);
    if (action === 'ultimate') useUltimate(player);
    if (action === 'meteor') useMeteorStrike(player);
    if (action === 'defend') useDefense(player);
  }
  function sendGuestMovementState(now = performance.now()) {
    send({
      type:'movementState',
      left:held.has('left'),
      right:held.has('right'),
    });
    lastMovementStateSend = now;
  }
  function input(action, down) {
    if (mode === 'host' && !localCharacterId()) return;
    if (down === held.has(action)) return;
    if (down) held.add(action); else held.delete(action);
    if (mode === 'guest' && connected) {
      if (action === 'left' || action === 'right') sendGuestMovementState();
      else send({type:'input', action, down});
    }
    else if (mode === 'local' || mode === 'bot' || connected) {
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
    $('createRoom').disabled = $('joinRoom').disabled = mode !== 'local';
    $('roomCode').readOnly = mode !== 'local';
    const localId = localCharacterId();
    const localPlayer = localId ? players[localId - 1] : null;
    const selectionReady = mode === 'local' || (hostCharacterId !== null && guestCharacterId !== null &&
      hostCharacterId !== guestCharacterId);
    $('startGame').disabled = mode !== 'local' && mode !== 'bot' && (!connected || mode === 'guest' || !selectionReady);
    $('startGame').hidden = mode === 'guest' || !gameOver || matchOver;
    $('startGame').textContent = gameOver ? '重新開始' : '開始遊戲';
    $('matchResultRestart').disabled = mode === 'guest';
    $('characterSelect').hidden = mode === 'local' || mode === 'bot' || !connected || onlineMatchStarted;
    $('touchControls').hidden = mode !== 'local' && mode !== 'bot' && !gameStarted;
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
    document.querySelector('[data-action="heavy"]').hidden = localPlayer?.id !== 1;
    document.querySelector('[data-action="heavy"]').textContent = '重擊 (F)';
    document.querySelector('[data-action="vampiric"]').hidden = localPlayer?.id !== 1;
    document.querySelector('[data-action="vampiric"]').textContent = '吸血 (E)';
    document.querySelector('[data-action="heal"]').hidden = localPlayer?.id !== 2;
    document.querySelector('[data-action="extra"]').textContent = localPlayer?.id === 2 ? '隱分身 (Y)' : '勾索 (Y)';
    document.querySelector('[data-action="meteor"]').hidden = localPlayer?.id !== 2;
    document.querySelector('[data-action="meteor"]').textContent = '隕石 (F)';
    document.querySelector('[data-action="ultimate"]').hidden = localPlayer?.id !== 1;
    document.querySelector('[data-action="ultimate"]').textContent = '大招 (U)';
    $('meteorKeyLabel').textContent = mode === 'guest' ? 'F' : mode === 'host' ? 'F' : '7';
  }
  function stop(text = '已離開連線 · 單機模式', statusState = 'idle') {
    generation++;
    clearTimeout(timeout);
    release();
    window.duel?.stopAudio();
    connected = false;
    connection?.close(); peer?.destroy();
    peer = connection = null;
    mode = 'local';
    hostCharacterId = guestCharacterId = guestPendingCharacterId = null;
    selectionFirst = null;
    onlineMatchStarted = false;
    countdownEndsAt = fightTextUntil = 0;
    lastCountdownSend = 0;
    lastMovementStateSend = 0;
    guestPositionBuffer.length = 0;
    keys.clear(); gameStarted = false;
    message.textContent = '按「開始遊戲」開始單機對戰';
    setNetworkStatus(statusState, statusState === 'error' ? '連線中斷' : '連線已結束', text);
    showMenuScreen();
    ui();
  }
  function enterLocalGame() {
    if (mode !== 'local') stop();
    release();
    keys.clear();
    countdownEndsAt = fightTextUntil = 0;
    $('botPanel').hidden = true;
    startNextGame();
    window.duel?.startAudio();
    showGameScreen();
    enterFullscreen();
    setNetworkStatus('idle', '單人模式', '在同一個裝置上進行對戰。');
    ui();
  }
  function returnToMenu() {
    if (mode !== 'local') {
      stop();
      $('onlinePanel').hidden = true;
      return;
    }
    release();
    keys.clear();
    gameStarted = false;
    if (mode === 'bot') mode = 'local';
    window.duel?.stopAudio();
    message.textContent = '選擇遊戲模式開始對戰';
    showMenuScreen();
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
      defenseTimer: player.defenseTimer,
      defenseCooldown: player.defenseCooldown,
      skillCooldown: player.skillCooldown,
      skillCharges: player.skillCharges,
      skillRechargeTimer: player.skillRechargeTimer,
      hookCooldown: player.hookCooldown,
      healCooldown: player.healCooldown,
      decoyCooldown: player.decoyCooldown,
      meteorCooldown: player.meteorCooldown,
      ultimateCooldown: player.ultimateCooldown,
      heavyCooldown: player.heavyCooldown,
      heavyState: player.heavyState,
      heavyStartBottom: player.heavyStartBottom,
      heavyImpactTimer: player.heavyImpactTimer,
      vampiricTimer: player.vampiricTimer,
      vampiricCooldown: player.vampiricCooldown,
      ultimateState: player.ultimateState,
      attackHit: [...player.attackHit],
    }));
    return {
      type:'state',
      screen:$('gameScreen').hidden ? 'menu' : 'game',
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
      brokenPlatforms:[...brokenPlatforms],
      effects:identifiedStates(effects
        .filter(effect => ['ring', 'rift', 'void', 'heal', 'flame'].includes(effect.type))
        .slice(-MAX_SYNCED_EFFECTS)),
      gameStarted,
      roundTimeRemaining: window.duelTimer?.get() ?? 90000,
      countdownMs: mode === 'host' && countdownEndsAt > performance.now()
        ? countdownEndsAt - performance.now()
        : 0,
      fightTextMs: mode === 'host' && fightTextUntil > performance.now()
        ? fightTextUntil - performance.now()
        : 0,
      gameOver,
      matchScore,
      matchOver,
      screenShakeTimer,
      earthquake: {
        phase: earthquake.phase,
        timer: earthquake.timer,
        centerX: earthquake.centerX,
        gapWidth: earthquake.gapWidth,
        eventId: earthquake.eventId,
        nextIn: earthquake.nextIn,
        gaps: earthquake.gaps,
      },
      message:message.textContent,
    };
  }
  function receiveState(data) {
    if (!Array.isArray(data.players) || data.players.length !== 2) return;
    if (data.screen === 'game') showGameScreen();
    else if (data.screen === 'menu') showMenuScreen();
    if (mode === 'guest' && data.gameStarted) window.duel?.startAudio();
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
    if (Array.isArray(data.brokenPlatforms)) {
      brokenPlatforms.clear();
      data.brokenPlatforms.forEach(index => {
        if (Number.isInteger(index) && index >= 0 && index < PLATFORMS.length) {
          brokenPlatforms.add(index);
        }
      });
    }
    if (data.earthquake && typeof data.earthquake === 'object') {
      const incomingEarthquake = data.earthquake;
      if (['idle', 'shaking', 'split'].includes(incomingEarthquake.phase)) {
        earthquake.phase = incomingEarthquake.phase;
      }
      ['timer', 'centerX', 'gapWidth', 'eventId', 'nextIn'].forEach(key => {
        if (Number.isFinite(incomingEarthquake[key])) earthquake[key] = incomingEarthquake[key];
      });
      if (Array.isArray(incomingEarthquake.gaps)) {
        earthquake.gaps = incomingEarthquake.gaps
          .filter(gap => gap && Number.isFinite(gap.x) && Number.isFinite(gap.width))
          .slice(-20)
          .map(gap => ({
            x: gap.x,
            width: gap.width,
            eventId: Number.isFinite(gap.eventId) ? gap.eventId : 0,
          }));
      }
    }
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
    if (mode === 'guest' && Number.isFinite(data.roundTimeRemaining)) {
      window.duelTimer?.set(data.roundTimeRemaining);
    }
    syncCountdown(data);
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
    updateMatchResultUI();
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
      setNetworkStatus('connected', '連線成功', '正在同步對戰狀態，接著隨機決定選角順序。');
      if (mode === 'host') showGameScreen();
      ui();
      if (mode === 'host') send(snapshot(), true);
    });
    conn.on('data', data => {
      if (token !== generation || !connected || !data || typeof data !== 'object') return;
      lastSeen = performance.now();
      if (mode === 'guest' && data.type === 'state') receiveState(data);
      if (mode === 'guest' && data.type === 'countdown') syncCountdown(data);
      if (mode === 'host' && data.type === 'movementState' &&
        typeof data.left === 'boolean' && typeof data.right === 'boolean' &&
        guestCharacterId !== null) {
        const player = players[guestCharacterId - 1];
        for (const [action, down] of [['left', data.left], ['right', data.right]]) {
          const key = actionInputKey(player, action);
          if (down && gameStarted && !gameOver) keys.add(key);
          else keys.delete(key);
        }
      }
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
    conn.on('close', () => {
      if (token === generation) stop('對方已離線，對戰已停止。請重新建立或加入房間。', 'error');
    });
    conn.on('error', () => {
      if (token === generation) stop('對戰連線失敗，請重新建立房間。', 'error');
    });
  }
  function begin(host) {
    const code = $('roomCode').value.trim().toUpperCase();
    if (!host && !/^[A-F0-9]{8}$/.test(code)) {
      setNetworkStatus('error', '房號格式不正確', '請輸入完整的 8 碼房號後再試。');
      return;
    }
    if (!window.Peer) {
      setNetworkStatus('error', '連線程式未載入', '請重新整理頁面後再試。');
      return;
    }
    stop(); mode = host ? 'host' : 'guest';
    const token = generation;
    const room = host ? [...crypto.getRandomValues(new Uint8Array(4))].map(n=>n.toString(16).padStart(2,'0')).join('').toUpperCase() : code;
    $('roomCode').value = room;
    setNetworkStatus('connecting', host ? '正在建立房間' : '正在加入房間', '正在連接配對服務，請稍候…');
    ui();
    try { peer = new Peer(host ? 'fight-v1-'+room : undefined); }
    catch {
      stop('此瀏覽器無法建立連線，請改用新版 Safari 或 Chrome。', 'error');
      return;
    }
    timeout = setTimeout(() => {
      if (token === generation) stop('連線逾時。請確認房號，或讓兩支手機使用同一個 Wi-Fi 再試。', 'error');
    }, 25000);
    peer.on('open', () => {
      if (token !== generation) return;
      if (host) {
        clearTimeout(timeout);
        setNetworkStatus('waiting', '房間已準備好', `房號 ${room} · 等待另一支手機加入。`);
      } else {
        setNetworkStatus('connecting', '正在配對玩家', '房號已確認，正在建立裝置連線…');
        attach(peer.connect('fight-v1-'+room, {reliable:true, serialization:'json'}),token);
      }
    });
    peer.on('connection', conn => {
      if (token !== generation || !host || connection) { conn.on('open',()=>conn.close()); return; }
      attach(conn,token);
      timeout = setTimeout(() => {
        if (!connected && token === generation) stop('對方連線逾時，請重建房間。', 'error');
      }, 25000);
    });
    peer.on('error', error => {
      if (token !== generation) return;
      const reasons = {'peer-unavailable':'找不到房間，請確認房號及房主仍在線上。','unavailable-id':'房號重複，請重新建立房間。'};
      stop(reasons[error.type] || '無法連線。請檢查網路，或改用同一個 Wi-Fi 再試。', 'error');
    });
    peer.on('disconnected', () => {
      if (token === generation && !connected) stop('房間服務已斷線，請重新建立或加入。', 'error');
    });
  }
  function start() {
    if (mode === 'bot') {
      startBotGame();
      return;
    }
    if (mode === 'guest' || (mode === 'host' && (!connected || !hostCharacterId ||
      !guestCharacterId || hostCharacterId === guestCharacterId))) return;
    if (gameStarted && !gameOver) return;
    release(); keys.clear();
    if (mode === 'host') {
      onlineMatchStarted = true;
      startNextGame();
      countdownEndsAt = performance.now() + 3000;
      fightTextUntil = 0;
      enterFullscreen();
      window.duel?.startAudio();
      lastCountdownSend = 0;
      send({type:'countdown', countdownMs:3000, fightTextMs:0});
    } else {
      startNextGame();
    }
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
      setNetworkStatus('waiting', '角色選擇已送出', '等待房主確認並開始對戰。');
    }
    ui();
  }
  $('createRoom').onclick = () => begin(true);
  $('joinRoom').onclick = () => begin(false);
  $('startGame').onclick = start;
  $('singlePlayer').onclick = enterLocalGame;
  $('botMode').onclick = enterBotSetup;
  $('startBotGame').onclick = startBotGame;
  $('onlineMode').onclick = () => {
    $('onlinePanel').hidden = false;
    $('botPanel').hidden = true;
  };
  $('backToModes').onclick = () => {
    if (mode !== 'local') stop('連線已取消，請重新選擇模式。');
    $('onlinePanel').hidden = true;
    $('botPanel').hidden = true;
  };
  $('returnToMenu').onclick = returnToMenu;
  $('fullscreenToggle').onclick = toggleFullscreen;
  document.addEventListener('fullscreenchange', updateFullscreenButton);
  document.querySelectorAll('[data-character]').forEach(button => {
    button.addEventListener('click', () => chooseCharacter(Number(button.dataset.character)));
  });
  document.querySelectorAll('[data-bot-character]').forEach(button => {
    button.addEventListener('click', () => {
      botPlayerCharacter = Number(button.dataset.botCharacter);
      if (botOpponentCharacter === botPlayerCharacter) botOpponentCharacter = 3 - botPlayerCharacter;
      document.querySelectorAll('[data-bot-character]').forEach(option =>
        option.classList.toggle('selected', Number(option.dataset.botCharacter) === botPlayerCharacter));
      document.querySelectorAll('[data-bot-opponent]').forEach(option =>
        option.classList.toggle('selected', Number(option.dataset.botOpponent) === botOpponentCharacter));
    });
  });
  document.querySelectorAll('[data-bot-opponent]').forEach(button => {
    button.addEventListener('click', () => {
      botOpponentCharacter = Number(button.dataset.botOpponent);
      if (botPlayerCharacter === botOpponentCharacter) botPlayerCharacter = 3 - botOpponentCharacter;
      document.querySelectorAll('[data-bot-character]').forEach(option =>
        option.classList.toggle('selected', Number(option.dataset.botCharacter) === botPlayerCharacter));
      document.querySelectorAll('[data-bot-opponent]').forEach(option =>
        option.classList.toggle('selected', Number(option.dataset.botOpponent) === botOpponentCharacter));
    });
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
    if (document.hidden && mode !== 'local') {
      stop('頁面已切換至背景，對戰已停止。回來後請重新連線。', 'error');
    }
  });
  window.duel = {
    startAudio() {
      ensureAudio();
    },
    startMusic() {
      startDuelMusic();
    },
    stopAudio() {
      stopDuelMusic();
    },
    canSimulate: () => mode === 'local' || mode === 'bot' ||
      (mode === 'host' && connected && countdownEndsAt <= performance.now()),
    controlKey,
    isActionDown(player, action) {
      if (mode === 'bot' && player.id === botOpponentId()) return keys.has(`bot:${action}`);
      return keys.has(actionInputKey(player, action));
    },
    updateBot() {
      if (mode !== 'bot' || !gameStarted || gameOver || countdownEndsAt > performance.now()) return;
      const player = players[botPlayerId() - 1];
      const bot = players[botOpponentId() - 1];
      const target = player;
      const settings = botDifficultySettings[botDifficulty];
      const distance = target.x + PLAYER_WIDTH / 2 - (bot.x + PLAYER_WIDTH / 2);
      keys.delete('bot:left'); keys.delete('bot:right');
      if (Math.abs(distance) > 62) keys.add(`bot:${distance < 0 ? 'left' : 'right'}`);
      bot.facing = distance >= 0 ? 1 : -1;
      botActionTimer -= 1000 / 60;
      if (botActionTimer > 0) return;
      botActionTimer = settings.reaction;
      const press = action => { apply(bot, action, true); apply(bot, action, false); };
      if (Math.abs(distance) < 82 && Math.random() < settings.attackChance) press('attack');
      if (bot.onGround && Math.random() < 0.25 + (botDifficulty === 'boss' ? 0.2 : 0)) press('jump');
      if (Math.random() < settings.skillChance) {
        const skillActions = bot.id === 1 ? ['skill', 'heavy', 'extra', 'ultimate', 'defend'] : ['skill', 'heal', 'extra', 'meteor', 'defend'];
        press(skillActions[Math.floor(Math.random() * skillActions.length)]);
      }
    },
    keyboard(event,down) {
      if (mode === 'local') {
        if ($('gameScreen').hidden) {
          if (event.code === 'Space') event.preventDefault();
          return true;
        }
        return false;
      }
      if (event.code === 'Space') { event.preventDefault(); if (down && !event.repeat) start(); return true; }
      const key = event.key.toLowerCase();
      const characterId = localCharacterId();
      const action = characterId && actions.find(a => controlKey(players[characterId - 1], a) === key);
      if (action) { event.preventDefault(); if (!event.repeat) input(action,down); }
      return true;
    },
    countdownText() {
      const now = performance.now();
      if (countdownEndsAt > now) return String(Math.ceil((countdownEndsAt - now) / 1000));
      if (fightTextUntil > now) return 'Fight!';
      return null;
    },
    refreshUi: ui,
    tick(now) {
      if (!connected) return;
      if (now-lastSeen > 10000) {
        stop('連線中斷，對戰已停止。請重新連線。', 'error');
        return;
      }
      if (mode === 'host' && countdownEndsAt > 0 && countdownEndsAt <= now) {
        countdownEndsAt = 0;
        fightTextUntil = now + 700;
        send({type:'countdown', countdownMs:0, fightTextMs:700});
      } else if (mode === 'host' && countdownEndsAt > now && now - lastCountdownSend >= 100) {
        lastCountdownSend = now;
        send({
          type:'countdown',
          countdownMs:countdownEndsAt - now,
          fightTextMs:0,
        });
      } else if (mode === 'guest' && countdownEndsAt > 0 && countdownEndsAt <= now) {
        countdownEndsAt = 0;
        fightTextUntil = now + 700;
      }
      interpolateGuestPositions(now);
      if (mode === 'guest' && now-lastMovementStateSend >= 50) {
        sendGuestMovementState(now);
      }
      if (now-lastSend >= (mode === 'host' ? STATE_UPDATE_INTERVAL : 1000)) {
        lastSend = now;
        if (mode === 'host') send(snapshot(), true);
        else send({type:'heartbeat'});
      }
    }
  };
  ui();
  updateFullscreenButton();
})();
