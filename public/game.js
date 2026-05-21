// ═══════════════════════════════════════════════════════════════
//  DRUNK DRIVERS.IO — Client Game Engine
//  HTML5 Canvas 2D · Socket.io · Neon Procedural Rendering
// ═══════════════════════════════════════════════════════════════

(() => {
  'use strict';

  // ─── CONSTANTS ──────────────────────────────────────────────
  const MAX_PARTICLES = 600;
  const LERP_REMOTE = 0.18;
  const LERP_LOCAL = 0.4;
  const GRID_SIZE = 80;
  const CAR_CORNER = 5;
  const MINIMAP_SCALE_SM = 0.04;  // 3000*0.04=120
  const MINIMAP_SCALE_LG = 0.05;  // 3000*0.05=150

  // ─── CAR CUSTOMIZATION ─────────────────────────────────────
  const CAR_COLORS = [
    '#00f0ff', '#ff00e5', '#00ff88', '#ff8c00',
    '#ff0066', '#8b5cf6', '#ffd700', '#00aaff',
    '#ff4466', '#44ff88', '#ff44ff', '#ff6644',
    '#4488ff', '#ff4488', '#ffffff', '#ff2222'
  ];
  const CAR_STYLES = {
    sleek:   { w: 62, h: 34, label: 'Sleek' },
    muscle:  { w: 47, h: 47, label: 'Muscle' },
    compact: { w: 73, h: 23, label: 'Compact' }
  };

  let customColor = CAR_COLORS[0];
  let customStyle = 'sleek';
  let customGlow = 60;

  const EFFECT_LABELS = {
    'STEERING_INVERT': { label: 'INVERTED', icon: 'INV', color: '#ff8c00' },
    'STICKY_WHEEL': { label: 'STICKY', icon: 'STK', color: '#ff0066' },
    'MICRO_SLEEP': { label: 'DROWSY', icon: 'SLP', color: '#8b5cf6' },
    'DOUBLE_VISION': { label: 'DOUBLE', icon: 'DBL', color: '#00aaff' },
    'TUNNEL_VISION': { label: 'TUNNEL', icon: 'TUN', color: '#ffd700' },
    'STUCK_THROTTLE': { label: 'STUCK', icon: 'STC', color: '#ff0044' },
    'REVERSE_GEAR': { label: 'REVERSE', icon: 'REV', color: '#ff2222' },
    'SLIPPERY_TIRES': { label: 'ICE', icon: 'ICE', color: '#00f0ff' },
    'BUMPY_RIDE': { label: 'BUMPY', icon: 'BMP', color: '#ffd700' },
    'SUDDEN_ACCELERATION': { label: 'NOS JUMPS', icon: 'NOS', color: '#ff00e5' },
    'COLOR_TRIP': { label: 'TRIPPIN', icon: 'TRP', color: '#ff00ff' }
  };

  // ─── STATE ──────────────────────────────────────────────────
  let socket = null;
  let localId = null;
  let playing = false;
  let connected = false;
  let worldData = null;
  let pillars = [];
  let pits = [];
  let borderMargin = 30;
  let tickRate = 45;

  let serverPlayers = [];
  let serverItems = [];
  let leaderboard = [];

  const renderPlayers = {};
  const particles = [];

  const camera = { x: 0, y: 0, shakeX: 0, shakeY: 0, shakeTime: 0, wobblePhase: 0 };
  const keys = {};
  let lastInputSend = 0;
  let deathTimerInterval = null;

  // Touch state
  const touchKeys = { up: false, down: false, left: false, right: false, boost: false };
  let isMobile = false;

  // ─── DOM REFS ───────────────────────────────────────────────
  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');

  const menuOverlay = document.getElementById('menuOverlay');
  const menuCard = document.getElementById('menuCard');
  const customizePanel = document.getElementById('customizePanel');
  const gameHUD = document.getElementById('gameHUD');
  const nicknameInput = document.getElementById('nicknameInput');
  const playBtn = document.getElementById('playBtn');
  const customizeBtn = document.getElementById('customizeBtn');
  const customizeBack = document.getElementById('customizeBack');

  const promilleValue = document.getElementById('promilleValue');
  const promilleBarFill = document.getElementById('promilleBarFill');
  const effectBadges = document.getElementById('effectBadges');
  const leaderboardList = document.getElementById('leaderboardList');
  const scoreValue = document.getElementById('scoreValue');
  const hpValue = document.getElementById('hpValue');
  const hpBarFill = document.getElementById('hpBarFill');
  const boostLabel = document.getElementById('boostLabel');
  const boostBarFill = document.getElementById('boostBarFill');

  const deathScreen = document.getElementById('deathScreen');
  const deathKiller = document.getElementById('deathKiller');
  const deathTimer = document.getElementById('deathTimer');

  const colorSwatches = document.getElementById('colorSwatches');
  const carPreviewCanvas = document.getElementById('carPreview');
  const carPreviewCtx = carPreviewCanvas.getContext('2d');
  const glowSlider = document.getElementById('glowSlider');

  // ─── DETECT MOBILE ─────────────────────────────────────────
  function detectMobile() {
    isMobile = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || window.innerWidth < 640;
    const tc = document.getElementById('touchControls');
    if (tc) {
      if (isMobile) tc.classList.remove('hidden');
      else tc.classList.add('hidden');
    }
  }
  detectMobile();
  window.addEventListener('resize', detectMobile);

  // ─── CANVAS RESIZE ─────────────────────────────────────────
  function resizeCanvas() {
    const container = document.getElementById('gameContainer') || document.body;
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;
  }
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  // ─── UTILITIES ──────────────────────────────────────────────
  function lerp(a, b, t) { return a + (b - a) * t; }

  function lerpAngle(a, b, t) {
    let diff = b - a;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return a + diff * t;
  }

  function getPromilleColor(p) {
    if (p < 1.5) return lerpColor('#00ff88', '#ffd700', p / 1.5);
    if (p < 3.0) return lerpColor('#ffd700', '#ff8800', (p - 1.5) / 1.5);
    return lerpColor('#ff8800', '#ff0044', (p - 3.0) / 1.5);
  }

  function lerpColor(c1, c2, t) {
    t = Math.max(0, Math.min(1, t));
    const r1 = parseInt(c1.slice(1, 3), 16), g1 = parseInt(c1.slice(3, 5), 16), b1 = parseInt(c1.slice(5, 7), 16);
    const r2 = parseInt(c2.slice(1, 3), 16), g2 = parseInt(c2.slice(3, 5), 16), b2 = parseInt(c2.slice(5, 7), 16);
    const r = Math.round(r1 + (r2 - r1) * t);
    const g = Math.round(g1 + (g2 - g1) * t);
    const b = Math.round(b1 + (b2 - b1) * t);
    return `rgb(${r},${g},${b})`;
  }

  function hexToRgba(hex, alpha) {
    if (hex.startsWith('rgb')) {
      const m = hex.match(/(\d+)/g);
      if (m) return `rgba(${m[0]},${m[1]},${m[2]},${alpha})`;
    }
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function worldToScreen(wx, wy) {
    return {
      x: wx - camera.x + canvas.width / 2 + camera.shakeX,
      y: wy - camera.y + canvas.height / 2 + camera.shakeY
    };
  }

  function isOnScreen(wx, wy, margin) {
    const s = worldToScreen(wx, wy);
    return s.x > -margin && s.x < canvas.width + margin &&
           s.y > -margin && s.y < canvas.height + margin;
  }

  function getCarDims(style) {
    return CAR_STYLES[style] || CAR_STYLES.sleek;
  }

  // ─── PARTICLE SYSTEM ───────────────────────────────────────
  function addParticle(p) {
    if (particles.length >= MAX_PARTICLES) particles.shift();
    p.maxLife = p.life;
    particles.push(p);
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * dt * 60;
      p.y += p.vy * dt * 60;
      p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }

  function spawnExhaust(player) {
    const speed = Math.sqrt(player.vx * player.vx + player.vy * player.vy);
    if (speed < 0.3) return;

    const emitRate = player.boosting ? 0.9 : speed / 6;
    if (Math.random() > emitRate) return;

    const dims = getCarDims(customStyle);
    const rearX = player.rx - Math.cos(player.rAngle) * (dims.w / 2);
    const rearY = player.ry - Math.sin(player.rAngle) * (dims.w / 2);

    const prom = player.promille || 0;
    let color;
    if (player.boosting) {
      color = Math.random() > 0.5 ? '#00f0ff' : '#ffffff';
    } else if (prom < 1.5) {
      color = lerpColor('#00f0ff', '#ffd700', prom / 1.5);
    } else if (prom < 3) {
      color = lerpColor('#ffd700', '#ff8800', (prom - 1.5) / 1.5);
    } else {
      color = lerpColor('#ff8800', '#ff00e5', (prom - 3) / 1.5);
    }

    const spread = player.boosting ? 1.2 : 0.6;
    addParticle({
      x: rearX + (Math.random() - 0.5) * 8,
      y: rearY + (Math.random() - 0.5) * 8,
      vx: -Math.cos(player.rAngle) * speed * 0.3 + (Math.random() - 0.5) * spread,
      vy: -Math.sin(player.rAngle) * speed * 0.3 + (Math.random() - 0.5) * spread,
      life: 0.25 + Math.random() * 0.5,
      color: color,
      size: player.boosting ? 3 + Math.random() * 4 : 2 + Math.random() * 3
    });
  }

  function spawnCollisionSparks(wx, wy) {
    for (let i = 0; i < 18; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd = 1 + Math.random() * 3;
      addParticle({
        x: wx, y: wy,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        life: 0.2 + Math.random() * 0.4,
        color: Math.random() > 0.5 ? '#ffd700' : '#ff8800',
        size: 2 + Math.random() * 2
      });
    }
    camera.shakeTime = 0.2;
  }

  function spawnPickupBurst(wx, wy, color) {
    for (let i = 0; i < 14; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd = 0.8 + Math.random() * 2;
      addParticle({
        x: wx, y: wy,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        life: 0.3 + Math.random() * 0.5,
        color: color,
        size: 3 + Math.random() * 3
      });
    }
  }

  // ─── DRAWING HELPERS ────────────────────────────────────────
  function drawRoundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.lineTo(x + w - r, y);
    c.arcTo(x + w, y, x + w, y + r, r);
    c.lineTo(x + w, y + h - r);
    c.arcTo(x + w, y + h, x + w - r, y + h, r);
    c.lineTo(x + r, y + h);
    c.arcTo(x, y + h, x, y + h - r, r);
    c.lineTo(x, y + r);
    c.arcTo(x, y, x + r, y, r);
    c.closePath();
  }



  // ─── RENDER: GRID ───────────────────────────────────────────
  function drawGrid() {
    if (!worldData) return;
    const ww = worldData.width;
    const wh = worldData.height;
    const startX = Math.floor((camera.x - canvas.width / 2) / GRID_SIZE) * GRID_SIZE;
    const endX = camera.x + canvas.width / 2 + GRID_SIZE;
    const startY = Math.floor((camera.y - canvas.height / 2) / GRID_SIZE) * GRID_SIZE;
    const endY = camera.y + canvas.height / 2 + GRID_SIZE;

    ctx.strokeStyle = 'rgba(255,255,255,0.025)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let gx = startX; gx <= endX; gx += GRID_SIZE) {
      if (gx < 0 || gx > ww) continue;
      const s = worldToScreen(gx, Math.max(0, startY));
      const e = worldToScreen(gx, Math.min(wh, endY));
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(e.x, e.y);
    }
    for (let gy = startY; gy <= endY; gy += GRID_SIZE) {
      if (gy < 0 || gy > wh) continue;
      const s = worldToScreen(Math.max(0, startX), gy);
      const e = worldToScreen(Math.min(ww, endX), gy);
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(e.x, e.y);
    }
    ctx.stroke();
  }

  // ─── RENDER: WORLD BORDER ──────────────────────────────────
  function drawBorder() {
    if (!worldData) return;
    const tl = worldToScreen(borderMargin, borderMargin);
    const br = worldToScreen(worldData.width - borderMargin, worldData.height - borderMargin);
    const w = br.x - tl.x;
    const h = br.y - tl.y;

    ctx.save();
    ctx.strokeStyle = '#ff003c';
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#ff003c';
    ctx.lineWidth = 3;
    ctx.strokeRect(tl.x, tl.y, w, h);
    ctx.restore();

    ctx.fillStyle = 'rgba(255, 0, 60, 0.06)';
    const otl = worldToScreen(0, 0);
    const obr = worldToScreen(worldData.width, worldData.height);
    ctx.fillRect(otl.x, otl.y, obr.x - otl.x, tl.y - otl.y);
    ctx.fillRect(otl.x, br.y, obr.x - otl.x, obr.y - br.y);
    ctx.fillRect(otl.x, tl.y, tl.x - otl.x, br.y - tl.y);
    ctx.fillRect(br.x, tl.y, obr.x - br.x, br.y - tl.y);
  }

  // ─── RENDER: PILLARS ───────────────────────────────────────
  function drawPillars() {
    const time = performance.now() / 1000;
    for (const p of pillars) {
      if (!isOnScreen(p.x, p.y, p.radius + 30)) continue;
      const s = worldToScreen(p.x, p.y);
      ctx.save();
      ctx.translate(s.x, s.y);
      
      // Outer glow and base
      // Outer glow and base
      const grad = ctx.createRadialGradient(0, 0, p.radius * 0.3, 0, 0, p.radius);
      grad.addColorStop(0, 'rgba(139, 92, 246, 0.4)');
      grad.addColorStop(0.8, 'rgba(139, 92, 246, 0.1)');
      grad.addColorStop(1, 'rgba(0, 0, 0, 0.8)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, p.radius, 0, Math.PI * 2);
      ctx.fill();
      
      // Cyber border
      ctx.strokeStyle = '#8b5cf6';
      ctx.lineWidth = 3;
      ctx.stroke();

      // Rotating dashed ring
      // Rotating dashed ring
      ctx.rotate(time * 0.5);
      ctx.strokeStyle = '#00f0ff';
      ctx.lineWidth = 2;
      ctx.setLineDash([15, 10]);
      ctx.beginPath();
      ctx.arc(0, 0, p.radius * 0.75, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      
      // Inner pulsating core
      const pulse = 0.5 + Math.sin(time * 4) * 0.5;
      ctx.rotate(-time * 1.2);
      ctx.fillStyle = `rgba(139, 92, 246, ${0.4 + pulse * 0.4})`;
      ctx.beginPath();
      ctx.moveTo(0, -p.radius * 0.3);
      ctx.lineTo(p.radius * 0.25, p.radius * 0.15);
      ctx.lineTo(-p.radius * 0.25, p.radius * 0.15);
      ctx.closePath();
      ctx.fill();

      ctx.restore();
    }
  }

  // ─── RENDER: DEATH PITS ────────────────────────────────────
  function drawPits() {
    const time = performance.now() / 1000;
    for (const pit of pits) {
      const tl = worldToScreen(pit.x, pit.y);
      const br = worldToScreen(pit.x + pit.w, pit.y + pit.h);
      const pw = br.x - tl.x;
      const ph = br.y - tl.y;
      if (tl.x > canvas.width || br.x < 0 || tl.y > canvas.height || br.y < 0) continue;
      
      ctx.save();
      // Abyss background
      ctx.fillStyle = '#020204';
      ctx.fillRect(tl.x, tl.y, pw, ph);

      // Deep glowing grid
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(255, 0, 60, 0.15)';
      ctx.lineWidth = 1;
      const gridOfs = (time * 20) % 30;
      for (let x = gridOfs; x < pw; x += 30) { ctx.moveTo(tl.x + x, tl.y); ctx.lineTo(tl.x + x, tl.y + ph); }
      for (let y = gridOfs; y < ph; y += 30) { ctx.moveTo(tl.x, tl.y + y); ctx.lineTo(tl.x + pw, tl.y + y); }
      ctx.stroke();

      // Inner shadow for depth
      const grad = ctx.createRadialGradient(tl.x + pw / 2, tl.y + ph / 2, 0, tl.x + pw / 2, tl.y + ph / 2, Math.max(pw, ph) / 1.5);
      grad.addColorStop(0, 'rgba(0,0,0,0.95)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(tl.x, tl.y, pw, ph);

      // Pulsing border with danger tape
      const pulse = 0.5 + Math.sin(time * 3) * 0.5;
      ctx.strokeStyle = `rgba(255, 0, 60, ${0.4 + pulse * 0.6})`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = `rgba(255, 0, 60, ${0.4 + pulse * 0.6})`;
      ctx.lineWidth = 3;
      ctx.strokeRect(tl.x, tl.y, pw, ph);

      // Danger stripes around the inside
      // Danger stripes around the inside
      ctx.strokeStyle = `rgba(255, 100, 0, ${0.5 + pulse * 0.3})`;
      ctx.lineWidth = 4;
      ctx.setLineDash([20, 20]);
      ctx.lineDashOffset = -time * 30;
      ctx.strokeRect(tl.x + 2, tl.y + 2, pw - 4, ph - 4);
      ctx.setLineDash([]);

      ctx.restore();
    }
  }

  // ─── RENDER: ITEMS ─────────────────────────────────────────
  function drawItems() {
    const time = performance.now() / 1000;
    for (const item of serverItems) {
      if (!isOnScreen(item.x, item.y, 40)) continue;
      const s = worldToScreen(item.x, item.y);
      const pulse = 0.6 + Math.sin(time * 4 + item.id) * 0.4;
      ctx.save();
      if (item.type === 'drink') {
        const info = EFFECT_LABELS[item.effect] || { color: '#ff00e5', icon: 'DRNK' };
        ctx.strokeStyle = hexToRgba(info.color, 0.15 + pulse * 0.2);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 18 + pulse * 3, 0, Math.PI * 2);
        ctx.stroke();
        
        const grad = ctx.createRadialGradient(s.x, s.y - 2, 2, s.x, s.y, 12);
        grad.addColorStop(0, hexToRgba(info.color, 0.6));
        grad.addColorStop(1, hexToRgba(info.color, 0.1));
        ctx.fillStyle = grad;
        
        ctx.beginPath();
        const shapeType = (item.effect && item.effect.length) ? item.effect.length % 3 : 0;
        if (shapeType === 0) {
          // Martini Glass
          ctx.moveTo(s.x - 8, s.y - 6);
          ctx.lineTo(s.x + 8, s.y - 6);
          ctx.lineTo(s.x, s.y + 4);
          ctx.lineTo(s.x, s.y + 10);
          ctx.moveTo(s.x - 4, s.y + 10);
          ctx.lineTo(s.x + 4, s.y + 10);
        } else if (shapeType === 1) {
          // Pint Glass
          ctx.moveTo(s.x - 5, s.y - 8);
          ctx.lineTo(s.x + 5, s.y - 8);
          ctx.lineTo(s.x + 4, s.y + 10);
          ctx.lineTo(s.x - 4, s.y + 10);
        } else {
          // Bottle / Flask
          ctx.moveTo(s.x - 5, s.y + 10);
          ctx.lineTo(s.x - 5, s.y - 2);
          ctx.lineTo(s.x - 3, s.y - 5);
          ctx.lineTo(s.x - 3, s.y - 10);
          ctx.lineTo(s.x + 3, s.y - 10);
          ctx.lineTo(s.x + 3, s.y - 5);
          ctx.lineTo(s.x + 5, s.y - 2);
          ctx.lineTo(s.x + 5, s.y + 10);
        }
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = info.color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        

      } else {
        ctx.strokeStyle = hexToRgba('#00ff88', 0.15 + pulse * 0.2);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 18 + pulse * 3, 0, Math.PI * 2);
        ctx.stroke();
        const grad = ctx.createRadialGradient(s.x, s.y - 1, 2, s.x, s.y, 11);
        grad.addColorStop(0, 'rgba(0, 255, 136, 0.5)');
        grad.addColorStop(1, 'rgba(0, 255, 136, 0.08)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#00ff88';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.strokeStyle = 'rgba(0, 255, 136, 0.4)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(s.x - 4, s.y); ctx.lineTo(s.x + 4, s.y);
        ctx.moveTo(s.x, s.y - 4); ctx.lineTo(s.x, s.y + 4);
        ctx.stroke();

      }
      ctx.restore();
    }
  }

  // ─── RENDER: VEHICLE ───────────────────────────────────────
  function drawVehicleShape(c, carW, carH, color, glowAmt, boosting) {
    const glowIntensity = (glowAmt / 100) * 50 + 10;
    c.shadowColor = color;
    c.shadowBlur = boosting ? glowIntensity * 2.5 : glowIntensity;
    c.fillStyle = hexToRgba(color, boosting ? 0.3 : 0.15);
    drawRoundRect(c, -carW / 2, -carH / 2, carW, carH, CAR_CORNER);
    c.fill();
    c.strokeStyle = color;
    c.lineWidth = boosting ? 2.5 : 2;
    drawRoundRect(c, -carW / 2, -carH / 2, carW, carH, CAR_CORNER);
    c.stroke();

    c.shadowBlur = 0;
    c.strokeStyle = hexToRgba(color, 0.2);
    c.lineWidth = 1;
    drawRoundRect(c, -carW / 2 + 4, -carH / 2 + 3, carW - 8, carH - 6, 2);
    c.stroke();

    // Headlights
    c.shadowColor = '#ffffff';
    c.shadowBlur = 8;
    c.fillStyle = 'rgba(255,255,255,0.9)';
    c.beginPath(); c.arc(carW / 2 - 5, -carH / 4, 2.5, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(carW / 2 - 5, carH / 4, 2.5, 0, Math.PI * 2); c.fill();

    // Headlight beams
    c.shadowBlur = 0;
    const beamGrad = c.createLinearGradient(carW / 2, 0, carW / 2 + 30, 0);
    beamGrad.addColorStop(0, 'rgba(255,255,255,0.08)');
    beamGrad.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = beamGrad;
    c.beginPath();
    c.moveTo(carW / 2 - 2, -carH / 4 - 3);
    c.lineTo(carW / 2 + 35, -carH / 2 - 8);
    c.lineTo(carW / 2 + 35, carH / 2 + 8);
    c.lineTo(carW / 2 - 2, carH / 4 + 3);
    c.closePath();
    c.fill();

    // Tail lights
    c.fillStyle = 'rgba(255, 0, 60, 0.8)';
    c.shadowColor = '#ff003c';
    c.shadowBlur = boosting ? 12 : 6;
    c.beginPath(); c.arc(-carW / 2 + 4, -carH / 4, 2, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(-carW / 2 + 4, carH / 4, 2, 0, Math.PI * 2); c.fill();
    c.shadowBlur = 0;
  }

  function drawVehicle(p, isLocal) {
    if (!p.alive && !isLocal) return;
    if (!isOnScreen(p.rx, p.ry, 80)) return;
    const s = worldToScreen(p.rx, p.ry);
    let color = p.color || '#00f0ff';
    
    if (p.effects && p.effects.some(e => e.type === 'COLOR_TRIP')) {
      color = CAR_COLORS[Math.floor(performance.now() / 150) % CAR_COLORS.length];
    }

    const dims = getCarDims(p.style || 'sleek');
    const glow = p.glow !== undefined ? p.glow : 60;

    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(p.rAngle);
    drawVehicleShape(ctx, dims.w, dims.h, color, glow, p.boosting);
    ctx.restore();

    // Labels
    ctx.save();
    ctx.shadowBlur = 0;
    ctx.textAlign = 'center';
    if (p.hp < 100) {
      const barW = 34, barH = 3, barY = s.y - 30;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(s.x - barW / 2, barY, barW, barH);
      const hpFrac = Math.max(0, p.hp / 100);
      ctx.fillStyle = hpFrac > 0.5 ? '#00ff88' : hpFrac > 0.25 ? '#ffd700' : '#ff0044';
      ctx.fillRect(s.x - barW / 2, barY, barW * hpFrac, barH);
    }
    ctx.font = '500 11px Inter';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText(p.name, s.x, s.y - 36);
    const prom = p.promille || 0;
    if (prom > 0) {
      ctx.font = '600 9px Orbitron';
      ctx.fillStyle = getPromilleColor(prom);
      ctx.fillText(prom.toFixed(2) + '‰', s.x, s.y - 46);
    }
    ctx.restore();
  }

  // ─── RENDER: PARTICLES ─────────────────────────────────────
  function drawParticles() {
    for (const p of particles) {
      if (!isOnScreen(p.x, p.y, 10)) continue;
      const s = worldToScreen(p.x, p.y);
      const alpha = (p.life / p.maxLife) * 0.8;
      const size = p.size * (p.life / p.maxLife);
      ctx.fillStyle = hexToRgba(p.color, alpha);
      ctx.beginPath();
      ctx.arc(s.x, s.y, Math.max(0.1, size), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawKingPointer() {
    if (!leaderboard || leaderboard.length === 0) return;
    const kingId = leaderboard[0].id;
    if (kingId === localId) return; // You are the king

    const kingPlayer = serverPlayers.find(p => p.id === kingId);
    if (!kingPlayer || !kingPlayer.alive) return;

    const localPlayer = renderPlayers[localId];
    if (!localPlayer) return;

    const dx = kingPlayer.x - localPlayer.rx;
    const dy = kingPlayer.y - localPlayer.ry;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    if (dist < 400) return; // Only show if sufficiently far away

    const angle = Math.atan2(dy, dx);
    const sCenter = worldToScreen(localPlayer.rx, localPlayer.ry);
    
    const radius = 100;
    const ix = sCenter.x + Math.cos(angle) * radius;
    const iy = sCenter.y + Math.sin(angle) * radius;

    ctx.save();
    ctx.translate(ix, iy);
    ctx.rotate(angle);
    
    ctx.shadowColor = '#ffd700';
    ctx.shadowBlur = 15;
    ctx.fillStyle = 'rgba(255, 215, 0, 0.8)';
    
    ctx.beginPath();
    ctx.moveTo(12, 0);
    ctx.lineTo(-8, 8);
    ctx.lineTo(-4, 0);
    ctx.lineTo(-8, -8);
    ctx.closePath();
    ctx.fill();

    ctx.rotate(-angle);
    ctx.font = '10px Orbitron';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowBlur = 0;
    ctx.fillText('1ST', Math.cos(angle) * 18, Math.sin(angle) * 18);
    
    ctx.restore();
  }


  // ─── RENDER: VISUAL EFFECTS ────────────────────────────────
  function drawDoubleVision() {
    const local = getLocalPlayer();
    if (!local) return;
    ctx.save();
    ctx.globalAlpha = 0.25;
    for (const p of serverPlayers) {
      if (p.id === localId || !p.alive) continue;
      const rp = renderPlayers[p.id];
      if (!rp) continue;
      const d = Math.sqrt(Math.pow(rp.rx - local.rx, 2) + Math.pow(rp.ry - local.ry, 2));
      if (d > 600) continue;
      const ghost1 = { ...rp, rx: rp.rx + 25, ry: rp.ry + 15 };
      drawVehicle(ghost1, false);
      const ghost2 = { ...rp, rx: rp.rx - 20, ry: rp.ry - 25 };
      drawVehicle(ghost2, false);
    }
    ctx.restore();
  }

  function drawTunnelVision() {
    const time = performance.now() / 1000;
    const radius = 180 + Math.sin(time * 2.5) * 50;
    const cx = canvas.width / 2 + camera.shakeX;
    const cy = canvas.height / 2 + camera.shakeY;
    const grad = ctx.createRadialGradient(cx, cy, radius * 0.4, cx, cy, radius);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.7, 'rgba(0,0,0,0.5)');
    grad.addColorStop(1, 'rgba(0,0,0,0.92)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // ─── CAMERA ─────────────────────────────────────────────────
  function updateCamera(dt) {
    const local = getLocalPlayer();
    if (!local) return;
    camera.x += (local.rx - camera.x) * 0.1;
    camera.y += (local.ry - camera.y) * 0.1;
    if (camera.shakeTime > 0) {
      camera.shakeTime -= dt;
      camera.shakeX = (Math.random() - 0.5) * 7;
      camera.shakeY = (Math.random() - 0.5) * 7;
    } else {
      camera.shakeX *= 0.8;
      camera.shakeY *= 0.8;
    }
    const prom = local.promille || 0;
    if (prom > 1.0) {
      camera.wobblePhase += dt * (1.5 + prom * 0.5);
      const wobbleIntensity = (prom - 1.0) * 2.5;
      camera.shakeX += Math.sin(camera.wobblePhase) * wobbleIntensity;
      camera.shakeY += Math.cos(camera.wobblePhase * 0.7) * wobbleIntensity * 0.6;
    }
  }


  // ─── UI UPDATES ─────────────────────────────────────────────
  function getLocalPlayer() {
    return renderPlayers[localId] || null;
  }
  function getLocalServerPlayer() {
    return serverPlayers.find(p => p.id === localId) || null;
  }

  function updatePromilleUI() {
    const p = getLocalServerPlayer();
    if (!p) return;
    const prom = p.promille || 0;
    const pct = (prom / 4.5) * 100;
    const color = getPromilleColor(prom);
    promilleValue.textContent = prom.toFixed(2) + '‰';
    promilleValue.style.color = color;
    promilleBarFill.style.width = pct + '%';
    if (prom < 1.5) promilleBarFill.style.background = `linear-gradient(90deg, #00ff88, ${color})`;
    else if (prom < 3.0) promilleBarFill.style.background = `linear-gradient(90deg, #00ff88, #ffd700, ${color})`;
    else promilleBarFill.style.background = `linear-gradient(90deg, #00ff88, #ffd700, #ff8800, ${color})`;
    if (prom >= 4.0) promilleBarFill.parentElement.classList.add('promille-blink');
    else promilleBarFill.parentElement.classList.remove('promille-blink');
  }

  function updateHPUI() {
    const p = getLocalServerPlayer();
    if (!p) return;
    const hp = Math.max(0, Math.round(p.hp));
    hpValue.textContent = hp;
    hpBarFill.style.width = hp + '%';
    if (hp > 60) { hpBarFill.style.background = '#00ff88'; hpValue.style.color = '#00ff88'; }
    else if (hp > 30) { hpBarFill.style.background = '#ffd700'; hpValue.style.color = '#ffd700'; }
    else { hpBarFill.style.background = '#ff0044'; hpValue.style.color = '#ff0044'; }
  }

  function updateBoostUI() {
    const p = getLocalServerPlayer();
    if (!p) return;
    if (p.boosting) {
      boostLabel.textContent = 'ACTIVE';
      boostLabel.style.color = '#ffd700';
      boostBarFill.style.background = 'linear-gradient(90deg, #ffd700, #ff8800)';
      boostBarFill.style.width = '100%';
    } else if (p.boostCooldownPct > 0) {
      boostLabel.textContent = 'COOLDOWN';
      boostLabel.style.color = '#ff4466';
      boostBarFill.style.background = '#ff4466';
      boostBarFill.style.width = ((1 - p.boostCooldownPct) * 100) + '%';
    } else {
      boostLabel.textContent = 'READY';
      boostLabel.style.color = '#00f0ff';
      boostBarFill.style.background = '#00f0ff';
      boostBarFill.style.width = '100%';
    }
  }

  function updateScoreUI() {
    const p = getLocalServerPlayer();
    if (!p) return;
    scoreValue.textContent = p.score;
  }

  function updateEffectBadgesUI() {
    const p = getLocalServerPlayer();
    if (!p) return;
    const effects = p.effects || [];
    let html = '';
    for (const e of effects) {
      const info = EFFECT_LABELS[e.type] || { label: e.type, icon: 'EFF', color: '#fff' };
      const secs = Math.ceil(e.remaining);
      html += `<div class="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9px] font-display font-bold tracking-wider pointer-events-none"
                    style="background: rgba(0,0,0,0.6); border: 1px solid ${info.color}44; color: ${info.color}; animation: badgePulse 1s ease-in-out infinite;">
                <span>${info.icon}</span><span>${info.label}</span><span class="opacity-70">${secs}s</span>
              </div>`;
    }
    effectBadges.innerHTML = html;
  }

  function updateLeaderboardUI(data) {
    let html = '';
    const formatTime = (secs) => {
      const m = Math.floor(secs / 60);
      const s = secs % 60;
      return `${m}:${s < 10 ? '0' : ''}${s}`;
    };
    for (let i = 0; i < data.length; i++) {
      const entry = data[i];
      const isLocal = entry.id === localId;
      const rankIcon = i === 0 ? '1ST' : (i + 1).toString();
      html += `<div class="flex items-center justify-between py-1 px-1 rounded ${isLocal ? 'bg-white/5' : ''}">
                 <div class="flex items-center gap-1 sm:gap-2">
                   <span class="text-[9px] sm:text-xs w-4 sm:w-5 text-center">${rankIcon}</span>
                   <span class="font-body text-[10px] sm:text-xs ${isLocal ? 'text-neon-cyan font-semibold' : 'text-gray-300'} truncate max-w-[50px] sm:max-w-[90px]">${entry.name}</span>
                 </div>
                 <span class="font-display text-[9px] sm:text-xs font-bold ${isLocal ? 'text-neon-cyan' : 'text-gray-400'}">${entry.score} pts | ${formatTime(entry.time)}</span>
               </div>`;
    }
    leaderboardList.innerHTML = html;
  }

  function showDeathScreenUI(data) {
    deathScreen.classList.remove('hidden');
    if (data.killerName) {
      deathKiller.textContent = `Eliminated by ${data.killerName}`;
    } else {
      const msgs = ['You crashed!', 'Total wipeout!', 'Too drunk to drive!', 'RIP your car!'];
      deathKiller.textContent = msgs[Math.floor(Math.random() * msgs.length)];
    }
    let t = Math.ceil(data.respawnTime || 3);
    deathTimer.textContent = t;
    if (deathTimerInterval) clearInterval(deathTimerInterval);
    deathTimerInterval = setInterval(() => {
      t--;
      deathTimer.textContent = Math.max(0, t);
      if (t <= 0) clearInterval(deathTimerInterval);
    }, 1000);
  }

  function hideDeathScreenUI() {
    deathScreen.classList.add('hidden');
    if (deathTimerInterval) clearInterval(deathTimerInterval);
  }

  // ─── CAR CUSTOMIZATION ─────────────────────────────────────
  function initCustomizer() {
    // Color swatches
    let html = '';
    for (const c of CAR_COLORS) {
      html += `<div class="color-swatch ${c === customColor ? 'selected' : ''}" data-color="${c}" style="background: ${c}; color: ${c};"></div>`;
    }
    colorSwatches.innerHTML = html;

    colorSwatches.addEventListener('click', (e) => {
      const swatch = e.target.closest('.color-swatch');
      if (!swatch) return;
      customColor = swatch.dataset.color;
      colorSwatches.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
      swatch.classList.add('selected');
      renderCarPreview();
    });

    // Style buttons
    document.querySelectorAll('.car-style-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        customStyle = btn.dataset.style;
        document.querySelectorAll('.car-style-btn').forEach(b => {
          b.classList.remove('selected');
          b.style.borderColor = '';
          b.style.color = '';
        });
        btn.classList.add('selected');
        btn.style.borderColor = 'rgba(0,240,255,0.5)';
        btn.style.color = '#00f0ff';
        renderCarPreview();
      });
    });

    // Glow slider
    glowSlider.addEventListener('input', () => {
      customGlow = parseInt(glowSlider.value);
      renderCarPreview();
    });

    // Panel toggle
    customizeBtn.addEventListener('click', () => {
      menuCard.classList.add('hidden');
      customizePanel.classList.remove('hidden');
      renderCarPreview();
    });
    customizeBack.addEventListener('click', () => {
      customizePanel.classList.add('hidden');
      menuCard.classList.remove('hidden');
    });

    // Set initial style button
    document.querySelector('.car-style-btn.selected').style.borderColor = 'rgba(0,240,255,0.5)';
    document.querySelector('.car-style-btn.selected').style.color = '#00f0ff';

    renderCarPreview();
  }

  function renderCarPreview() {
    const c = carPreviewCtx;
    const cw = carPreviewCanvas.width;
    const ch = carPreviewCanvas.height;
    c.clearRect(0, 0, cw, ch);
    c.fillStyle = 'rgba(6, 6, 16, 0.9)';
    c.fillRect(0, 0, cw, ch);
    // Grid lines
    c.strokeStyle = 'rgba(255,255,255,0.03)';
    c.lineWidth = 1;
    for (let x = 0; x < cw; x += 20) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, ch); c.stroke(); }
    for (let y = 0; y < ch; y += 20) { c.beginPath(); c.moveTo(0, y); c.lineTo(cw, y); c.stroke(); }

    const dims = getCarDims(customStyle);
    c.save();
    c.translate(cw / 2, ch / 2);
    drawVehicleShape(c, dims.w * 2, dims.h * 2, customColor, customGlow, false);
    c.restore();
  }

  // ─── NETWORKING ─────────────────────────────────────────────
  function connectSocket() {
    socket = io();

    socket.on('connect', () => {
      connected = true;
      console.log('[Socket] Connected:', socket.id);
    });

    socket.on('disconnect', () => {
      connected = false;
      playing = false;
      menuOverlay.classList.remove('hidden');
      menuCard.classList.remove('hidden');
      customizePanel.classList.add('hidden');
      gameHUD.classList.add('hidden');
    });

    socket.on('welcome', (data) => {
      localId = data.id;
      worldData = data.world;
      pillars = data.pillars;
      pits = data.pits;
      borderMargin = data.borderMargin;
      tickRate = data.tickRate;
      playing = true;
      menuOverlay.classList.add('hidden');
      gameHUD.classList.remove('hidden');
      hideDeathScreenUI();
      console.log('[Game] Joined as', localId);
    });

    socket.on('state', (data) => {
      serverPlayers = data.players;
      serverItems = data.items;
      if (data.collisions) {
        for (const c of data.collisions) spawnCollisionSparks(c.x, c.y);
      }
      for (const sp of serverPlayers) {
        if (!renderPlayers[sp.id]) {
          renderPlayers[sp.id] = { rx: sp.x, ry: sp.y, rAngle: sp.angle, ...sp };
        } else {
          Object.assign(renderPlayers[sp.id], sp);
        }
      }
      const activeIds = new Set(serverPlayers.map(p => p.id));
      for (const id of Object.keys(renderPlayers)) {
        if (!activeIds.has(id)) delete renderPlayers[id];
      }
    });

    socket.on('leaderboard', (data) => {
      leaderboard = data;
      updateLeaderboardUI(data);
    });

    socket.on('killed', (data) => showDeathScreenUI(data));
    socket.on('respawned', () => hideDeathScreenUI());

    socket.on('pickup', (data) => {
      const local = getLocalPlayer();
      if (local) {
        spawnPickupBurst(local.rx, local.ry, data.type === 'drink' ? '#ff00e5' : '#00ff88');
      }
    });
  }

  // ─── INPUT ──────────────────────────────────────────────────
  function setupInput() {
    window.addEventListener('keydown', (e) => {
      keys[e.code] = true;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => {
      keys[e.code] = false;
    });
    window.addEventListener('blur', () => {
      for (const k in keys) keys[k] = false;
    });
  }

  // ─── MOBILE TOUCH CONTROLS ─────────────────────────────────
  // ─── MOBILE TOUCH CONTROLS ─────────────────────────────────
  let joystick = null;

  function setupTouchControls() {
    if (isMobile && typeof nipplejs !== 'undefined') {
      joystick = nipplejs.create({
        zone: document.getElementById('joystickZone'),
        mode: 'dynamic',
        color: '#00f0ff',
        size: 100
      });

      joystick.on('move', (evt, data) => {
        touchKeys.moving = data.force > 0.15;
        touchKeys.targetAngle = -data.angle.radian;
      });
      joystick.on('end', () => {
        touchKeys.moving = false;
      });
    }

    const boostBtn = document.getElementById('touchBoost');
    if (boostBtn) {
      const press = (e) => { e.preventDefault(); touchKeys.boost = true; boostBtn.classList.add('pressed'); };
      const release = (e) => { e.preventDefault(); touchKeys.boost = false; boostBtn.classList.remove('pressed'); };
      boostBtn.addEventListener('touchstart', press, { passive: false });
      boostBtn.addEventListener('touchend', release, { passive: false });
      boostBtn.addEventListener('touchcancel', release);
    }
  }

  function sendInput() {
    if (!socket || !playing) return;
    const now = performance.now();
    if (now - lastInputSend < (1000 / tickRate) * 0.8) return;
    lastInputSend = now;

    let targetAngle = null;
    let moving = false;

    if (isMobile && touchKeys.moving) {
      moving = true;
      targetAngle = touchKeys.targetAngle;
    } else {
      let dx = 0; let dy = 0;
      if (keys['KeyW'] || keys['ArrowUp']) dy -= 1;
      if (keys['KeyS'] || keys['ArrowDown']) dy += 1;
      if (keys['KeyA'] || keys['ArrowLeft']) dx -= 1;
      if (keys['KeyD'] || keys['ArrowRight']) dx += 1;
      if (dx !== 0 || dy !== 0) {
        moving = true;
        targetAngle = Math.atan2(dy, dx);
      }
    }

    socket.emit('input', {
      targetAngle: targetAngle,
      moving: moving,
      boost: !!(keys['Space'] || touchKeys.boost)
    });
  }

  // ─── MENU ───────────────────────────────────────────────────
  function setupMenu() {
    const join = () => {
      if (!connected) return;
      const name = nicknameInput.value.trim() || 'Driver';
      socket.emit('join', { name, color: customColor, style: customStyle, glow: customGlow });
    };
    playBtn.addEventListener('click', join);
    nicknameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') join();
    });
    nicknameInput.focus();
  }

  // ─── MAIN RENDER LOOP ──────────────────────────────────────
  let lastFrame = 0;

  function gameLoop(timestamp) {
    requestAnimationFrame(gameLoop);
    const dt = Math.min((timestamp - lastFrame) / 1000, 0.05);
    lastFrame = timestamp;
    if (!playing) return;

    sendInput();

    // Smooth interpolation
    for (const id of Object.keys(renderPlayers)) {
      const rp = renderPlayers[id];
      const factor = id === localId ? LERP_LOCAL : LERP_REMOTE;
      rp.rx = lerp(rp.rx, rp.x, factor);
      rp.ry = lerp(rp.ry, rp.y, factor);
      rp.rAngle = lerpAngle(rp.rAngle, rp.angle, factor);
      if (rp.alive) spawnExhaust(rp);
    }

    updateCamera(dt);
    updateParticles(dt);

    // ── RENDER ──
    ctx.fillStyle = '#060610';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    drawGrid();
    drawPits();
    drawPillars();
    drawBorder();
    drawItems();
    drawParticles();

    const localServer = getLocalServerPlayer();
    const hasDoubleVision = localServer && localServer.effects && localServer.effects.some(e => e.type === 'DOUBLE_VISION');
    const hasTunnelVision = localServer && localServer.effects && localServer.effects.some(e => e.type === 'TUNNEL_VISION');

    if (hasDoubleVision) drawDoubleVision();

    for (const id of Object.keys(renderPlayers)) {
      drawVehicle(renderPlayers[id], id === localId);
    }

    drawKingPointer();

    if (hasTunnelVision) drawTunnelVision();

    // UI
    updatePromilleUI();
    updateHPUI();
    updateBoostUI();
    updateScoreUI();
    updateEffectBadgesUI();
  }

  // ─── INITIALIZATION ─────────────────────────────────────────
  function init() {
    connectSocket();
    setupInput();
    setupTouchControls();
    setupMenu();
    initCustomizer();
    requestAnimationFrame(gameLoop);
    console.log('Drunk Drivers.io — Client initialized');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
