import "./styles.css";

const QUALITY_TIERS = [
  { maxWidth: 380, columns: 24, rows: 38, backgroundParticles: 22, frameInterval: 50, lowPower: true },
  { maxWidth: 480, columns: 32, rows: 50, backgroundParticles: 34, frameInterval: 42, lowPower: true },
  { maxWidth: 640, columns: 42, rows: 66, backgroundParticles: 48, frameInterval: 34, lowPower: true },
  { maxWidth: 980, columns: 64, rows: 100, backgroundParticles: 92, frameInterval: 26, lowPower: false },
  { maxWidth: Infinity, columns: 80, rows: 125, backgroundParticles: 160, frameInterval: 16, lowPower: false },
];
const DAISY_VARIANT_COUNT = 8;
const DAISY_SPRITE_SIZE = 48;
const PHOTO_URL = `${import.meta.env.BASE_URL}portrait.jpeg`;

const canvas = document.querySelector("#particleCanvas");
const ctx = canvas.getContext("2d", { alpha: true });
const progressEl = document.querySelector("#progress");
const loadingEl = document.querySelector("#loading");
const replayButton = document.querySelector("#replayButton");
const scatterButton = document.querySelector("#scatterButton");

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const pointer = {
  x: 0,
  y: 0,
  active: false,
};
const interaction = {
  x: 0,
  y: 0,
  intensity: 0,
  radius: 96,
};

let image;
let particles = [];
let backgroundParticles = [];
let daisySprites = [];
let activeParticles = new Set();
let staticPhotoCanvas = null;
let dpr = 1;
let width = 0;
let height = 0;
let imageRect = { x: 0, y: 0, width: 0, height: 0 };
let gridColumns = 80;
let gridRows = 125;
let backgroundParticleTarget = 190;
let staticFrameInterval = 16;
let lowPowerMode = false;
let animationStart = 0;
let animationFrame = 0;
let animationTimer = 0;
let mode = "assemble";
let progress = 0;
let previousFrameTime = 0;

class BackgroundParticle {
  constructor(initial = false) {
    this.reset(initial);
  }

  reset(initial = false) {
    const lowerBand = Math.max(160, height * 0.32);
    this.x = Math.random() * width;
    this.y = initial
      ? height - Math.random() * (height + lowerBand)
      : height + Math.random() * lowerBand;
    this.startY = this.y;
    this.size = 1.1 + Math.random() * 2.8;
    this.trail = 18 + Math.random() * 48;
    this.speed = 0.08 + Math.random() * 0.28;
    this.life = initial ? Math.random() * 1 : 0;
    this.decay = 0.00008 + Math.random() * 0.00008;
    this.drift = Math.random() * Math.PI * 2;
    this.driftSpeed = 0.00055 + Math.random() * 0.00065;
    this.alpha = 0;
    this.red = 116 + Math.floor(Math.random() * 72);
    this.green = 18 + Math.floor(Math.random() * 20);
    this.blue = 32 + Math.floor(Math.random() * 26);
  }

  update(delta) {
    this.life += delta * this.decay;
    this.y -= this.speed * delta;
    this.x += Math.sin(this.life * 9 + this.drift) * this.driftSpeed * delta * 8;
    this.alpha = Math.sin(clamp(this.life, 0, 1) * Math.PI) * 0.78;

    if (this.life >= 1 || this.y < -this.trail * 2) {
      this.reset(false);
    }
  }

  draw(context) {
    if (this.alpha <= 0) {
      return;
    }

    if (lowPowerMode) {
      context.fillStyle = `rgba(${Math.min(this.red + 44, 255)}, ${this.green + 8}, ${this.blue + 8}, ${this.alpha * 0.82})`;
      context.beginPath();
      context.arc(this.x, this.y, this.size * 1.15, 0, Math.PI * 2);
      context.fill();
      return;
    }

    const trailGradient = context.createRadialGradient(
      this.x,
      this.y + this.trail * 0.48,
      0,
      this.x,
      this.y + this.trail * 0.48,
      this.trail,
    );
    trailGradient.addColorStop(0, `rgba(${this.red}, ${this.green}, ${this.blue}, ${this.alpha * 0.15})`);
    trailGradient.addColorStop(0.45, `rgba(${this.red}, ${this.green}, ${this.blue}, ${this.alpha * 0.07})`);
    trailGradient.addColorStop(1, `rgba(${this.red}, ${this.green}, ${this.blue}, 0)`);

    context.fillStyle = trailGradient;
    context.beginPath();
    context.ellipse(this.x, this.y + this.trail * 0.45, this.trail * 0.42, this.trail, 0, 0, Math.PI * 2);
    context.fill();

    context.save();
    context.shadowBlur = 14;
    context.shadowColor = `rgba(${this.red}, ${this.green}, ${this.blue}, ${this.alpha})`;
    context.fillStyle = `rgba(${Math.min(this.red + 40, 255)}, ${this.green + 8}, ${this.blue + 8}, ${this.alpha})`;
    context.beginPath();
    context.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }
}

class Particle {
  constructor(targetX, targetY, color, size, index, tile) {
    this.targetX = targetX;
    this.targetY = targetY;
    this.color = color;
    this.size = size;
    this.tile = tile;
    this.index = index;
    this.delay = Math.random() * 560 + (index % gridColumns) * 2.2;
    this.duration = 1500 + Math.random() * 920;
    this.drift = Math.random() * Math.PI * 2;
    this.offsetX = 0;
    this.offsetY = 0;
    this.velocityX = 0;
    this.velocityY = 0;
    this.drawX = targetX;
    this.drawY = targetY;
    this.isDisplaced = false;
    this.motionRaw = 0;
    this.spriteIndex = index % DAISY_VARIANT_COUNT;
    this.daisyScale = 0.76 + seededFraction(index, 2) * 0.36;
    this.setScatterSource(true);
  }

  setScatterSource(firstRun = false) {
    const edge = Math.floor(Math.random() * 4);
    const pad = Math.max(width, height) * 0.28;

    if (firstRun) {
      if (edge === 0) {
        this.sourceX = Math.random() * width;
        this.sourceY = -pad * Math.random();
      } else if (edge === 1) {
        this.sourceX = width + pad * Math.random();
        this.sourceY = Math.random() * height;
      } else if (edge === 2) {
        this.sourceX = Math.random() * width;
        this.sourceY = height + pad * Math.random();
      } else {
        this.sourceX = -pad * Math.random();
        this.sourceY = Math.random() * height;
      }
    } else {
      this.sourceX = this.x;
      this.sourceY = this.y;
    }

    const radius = Math.max(width, height) * (0.28 + Math.random() * 0.46);
    const angle = Math.atan2(this.targetY - height / 2, this.targetX - width / 2) + (Math.random() - 0.5) * 1.7;
    this.scatterX = width / 2 + Math.cos(angle) * radius + (Math.random() - 0.5) * width * 0.28;
    this.scatterY = height / 2 + Math.sin(angle) * radius + (Math.random() - 0.5) * height * 0.28;

    this.x = firstRun ? this.sourceX : this.x;
    this.y = firstRun ? this.sourceY : this.y;
  }

  setTargets(targetX, targetY, size, tile) {
    this.targetX = targetX;
    this.targetY = targetY;
    this.size = size;
    this.tile = tile;
  }

  resetInteractiveOffset() {
    this.offsetX = 0;
    this.offsetY = 0;
    this.velocityX = 0;
    this.velocityY = 0;
    this.drawX = this.x;
    this.drawY = this.y;
  }

  update(elapsed, currentMode) {
    const duration = prefersReducedMotion ? 1 : this.duration;
    const delay = prefersReducedMotion ? 0 : this.delay;
    const raw = clamp((elapsed - delay) / duration, 0, 1);
    const eased = easeOutQuint(raw);
    this.motionRaw = raw;

    let startX = this.sourceX;
    let startY = this.sourceY;
    let endX = this.targetX;
    let endY = this.targetY;

    if (currentMode === "scatter") {
      startX = this.sourceX;
      startY = this.sourceY;
      endX = this.scatterX;
      endY = this.scatterY;
    }

    const shimmerStrength = lowPowerMode ? 2.8 : 6.2;
    const shimmer = Math.sin(elapsed * 0.0015 + this.drift) * (1 - raw) * shimmerStrength;
    this.x = lerp(startX, endX, eased) + Math.cos(this.drift) * shimmer;
    this.y = lerp(startY, endY, eased) + Math.sin(this.drift) * shimmer;

    if (currentMode === "assemble") {
      if (this.isDisplaced || Math.abs(this.offsetX) > 0.02 || Math.abs(this.offsetY) > 0.02) {
        const returnEase = prefersReducedMotion ? 0.58 : lowPowerMode ? 0.22 : 0.18;
        const velocityDecay = prefersReducedMotion ? 0.18 : 0.32;
        this.offsetX = (this.offsetX + this.velocityX) * (1 - returnEase);
        this.offsetY = (this.offsetY + this.velocityY) * (1 - returnEase);
        this.velocityX *= velocityDecay;
        this.velocityY *= velocityDecay;
      }
    } else {
      this.offsetX *= 0.68;
      this.offsetY *= 0.68;
      this.velocityX *= 0.5;
      this.velocityY *= 0.5;
    }

    if (
      Math.abs(this.offsetX) < 0.02 &&
      Math.abs(this.offsetY) < 0.02 &&
      Math.abs(this.velocityX) < 0.02 &&
      Math.abs(this.velocityY) < 0.02
    ) {
      this.offsetX = 0;
      this.offsetY = 0;
      this.velocityX = 0;
      this.velocityY = 0;
    }

    this.drawX = this.x + this.offsetX;
    this.drawY = this.y + this.offsetY;
    this.isDisplaced =
      Math.abs(this.offsetX) > 0.02 ||
      Math.abs(this.offsetY) > 0.02 ||
      Math.abs(this.velocityX) > 0.02 ||
      Math.abs(this.velocityY) > 0.02;

    return {
      raw,
      displaced: this.isDisplaced,
    };
  }

  draw(context) {
    const displacement =
      Math.hypot(this.offsetX, this.offsetY) +
      Math.hypot(this.velocityX, this.velocityY) * 0.018;
    const disturbed = smoothstep(4, 30, displacement);
    let imageAlpha = 1;
    let daisyAlpha = 0;

    if (mode === "scatter") {
      imageAlpha = 1 - smoothstep(0.02, 0.24, this.motionRaw);
      daisyAlpha = smoothstep(0.08, 0.34, this.motionRaw);
    } else {
      const photoReveal = smoothstep(0.62, 0.98, this.motionRaw);
      const travelFlower = 1 - smoothstep(0.46, 0.9, this.motionRaw);
      daisyAlpha = Math.max(travelFlower, disturbed);
      imageAlpha = photoReveal * (1 - disturbed * 0.82);
    }

    if (lowPowerMode && mode === "assemble" && disturbed < 0.08) {
      imageAlpha = 0;
    }

    if (prefersReducedMotion) {
      imageAlpha = mode === "scatter" ? 0 : 1;
      daisyAlpha = mode === "scatter" ? 1 : 0;
    }

    if (this.tile && imageAlpha > 0.02) {
      context.globalAlpha = imageAlpha;
      context.drawImage(
        image,
        this.tile.sourceX,
        this.tile.sourceY,
        this.tile.sourceWidth,
        this.tile.sourceHeight,
        this.drawX - this.tile.width / 2,
        this.drawY - this.tile.height / 2,
        this.tile.width,
        this.tile.height,
      );
    }

    if (daisyAlpha > 0.02) {
      const sprite = daisySprites[this.spriteIndex];
      const daisySize = clamp(
        this.size * (1.62 + this.daisyScale * 0.72),
        5.4,
        width < 640 ? 12.4 : 15.8,
      );

      context.globalAlpha = daisyAlpha * 0.94;

      if (sprite) {
        context.drawImage(
          sprite,
          this.drawX - daisySize / 2,
          this.drawY - daisySize / 2,
          daisySize,
          daisySize,
        );
      } else {
        context.fillStyle = this.color;
        context.beginPath();
        context.arc(this.drawX, this.drawY, daisySize * 0.32, 0, Math.PI * 2);
        context.fill();
      }
    }

    context.globalAlpha = 1;
  }
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function lerp(start, end, amount) {
  return start + (end - start) * amount;
}

function easeOutQuint(value) {
  return 1 - Math.pow(1 - value, 5);
}

function smoothstep(edge0, edge1, value) {
  const x = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return x * x * (3 - 2 * x);
}

function seededFraction(index, salt = 0) {
  const value = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function createDaisySprites() {
  return Array.from({ length: DAISY_VARIANT_COUNT }, (_, variant) => {
    const sprite = document.createElement("canvas");
    const spriteCtx = sprite.getContext("2d");
    const center = DAISY_SPRITE_SIZE / 2;
    const petalCount = 7;
    const turn = (Math.PI * 2) / petalCount;

    sprite.width = DAISY_SPRITE_SIZE;
    sprite.height = DAISY_SPRITE_SIZE;
    spriteCtx.clearRect(0, 0, DAISY_SPRITE_SIZE, DAISY_SPRITE_SIZE);
    spriteCtx.translate(center, center);
    spriteCtx.rotate((variant / DAISY_VARIANT_COUNT) * Math.PI * 0.82);

    for (let i = 0; i < petalCount; i += 1) {
      spriteCtx.save();
      spriteCtx.rotate(i * turn);
      spriteCtx.fillStyle = i % 2 === 0 ? "rgba(255, 250, 235, 0.96)" : "rgba(248, 244, 232, 0.9)";
      spriteCtx.shadowBlur = 4;
      spriteCtx.shadowColor = "rgba(255, 239, 190, 0.42)";
      spriteCtx.beginPath();
      spriteCtx.ellipse(0, -11.2, 4.7, 10.5, 0, 0, Math.PI * 2);
      spriteCtx.fill();
      spriteCtx.restore();
    }

    spriteCtx.shadowBlur = 5;
    spriteCtx.shadowColor = "rgba(236, 187, 73, 0.56)";
    spriteCtx.fillStyle = "rgba(231, 176, 52, 0.98)";
    spriteCtx.beginPath();
    spriteCtx.arc(0, 0, 5.3, 0, Math.PI * 2);
    spriteCtx.fill();

    spriteCtx.fillStyle = "rgba(255, 226, 103, 0.92)";
    spriteCtx.beginPath();
    spriteCtx.arc(-1.5, -1.6, 1.7, 0, Math.PI * 2);
    spriteCtx.fill();

    return sprite;
  });
}

function selectQualityTier() {
  const viewportWidth = Math.min(window.innerWidth || 0, window.screen?.width || window.innerWidth || 0) || window.innerWidth;
  const lowCpu = navigator.hardwareConcurrency ? navigator.hardwareConcurrency <= 2 : false;
  const lowMemory = navigator.deviceMemory ? navigator.deviceMemory <= 1 : false;

  if (lowCpu || lowMemory) {
    return QUALITY_TIERS[0];
  }

  return QUALITY_TIERS.find((tier) => viewportWidth <= tier.maxWidth) ?? QUALITY_TIERS[QUALITY_TIERS.length - 1];
}

function applyQualityTier() {
  const tier = selectQualityTier();
  const changed = gridColumns !== tier.columns || gridRows !== tier.rows;
  gridColumns = tier.columns;
  gridRows = tier.rows;
  backgroundParticleTarget = tier.backgroundParticles;
  staticFrameInterval = tier.frameInterval;
  lowPowerMode = tier.lowPower;
  canvas.dataset.grid = `${gridColumns}x${gridRows}`;
  canvas.dataset.lowPower = String(lowPowerMode);
  canvas.dataset.backgroundParticles = String(backgroundParticleTarget);
  return changed;
}

function getInteractionRadius() {
  if (lowPowerMode) {
    return width < 420 ? 32 : 40;
  }

  return width < 640 ? 58 : 74;
}

function rebuildBackgroundParticles() {
  backgroundParticles = Array.from(
    { length: backgroundParticleTarget },
    () => new BackgroundParticle(true),
  );
}

function drawBackgroundParticles(delta) {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";

  for (const particle of backgroundParticles) {
    particle.update(delta);
    particle.draw(ctx);
  }

  ctx.restore();
}

function calculateImageRect() {
  const safeTop = width < 640 ? 56 : 42;
  const safeBottom = width < 640 ? 86 : 54;
  const sidePadding = width < 640
    ? clamp(width * 0.035, 10, 18)
    : clamp(width * 0.045, 18, 58);
  const maxWidth = width - sidePadding * 2;
  const maxHeight = height - safeTop - safeBottom;
  const imageRatio = image.naturalWidth / image.naturalHeight;

  let rectWidth = Math.min(maxWidth, width < 640 ? maxWidth : 840);
  let rectHeight = rectWidth / imageRatio;

  if (rectHeight > maxHeight) {
    rectHeight = maxHeight;
    rectWidth = rectHeight * imageRatio;
  }

  return {
    x: (width - rectWidth) / 2,
    y: safeTop + (maxHeight - rectHeight) / 2,
    width: rectWidth,
    height: rectHeight,
  };
}

function rebuildStaticPhotoCanvas() {
  if (!image || imageRect.width <= 0 || imageRect.height <= 0) {
    staticPhotoCanvas = null;
    return;
  }

  staticPhotoCanvas = document.createElement("canvas");
  staticPhotoCanvas.width = Math.max(1, Math.floor(imageRect.width * dpr));
  staticPhotoCanvas.height = Math.max(1, Math.floor(imageRect.height * dpr));

  const staticCtx = staticPhotoCanvas.getContext("2d", { alpha: true });
  staticCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  staticCtx.imageSmoothingEnabled = true;
  staticCtx.imageSmoothingQuality = "high";
  staticCtx.drawImage(image, 0, 0, imageRect.width, imageRect.height);
}

function drawStaticPhoto(alpha = 1) {
  if (!staticPhotoCanvas || alpha <= 0) {
    return;
  }

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(staticPhotoCanvas, imageRect.x, imageRect.y, imageRect.width, imageRect.height);
  ctx.restore();
}

function eraseStaticParticleHoles(particleList) {
  if (!staticPhotoCanvas || !particleList.length) {
    return;
  }

  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = "#000";

  for (const particle of particleList) {
    const displacement =
      Math.hypot(particle.offsetX, particle.offsetY) +
      Math.hypot(particle.velocityX, particle.velocityY) * 0.018;
    const strength = smoothstep(2, lowPowerMode ? 18 : 26, displacement);

    if (strength <= 0.01) {
      continue;
    }

    const tileWidth = particle.tile?.width ?? particle.size;
    const tileHeight = particle.tile?.height ?? particle.size;
    const scale = lowPowerMode ? 0.92 : 1.2;
    const holeWidth = Math.max(tileWidth * scale, particle.size * 1.12);
    const holeHeight = Math.max(tileHeight * scale, particle.size * 1.12);

    ctx.globalAlpha = lowPowerMode
      ? 0.04 + strength * 0.24
      : 0.1 + strength * 0.58;
    ctx.fillRect(
      particle.targetX - holeWidth / 2,
      particle.targetY - holeHeight / 2,
      holeWidth,
      holeHeight,
    );
  }

  ctx.restore();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
}

function resizeCanvas() {
  width = window.innerWidth;
  height = window.innerHeight;
  const qualityChanged = applyQualityTier();
  dpr = lowPowerMode ? 1 : Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  rebuildBackgroundParticles();

  if (image) {
    rebuildParticles(qualityChanged);
  }
}

function sampleImageColors() {
  const source = document.createElement("canvas");
  const sourceCtx = source.getContext("2d", { willReadFrequently: true });
  source.width = gridColumns;
  source.height = gridRows;
  sourceCtx.drawImage(image, 0, 0, source.width, source.height);
  return sourceCtx.getImageData(0, 0, source.width, source.height).data;
}

function rebuildParticles(resetAnimation = true) {
  imageRect = calculateImageRect();
  rebuildStaticPhotoCanvas();
  const colors = sampleImageColors();
  const cellWidth = imageRect.width / gridColumns;
  const cellHeight = imageRect.height / gridRows;
  const sourceCellWidth = image.naturalWidth / gridColumns;
  const sourceCellHeight = image.naturalHeight / gridRows;
  const particleSize = clamp(Math.max(cellWidth, cellHeight) * 1.04, 1.8, 7.6);
  const nextParticles = [];

  for (let y = 0; y < gridRows; y += 1) {
    for (let x = 0; x < gridColumns; x += 1) {
      const index = y * gridColumns + x;
      const colorIndex = index * 4;
      const alpha = colors[colorIndex + 3] / 255;
      const red = colors[colorIndex];
      const green = colors[colorIndex + 1];
      const blue = colors[colorIndex + 2];
      const luminance = (red + green + blue) / 3;
      const targetX = imageRect.x + x * cellWidth + cellWidth * 0.5;
      const targetY = imageRect.y + y * cellHeight + cellHeight * 0.5;
      const size = particleSize * (0.92 + (luminance / 255) * 0.14);
      const color = `rgba(${red}, ${green}, ${blue}, ${Math.max(alpha, 0.78)})`;
      const tile = {
        sourceX: x * sourceCellWidth,
        sourceY: y * sourceCellHeight,
        sourceWidth: sourceCellWidth,
        sourceHeight: sourceCellHeight,
        width: cellWidth + 1.2,
        height: cellHeight + 1.2,
      };
      const previous = particles[index];

      if (previous && !resetAnimation) {
        previous.setTargets(targetX, targetY, size, tile);
        nextParticles.push(previous);
      } else {
        nextParticles.push(new Particle(targetX, targetY, color, size, index, tile));
      }
    }
  }

  particles = nextParticles;
  activeParticles.clear();

  if (resetAnimation) {
    startAnimation("assemble", true);
  }
}

function startAnimation(nextMode, firstRun = false) {
  mode = nextMode;
  progress = 0;
  animationStart = performance.now();
  previousFrameTime = 0;
  interaction.intensity = 0;
  activeParticles.clear();

  particles.forEach((particle) => {
    if (firstRun) {
      particle.resetInteractiveOffset();
      particle.setScatterSource(true);
    } else {
      particle.sourceX = particle.drawX ?? particle.x;
      particle.sourceY = particle.drawY ?? particle.y;
      particle.resetInteractiveOffset();
      particle.setScatterSource(false);
      particle.delay = Math.random() * 360 + (particle.index % gridColumns) * 1.5;
      particle.duration = 1200 + Math.random() * 760;
    }
  });

  cancelAnimationFrame(animationFrame);
  clearTimeout(animationTimer);
  animationFrame = 0;
  animationTimer = 0;
  requestDraw();
}

function drawPhotoGuide() {
  ctx.save();
  ctx.globalAlpha = 0.08;
  ctx.strokeStyle = "rgba(248, 243, 232, 0.52)";
  ctx.lineWidth = 1;
  ctx.strokeRect(imageRect.x - 8, imageRect.y - 8, imageRect.width + 16, imageRect.height + 16);
  ctx.restore();
}

function disturbParticles(x, y, power = 1) {
  if (!particles.length || mode !== "assemble" || progress < 0.62) {
    return;
  }

  interaction.x = x;
  interaction.y = y;
  interaction.radius = getInteractionRadius();
  interaction.intensity = Math.min(1, interaction.intensity + 0.68 * power);

  const radius = interaction.radius;
  const radiusSq = radius * radius;
  const baseStrength = lowPowerMode ? 30 : width < 640 ? 40 : 54;
  const cellWidth = imageRect.width / gridColumns;
  const cellHeight = imageRect.height / gridRows;
  const minGridX = clamp(Math.floor((x - radius - imageRect.x) / cellWidth), 0, gridColumns - 1);
  const maxGridX = clamp(Math.ceil((x + radius - imageRect.x) / cellWidth), 0, gridColumns - 1);
  const minGridY = clamp(Math.floor((y - radius - imageRect.y) / cellHeight), 0, gridRows - 1);
  const maxGridY = clamp(Math.ceil((y + radius - imageRect.y) / cellHeight), 0, gridRows - 1);

  for (let gridY = minGridY; gridY <= maxGridY; gridY += 1) {
    for (let gridX = minGridX; gridX <= maxGridX; gridX += 1) {
      const particle = particles[gridY * gridColumns + gridX];

      if (!particle) {
        continue;
      }

      const particleX = particle.drawX ?? particle.x;
      const particleY = particle.drawY ?? particle.y;
      const dx = particleX - x;
      const dy = particleY - y;
      const distanceSq = dx * dx + dy * dy;

      if (distanceSq >= radiusSq || distanceSq < 0.001) {
        continue;
      }

      const distance = Math.sqrt(distanceSq);
      const falloff = Math.pow(1 - distance / radius, 1.7);
      const angle = Math.atan2(dy, dx) + (Math.random() - 0.5) * 0.34;
      const force = (baseStrength + Math.random() * (lowPowerMode ? 22 : 38)) * falloff * power;

      particle.velocityX += Math.cos(angle) * force;
      particle.velocityY += Math.sin(angle) * force;
      particle.offsetX += Math.cos(angle) * falloff * (lowPowerMode ? 6 : 8);
      particle.offsetY += Math.sin(angle) * falloff * (lowPowerMode ? 6 : 8);
      activeParticles.add(particle);
    }
  }

  requestDraw();
}

function fadeInteraction() {
  if (interaction.intensity <= 0) {
    return;
  }

  interaction.intensity *= pointer.active ? 0.96 : 0.9;

  if (interaction.intensity < 0.015) {
    interaction.intensity = 0;
  }
}

function tick(now) {
  animationFrame = 0;
  const delta = previousFrameTime ? Math.min(now - previousFrameTime, 48) : 16;
  previousFrameTime = now;
  const elapsed = now - animationStart;
  let total = 0;
  let hasActiveDisplacement = false;
  const shouldDrawAllParticles = mode !== "assemble" || progress < 0.999;

  ctx.clearRect(0, 0, width, height);
  drawBackgroundParticles(delta);
  if (!lowPowerMode) {
    drawPhotoGuide();
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  if (mode === "assemble") {
    if (shouldDrawAllParticles) {
      if (lowPowerMode) {
        drawStaticPhoto(smoothstep(0.38, 0.92, progress));
      }
    } else {
      drawStaticPhoto(1);
    }
  }

  if (shouldDrawAllParticles) {
    for (const particle of particles) {
      const particleState = particle.update(elapsed, mode);
      total += particleState.raw;
      hasActiveDisplacement = hasActiveDisplacement || particleState.displaced;
      particle.draw(ctx);
    }

    progress = clamp(total / particles.length, 0, 1);
  } else {
    const activeSnapshot = Array.from(activeParticles);
    const particlesToDraw = [];

    for (const particle of activeSnapshot) {
      const particleState = particle.update(elapsed, mode);
      hasActiveDisplacement = hasActiveDisplacement || particleState.displaced;

      if (particleState.displaced) {
        particlesToDraw.push(particle);
      } else {
        activeParticles.delete(particle);
      }
    }

    eraseStaticParticleHoles(particlesToDraw);

    for (const particle of particlesToDraw) {
      particle.draw(ctx);
    }
  }

  fadeInteraction();
  progressEl.style.transform = `scaleX(${progress})`;
  ctx.globalAlpha = 1;

  if (progress < 0.999 || hasActiveDisplacement || interaction.intensity > 0.02 || backgroundParticles.length) {
    requestDraw();
  }
}

function requestDraw() {
  if (animationFrame || animationTimer) {
    return;
  }

  if (staticFrameInterval > 18) {
    animationTimer = window.setTimeout(() => {
      animationTimer = 0;
      animationFrame = requestAnimationFrame(tick);
    }, staticFrameInterval);
  } else {
    animationFrame = requestAnimationFrame(tick);
  }
}

function attachEvents() {
  replayButton.addEventListener("click", () => {
    startAnimation("assemble", true);
  });

  scatterButton.addEventListener("click", () => {
    if (mode === "scatter") {
      startAnimation("assemble");
    } else {
      startAnimation("scatter");
    }
  });

  window.addEventListener("resize", resizeCanvas);

  canvas.addEventListener("pointerdown", (event) => {
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    pointer.active = true;
    canvas.setPointerCapture?.(event.pointerId);
    disturbParticles(pointer.x, pointer.y, 1.15);
    requestDraw();
  });

  canvas.addEventListener("pointermove", (event) => {
    const dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;
    const travel = Math.sqrt(dx * dx + dy * dy);
    const isTouchDrag = event.pointerType !== "mouse" && pointer.active;
    const shouldDisturb = event.pointerType === "mouse" || event.buttons > 0 || isTouchDrag;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    pointer.active = event.pointerType === "mouse" || event.buttons > 0 || isTouchDrag;

    if (shouldDisturb) {
      disturbParticles(pointer.x, pointer.y, clamp(travel / 16, 0.8, 2.2));
    }
  });

  canvas.addEventListener("pointerup", (event) => {
    pointer.active = false;
    canvas.releasePointerCapture?.(event.pointerId);
    requestDraw();
  });

  canvas.addEventListener("pointercancel", () => {
    pointer.active = false;
    requestDraw();
  });

  canvas.addEventListener("pointerleave", () => {
    pointer.active = false;
    requestDraw();
  });
}

async function loadImage() {
  image = new Image();
  image.decoding = "async";
  image.src = PHOTO_URL;

  await new Promise((resolve, reject) => {
    image.addEventListener("load", resolve, { once: true });
    image.addEventListener("error", reject, { once: true });
  });

  if (image.decode) {
    await image.decode().catch(() => {});
  }
}

async function init() {
  attachEvents();
  daisySprites = createDaisySprites();
  resizeCanvas();

  try {
    await loadImage();
    resizeCanvas();
    rebuildParticles(true);
    loadingEl.classList.add("is-hidden");
  } catch (error) {
    loadingEl.textContent = "Fotoğraf yüklenemedi";
    console.error(error);
  }
}

init();
