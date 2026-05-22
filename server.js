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
//  GAME STATE (MULTI-ROOM)
// ═══════════════════════════════════════════════════════════════

const MAX_PLAYERS_PER_ROOM = 50;
const activeRooms = new Map();
let roomCounter = 1;

class Room {
  constructor(id) {
    this.id = id;
    this.players = new Map();
    this.items = new Map();
    this.itemIdCounter = 0;
    this.colorIndex = 0;
    this.currentTick = 0;
    this.pendingItemRespawns = [];
    this.collisionsThisTick = [];
    
    for (let i = 0; i < MAX_ITEMS; i++) {
      this.spawnItem();
    }
  }

  nextColor() {
    const c = NEON_COLORS[this.colorIndex % NEON_COLORS.length];
    this.colorIndex++;
    return c;
  }

  spawnItem() {
    const pos = randomSafePosition(ITEM_RADIUS);
    const type = Math.random() < DRINK_SPAWN_CHANCE ? 'drink' : 'food';
    const effectType = type === 'drink' ? EFFECT_TYPES[Math.floor(Math.random() * EFFECT_TYPES.length)] : null;
    const id = ++this.itemIdCounter;
    this.items.set(id, { id, x: pos.x, y: pos.y, type, effect: effectType });
    return id;
  }

  updateItemRespawns() {
    for (let i = this.pendingItemRespawns.length - 1; i >= 0; i--) {
      if (this.currentTick >= this.pendingItemRespawns[i].tick) {
        this.spawnItem();
        this.pendingItemRespawns.splice(i, 1);
      }
    }
  }
}

function getAvailableRoom() {
  for (const room of activeRooms.values()) {
    if (room.players.size < MAX_PLAYERS_PER_ROOM) return room;
  }
  const newRoom = new Room('room-' + roomCounter++);
  activeRooms.set(newRoom.id, newRoom);
  console.log(`[+] Created new room: ${newRoom.id}`);
  return newRoom;
}

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

function createPlayer(room, id, name, customColor, customStyle, customSkin, customGlow) {
  const pos = randomSafePosition(PLAYER_RADIUS);
  let color = room.nextColor();
  if (customColor && typeof customColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(customColor)) {
    color = customColor;
  }
  const p = {
    id, roomId: room.id,
    name: name.substring(0, 16) || 'Driver',
    x: pos.x, y: pos.y, angle: Math.random() * Math.PI * 2,
    vx: 0, vy: 0, promille: 0, hp: 100, score: 0,
    mass: 1.0, topSpeed: BASE_TOP_SPEED, impactMultiplier: 1.0,
    handling: 1.0, lateralFriction: BASE_LATERAL_FRICTION,
    alive: true, respawnTimer: 0, color: color,
    style: customStyle || 'sleek', skin: customSkin || 'none', glow: customGlow !== undefined ? customGlow : 60,
    input: { targetAngle: null, moving: false, boost: false },
    effects: [], stickyLocked: false, stickyDirection: null, stickyTimer: 0,
    lastHitBy: null, lastHitTick: 0, boostActive: false, boostTimer: 0, boostCooldown: 0,
    spawnTick: room.currentTick
  };
  recalcStats(p);
  return p;
}

function respawnPlayer(room, p) {
  const pos = randomSafePosition(PLAYER_RADIUS);
  p.x = pos.x; p.y = pos.y; p.angle = Math.random() * Math.PI * 2;
  p.vx = 0; p.vy = 0; p.promille = 0; p.hp = 100;
  p.alive = true; p.respawnTimer = 0; p.boostActive = false; p.boostTimer = 0; p.boostCooldown = 0;
  p.effects = []; p.stickyLocked = false; p.lastHitBy = null; p.lastHitTick = 0; p.spawnTick = room.currentTick;
  p.input.moving = false; p.input.boost = false;
  recalcStats(p);
  io.to(p.id).emit('respawned');
}

function applyDamage(room, p, amount, killerId) {
  if (!p.alive || p.spawnTick + (1.5 * TICK_RATE) > room.currentTick) return;
  p.hp -= amount;
  if (killerId) { p.lastHitBy = killerId; p.lastHitTick = room.currentTick; }
  if (p.hp <= 0) killPlayer(room, p, 'combat');
}

function killPlayer(room, p, reason) {
  if (!p.alive) return;
  p.alive = false; p.hp = 0; p.respawnTimer = RESPAWN_TICKS;
  p.vx = 0; p.vy = 0;
  let killerName = null;
  if (p.lastHitBy && (room.currentTick - p.lastHitTick) < KILL_CREDIT_TICKS) {
    const killer = room.players.get(p.lastHitBy);
    if (killer && killer.alive) {
      killer.score += KILL_SCORE;
      killerName = killer.name;
      io.to(killer.id).emit('kill_confirmed');
    }
  }
  const finalScore = Math.floor(p.score);
  p.score = 0;
  io.to(p.id).emit('killed', { reason, killerName: killerName || null, respawnTime: RESPAWN_TICKS / TICK_RATE, finalScore });
}

// ═══════════════════════════════════════════════════════════════
//  EFFECT SYSTEM
// ═══════════════════════════════════════════════════════════════

function addEffect(room, p, type) {
  const existing = p.effects.find(e => e.type === type);
  if (existing) { existing.startTick = room.currentTick; }
  else { p.effects.push({ type, startTick: room.currentTick }); }
}

function hasEffect(p, type) {
  return p.effects.some(e => e.type === type);
}

function processEffects(room, p) {
  p.effects = p.effects.filter(e => {
    return (room.currentTick - e.startTick) < EFFECT_DURATION_TICKS;
  });
}

function clearAllEffects(p) {
  p.effects = [];
  p.stickyLocked = false;
  p.stickyDirection = null;
  p.stickyTimer = 0;
}

function getEffectSerialData(room, p) {
  return p.effects.map(e => ({
    type: e.type,
    remaining: Math.max(0, (EFFECT_DURATION_TICKS - (room.currentTick - e.startTick)) / TICK_RATE)
  }));
}

// ═══════════════════════════════════════════════════════════════
//  ITEM SYSTEM
// ═══════════════════════════════════════════════════════════════

function pickupItem(room, player, item) {
  player.score += 10;
  if (item.type === 'drink') {
    player.promille = Math.min(MAX_PROMILLE, player.promille + DRINK_PROMILLE);
    const effectType = item.effect || EFFECT_TYPES[Math.floor(Math.random() * EFFECT_TYPES.length)];
    addEffect(room, player, effectType);
    io.to(player.id).emit('pickup', { type: 'drink', effect: effectType, promille: player.promille });
  } else {
    player.promille = Math.max(0, player.promille + FOOD_PROMILLE);
    player.hp = Math.min(100, player.hp + FOOD_HEAL);
    clearAllEffects(player);
    io.to(player.id).emit('pickup', { type: 'food', promille: player.promille });
  }
  recalcStats(player);
  room.items.delete(item.id);
  room.pendingItemRespawns.push({ tick: room.currentTick + ITEM_RESPAWN_DELAY });
}

// ═══════════════════════════════════════════════════════════════
//  PHYSICS: INPUT PROCESSING WITH EFFECTS
// ═══════════════════════════════════════════════════════════════

function processInput(room, p) {
  const input = { ...p.input };

  if (hasEffect(p, 'STEERING_INVERT') && input.targetAngle !== null) {
    input.targetAngle = input.targetAngle + Math.PI;
  }
  if (hasEffect(p, 'REVERSE_GEAR') && input.targetAngle !== null) {
    input.targetAngle = input.targetAngle + Math.PI;
  }
  if (hasEffect(p, 'STUCK_THROTTLE')) {
    input.moving = true;
  }
  if (hasEffect(p, 'MICRO_SLEEP')) {
    const e = p.effects.find(ef => ef.type === 'MICRO_SLEEP');
    const elapsed = room.currentTick - e.startTick;
    const cyclePos = elapsed % MICROSLEEP_CYCLE;
    if (cyclePos >= MICROSLEEP_CYCLE - MICROSLEEP_FREEZE) {
      input.moving = false;
    }
  }
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

function updatePlayerPhysics(room, p) {
  if (!p.alive) return;

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

  if (hasEffect(p, 'SUDDEN_ACCELERATION') && Math.random() < 0.02) {
    p.boostActive = true;
    p.boostTimer = Math.round(0.4 * TICK_RATE);
  }

  if (hasEffect(p, 'BUMPY_RIDE') && Math.random() < 0.06) {
    p.vx += (Math.random() - 0.5) * 4;
    p.vy += (Math.random() - 0.5) * 4;
  }

  const input = processInput(room, p);
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

function checkBorderCollision(room, p) {
  if (!p.alive) return;
  if (p.x - PLAYER_RADIUS < BORDER_MARGIN ||
      p.x + PLAYER_RADIUS > WORLD_W - BORDER_MARGIN ||
      p.y - PLAYER_RADIUS < BORDER_MARGIN ||
      p.y + PLAYER_RADIUS > WORLD_H - BORDER_MARGIN) {
    killPlayer(room, p, 'border');
  }
}

function checkPitCollisions(room, p) {
  if (!p.alive) return;
  for (const pit of PITS) {
    if (circleRect(p.x, p.y, PLAYER_RADIUS, pit.x, pit.y, pit.w, pit.h)) {
      const closestX = clamp(p.x, pit.x, pit.x + pit.w);
      const closestY = clamp(p.y, pit.y, pit.y + pit.h);
      const distX = p.x - closestX;
      const distY = p.y - closestY;
      const distance = Math.sqrt(distX * distX + distY * distY);

      const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
      const entrySpeed = Math.max(speed, p.topSpeed * 0.5);
      const dmg = Math.min(30, 5 + entrySpeed * 1.5);
      const bounceForce = 4 + entrySpeed * 0.8;

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
      room.collisionsThisTick.push({ x: p.x, y: p.y });
      if (p.hp <= 0) {
        killPlayer(room, p, 'pit');
        return;
      }
    }
  }
}

function checkPillarCollisions(room, p) {
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
      const dmg = Math.min(spd * 0.8, 8); 
      p.hp -= dmg;
      room.collisionsThisTick.push({ x: pillar.x + nx * pillar.radius, y: pillar.y + ny * pillar.radius });

      if (p.hp <= 0) {
        killPlayer(room, p, 'pillar');
        return;
      }
    }
  }
}

function checkPlayerCollisions(room) {
  const arr = Array.from(room.players.values()).filter(p => p.alive);
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

        const p1SpeedTowardsP2 = p1.vx * nx + p1.vy * ny;
        const p2SpeedTowardsP1 = p2.vx * (-nx) + p2.vy * (-ny);

        let dmg2 = 0;
        if (p1SpeedTowardsP2 > 0.5) {
          dmg2 = p1SpeedTowardsP2 * 3.0 * p1.impactMultiplier * 0.15;
        }

        let dmg1 = 0;
        if (p2SpeedTowardsP1 > 0.5) {
          dmg1 = p2SpeedTowardsP1 * 3.0 * p2.impactMultiplier * 0.15;
        }

        p1.hp -= dmg1;
        p2.hp -= dmg2;

        p1.lastHitBy = p2.id;
        p1.lastHitTick = room.currentTick;
        p2.lastHitBy = p1.id;
        p2.lastHitTick = room.currentTick;

        const cx = (p1.x + p2.x) / 2;
        const cy = (p1.y + p2.y) / 2;
        room.collisionsThisTick.push({ x: cx, y: cy });

        if (p1.hp <= 0) killPlayer(room, p1, 'collision');
        if (p2.hp <= 0) killPlayer(room, p2, 'collision');
      }
    }
  }
}

function checkItemPickups(room) {
  for (const p of room.players.values()) {
    if (!p.alive) continue;
    for (const [id, item] of room.items) {
      if (circleCircle(p.x, p.y, PLAYER_RADIUS, item.x, item.y, ITEM_RADIUS)) {
        pickupItem(room, p, item);
        break;
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════
//  LEADERBOARD
// ═══════════════════════════════════════════════════════════════

function getLeaderboard(room) {
  return Array.from(room.players.values())
    .filter(p => p.alive)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(p => ({
      name: p.name,
      time: Math.floor((room.currentTick - p.spawnTick) / TICK_RATE),
      score: p.score,
      id: p.id
    }));
}


// ═══════════════════════════════════════════════════════════════
//  MAIN GAME LOOP (PER ROOM)
// ═══════════════════════════════════════════════════════════════

function gameTick(room) {
  room.currentTick++;
  room.collisionsThisTick.length = 0;

  for (const p of room.players.values()) {
    if (!p.alive) {
      p.respawnTimer--;
      if (p.respawnTimer <= 0) {
        respawnPlayer(room, p);
      }
      continue;
    }
    processEffects(room, p);
    updatePlayerPhysics(room, p);
  }

  checkPlayerCollisions(room);
  for (const p of room.players.values()) {
    if (!p.alive) continue;
    checkPillarCollisions(room, p);
    checkPitCollisions(room, p);
    checkBorderCollision(room, p);
  }

  checkItemPickups(room);
  room.updateItemRespawns();

  const playerArr = [];
  for (const p of room.players.values()) {
    if (p.alive && room.currentTick % TICK_RATE === 0) {
      p.score += 2;
    }
    playerArr.push({
      id: p.id,
      x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10,
      angle: Math.round(p.angle * 1000) / 1000,
      vx: Math.round(p.vx * 100) / 100, vy: Math.round(p.vy * 100) / 100,
      promille: Math.round(p.promille * 100) / 100,
      hp: Math.round(p.hp), score: p.score,
      name: p.name, alive: p.alive,
      color: p.color, style: p.style, skin: p.skin, glow: p.glow,
      effects: getEffectSerialData(room, p),
      boosting: p.boostActive,
      boostCooldownPct: p.boostCooldown > 0 ? p.boostCooldown / BOOST_COOLDOWN_TICKS : 0
    });
  }

  const itemArr = [];
  for (const item of room.items.values()) {
    itemArr.push({ id: item.id, x: item.x, y: item.y, type: item.type, effect: item.effect });
  }

  io.to(room.id).emit('state', {
    players: playerArr,
    items: itemArr,
    collisions: room.collisionsThisTick.slice(),
    tick: room.currentTick
  });

  if (room.currentTick % 10 === 0) {
    io.to(room.id).emit('leaderboard', getLeaderboard(room));
  }
}

// ═══════════════════════════════════════════════════════════════
//  SOCKET HANDLERS
// ═══════════════════════════════════════════════════════════════

io.on('connection', (socket) => {
  console.log(`[+] Connected: ${socket.id}`);

  socket.on('join', (data) => {
    const room = getAvailableRoom();
    
    const name = (data && typeof data.name === 'string') ? data.name.trim() : 'Driver';
    const customColor = (data && typeof data.color === 'string') ? data.color : null;
    const customStyle = typeof data.style === 'string' ? data.style : 'sleek';
    const customSkin = typeof data.skin === 'string' ? data.skin : 'none';
    const customGlow = typeof data.glow === 'number' ? data.glow : 60;
    
    const player = createPlayer(room, socket.id, name, customColor, customStyle, customSkin, customGlow);
    room.players.set(socket.id, player);
    
    socket.roomId = room.id;
    socket.join(room.id);
    
    console.log(`[>] ${name} joined ${room.id} (${socket.id})`);

    socket.emit('welcome', {
      id: socket.id,
      world: { width: WORLD_W, height: WORLD_H },
      pillars: PILLARS,
      pits: PITS,
      borderMargin: BORDER_MARGIN,
      tickRate: TICK_RATE
    });
  });

  socket.on('leave', () => {
    if (socket.roomId && activeRooms.has(socket.roomId)) {
      const room = activeRooms.get(socket.roomId);
      room.players.delete(socket.id);
      socket.leave(socket.roomId);
      socket.roomId = null;
    }
  });

  socket.on('input', (data) => {
    if (!socket.roomId) return;
    const room = activeRooms.get(socket.roomId);
    if (!room) return;
    const p = room.players.get(socket.id);
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
    if (socket.roomId && activeRooms.has(socket.roomId)) {
      activeRooms.get(socket.roomId).players.delete(socket.id);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
//  START
// ═══════════════════════════════════════════════════════════════

setInterval(() => {
  for (const room of activeRooms.values()) {
    gameTick(room);
    
    // Optional: Clean up empty rooms
    if (room.players.size === 0 && room.currentTick > 600) {
      activeRooms.delete(room.id);
      console.log(`[-] Deleted empty room: ${room.id}`);
    }
  }
}, TICK_MS);

server.listen(PORT, () => {
  console.log(`\n  ╔══════════════════════════════════════╗`);
  console.log(`  ║       DRUNK DRIVERS.IO  — SERVER     ║`);
  console.log(`  ║   Port: ${PORT}  |  Tick Rate: ${TICK_RATE}/s    ║`);
  console.log(`  ║   World: ${WORLD_W}x${WORLD_H}               ║`);
  console.log(`  ╚══════════════════════════════════════╝\n`);
  console.log(`  → Open http://localhost:${PORT} in your browser\n`);
});
