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
const MAX_HEALTH = 200;
const BASIC_ATTACK = { duration: 180, range: 50, damage: 8, height: 0.5 };
const SKILL_DISTANCE = 180;
const SKILL_COOLDOWN = 3000;
const MAX_SKILL_CHARGES = 3;
const PROJECTILE_COUNT = 8;
const PROJECTILE_SPEED = 7;
const PROJECTILE_DAMAGE = 8;
const PROJECTILE_RADIUS = 8;
const HEAL_AMOUNT = 18;
const HEAL_COOLDOWN = 8000;
const HOOK_SPEED = 14;
const HOOK_RANGE = 560;
const HOOK_PULL_SPEED = 11;
const DECOY_LIFETIME = 4800;
const ULTIMATE_COOLDOWN = 10000;
const METEOR_COOLDOWN = 25000;
const METEOR_DAMAGE = 16;
const METEOR_COUNT = 3;
const CRATER_DAMAGE = 16;
const CRATER_WIDTH = 136;
const CRATER_DEPTH = 56;
const CRATER_LIFETIME = 7000;
const ULTIMATE_DASH_DISTANCE = 90;
const ULTIMATE_STRIKE_COUNT = 4;
const ULTIMATE_STRIKE_INTERVAL = 300;
const SCREEN_SHAKE_DURATION = 180;
const SCREEN_SHAKE_INTENSITY = 9;
const SCREEN_SHAKE_VIBRATION_MULTIPLIER = 1.5;
const effects = [];

const keys = new Set();
const projectiles = [];
const hooks = [];
const decoys = [];
const meteors = [];
const craters = [];
let gameStarted = false;
let gameOver = false;
let matchScore = [0, 0];
let matchOver = false;
let nextDecoyId = 0;
let nextMeteorVolleyId = 0;
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
    health: MAX_HEALTH,
    onGround: true,
    jumpsRemaining: 2,
    attackTimer: 0,
    hitFlash: 0,
    skillCooldown: 0,
    skillCharges: MAX_SKILL_CHARGES,
    skillRechargeTimer: 0,
    hookCooldown: 0,
    ultimateCooldown: 0,
    ultimateState: null,
    attackHit: new Set(),
    controls: { left: "a", right: "d", jump: "w", attack: "s", skill: "g", hook: "y", ultimate: "u" },
  },
  {
    id: 2,
    color: "#5ab4f5",
    x: 390,
    y: GROUND_Y - PLAYER_HEIGHT,
    vx: 0,
    vy: 0,
    facing: 1,
    health: MAX_HEALTH,
    onGround: true,
    jumpsRemaining: 2,
    attackTimer: 0,
    hitFlash: 0,
    skillCooldown: 0,
    healCooldown: 0,
    decoyCooldown: 0,
    meteorCooldown: 0,
    attackHit: new Set(),
    controls: { left: "arrowleft", right: "arrowright", jump: "arrowup", attack: "arrowdown", skill: ".", heal: "5", decoy: "/", meteor: "7" },
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
    player.health = MAX_HEALTH;
    player.onGround = true;
    player.jumpsRemaining = 2;
    player.attackTimer = 0;
    player.hitFlash = 0;
    player.skillCooldown = 0;
    if (player.id === 1) {
      player.skillCharges = MAX_SKILL_CHARGES;
      player.skillRechargeTimer = 0;
    }
    player.hookCooldown = 0;
    player.healCooldown = 0;
    player.decoyCooldown = 0;
    player.meteorCooldown = 0;
    player.ultimateCooldown = 0;
    player.ultimateState = null;
    player.attackHit.clear();
  });
  projectiles.length = 0;
  hooks.length = 0;
  decoys.length = 0;
  meteors.length = 0;
  craters.length = 0;
  effects.length = 0;
  screenShakeTimer = 0;
  gameStarted = true;
  gameOver = false;
  message.textContent = "雙人決鬥開始！擊倒對手獲勝。";
  updateHealthUI();
}

function startNextGame() {
  if (matchOver) {
    matchScore = [0, 0];
    matchOver = false;
  }
  resetGame();
}

function updateHealthUI() {
  health1.textContent = players[0].health;
  health2.textContent = players[1].health;
  players.forEach((player) => {
    const cooldownElement = player.id === 1 ? skill1 : skill2;
    if (player.id === 1) {
      cooldownElement.textContent = player.skillRechargeTimer > 0
        ? `${player.skillCharges}/${MAX_SKILL_CHARGES} · ${(player.skillRechargeTimer / 1000).toFixed(1)} 秒`
        : `${player.skillCharges}/${MAX_SKILL_CHARGES}`;
    } else {
      cooldownElement.textContent = player.skillCooldown > 0
        ? `${(player.skillCooldown / 1000).toFixed(1)} 秒`
        : "就緒";
    }
  });
  hookStatus.textContent = players[0].hookCooldown > 0
    ? `${(players[0].hookCooldown / 1000).toFixed(1)} 秒`
    : "就緒";
  decoyStatus.textContent = players[1].decoyCooldown > 0
    ? `${(players[1].decoyCooldown / 1000).toFixed(1)} 秒`
    : "就緒";
  const meteorStatus = document.getElementById("meteorStatus");
  if (meteorStatus) {
    meteorStatus.textContent = players[1].meteorCooldown > 0
      ? `${(players[1].meteorCooldown / 1000).toFixed(1)} 秒`
      : "就緒";
  }
    const player2HealText = document.getElementById("healStatus");
    if (player2HealText) {
      player2HealText.textContent = players[1].healCooldown > 0
        ? `${(players[1].healCooldown / 1000).toFixed(1)} 秒`
        : "就緒";
    }
}

function drawBackground() {
  const skyGradient = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
  skyGradient.addColorStop(0, "#5a402c");
  skyGradient.addColorStop(0.38, "#9d7b4c");
  skyGradient.addColorStop(0.7, "#c79b5d");
  skyGradient.addColorStop(1, "#d0a96a");
  ctx.fillStyle = skyGradient;
  ctx.fillRect(0, 0, canvas.width, GROUND_Y);

  ctx.fillStyle = "rgba(82, 60, 35, 0.48)";
  ctx.beginPath();
  ctx.moveTo(-20, GROUND_Y - 10);
  ctx.quadraticCurveTo(180, GROUND_Y - 120, 420, GROUND_Y - 20);
  ctx.quadraticCurveTo(660, GROUND_Y - 150, 980, GROUND_Y - 5);
  ctx.quadraticCurveTo(1080, GROUND_Y - 110, canvas.width + 30, GROUND_Y - 12);
  ctx.lineTo(canvas.width + 30, canvas.height);
  ctx.lineTo(-20, canvas.height);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "rgba(62, 45, 26, 0.58)";
  ctx.beginPath();
  ctx.moveTo(-20, GROUND_Y + 10);
  ctx.quadraticCurveTo(190, GROUND_Y - 70, 510, GROUND_Y + 24);
  ctx.quadraticCurveTo(720, GROUND_Y - 110, canvas.width + 20, GROUND_Y + 28);
  ctx.lineTo(canvas.width + 20, canvas.height);
  ctx.lineTo(-20, canvas.height);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "rgba(35, 24, 15, 0.76)";
  ctx.beginPath();
  ctx.moveTo(700, GROUND_Y + 40);
  ctx.quadraticCurveTo(800, GROUND_Y - 90, 900, GROUND_Y + 18);
  ctx.quadraticCurveTo(960, GROUND_Y + 70, 1080, GROUND_Y + 30);
  ctx.lineTo(1080, canvas.height);
  ctx.lineTo(700, canvas.height);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#6d4f30";
  ctx.strokeStyle = "#3d2c1f";
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(800, 160);
  ctx.lineTo(760, GROUND_Y - 8);
  ctx.lineTo(815, GROUND_Y - 8);
  ctx.lineTo(830, 145);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(780, 175);
  ctx.lineTo(750, 230);
  ctx.lineTo(797, 235);
  ctx.lineTo(790, 178);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(792, 180);
  ctx.bezierCurveTo(846, 152, 954, 154, 1013, 172);
  ctx.bezierCurveTo(974, 188, 932, 188, 900, 205);
  ctx.bezierCurveTo(860, 218, 820, 206, 792, 180);
  ctx.fillStyle = "rgba(64, 42, 24, 0.72)";
  ctx.fill();

  ctx.strokeStyle = "rgba(56, 38, 24, 0.85)";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(810, 170);
  ctx.lineTo(894, 208);
  ctx.moveTo(842, 169);
  ctx.lineTo(930, 214);
  ctx.moveTo(872, 167);
  ctx.lineTo(960, 206);
  ctx.stroke();

  ctx.fillStyle = "#d9b06a";
  ctx.beginPath();
  ctx.moveTo(0, GROUND_Y + 12);
  ctx.lineTo(130, GROUND_Y - 18);
  ctx.lineTo(246, GROUND_Y + 16);
  ctx.lineTo(362, GROUND_Y - 42);
  ctx.lineTo(468, GROUND_Y + 22);
  ctx.lineTo(620, GROUND_Y - 24);
  ctx.lineTo(760, GROUND_Y + 20);
  ctx.lineTo(905, GROUND_Y - 30);
  ctx.lineTo(1048, GROUND_Y + 18);
  ctx.lineTo(canvas.width, GROUND_Y + 26);
  ctx.lineTo(canvas.width, canvas.height);
  ctx.lineTo(0, canvas.height);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "rgba(86, 61, 37, 0.6)";
  for (let i = 0; i < 26; i += 1) {
    const x = (i * 83 + (i % 3) * 20) % (canvas.width + 90);
    const y = GROUND_Y + 12 + ((i * 41) % 120);
    const w = 55 + (i % 4) * 14;
    const h = 18 + (i % 3) * 9;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w * 0.45, y - h * 0.4);
    ctx.lineTo(x + w, y + h * 0.3);
    ctx.lineTo(x + w * 0.7, y + h);
    ctx.lineTo(x + w * 0.15, y + h * 0.9);
    ctx.closePath();
    ctx.fill();
  }

  ctx.strokeStyle = "rgba(105, 77, 43, 0.42)";
  ctx.lineWidth = 2;
  for (let y = GROUND_Y + 8; y < canvas.height; y += 22) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y + (y % 44 === 0 ? 8 : -4));
    ctx.stroke();
  }

  for (let x = -40; x < canvas.width + 40; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, GROUND_Y);
    ctx.lineTo(x + 10, canvas.height + SCREEN_SHAKE_INTENSITY);
    ctx.strokeStyle = "rgba(120, 93, 54, 0.18)";
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(73, 51, 29, 0.45)";
  ctx.fillRect(0, GROUND_Y, canvas.width, canvas.height - GROUND_Y);
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
    const softGlow = 0.4 + 0.6 * Math.sin(progress * Math.PI);
    for (let index = 6; index >= 1; index -= 1) {
      const trailProgress = index / 7;
      const trailX = slashX - direction * index * 8;
      const trailY = slashY + Math.sin(progress * Math.PI + index) * 8;
      const trailAlpha = (0.08 + (1 - trailProgress) * 0.26) * softGlow;
      ctx.save();
      ctx.globalAlpha = trailAlpha;
      ctx.shadowColor = glow;
      ctx.shadowBlur = 36 + index * 5;
      ctx.strokeStyle = isRed ? "#ffc0c8" : "#d6ffff";
      ctx.lineWidth = 8 + index * 1.6;
      ctx.beginPath();
      ctx.arc(trailX, trailY, 34 + index * 4, direction === 1 ? -1.4 : Math.PI + 0.4, direction === 1 ? 1.4 : Math.PI - 0.4, direction === -1);
      ctx.stroke();
      ctx.restore();
    }
    ctx.save();
    ctx.globalAlpha = softGlow * 0.96;
    ctx.shadowColor = glow;
    ctx.shadowBlur = 42;
    ctx.strokeStyle = isRed ? "#ff6d7c" : "#86ffff";
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(slashX, slashY, 36, direction === 1 ? -1.5 : Math.PI + 0.5, direction === 1 ? 1.5 : Math.PI - 0.5, direction === -1);
    ctx.stroke();
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = softGlow * 0.7;
    ctx.shadowColor = glow;
    ctx.shadowBlur = 18;
    ctx.strokeStyle = isRed ? "#ffe3e6" : "#ffffff";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(slashX, slashY, 22, direction === 1 ? -1.1 : Math.PI + 0.1, direction === 1 ? 1.1 : Math.PI - 0.1, direction === -1);
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
    const flameColor = projectile.ownerId === 2 ? "#ff9e42" : "#8bd4ff";
    for (let index = 4; index >= 1; index -= 1) {
      const trailRadius = PROJECTILE_RADIUS + index * 2.4;
      const trailAlpha = 0.12 + index * 0.07;
      ctx.save();
      ctx.globalAlpha = trailAlpha;
      ctx.fillStyle = flameColor;
      ctx.beginPath();
      ctx.arc(projectile.x - projectile.vx * index * 1.4, projectile.y - projectile.vy * index * 1.4, trailRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.save();
    ctx.shadowColor = flameColor;
    ctx.shadowBlur = 18;
    ctx.fillStyle = "rgba(255,255,255,0.28)";
    ctx.beginPath();
    ctx.arc(projectile.x, projectile.y, PROJECTILE_RADIUS + 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = flameColor;
    ctx.beginPath();
    ctx.arc(projectile.x, projectile.y, PROJECTILE_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
}

function drawCraters() {
  craters.forEach((crater) => {
    const fade = Math.min(1, crater.life / 1200);
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.shadowColor = "#ff6b2e";
    ctx.shadowBlur = 14;
    ctx.fillStyle = "#25170f";
    ctx.strokeStyle = "#d97838";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.ellipse(crater.x, GROUND_Y + 5, crater.width / 2, crater.depth / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(255, 190, 103, 0.75)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(crater.x, GROUND_Y + 5, crater.width * 0.34, crater.depth * 0.3, 0, 0.15, Math.PI - 0.15);
    ctx.stroke();
    ctx.restore();
  });
}

function drawMeteors() {
  meteors.forEach((meteor) => {
    ctx.save();
    const wobble = Math.sin((meteor.y + meteor.x) * 0.025) * 0.08;
    ctx.translate(meteor.x, meteor.y);
    ctx.rotate(wobble);
    ctx.shadowColor = "#ff642e";
    ctx.shadowBlur = 32;
    ctx.fillStyle = "#ff6b35";
    ctx.beginPath();
    ctx.arc(0, 0, meteor.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#5a3329";
    ctx.beginPath();
    ctx.arc(-meteor.radius * 0.1, -meteor.radius * 0.12, meteor.radius * 0.72, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffc36b";
    ctx.beginPath();
    ctx.arc(-meteor.radius * 0.35, -meteor.radius * 0.38, meteor.radius * 0.18, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
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
    ctx.globalAlpha = fade * 0.72;
    ctx.shadowColor = "#8ae7ff";
    ctx.shadowBlur = 18;
    drawPlayer({
      ...owner,
      x: decoy.x,
      y: decoy.y,
      vx: decoy.vx,
      vy: decoy.vy,
      hitFlash: decoy.hitFlash || 0,
      attackTimer: decoy.attackTimer || 0,
      facing: decoy.facing,
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
    ctx.shadowBlur = effect.type === "afterimage" ? 28 : effect.type === "void" ? 30 : 16;
    ctx.strokeStyle = effect.color;
    ctx.fillStyle = effect.color;
    if (effect.type === "ring") {
      const radius = effect.radius * (1 + (1 - alpha) * 1.5);
      ctx.lineWidth = Math.max(1, 5 * alpha);
      ctx.beginPath();
      ctx.arc(effect.x, effect.y, radius, 0, Math.PI * 2);
      ctx.stroke();
    } else if (effect.type === "afterimage") {
      ctx.lineWidth = 2.5 + alpha * 4;
      ctx.beginPath();
      ctx.ellipse(effect.x, effect.y, effect.radius, effect.radius * 0.42, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (effect.type === "flame") {
      ctx.lineWidth = 2 + alpha * 4;
      ctx.beginPath();
      ctx.arc(effect.x, effect.y, effect.radius * (0.8 + alpha), 0, Math.PI * 2);
      ctx.stroke();
    } else if (effect.type === "void") {
      ctx.lineWidth = 2.5 + alpha * 3;
      ctx.beginPath();
      ctx.arc(effect.x, effect.y, effect.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "rgba(12, 10, 22, 0.58)";
      ctx.beginPath();
      ctx.arc(effect.x, effect.y, effect.radius * 0.7, 0, Math.PI * 2);
      ctx.fill();
    } else if (effect.type === "rift") {
      ctx.lineWidth = 2.5 + alpha * 5;
      ctx.strokeStyle = "rgba(164, 130, 255, 0.9)";
      ctx.beginPath();
      ctx.ellipse(effect.x, effect.y, effect.radius, effect.radius * 1.6, effect.rotation || 0, 0.3, Math.PI * 1.7);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(effect.x + effect.radius * 0.15, effect.y - effect.radius * 0.25, effect.radius * 0.55, effect.radius * 0.88, effect.rotation || 0, 0.2, Math.PI * 1.8);
      ctx.stroke();
    } else if (effect.type === "heal") {
      ctx.lineWidth = 2.5 + alpha * 4;
      ctx.strokeStyle = effect.color;
      ctx.beginPath();
      ctx.arc(effect.x, effect.y, effect.radius * (1 + alpha * 0.8), 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(effect.x - effect.radius * 0.7, effect.y);
      ctx.lineTo(effect.x + effect.radius * 0.7, effect.y);
      ctx.moveTo(effect.x, effect.y - effect.radius * 0.7);
      ctx.lineTo(effect.x, effect.y + effect.radius * 0.7);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(effect.x, effect.y, effect.radius * alpha, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  });
}

function spawnFlameBurst(x, y, color, count = 16) {
  effects.push({ type: "ring", x, y, color, radius: 10, life: 180, maxLife: 180 });
  for (let index = 0; index < count; index += 1) {
    const angle = (Math.PI * 2 * index) / count + Math.random() * 0.4;
    const speed = 1.5 + Math.random() * 2.8;
    effects.push({
      type: "flame",
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 0.4,
      color,
      radius: 4 + Math.random() * 6,
      life: 180 + Math.random() * 80,
      maxLife: 260,
    });
  }
}

function spawnVoidMarker(x, y) {
  effects.push({
    type: "void",
    x,
    y,
    color: "#312a59",
    radius: 14,
    life: 420,
    maxLife: 420,
  });
  for (let index = 0; index < 8; index += 1) {
    const angle = (Math.PI * 2 * index) / 8;
    effects.push({
      type: "particle",
      x,
      y,
      vx: Math.cos(angle) * (2 + Math.random() * 2),
      vy: Math.sin(angle) * (2 + Math.random() * 2),
      color: "#7c6cff",
      radius: 2 + Math.random() * 2,
      life: 200 + Math.random() * 150,
      maxLife: 350,
    });
  }
}

function spawnRift(x, y, rotation = 0) {
  effects.push({
    type: "rift",
    x,
    y,
    color: "#ad9bff",
    radius: 20,
    rotation,
    life: 260,
    maxLife: 260,
  });
  for (let index = 0; index < 16; index += 1) {
    const angle = (Math.PI * 2 * index) / 16;
    effects.push({
      type: "particle",
      x,
      y,
      vx: Math.cos(angle) * (3 + Math.random() * 3),
      vy: Math.sin(angle) * (3 + Math.random() * 3),
      color: "#8b7dff",
      radius: 2 + Math.random() * 3,
      life: 200 + Math.random() * 180,
      maxLife: 360,
    });
  }
}

function spawnHealEffect(x, y) {
  effects.push({
    type: "heal",
    x,
    y,
    color: "#9dffca",
    radius: 12,
    life: 240,
    maxLife: 240,
  });
  for (let index = 0; index < 18; index += 1) {
    const angle = (Math.PI * 2 * index) / 18;
    effects.push({
      type: "particle",
      x,
      y,
      vx: Math.cos(angle) * (1.2 + Math.random() * 2),
      vy: -0.6 + Math.sin(angle) * (1.0 + Math.random() * 2),
      color: "#7dffb8",
      radius: 2 + Math.random() * 3,
      life: 220 + Math.random() * 160,
      maxLife: 300,
    });
  }
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

function spawnAttackTrail(player, count = 4) {
  const centerX = player.x + PLAYER_WIDTH / 2;
  const centerY = player.y + PLAYER_HEIGHT * 0.52;
  const color = player.id === 1 ? "#ff6d7c" : "#81ecff";
  for (let index = 0; index < count; index += 1) {
    effects.push({
      type: "afterimage",
      x: centerX + player.facing * (8 + index * 12),
      y: centerY + (Math.random() - 0.5) * 12,
      vx: player.facing * (0.5 + index * 0.35),
      vy: (Math.random() - 0.5) * 0.8,
      color,
      radius: 10 + index * 5,
      life: 120 + index * 18,
      maxLife: 180,
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
    if (effect.type === "afterimage") {
      effect.x += effect.vx;
      effect.y += effect.vy;
      effect.vx *= 0.9;
      effect.vy *= 0.96;
    }
    if (effect.type === "flame") {
      effect.x += effect.vx;
      effect.y += effect.vy;
      effect.vx *= 0.96;
      effect.vy *= 0.98;
      effect.vy += 0.04;
    }
    if (effect.type === "void") {
      effect.radius += 0.35;
    }
    if (effect.type === "rift") {
      effect.radius += 0.7;
      effect.rotation += 0.18;
    }
    if (effect.type === "heal") {
      effect.radius += 0.45;
      effect.y -= 0.15;
    }
    if (effect.life <= 0) effects.splice(index, 1);
  }
  players.forEach((player) => {
    if (player.attackTimer > 0 && player.health > 0 && Math.random() < 0.7) {
      spawnAttackTrail(player, 3);
    }
    player.hitFlash = Math.max(0, player.hitFlash - 16);
  });
  screenShakeTimer = Math.max(0, screenShakeTimer - 16);
}

function triggerHitVibration() {
  if (!navigator.vibrate) return;
  navigator.vibrate(Math.max(20, 35 * SCREEN_SHAKE_VIBRATION_MULTIPLIER));
}

function applyHitReaction(target, attacker) {
  const targetCenterX = target.x + PLAYER_WIDTH / 2;
  const attackerCenterX = attacker.x + PLAYER_WIDTH / 2;
  const direction = Math.sign(targetCenterX - attackerCenterX) || attacker.facing;
  target.vx = direction * 8;
  target.vy = Math.min(target.vy, -5);
  target.onGround = false;
  screenShakeTimer = SCREEN_SHAKE_DURATION;
  triggerHitVibration();
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
    const moveLeft = window.duel
      ? window.duel.isActionDown(player, "left")
      : keys.has(player.controls.left);
    const moveRight = window.duel
      ? window.duel.isActionDown(player, "right")
      : keys.has(player.controls.right);
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
    const crater = craters.find((candidate) =>
      candidate.life > 0 &&
      Math.abs(player.x + PLAYER_WIDTH / 2 - candidate.x) < candidate.width / 2
    );
    const landingY = crater ? GROUND_Y + crater.depth : GROUND_Y;
    if (player.y + PLAYER_HEIGHT >= landingY) {
      player.y = landingY - PLAYER_HEIGHT;
      player.vy = 0;
      player.onGround = true;
      player.jumpsRemaining = 2;
      if (crater && !crater.hitPlayers.includes(player.id) && player.health > 0) {
        crater.hitPlayers.push(player.id);
        player.health = Math.max(0, player.health - CRATER_DAMAGE);
        player.hitFlash = 240;
        player.vx = 0;
        player.vy = -17;
        player.onGround = false;
        screenShakeTimer = SCREEN_SHAKE_DURATION;
        triggerHitVibration();
        spawnImpact(player.x + PLAYER_WIDTH / 2, landingY, "#ff8438", 22);
        if (player.health <= 0) {
          message.textContent = `玩家 ${player.id} 被隕石坑擊倒！`;
        }
      }
    }

    if (player.attackTimer > 0) {
      player.attackTimer -= 16;
      if (player.attackTimer <= 0) {
        player.attackTimer = 0;
        player.attackHit.clear();
      }
    }
    player.skillCooldown = Math.max(0, player.skillCooldown - 16);
    if (player.id === 1 && player.skillRechargeTimer > 0) {
      player.skillRechargeTimer = Math.max(0, player.skillRechargeTimer - 16);
      if (player.skillRechargeTimer === 0) {
        player.skillCharges = Math.min(MAX_SKILL_CHARGES, player.skillCharges + 1);
        if (player.skillCharges < MAX_SKILL_CHARGES) {
          player.skillRechargeTimer = SKILL_COOLDOWN;
        }
      }
    }
    player.hookCooldown = Math.max(0, player.hookCooldown - 16);
    if (player.healCooldown !== undefined) {
      player.healCooldown = Math.max(0, player.healCooldown - 16);
    }
    player.decoyCooldown = Math.max(0, player.decoyCooldown - 16);
    if (player.id === 2) {
      player.meteorCooldown = Math.max(0, player.meteorCooldown - 16);
    }
    if (player.id === 1) {
      player.ultimateCooldown = Math.max(0, player.ultimateCooldown - 16);
      if (player.ultimateState) {
        const state = player.ultimateState;
        state.timer += 16;
        const target = players.find((candidate) => candidate.id === state.targetId && candidate.health > 0);
        if (!target) {
          player.ultimateState = null;
          if (player.ultimateCooldown === 0) {
            player.ultimateCooldown = ULTIMATE_COOLDOWN;
          }
        } else {
          const chaseX = target.x + PLAYER_WIDTH / 2 - player.facing * 30;
          const chaseY = Math.min(player.y, target.y - 40);
          player.x += (chaseX - player.x) * 0.2;
          player.y += (chaseY - player.y) * 0.18;
          player.facing = target.x >= player.x ? 1 : -1;
          if (state.timer >= state.nextStrikeAt) {
            executeUltimateSlash(player, target, state.slashIndex, ULTIMATE_STRIKE_COUNT);
            state.slashIndex += 1;
            state.nextStrikeAt += ULTIMATE_STRIKE_INTERVAL;
            spawnRift(
              target.x + PLAYER_WIDTH / 2,
              target.y + PLAYER_HEIGHT / 2 - 10,
              (player.facing === 1 ? 0.7 : -0.7),
            );
            spawnRift(
              player.x + PLAYER_WIDTH / 2,
              player.y + PLAYER_HEIGHT / 2 - 12,
              (player.facing === 1 ? -0.8 : 0.8),
            );
          }
          if (state.slashIndex >= ULTIMATE_STRIKE_COUNT) {
            player.ultimateState = null;
            if (player.ultimateCooldown === 0) {
              player.ultimateCooldown = ULTIMATE_COOLDOWN;
            }
          }
        }
      }
    }
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

function updateMeteors() {
  for (let index = meteors.length - 1; index >= 0; index -= 1) {
    const meteor = meteors[index];
    meteor.vy += 0.24;
    meteor.y += meteor.vy;
    meteor.life -= 16;

    const target = players.find((player) => {
      if (player.id === meteor.ownerId || player.health <= 0) return false;
      return rectsOverlap(
        { x: meteor.x - meteor.radius, y: meteor.y - meteor.radius, width: meteor.radius * 2, height: meteor.radius * 2 },
        { x: player.x + 5, y: player.y + 5, width: PLAYER_WIDTH - 10, height: PLAYER_HEIGHT - 5 },
      );
    });

    if (target) {
      target.health = Math.max(0, target.health - meteor.damage);
      target.hitFlash = 240;
      target.vx = Math.sign(target.x + PLAYER_WIDTH / 2 - meteor.x) * 7 || (target.id === 1 ? -7 : 7);
      target.vy = -48;
      target.onGround = false;
      screenShakeTimer = SCREEN_SHAKE_DURATION;
      triggerHitVibration();
      spawnImpact(meteor.x, meteor.y, "#ffad4d", 24);
      if (target.health <= 0) {
        message.textContent = `玩家 ${target.id} 被隕石衝擊擊倒！`;
      }
      meteors.splice(index, 1);
      updateHealthUI();
      continue;
    }

    if (meteor.y + meteor.radius >= GROUND_Y || meteor.life <= 0) {
      if (!craters.some((crater) => crater.volleyId === meteor.volleyId)) {
        craters.push({
          volleyId: meteor.volleyId,
          x: meteor.craterX,
          width: CRATER_WIDTH,
          depth: CRATER_DEPTH,
          life: CRATER_LIFETIME,
          maxLife: CRATER_LIFETIME,
          hitPlayers: [],
        });
      }
      spawnImpact(meteor.x, GROUND_Y, "#ff8438", 20);
      meteors.splice(index, 1);
    }
  }

  for (let index = craters.length - 1; index >= 0; index -= 1) {
    craters[index].life -= 16;
    if (craters[index].life <= 0) craters.splice(index, 1);
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
    decoy.life -= 16;
    decoy.attackCooldown = Math.max(0, (decoy.attackCooldown || 0) - 16);
    decoy.hitFlash = Math.max(0, (decoy.hitFlash || 0) - 16);
    decoy.actionTimer = Math.max(0, (decoy.actionTimer || 0) - 16);
    decoy.attackTimer = Math.max(0, (decoy.attackTimer || 0) - 16);
    decoy.trickTimer = Math.max(0, (decoy.trickTimer || 0) - 16);

    const target = players.find((player) => player.id !== decoy.ownerId && player.health > 0);
    if (target) {
      const targetCenterX = target.x + PLAYER_WIDTH / 2;
      const decoyCenterX = decoy.x + PLAYER_WIDTH / 2;
      const dx = targetCenterX - decoyCenterX;
      const distance = Math.abs(dx);
      decoy.facing = dx >= 0 ? 1 : -1;

      if (decoy.actionTimer <= 0) {
        decoy.actionTimer = 180 + Math.random() * 170;
        decoy.behavior = Math.random();
      }

      if (decoy.behavior < 0.35) {
        decoy.vx += decoy.facing * 1.2;
        if (Math.random() < 0.06 && decoy.onGround) {
          decoy.vy = -14 - Math.random() * 2;
          decoy.onGround = false;
          decoy.jumpsRemaining = 1;
        }
      } else if (decoy.behavior < 0.7) {
        decoy.vx -= decoy.facing * 0.8;
      } else {
        decoy.vx += (Math.random() * 2 - 1) * 1.5;
      }

      const targetBox = { x: target.x, y: target.y, width: PLAYER_WIDTH, height: PLAYER_HEIGHT };
      const decoyBox = { x: decoy.x, y: decoy.y, width: PLAYER_WIDTH, height: PLAYER_HEIGHT };
      if (distance <= 32 && rectsOverlap(decoyBox, targetBox) && decoy.attackCooldown === 0) {
        decoy.attackTimer = 140;
        decoy.attackCooldown = 420 + Math.random() * 180;
        target.health = Math.max(0, target.health - 3);
        target.hitFlash = 150;
        applyHitReaction(target, { x: decoy.x, y: decoy.y, facing: decoy.facing });
        spawnImpact(target.x + PLAYER_WIDTH / 2, target.y + PLAYER_HEIGHT / 2, "#69d7ff", 14);
        if (target.health <= 0) {
          message.textContent = `玩家 ${target.id} 被擊倒！`;
        }
        updateHealthUI();
      }

      if (decoy.trickTimer <= 0 && decoy.onGround) {
        decoy.trickTimer = 200 + Math.random() * 160;
        decoy.vy = -13 - Math.random() * 4;
        decoy.onGround = false;
        decoy.jumpsRemaining = 1;
      }

      if ((Math.random() < 0.03 || distance < 18) && decoy.jumpsRemaining > 0 && decoy.onGround === false) {
        decoy.vy = -12 - Math.random() * 4;
        decoy.jumpsRemaining -= 1;
      }
    }

    decoy.vy += GRAVITY;
    decoy.x += decoy.vx;
    decoy.y += decoy.vy;
    decoy.vx *= 0.88;
    decoy.vy *= 0.96;
    decoy.vx = Math.max(-7.0, Math.min(7.0, decoy.vx));

    if (decoy.x < 40 || decoy.x > canvas.width - PLAYER_WIDTH - 40) {
      decoy.vx *= -1;
      decoy.facing *= -1;
    }
    if (decoy.y + PLAYER_HEIGHT >= GROUND_Y) {
      decoy.y = GROUND_Y - PLAYER_HEIGHT;
      decoy.vy = 0;
      decoy.onGround = true;
      decoy.jumpsRemaining = 2;
    }
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
  if (!gameStarted || gameOver) return;
  const alive = players.filter((player) => player.health > 0);
  if (alive.length <= 1) {
    gameOver = true;
    if (alive.length === 1) {
      matchScore[alive[0].id - 1] += 1;
      if (matchScore[alive[0].id - 1] >= 2) {
        matchOver = true;
        message.textContent = `玩家 ${alive[0].id} 贏得三戰兩勝！最終比分 ${matchScore[0]} : ${matchScore[1]}。請開始新系列賽。`;
      } else {
        message.textContent = `玩家 ${alive[0].id} 贏得本局！比分 ${matchScore[0]} : ${matchScore[1]}。請開始下一局。`;
      }
    } else {
      message.textContent = `本局平手，比分維持 ${matchScore[0]} : ${matchScore[1]}。請重賽。`;
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
    const lifeWidth = (player.health / MAX_HEALTH) * barWidth;
    ctx.fillRect(left, top, lifeWidth, barHeight);
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.strokeRect(left, top, barWidth, barHeight);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 14px sans-serif";
    ctx.textAlign = index === 0 ? "left" : "right";
    ctx.textBaseline = "middle";
    const percentage = `${Math.round((player.health / MAX_HEALTH) * 100)}%`;
    const textX = index === 0 ? left + barWidth + 8 : left - 8;
    ctx.fillText(percentage, textX, top + barHeight / 2);
    if (player.id === 1) {
      ctx.fillStyle = "#fff";
      ctx.font = "12px sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(
        player.ultimateCooldown > 0
          ? `U 大招 ${(player.ultimateCooldown / 1000).toFixed(1)} 秒`
          : "U 大招 就緒",
        left,
        top + barHeight + 14,
      );
    } else {
      const meteorKey = window.duel
        ? window.duel.controlKey(player, "meteor")
        : player.controls.meteor;
      ctx.fillStyle = "#fff";
      ctx.font = "12px sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(
        player.meteorCooldown > 0
          ? `${meteorKey} 隕石 ${(player.meteorCooldown / 1000).toFixed(1)} 秒`
          : `${meteorKey} 隕石 就緒`,
        left + barWidth,
        top + barHeight + 14,
      );
    }
  });
  const centerX = canvas.width / 2;
  const scoreTop = 10;
  ctx.fillStyle = "rgba(12, 18, 30, 0.88)";
  ctx.fillRect(centerX - 54, scoreTop, 108, 38);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.24)";
  ctx.strokeRect(centerX - 54, scoreTop, 108, 38);
  ctx.fillStyle = "#bec9e0";
  ctx.font = "10px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("BO3", centerX, scoreTop + 9);
  ctx.fillStyle = "#fff";
  ctx.font = "bold 20px sans-serif";
  ctx.fillText(`${matchScore[0]} : ${matchScore[1]}`, centerX, scoreTop + 26);
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  if (screenShakeTimer > 0) {
    const intensity = SCREEN_SHAKE_INTENSITY * SCREEN_SHAKE_VIBRATION_MULTIPLIER * (screenShakeTimer / SCREEN_SHAKE_DURATION);
    ctx.translate((Math.random() * 2 - 1) * intensity, (Math.random() * 2 - 1) * intensity);
  }
  drawBackground();
  drawCraters();
  drawHealthBars();
  drawProjectiles();
  drawMeteors();
  drawHooks();
  drawDecoys();
  players.forEach((player) => {
    drawPlayer(player);
  });
  drawEffects();
  ctx.restore();
}

let lastFrame = 0;
let accumulated = 0;
function gameLoop(now) {
  accumulated += Math.min(100, now - (lastFrame || now));
  lastFrame = now;
  while (accumulated >= 1000 / 60) {
    accumulated -= 1000 / 60;
    if (gameStarted && !gameOver && (!window.duel || window.duel.canSimulate())) {
    updatePlayers();
    processAttacks();
    updateProjectiles();
    updateMeteors();
    updateHooks();
    updateDecoys();
    updateEffects();
    checkGameOver();
    }
  }
  if (window.duel) window.duel.tick(now);
  draw();
  requestAnimationFrame(gameLoop);
}

function attackPlayer(player) {
  if (player.attackTimer === 0 && player.health > 0 && !gameOver) {
    player.attackTimer = BASIC_ATTACK.duration;
    player.attackHit.clear();
    spawnAttackTrail(player, 8);
    updateHealthUI();
  }
}

function useSkill(player) {
  if (player.health <= 0 || gameOver) return;

  if (player.id === 1) {
    if (player.skillCharges <= 0) return;
    const previousX = player.x;
    const previousY = player.y + PLAYER_HEIGHT / 2;
    const destinationX = Math.max(
      0,
      Math.min(canvas.width - PLAYER_WIDTH, player.x + player.facing * SKILL_DISTANCE),
    );
    player.x = destinationX;
    player.vx = 0;
    for (let index = 0; index < 10; index += 1) {
      effects.push({
        type: "afterimage",
        x: previousX + PLAYER_WIDTH / 2 + (player.facing * (index + 1) * 10),
        y: previousY + (Math.random() - 0.5) * 16,
        vx: player.facing * (1.5 + index * 0.2),
        vy: (Math.random() - 0.5) * 1.2,
        color: "#a5b7ff",
        radius: 12 + index * 2,
        life: 180 + index * 18,
        maxLife: 220,
      });
    }
    spawnVoidMarker(previousX + PLAYER_WIDTH / 2, previousY);
    spawnImpact(destinationX + PLAYER_WIDTH / 2, player.y + PLAYER_HEIGHT / 2, "#7a7cff", 18);
    player.skillCharges -= 1;
    if (player.skillRechargeTimer === 0) {
      player.skillRechargeTimer = SKILL_COOLDOWN;
    }
  } else {
    if (player.skillCooldown > 0) return;
    const originX = player.x + PLAYER_WIDTH / 2;
    const originY = player.y + PLAYER_HEIGHT / 2;
    spawnFlameBurst(originX, originY, "#ff9745", 18);
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
    player.skillCooldown = SKILL_COOLDOWN;
  }
  updateHealthUI();
}

function findUltimateTarget(player) {
  const facingRange = 150;
  const centerX = player.x + PLAYER_WIDTH / 2;
  const centerY = player.y + PLAYER_HEIGHT / 2;
  const targets = players.filter((candidate) => candidate.id !== player.id && candidate.health > 0);
  return targets.find((target) => {
    const targetCenterX = target.x + PLAYER_WIDTH / 2;
    const targetCenterY = target.y + PLAYER_HEIGHT / 2;
    const dx = targetCenterX - centerX;
    const dy = targetCenterY - centerY;
    const distance = Math.hypot(dx, dy);
    const inFront = player.facing === 1 ? dx > 0 : dx < 0;
    return inFront && distance <= facingRange && Math.abs(dy) < 80;
  }) || null;
}

function executeUltimateSlash(player, target, index, total) {
  if (!target || target.health <= 0) {
    player.ultimateState = null;
    player.ultimateCooldown = ULTIMATE_COOLDOWN;
    return;
  }

  const damage = index === total - 1 ? 30 : 7;
  const strongHit = index === total - 1;
  const slashX = player.x + PLAYER_WIDTH / 2 + player.facing * (32 + index * 20);
  const slashY = player.y + PLAYER_HEIGHT / 2 - 12 + Math.sin(index * 1.2) * 12;
  spawnImpact(slashX, slashY, strongHit ? "#fff4b2" : "#ff8c8c", strongHit ? 18 : 12);
  spawnRift(slashX, slashY - 8, player.facing === 1 ? 0.9 : -0.9);

  for (let i = 0; i < 10; i += 1) {
    effects.push({
      type: "afterimage",
      x: slashX + (Math.random() - 0.5) * 34,
      y: slashY + (Math.random() - 0.5) * 18,
      vx: player.facing * (2.5 + i * 0.35),
      vy: -0.8 - Math.random() * 1.8,
      color: strongHit ? "#fff5a9" : "#ffcfba",
      radius: 8 + i * 2.2,
      life: 150 + i * 14,
      maxLife: 200,
    });
  }

  target.health = Math.max(0, target.health - damage);
  target.hitFlash = 200;
  target.vx = player.facing * (strongHit ? 12 : 7);
  target.vy = strongHit ? -17 : -6;
  target.onGround = false;
  spawnImpact(
    target.x + PLAYER_WIDTH / 2,
    target.y + PLAYER_HEIGHT / 2,
    strongHit ? "#fff1a8" : "#ff7d6e",
    strongHit ? 20 : 12,
  );
  if (strongHit) {
    spawnImpact(player.x + PLAYER_WIDTH / 2, player.y + PLAYER_HEIGHT / 2, "#f3ecff", 16);
    for (let i = 0; i < 12; i += 1) {
      effects.push({
        type: "afterimage",
        x: target.x + PLAYER_WIDTH / 2 + (Math.random() - 0.5) * 35,
        y: target.y + PLAYER_HEIGHT / 2 + (Math.random() - 0.5) * 20,
        vx: player.facing * (1.2 + i * 0.25),
        vy: -0.7 - Math.random() * 1.4,
        color: "#ffd07a",
        radius: 8 + i * 2,
        life: 120 + i * 14,
        maxLife: 180,
      });
    }
  }
  if (target.health <= 0) {
    message.textContent = `玩家 ${target.id} 被擊倒！`;
  }
  updateHealthUI();
}

function useUltimate(player) {
  if (player.id !== 1) return;
  if (player.ultimateCooldown > 0 || player.health <= 0 || gameOver) return;

  const target = findUltimateTarget(player);
  const startX = player.x;
  const dashX = Math.max(0, Math.min(canvas.width - PLAYER_WIDTH, player.x + player.facing * ULTIMATE_DASH_DISTANCE));
  player.x = dashX;
  player.vx = 0;
  if (!target) {
    player.ultimateCooldown = ULTIMATE_COOLDOWN;
    spawnImpact(startX + PLAYER_WIDTH / 2, player.y + PLAYER_HEIGHT / 2, "#6a7cff", 20);
    spawnImpact(dashX + PLAYER_WIDTH / 2, player.y + PLAYER_HEIGHT / 2, "#a198ff", 10);
    updateHealthUI();
    return;
  }

  player.ultimateState = {
    targetId: target.id,
    timer: 0,
    slashIndex: 0,
    nextStrikeAt: ULTIMATE_STRIKE_INTERVAL,
  };
  spawnImpact(player.x + PLAYER_WIDTH / 2, player.y + PLAYER_HEIGHT / 2, "#ffc0a6", 18);
  for (let index = 0; index < 8; index += 1) {
    effects.push({
      type: "afterimage",
      x: startX + PLAYER_WIDTH / 2 + player.facing * (18 + index * 10),
      y: player.y + PLAYER_HEIGHT / 2 + (Math.random() - 0.5) * 18,
      vx: player.facing * (2 + index * 0.5),
      vy: (Math.random() - 0.5) * 1.2,
      color: "#ffec99",
      radius: 12 + index * 2,
      life: 160 + index * 15,
      maxLife: 200,
    });
  }
}

function useMeteorStrike(player) {
  if (player.id !== 2 || !gameStarted || player.meteorCooldown > 0 || player.health <= 0 || gameOver) return;
  const target = players.find((candidate) => candidate.id !== player.id && candidate.health > 0);
  if (!target) return;

  const targetCenterX = target.x + PLAYER_WIDTH / 2;
  const centerX = Math.max(44, Math.min(canvas.width - 44, targetCenterX));
  const volleyId = nextMeteorVolleyId++;
  for (let index = 0; index < METEOR_COUNT; index += 1) {
    const offset = (index - 1) * 90;
    meteors.push({
      ownerId: player.id,
      volleyId,
      x: Math.max(40, Math.min(canvas.width - 40, centerX + offset)),
      y: -70 - Math.abs(index - 1) * 24,
      vy: 6.5 + index * 0.4,
      radius: 70,
      damage: METEOR_DAMAGE,
      craterX: centerX,
      life: 1800,
    });
  }
  player.meteorCooldown = METEOR_COOLDOWN;
  spawnImpact(player.x + PLAYER_WIDTH / 2, player.y + PLAYER_HEIGHT / 2, "#bca4ff", 18);
  message.textContent = "玩家 2 使用隕石衝擊！";
  updateHealthUI();
}

function useHeal(player) {
  if (player.id !== 2) return;
  if (player.healCooldown > 0 || player.health <= 0 || gameOver) return;

  const previousHealth = player.health;
  player.health = Math.min(MAX_HEALTH, player.health + HEAL_AMOUNT);
  player.healCooldown = HEAL_COOLDOWN;

  const centerX = player.x + PLAYER_WIDTH / 2;
  const centerY = player.y + PLAYER_HEIGHT / 2;
  spawnHealEffect(centerX, centerY);
  spawnImpact(centerX, centerY, "#83f7b3", 18);
  for (let index = 0; index < 12; index += 1) {
    effects.push({
      type: "afterimage",
      x: centerX + (Math.random() - 0.5) * 30,
      y: centerY + (Math.random() - 0.5) * 20,
      vx: (Math.random() - 0.5) * 2,
      vy: -0.8 - Math.random() * 1.2,
      color: "#9dffca",
      radius: 10 + index * 2,
      life: 140 + index * 12,
      maxLife: 180,
    });
  }
  if (player.health > previousHealth) {
    message.textContent = `玩家 ${player.id} 使用治療，恢復 ${player.health - previousHealth} 點生命！`;
  }
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
    const cloneX = Math.max(0, Math.min(canvas.width - PLAYER_WIDTH, player.x + offset * 60));
    const cloneY = player.y + (offset === 0 ? -12 : 8);
    decoys.push({
      id: `decoy-${nextDecoyId}`,
      ownerId: player.id,
      x: cloneX,
      y: cloneY,
      vx: player.facing * (2.8 + Math.random() * 1.5),
      vy: 0,
      life: DECOY_LIFETIME,
      attackCooldown: 160 + Math.random() * 220,
      attackTimer: 0,
      hitFlash: 0,
      facing: player.facing,
      onGround: true,
      behavior: Math.random(),
      actionTimer: 120 + Math.random() * 180,
      seed: Math.random() * 2.2,
      jumpsRemaining: 2,
      trickTimer: 30 + Math.random() * 60,
    });
    nextDecoyId += 1;
  });
  player.decoyCooldown = 14500;
  spawnImpact(player.x + PLAYER_WIDTH / 2, player.y + PLAYER_HEIGHT / 2, "#70faff", 18);
  updateHealthUI();
}

window.addEventListener("keydown", (event) => {
  if (event.target && event.target.closest && event.target.closest('input, textarea, select')) return;
  if (window.duel && window.duel.keyboard(event, true)) return;
  const key = event.key.toLowerCase();
  if (key.startsWith('arrow')) event.preventDefault();
  if (event.code === "Space") {
    event.preventDefault();
    if (!gameStarted || gameOver) startNextGame();
    return;
  }

  if (event.repeat) return;
  keys.add(key);
  players.forEach((player) => {
    if (key === player.controls.jump) jumpPlayer(player);
    if (key === player.controls.attack) attackPlayer(player);
    if (key === player.controls.skill) useSkill(player);
    if (key === player.controls.heal) useHeal(player);
    if (key === player.controls.ultimate) useUltimate(player);
    if (key === player.controls.hook) useHook(player);
    if (key === player.controls.decoy) useDecoys(player);
    if (key === player.controls.meteor) useMeteorStrike(player);
  });
});

window.addEventListener("keyup", (event) => {
  if (window.duel && window.duel.keyboard(event, false)) return;
  keys.delete(event.key.toLowerCase());
});

resetGame();
gameStarted = false;
message.textContent = "按空白鍵開始遊戲";
requestAnimationFrame(gameLoop);
