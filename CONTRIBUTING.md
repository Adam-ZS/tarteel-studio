# Contributing to Tarteel Studio

Thanks for wanting to contribute! This project is a local-first Qur'an
recitation studio: a Node.js/Express server, a vanilla-JS frontend, and an
FFmpeg rendering pipeline.

## Getting started

```bash
npm install
npm start
# open http://127.0.0.1:4173
```

Development server with auto-restart:

```bash
npm run dev
```

Syntax check both server and frontend:

```bash
npm run check
```

## What to work on

- Bugs in the recording flow (`public/app.js`): timing markers, MediaRecorder
  states, waveform, marker editing.
- The FFmpeg filter chain (`server.js` → `buildFilterChain`): new effects,
  better presets, conservative fallbacks.
- Video rendering (`server.js` → `createSlide`, `renderVideo`): themes,
  layouts, typography for Arabic text.
- Deployment: `vercel.json` and the serverless compatibility layer in
  `server.js` (read-only filesystem on Vercel, so scratch files use `/tmp`).

## Pull request process

1. Fork the repo and create a branch: `git checkout -b fix/describe-change`.
2. Keep changes focused. Run `npm run check` before pushing.
3. If you changed the FFmpeg chain, verify an MP3 and an MP4 export locally
   (short recording, e.g. a few āyāt of a short sūrah).
4. Open a pull request and describe what changed and why.

## Notes

- Qur'an text comes from the `quran-json` package; do not commit Qur'an data
  directly.
- Keep the app local-first. Do not introduce telemetry or external services
  for audio processing.
- Arabic UI text is intentional; keep translations consistent when editing.
