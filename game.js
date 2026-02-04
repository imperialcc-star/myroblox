const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const ui = {
  hp: document.getElementById("hp"),
  coins: document.getElementById("coins"),
  kos: document.getElementById("kos"),
  costDamage: document.getElementById("costDamage"),
  costSpeed: document.getElementById("costSpeed"),
  costHeal: document.getElementById("costHeal"),
  breakHeal: document.getElementById("breakHeal"),

};

let paused = false;

// ---------- CONFIG ----------
const CFG = {
  enemyBaseHp: 25,
  enemyBaseSpeed: 1.2,
  enemyDamage: 8,          // enemy contact damage
  enemyHitCooldown: 30,    // frames between enemy hits to player
  attackRange: 55,
  attackArc: Math.PI / 2.4, // ~75 degrees
  attackCooldown: 14,      // frames
  coinPerKill: 3,

  waveStartEnemies: 4,
  waveEnemyAdd: 3,         // + enemies each wave
  waveHpMult: 1.12,        // hp scaling per wave
  waveSpeedMult: 1.03,     // speed scaling per wave
  waveBreakSeconds: 3,

  breakHealPerSecond: 10, // heals only during break
  healKitAmount: 30,

};

const state = {
  coins: 0,
  kos: 0,
  wave: 1,
  inBreak: true,
  breakTimer: Math.floor(CFG.waveBreakSeconds * 60),

  player: {
    x: canvas.width / 2,
    y: canvas.height / 2,
    r: 14,
    hp: 100,
    hpMax: 100,
    speed: 2.2,
    damage: 10,
    dashCooldown: 0,
    attackCooldown: 0,
    invuln: 0, // small invulnerability after getting hit
  },

  shop: { damageCost: 10, speedCost: 10, healCost: 12 },
  keys: new Set(),
  mouse: { x: 0, y: 0, down: false },
  enemies: [],
  coinsDrops: [],
  shake: 0,
};

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }

function angleTo(ax, ay, bx, by) { return Math.atan2(by - ay, bx - ax); }
function normAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function updateUI() {
  ui.hp.textContent = Math.max(0, Math.floor(state.player.hp));
  ui.coins.textContent = state.coins;
  ui.kos.textContent = state.kos;

  ui.costDamage.textContent = state.shop.damageCost;
  ui.costSpeed.textContent = state.shop.speedCost;
  ui.costHeal.textContent = state.shop.healCost;

  ui.breakHeal.textContent = state.inBreak ? "ON" : "OFF";
}


// ---------- GAMEPLAY: WAVES ----------
function startWave(waveNum) {
  state.enemies.length = 0;
  const count = CFG.waveStartEnemies + (waveNum - 1) * CFG.waveEnemyAdd;

  const hp = Math.floor(CFG.enemyBaseHp * Math.pow(CFG.waveHpMult, waveNum - 1));
  const sp = CFG.enemyBaseSpeed * Math.pow(CFG.waveSpeedMult, waveNum - 1);

  for (let i = 0; i < count; i++) spawnEnemy(hp, sp);

  state.inBreak = false;
}

function beginBreak() {
  state.inBreak = true;
  state.breakTimer = Math.floor(CFG.waveBreakSeconds * 60);
}

function spawnEnemy(hp, speed) {
  // Spawn around edges
  const pad = 20;
  const side = Math.floor(Math.random() * 4);
  let x, y;
  if (side === 0) { x = Math.random() * canvas.width; y = -pad; }
  if (side === 1) { x = canvas.width + pad; y = Math.random() * canvas.height; }
  if (side === 2) { x = Math.random() * canvas.width; y = canvas.height + pad; }
  if (side === 3) { x = -pad; y = Math.random() * canvas.height; }

  state.enemies.push({
    x, y,
    r: 13,
    hp,
    hpMax: hp,
    speed,
    hitCd: 0,
  });
}

// ---------- PLAYER MOVEMENT ----------
function movePlayer() {
  const p = state.player;

  let dx = 0, dy = 0;
  if (state.keys.has("w")) dy -= 1;
  if (state.keys.has("s")) dy += 1;
  if (state.keys.has("a")) dx -= 1;
  if (state.keys.has("d")) dx += 1;

  if (dx !== 0 || dy !== 0) {
    const len = Math.hypot(dx, dy);
    dx /= len; dy /= len;
  }

  p.x += dx * p.speed;
  p.y += dy * p.speed;

  p.x = clamp(p.x, p.r, canvas.width - p.r);
  p.y = clamp(p.y, p.r, canvas.height - p.r);

  if (p.dashCooldown > 0) p.dashCooldown -= 1;
  if (p.attackCooldown > 0) p.attackCooldown -= 1;
  if (p.invuln > 0) p.invuln -= 1;
}

function dash() {
  const p = state.player;
  if (p.dashCooldown > 0) return;

  let dx = 0, dy = 0;
  if (state.keys.has("w")) dy -= 1;
  if (state.keys.has("s")) dy += 1;
  if (state.keys.has("a")) dx -= 1;
  if (state.keys.has("d")) dx += 1;
  if (dx === 0 && dy === 0) return;

  const len = Math.hypot(dx, dy);
  dx /= len; dy /= len;

  p.x += dx * 85;
  p.y += dy * 85;

  p.x = clamp(p.x, p.r, canvas.width - p.r);
  p.y = clamp(p.y, p.r, canvas.height - p.r);

  p.dashCooldown = 90;
}

// ---------- COMBAT ----------
function attack() {
  const p = state.player;
  if (p.attackCooldown > 0) return;

  const aPlayer = angleTo(p.x, p.y, state.mouse.x, state.mouse.y);

  let killed = 0;
  for (let i = state.enemies.length - 1; i >= 0; i--) {
    const e = state.enemies[i];
    const d = dist(p.x, p.y, e.x, e.y);
    if (d > CFG.attackRange + e.r) continue;

    const aEnemy = angleTo(p.x, p.y, e.x, e.y);
    const delta = Math.abs(normAngle(aEnemy - aPlayer));
    if (delta > CFG.attackArc / 2) continue;

    e.hp -= p.damage;
    state.shake = 6;

    if (e.hp <= 0) {
      state.enemies.splice(i, 1);
      state.kos += 1;
      state.coins += CFG.coinPerKill;
      killed += 1;

      // coin drop visual
      state.coinsDrops.push({ x: e.x, y: e.y, t: 40 });
    }
  }

  p.attackCooldown = CFG.attackCooldown;
}

function updateEnemies() {
  const p = state.player;

  for (const e of state.enemies) {
    const a = angleTo(e.x, e.y, p.x, p.y);
    e.x += Math.cos(a) * e.speed;
    e.y += Math.sin(a) * e.speed;

    // contact damage
    if (e.hitCd > 0) e.hitCd -= 1;

    const d = dist(e.x, e.y, p.x, p.y);
    if (d <= e.r + p.r + 2 && e.hitCd === 0 && p.invuln === 0) {
      p.hp -= CFG.enemyDamage;
      p.invuln = 18;
      e.hitCd = CFG.enemyHitCooldown;
      state.shake = 10;
    }
  }
}

function updateCoinDrops() {
  for (let i = state.coinsDrops.length - 1; i >= 0; i--) {
    state.coinsDrops[i].t -= 1;
    state.coinsDrops[i].y -= 0.35;
    if (state.coinsDrops[i].t <= 0) state.coinsDrops.splice(i, 1);
  }
}

// ---------- DRAW ----------
function draw() {
  // screen shake
  let ox = 0, oy = 0;
  if (state.shake > 0) {
    ox = (Math.random() - 0.5) * state.shake;
    oy = (Math.random() - 0.5) * state.shake;
    state.shake -= 1;
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.translate(ox, oy);

  // player
  const p = state.player;
  ctx.beginPath();
  ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
  ctx.fillStyle = p.invuln > 0 ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.92)";
  ctx.fill();

  // aim line
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(state.mouse.x, state.mouse.y);
  ctx.strokeStyle = "rgba(255,255,255,0.16)";
  ctx.stroke();

  // enemies
  for (const e of state.enemies) {
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,90,90,0.95)";
    ctx.fill();

    // hp bar
    const w = 28, h = 4;
    const x = e.x - w / 2, y = e.y - e.r - 12;
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.fillRect(x, y, w * (e.hp / e.hpMax), h);
  }

  // coin popups
  for (const c of state.coinsDrops) {
    ctx.fillStyle = "rgba(255, 215, 120, 0.95)";
    ctx.font = "14px system-ui";
    ctx.fillText(`+${CFG.coinPerKill}`, c.x - 10, c.y);
  }

  // wave text
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.font = "14px system-ui";
  ctx.fillText(`Wave: ${state.wave}`, 16, canvas.height - 16);

  if (state.inBreak) {
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "white";
    ctx.font = "28px system-ui";
    const secs = Math.ceil(state.breakTimer / 60);
    ctx.fillText(`Wave ${state.wave} starts in ${secs}`, 260, canvas.height / 2);

    ctx.font = "14px system-ui";
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.fillText("Use the shop now. Click canvas to attack when it starts.", 290, canvas.height / 2 + 34);
  }

  if (paused) {
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "white";
    ctx.font = "28px system-ui";
    ctx.fillText("Paused", canvas.width / 2 - 50, canvas.height / 2);
  }

  // game over
  if (state.player.hp <= 0) {
    ctx.fillStyle = "rgba(0,0,0,0.72)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "white";
    ctx.font = "34px system-ui";
    ctx.fillText("Game Over", 380, 250);
    ctx.font = "16px system-ui";
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.fillText(`You reached Wave ${state.wave}. Refresh to restart.`, 330, 290);
  }
}

// ---------- LOOP ----------
function step() {
  if (!paused && state.player.hp > 0) {
    movePlayer();

    if (state.inBreak) {
      state.breakTimer -= 1;

      // AUTO HEAL DURING BREAK
      const p = state.player;
      const healPerFrame = CFG.breakHealPerSecond / 60;
      p.hp = Math.min(p.hpMax, p.hp + healPerFrame);

      if (state.breakTimer <= 0) {
        startWave(state.wave);
      }
    } else {
      updateEnemies();
      updateCoinDrops();

      // wave clear -> break -> next wave
      if (state.enemies.length === 0) {
        state.wave += 1;
        beginBreak();
      }
    }

    updateUI();
  }

  draw();
  requestAnimationFrame(step);
}

// ---------- INPUT ----------
window.addEventListener("keydown", (e) => {
  state.keys.add(e.key.toLowerCase());
  if (e.key === " ") dash();
});

window.addEventListener("keyup", (e) => state.keys.delete(e.key.toLowerCase()));

canvas.addEventListener("mousemove", (e) => {
  const rect = canvas.getBoundingClientRect();
  state.mouse.x = (e.clientX - rect.left) * (canvas.width / rect.width);
  state.mouse.y = (e.clientY - rect.top) * (canvas.height / rect.height);
});

canvas.addEventListener("mousedown", () => {
  state.mouse.down = true;
  attack(); // click attack
});
window.addEventListener("mouseup", () => state.mouse.down = false);

// Pause
document.getElementById("btnPause").addEventListener("click", () => {
  paused = !paused;
});

// Shop
document.getElementById("buyDamage").addEventListener("click", () => {
  const c = state.shop.damageCost;
  if (state.coins < c) return;
  state.coins -= c;
  state.player.damage += 2;
  state.shop.damageCost = Math.floor(c * 1.35);
  updateUI();
});

document.getElementById("buySpeed").addEventListener("click", () => {
  const c = state.shop.speedCost;
  if (state.coins < c) return;
  state.coins -= c;
  state.player.speed += 0.25;
  state.shop.speedCost = Math.floor(c * 1.35);
  updateUI();
});

document.getElementById("buyHeal").addEventListener("click", () => {
  const c = state.shop.healCost;
  const p = state.player;

  if (state.coins < c) return;
  if (p.hp <= 0) return;

  state.coins -= c;
  p.hp = Math.min(p.hpMax, p.hp + CFG.healKitAmount);

  state.shop.healCost = Math.floor(c * 1.25);
  updateUI();
});


// ---------- START ----------
updateUI();
beginBreak();
step();
