import "./styles.css";

const PARTICLE_COUNT = 10000;
const GRID_COLUMNS = 80;
const GRID_ROWS = PARTICLE_COUNT / GRID_COLUMNS;
const BACKGROUND_PARTICLE_COUNT = 190;
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
let dpr = 1;
let width = 0;
let height = 0;
let imageRect = { x: 0, y: 0, width: 0, height: 0 };
let animationStart = 0;
let animationFrame = 0;
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
    this.delay = Math.random() * 560 + (index % GRID_COLUMNS) * 2.2;
    this.duration = 1500 + Math.random() * 920;
    this.drift = Math.random() * Math.PI * 2;
    this.offsetX = 0;
    this.offsetY = 0;
    this.velocityX = 0;
    this.velocityY = 0;
    this.drawX = targetX;
    this.drawY = targetY;
    this.isDisplaced = false;
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

    const shimmer = Math.sin(elapsed * 0.0024 + this.drift) * (1 - raw) * 18;
    this.x = lerp(startX, endX, eased) + Math.cos(this.drift) * shimmer;
    this.y = lerp(startY, endY, eased) + Math.sin(this.drift) * shimmer;

    if (currentMode === "assemble") {
      const spring = prefersReducedMotion ? 0.36 : 0.055;
      const damping = prefersReducedMotion ? 0.52 : 0.89;
      this.velocityX += -this.offsetX * spring;
      this.velocityY += -this.offsetY * spring;
      this.velocityX *= damping;
      this.velocityY *= damping;
      this.offsetX += this.velocityX;
      this.offsetY += this.velocityY;
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
    context.globalAlpha = 1;

    if (this.tile) {
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
      return;
    }

    context.fillStyle = this.color;
    const half = this.size / 2;
    context.fillRect(this.drawX - half, this.drawY - half, this.size, this.size);
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

function getInteractionRadius() {
  return width < 640 ? 58 : 74;
}

function rebuildBackgroundParticles() {
  backgroundParticles = Array.from(
    { length: BACKGROUND_PARTICLE_COUNT },
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
  const safeTop = width < 640 ? 86 : 84;
  const safeBottom = width < 640 ? 118 : 92;
  const sidePadding = clamp(width * 0.08, 22, 86);
  const maxWidth = width - sidePadding * 2;
  const maxHeight = height - safeTop - safeBottom;
  const imageRatio = image.naturalWidth / image.naturalHeight;

  let rectWidth = Math.min(maxWidth, 720);
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

function resizeCanvas() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  width = window.innerWidth;
  height = window.innerHeight;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  rebuildBackgroundParticles();

  if (image) {
    rebuildParticles(false);
  }
}

function sampleImageColors() {
  const source = document.createElement("canvas");
  const sourceCtx = source.getContext("2d", { willReadFrequently: true });
  source.width = GRID_COLUMNS;
  source.height = GRID_ROWS;
  sourceCtx.drawImage(image, 0, 0, source.width, source.height);
  return sourceCtx.getImageData(0, 0, source.width, source.height).data;
}

function rebuildParticles(resetAnimation = true) {
  imageRect = calculateImageRect();
  const colors = sampleImageColors();
  const cellWidth = imageRect.width / GRID_COLUMNS;
  const cellHeight = imageRect.height / GRID_ROWS;
  const sourceCellWidth = image.naturalWidth / GRID_COLUMNS;
  const sourceCellHeight = image.naturalHeight / GRID_ROWS;
  const particleSize = clamp(Math.max(cellWidth, cellHeight) * 1.04, 1.8, 7.6);
  const nextParticles = [];

  for (let y = 0; y < GRID_ROWS; y += 1) {
    for (let x = 0; x < GRID_COLUMNS; x += 1) {
      const index = y * GRID_COLUMNS + x;
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

  if (resetAnimation) {
    startAnimation("assemble", true);
  }
}

function startAnimation(nextMode, firstRun = false) {
  mode = nextMode;
  progress = 0;
  animationStart = performance.now();
  interaction.intensity = 0;

  particles.forEach((particle) => {
    if (firstRun) {
      particle.resetInteractiveOffset();
      particle.setScatterSource(true);
    } else {
      particle.sourceX = particle.drawX ?? particle.x;
      particle.sourceY = particle.drawY ?? particle.y;
      particle.resetInteractiveOffset();
      particle.setScatterSource(false);
      particle.delay = Math.random() * 360 + (particle.index % GRID_COLUMNS) * 1.5;
      particle.duration = 1200 + Math.random() * 760;
    }
  });

  cancelAnimationFrame(animationFrame);
  animationFrame = 0;
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
  const baseStrength = width < 640 ? 40 : 54;

  for (const particle of particles) {
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
    const force = (baseStrength + Math.random() * 38) * falloff * power;

    particle.velocityX += Math.cos(angle) * force;
    particle.velocityY += Math.sin(angle) * force;
    particle.offsetX += Math.cos(angle) * falloff * 8;
    particle.offsetY += Math.sin(angle) * falloff * 8;
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

  ctx.clearRect(0, 0, width, height);
  drawBackgroundParticles(delta);
  drawPhotoGuide();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  for (const particle of particles) {
    const particleState = particle.update(elapsed, mode);
    total += particleState.raw;
    hasActiveDisplacement = hasActiveDisplacement || particleState.displaced;
    particle.draw(ctx);
  }

  progress = clamp(total / particles.length, 0, 1);
  fadeInteraction();
  progressEl.style.transform = `scaleX(${progress})`;
  ctx.globalAlpha = 1;

  if (progress < 0.999 || hasActiveDisplacement || interaction.intensity > 0.02 || backgroundParticles.length) {
    requestDraw();
  }
}

function requestDraw() {
  if (!animationFrame) {
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
