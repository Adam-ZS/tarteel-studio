'use strict';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

const els = {
  body: document.body,
  loading: $('#loadingOverlay'),
  toast: $('#toast'),
  surahList: $('#surahList'),
  surahSearch: $('#surahSearch'),
  surahHeading: $('#surahHeading'),
  surahType: $('#surahType'),
  surahMeta: $('#surahMeta'),
  mobileCurrentSurah: $('#mobileCurrentSurah'),
  rangeStart: $('#rangeStart'),
  rangeEnd: $('#rangeEnd'),
  applyRange: $('#applyRange'),
  ayahStage: $('#ayahStage'),
  ayahCounter: $('#ayahCounter'),
  ayahText: $('#ayahText'),
  transliteration: $('#transliteration'),
  stageProgress: $('#stageProgress'),
  prevAyah: $('#prevAyah'),
  nextAyah: $('#nextAyah'),
  markAyah: $('#markAyah'),
  showTransliteration: $('#showTransliteration'),
  autoAdvance: $('#autoAdvance'),
  advanceSeconds: $('#advanceSeconds'),
  waveform: $('#waveform'),
  timer: $('#timer'),
  recordButton: $('#recordButton'),
  pauseButton: $('#pauseButton'),
  stopButton: $('#stopButton'),
  recordingState: $('#recordingState'),
  audioUpload: $('#audioUpload'),
  fileDrop: $('#fileDrop'),
  microphoneSelect: $('#microphoneSelect'),
  monitorInput: $('#monitorInput'),
  sourcePlayer: $('#sourcePlayer'),
  sourceInfo: $('#sourceInfo'),
  captureMarker: $('#captureMarker'),
  autoDistribute: $('#autoDistribute'),
  clearMarkers: $('#clearMarkers'),
  timelineList: $('#timelineList'),
  markerCount: $('#markerCount'),
  presetRow: $('#presetRow'),
  previewButton: $('#previewButton'),
  stopPreviewButton: $('#stopPreviewButton'),
  videoTitle: $('#videoTitle'),
  videoSubtitle: $('#videoSubtitle'),
  videoAspect: $('#videoAspect'),
  videoTheme: $('#videoTheme'),
  videoTransliteration: $('#videoTransliteration'),
  exportPreview: $('#exportPreview'),
  previewAyah: $('#previewAyah'),
  previewMeta: $('#previewMeta'),
  exportMp3: $('#exportMp3'),
  exportWav: $('#exportWav'),
  exportMp4: $('#exportMp4'),
  exportStatus: $('#exportStatus'),
  exportProgress: $('#exportProgress'),
  openSidebar: $('#openSidebar'),
  collapseSidebar: $('#collapseSidebar'),
  sidebar: $('.sidebar'),
  themeToggle: $('#themeToggle'),
};

const PRESETS = {
  clear: { cleanup: 60, gate: 25, highpass: 70, lowpass: 15000, warmth: 1.5, clarity: 2, deesser: 35, compression: 55, reverb: 28, echo: 10, stereo: 25, tone: 0, loudness: -16 },
  mihrab: { cleanup: 55, gate: 18, highpass: 65, lowpass: 14500, warmth: 3.5, clarity: 1, deesser: 30, compression: 48, reverb: 45, echo: 12, stereo: 40, tone: -0.15, loudness: -16 },
  masjid: { cleanup: 48, gate: 14, highpass: 60, lowpass: 13800, warmth: 2.5, clarity: 0.5, deesser: 28, compression: 42, reverb: 68, echo: 22, stereo: 62, tone: 0, loudness: -17 },
  night: { cleanup: 70, gate: 33, highpass: 80, lowpass: 12500, warmth: 4, clarity: -0.5, deesser: 42, compression: 60, reverb: 35, echo: 8, stereo: 28, tone: -0.35, loudness: -18 },
  broadcast: { cleanup: 75, gate: 35, highpass: 90, lowpass: 16000, warmth: 0.5, clarity: 4, deesser: 48, compression: 78, reverb: 15, echo: 0, stereo: 15, tone: 0.1, loudness: -14 },
};

const state = {
  quran: [],
  surahIndex: 0,
  ayahIndex: 0,
  rangeStart: 0,
  rangeEnd: 0,
  markers: [],
  sourceBlob: null,
  sourceFile: null,
  sourceUrl: null,
  sourceDuration: 0,
  mediaRecorder: null,
  mediaChunks: [],
  stream: null,
  recorderSourceNode: null,
  analyser: null,
  waveFrame: null,
  timerFrame: null,
  recordingStartedAt: 0,
  pausedStartedAt: 0,
  pausedTotal: 0,
  isPaused: false,
  autoTimer: null,
  previewContext: null,
  previewSource: null,
  monitorContext: null,
  monitorSource: null,
  monitorGain: null,
  busy: false,
  lastRecordingDuration: 0,
};

function showToast(message, type = '') {
  els.toast.textContent = message;
  els.toast.className = `toast show ${type}`;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { els.toast.className = 'toast'; }, 3600);
}

function formatTime(seconds, tenths = false) {
  const safe = Math.max(0, Number(seconds) || 0);
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  const tenth = Math.floor((safe % 1) * 10);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}${tenths ? `.${tenth}` : ''}`;
}

function arabicNumber(value) {
  try { return Number(value).toLocaleString('ar-EG', { useGrouping: false }); }
  catch (_) { return String(value); }
}

function currentSurah() { return state.quran[state.surahIndex]; }
function currentAyah() { return currentSurah()?.verses?.[state.ayahIndex]; }
function rangeAyahs() {
  const surah = currentSurah();
  if (!surah) return [];
  return surah.verses.slice(state.rangeStart, state.rangeEnd + 1).map((ayah, offset) => ({
    surah: surah.id,
    surahName: surah.name,
    ayah: ayah.id,
    text: ayah.text,
    transliteration: ayah.transliteration || '',
    index: state.rangeStart + offset,
  }));
}

function normalizeQuran(data) {
  if (Array.isArray(data)) return data;
  return Object.keys(data || {}).sort((a, b) => Number(a) - Number(b)).map(key => ({
    id: Number(key),
    name: `سورة ${key}`,
    transliteration: `Surah ${key}`,
    type: '',
    total_verses: data[key].length,
    verses: data[key].map(v => ({ id: v.verse, text: v.text, transliteration: '' })),
  }));
}

async function loadQuran() {
  try {
    let response = await fetch('/api/quran');
    if (!response.ok) throw new Error('Local dataset unavailable');
    state.quran = normalizeQuran(await response.json());
    if (state.quran.length !== 114) throw new Error('The dataset did not contain 114 sūrahs.');
    const saved = Math.min(113, Math.max(0, Number(localStorage.getItem('tarteel-surah') || 0)));
    selectSurah(saved, false);
    renderSurahList();
    els.loading.classList.add('hidden');
  } catch (localError) {
    try {
      const response = await fetch('https://cdn.jsdelivr.net/npm/quran-json@3.1.2/dist/quran.json');
      if (!response.ok) throw new Error('CDN unavailable');
      state.quran = normalizeQuran(await response.json());
      selectSurah(0, false);
      renderSurahList();
      els.loading.classList.add('hidden');
      showToast('Using the online Qur’an dataset fallback.');
    } catch (error) {
      els.loading.innerHTML = `<strong>Could not load the Qur’an dataset.</strong><span>Run <code>npm install</code>, then restart the app.</span>`;
      console.error(localError, error);
    }
  }
}

function renderSurahList(query = '') {
  const q = query.trim().toLowerCase();
  const filtered = state.quran.map((surah, index) => ({ surah, index })).filter(({ surah }) =>
    !q || [surah.name, surah.transliteration, String(surah.id)].some(value => String(value).toLowerCase().includes(q))
  );
  els.surahList.innerHTML = filtered.map(({ surah, index }) => `
    <button class="surah-item ${index === state.surahIndex ? 'active' : ''}" data-index="${index}">
      <span class="surah-number">${surah.id}</span>
      <span class="surah-en"><strong>${surah.transliteration}</strong><small>${surah.total_verses} āyāt • ${surah.type || 'Qur’an'}</small></span>
      <span class="surah-ar" lang="ar">${surah.name}</span>
    </button>
  `).join('') || '<div class="empty-timeline">No sūrahs found.</div>';
}

function selectSurah(index, focus = true) {
  if (!state.quran[index]) return;
  state.surahIndex = index;
  state.rangeStart = 0;
  state.rangeEnd = state.quran[index].verses.length - 1;
  state.ayahIndex = 0;
  localStorage.setItem('tarteel-surah', String(index));
  els.rangeStart.value = 1;
  els.rangeEnd.value = state.rangeEnd + 1;
  els.rangeStart.max = state.quran[index].verses.length;
  els.rangeEnd.max = state.quran[index].verses.length;
  renderSurahList(els.surahSearch.value);
  updateReader();
  if (focus) {
    els.ayahStage.focus({ preventScroll: true });
    els.sidebar.classList.remove('open');
  }
}

function updateReader() {
  const surah = currentSurah();
  const ayah = currentAyah();
  if (!surah || !ayah) return;
  els.surahHeading.textContent = `${surah.transliteration} — ${surah.name}`;
  els.surahType.textContent = String(surah.type || 'QUR’AN').toUpperCase();
  els.surahMeta.textContent = `${surah.total_verses} āyāt • selected ${state.rangeStart + 1}–${state.rangeEnd + 1}`;
  els.mobileCurrentSurah.textContent = surah.transliteration;
  els.ayahText.classList.add('changing');
  setTimeout(() => {
    els.ayahText.textContent = ayah.text;
    els.ayahText.classList.remove('changing');
  }, 90);
  els.ayahCounter.textContent = `${ayah.id} / ${surah.total_verses}`;
  els.transliteration.textContent = els.showTransliteration.checked ? (ayah.transliteration || '') : '';
  const denominator = Math.max(1, state.rangeEnd - state.rangeStart);
  const progress = ((state.ayahIndex - state.rangeStart) / denominator) * 100;
  els.stageProgress.style.width = `${Math.max(0, Math.min(100, progress))}%`;
  els.prevAyah.disabled = state.ayahIndex <= state.rangeStart;
  els.nextAyah.disabled = state.ayahIndex >= state.rangeEnd;
  updateExportPreview();
}

function applyRange() {
  const count = currentSurah().verses.length;
  let start = Math.max(1, Math.min(count, Number(els.rangeStart.value) || 1));
  let end = Math.max(1, Math.min(count, Number(els.rangeEnd.value) || count));
  if (start > end) [start, end] = [end, start];
  state.rangeStart = start - 1;
  state.rangeEnd = end - 1;
  state.ayahIndex = state.rangeStart;
  els.rangeStart.value = start;
  els.rangeEnd.value = end;
  updateReader();
  showToast(`Selected āyāt ${start}–${end}.`);
}

function activeClockTime() {
  if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
    const now = state.isPaused ? state.pausedStartedAt : performance.now();
    return Math.max(0, (now - state.recordingStartedAt - state.pausedTotal) / 1000);
  }
  if (Number.isFinite(els.sourcePlayer.currentTime)) return els.sourcePlayer.currentTime;
  return 0;
}

function markerFromCurrent(time = activeClockTime()) {
  const surah = currentSurah();
  const ayah = currentAyah();
  return {
    time: Math.max(0, Number(time) || 0),
    surah: surah.id,
    surahName: surah.name,
    ayah: ayah.id,
    text: ayah.text,
    transliteration: ayah.transliteration || '',
  };
}

function addMarker(time = activeClockTime(), replaceNear = true) {
  if (!currentAyah()) return;
  const marker = markerFromCurrent(time);
  const nearby = state.markers.findIndex(item => Math.abs(item.time - marker.time) < 0.18);
  if (nearby >= 0 && replaceNear) state.markers[nearby] = marker;
  else state.markers.push(marker);
  state.markers.sort((a, b) => a.time - b.time);
  renderTimeline();
}

function navigateAyah(delta, capture = true) {
  const next = Math.max(state.rangeStart, Math.min(state.rangeEnd, state.ayahIndex + delta));
  if (next === state.ayahIndex) return;
  state.ayahIndex = next;
  updateReader();
  if (capture && (state.mediaRecorder?.state === 'recording' || !els.sourcePlayer.paused)) addMarker(activeClockTime());
}

function renderTimeline() {
  els.markerCount.textContent = `${state.markers.length} marker${state.markers.length === 1 ? '' : 's'}`;
  if (!state.markers.length) {
    els.timelineList.innerHTML = '<div class="empty-timeline">Your āyah switch points will appear here.</div>';
    return;
  }
  els.timelineList.innerHTML = state.markers.map((marker, index) => `
    <div class="marker-row" data-index="${index}">
      <input class="marker-time" type="number" min="0" step="0.1" value="${marker.time.toFixed(1)}" aria-label="Marker time in seconds">
      <div class="marker-label"><strong>${formatTime(marker.time)} • ${marker.surah}:${marker.ayah}</strong><span>${marker.text}</span></div>
      <button class="marker-delete" title="Delete marker" aria-label="Delete marker">×</button>
    </div>
  `).join('');
}

function getSourceDuration() {
  const duration = Number(els.sourcePlayer.duration || state.sourceDuration || 0);
  return Number.isFinite(duration) ? duration : 0;
}

function autoDistributeMarkers(silent = false) {
  const duration = getSourceDuration();
  const ayahs = rangeAyahs();
  if (!duration || !ayahs.length) {
    if (!silent) showToast('Load or record audio first so its duration is known.', 'error');
    return [];
  }
  const weights = ayahs.map(item => Math.max(1, item.text.split(/\s+/).length) ** 0.82);
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  let cursor = 0;
  state.markers = ayahs.map((item, index) => {
    const marker = { ...item, time: cursor };
    cursor += duration * (weights[index] / totalWeight);
    return marker;
  });
  renderTimeline();
  if (!silent) showToast('Āyāt distributed by relative word length. Fine-tune markers as needed.');
  return state.markers;
}

async function listMicrophones(requestPermission = false) {
  try {
    if (requestPermission) {
      const temp = await navigator.mediaDevices.getUserMedia({ audio: true });
      temp.getTracks().forEach(track => track.stop());
    }
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices.filter(device => device.kind === 'audioinput');
    const selected = els.microphoneSelect.value;
    els.microphoneSelect.innerHTML = '<option value="">Default microphone</option>' + inputs.map((device, index) =>
      `<option value="${device.deviceId}">${device.label || `Microphone ${index + 1}`}</option>`
    ).join('');
    if ([...els.microphoneSelect.options].some(option => option.value === selected)) els.microphoneSelect.value = selected;
  } catch (error) {
    console.warn('Could not enumerate microphones:', error);
  }
}

function stopMediaStream() {
  if (state.stream) state.stream.getTracks().forEach(track => track.stop());
  state.stream = null;
  state.recorderSourceNode?.disconnect();
  state.recorderSourceNode = null;
  state.analyser = null;
  cancelAnimationFrame(state.waveFrame);
  drawIdleWave();
  disableMonitor();
}

function preferredMimeType() {
  const types = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm', 'audio/mp4'];
  return types.find(type => window.MediaRecorder?.isTypeSupported(type)) || '';
}

async function startRecording() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    showToast('This browser does not support microphone recording.', 'error');
    return;
  }
  try {
    stopPreview();
    const deviceId = els.microphoneSelect.value;
    const constraints = {
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: false,
        autoGainControl: false,
        noiseSuppression: true,
        channelCount: 1,
        sampleRate: 48000,
      },
    };
    state.stream = await navigator.mediaDevices.getUserMedia(constraints);
    await listMicrophones();
    const mimeType = preferredMimeType();
    state.mediaRecorder = mimeType ? new MediaRecorder(state.stream, { mimeType, audioBitsPerSecond: 192000 }) : new MediaRecorder(state.stream);
    state.mediaChunks = [];
    state.mediaRecorder.addEventListener('dataavailable', event => { if (event.data.size) state.mediaChunks.push(event.data); });
    state.mediaRecorder.addEventListener('stop', finishRecording, { once: true });
    state.mediaRecorder.start(250);
    state.recordingStartedAt = performance.now();
    state.pausedTotal = 0;
    state.isPaused = false;
    state.markers = [];
    addMarker(0);
    setRecordingUi('recording');
    setupWaveform(state.stream);
    updateTimerLoop();
    if (els.monitorInput.checked) enableMonitor();
    if (els.autoAdvance.checked) startAutoAdvance();
  } catch (error) {
    console.error(error);
    showToast(`Microphone error: ${error.message}`, 'error');
    stopMediaStream();
  }
}

function setRecordingUi(mode) {
  const recording = mode === 'recording' || mode === 'paused';
  els.recordButton.disabled = recording;
  els.recordButton.classList.toggle('recording', recording);
  els.pauseButton.disabled = !recording;
  els.stopButton.disabled = !recording;
  els.pauseButton.textContent = mode === 'paused' ? 'Resume' : 'Pause';
  els.recordingState.textContent = mode === 'recording' ? 'Recording' : mode === 'paused' ? 'Paused' : 'Ready';
  els.recordingState.classList.toggle('live', recording);
}

function togglePause() {
  if (!state.mediaRecorder || state.mediaRecorder.state === 'inactive') return;
  if (state.mediaRecorder.state === 'recording') {
    state.mediaRecorder.pause();
    state.pausedStartedAt = performance.now();
    state.isPaused = true;
    setRecordingUi('paused');
    stopAutoAdvance();
  } else if (state.mediaRecorder.state === 'paused') {
    state.mediaRecorder.resume();
    state.pausedTotal += performance.now() - state.pausedStartedAt;
    state.isPaused = false;
    setRecordingUi('recording');
    if (els.autoAdvance.checked) startAutoAdvance();
  }
}

function stopRecording() {
  if (!state.mediaRecorder || state.mediaRecorder.state === 'inactive') return;
  state.lastRecordingDuration = activeClockTime();
  state.mediaRecorder.stop();
  stopAutoAdvance();
  setRecordingUi('ready');
}

function finishRecording() {
  const type = state.mediaRecorder?.mimeType || 'audio/webm';
  const blob = new Blob(state.mediaChunks, { type });
  const capturedDuration = state.lastRecordingDuration || Math.max(0, ...state.markers.map(item => item.time));
  setSource(blob, null, `Microphone recording • ${formatTime(capturedDuration)}`);
  stopMediaStream();
  state.mediaRecorder = null;
  cancelAnimationFrame(state.timerFrame);
  els.timer.textContent = formatTime(0, true);
  showToast('Recording captured. Preview it, tune the effects, then export.');
}

function updateTimerLoop() {
  const tick = () => {
    if (!state.mediaRecorder || state.mediaRecorder.state === 'inactive') return;
    els.timer.textContent = formatTime(activeClockTime(), true);
    state.timerFrame = requestAnimationFrame(tick);
  };
  tick();
}

function setupWaveform(stream) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const context = new AudioCtx();
  state.recorderSourceNode = context.createMediaStreamSource(stream);
  state.analyser = context.createAnalyser();
  state.analyser.fftSize = 2048;
  state.recorderSourceNode.connect(state.analyser);
  const data = new Uint8Array(state.analyser.fftSize);
  const ctx = els.waveform.getContext('2d');
  const draw = () => {
    if (!state.analyser) return;
    state.analyser.getByteTimeDomainData(data);
    const w = els.waveform.width;
    const h = els.waveform.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(0, 0, 0, .12)';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = getComputedStyle(document.body).getPropertyValue('--accent').trim() || '#d9b96e';
    ctx.lineWidth = 3;
    ctx.beginPath();
    data.forEach((value, index) => {
      const x = index / (data.length - 1) * w;
      const y = value / 255 * h;
      if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    state.waveFrame = requestAnimationFrame(draw);
  };
  draw();
}

function drawIdleWave() {
  const ctx = els.waveform.getContext('2d');
  const w = els.waveform.width;
  const h = els.waveform.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(0,0,0,.12)';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(217,185,110,.22)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let x = 0; x <= w; x += 4) {
    const y = h / 2 + Math.sin(x / 40) * 4 + Math.sin(x / 13) * 2;
    if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function setSource(blob, file = null, description = '') {
  stopPreview();
  if (state.sourceUrl) URL.revokeObjectURL(state.sourceUrl);
  state.sourceBlob = blob;
  state.sourceFile = file;
  state.sourceUrl = URL.createObjectURL(blob);
  els.sourcePlayer.src = state.sourceUrl;
  els.sourcePlayer.load();
  els.sourceInfo.textContent = description || `${file?.name || 'Audio'} • ${(blob.size / 1024 / 1024).toFixed(2)} MB`;
  [els.previewButton, els.exportMp3, els.exportWav, els.exportMp4].forEach(button => { button.disabled = false; });
  els.exportStatus.textContent = 'Ready to export';
  if (!state.markers.length) {
    state.markers = [markerFromCurrent(0)];
    renderTimeline();
  }
}

function loadFile(file) {
  if (!file) return;
  if (!file.type.startsWith('audio/') && !/\.(mp3|wav|m4a|aac|flac|ogg|webm|mp4)$/i.test(file.name)) {
    showToast('Choose an audio file such as MP3, WAV, M4A, or WebM.', 'error');
    return;
  }
  state.markers = [];
  setSource(file, file, `${file.name} • ${(file.size / 1024 / 1024).toFixed(2)} MB`);
  showToast('Audio loaded. Play it and press Next after each āyah, or use Auto distribute.');
}

function startAutoAdvance() {
  stopAutoAdvance();
  const seconds = Math.max(2, Math.min(120, Number(els.advanceSeconds.value) || 10));
  state.autoTimer = setInterval(() => {
    if (state.ayahIndex < state.rangeEnd) navigateAyah(1, true);
    else stopAutoAdvance();
  }, seconds * 1000);
}
function stopAutoAdvance() { clearInterval(state.autoTimer); state.autoTimer = null; }

function currentEffects() {
  const result = {};
  $$('[data-effect]').forEach(input => { result[input.dataset.effect] = Number(input.value); });
  return result;
}

function formatEffectValue(name, value) {
  if (name === 'highpass' || name === 'lowpass') return `${value} Hz`;
  if (name === 'warmth' || name === 'clarity') return `${value > 0 ? '+' : ''}${value} dB`;
  if (name === 'tone') return `${value > 0 ? '+' : ''}${value} semitones`;
  if (name === 'loudness') return `${value} LUFS`;
  return String(value);
}

function syncEffectOutputs() {
  $$('[data-effect]').forEach(input => {
    const output = document.querySelector(`[data-output="${input.dataset.effect}"]`);
    if (output) output.textContent = formatEffectValue(input.dataset.effect, Number(input.value));
  });
}

function applyPreset(name) {
  const preset = PRESETS[name];
  if (!preset) return;
  Object.entries(preset).forEach(([key, value]) => {
    const input = document.querySelector(`[data-effect="${key}"]`);
    if (input) input.value = value;
  });
  syncEffectOutputs();
  $$('.preset').forEach(button => button.classList.toggle('active', button.dataset.preset === name));
}

function makeImpulse(context, seconds, decay) {
  const rate = context.sampleRate;
  const length = Math.floor(rate * seconds);
  const impulse = context.createBuffer(2, length, rate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * ((1 - i / length) ** decay);
    }
  }
  return impulse;
}

async function previewEffects() {
  if (!state.sourceBlob) return;
  stopPreview();
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const context = new AudioCtx();
    state.previewContext = context;
    const audioBuffer = await context.decodeAudioData(await state.sourceBlob.arrayBuffer());
    const source = context.createBufferSource();
    state.previewSource = source;
    source.buffer = audioBuffer;
    const e = currentEffects();
    source.playbackRate.value = Math.pow(2, e.tone / 12);

    const high = context.createBiquadFilter(); high.type = 'highpass'; high.frequency.value = e.highpass;
    const low = context.createBiquadFilter(); low.type = 'lowpass'; low.frequency.value = e.lowpass;
    const warmth = context.createBiquadFilter(); warmth.type = 'lowshelf'; warmth.frequency.value = 180; warmth.gain.value = e.warmth;
    const clarity = context.createBiquadFilter(); clarity.type = 'peaking'; clarity.frequency.value = 3200; clarity.Q.value = 1.1; clarity.gain.value = e.clarity;
    const deesser = context.createBiquadFilter(); deesser.type = 'peaking'; deesser.frequency.value = 6800; deesser.Q.value = 1.4; deesser.gain.value = -e.deesser * 0.055;
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -10 - e.compression * 0.28;
    compressor.knee.value = 18;
    compressor.ratio.value = 1.5 + e.compression * 0.06;
    compressor.attack.value = 0.018;
    compressor.release.value = 0.26;
    const master = context.createGain(); master.gain.value = 0.88;
    const dry = context.createGain(); dry.gain.value = 1;
    const convolver = context.createConvolver(); convolver.buffer = makeImpulse(context, 0.45 + e.reverb / 30, 2.2);
    const reverbGain = context.createGain(); reverbGain.gain.value = e.reverb / 145;
    const delay = context.createDelay(2); delay.delayTime.value = 0.14 + e.echo / 300;
    const feedback = context.createGain(); feedback.gain.value = Math.min(0.55, e.echo / 180);
    const echoGain = context.createGain(); echoGain.gain.value = e.echo / 120;

    source.connect(high).connect(low).connect(warmth).connect(clarity).connect(deesser).connect(compressor);
    compressor.connect(dry).connect(master);
    compressor.connect(convolver).connect(reverbGain).connect(master);
    compressor.connect(delay).connect(echoGain).connect(master);
    delay.connect(feedback).connect(delay);
    master.connect(context.destination);
    source.start();
    source.addEventListener('ended', stopPreview, { once: true });
    els.previewButton.disabled = true;
    els.stopPreviewButton.disabled = false;
    showToast('Playing a browser preview. Final export uses the higher-quality FFmpeg chain.');
  } catch (error) {
    console.error(error);
    stopPreview();
    showToast(`Could not preview this file: ${error.message}`, 'error');
  }
}

function stopPreview() {
  try { state.previewSource?.stop(); } catch (_) { /* already stopped */ }
  state.previewSource = null;
  if (state.previewContext) state.previewContext.close().catch(() => {});
  state.previewContext = null;
  els.previewButton.disabled = !state.sourceBlob;
  els.stopPreviewButton.disabled = true;
}

function enableMonitor() {
  if (!state.stream || state.monitorContext) return;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  state.monitorContext = new AudioCtx();
  state.monitorSource = state.monitorContext.createMediaStreamSource(state.stream);
  state.monitorGain = state.monitorContext.createGain();
  state.monitorGain.gain.value = 0.58;
  state.monitorSource.connect(state.monitorGain).connect(state.monitorContext.destination);
}
function disableMonitor() {
  state.monitorSource?.disconnect();
  state.monitorGain?.disconnect();
  if (state.monitorContext) state.monitorContext.close().catch(() => {});
  state.monitorContext = null;
  state.monitorSource = null;
  state.monitorGain = null;
}

function updateExportPreview() {
  const surah = currentSurah();
  const ayah = currentAyah();
  if (!surah || !ayah) return;
  els.previewAyah.textContent = ayah.text;
  els.previewMeta.textContent = `سورة ${surah.name} • الآية ${arabicNumber(ayah.id)}`;
  els.exportPreview.dataset.theme = els.videoTheme.value;
  $('.preview-title').textContent = els.videoTitle.value || 'تلاوة مباركة';
  const aspect = els.videoAspect.value;
  els.exportPreview.style.aspectRatio = aspect === 'vertical' ? '9 / 12' : aspect === 'square' ? '1 / 1' : '16 / 10';
}

function sourceForUpload() {
  if (state.sourceFile) return { blob: state.sourceFile, name: state.sourceFile.name };
  if (state.sourceBlob) {
    const ext = state.sourceBlob.type.includes('ogg') ? 'ogg' : state.sourceBlob.type.includes('mp4') ? 'm4a' : 'webm';
    return { blob: state.sourceBlob, name: `recording.${ext}` };
  }
  return null;
}

function buildTimelinePayload() {
  let markers = state.markers.slice().sort((a, b) => a.time - b.time);
  const rangeCount = state.rangeEnd - state.rangeStart + 1;
  if (markers.length < Math.min(2, rangeCount)) {
    const distributed = autoDistributeMarkers(true);
    if (distributed.length) {
      markers = distributed;
      showToast('No detailed timing was set, so the export uses automatic āyah timing.');
    } else if (rangeCount > 1) {
      showToast('The server will distribute the selected āyāt across the audio duration.');
      return { timelineMode: 'auto', timeline: [], ayahSequence: rangeAyahs() };
    }
  }
  if (!markers.length) markers = [markerFromCurrent(0)];
  if (markers[0].time > 0.05) markers[0].time = 0;
  return {
    timelineMode: 'manual',
    timeline: markers.map(({ time, surah, surahName, ayah, text, transliteration }) => ({ time, surah, surahName, ayah, text, transliteration })),
    ayahSequence: [],
  };
}

function buildConfig() {
  const timing = buildTimelinePayload();
  return {
    effects: currentEffects(),
    timeline: timing.timeline,
    timelineMode: timing.timelineMode,
    ayahSequence: timing.ayahSequence,
    video: {
      title: els.videoTitle.value.trim(),
      subtitle: els.videoSubtitle.value.trim(),
      aspect: els.videoAspect.value,
      theme: els.videoTheme.value,
      showTransliteration: els.videoTransliteration.checked,
    },
  };
}

async function parseErrorResponse(response) {
  try {
    const data = await response.json();
    return data.error || `Request failed (${response.status})`;
  } catch (_) {
    return `Request failed (${response.status})`;
  }
}

async function exportMedia(kind) {
  const source = sourceForUpload();
  if (!source || state.busy) return;
  state.busy = true;
  els.exportProgress.classList.remove('hidden');
  els.exportStatus.textContent = kind === 'video' ? 'Rendering MP4' : 'Processing audio';
  [els.exportMp3, els.exportWav, els.exportMp4].forEach(button => { button.disabled = true; });
  try {
    const form = new FormData();
    form.append('audio', source.blob, source.name);
    form.append('config', JSON.stringify(buildConfig()));
    if (kind !== 'video') form.append('format', kind);
    const endpoint = kind === 'video' ? '/api/render/video' : '/api/render/audio';
    const response = await fetch(endpoint, { method: 'POST', body: form });
    if (!response.ok) throw new Error(await parseErrorResponse(response));
    const blob = await response.blob();
    const extension = kind === 'video' ? 'mp4' : kind;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `tarteel-studio-${currentSurah().transliteration.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.${extension}`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    els.exportStatus.textContent = 'Export complete';
    showToast(`${extension.toUpperCase()} export is ready.`);
  } catch (error) {
    console.error(error);
    els.exportStatus.textContent = 'Export failed';
    showToast(`Export failed: ${error.message}`, 'error');
  } finally {
    state.busy = false;
    els.exportProgress.classList.add('hidden');
    [els.exportMp3, els.exportWav, els.exportMp4].forEach(button => { button.disabled = !state.sourceBlob; });
  }
}

// Event wiring
els.surahSearch.addEventListener('input', event => renderSurahList(event.target.value));
els.surahList.addEventListener('click', event => {
  const button = event.target.closest('.surah-item');
  if (button) selectSurah(Number(button.dataset.index));
});
els.applyRange.addEventListener('click', applyRange);
els.prevAyah.addEventListener('click', () => navigateAyah(-1, false));
els.nextAyah.addEventListener('click', () => navigateAyah(1, true));
els.markAyah.addEventListener('click', () => { addMarker(); showToast(`Marked ${currentSurah().id}:${currentAyah().id} at ${formatTime(activeClockTime())}.`); });
els.captureMarker.addEventListener('click', () => addMarker());
els.showTransliteration.addEventListener('change', updateReader);
els.autoAdvance.addEventListener('change', () => {
  if (els.autoAdvance.checked && (state.mediaRecorder?.state === 'recording' || !els.sourcePlayer.paused)) startAutoAdvance();
  else stopAutoAdvance();
});
els.advanceSeconds.addEventListener('change', () => { if (state.autoTimer) startAutoAdvance(); });

els.recordButton.addEventListener('click', startRecording);
els.pauseButton.addEventListener('click', togglePause);
els.stopButton.addEventListener('click', stopRecording);
els.audioUpload.addEventListener('change', event => loadFile(event.target.files[0]));
els.fileDrop.addEventListener('dragover', event => { event.preventDefault(); els.fileDrop.classList.add('dragging'); });
els.fileDrop.addEventListener('dragleave', () => els.fileDrop.classList.remove('dragging'));
els.fileDrop.addEventListener('drop', event => { event.preventDefault(); els.fileDrop.classList.remove('dragging'); loadFile(event.dataTransfer.files[0]); });
els.sourcePlayer.addEventListener('loadedmetadata', () => {
  state.sourceDuration = Number.isFinite(els.sourcePlayer.duration) ? els.sourcePlayer.duration : 0;
  els.sourceInfo.textContent += state.sourceDuration ? ` • ${formatTime(state.sourceDuration)}` : '';
});
els.sourcePlayer.addEventListener('play', () => { if (els.autoAdvance.checked) startAutoAdvance(); });
els.sourcePlayer.addEventListener('pause', stopAutoAdvance);
els.sourcePlayer.addEventListener('ended', stopAutoAdvance);
els.monitorInput.addEventListener('change', () => els.monitorInput.checked ? enableMonitor() : disableMonitor());

els.autoDistribute.addEventListener('click', () => autoDistributeMarkers());
els.clearMarkers.addEventListener('click', () => { state.markers = []; renderTimeline(); });
els.timelineList.addEventListener('change', event => {
  const row = event.target.closest('.marker-row');
  if (!row || !event.target.classList.contains('marker-time')) return;
  const marker = state.markers[Number(row.dataset.index)];
  if (marker) marker.time = Math.max(0, Number(event.target.value) || 0);
  state.markers.sort((a, b) => a.time - b.time);
  renderTimeline();
});
els.timelineList.addEventListener('click', event => {
  const button = event.target.closest('.marker-delete');
  if (!button) return;
  const row = button.closest('.marker-row');
  state.markers.splice(Number(row.dataset.index), 1);
  renderTimeline();
});

els.presetRow.addEventListener('click', event => {
  const button = event.target.closest('.preset');
  if (!button) return;
  if (button.dataset.preset === 'custom') {
    $$('.preset').forEach(item => item.classList.toggle('active', item === button));
  } else applyPreset(button.dataset.preset);
});
$$('[data-effect]').forEach(input => input.addEventListener('input', () => {
  syncEffectOutputs();
  $$('.preset').forEach(button => button.classList.toggle('active', button.dataset.preset === 'custom'));
}));
els.previewButton.addEventListener('click', previewEffects);
els.stopPreviewButton.addEventListener('click', stopPreview);

[els.videoTitle, els.videoSubtitle, els.videoAspect, els.videoTheme].forEach(input => input.addEventListener('input', updateExportPreview));
els.exportMp3.addEventListener('click', () => exportMedia('mp3'));
els.exportWav.addEventListener('click', () => exportMedia('wav'));
els.exportMp4.addEventListener('click', () => exportMedia('video'));

els.openSidebar.addEventListener('click', () => els.sidebar.classList.add('open'));
els.collapseSidebar.addEventListener('click', () => els.sidebar.classList.remove('open'));
els.themeToggle.addEventListener('click', () => {
  els.body.classList.toggle('light');
  const light = els.body.classList.contains('light');
  els.themeToggle.textContent = light ? '☀' : '☾';
  localStorage.setItem('tarteel-theme', light ? 'light' : 'dark');
  drawIdleWave();
});

document.addEventListener('keydown', event => {
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
  if (event.code === 'ArrowLeft') { event.preventDefault(); navigateAyah(-1, false); }
  if (event.code === 'ArrowRight' || event.code === 'Space') { event.preventDefault(); navigateAyah(1, true); }
  if (event.key.toLowerCase() === 'm') { event.preventDefault(); addMarker(); }
});

window.addEventListener('beforeunload', event => {
  if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
    event.preventDefault();
    event.returnValue = '';
  }
});

if (localStorage.getItem('tarteel-theme') === 'light') {
  els.body.classList.add('light');
  els.themeToggle.textContent = '☀';
}

syncEffectOutputs();
renderTimeline();
drawIdleWave();
listMicrophones();
loadQuran();
