const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const message = document.getElementById("message");
const health1 = document.getElementById("health1");
const health2 = document.getElementById("health2");
const health3 = document.getElementById("health3");

const GROUND_Y = 380;
const GRAVITY = 0.9;
const FRICTION = 0.85;
const PLAYER_WIDTH = 48;
const PLAYER_HEIGHT = 68;
const ATTACK_DURATION = 180;
const ATTACK_RANGE = 70;
const ATTACK_DAMAGE = 14;

const keys = new Set();
let gameStarted = false;
let gameOver = false;

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
    weight: 1,
    onGround: true,
    attackTimer: 0,
    attackHit: new Set(),
    controls: { left: "a", right: "d", jump: "w", attack: "s" },
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
    weight: 1,
    onGround: true,
    attackTimer: 0,
    attackHit: new Set(),
    controls: { left: "ArrowLeft", right: "ArrowRight", jump: "ArrowUp", attack: "ArrowDown" },
  },
  {
    id: 3,
    color: "#80e07d",
    x: 690,
    y: GROUND_Y - PLAYER_HEIGHT,
    vx: 0,
    vy: 0,
    facing: -1,
    health: 100,
    weight: 1,
    onGround: true,
    attackTimer: 0,
    attackHit: new Set(),
    controls: { left: "4", right: "6", jump: "8", attack: "5" },
  },
];

function resetGame() {
  players.forEach((player, index) => {
    player.x = 90 + index * 300;
    player.y = GROUND_Y - PLAYER_HEIGHT;
    player.vx = 0;
    player.vy = 0;
    player.facing = index === 2 ? -1 : 1;
    player.health = 100;
    player.onGround = true;
    player.attackTimer = 0;
    player.attackHit.clear();
  });
  gameStarted = true;
  gameOver = false;
  message.textContent = "三人決鬥開始！攻擊對手並保護自己的生命值。";
  updateHealthUI();
}

function updateHealthUI() {
  health1.textContent = players[0].health;
  health2.textContent = players[1].health;
  health3.textContent = players[2].health;
}

function drawBackground() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#0a1120";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#19233c";
  ctx.fillRect(0, GROUND_Y + PLAYER_HEIGHT / 4, canvas.width, canvas.height - GROUND_Y - PLAYER_HEIGHT / 4);
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  for (let x = 0; x < canvas.width; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, GROUND_Y + PLAYER_HEIGHT / 4);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
}

function drawPlayer(player) {
  const shadowY = player.y + PLAYER_HEIGHT + 6;
  ctx.fillStyle = "rgba(0,0,0,0.12)";
  ctx.beginPath();
  ctx.ellipse(player.x + PLAYER_WIDTH / 2, shadowY, 28, 10, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = player.color;
  ctx.fillRect(player.x, player.y, PLAYER_WIDTH, PLAYER_HEIGHT);
  ctx.fillStyle = "rgba(255,255,255,0.65)";
  ctx.fillRect(player.x + 10, player.y + 12, PLAYER_WIDTH - 20, 12);
  ctx.fillRect(player.x + 14, player.y + 30, PLAYER_WIDTH - 28, 26);

  if (player.attackTimer > 0) {
    const attackX = player.facing === 1 ? player.x + PLAYER_WIDTH : player.x - ATTACK_RANGE;
    const attackY = player.y + PLAYER_HEIGHT / 4;
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.fillRect(attackX, attackY, ATTACK_RANGE, PLAYER_HEIGHT / 2);
  }
}

function getAttackHitbox(player) {
  const width = ATTACK_RANGE;
  const height = PLAYER_HEIGHT / 2;
  const x = player.facing === 1 ? player.x + PLAYER_WIDTH : player.x - width;
  const y = player.y + PLAYER_HEIGHT / 4;
  return { x, y, width, height };
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function updatePlayers() {
  players.forEach((player) => {
    const { left, right, jump, attack } = player.controls;
    const moveLeft = keys.has(left);
    const moveRight = keys.has(right);
    const jumpPressed = keys.has(jump);

    if (moveLeft) {
      player.vx -= 0.9;
      player.facing = -1;
    }
    if (moveRight) {
      player.vx += 0.9;
      player.facing = 1;
    }
    if (jumpPressed && player.onGround) {
      player.vy = -16;
      player.onGround = false;
    }

    player.vx *= FRICTION;
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
    }

    if (player.attackTimer > 0) {
      player.attackTimer -= 16;
      if (player.attackTimer <= 0) {
        player.attackTimer = 0;
        player.attackHit.clear();
      }
    }
  });
}

function processAttacks() {
  players.forEach((attacker) => {
    if (attacker.attackTimer > 0) {
      const hitbox = getAttackHitbox(attacker);
      players.forEach((target) => {
        if (target.id === attacker.id || attacker.attackHit.has(target.id) || target.health <= 0) return;
        const targetBox = { x: target.x, y: target.y, width: PLAYER_WIDTH, height: PLAYER_HEIGHT };
        if (rectsOverlap(hitbox, targetBox)) {
          target.health = Math.max(0, target.health - ATTACK_DAMAGE);
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
      message.textContent = `遊戲結束：玩家 ${alive[0].id} 獲勝！按任意鍵重新開始。`;
    } else {
      message.textContent = "平手！所有玩家同時倒地。按任意鍵重新開始。";
    }
  }
}

function drawHealthBars() {
  players.forEach((player, index) => {
    const barWidth = 140;
    const barHeight = 10;
    const left = 24 + index * 260;
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
  drawBackground();
  drawHealthBars();
  players.forEach((player) => {
    drawPlayer(player);
  });
}

function gameLoop() {
  if (!gameOver) {
    updatePlayers();
    processAttacks();
    checkGameOver();
  }
  draw();
  requestAnimationFrame(gameLoop);
}

function attackPlayer(player) {
  if (player.attackTimer === 0 && player.health > 0 && !gameOver) {
    player.attackTimer = ATTACK_DURATION;
    player.attackHit.clear();
  }
}

window.addEventListener("keydown", (event) => {
  keys.add(event.key);
  if (!gameStarted) {
    resetGame();
  }

  players.forEach((player) => {
    if (event.key === player.controls.attack) {
      attackPlayer(player);
    }
  });
});

window.addEventListener("keyup", (event) => {
  keys.delete(event.key);
});

resetGame();
requestAnimationFrame(gameLoop);
