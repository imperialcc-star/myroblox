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
  autopilot: document.getElementById("btnAutopilot"),
  teleports: document.getElementById("teleports"),
};

let paused = false;

// ---------- CONFIG ----------
const CFG = {
  enemyBaseHp: 25,
  enemyBaseSpeed: 1.2,
  enemyDamage: 8,          // enemy contact damage
  enemyHitCooldown: 30,    // frames between enemy hits to player
  attackCooldown: 14,      // frames
  coinPerKill: 3,

  waveStartEnemies: 4,
  waveEnemyAdd: 3,         // + enemies each wave
  waveHpMult: 1.12,        // hp scaling per wave
  waveSpeedMult: 1.03,     // speed scaling per wave
  waveBreakSeconds: 3,
  maxWave: 50,
  spawnIntervalFrames: 38,

  breakHealPerSecond: 10, // heals only during break
  healKitAmount: 30,
  teleportPerWave: 3,
  teleportCooldownFrames: 40,
  bulletSpeed: 7.5,
  bulletRange: 320,

};

const state = {
  coins: 0,
  kos: 0,
  wave: 1,
  inBreak: true,
  breakTimer: Math.floor(CFG.waveBreakSeconds * 60),
  completed: false,

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
  bullets: [],
  pendingSpawns: 0,
  spawnTimer: 0,
  spawnHp: CFG.enemyBaseHp,
  spawnSpeed: CFG.enemyBaseSpeed,
  shake: 0,
  autopilot: true,
  teleportCharges: CFG.teleportPerWave,
  teleportCooldown: 0,
  muzzleFlash: 0,
};

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }

function angleTo(ax, ay, bx, by) { return Math.atan2(by - ay, bx - ax); }
function updateUI() {
  ui.hp.textContent = Math.max(0, Math.floor(state.player.hp));
  ui.coins.textContent = state.coins;
  ui.kos.textContent = state.kos;

  ui.costDamage.textContent = state.shop.damageCost;
  ui.costSpeed.textContent = state.shop.speedCost;
  ui.costHeal.textContent = state.shop.healCost;

  ui.breakHeal.textContent = state.inBreak ? "ON" : "OFF";
  ui.autopilot.textContent = `Autopilot: ${state.autopilot ? "ON" : "OFF"}`;
  ui.teleports.textContent = state.teleportCharges;
}


// ---------- GAMEPLAY: WAVES ----------
function startWave(waveNum) {
  state.enemies.length = 0;
  const count = CFG.waveStartEnemies + (waveNum - 1) * CFG.waveEnemyAdd;

  state.spawnHp = Math.floor(CFG.enemyBaseHp * Math.pow(CFG.waveHpMult, waveNum - 1));
  state.spawnSpeed = CFG.enemyBaseSpeed * Math.pow(CFG.waveSpeedMult, waveNum - 1);
  state.pendingSpawns = count;
  state.spawnTimer = 0;
  state.teleportCharges = CFG.teleportPerWave;

  state.inBreak = false;
}

function beginBreak() {
  state.inBreak = true;
  state.breakTimer = Math.floor(CFG.waveBreakSeconds * 60);
}

function applyLevelRewards() {
  const p = state.player;
  p.damage += 1;
  p.speed += 0.05;
  p.hpMax += 2;
  p.hp = Math.min(p.hpMax, p.hp + 10);
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

function updateSpawns() {
  if (state.pendingSpawns <= 0) return;
  if (state.spawnTimer > 0) {
    state.spawnTimer -= 1;
    return;
  }

  spawnEnemy(state.spawnHp, state.spawnSpeed);
  state.pendingSpawns -= 1;
  state.spawnTimer = CFG.spawnIntervalFrames;
}

// ---------- PLAYER MOVEMENT ----------
function getAutopilotTarget() {
  if (state.enemies.length === 0) return null;
  const p = state.player;
  let best = null;
  let bestDist = Infinity;
  for (const e of state.enemies) {
    const d = dist(p.x, p.y, e.x, e.y);
    if (d < bestDist) {
      best = e;
      bestDist = d;
    }
  }
  return best;
}

function getAutopilotInput() {
  const p = state.player;
  const target = getAutopilotTarget();
  let dx = 0;
  let dy = 0;

  if (state.inBreak || !target) {
    dx = canvas.width / 2 - p.x;
    dy = canvas.height / 2 - p.y;
  } else {
    const d = dist(p.x, p.y, target.x, target.y);
    if (d > 90) {
      dx = target.x - p.x;
      dy = target.y - p.y;
    } else if (d < 50) {
      dx = p.x - target.x;
      dy = p.y - target.y;
    } else {
      const a = angleTo(p.x, p.y, target.x, target.y) + Math.PI / 2;
      dx = Math.cos(a);
      dy = Math.sin(a);
    }
  }

  if (dx !== 0 || dy !== 0) {
    const len = Math.hypot(dx, dy);
    dx /= len;
    dy /= len;
  }

  return { dx, dy };
}

function movePlayer() {
  const p = state.player;

  let dx = 0;
  let dy = 0;
  if (state.autopilot) {
    ({ dx, dy } = getAutopilotInput());
  } else {
    if (state.keys.has("w")) dy -= 1;
    if (state.keys.has("s")) dy += 1;
    if (state.keys.has("a")) dx -= 1;
    if (state.keys.has("d")) dx += 1;
    if (dx !== 0 || dy !== 0) {
      const len = Math.hypot(dx, dy);
      dx /= len;
      dy /= len;
    }
  }

  p.x += dx * p.speed;
  p.y += dy * p.speed;

  p.x = clamp(p.x, p.r, canvas.width - p.r);
  p.y = clamp(p.y, p.r, canvas.height - p.r);

  if (p.dashCooldown > 0) p.dashCooldown -= 1;
  if (p.attackCooldown > 0) p.attackCooldown -= 1;
  if (p.invuln > 0) p.invuln -= 1;
}

function dash(direction = null) {
  const p = state.player;
  if (p.dashCooldown > 0) return;

  let dx = 0;
  let dy = 0;
  if (direction) {
    ({ dx, dy } = direction);
  } else {
    if (state.keys.has("w")) dy -= 1;
    if (state.keys.has("s")) dy += 1;
    if (state.keys.has("a")) dx -= 1;
    if (state.keys.has("d")) dx += 1;
  }
  if (dx === 0 && dy === 0) return;

  const len = Math.hypot(dx, dy);
  dx /= len; dy /= len;

  p.x += dx * 85;
  p.y += dy * 85;

  p.x = clamp(p.x, p.r, canvas.width - p.r);
  p.y = clamp(p.y, p.r, canvas.height - p.r);

  p.dashCooldown = 90;
}

function teleport() {
  const p = state.player;
  if (state.teleportCharges <= 0) return;
  if (state.teleportCooldown > 0) return;

  let best = { x: canvas.width / 2, y: canvas.height / 2 };
  let bestScore = -Infinity;
  for (let i = 0; i < 12; i++) {
    const candidate = {
      x: 40 + Math.random() * (canvas.width - 80),
      y: 40 + Math.random() * (canvas.height - 80),
    };
    let nearest = Infinity;
    for (const e of state.enemies) {
      nearest = Math.min(nearest, dist(candidate.x, candidate.y, e.x, e.y));
    }
    if (nearest > bestScore) {
      bestScore = nearest;
      best = candidate;
    }
  }

  p.x = best.x;
  p.y = best.y;
  state.teleportCharges -= 1;
  state.teleportCooldown = CFG.teleportCooldownFrames;
  state.shake = 6;
}

// ---------- COMBAT ----------
function attack() {
  const p = state.player;
  if (p.attackCooldown > 0) return;

  const aPlayer = angleTo(p.x, p.y, state.mouse.x, state.mouse.y);
  state.bullets.push({
    x: p.x,
    y: p.y,
    vx: Math.cos(aPlayer) * CFG.bulletSpeed,
    vy: Math.sin(aPlayer) * CFG.bulletSpeed,
    life: CFG.bulletRange,
    damage: p.damage,
  });
  state.muzzleFlash = 4;

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

function updateBullets() {
  for (let i = state.bullets.length - 1; i >= 0; i--) {
    const b = state.bullets[i];
    b.x += b.vx;
    b.y += b.vy;
    b.life -= Math.hypot(b.vx, b.vy);

    let hit = false;
    for (let j = state.enemies.length - 1; j >= 0; j--) {
      const e = state.enemies[j];
      if (dist(b.x, b.y, e.x, e.y) <= e.r + 4) {
        e.hp -= b.damage;
        hit = true;
        state.shake = 4;
        if (e.hp <= 0) {
          state.enemies.splice(j, 1);
          state.kos += 1;
          state.coins += CFG.coinPerKill;
          state.coinsDrops.push({ x: e.x, y: e.y, t: 40 });
        }
        break;
      }
    }

    if (hit || b.life <= 0) {
      state.bullets.splice(i, 1);
    }
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

  drawBackground();

  // player
  const p = state.player;
  const aimAngle = angleTo(p.x, p.y, state.mouse.x, state.mouse.y);
  drawRobloxCharacter(p.x, p.y, p.r, {
    skin: "#f8d7c2",
    hair: "#6a3a90",
    outfit: "#ff8fb8",
    accent: "#ffd76d",
    glow: p.invuln > 0 ? 0.35 : 0,
    hasGun: true,
    aimAngle,
    muzzleFlash: state.muzzleFlash,
  });

  // aim line
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(state.mouse.x, state.mouse.y);
  ctx.strokeStyle = "rgba(255,255,255,0.16)";
  ctx.stroke();

  // enemies
  for (const e of state.enemies) {
    drawRobloxCharacter(e.x, e.y, e.r, {
      skin: "#f2c6a7",
      hair: "#2f3d9b",
      outfit: "#ff7fa3",
      accent: "#8de0ff",
      glow: 0,
      hasStick: true,
    });

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

  // bullets
  for (const b of state.bullets) {
    ctx.beginPath();
    ctx.arc(b.x, b.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.fill();
  }

  // wave text
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.font = "14px system-ui";
  ctx.fillText(`Level: ${state.wave}`, 16, canvas.height - 16);

  if (state.inBreak) {
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "white";
    ctx.font = "28px system-ui";
    const secs = Math.ceil(state.breakTimer / 60);
    ctx.fillText(`Level ${state.wave} starts in ${secs}`, 260, canvas.height / 2);

    ctx.font = "14px system-ui";
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.fillText("Use the shop now. Click canvas to shoot when it starts.", 290, canvas.height / 2 + 34);
  }

  if (paused) {
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "white";
    ctx.font = "28px system-ui";
    ctx.fillText("Paused", canvas.width / 2 - 50, canvas.height / 2);
  }

  // game over
  if (state.completed) {
    ctx.fillStyle = "rgba(0,0,0,0.72)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "white";
    ctx.font = "34px system-ui";
    ctx.fillText("Level 50 Cleared!", 360, 250);
    ctx.font = "16px system-ui";
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.fillText("Congrats! Refresh to play again.", 360, 290);
    return;
  }

  if (state.player.hp <= 0) {
    ctx.fillStyle = "rgba(0,0,0,0.72)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "white";
    ctx.font = "34px system-ui";
    ctx.fillText("Game Over", 380, 250);
    ctx.font = "16px system-ui";
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.fillText(`You reached Level ${state.wave}. Refresh to restart.`, 330, 290);
  }
}

function drawBackground() {
  ctx.save();
  const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  grad.addColorStop(0, "#2b9df4");
  grad.addColorStop(0.45, "#6bd4b6");
  grad.addColorStop(0.9, "#f7a1d3");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.globalAlpha = 0.2;
  for (let i = 0; i < 45; i++) {
    const x = (i * 97) % canvas.width;
    const y = (i * 53) % canvas.height;
    ctx.beginPath();
    ctx.arc(x, y, 90, 0, Math.PI * 2);
    ctx.fillStyle = i % 2 === 0 ? "#fff6a6" : "#b8f3ff";
    ctx.fill();
  }
  ctx.restore();
}

function drawRobloxCharacter(x, y, r, palette) {
  const scale = r / 14;
  const headW = 14 * scale;
  const headH = 12 * scale;
  const bodyW = 16 * scale;
  const bodyH = 18 * scale;
  const legW = 6 * scale;
  const legH = 10 * scale;
  const armW = 5 * scale;
  const armH = 12 * scale;

  ctx.save();

  if (palette.glow) {
    ctx.beginPath();
    ctx.arc(x, y, r + 8 * scale, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,255,${palette.glow})`;
    ctx.fill();
  }

  // head
  ctx.fillStyle = palette.skin;
  ctx.fillRect(x - headW / 2, y - bodyH / 2 - headH, headW, headH);

  // hair
  ctx.fillStyle = palette.hair;
  ctx.fillRect(x - headW / 2, y - bodyH / 2 - headH, headW, headH * 0.45);
  ctx.beginPath();
  ctx.arc(x + headW * 0.25, y - bodyH / 2 - headH * 0.7, headW * 0.28, 0, Math.PI * 2);
  ctx.fill();

  // body
  ctx.fillStyle = palette.outfit;
  ctx.fillRect(x - bodyW / 2, y - bodyH / 2, bodyW, bodyH);

  // skirt
  ctx.fillStyle = palette.accent;
  ctx.beginPath();
  ctx.moveTo(x - bodyW / 2, y + bodyH / 2);
  ctx.lineTo(x + bodyW / 2, y + bodyH / 2);
  ctx.lineTo(x + bodyW * 0.3, y + bodyH / 2 + 8 * scale);
  ctx.lineTo(x - bodyW * 0.3, y + bodyH / 2 + 8 * scale);
  ctx.closePath();
  ctx.fill();

  // arms
  ctx.fillStyle = palette.skin;
  ctx.fillRect(x - bodyW / 2 - armW, y - bodyH / 2 + 2 * scale, armW, armH);
  ctx.fillRect(x + bodyW / 2, y - bodyH / 2 + 2 * scale, armW, armH);

  if (palette.hasStick) {
    ctx.strokeStyle = "#7c4a1f";
    ctx.lineWidth = 3 * scale;
    ctx.beginPath();
    ctx.moveTo(x + bodyW / 2 + 2 * scale, y - bodyH / 2 + 6 * scale);
    ctx.lineTo(x + bodyW / 2 + 18 * scale, y + bodyH / 2 + 10 * scale);
    ctx.stroke();
  }

  if (palette.hasGun) {
    const angle = palette.aimAngle ?? 0;
    ctx.save();
    ctx.translate(x + bodyW / 2 - 2 * scale, y - bodyH / 2 + 8 * scale);
    ctx.rotate(angle);
    ctx.fillStyle = "#1f1f2e";
    ctx.fillRect(0, -2 * scale, 14 * scale, 4 * scale);
    ctx.fillStyle = "#8f96a3";
    ctx.fillRect(8 * scale, -4 * scale, 4 * scale, 8 * scale);

    if (palette.muzzleFlash && palette.muzzleFlash > 0) {
      ctx.fillStyle = "rgba(255,214,99,0.9)";
      ctx.beginPath();
      ctx.arc(16 * scale, 0, 4 * scale, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // legs
  ctx.fillStyle = palette.outfit;
  ctx.fillRect(x - legW - 2 * scale, y + bodyH / 2 + 8 * scale, legW, legH);
  ctx.fillRect(x + 2 * scale, y + bodyH / 2 + 8 * scale, legW, legH);

  ctx.restore();
}

// ---------- LOOP ----------
function step() {
  if (!paused && state.player.hp > 0 && !state.completed) {
    movePlayer();
    if (state.teleportCooldown > 0) state.teleportCooldown -= 1;
    if (state.muzzleFlash > 0) state.muzzleFlash -= 1;

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
      updateSpawns();
      updateEnemies();
      updateCoinDrops();
      updateBullets();

      if (state.autopilot) {
        const target = getAutopilotTarget();
        if (target) {
          state.mouse.x = target.x;
          state.mouse.y = target.y;
          const d = dist(state.player.x, state.player.y, target.x, target.y);
          if (d <= CFG.bulletRange) {
            attack();
          }
          if (d < 40 && state.player.dashCooldown === 0) {
            dash({ dx: state.player.x - target.x, dy: state.player.y - target.y });
          }
        }
        if (state.player.hp < 35 && state.teleportCharges > 0 && state.teleportCooldown === 0) {
          teleport();
        }
      }

      // wave clear -> break -> next wave
      if (state.enemies.length === 0 && state.pendingSpawns === 0) {
        state.wave += 1;
        if (state.wave > CFG.maxWave) {
          state.completed = true;
        } else {
          applyLevelRewards();
          beginBreak();
        }
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
  if (e.key.toLowerCase() === "t") teleport();
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

ui.autopilot.addEventListener("click", () => {
  state.autopilot = !state.autopilot;
  updateUI();
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

