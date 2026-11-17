import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { dicebearDataUri, randomBotColor } from '../lib/bot-theme';
import { HANDWRITING, traceHandwriting, type Handwriting } from '../lib/handwriting';
import { randomId } from '../lib/random';

type Body = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  targetR: number;
  color: string;
  image: HTMLImageElement;
  targetX: number;
  targetY: number;
  phase: number;
  entered: boolean;
};

type WordLayout = {
  word: Handwriting;
  left: number;
  top: number;
  scale: number;
};

const TAU = Math.PI * 2;
const WELCOME_START = 2.0;
const WELCOME_DURATION = 2.4;
const WELCOME_FADE = 5.2;
const DUDU_START = 5.45;
const DUDU_DURATION = 1.8;
const CONTINUE_AT = 7.8;

function mapWord(word: Handwriting, targetWidth: number, targetHeight: number, centerX: number, centerY: number): WordLayout {
  const { width, height } = word.bounds;
  const scale = Math.min(targetWidth / width, targetHeight / height);
  return { word, left: centerX - width * scale / 2, top: centerY - height * scale / 2, scale };
}

export default function SetupWelcome({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const underlayRef = useRef<HTMLCanvasElement>(null);
  const doneRef = useRef(onDone);
  const leaveTimer = useRef<number | undefined>(undefined);
  const continueShown = useRef(false);
  const [reduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [continueVisible, setContinueVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);

  doneRef.current = onDone;

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, []);

  useEffect(() => {
    if (!reduced) return;
    const show = window.setTimeout(() => setContinueVisible(true), 1200);
    return () => window.clearTimeout(show);
  }, [reduced]);

  useEffect(() => {
    if (reduced) return;
    const host = hostRef.current;
    const canvas = canvasRef.current;
    const underlay = underlayRef.current;
    if (!host || !canvas || !underlay) return;
    const context = canvas.getContext('2d');
    const colors = underlay.getContext('2d');
    if (!context || !colors) return;

    let width = host.clientWidth;
    let height = host.clientHeight;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const glyph = document.createElement('canvas');
    const glyphContext = glyph.getContext('2d');
    if (!glyphContext) return;
    const resizeLayers = () => {
      for (const layer of [canvas, underlay, glyph]) {
        layer.width = Math.round(width * ratio);
        layer.height = Math.round(height * ratio);
        if (layer === canvas || layer === underlay) {
          layer.style.width = `${width}px`;
          layer.style.height = `${height}px`;
        }
      }
      for (const layer of [context, colors, glyphContext]) layer.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    resizeLayers();

    const maxRadius = Math.max(18, Math.min(90, Math.sqrt((width * height) / 880)));
    const gap = Math.max(1.5, maxRadius * 0.04);
    const cell = maxRadius * 2 + gap;
    const columns = Math.max(3, Math.ceil(width / cell));
    const rows = Math.max(3, Math.ceil(height / cell));
    const count = Math.min(320, columns * rows);
    const offsetX = (width - (columns - 1) * cell) / 2;
    const offsetY = (height - (rows - 1) * cell) / 2;
    const centerX = width / 2;
    const centerY = height / 2;
    const pool = Array.from({ length: 64 }, () => {
      const image = new Image();
      image.src = dicebearDataUri(randomId().slice(0, 10), 96);
      return image;
    });
    const bodies: Body[] = [];

    for (let index = 0; index < count; index++) {
      const angle = Math.random() * TAU;
      const distance = Math.max(width, height) * (0.82 + Math.random() * 0.48);
      const speed = 1700 + Math.random() * 1100;
      const targetR = maxRadius * (0.84 + Math.random() * 0.16);
      bodies.push({
        x: centerX + Math.cos(angle) * distance,
        y: centerY + Math.sin(angle) * distance,
        vx: -Math.cos(angle) * speed + (Math.random() - 0.5) * 360,
        vy: -Math.sin(angle) * speed + (Math.random() - 0.5) * 360,
        r: targetR * (0.14 + Math.random() * 0.06),
        targetR,
        color: randomBotColor().background,
        image: pool[index % pool.length]!,
        targetX: offsetX + (index % columns) * cell,
        targetY: offsetY + Math.floor(index / columns) * cell,
        phase: Math.random() * TAU,
        entered: false,
      });
    }

    let welcome = mapWord(HANDWRITING.welcome, width * 0.72, height * 0.34, width / 2, height / 2);
    let dudu = mapWord(HANDWRITING.dudu, width * (width <= 640 ? 0.66 : 0.46), height * 0.34, width / 2, height / 2);
    const observer = new ResizeObserver(() => {
      const nextWidth = host.clientWidth;
      const nextHeight = host.clientHeight;
      if (nextWidth === width && nextHeight === height) return;
      for (const body of bodies) {
        body.x *= nextWidth / width;
        body.y *= nextHeight / height;
        body.targetX *= nextWidth / width;
        body.targetY *= nextHeight / height;
        body.r *= Math.min(nextWidth / width, nextHeight / height);
        body.targetR *= Math.min(nextWidth / width, nextHeight / height);
      }
      width = nextWidth;
      height = nextHeight;
      resizeLayers();
      welcome = mapWord(HANDWRITING.welcome, width * 0.72, height * 0.34, width / 2, height / 2);
      dudu = mapWord(HANDWRITING.dudu, width * (width <= 640 ? 0.66 : 0.46), height * 0.34, width / 2, height / 2);
    });
    observer.observe(host);

    const paintWord = (layout: WordLayout, progress: number, alpha: number) => {
      if (progress <= 0 || alpha <= 0) return;
      glyphContext.clearRect(0, 0, width, height);
      const gradient = colors.createLinearGradient(layout.left, 0, layout.left + layout.word.bounds.width * layout.scale, 0);
      gradient.addColorStop(0, '#ff6b8a');
      gradient.addColorStop(0.22, '#ffb35c');
      gradient.addColorStop(0.44, '#f5e663');
      gradient.addColorStop(0.66, '#62d9a0');
      gradient.addColorStop(0.84, '#5bbcff');
      gradient.addColorStop(1, '#b59bff');
      const strokes = traceHandwriting(layout.word, progress);
      for (const target of [glyphContext, colors]) {
        target.save();
        target.globalAlpha = target === glyphContext ? 1 : alpha;
        target.strokeStyle = target === glyphContext ? '#fff' : gradient;
        target.translate(layout.left, layout.top);
        target.scale(layout.scale, layout.scale);
        target.translate(-layout.word.bounds.x, -layout.word.bounds.y);
        target.lineWidth = layout.word.pen;
        target.lineCap = 'round';
        target.lineJoin = 'round';
        target.beginPath();
        for (const points of strokes) {
          target.moveTo(points[0]!.x, points[0]!.y);
          for (let index = 1; index < points.length; index++) target.lineTo(points[index]!.x, points[index]!.y);
        }
        target.stroke();
        target.restore();
      }
      context.save();
      context.globalCompositeOperation = 'destination-out';
      context.globalAlpha = alpha;
      context.drawImage(glyph, 0, 0, width, height);
      context.restore();
    };

    let frame = 0;
    let last = performance.now();
    const started = last;

    const drawBody = (body: Body, time: number) => {
      if (body.x + body.r < 0 || body.x - body.r > width || body.y + body.r < 0 || body.y - body.r > height) return;
      context.save();
      context.translate(body.x, body.y);
      context.rotate(Math.sin(time * 0.85 + body.phase) * 0.035);
      context.beginPath();
      context.arc(0, 0, body.r, 0, TAU);
      context.closePath();
      context.clip();
      context.fillStyle = body.color;
      context.fillRect(-body.r, -body.r, body.r * 2, body.r * 2);
      if (body.image.complete && body.image.naturalWidth) {
        context.drawImage(body.image, -body.r, -body.r, body.r * 2, body.r * 2);
      }
      context.restore();
      context.beginPath();
      context.arc(body.x, body.y, body.r - 0.5, 0, TAU);
      context.strokeStyle = 'rgb(255 255 255 / 0.14)';
      context.lineWidth = 1;
      context.stroke();
    };

    const tick = (now: number) => {
      const dt = Math.min(0.08, Math.max(0.001, (now - last) / 1000));
      last = now;
      const time = (now - started) / 1000;
      if (time > CONTINUE_AT && !continueShown.current) {
        continueShown.current = true;
        setContinueVisible(true);
      }

      const fill = time > 1.5;
      const growth = Math.min(1, time / 1.3);
      const grown = 0.14 + 0.86 * (1 - Math.pow(1 - growth, 3));
      const damping = Math.pow(0.16, dt);

      for (const body of bodies) {
        body.r += (body.targetR * grown - body.r) * Math.min(1, dt * 5);
        if (fill) {
          body.entered = true;
          body.vx *= damping;
          body.vy *= damping;
          body.x += (body.targetX - body.x) * Math.min(1, dt * 6);
          body.y += (body.targetY - body.y) * Math.min(1, dt * 6);
        } else {
          body.x += body.vx * dt;
          body.y += body.vy * dt;
          if (body.x > 0 && body.x < width && body.y > 0 && body.y < height) body.entered = true;
        }
        if (body.entered) {
          if (body.x < body.r) { body.x = body.r; body.vx = Math.abs(body.vx) * 0.88; }
          else if (body.x > width - body.r) { body.x = width - body.r; body.vx = -Math.abs(body.vx) * 0.88; }
          if (body.y < body.r) { body.y = body.r; body.vy = Math.abs(body.vy) * 0.88; }
          else if (body.y > height - body.r) { body.y = height - body.r; body.vy = -Math.abs(body.vy) * 0.88; }
        }
      }

      for (let pass = 0; pass < 6; pass++) {
        for (let a = 0; a < bodies.length; a++) {
          const one = bodies[a]!;
          for (let b = a + 1; b < bodies.length; b++) {
            const two = bodies[b]!;
            let dx = two.x - one.x;
            let dy = two.y - one.y;
            const min = one.r + two.r;
            if (Math.abs(dx) > min || Math.abs(dy) > min) continue;
            let distance = Math.hypot(dx, dy);
            if (distance >= min) continue;
            if (distance < 0.001) { dx = 0.01; dy = 0; distance = 0.01; }
            const nx = dx / distance;
            const ny = dy / distance;
            const overlap = min - distance;
            one.x -= nx * overlap * 0.5;
            one.y -= ny * overlap * 0.5;
            two.x += nx * overlap * 0.5;
            two.y += ny * overlap * 0.5;
            if (!fill && pass === 0) {
              const relative = (two.vx - one.vx) * nx + (two.vy - one.vy) * ny;
              if (relative < 0) {
                const impulse = -(1.06 * relative) / 2;
                one.vx -= impulse * nx;
                one.vy -= impulse * ny;
                two.vx += impulse * nx;
                two.vy += impulse * ny;
              }
            }
          }
        }
      }

      context.clearRect(0, 0, width, height);
      colors.clearRect(0, 0, width, height);
      for (const body of bodies) drawBody(body, time);

      const welcomeProgress = Math.min(1, Math.max(0, (time - WELCOME_START) / WELCOME_DURATION));
      const welcomeAlpha = time > WELCOME_FADE ? Math.max(0, 1 - (time - WELCOME_FADE) / 0.2) : 1;
      if (welcomeProgress > 0 && welcomeAlpha > 0) paintWord(welcome, welcomeProgress, welcomeAlpha);
      const duduProgress = Math.min(1, Math.max(0, (time - DUDU_START) / DUDU_DURATION));
      if (duduProgress > 0) paintWord(dudu, duduProgress, 1);

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [reduced]);

  const leave = () => {
    if (leaveTimer.current) return;
    setLeaving(true);
    leaveTimer.current = window.setTimeout(() => doneRef.current(), 450);
  };

  useEffect(() => () => { if (leaveTimer.current) window.clearTimeout(leaveTimer.current); }, []);

  return (
    <div className="setup-welcome-stage" data-leaving={leaving ? 'true' : undefined} ref={hostRef} aria-label={t('setup.title')}>
      {!reduced && <canvas ref={underlayRef} className="setup-welcome-color" />}
      {!reduced && <canvas ref={canvasRef} className="setup-welcome-avatars" />}
      {reduced && <svg className="setup-welcome-reduced" viewBox={`${HANDWRITING.dudu.bounds.x} ${HANDWRITING.dudu.bounds.y} ${HANDWRITING.dudu.bounds.width} ${HANDWRITING.dudu.bounds.height}`} role="img" aria-label="dudu">
        <defs><linearGradient id="setup-word-color"><stop offset="0" stopColor="#ff6b8a" /><stop offset=".22" stopColor="#ffb35c" /><stop offset=".44" stopColor="#f5e663" /><stop offset=".66" stopColor="#62d9a0" /><stop offset=".84" stopColor="#5bbcff" /><stop offset="1" stopColor="#b59bff" /></linearGradient></defs>
        {HANDWRITING.dudu.strokes.map((stroke, index) => <path key={index} d={stroke.path} fill="none" stroke="url(#setup-word-color)" strokeWidth={HANDWRITING.dudu.pen} strokeLinecap="round" strokeLinejoin="round" />)}
      </svg>}
      {continueVisible && <button type="button" className="setup-welcome-continue" onClick={leave}>{t('setup.continue')}</button>}
    </div>
  );
}
