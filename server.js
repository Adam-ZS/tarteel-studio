'use strict';

const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static').path;
const { spawn } = require('child_process');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const app = express();
const ROOT = __dirname;
// On Vercel (serverless) the project directory is read-only; use /tmp for scratch files.
const IS_VERCEL = Boolean(process.env.VERCEL);
const TEMP_DIR = IS_VERCEL ? path.join(os.tmpdir(), 'tarteel-temp') : path.join(ROOT, 'temp');
const OUTPUT_DIR = IS_VERCEL ? path.join(os.tmpdir(), 'tarteel-out') : path.join(ROOT, 'outputs');
const PORT = Number(process.env.PORT || 4173);

fs.mkdirSync(TEMP_DIR, { recursive: true });
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const upload = multer({
  dest: TEMP_DIR,
  limits: { fileSize: 300 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /^(audio\/|video\/)/.test(file.mimetype) || /\.(mp3|wav|m4a|aac|ogg|webm|mp4|flac)$/i.test(file.originalname);
    cb(allowed ? null : new Error('Unsupported audio file type.'), allowed);
  },
});

app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));

function safeNumber(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function safeText(value, max = 300) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function quoteConcatPath(filePath) {
  return filePath.replace(/\\/g, '/').replace(/'/g, "'\\''");
}

function runProcess(binary, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      cwd: options.cwd || ROOT,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${path.basename(binary)} exited with code ${code}\n${stderr.slice(-8000)}`));
    });
  });
}

async function mediaDuration(filePath) {
  const { stdout } = await runProcess(ffprobePath, [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    filePath,
  ]);
  const duration = Number(stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Could not read audio duration.');
  return duration;
}

function buildFilterChain(settings = {}, conservative = false) {
  const cleanup = safeNumber(settings.cleanup, 0, 100, 60);
  const gate = safeNumber(settings.gate, 0, 100, 25);
  const highpass = safeNumber(settings.highpass, 20, 220, 70);
  const lowpass = safeNumber(settings.lowpass, 4500, 20000, 15000);
  const warmth = safeNumber(settings.warmth, -8, 8, 1.5);
  const clarity = safeNumber(settings.clarity, -8, 8, 2);
  const deesser = safeNumber(settings.deesser, 0, 100, 35);
  const compression = safeNumber(settings.compression, 0, 100, 55);
  const reverb = safeNumber(settings.reverb, 0, 100, 28);
  const echo = safeNumber(settings.echo, 0, 100, 10);
  const stereo = safeNumber(settings.stereo, 0, 100, 25);
  const tone = safeNumber(settings.tone, -2, 2, 0);
  const loudness = safeNumber(settings.loudness, -20, -12, -16);

  const filters = ['aresample=48000', `highpass=f=${highpass}`, `lowpass=f=${lowpass}`];

  if (!conservative && cleanup > 5) {
    const nf = (-18 - cleanup * 0.22).toFixed(1);
    filters.push(`afftdn=nf=${nf}:tn=1`);
  }

  if (!conservative && gate > 5) {
    const threshold = (0.003 + (gate / 100) * 0.035).toFixed(4);
    filters.push(`agate=threshold=${threshold}:ratio=2.5:attack=18:release=240`);
  }

  if (Math.abs(warmth) > 0.05) filters.push(`equalizer=f=180:t=q:w=0.9:g=${warmth.toFixed(2)}`);
  if (Math.abs(clarity) > 0.05) filters.push(`equalizer=f=3200:t=q:w=1.1:g=${clarity.toFixed(2)}`);
  if (deesser > 2) filters.push(`equalizer=f=6800:t=q:w=1.4:g=${(-deesser * 0.055).toFixed(2)}`);

  if (compression > 2) {
    const ratio = (1.4 + compression * 0.035).toFixed(2);
    const threshold = (0.28 - compression * 0.0018).toFixed(3);
    const makeup = (1 + compression * 0.011).toFixed(2);
    filters.push(`acompressor=threshold=${threshold}:ratio=${ratio}:attack=18:release=260:makeup=${makeup}`);
  }

  if (Math.abs(tone) > 0.01) {
    const factor = Math.pow(2, tone / 12);
    filters.push(`asetrate=${(48000 * factor).toFixed(3)}`);
    filters.push('aresample=48000');
    filters.push(`atempo=${(1 / factor).toFixed(6)}`);
  }

  if (!conservative && reverb > 1) {
    const wet = reverb / 100;
    const decay1 = (0.08 + wet * 0.34).toFixed(3);
    const decay2 = (0.04 + wet * 0.22).toFixed(3);
    const delay1 = Math.round(45 + wet * 55);
    const delay2 = Math.round(95 + wet * 85);
    filters.push(`aecho=0.82:0.78:${delay1}|${delay2}:${decay1}|${decay2}`);
  }

  if (!conservative && echo > 1) {
    const wet = echo / 100;
    filters.push(`aecho=0.86:0.68:${Math.round(145 + wet * 135)}:${(0.03 + wet * 0.23).toFixed(3)}`);
  }

  if (!conservative && stereo > 5) {
    const delay = Math.round(8 + stereo * 0.18);
    const feedback = (0.03 + stereo * 0.0018).toFixed(3);
    const crossfeed = (0.48 - stereo * 0.0028).toFixed(3);
    const drymix = (0.98 - stereo * 0.0015).toFixed(3);
    filters.push('aformat=channel_layouts=stereo');
    filters.push(`stereowiden=delay=${delay}:feedback=${feedback}:crossfeed=${crossfeed}:drymix=${drymix}`);
  }

  filters.push(`loudnorm=I=${loudness}:TP=-1.5:LRA=8`);
  filters.push('alimiter=limit=0.95');
  return filters.join(',');
}

async function processAudio(input, output, settings, format = 'mp3') {
  const codecArgs = format === 'wav'
    ? ['-c:a', 'pcm_s16le', '-ar', '48000']
    : ['-c:a', 'libmp3lame', '-b:a', '256k', '-ar', '48000'];

  const attempt = async conservative => {
    const args = [
      '-hide_banner', '-y', '-i', input,
      '-vn', '-af', buildFilterChain(settings, conservative),
      ...codecArgs,
      output,
    ];
    await runProcess(ffmpegPath, args);
  };

  try {
    await attempt(false);
  } catch (error) {
    console.warn('Advanced audio chain failed, retrying conservative chain:', error.message);
    await attempt(true);
  }
}

function wrapArabic(text, maxChars) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 7);
}

function themePalette(theme) {
  const palettes = {
    emerald: { a: '#071b18', b: '#123c32', accent: '#d9b96e', text: '#fffdf4', muted: '#c5d9d3' },
    midnight: { a: '#070b1c', b: '#1a2450', accent: '#86a8ff', text: '#f7f8ff', muted: '#b8c2e8' },
    sand: { a: '#2a1d12', b: '#705233', accent: '#f5d9a0', text: '#fffaf0', muted: '#e6d2b3' },
    charcoal: { a: '#090909', b: '#292929', accent: '#d7d7d7', text: '#ffffff', muted: '#c0c0c0' },
    rose: { a: '#1f0b15', b: '#5b243d', accent: '#f2c1cf', text: '#fff7fa', muted: '#e6beca' },
  };
  return palettes[theme] || palettes.emerald;
}

async function createSlide(filePath, item, video, index, total) {
  const sizes = {
    vertical: [1080, 1920],
    landscape: [1920, 1080],
    square: [1080, 1080],
  };
  const [width, height] = sizes[video.aspect] || sizes.vertical;
  const palette = themePalette(video.theme);
  const isVertical = height > width;
  const baseFont = isVertical ? 78 : 70;
  const textLength = String(item.text || '').length;
  const fontSize = Math.max(isVertical ? 50 : 44, baseFont - Math.max(0, textLength - 85) * 0.18);
  const maxChars = Math.max(20, Math.floor((width / fontSize) * 1.75));
  const lines = wrapArabic(item.text, maxChars);
  const lineHeight = fontSize * 1.7;
  const blockHeight = lines.length * lineHeight;
  const startY = height / 2 - blockHeight / 2 + fontSize;
  const transliteration = video.showTransliteration ? safeText(item.transliteration, 500) : '';
  const title = safeText(video.title || 'تلاوة مباركة', 90);
  const subtitle = safeText(video.subtitle || '', 120);
  const surahName = safeText(item.surahName || '', 80);
  const ayahLabel = `سورة ${surahName} • الآية ${item.ayah}`;
  const progress = total > 1 ? (index / (total - 1)) * (width - 160) : width - 160;

  const arabicTspans = lines.map((line, i) =>
    `<tspan x="${width / 2}" y="${startY + i * lineHeight}">${escapeXml(line)}</tspan>`
  ).join('');

  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${palette.a}"/>
        <stop offset="1" stop-color="${palette.b}"/>
      </linearGradient>
      <radialGradient id="glow" cx="50%" cy="44%" r="55%">
        <stop offset="0" stop-color="${palette.accent}" stop-opacity="0.14"/>
        <stop offset="1" stop-color="${palette.accent}" stop-opacity="0"/>
      </radialGradient>
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#000" flood-opacity="0.35"/>
      </filter>
      <pattern id="grid" width="90" height="90" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <path d="M 0 0 L 90 0 90 90" fill="none" stroke="${palette.accent}" stroke-opacity="0.035" stroke-width="2"/>
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill="url(#bg)"/>
    <rect width="100%" height="100%" fill="url(#grid)"/>
    <rect width="100%" height="100%" fill="url(#glow)"/>
    <circle cx="${width * 0.1}" cy="${height * 0.12}" r="${Math.min(width, height) * 0.14}" fill="none" stroke="${palette.accent}" stroke-opacity="0.09" stroke-width="2"/>
    <circle cx="${width * 0.9}" cy="${height * 0.86}" r="${Math.min(width, height) * 0.18}" fill="none" stroke="${palette.accent}" stroke-opacity="0.08" stroke-width="2"/>

    <text x="${width / 2}" y="${isVertical ? 145 : 105}" text-anchor="middle" fill="${palette.accent}" font-family="Arial, sans-serif" font-size="${isVertical ? 34 : 28}" letter-spacing="3">TARTEEL STUDIO</text>
    <text x="${width / 2}" y="${isVertical ? 225 : 165}" text-anchor="middle" fill="${palette.text}" font-family="Noto Naskh Arabic, Amiri, Scheherazade New, DejaVu Sans, Arial" font-size="${isVertical ? 52 : 42}" direction="rtl">${escapeXml(title)}</text>
    ${subtitle ? `<text x="${width / 2}" y="${isVertical ? 285 : 210}" text-anchor="middle" fill="${palette.muted}" font-family="Arial, sans-serif" font-size="${isVertical ? 25 : 22}">${escapeXml(subtitle)}</text>` : ''}

    <g filter="url(#shadow)">
      <rect x="${isVertical ? 65 : 105}" y="${startY - fontSize * 1.3}" width="${width - (isVertical ? 130 : 210)}" height="${blockHeight + fontSize * 1.5}" rx="38" fill="#000" fill-opacity="0.12" stroke="${palette.accent}" stroke-opacity="0.2"/>
      <text text-anchor="middle" fill="${palette.text}" font-family="Noto Naskh Arabic, Amiri, Scheherazade New, DejaVu Sans, Arial" font-size="${fontSize}" font-weight="500" direction="rtl" unicode-bidi="plaintext">${arabicTspans}</text>
    </g>

    ${transliteration ? `<text x="${width / 2}" y="${Math.min(height - 285, startY + blockHeight + 115)}" text-anchor="middle" fill="${palette.muted}" font-family="Arial, sans-serif" font-size="${isVertical ? 25 : 22}">${escapeXml(transliteration.slice(0, 180))}</text>` : ''}

    <text x="${width / 2}" y="${height - (isVertical ? 175 : 115)}" text-anchor="middle" fill="${palette.accent}" font-family="Noto Naskh Arabic, Amiri, DejaVu Sans, Arial" font-size="${isVertical ? 36 : 30}" direction="rtl">${escapeXml(ayahLabel)}</text>
    <rect x="80" y="${height - 82}" width="${width - 160}" height="5" rx="2.5" fill="${palette.text}" fill-opacity="0.12"/>
    <rect x="80" y="${height - 82}" width="${Math.max(8, progress)}" height="5" rx="2.5" fill="${palette.accent}"/>
  </svg>`;

  await sharp(Buffer.from(svg)).png().toFile(filePath);
}

function autoTimeline(items, duration) {
  const clean = (Array.isArray(items) ? items : []).map((item, index) => ({
    time: 0,
    surah: safeNumber(item.surah, 1, 114, 1),
    ayah: safeNumber(item.ayah, 1, 300, index + 1),
    surahName: safeText(item.surahName || '', 80),
    text: safeText(item.text || '', 2000),
    transliteration: safeText(item.transliteration || '', 1000),
  })).filter(item => item.text);
  const weights = clean.map(item => Math.max(1, item.text.split(/\s+/).length) ** 0.82);
  const total = weights.reduce((sum, value) => sum + value, 0) || 1;
  let cursor = 0;
  return clean.map((item, index) => {
    const timed = { ...item, time: cursor };
    cursor += duration * (weights[index] / total);
    return timed;
  });
}

function normalizeTimeline(rawItems, duration) {
  const clean = (Array.isArray(rawItems) ? rawItems : [])
    .map((item, index) => ({
      time: safeNumber(item.time, 0, Math.max(0, duration - 0.05), 0),
      surah: safeNumber(item.surah, 1, 114, 1),
      ayah: safeNumber(item.ayah, 1, 300, index + 1),
      surahName: safeText(item.surahName || '', 80),
      text: safeText(item.text || '', 2000),
      transliteration: safeText(item.transliteration || '', 1000),
    }))
    .filter(item => item.text)
    .sort((a, b) => a.time - b.time);

  if (!clean.length) throw new Error('No ayah text was provided for video export.');
  if (clean[0].time > 0.05) clean[0].time = 0;

  const deduped = [];
  for (const item of clean) {
    if (deduped.length && Math.abs(deduped[deduped.length - 1].time - item.time) < 0.04) {
      deduped[deduped.length - 1] = item;
    } else {
      deduped.push(item);
    }
  }
  return deduped;
}

async function renderVideo(input, output, config, workDir) {
  const processedWav = path.join(workDir, 'processed.wav');
  await processAudio(input, processedWav, config.effects || {}, 'wav');
  const duration = await mediaDuration(processedWav);
  const requestedTimeline = config.timelineMode === 'auto'
    ? autoTimeline(config.ayahSequence, duration)
    : config.timeline;
  const timeline = normalizeTimeline(requestedTimeline, duration);
  const video = {
    aspect: ['vertical', 'landscape', 'square'].includes(config.video?.aspect) ? config.video.aspect : 'vertical',
    theme: ['emerald', 'midnight', 'sand', 'charcoal', 'rose'].includes(config.video?.theme) ? config.video.theme : 'emerald',
    title: safeText(config.video?.title || 'تلاوة مباركة', 90),
    subtitle: safeText(config.video?.subtitle || '', 120),
    showTransliteration: Boolean(config.video?.showTransliteration),
  };

  const slidePaths = [];
  for (let i = 0; i < timeline.length; i += 1) {
    const slidePath = path.join(workDir, `slide-${String(i).padStart(4, '0')}.png`);
    await createSlide(slidePath, timeline[i], video, i, timeline.length);
    slidePaths.push(slidePath);
  }

  const concatLines = ['ffconcat version 1.0'];
  for (let i = 0; i < slidePaths.length; i += 1) {
    const start = timeline[i].time;
    const end = i + 1 < timeline.length ? timeline[i + 1].time : duration;
    const segmentDuration = Math.max(0.08, end - start);
    concatLines.push(`file '${quoteConcatPath(slidePaths[i])}'`);
    concatLines.push(`duration ${segmentDuration.toFixed(6)}`);
  }
  concatLines.push(`file '${quoteConcatPath(slidePaths[slidePaths.length - 1])}'`);
  const concatFile = path.join(workDir, 'slides.ffconcat');
  await fsp.writeFile(concatFile, concatLines.join('\n'), 'utf8');

  const baseArgs = [
    '-hide_banner', '-y',
    '-f', 'concat', '-safe', '0', '-i', concatFile,
    '-i', processedWav,
    '-shortest', '-vsync', 'vfr',
    '-c:a', 'aac', '-b:a', '256k',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
  ];

  try {
    await runProcess(ffmpegPath, [...baseArgs, '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', output]);
  } catch (error) {
    console.warn('H.264 render failed; retrying MPEG-4:', error.message);
    await runProcess(ffmpegPath, [...baseArgs, '-c:v', 'mpeg4', '-q:v', '3', output]);
  }
}

async function cleanup(paths) {
  await Promise.all(paths.map(async p => {
    try { await fsp.rm(p, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  }));
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ffmpeg: Boolean(ffmpegPath), version: '1.0.0' });
});

app.get('/api/quran', async (_req, res, next) => {
  try {
    const quranPath = require.resolve('quran-json/dist/quran.json');
    res.type('application/json').sendFile(quranPath);
  } catch (error) {
    next(new Error('Qur’an dataset is unavailable. Run npm install again.'));
  }
});

app.post('/api/render/audio', upload.single('audio'), async (req, res, next) => {
  if (!req.file) return next(new Error('No audio file received.'));
  const jobId = crypto.randomUUID();
  const extension = req.body.format === 'wav' ? 'wav' : 'mp3';
  const output = path.join(OUTPUT_DIR, `${jobId}.${extension}`);
  let config;
  try { config = JSON.parse(req.body.config || '{}'); } catch (_) { config = {}; }
  try {
    await processAudio(req.file.path, output, config.effects || {}, extension);
    res.download(output, `tarteel-studio.${extension}`, async () => cleanup([req.file.path, output]));
  } catch (error) {
    await cleanup([req.file.path, output]);
    next(error);
  }
});

app.post('/api/render/video', upload.single('audio'), async (req, res, next) => {
  if (!req.file) return next(new Error('No audio file received.'));
  const jobId = crypto.randomUUID();
  const workDir = path.join(TEMP_DIR, `job-${jobId}`);
  const output = path.join(OUTPUT_DIR, `${jobId}.mp4`);
  let config;
  try { config = JSON.parse(req.body.config || '{}'); } catch (_) { config = {}; }
  try {
    await fsp.mkdir(workDir, { recursive: true });
    await renderVideo(req.file.path, output, config, workDir);
    res.download(output, 'tarteel-studio.mp4', async () => cleanup([req.file.path, workDir, output]));
  } catch (error) {
    await cleanup([req.file.path, workDir, output]);
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  const status = error instanceof multer.MulterError ? 400 : 500;
  res.status(status).json({ error: error.message || 'Unexpected server error.' });
});

// Export the app for serverless hosts (Vercel); only listen when run directly.
module.exports = app;

if (require.main === module) {
  app.listen(PORT, '127.0.0.1', () => {
    console.log(`\nTarteel Studio is running at http://127.0.0.1:${PORT}\n`);
  });
}
