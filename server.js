// ═══════════════════════════════════════════════════════════════
//  DRUNK DRIVERS.IO — Authoritative Game Server
//  Node.js + Express + Socket.io
// ═══════════════════════════════════════════════════════════════

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingInterval: 2000,
  pingTimeout: 5000
});

app.use(express.static(path.join(__dirname, 'public')));

// ═══════════════════════════════════════════════════════════════
//  CONSTANTS
// ═══════════════════════════════════════════════════════════════

const PORT = process.env.PORT || 3000;
const TICK_RATE = 60;
const TICK_MS = 1000 / TICK_RATE;

const WORLD_W = 3000;
const WORLD_H = 3000;
const BORDER_MARGIN = 30;

const PLAYER_RADIUS = 23;
const ITEM_RADIUS = 15;

const MAX_ITEMS = 80;
const ITEM_RESPAWN_DELAY = 120; // ticks (~2.7s)
const DRINK_SPAWN_CHANCE = 0.85;

const MAX_PROMILLE = 4.50;
const DRINK_PROMILLE = 0.75;
const FOOD_PROMILLE = -1.50;
const FOOD_HEAL = 30;

const EFFECT_DURATION_TICKS = 7 * TICK_RATE; // 7 seconds
const STICKY_LOCK_TICKS = Math.round(2.5 * TICK_RATE);
const MICROSLEEP_CYCLE = 3 * TICK_RATE;
const MICROSLEEP_FREEZE = Math.round(0.4 * TICK_RATE);

const RESPAWN_TICKS = 3 * TICK_RATE;
const KILL_CREDIT_TICKS = 4 * TICK_RATE;
const KILL_SCORE = 100;

const BASE_TOP_SPEED = 5.0;
const MAX_TOP_SPEED = 10.0;
const BASE_ACCEL = 0.15;
const BASE_TURN = 0.15;
const FORWARD_FRICTION = 0.98;
const BASE_LATERAL_FRICTION = 0.86;
const MAX_LATERAL_FRICTION = 0.96;
const BRAKE_FACTOR = 0.92;

const BOOST_SPEED_MULT = 1.8;
const BOOST_ACCEL_MULT = 2.2;
const BOOST_DURATION_TICKS = Math.round(1.5 * TICK_RATE);
const BOOST_COOLDOWN_TICKS = Math.round(4.0 * TICK_RATE);

const NEON_COLORS = [
  '#00f0ff', '#ff00e5', '#00ff88', '#ff8c00',
  '#ff0066', '#8b5cf6', '#ffd700', '#00aaff',
  '#ff4466', '#44ff88', '#ff44ff', '#44ffff',
  '#ffaa00', '#aa44ff', '#ff6644', '#66ff44',
  '#4488ff', '#ff4488', '#88ff44', '#88ffcc'
];

const EFFECT_TYPES = [
  'STEERING_INVERT',
  'STICKY_WHEEL',
  'MICRO_SLEEP',
  'DOUBLE_VISION',
  'TUNNEL_VISION',
  'STUCK_THROTTLE',
  'REVERSE_GEAR',
  'SLIPPERY_TIRES',
  'BUMPY_RIDE',
  'SUDDEN_ACCELERATION',
  'COLOR_TRIP'
];

// ═══════════════════════════════════════════════════════════════
//  WORLD OBSTACLES
// ═══════════════════════════════════════════════════════════════

const PILLARS = [
  { x: 750, y: 750, radius: 50 },
  { x: 2250, y: 750, radius: 50 },
  { x: 750, y: 2250, radius: 50 },
  { x: 2250, y: 2250, radius: 50 },
  { x: 1500, y: 1500, radius: 70 },
  { x: 1500, y: 750, radius: 45 },
  { x: 750, y: 1500, radius: 45 },
  { x: 2250, y: 1500, radius: 45 },
  { x: 1500, y: 2250, radius: 45 },
  { x: 1100, y: 1100, radius: 35 },
  { x: 1900, y: 1900, radius: 35 },
  { x: 1100, y: 1900, radius: 35 },
  { x: 1900, y: 1100, radius: 35 }
];

const PITS = [
  { x: 80, y: 1250, w: 160, h: 500 },
  { x: 2760, y: 1250, w: 160, h: 500 },
  { x: 1250, y: 80, w: 500, h: 160 },
  { x: 1250, y: 2760, w: 500, h: 160 }
];

// ═══════════════════════════════════════════════════════════════
//  GAME STATE
// ═══════════════════════════════════════════════════════════════

const players = new Map();
const items = new Map();
let itemIdCounter = 0;
let colorIndex = 0;
let currentTick = 0;
const pendingItemRespawns = [];
const collisionsThisTick = [];

// ═══════════════════════════════════════════════════════════════
//  UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function dist(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}

function circleCircle(x1, y1, r1, x2, y2, r2) {
  return dist(x1, y1, x2, y2) < r1 + r2;
}

function circleRect(cx, cy, cr, rx, ry, rw, rh) {
  const closestX = clamp(cx, rx, rx + rw);
  const closestY = clamp(cy, ry, ry + rh);
  const dx = cx - closestX;
  const dy = cy - closestY;
  return (dx * dx + dy * dy) < (cr * cr);
}

function isPositionSafe(x, y, radius) {
  if (x - radius < BORDER_MARGIN || x + radius > WORLD_W - BORDER_MARGIN) return false;
  if (y - radius < BORDER_MARGIN || y + radius > WORLD_H - BORDER_MARGIN) return false;
  for (const p of PILLARS) {
    if (circleCircle(x, y, radius, p.x, p.y, p.radius + 10)) return false;
  }
  for (const pit of PITS) {
    if (circleRect(x, y, radius + 10, pit.x, pit.y, pit.w, pit.h)) return false;
  }
  return true;
}

function randomSafePosition(radius) {
  for (let i = 0; i < 200; i++) {
    const x = BORDER_MARGIN + 80 + Math.random() * (WORLD_W - BORDER_MARGIN * 2 - 160);
    const y = BORDER_MARGIN + 80 + Math.random() * (WORLD_H - BORDER_MARGIN * 2 - 160);
    if (isPositionSafe(x, y, radius)) return { x, y };
  }
  return { x: WORLD_W / 2 + (Math.random() - 0.5) * 200, y: WORLD_H / 2 + (Math.random() - 0.5) * 200 };
}

function nextColor() {
  const c = NEON_COLORS[colorIndex % NEON_COLORS.length];
  colorIndex++;
  return c;
}

// ═══════════════════════════════════════════════════════════════
//  PROMILLE SCALING
// ═══════════════════════════════════════════════════════════════

function recalcStats(p) {
  const t = p.promille / MAX_PROMILLE;
  p.mass = 1.0 + t * 2.0;
  p.topSpeed = BASE_TOP_SPEED + t * (MAX_TOP_SPEED - BASE_TOP_SPEED);
  p.impactMultiplier = 1.0 + t * 3.0;
  p.handling = 1.0 - t * 0.6;
  p.lateralFriction = BASE_LATERAL_FRICTION + t * (MAX_LATERAL_FRICTION - BASE_LATERAL_FRICTION);
}

// ═══════════════════════════════════════════════════════════════
//  PLAYER MANAGEMENT
// ═══════════════════════════════════════════════════════════════

function createPlayer(id, name, customColor, customStyle, customSkin, customGlow) {
  const pos = randomSafePosition(PLAYER_RADIUS);
  let color = nextColor();
  if (customColor && typeof customColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(customColor)) {
    color = customColor;
  }
  const p = {
    id,
    name: name.substring(0, 16) || 'Driver',
    x: pos.x,
    y: pos.y,
    angle: Math.random() * Math.PI * 2,
    vx: 0,
    vy: 0,
    promille: 0,
    hp: 100,
    score: 0,
    mass: 1.0,
    topSpeed: BASE_TOP_SPEED,
    impactMultiplier: 1.0,
    handling: 1.0,
    lateralFriction: BASE_LATERAL_FRICTION,
    alive: true,
    respawnTimer: 0,
    color: color,
    style: customStyle || 'sleek',
    skin: customSkin || 'none',
    glow: customGlow !== undefined ? customGlow : 60,
    input: { targetAngle: null, moving: false, boost: false },
    effects: [],
    stickyLocked: false,
    stickyDirection: null,
    stickyTimer: 0,
    lastHitBy: null,
    lastHitTick: 0,
    boostActive: false,
    boostTimer: 0,
    boostCooldown: 0,
    spawnTick: currentTick
  };
  recalcStats(p);
  return p;
}

function respawnPlayer(p) {
  const pos = randomSafePosition(PLAYER_RADIUS);
  p.x = pos.x;
  p.y = pos.y;
  p.angle = Math.random() * Math.PI * 2;
  p.vx = 0;
  p.vy = 0;
  p.promille = 0;
  p.hp = 100;
  p.alive = true;
  p.effects = [];
  p.stickyLocked = false;
  p.stickyDirection = null;
  p.stickyTimer = 0;
  p.lastHitBy = null;
  p.lastHitTick = 0;
  p.stickyTimer = 0;
  p.boostActive = false;
  p.boostCooldown = 0;
  p.spawnTick = currentTick;
  recalcStats(p);
}

function killPlayer(p, reason) {
  if (!p.alive) return;
  p.alive = false;
  p.respawnTimer = RESPAWN_TICKS;
  p.vx = 0;
  p.vy = 0;

  let killerName = null;
  if (p.lastHitBy && (currentTick - p.lastHitTick) < KILL_CREDIT_TICKS) {
    const killer = players.get(p.lastHitBy);
    if (killer && killer.alive) {
      killer.score += KILL_SCORE;
      killerName = killer.name;
      io.to(killer.id).emit('kill_confirmed');
    }
  }

  const finalScore = Math.floor(p.score);
  p.score = 0;

  io.to(p.id).emit('killed', {
    reason,
    killerName: killerName || null,
    respawnTime: RESPAWN_TICKS / TICK_RATE,
    finalScore
  });
}

// ═══════════════════════════════════════════════════════════════
//  EFFECT SYSTEM
// ═══════════════════════════════════════════════════════════════

function addEffect(p, type) {
  const existing = p.effects.find(e => e.type === type);
  if (existing) {
    existing.startTick = currentTick;
    return;
  }
  p.effects.push({ type, startTick: currentTick });
  if (type === 'STICKY_WHEEL') {
    p.stickyLocked = false;
    p.stickyDirection = null;
    p.stickyTimer = 0;
  }
}

function removeEffect(p, type) {
  p.effects = p.effects.filter(e => e.type !== type);
  if (type === 'STICKY_WHEEL') {
    p.stickyLocked = false;
  }
}

function hasEffect(p, type) {
  return p.effects.some(e => e.type === type);
}

function updateEffects(p) {
  for (let i = p.effects.length - 1; i >= 0; i--) {
    const e = p.effects[i];
    if (currentTick - e.startTick >= EFFECT_DURATION_TICKS) {
      if (e.type === 'STICKY_WHEEL') {
        p.stickyLocked = false;
      }
      p.effects.splice(i, 1);
    }
  }
}

function clearAllEffects(p) {
  p.effects = [];
  p.stickyLocked = false;
  p.stickyDirection = null;
  p.stickyTimer = 0;
}

function getEffectSerialData(p) {
  return p.effects.map(e => ({
    type: e.type,
    remaining: Math.max(0, (EFFECT_DURATION_TICKS - (currentTick - e.startTick)) / TICK_RATE)
  }));
}

// ═══════════════════════════════════════════════════════════════
//  ITEM SYSTEM
// ═══════════════════════════════════════════════════════════════

function spawnItem() {
  const pos = randomSafePosition(ITEM_RADIUS);
  const type = Math.random() < DRINK_SPAWN_CHANCE ? 'drink' : 'food';
  const effectType = type === 'drink' ? EFFECT_TYPES[Math.floor(Math.random() * EFFECT_TYPES.length)] : null;
  const id = ++itemIdCounter;
  items.set(id, { id, x: pos.x, y: pos.y, type, effect: effectType });
  return id;
}

function initItems() {
  for (let i = 0; i < MAX_ITEMS; i++) {
    spawnItem();
  }
}

function pickupItem(player, item) {
  player.score += 10; // New way to get points!
  if (item.type === 'drink') {
    player.promille = Math.min(MAX_PROMILLE, player.promille + DRINK_PROMILLE);
    const effectType = item.effect || EFFECT_TYPES[Math.floor(Math.random() * EFFECT_TYPES.length)];
    addEffect(player, effectType);
    io.to(player.id).emit('pickup', { type: 'drink', effect: effectType, promille: player.promille });
  } else {
    player.promille = Math.max(0, player.promille + FOOD_PROMILLE);
    player.hp = Math.min(100, player.hp + FOOD_HEAL);
    clearAllEffects(player);
    io.to(player.id).emit('pickup', { type: 'food', promille: player.promille });
  }
  recalcStats(player);
  items.delete(item.id);
  pendingItemRespawns.push({ tick: currentTick + ITEM_RESPAWN_DELAY });
}

function updateItemRespawns() {
  for (let i = pendingItemRespawns.length - 1; i >= 0; i--) {
    if (currentTick >= pendingItemRespawns[i].tick) {
      spawnItem();
      pendingItemRespawns.splice(i, 1);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
//  PHYSICS: INPUT PROCESSING WITH EFFECTS
// ═══════════════════════════════════════════════════════════════

function processInput(p) {
  const input = { ...p.input };

  // Steering Invert (Mirror the target angle)
  if (hasEffect(p, 'STEERING_INVERT') && input.targetAngle !== null) {
    input.targetAngle = input.targetAngle + Math.PI;
  }

  // Reverse Gear
  if (hasEffect(p, 'REVERSE_GEAR') && input.targetAngle !== null) {
    input.targetAngle = input.targetAngle + Math.PI;
  }

  // Stuck Throttle
  if (hasEffect(p, 'STUCK_THROTTLE')) {
    input.moving = true;
  }

  // Micro-Sleep
  if (hasEffect(p, 'MICRO_SLEEP')) {
    const e = p.effects.find(ef => ef.type === 'MICRO_SLEEP');
    const elapsed = currentTick - e.startTick;
    const cyclePos = elapsed % MICROSLEEP_CYCLE;
    if (cyclePos >= MICROSLEEP_CYCLE - MICROSLEEP_FREEZE) {
      input.moving = false;
    }
  }

  // Sticky Wheel
  if (hasEffect(p, 'STICKY_WHEEL')) {
    if (!p.stickyLocked && input.targetAngle !== null) {
      p.stickyDirection = input.targetAngle + (Math.random() > 0.5 ? 0.5 : -0.5);
      p.stickyLocked = true;
      p.stickyTimer = STICKY_LOCK_TICKS;
    }
    if (p.stickyLocked) {
      input.targetAngle = p.stickyDirection;
      p.stickyTimer--;
      if (p.stickyTimer <= 0) p.stickyLocked = false;
    }
  }

  return input;
}

// ═══════════════════════════════════════════════════════════════
//  PHYSICS: VEHICLE KINEMATICS
// ═══════════════════════════════════════════════════════════════

function updatePlayerPhysics(p) {
  if (!p.alive) return;

  // Boost system
  if (p.boostCooldown > 0) p.boostCooldown--;
  if (p.boostActive) {
    p.boostTimer--;
    if (p.boostTimer <= 0) {
      p.boostActive = false;
      p.boostCooldown = BOOST_COOLDOWN_TICKS;
    }
  }
  if (p.input.boost && !p.boostActive && p.boostCooldown <= 0) {
    p.boostActive = true;
    p.boostTimer = BOOST_DURATION_TICKS;
  }

  // Sudden Acceleration
  if (hasEffect(p, 'SUDDEN_ACCELERATION') && Math.random() < 0.02) {
    p.boostActive = true;
    p.boostTimer = Math.round(0.4 * TICK_RATE);
  }

  // Bumpy Ride
  if (hasEffect(p, 'BUMPY_RIDE') && Math.random() < 0.06) {
    p.vx += (Math.random() - 0.5) * 4;
    p.vy += (Math.random() - 0.5) * 4;
  }

  const input = processInput(p);
  const turnRate = BASE_TURN * p.handling;

  // Steering (Rotate towards target angle)
  if (input.targetAngle !== null) {
    let diff = input.targetAngle - p.angle;
    while (diff < -Math.PI) diff += Math.PI * 2;
    while (diff > Math.PI) diff -= Math.PI * 2;
    
    if (Math.abs(diff) < turnRate) {
      p.angle = input.targetAngle;
    } else {
      p.angle += Math.sign(diff) * turnRate;
    }
  }

  // Normalize angle
  while (p.angle < 0) p.angle += Math.PI * 2;
  while (p.angle >= Math.PI * 2) p.angle -= Math.PI * 2;

  // Forward / reverse direction vectors
  const fx = Math.cos(p.angle);
  const fy = Math.sin(p.angle);
  const lx = -Math.sin(p.angle);
  const ly = Math.cos(p.angle);

  // Throttle with boost multiplier
  const accel = p.boostActive ? BASE_ACCEL * BOOST_ACCEL_MULT : BASE_ACCEL;
  if (input.moving) {
    p.vx += fx * accel;
    p.vy += fy * accel;
  }

  // Decompose velocity into forward and lateral
  const forwardSpeed = p.vx * fx + p.vy * fy;
  const lateralSpeed = p.vx * lx + p.vy * ly;

  // Apply directional friction
  const newForward = forwardSpeed * FORWARD_FRICTION;
  const actualLateralFriction = hasEffect(p, 'SLIPPERY_TIRES') ? 0.99 : p.lateralFriction;
  const newLateral = lateralSpeed * actualLateralFriction;

  p.vx = newForward * fx + newLateral * lx;
  p.vy = newForward * fy + newLateral * ly;

  // Clamp speed (boost raises cap)
  const maxSpd = p.boostActive ? p.topSpeed * BOOST_SPEED_MULT : p.topSpeed;
  const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
  if (speed > maxSpd) {
    const scale = maxSpd / speed;
    p.vx *= scale;
    p.vy *= scale;
  }

  // Update position
  p.x += p.vx;
  p.y += p.vy;
}

// ═══════════════════════════════════════════════════════════════
//  COLLISION DETECTION & RESOLUTION
// ═══════════════════════════════════════════════════════════════

function checkBorderCollision(p) {
  if (!p.alive) return;
  if (p.x - PLAYER_RADIUS < BORDER_MARGIN ||
      p.x + PLAYER_RADIUS > WORLD_W - BORDER_MARGIN ||
      p.y - PLAYER_RADIUS < BORDER_MARGIN ||
      p.y + PLAYER_RADIUS > WORLD_H - BORDER_MARGIN) {
    killPlayer(p, 'border');
  }
}

function checkPitCollision(p) {
  if (!p.alive) return;
  for (const pit of PITS) {
    if (circleRect(p.x, p.y, PLAYER_RADIUS, pit.x, pit.y, pit.w, pit.h)) {
      // Find closest point on pit rectangle
      let testX = p.x;
      let testY = p.y;
      if (p.x < pit.x) testX = pit.x;
      else if (p.x > pit.x + pit.w) testX = pit.x + pit.w;
      if (p.y < pit.y) testY = pit.y;
      else if (p.y > pit.y + pit.h) testY = pit.y + pit.h;

      let distX = p.x - testX;
      let distY = p.y - testY;
      let distance = Math.sqrt((distX*distX) + (distY*distY));
      
      const entrySpeed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
      const dmg = Math.min(30, 5 + entrySpeed * 1.5); // Base 5, max 30
      const bounceForce = 4 + entrySpeed * 0.8; // Scales with how fast you hit it

      if (distance > 0.01) {
        let nx = distX / distance;
        let ny = distY / distance;
        
        let overlap = PLAYER_RADIUS - distance;
        if (overlap < 0) overlap = 0;
        p.x += nx * (overlap + 2);
        p.y += ny * (overlap + 2);

        const dot = p.vx * nx + p.vy * ny;
        if (dot < 0) {
          p.vx -= 2 * dot * nx;
          p.vy -= 2 * dot * ny;
        }
        p.vx += nx * bounceForce;
        p.vy += ny * bounceForce;
      } else {
        p.y -= 15;
        p.vy = -bounceForce;
      }
      
      p.hp -= dmg;
      
      collisionsThisTick.push({ x: p.x, y: p.y });
      if (p.hp <= 0) {
        killPlayer(p, 'pit');
        return;
      }
    }
  }
}

function checkPillarCollisions(p) {
  if (!p.alive) return;
  for (const pillar of PILLARS) {
    const d = dist(p.x, p.y, pillar.x, pillar.y);
    const minDist = PLAYER_RADIUS + pillar.radius;
    if (d < minDist && d > 0.01) {
      const nx = (p.x - pillar.x) / d;
      const ny = (p.y - pillar.y) / d;
      const overlap = minDist - d;
      p.x += nx * overlap;
      p.y += ny * overlap;

      const dot = p.vx * nx + p.vy * ny;
      p.vx -= 2 * dot * nx * 0.65;
      p.vy -= 2 * dot * ny * 0.65;

      const spd = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
      // Reduce pillar damage and cap it so getting stuck doesn't instantly kill
      const dmg = Math.min(spd * 0.8, 8); 
      p.hp -= dmg;
      collisionsThisTick.push({ x: pillar.x + nx * pillar.radius, y: pillar.y + ny * pillar.radius });

      if (p.hp <= 0) {
        killPlayer(p, 'pillar');
        return;
      }
    }
  }
}

function checkPlayerCollisions() {
  const arr = Array.from(players.values()).filter(p => p.alive);
  for (let i = 0; i < arr.length; i++) {
    for (let j = i + 1; j < arr.length; j++) {
      const p1 = arr[i];
      const p2 = arr[j];
      const d = dist(p1.x, p1.y, p2.x, p2.y);
      const minDist = PLAYER_RADIUS * 2;
      if (d < minDist && d > 0.01) {
        const nx = (p2.x - p1.x) / d;
        const ny = (p2.y - p1.y) / d;

        const dvx = p1.vx - p2.vx;
        const dvy = p1.vy - p2.vy;
        const dvn = dvx * nx + dvy * ny;

        if (dvn <= 0) continue;

        const restitution = 0.75;
        const impulse = -(1 + restitution) * dvn / (1 / p1.mass + 1 / p2.mass);

        p1.vx += (impulse / p1.mass) * nx * p2.impactMultiplier;
        p1.vy += (impulse / p1.mass) * ny * p2.impactMultiplier;
        p2.vx -= (impulse / p2.mass) * nx * p1.impactMultiplier;
        p2.vy -= (impulse / p2.mass) * ny * p1.impactMultiplier;

        const overlap = minDist - d;
        const totalMass = p1.mass + p2.mass;
        p1.x -= nx * overlap * (p2.mass / totalMass);
        p1.y -= ny * overlap * (p2.mass / totalMass);
        p2.x += nx * overlap * (p1.mass / totalMass);
        p2.y += ny * overlap * (p1.mass / totalMass);

        const relSpeed = Math.sqrt(dvx * dvx + dvy * dvy);
        const dmg1 = relSpeed * 2.0 * p2.impactMultiplier * 0.15; // Reduced damage
        const dmg2 = relSpeed * 2.0 * p1.impactMultiplier * 0.15; // Reduced damage
        p1.hp -= dmg1;
        p2.hp -= dmg2;

        p1.lastHitBy = p2.id;
        p1.lastHitTick = currentTick;
        p2.lastHitBy = p1.id;
        p2.lastHitTick = currentTick;

        const cx = (p1.x + p2.x) / 2;
        const cy = (p1.y + p2.y) / 2;
        collisionsThisTick.push({ x: cx, y: cy });

        if (p1.hp <= 0) killPlayer(p1, 'collision');
        if (p2.hp <= 0) killPlayer(p2, 'collision');
      }
    }
  }
}

function checkItemPickups() {
  for (const p of players.values()) {
    if (!p.alive) continue;
    for (const [id, item] of items) {
      if (circleCircle(p.x, p.y, PLAYER_RADIUS, item.x, item.y, ITEM_RADIUS)) {
        pickupItem(p, item);
        break;
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════
//  LEADERBOARD
// ═══════════════════════════════════════════════════════════════

function getLeaderboard() {
  return Array.from(players.values())
    .filter(p => p.alive)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(p => ({
      name: p.name,
      time: Math.floor((currentTick - p.spawnTick) / TICK_RATE),
      score: p.score,
      id: p.id
    }));
}

// ═══════════════════════════════════════════════════════════════
//  MAIN GAME LOOP
// ═══════════════════════════════════════════════════════════════

function gameTick() {
  currentTick++;
  collisionsThisTick.length = 0;

  // Update respawn timers
  for (const p of players.values()) {
    if (!p.alive) {
      p.respawnTimer--;
      if (p.respawnTimer <= 0) {
        respawnPlayer(p);
        io.to(p.id).emit('respawned');
      }
      continue;
    }
    updateEffects(p);
    updatePlayerPhysics(p);
  }

  // Collisions
  checkPlayerCollisions();
  for (const p of players.values()) {
    if (!p.alive) continue;
    checkPillarCollisions(p);
    checkPitCollision(p);
    checkBorderCollision(p);
  }

  // Item pickups
  checkItemPickups();
  updateItemRespawns();

  // Broadcast state
  const playerArr = [];
  for (const p of players.values()) {
    if (p.alive && currentTick % TICK_RATE === 0) {
      p.score += 2; // +2 points per second for surviving
    }
    playerArr.push({
      id: p.id,
      x: Math.round(p.x * 10) / 10,
      y: Math.round(p.y * 10) / 10,
      angle: Math.round(p.angle * 1000) / 1000,
      vx: Math.round(p.vx * 100) / 100,
      vy: Math.round(p.vy * 100) / 100,
      promille: Math.round(p.promille * 100) / 100,
      hp: Math.round(p.hp),
      score: p.score,
      name: p.name,
      alive: p.alive,
      color: p.color,
      style: p.style,
      skin: p.skin,
      glow: p.glow,
      effects: getEffectSerialData(p),
      boosting: p.boostActive,
      boostCooldownPct: p.boostCooldown > 0 ? p.boostCooldown / BOOST_COOLDOWN_TICKS : 0
    });
  }

  const itemArr = [];
  for (const item of items.values()) {
    itemArr.push({ id: item.id, x: item.x, y: item.y, type: item.type, effect: item.effect });
  }

  io.emit('state', {
    players: playerArr,
    items: itemArr,
    collisions: collisionsThisTick.slice(),
    tick: currentTick
  });

  // Leaderboard every 10 ticks
  if (currentTick % 10 === 0) {
    io.emit('leaderboard', getLeaderboard());
  }
}

// ═══════════════════════════════════════════════════════════════
//  SOCKET HANDLERS
// ═══════════════════════════════════════════════════════════════

io.on('connection', (socket) => {
  console.log(`[+] Connected: ${socket.id}`);

  socket.on('join', (data) => {
    const name = (data && typeof data.name === 'string') ? data.name.trim() : 'Driver';
    const customColor = (data && typeof data.color === 'string') ? data.color : null;
    const customStyle = typeof data.style === 'string' ? data.style : 'sleek';
    const customSkin = typeof data.skin === 'string' ? data.skin : 'none';
    const customGlow = typeof data.glow === 'number' ? data.glow : 60;
    const player = createPlayer(socket.id, name, customColor, customStyle, customSkin, customGlow);
    players.set(socket.id, player);
    console.log(`[>] ${name} joined (${socket.id})`);

    socket.emit('welcome', {
      id: socket.id,
      world: { width: WORLD_W, height: WORLD_H },
      pillars: PILLARS,
      pits: PITS,
      borderMargin: BORDER_MARGIN,
      tickRate: TICK_RATE
    });
  });

  socket.on('input', (data) => {
    const p = players.get(socket.id);
    if (!p || !p.alive) return;
    p.input.targetAngle = typeof data.targetAngle === 'number' ? data.targetAngle : null;
    p.input.moving = !!data.moving;
    p.input.boost = !!data.boost;
  });

  socket.on('ping_check', (ts) => {
    socket.emit('pong_check', ts);
  });

  socket.on('disconnect', () => {
    console.log(`[-] Disconnected: ${socket.id}`);
    players.delete(socket.id);
  });
});

// ═══════════════════════════════════════════════════════════════
//  START
// ═══════════════════════════════════════════════════════════════

initItems();
setInterval(gameTick, TICK_MS);

server.listen(PORT, () => {
  console.log(`\n  ╔══════════════════════════════════════╗`);
  console.log(`  ║       DRUNK DRIVERS.IO  — SERVER     ║`);
  console.log(`  ║   Port: ${PORT}  |  Tick Rate: ${TICK_RATE}/s    ║`);
  console.log(`  ║   World: ${WORLD_W}x${WORLD_H}               ║`);
  console.log(`  ╚══════════════════════════════════════╝\n`);
  console.log(`  → Open http://localhost:${PORT} in your browser\n`);
});
