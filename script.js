const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const message = document.getElementById("message");
const health1 = document.getElementById("health1");
const health2 = document.getElementById("health2");
const skill1 = document.getElementById("skill1");
const skill2 = document.getElementById("skill2");
const hookStatus = document.getElementById("hookStatus");
const decoyStatus = document.getElementById("decoyStatus");

const GROUND_Y = 440;
const GRAVITY = 0.9;
const FRICTION = 0.85;
const PLAYER_WIDTH = 48;
const PLAYER_HEIGHT = 68;
const BASIC_ATTACK = { duration: 180, range: 50, damage: 14, height: 0.5 };
const SKILL_DISTANCE = 180;
const SKILL_COOLDOWN = 3000;
const PROJECTILE_COUNT = 8;
const PROJECTILE_SPEED = 7;
const PROJECTILE_DAMAGE = 8;
const PROJECTILE_RADIUS = 8;
const HOOK_SPEED = 14;
const HOOK_RANGE = 560;
const HOOK_PULL_SPEED = 11;
const DECOY_LIFETIME = 2800;
const SCREEN_SHAKE_DURATION = 180;
const SCREEN_SHAKE_INTENSITY = 9;
const effects = [];

const keys = new Set();
const projectiles = [];
const hooks = [];
const decoys = [];
let gameStarted = false;
let gameOver = false;
let nextDecoyId = 0;
let screenShakeTimer = 0;

const players = [
  {
    id: 1,
    color: "#f46a6a",
    x: 90,
    y: GROUND_Y - PLAYER_HEIGHT,
    vx: 0,
    vy: 0,
    facing: 1,
    health: 100,
    onGround: true,
    jumpsRemaining: 2,
    attackTimer: 0,
    hitFlash: 0,
    skillCooldown: 0,
    hookCooldown: 0,
    attackHit: new Set(),
    controls: { left: "a", right: "d", jump: "w", attack: "s", skill: "q", hook: "e" },
  },
  {
    id: 2,
    color: "#5ab4f5",
    x: 390,
    y: GROUND_Y - PLAYER_HEIGHT,
    vx: 0,
    vy: 0,
    facing: 1,
    health: 100,
    onGround: true,
    jumpsRemaining: 2,
    attackTimer: 0,
    hitFlash: 0,
    skillCooldown: 0,
    decoyCooldown: 0,
    attackHit: new Set(),
    controls: { left: "arrowleft", right: "arrowright", jump: "arrowup", attack: "arrowdown", skill: ".", decoy: "/" },
  },
];

function getRandomSpawnX(existingSpawns) {
  const margin = 40;
  const maxX = canvas.width - PLAYER_WIDTH - margin;
  let x;
  let tooClose;
  let tries = 0;
  do {
    x = margin + Math.random() * (maxX - margin);
    tooClose = existingSpawns.some((spawnX) => Math.abs(spawnX - x) < 140);
    tries += 1;
    if (tries > 50) break;
  } while (tooClose);
  return x;
}

function resetGame() {
  const spawnXs = [];
  players.forEach((player) => {
    const x = getRandomSpawnX(spawnXs);
    spawnXs.push(x);
    player.x = x;
    player.y = GROUND_Y - PLAYER_HEIGHT;
    player.vx = 0;
    player.vy = 0;
    player.facing = Math.random() < 0.5 ? -1 : 1;
    player.health = 100;
    player.onGround = true;
    player.jumpsRemaining = 2;
    player.attackTimer = 0;
    player.hitFlash = 0;
    player.skillCooldown = 0;
    player.hookCooldown = 0;
    player.decoyCooldown = 0;
    player.attackHit.clear();
  });
  projectiles.length = 0;
  hooks.length = 0;
  decoys.length = 0;
  effects.length = 0;
  screenShakeTimer = 0;
  gameStarted = true;
  gameOver = false;
  message.textContent = "雙人決鬥開始！擊倒對手獲勝。";
  updateHealthUI();
}

function updateHealthUI() {
  health1.textContent = players[0].health;
  health2.textContent = players[1].health;
  players.forEach((player) => {
    const cooldownElement = player.id === 1 ? skill1 : skill2;
    cooldownElement.textContent = player.skillCooldown > 0
      ? `${(player.skillCooldown / 1000).toFixed(1)} 秒`
      : "就緒";
  });
  hookStatus.textContent = players[0].hookCooldown > 0
    ? `${(players[0].hookCooldown / 1000).toFixed(1)} 秒`
    : "就緒";
  decoyStatus.textContent = players[1].decoyCooldown > 0
    ? `${(players[1].decoyCooldown / 1000).toFixed(1)} 秒`
    : "就緒";
}

function drawBackground() {
  ctx.fillStyle = "#0a1120";
  ctx.fillRect(-SCREEN_SHAKE_INTENSITY, -SCREEN_SHAKE_INTENSITY, canvas.width + SCREEN_SHAKE_INTENSITY * 2, canvas.height + SCREEN_SHAKE_INTENSITY * 2);
  ctx.fillStyle = "#19233c";
  ctx.fillRect(-SCREEN_SHAKE_INTENSITY, GROUND_Y, canvas.width + SCREEN_SHAKE_INTENSITY * 2, canvas.height - GROUND_Y + SCREEN_SHAKE_INTENSITY);
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  for (let x = -40; x < canvas.width + 40; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, GROUND_Y);
    ctx.lineTo(x, canvas.height + SCREEN_SHAKE_INTENSITY);
    ctx.stroke();
  }
}

function drawPlayer(player) {
  const time = performance.now() / 1000;
  const moving = Math.abs(player.vx) > 0.5;
  const stride = moving ? Math.sin(time * 15 * Math.sign(player.vx)) : Math.sin(time * 2) * 0.04;
  const airborne = !player.onGround;
  const centerX = player.x + PLAYER_WIDTH / 2;
  const groundY = player.y + PLAYER_HEIGHT;
  const isRed = player.id === 1;
  const glow = isRed ? "#ff2738" : "#00eaff";
  const step = stride * (moving ? 13 : 2);

  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.beginPath();
  ctx.ellipse(centerX, groundY + 6, airborne ? 16 : 24, airborne ? 5 : 8, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.translate(centerX, player.y + 4);
  ctx.scale(player.facing, 1);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.shadowColor = glow;
  ctx.shadowBlur = isRed ? 4 : 15;

  const limb = (points, color, width) => {
    ctx.beginPath();
    ctx.moveTo(points[0], points[1]);
    for (let index = 2; index < points.length; index += 2) {
      ctx.lineTo(points[index], points[index + 1]);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  };

  const bodyColor = isRed ? "#090a0d" : "#08131c";
  const edgeColor = isRed ? "#252832" : "#47f5ff";
  limb([-1, 28, 1, 51], edgeColor, 13);
  limb([-1, 28, 1, 51], bodyColor, 8);
  limb([-2, 32, -13, 39 + (moving ? stride * 3 : 0), -19, 48], edgeColor, 9);
  limb([-2, 32, -13, 39 + (moving ? stride * 3 : 0), -19, 48], bodyColor, 5);
  limb([2, 32, 13, 38 - (moving ? stride * 3 : 0), 19, 45], edgeColor, 9);
  limb([2, 32, 13, 38 - (moving ? stride * 3 : 0), 19, 45], bodyColor, 5);

  const leftKnee = [-8 + step * 0.35, 56 + (airborne ? -5 : 0)];
  const rightKnee = [8 - step * 0.35, 56 + (airborne ? 3 : 0)];
  const leftFoot = [-12 - step, 68 + (airborne ? -3 : 0)];
  const rightFoot = [12 + step, 68 + (airborne ? 2 : 0)];
  limb([1, 50, leftKnee[0], leftKnee[1], leftFoot[0], leftFoot[1]], edgeColor, 12);
  limb([1, 50, leftKnee[0], leftKnee[1], leftFoot[0], leftFoot[1]], bodyColor, 7);
  limb([1, 50, rightKnee[0], rightKnee[1], rightFoot[0], rightFoot[1]], edgeColor, 12);
  limb([1, 50, rightKnee[0], rightKnee[1], rightFoot[0], rightFoot[1]], bodyColor, 7);

  ctx.shadowColor = glow;
  ctx.shadowBlur = isRed ? 13 : 24;
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.ellipse(leftFoot[0] + 2, leftFoot[1], 8, 5, -0.3, 0, Math.PI * 2);
  ctx.ellipse(rightFoot[0] + 2, rightFoot[1], 8, 5, 0.3, 0, Math.PI * 2);
  ctx.fill();

  ctx.shadowBlur = isRed ? 5 : 17;
  ctx.fillStyle = bodyColor;
  ctx.strokeStyle = edgeColor;
  ctx.lineWidth = isRed ? 2 : 3;
  ctx.beginPath();
  ctx.arc(0, 13, 13, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  if (isRed) {
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.ellipse(5, 12, 4.5, 2.5, -0.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ff2638";
    ctx.beginPath();
    ctx.ellipse(-5, 12, 4, 2.3, 0.25, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.shadowBlur = 12;
    ctx.fillStyle = "#eaffff";
    ctx.beginPath();
    ctx.ellipse(-5, 14, 3.5, 2, -0.35, 0, Math.PI * 2);
    ctx.ellipse(5, 14, 3.5, 2, 0.35, 0, Math.PI * 2);
    ctx.fill();
  }

  const armSwing = moving ? stride * 6 : 0;
  limb([-2, 31, -11, 41 - armSwing, -14, 49 - armSwing], edgeColor, 8);
  limb([-2, 31, -11, 41 - armSwing, -14, 49 - armSwing], bodyColor, 4);
  limb([2, 31, 10, 39 + armSwing, 16, 43 + armSwing], edgeColor, 8);
  limb([2, 31, 10, 39 + armSwing, 16, 43 + armSwing], bodyColor, 4);

  ctx.shadowColor = glow;
  ctx.shadowBlur = isRed ? 16 : 22;
  ctx.strokeStyle = isRed ? "#fff4f4" : "#d9ffff";
  ctx.lineWidth = 5;
  ctx.beginPath();
  if (isRed) {
    ctx.moveTo(11, 42 + armSwing);
    ctx.lineTo(43, 36 + armSwing);
  } else {
    ctx.moveTo(13, 42 + armSwing);
    ctx.lineTo(47, 53 + armSwing);
  }
  ctx.stroke();
  ctx.strokeStyle = glow;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  if (player.attackTimer > 0) {
    const progress = 1 - player.attackTimer / BASIC_ATTACK.duration;
    const direction = player.facing;
    const slashX = centerX + direction * 27;
    const slashY = player.y + 36;
    ctx.save();
    ctx.globalAlpha = Math.sin(progress * Math.PI) * 0.9;
    ctx.shadowColor = glow;
    ctx.shadowBlur = 20;
    ctx.strokeStyle = isRed ? "#ff4858" : "#6bffff";
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.arc(slashX, slashY, 32, direction === 1 ? -1.1 : Math.PI + 0.1, direction === 1 ? 1.1 : Math.PI - 0.1, direction === -1);
    ctx.stroke();
    ctx.restore();
  }

  if (player.hitFlash > 0) {
    ctx.save();
    ctx.globalAlpha = Math.min(0.16, player.hitFlash / 300);
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.ellipse(centerX, player.y + 38, 25, 39, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = Math.min(0.8, player.hitFlash / 220);
    ctx.shadowColor = glow;
    ctx.shadowBlur = 18;
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.restore();
  }
}

function drawProjectiles() {
  projectiles.forEach((projectile) => {
    ctx.fillStyle = "rgba(90,180,245,0.3)";
    ctx.beginPath();
    ctx.arc(projectile.x, projectile.y, PROJECTILE_RADIUS + 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#8bd4ff";
    ctx.beginPath();
    ctx.arc(projectile.x, projectile.y, PROJECTILE_RADIUS, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawHooks() {
  hooks.forEach((hook) => {
    const owner = players.find((player) => player.id === hook.ownerId);
    if (!owner) return;
    const startX = owner.x + PLAYER_WIDTH / 2;
    const startY = owner.y + 34;
    ctx.save();
    ctx.shadowColor = "#ff3b4f";
    ctx.shadowBlur = 13;
    ctx.strokeStyle = "#ff7a87";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(hook.x, hook.y);
    ctx.stroke();
    ctx.fillStyle = "#fff0f1";
    ctx.beginPath();
    ctx.arc(hook.x, hook.y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
}

function drawDecoys() {
  decoys.forEach((decoy) => {
    const owner = players.find((player) => player.id === decoy.ownerId);
    if (!owner) return;
    const fade = Math.min(1, decoy.life / 350);
    ctx.save();
    ctx.globalAlpha = fade * 0.68;
    drawPlayer({
      ...owner,
      x: decoy.x,
      y: decoy.y,
      vx: decoy.vx,
      vy: 0,
      hitFlash: 0,
      attackTimer: 0,
      onGround: decoy.onGround,
    });
    ctx.restore();
  });
}

function drawEffects() {
  effects.forEach((effect) => {
    const alpha = Math.max(0, effect.life / effect.maxLife);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.shadowColor = effect.color;
    ctx.shadowBlur = 16;
    ctx.strokeStyle = effect.color;
    ctx.fillStyle = effect.color;
    if (effect.type === "ring") {
      const radius = effect.radius * (1 + (1 - alpha) * 1.5);
      ctx.lineWidth = Math.max(1, 5 * alpha);
      ctx.beginPath();
      ctx.arc(effect.x, effect.y, radius, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(effect.x, effect.y, effect.radius * alpha, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  });
}

function spawnImpact(x, y, color, count = 12) {
  effects.push({ type: "ring", x, y, color, radius: 10, life: 260, maxLife: 260 });
  for (let index = 0; index < count; index += 1) {
    const angle = (Math.PI * 2 * index) / count + Math.random() * 0.3;
    const speed = 2 + Math.random() * 4;
    effects.push({
      type: "particle",
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color,
      radius: 2 + Math.random() * 3,
      life: 220 + Math.random() * 180,
      maxLife: 400,
    });
  }
}

function updateEffects() {
  for (let index = effects.length - 1; index >= 0; index -= 1) {
    const effect = effects[index];
    effect.life -= 16;
    if (effect.type === "particle") {
      effect.x += effect.vx;
      effect.y += effect.vy;
      effect.vx *= 0.94;
      effect.vy *= 0.94;
    }
    if (effect.life <= 0) effects.splice(index, 1);
  }
  players.forEach((player) => {
    player.hitFlash = Math.max(0, player.hitFlash - 16);
  });
  screenShakeTimer = Math.max(0, screenShakeTimer - 16);
}

function applyHitReaction(target, attacker) {
  const targetCenterX = target.x + PLAYER_WIDTH / 2;
  const attackerCenterX = attacker.x + PLAYER_WIDTH / 2;
  const direction = Math.sign(targetCenterX - attackerCenterX) || attacker.facing;
  target.vx = direction * 8;
  target.vy = Math.min(target.vy, -5);
  target.onGround = false;
  screenShakeTimer = SCREEN_SHAKE_DURATION;
}

function getAttackHitbox(player) {
  const width = BASIC_ATTACK.range;
  const height = PLAYER_HEIGHT * BASIC_ATTACK.height;
  const x = player.facing === 1 ? player.x + PLAYER_WIDTH : player.x - width;
  const y = player.y + (PLAYER_HEIGHT - height) / 2;
  return { x, y, width, height };
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function updatePlayers() {
  players.forEach((player) => {
    const { left, right, jump } = player.controls;
    const moveLeft = keys.has(left);
    const moveRight = keys.has(right);
    if (moveLeft) {
      player.vx -= player.onGround ? 1.2 : 0.8;
      player.facing = -1;
    }
    if (moveRight) {
      player.vx += player.onGround ? 1.2 : 0.8;
      player.facing = 1;
    }
    player.vx = Math.max(-7, Math.min(7, player.vx));
    player.vx *= player.onGround ? FRICTION : 0.96;
    player.vy += GRAVITY;
    player.x += player.vx;
    player.y += player.vy;

    if (player.x < 0) {
      player.x = 0;
      player.vx = 0;
    }
    if (player.x + PLAYER_WIDTH > canvas.width) {
      player.x = canvas.width - PLAYER_WIDTH;
      player.vx = 0;
    }
    if (player.y + PLAYER_HEIGHT >= GROUND_Y) {
      player.y = GROUND_Y - PLAYER_HEIGHT;
      player.vy = 0;
      player.onGround = true;
      player.jumpsRemaining = 2;
    }

    if (player.attackTimer > 0) {
      player.attackTimer -= 16;
      if (player.attackTimer <= 0) {
        player.attackTimer = 0;
        player.attackHit.clear();
      }
    }
    player.skillCooldown = Math.max(0, player.skillCooldown - 16);
    player.hookCooldown = Math.max(0, player.hookCooldown - 16);
    player.decoyCooldown = Math.max(0, player.decoyCooldown - 16);
  });
  updateHealthUI();
}

function jumpPlayer(player) {
  if (!gameStarted || gameOver || player.health <= 0 || player.jumpsRemaining === 0) return;

  player.vy = -16;
  player.onGround = false;
  player.jumpsRemaining -= 1;
}

function updateProjectiles() {
  for (let index = projectiles.length - 1; index >= 0; index -= 1) {
    const projectile = projectiles[index];
    projectile.x += projectile.vx;
    projectile.y += projectile.vy;
    projectile.life -= 16;

    const target = players.find((player) => {
      if (player.id === projectile.ownerId || player.health <= 0) return false;
      return rectsOverlap(
        { x: projectile.x - PROJECTILE_RADIUS, y: projectile.y - PROJECTILE_RADIUS, width: PROJECTILE_RADIUS * 2, height: PROJECTILE_RADIUS * 2 },
        { x: player.x, y: player.y, width: PLAYER_WIDTH, height: PLAYER_HEIGHT },
      );
    });

    if (target) {
      target.health = Math.max(0, target.health - projectile.damage);
      target.hitFlash = 120;
      const attacker = players.find((player) => player.id === projectile.ownerId);
      if (!attacker) {
        throw new Error(`Projectile owner ${projectile.ownerId} was not found`);
      }
      applyHitReaction(target, attacker);
      spawnImpact(projectile.x, projectile.y, "#54efff", 10);
      projectiles.splice(index, 1);
      updateHealthUI();
      if (target.health <= 0) {
        message.textContent = `玩家 ${target.id} 被擊倒！`;
      }
    } else if (
      projectile.life <= 0 ||
      projectile.x < -PROJECTILE_RADIUS ||
      projectile.x > canvas.width + PROJECTILE_RADIUS ||
      projectile.y < -PROJECTILE_RADIUS ||
      projectile.y > canvas.height + PROJECTILE_RADIUS
    ) {
      projectiles.splice(index, 1);
    }
  }
}

function updateHooks() {
  for (let index = hooks.length - 1; index >= 0; index -= 1) {
    const hook = hooks[index];
    const owner = players.find((player) => player.id === hook.ownerId);
    const target = hook.targetId === null
      ? null
      : players.find((player) => player.id === hook.targetId);
    if (!owner || owner.health <= 0) {
      hooks.splice(index, 1);
      continue;
    }

    if (target && target.health > 0) {
      const targetCenterX = target.x + PLAYER_WIDTH / 2;
      const targetCenterY = target.y + PLAYER_HEIGHT / 2;
      const ownerCenterX = owner.x + PLAYER_WIDTH / 2;
      const ownerCenterY = owner.y + PLAYER_HEIGHT / 2;
      const dx = ownerCenterX - targetCenterX;
      const dy = ownerCenterY - targetCenterY;
      const distance = Math.hypot(dx, dy);
      if (distance <= 75) {
        spawnImpact(targetCenterX, targetCenterY, "#ff4558", 12);
        hooks.splice(index, 1);
        continue;
      }

      const pullStep = Math.min(HOOK_PULL_SPEED, distance - 75);
      target.x = Math.max(0, Math.min(
        canvas.width - PLAYER_WIDTH,
        target.x + (dx / distance) * pullStep,
      ));
      target.y = Math.max(
        0,
        Math.min(GROUND_Y - PLAYER_HEIGHT, target.y + (dy / distance) * pullStep),
      );
      target.vx = 0;
      target.vy = 0;
      target.onGround = target.y + PLAYER_HEIGHT >= GROUND_Y;
      target.jumpsRemaining = target.onGround ? 2 : target.jumpsRemaining;
      hook.x = targetCenterX;
      hook.y = targetCenterY;
      hook.life -= 16;
      if (hook.life <= 0) hooks.splice(index, 1);
      continue;
    }

    hook.x += hook.vx;
    hook.y += hook.vy;
    hook.distance += Math.hypot(hook.vx, hook.vy);
    hook.life -= 16;

    const decoy = decoys.find((candidate) => {
      if (candidate.ownerId === hook.ownerId) return false;
      return rectsOverlap(
        { x: hook.x - 7, y: hook.y - 7, width: 14, height: 14 },
        { x: candidate.x, y: candidate.y, width: PLAYER_WIDTH, height: PLAYER_HEIGHT },
      );
    });
    if (decoy) {
      decoys.splice(decoys.indexOf(decoy), 1);
      spawnImpact(hook.x, hook.y, "#9efaff", 10);
      hooks.splice(index, 1);
      continue;
    }

    const hitTarget = players.find((player) => {
      if (player.id === hook.ownerId || player.health <= 0) return false;
      return rectsOverlap(
        { x: hook.x - 7, y: hook.y - 7, width: 14, height: 14 },
        { x: player.x, y: player.y, width: PLAYER_WIDTH, height: PLAYER_HEIGHT },
      );
    });
    if (hitTarget) {
      hook.targetId = hitTarget.id;
      hitTarget.hitFlash = 180;
      applyHitReaction(hitTarget, owner);
      spawnImpact(hook.x, hook.y, "#ff4558", 14);
    } else if (hook.distance >= HOOK_RANGE || hook.life <= 0) {
      hooks.splice(index, 1);
    }
  }
}

function updateDecoys() {
  for (let index = decoys.length - 1; index >= 0; index -= 1) {
    const decoy = decoys[index];
    decoy.x += decoy.vx;
    decoy.life -= 16;
    decoy.x = Math.max(0, Math.min(canvas.width - PLAYER_WIDTH, decoy.x));
    if (decoy.life <= 0) {
      spawnImpact(decoy.x + PLAYER_WIDTH / 2, decoy.y + PLAYER_HEIGHT / 2, "#70faff", 6);
      decoys.splice(index, 1);
    }
  }
}

function processAttacks() {
  players.forEach((attacker) => {
    if (attacker.attackTimer > 0) {
      const hitbox = getAttackHitbox(attacker);
      const hitDecoy = decoys.find((decoy) => {
        return decoy.ownerId !== attacker.id &&
          !attacker.attackHit.has("decoy") &&
          rectsOverlap(hitbox, { x: decoy.x, y: decoy.y, width: PLAYER_WIDTH, height: PLAYER_HEIGHT });
      });
      if (hitDecoy) {
        attacker.attackHit.add("decoy");
        decoys.splice(decoys.indexOf(hitDecoy), 1);
        spawnImpact(
          hitDecoy.x + PLAYER_WIDTH / 2,
          hitDecoy.y + PLAYER_HEIGHT / 2,
          "#8dfaff",
          12,
        );
        return;
      }

      players.forEach((target) => {
        if (target.id === attacker.id || attacker.attackHit.has(target.id) || target.health <= 0) return;
        const targetBox = { x: target.x, y: target.y, width: PLAYER_WIDTH, height: PLAYER_HEIGHT };
        if (rectsOverlap(hitbox, targetBox)) {
          target.health = Math.max(0, target.health - BASIC_ATTACK.damage);
          target.hitFlash = 180;
          applyHitReaction(target, attacker);
          spawnImpact(
            target.x + PLAYER_WIDTH / 2,
            target.y + PLAYER_HEIGHT / 2,
            attacker.id === 1 ? "#ff3348" : "#52f5ff",
            16,
          );
          attacker.attackHit.add(target.id);
          updateHealthUI();
          if (target.health <= 0) {
            message.textContent = `玩家 ${target.id} 被擊倒！`;
          }
        }
      });
    }
  });
}

function checkGameOver() {
  const alive = players.filter((player) => player.health > 0);
  if (alive.length <= 1 && gameStarted) {
    gameOver = true;
    if (alive.length === 1) {
      message.textContent = `玩家 ${alive[0].id} 獲勝！按任意鍵重新開始。`;
    } else {
      message.textContent = "平手！雙方同時倒地。按任意鍵重新開始。";
    }
  }
}

function drawHealthBars() {
  players.forEach((player, index) => {
    const barWidth = 300;
    const barHeight = 10;
    const left = index === 0 ? 28 : canvas.width - barWidth - 28;
    const top = 18;
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fillRect(left, top, barWidth, barHeight);
    ctx.fillStyle = player.color;
    const lifeWidth = (player.health / 100) * barWidth;
    ctx.fillRect(left, top, lifeWidth, barHeight);
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.strokeRect(left, top, barWidth, barHeight);
  });
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  if (screenShakeTimer > 0) {
    const intensity = SCREEN_SHAKE_INTENSITY * (screenShakeTimer / SCREEN_SHAKE_DURATION);
    ctx.translate((Math.random() * 2 - 1) * intensity, (Math.random() * 2 - 1) * intensity);
  }
  drawBackground();
  drawHealthBars();
  drawProjectiles();
  drawHooks();
  drawDecoys();
  players.forEach((player) => {
    drawPlayer(player);
  });
  drawEffects();
  ctx.restore();
}

function gameLoop() {
  if (gameStarted && !gameOver) {
    updatePlayers();
    processAttacks();
    updateProjectiles();
    updateHooks();
    updateDecoys();
    updateEffects();
    checkGameOver();
  }
  draw();
  requestAnimationFrame(gameLoop);
}

function attackPlayer(player) {
  if (player.attackTimer === 0 && player.health > 0 && !gameOver) {
    player.attackTimer = BASIC_ATTACK.duration;
    player.attackHit.clear();
    updateHealthUI();
  }
}

function useSkill(player) {
  if (player.skillCooldown > 0 || player.health <= 0 || gameOver) return;

  if (player.id === 1) {
    player.x = Math.max(
      0,
      Math.min(canvas.width - PLAYER_WIDTH, player.x + player.facing * SKILL_DISTANCE),
    );
    player.vx = 0;
  } else {
    const originX = player.x + PLAYER_WIDTH / 2;
    const originY = player.y + PLAYER_HEIGHT / 2;
    for (let index = 0; index < PROJECTILE_COUNT; index += 1) {
      const angle = (Math.PI * 2 * index) / PROJECTILE_COUNT;
      projectiles.push({
        ownerId: player.id,
        x: originX,
        y: originY,
        vx: Math.cos(angle) * PROJECTILE_SPEED,
        vy: Math.sin(angle) * PROJECTILE_SPEED,
        damage: PROJECTILE_DAMAGE,
        life: 2000,
      });
    }
  }
  player.skillCooldown = SKILL_COOLDOWN;
  updateHealthUI();
}

function useHook(player) {
  if (player.hookCooldown > 0 || player.health <= 0 || gameOver) return;
  const originX = player.x + PLAYER_WIDTH / 2 + player.facing * 25;
  const originY = player.y + 34;
  hooks.push({
    ownerId: player.id,
    x: originX,
    y: originY,
    vx: player.facing * HOOK_SPEED,
    vy: 0,
    distance: 0,
    life: 1800,
    targetId: null,
  });
  player.hookCooldown = 5000;
  updateHealthUI();
}

function useDecoys(player) {
  if (player.decoyCooldown > 0 || player.health <= 0 || gameOver) return;
  const offsets = [-1, 0, 1];
  offsets.forEach((offset) => {
    decoys.push({
      id: `decoy-${nextDecoyId}`,
      ownerId: player.id,
      x: Math.max(0, Math.min(canvas.width - PLAYER_WIDTH, player.x + offset * 68)),
      y: player.y - (offset === 0 ? 18 : 0),
      vx: offset * 0.45,
      life: DECOY_LIFETIME,
    });
    nextDecoyId += 1;
  });
  player.decoyCooldown = 7000;
  spawnImpact(player.x + PLAYER_WIDTH / 2, player.y + PLAYER_HEIGHT / 2, "#70faff", 18);
  updateHealthUI();
}

window.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  if (event.code === "Space") {
    event.preventDefault();
    if (!gameStarted || gameOver) resetGame();
    return;
  }

  if (event.repeat) return;
  keys.add(key);
  players.forEach((player) => {
    if (key === player.controls.jump) jumpPlayer(player);
    if (key === player.controls.attack) attackPlayer(player);
    if (key === player.controls.skill) useSkill(player);
    if (key === player.controls.hook) useHook(player);
    if (key === player.controls.decoy) useDecoys(player);
  });
});

window.addEventListener("keyup", (event) => {
  keys.delete(event.key.toLowerCase());
});

resetGame();
gameStarted = false;
message.textContent = "按空白鍵開始遊戲";
requestAnimationFrame(gameLoop);
