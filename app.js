const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

if (window.electronAPI) {
  document.body.classList.add('is-app');
  const tb = document.querySelector('.toolbar');
  document.getElementById('titlebar').appendChild(tb);
}

const wrap = $('#compareWrap');
const box = $('#box');
const sliderHandle = $('#sliderHandle');
const sliderHandleV = $('#sliderHandleV');
const overlay = $('#dropOverlay');
const zoomPill = $('#zoomPill');
const toast = $('#helpToast');
const detPanel = $('#detPanel');

const panels = [...$$('.panel')];
const MAX_IMAGES = 4;

// ── Default folders (edit to change paths; set to '' to disable) ──
const DEFAULT_FOLDERS = [
  '/home/user/Documents/data training/Twinlens/generated',  // left panel  (symlink → /media/veracrypt1/.../output/Phr00t/generated)
  '/home/user/Documents/data training/Twinlens/original',   // right panel (symlink → /media/veracrypt1/.../output/Phr00t/original)
];

// ── State ─────────────────────────────────────────────────────
const slots = panels.map((panel, i) => ({
  panel,
  img: panel.querySelector('img'),
  video: panel.querySelector('video'),
  fileInput: panel.querySelector('input[type="file"]'),
  uploadBtn: panel.querySelector('.upload-btn'),
  emptyState: panel.querySelector('.empty-state'),
  labelInput: panel.querySelector('.label-text'),
  file: null,
  name: '',
  res: '',
  size: '',
  type: '',
  upscale: 1,
  mediaType: null,
  duration: 0,
  sourceUrl: null,
}));

let imageCount = 0;
let mediaMode = null;  // null | 'image' | 'video'
let mode = 'two';    // 'two' or 'multi'
let view = 'split';  // split/slider/peek | horizontal/vertical/mix
let zoomTid = null;
let fitScale = 1;
let panZoomLocked = false;
let isPlaying = false;

function clamp(v, lo, hi) { return Math.max(lo, Math.min(v, hi)); }

function fmtBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(2) + ' MB';
}

// ── Helpers ────────────────────────────────────────────────────
function isVideoFile(f) {
  if (f.type && f.type.startsWith('video/')) return true;
  return /\.(mp4|webm|mov|avi|mkv|m4v)$/i.test(f.name);
}
function isImageFile(f) {
  if (f.type && f.type.startsWith('image/')) return true;
  return /\.(jpe?g|png|gif|webp|avif|bmp|svg|heic|heif|tiff?)$/i.test(f.name);
}
function nativeW(slot) { return slot.mediaType === 'video' ? slot.video.videoWidth : slot.img.naturalWidth; }
function nativeH(slot) { return slot.mediaType === 'video' ? slot.video.videoHeight : slot.img.naturalHeight; }
function activeMedia(slot) { return slot.mediaType === 'video' ? slot.video : slot.img; }

function fmtTime(sec) {
  if (!sec || !isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return m + ':' + String(s).padStart(2, '0');
}

// ── Media loading ─────────────────────────────────────────────
function loadMediaAt(idx, file) {
  if (idx < 0 || idx >= MAX_IMAGES) return;
  const slot = slots[idx];
  const wasEmpty = !slot.file;
  const fileIsVideo = isVideoFile(file);

  if (mediaMode && ((fileIsVideo && mediaMode !== 'video') || (!fileIsVideo && mediaMode !== 'image'))) {
    showToast('No mixing. Reload to switch.');
    return;
  }

  // Only clear the panel immediately when it had no previous content;
  // when swapping to a new pair keep the old image visible until the new one loads.
  if (wasEmpty) {
    slot.panel.classList.remove('has-image', 'has-video');
    slot.img.src = '';
    slot.video.src = '';
    slot.video.removeAttribute('src');
  }

  slot.sourceUrl = null;
  slot.file = file;
  slot.name = file.name;
  slot.size = fmtBytes(file.size);
  slot.type = file.type || 'unknown';
  slot.mediaType = fileIsVideo ? 'video' : 'image';
  slot.labelInput.value = file.name;

  const url = URL.createObjectURL(file);

  if (fileIsVideo) {
    mediaMode = 'video';
    slot.video.onloadedmetadata = () => {
      slot.panel.classList.remove('has-image');
      slot.panel.classList.add('has-video');
      slot.res = slot.video.videoWidth + ' \u00d7 ' + slot.video.videoHeight;
      slot.duration = slot.video.duration || 0;
      updateMode();
      sizeImages();
      requestAnimationFrame(positionSwapZones);
      refreshDetails();
      initVideoSync();
    };
    slot.video.src = url;
  } else {
    mediaMode = 'image';
    slot.img.onload = () => {
      slot.panel.classList.remove('has-video');
      slot.panel.classList.add('has-image');
      slot.res = slot.img.naturalWidth + ' \u00d7 ' + slot.img.naturalHeight;
      slot.duration = 0;
      updateMode();
      sizeImages();
      requestAnimationFrame(positionSwapZones);
      refreshDetails();
    };
    slot.img.onerror = () => {
      // Fallback: keep has-image if there was a previous image, otherwise clear
      if (wasEmpty) slot.panel.classList.remove('has-image', 'has-video');
    };
    slot.img.src = url;
  }

  if (wasEmpty) imageCount++;
}

function loadMediaFromUrl(idx, url) {
  if (idx < 0 || idx >= MAX_IMAGES) return;
  const slot = slots[idx];
  const wasEmpty = !slot.file;

  // Extract filename from URL path
  let name;
  try { name = decodeURIComponent(new URL(url).pathname.split('/').pop()) || 'external'; }
  catch { name = 'external'; }

  const urlIsVideo = isVideoFile({ name, type: '' });

  if (mediaMode && ((urlIsVideo && mediaMode !== 'video') || (!urlIsVideo && mediaMode !== 'image'))) {
    showToast('No mixing. Reload to switch.');
    return;
  }

  if (wasEmpty) {
    slot.panel.classList.remove('has-image', 'has-video');
    slot.img.src = '';
    slot.video.src = '';
    slot.video.removeAttribute('src');
  }

  slot.sourceUrl = url;
  slot.name = name;
  slot.size = 'External';
  slot.type = '';
  slot.mediaType = urlIsVideo ? 'video' : 'image';
  slot.labelInput.value = name;
  slot.file = new File([], name); // placeholder until canvas capture

  if (urlIsVideo) {
    mediaMode = 'video';
    slot.video.crossOrigin = 'anonymous';
    slot.video.onloadedmetadata = () => {
      slot.panel.classList.remove('has-image');
      slot.panel.classList.add('has-video');
      slot.res = slot.video.videoWidth + ' \u00d7 ' + slot.video.videoHeight;
      slot.duration = slot.video.duration || 0;
      updateMode();
      sizeImages();
      requestAnimationFrame(positionSwapZones);
      refreshDetails();
      initVideoSync();
    };
    slot.video.onerror = () => {
      showToast('Could not load video from URL');
      if (wasEmpty) slot.panel.classList.remove('has-image', 'has-video');
    };
    slot.video.src = url;
  } else {
    mediaMode = 'image';
    slot.img.crossOrigin = 'anonymous';
    slot.img.onload = () => {
      slot.panel.classList.remove('has-video');
      slot.panel.classList.add('has-image');
      slot.res = slot.img.naturalWidth + ' \u00d7 ' + slot.img.naturalHeight;
      slot.duration = 0;
      updateMode();
      sizeImages();
      requestAnimationFrame(positionSwapZones);
      refreshDetails();
      // Try to capture a real File from canvas for details/thumbnail
      try {
        const c = document.createElement('canvas');
        c.width = slot.img.naturalWidth;
        c.height = slot.img.naturalHeight;
        c.getContext('2d').drawImage(slot.img, 0, 0);
        c.toBlob(blob => {
          if (blob) {
            slot.file = new File([blob], name, { type: 'image/png' });
            slot.size = fmtBytes(blob.size);
            refreshDetails();
          }
        });
      } catch (_) { /* CORS tainted — keep placeholder */ }
    };
    slot.img.onerror = () => {
      showToast('Could not load image from URL');
      if (wasEmpty) slot.panel.classList.remove('has-image', 'has-video');
    };
    slot.img.src = url;
  }

  if (wasEmpty) imageCount++;
}

function clearAll() {
  pauseAllVideos();
  slots.forEach(s => {
    s.file = null;
    s.name = '';
    s.res = '';
    s.size = '';
    s.type = '';
    s.upscale = 1;
    s.mediaType = null;
    s.duration = 0;
    s.sourceUrl = null;
    s.img.src = '';
    s.video.src = '';
    s.video.removeAttribute('src');
    s.labelInput.value = '';
    s.panel.classList.remove('has-image', 'has-video');
    const strip = s.panel.querySelector('.folder-strip');
    if (strip) { strip.innerHTML = ''; strip.classList.add('hidden'); }
  });
  imageCount = 0;
  mediaMode = null;
  isPlaying = false;
  folderSides = [null, null];
  folderPairs = [];
  currentPairIdx = -1;
  updateFolderNav();
  updateMode();
  refreshDetails();
  updateVideoControls();
}

async function normaliseFiles(files) {
  const out = [];
  for (const f of Array.from(files)) {
    if (isVideoFile(f)) { out.push(f); continue; }
    const ext = f.name.split('.').pop().toLowerCase();
    const isHeic = /heic|heif/.test(ext) || /heic|heif/.test(f.type);
    const isTiff = /tiff?$/.test(ext)    || f.type === 'image/tiff';
    if (isHeic && typeof heic2any !== 'undefined') {
      try {
        const blob = await heic2any({ blob: f, toType: 'image/png' });
        out.push(new File([blob], f.name.replace(/\.(heic|heif)$/i, '.png'), { type: 'image/png' }));
      } catch (_) { out.push(f); }
    } else if (isTiff && typeof UTIF !== 'undefined') {
      try {
        const buf  = await f.arrayBuffer();
        const ifds = UTIF.decode(buf);
        UTIF.decodeImage(buf, ifds[0]);
        const rgba = new Uint8ClampedArray(ifds[0].data);
        const w = ifds[0].width, h = ifds[0].height;
        const c  = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').putImageData(new ImageData(rgba, w, h), 0, 0);
        const png = await new Promise(r => c.toBlob(r, 'image/png'));
        out.push(new File([png], f.name.replace(/\.tiff?$/i, '.png'), { type: 'image/png' }));
      } catch (_) { out.push(f); }
    } else {
      out.push(f);
    }
  }
  return out;
}

function addMedia(files, targetIdx) {
  const media = Array.from(files).filter(f => isImageFile(f) || isVideoFile(f));
  if (!media.length) return;

  const hasVideo = media.some(isVideoFile);
  const maxSlots = hasVideo ? 2 : MAX_IMAGES;

  if (media.length === 1) {
    if (targetIdx != null && targetIdx >= 0 && targetIdx < maxSlots) {
      loadMediaAt(targetIdx, media[0]);
    } else {
      const emptyIdx = slots.findIndex(s => !s.file);
      if (emptyIdx !== -1) loadMediaAt(emptyIdx, media[0]);
    }
    return;
  }

  const emptySlots = slots.filter(s => !s.file).length;
  if (imageCount > 0 && media.length <= emptySlots) {
    for (const f of media) {
      const idx = slots.findIndex(s => !s.file);
      if (idx === -1) break;
      loadMediaAt(idx, f);
    }
  } else {
    clearAll();
    for (let i = 0; i < Math.min(media.length, maxSlots); i++) {
      loadMediaAt(i, media[i]);
    }
  }
}

// ── Mode & panel visibility ───────────────────────────────────
function updateMode() {
  const prevMode = mode;
  const isVideo = mediaMode === 'video';
  mode = (!isVideo && imageCount > 2) ? 'multi' : 'two';

  const visibleCount = isVideo ? Math.min(Math.max(imageCount, 2), 2) : Math.max(imageCount, 2);
  panels.forEach((p, i) => p.classList.toggle('hidden', i >= visibleCount));

  $$('[data-mode="two"]').forEach(b => b.classList.toggle('hidden', mode !== 'two'));
  $$('[data-mode="multi"]').forEach(b => b.classList.toggle('hidden', mode !== 'multi'));
  $('#sepSwap').classList.remove('hidden');
  const inFolderMode = !!(folderSides[0] || folderSides[1]);
  $('#btnAdd').classList.toggle('hidden', isVideo || imageCount >= MAX_IMAGES || inFolderMode);

  if (mode !== prevMode) {
    if (mode === 'multi') setView('horizontal');
    else setView('split');
  }

  box.dataset.count = visibleCount;
  updateVideoControls();
}

// ── View switching ────────────────────────────────────────────
function setView(v) {
  view = v;
  const hadLabels = box.classList.contains('labels-visible');
  box.className = 'compare-box view-' + v;
  if (hadLabels) box.classList.add('labels-visible');
  box.dataset.count = Math.max(imageCount, 2);
  $$('[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  $('#animDurControl').classList.toggle('hidden', v !== 'slider-v');
  cancelSliderVAnim();
  box.style.setProperty('--slider-pct-v', '10%');
  sizeImages();
  requestAnimationFrame(positionSwapZones);

  const msgs = {
    split: 'Side-by-side comparison.',
    slider: 'Drag the slider to reveal.',
    'slider-v': 'Drag the slider to reveal.',
    peek: 'Click and hold to peek.',
    horizontal: 'Images arranged horizontally.',
    vertical: 'Images stacked vertically.',
    mix: 'Grid layout.',
  };
  showToast(msgs[v] || '');
}

$$('[data-view]').forEach(b => b.addEventListener('click', () => {
  if (!b.classList.contains('hidden')) setView(b.dataset.view);
}));

// ── Media sizing ──────────────────────────────────────────────
function sizeImages() {
  const loaded = slots.filter((s, i) => nativeW(s) && !panels[i].classList.contains('hidden'));
  if (!loaded.length) return;

  const anchorW = Math.max(...loaded.map(s => nativeW(s)));
  const anchorH = Math.max(...loaded.map(s => nativeH(s)));

  loaded.forEach(slot => {
    const rect = slot.panel.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const panelFit = Math.min(rect.width / anchorW, rect.height / anchorH, 1);
    const imageScale = Math.min(anchorW / nativeW(slot), anchorH / nativeH(slot)) * panelFit;
    const displayW = Math.round(nativeW(slot) * imageScale);
    const displayH = Math.round(nativeH(slot) * imageScale);

    const el = activeMedia(slot);
    el.style.width = displayW + 'px';
    el.style.height = displayH + 'px';

    const scaleX = displayW / nativeW(slot);
    const scaleY = displayH / nativeH(slot);
    slot.upscale = Math.max(scaleX, scaleY);

    fitScale = panelFit;
  });

  if (pendingSliderVAnim && view === 'slider-v') {
    pendingSliderVAnim = false;
    animateSliderV();
  }
}

window.addEventListener('resize', () => { sizeImages(); positionSwapZones(); });

// ── Swap zones (clickable dividers in multi-image mode) ───────
const swapIconH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 5h18"/><polyline points="7 23 3 19 7 15"/><path d="M21 19H3"/></svg>';
const swapIconV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 7 5 3 9 7"/><path d="M5 3v18"/><polyline points="23 17 19 21 15 17"/><path d="M19 21V3"/></svg>';
const swapZones = [];
for (let i = 0; i < 5; i++) {
  const z = document.createElement('div');
  z.className = 'swap-zone';
  z.innerHTML = swapIconH;
  z.addEventListener('click', e => {
    e.stopPropagation();
    swapSlots(parseInt(z.dataset.a), parseInt(z.dataset.b));
  });
  box.appendChild(z);
  swapZones.push(z);
}

function swapSlots(a, b) {
  const sa = slots[a], sb = slots[b];
  sa.img.onload = null;
  sb.img.onload = null;

  [sa.img.src, sb.img.src] = [sb.img.src, sa.img.src];
  [sa.video.src, sb.video.src] = [sb.video.src, sa.video.src];
  [sa.file, sb.file] = [sb.file, sa.file];
  [sa.name, sb.name] = [sb.name, sa.name];
  [sa.res, sb.res] = [sb.res, sa.res];
  [sa.size, sb.size] = [sb.size, sa.size];
  [sa.type, sb.type] = [sb.type, sa.type];
  [sa.upscale, sb.upscale] = [sb.upscale, sa.upscale];
  [sa.mediaType, sb.mediaType] = [sb.mediaType, sa.mediaType];
  [sa.duration, sb.duration] = [sb.duration, sa.duration];

  [sa.labelInput.value, sb.labelInput.value] = [sb.labelInput.value, sa.labelInput.value];

  const aImg = sa.panel.classList.contains('has-image');
  const aVid = sa.panel.classList.contains('has-video');
  const bImg = sb.panel.classList.contains('has-image');
  const bVid = sb.panel.classList.contains('has-video');
  sa.panel.classList.toggle('has-image', bImg);
  sa.panel.classList.toggle('has-video', bVid);
  sb.panel.classList.toggle('has-image', aImg);
  sb.panel.classList.toggle('has-video', aVid);

  sizeImages();
  refreshDetails();
  requestAnimationFrame(positionSwapZones);
}

function positionSwapZones() {
  swapZones.forEach(z => { z.style.display = 'none'; z.style.width = ''; z.style.height = ''; });
  if (mode !== 'multi') return;

  const bx = box.getBoundingClientRect();
  const pad = 20;
  let zi = 0;

  for (let i = 0; i < imageCount && zi < swapZones.length; i++) {
    if (panels[i].classList.contains('hidden')) continue;
    for (let j = i + 1; j < imageCount && zi < swapZones.length; j++) {
      if (panels[j].classList.contains('hidden')) continue;

      const ri = panels[i].getBoundingClientRect();
      const rj = panels[j].getBoundingClientRect();

      const vGap = Math.min(Math.abs(ri.right - rj.left), Math.abs(rj.right - ri.left));
      const overlapTop = Math.max(ri.top, rj.top);
      const overlapBot = Math.min(ri.bottom, rj.bottom);
      const vOverlap = overlapBot - overlapTop;

      if (vGap <= 3 && vOverlap > 20) {
        const z = swapZones[zi++];
        const edge = Math.min(ri.right, rj.right);
        z.dataset.a = i; z.dataset.b = j;
        z.innerHTML = swapIconH;
        z.style.display = 'flex';
        z.style.left = (edge - bx.left - pad / 2) + 'px';
        z.style.top = (overlapTop - bx.top) + 'px';
        z.style.width = pad + 'px';
        z.style.height = vOverlap + 'px';
        continue;
      }

      const hGap = Math.min(Math.abs(ri.bottom - rj.top), Math.abs(rj.bottom - ri.top));
      const overlapLeft = Math.max(ri.left, rj.left);
      const overlapRight = Math.min(ri.right, rj.right);
      const hOverlap = overlapRight - overlapLeft;

      if (hGap <= 3 && hOverlap > 20) {
        const z = swapZones[zi++];
        const edge = Math.min(ri.bottom, rj.bottom);
        z.dataset.a = i; z.dataset.b = j;
        z.innerHTML = swapIconV;
        z.style.display = 'flex';
        z.style.left = (overlapLeft - bx.left) + 'px';
        z.style.top = (edge - bx.top - pad / 2) + 'px';
        z.style.width = hOverlap + 'px';
        z.style.height = pad + 'px';
        continue;
      }
    }
  }
}

// ── Image quality metrics (PSNR / SSIM) ──────────────────────
const METRIC_CAP = 512; // max px per side for fast calculation

function getPixels(imgEl, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(imgEl, 0, 0, w, h);
  return c.getContext('2d').getImageData(0, 0, w, h).data;
}

function calcPSNR(d1, d2) {
  const n = d1.length;
  let mse = 0;
  for (let i = 0; i < n; i += 4) {
    const dr = d1[i]   - d2[i];
    const dg = d1[i+1] - d2[i+1];
    const db = d1[i+2] - d2[i+2];
    // luminance-weighted MSE
    mse += 0.299*dr*dr + 0.587*dg*dg + 0.114*db*db;
  }
  mse /= (n / 4);
  if (mse === 0) return Infinity;
  return 20 * Math.log10(255) - 10 * Math.log10(mse);
}

function calcSSIM(d1, d2) {
  const C1 = (0.01 * 255) ** 2;
  const C2 = (0.03 * 255) ** 2;
  const n = d1.length / 4;
  let s1 = 0, s2 = 0, s1s = 0, s2s = 0, s12 = 0;
  for (let i = 0; i < d1.length; i += 4) {
    const y1 = 0.299*d1[i] + 0.587*d1[i+1] + 0.114*d1[i+2];
    const y2 = 0.299*d2[i] + 0.587*d2[i+1] + 0.114*d2[i+2];
    s1 += y1; s2 += y2; s1s += y1*y1; s2s += y2*y2; s12 += y1*y2;
  }
  const mu1 = s1/n, mu2 = s2/n;
  const v1 = s1s/n - mu1*mu1, v2 = s2s/n - mu2*mu2;
  const cov = s12/n - mu1*mu2;
  return ((2*mu1*mu2 + C1) * (2*cov + C2)) /
         ((mu1*mu1 + mu2*mu2 + C1) * (v1 + v2 + C2));
}

function psnrClass(v) {
  if (!isFinite(v)) return 'metric-good';
  if (v >= 38) return 'metric-good';
  if (v >= 28) return 'metric-ok';
  return 'metric-poor';
}
function ssimClass(v) {
  if (v >= 0.95) return 'metric-good';
  if (v >= 0.80) return 'metric-ok';
  return 'metric-poor';
}

async function fillMetrics(refImg, cmpImg, colEl) {
  // yield to let the panel render before doing heavy canvas work
  await new Promise(r => requestAnimationFrame(r));
  try {
    const rw = refImg.naturalWidth, rh = refImg.naturalHeight;
    const scale = Math.min(1, METRIC_CAP / Math.max(rw, rh));
    const w = Math.max(1, Math.round(rw * scale));
    const h = Math.max(1, Math.round(rh * scale));
    const d1 = getPixels(refImg, w, h);
    const d2 = getPixels(cmpImg, w, h);
    const psnr = calcPSNR(d1, d2);
    const ssim = calcSSIM(d1, d2);
    const psnrStr = isFinite(psnr) ? psnr.toFixed(2) + ' dB' : '∞ dB';
    const ssimStr = ssim.toFixed(4);
    const pRow = colEl.querySelector('.metric-psnr');
    const sRow = colEl.querySelector('.metric-ssim');
    if (pRow) pRow.innerHTML = `<span class="key">PSNR</span><span class="val ${psnrClass(psnr)}">${psnrStr}</span>`;
    if (sRow) sRow.innerHTML = `<span class="key">SSIM</span><span class="val ${ssimClass(ssim)}">${ssimStr}</span>`;
  } catch (_) {
    colEl.querySelector('.metric-psnr')?.remove();
    colEl.querySelector('.metric-ssim')?.remove();
  }
}

// ── Details panel ─────────────────────────────────────────────
function refreshDetails(withMetrics = false) {
  detPanel.innerHTML = '';
  const refSlot = slots[0];
  slots.forEach((slot, i) => {
    if (!slot.file) return;
    const col = document.createElement('div');
    col.className = 'details-column';
    let html =
      `<div class="title">${slot.name}</div>` +
      `<div class="details-row"><span class="key">Resolution</span><span class="val">${slot.res || '\u2014'}</span></div>` +
      `<div class="details-row"><span class="key">Size</span><span class="val">${slot.size}</span></div>` +
      `<div class="details-row"><span class="key">Type</span><span class="val">${slot.type}</span></div>`;
    if (slot.mediaType === 'video' && slot.duration) {
      html += `<div class="details-row"><span class="key">Duration</span><span class="val">${fmtTime(slot.duration)}</span></div>`;
    }
    if (slot.upscale > 1.01) {
      html += `<div class="details-row"><span class="key">Upscaled</span><span class="val">${slot.upscale.toFixed(2)}×</span></div>`;
    }
    // PSNR / SSIM vs panel 0 (skip for panel 0 itself and for videos)
    if (withMetrics && i > 0 && slot.mediaType === 'image' && refSlot?.mediaType === 'image') {
      html += `<div class="details-sep"></div>` +
        `<div class="details-row metric-psnr"><span class="key">PSNR</span><span class="val metric-calc">·····</span></div>` +
        `<div class="details-row metric-ssim"><span class="key">SSIM</span><span class="val metric-calc">·····</span></div>`;
    }
    col.innerHTML = html;
    detPanel.appendChild(col);
    if (withMetrics && i > 0 && slot.mediaType === 'image' && refSlot?.mediaType === 'image') {
      fillMetrics(refSlot.img, slot.img, col);
    }
  });
}

$('#btnDet').addEventListener('click', () => {
  const isOpening = !detPanel.classList.contains('visible');
  document.getElementById('detCheck').classList.toggle('on', isOpening);
  refreshDetails(isOpening);
  detPanel.classList.toggle('visible');
});

$('#btnLabel').addEventListener('click', () => {
  $('#btnLabel').classList.toggle('active');
  box.classList.toggle('labels-visible');
});

// ── Snapshot ──────────────────────────────────────────────────
function captureViewBlob(mimeType, quality) {
  return new Promise(resolve => {
    const boxRect = box.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.round(boxRect.width * dpr);
    const ch = Math.round(boxRect.height * dpr);
    const canvas = document.createElement('canvas');
    canvas.width = cw; canvas.height = ch;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#111';
    ctx.fillRect(0, 0, boxRect.width, boxRect.height);

    const cs = getComputedStyle(box);
    const labelsOn = box.classList.contains('labels-visible');
    const isSlider = view === 'slider';
    const isSliderV = view === 'slider-v';
    const sliderPct = isSlider ? parseFloat(cs.getPropertyValue('--slider-pct')) / 100 : 1;
    const sliderPctV = isSliderV ? parseFloat(cs.getPropertyValue('--slider-pct-v')) / 100 : 1;

    const visibleSlots = [];
    slots.forEach((slot, i) => {
      if (!slot.file || panels[i].classList.contains('hidden')) return;
      const pr = panels[i].getBoundingClientRect();
      const px = Math.round(pr.left - boxRect.left);
      const py = Math.round(pr.top - boxRect.top);
      const pw = Math.round(pr.width);
      const ph = Math.round(pr.height);
      visibleSlots.push({ slot, i, px, py, pw, ph });

      ctx.save();
      if (isSlider && mode === 'two') {
        ctx.beginPath();
        if (i === 0) ctx.rect(0, 0, boxRect.width * sliderPct, boxRect.height);
        else ctx.rect(boxRect.width * sliderPct, 0, boxRect.width * (1 - sliderPct), boxRect.height);
        ctx.clip();
      } else if (isSliderV && mode === 'two') {
        ctx.beginPath();
        if (i === 0) ctx.rect(0, 0, boxRect.width, boxRect.height * sliderPctV);
        else ctx.rect(0, boxRect.height * sliderPctV, boxRect.width, boxRect.height * (1 - sliderPctV));
        ctx.clip();
      }
      ctx.beginPath();
      ctx.rect(px, py, pw, ph);
      ctx.clip();

      const el = activeMedia(slot);
      const ir = el.getBoundingClientRect();
      ctx.drawImage(el, ir.left - boxRect.left, ir.top - boxRect.top, ir.width, ir.height);
      ctx.restore();
    });

    // Panel borders (split/multi views)
    if (!isSlider && !isSliderV && view !== 'peek') {
      ctx.save();
      ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--border').trim() || '#2a2a30';
      ctx.lineWidth = 1;
      for (let j = 1; j < visibleSlots.length; j++) {
        const p = visibleSlots[j];
        ctx.beginPath();
        if (p.px > 0) { ctx.moveTo(p.px, p.py); ctx.lineTo(p.px, p.py + p.ph); }
        if (p.py > 0) { ctx.moveTo(p.px, p.py); ctx.lineTo(p.px + p.pw, p.py); }
        ctx.stroke();
      }
      ctx.restore();
    }

    // Slider line
    if (isSlider && mode === 'two') {
      const sx = boxRect.width * sliderPct;
      ctx.save();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, boxRect.height); ctx.stroke();
      ctx.restore();
    }
    if (isSliderV && mode === 'two') {
      const sy = boxRect.height * sliderPctV;
      ctx.save();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(boxRect.width, sy); ctx.stroke();
      ctx.restore();
    }

    // Labels (drawn after all panels, with slider clip if needed)
    if (labelsOn) {
      visibleSlots.forEach(({ slot, i }) => {
        if (!slot.labelInput.value) return;
        const label = slot.labelInput.value;
        const labelEl = slot.panel.querySelector('.panel-label');
        const labelRect = labelEl.getBoundingClientRect();
        const lx = Math.round(labelRect.left - boxRect.left);
        const ly = Math.round(labelRect.top - boxRect.top);
        const lw = Math.round(labelRect.width);
        const lh = Math.round(labelRect.height);
        ctx.save();
        if (isSlider && mode === 'two') {
          ctx.beginPath();
          if (i === 0) ctx.rect(0, 0, boxRect.width * sliderPct, boxRect.height);
          else ctx.rect(boxRect.width * sliderPct, 0, boxRect.width * (1 - sliderPct), boxRect.height);
          ctx.clip();
        } else if (isSliderV && mode === 'two') {
          ctx.beginPath();
          if (i === 0) ctx.rect(0, 0, boxRect.width, boxRect.height * sliderPctV);
          else ctx.rect(0, boxRect.height * sliderPctV, boxRect.width, boxRect.height * (1 - sliderPctV));
          ctx.clip();
        }
        ctx.fillStyle = 'rgba(0,0,0,.55)';
        ctx.beginPath();
        ctx.roundRect(lx, ly, lw, lh, 8);
        ctx.fill();
        ctx.font = '500 12px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(255,255,255,.85)';
        const textRect = slot.labelInput.getBoundingClientRect();
        ctx.fillText(label, Math.round(textRect.left - boxRect.left), Math.round(textRect.top - boxRect.top + textRect.height / 2));
        ctx.restore();
      });
    }

    canvas.toBlob(resolve, mimeType, quality);
  });
}

$('#btnSnap').addEventListener('click', async () => {
  let blob;
  try { blob = await captureViewBlob('image/png'); }
  catch { showToast('Cannot snapshot — external images may block canvas export'); return; }
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const datePart = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
  const timePart = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const filename = `snap_${datePart}_${timePart}.png`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);

});

$('#btnReload').addEventListener('click', () => {
  location.reload();
});

// ── Toast ─────────────────────────────────────────────────────
function showToast(msg) {
  if (!msg) { toast.style.display = 'none'; return; }
  toast.style.display = '';
  toast.textContent = msg;
  toast.style.animation = 'none';
  void toast.offsetHeight;
  toast.style.animation = '';
}

// ── Slider drag ───────────────────────────────────────────────
let sliderDragging = false;

sliderHandle.addEventListener('mousedown', e => {
  e.stopPropagation();
  sliderDragging = true;
  sliderHandle.classList.add('active');
  updateSliderX(e.clientX);
});
window.addEventListener('mousemove', e => { if (sliderDragging) updateSliderX(e.clientX); });
window.addEventListener('mouseup', () => {
  if (sliderDragging) { sliderDragging = false; sliderHandle.classList.remove('active'); }
});
sliderHandle.addEventListener('touchstart', e => {
  e.stopPropagation();
  sliderDragging = true;
  sliderHandle.classList.add('active');
  updateSliderX(e.touches[0].clientX);
}, { passive: false });
window.addEventListener('touchmove', e => {
  if (sliderDragging) { e.preventDefault(); updateSliderX(e.touches[0].clientX); }
}, { passive: false });
window.addEventListener('touchend', () => {
  if (sliderDragging) { sliderDragging = false; sliderHandle.classList.remove('active'); }
});

function updateSliderX(clientX) {
  const rect = wrap.getBoundingClientRect();
  const pct = clamp((clientX - rect.left) / rect.width * 100, 0, 100);
  box.style.setProperty('--slider-pct', pct + '%');
}

// ── Vertical Slider drag ──────────────────────────────────────
let sliderVDragging = false;
let sliderVAnimId = null;
let pendingSliderVAnim = false;

const animDurValEl = $('#animDurVal');
let sliderVDuration = Math.round((parseFloat(localStorage.getItem('tl-slider-v-dur')) || 5) * 10) / 10;
function setSliderVDuration(s) {
  sliderVDuration = Math.max(0.5, Math.round(s * 10) / 10);
  localStorage.setItem('tl-slider-v-dur', sliderVDuration);
  animDurValEl.textContent = sliderVDuration.toFixed(1) + 's';
}
setSliderVDuration(sliderVDuration);
$('#btnDurDec').addEventListener('click', () => setSliderVDuration(sliderVDuration - 0.5));
$('#btnDurInc').addEventListener('click', () => setSliderVDuration(sliderVDuration + 0.5));

function cancelSliderVAnim() {
  if (sliderVAnimId) { cancelAnimationFrame(sliderVAnimId); sliderVAnimId = null; }
  pendingSliderVAnim = false;
}

function animateSliderV() {
  cancelSliderVAnim();
  const containerH = box.getBoundingClientRect().height;
  const imageH = (activeMedia(slots[0]).offsetHeight || activeMedia(slots[1]).offsetHeight) || 0;
  const from = imageH ? (containerH - imageH) / 2 / containerH * 100 : 10;
  const to   = imageH ? (containerH + imageH) / 2 / containerH * 100 : 90;
  const start = performance.now(), duration = sliderVDuration * 1000;
  function step(now) {
    const t = Math.min((now - start) / duration, 1);
    const ease = t < 0.6
      ? 0.5 * (t / 0.6) * (2 - t / 0.6)
      : 0.5 + 0.5 * ((t - 0.6) / 0.4) * ((t - 0.6) / 0.4);
    box.style.setProperty('--slider-pct-v', (from + (to - from) * ease) + '%');
    if (t < 1) sliderVAnimId = requestAnimationFrame(step);
    else sliderVAnimId = null;
  }
  sliderVAnimId = requestAnimationFrame(step);
}

sliderHandleV.addEventListener('mousedown', e => {
  e.stopPropagation();
  cancelSliderVAnim();
  sliderVDragging = true;
  sliderHandleV.classList.add('active');
  updateSliderY(e.clientY);
});
window.addEventListener('mousemove', e => { if (sliderVDragging) updateSliderY(e.clientY); });
window.addEventListener('mouseup', () => {
  if (sliderVDragging) { sliderVDragging = false; sliderHandleV.classList.remove('active'); }
});
sliderHandleV.addEventListener('touchstart', e => {
  e.stopPropagation();
  cancelSliderVAnim();
  sliderVDragging = true;
  sliderHandleV.classList.add('active');
  updateSliderY(e.touches[0].clientY);
}, { passive: false });
window.addEventListener('touchmove', e => {
  if (sliderVDragging) { e.preventDefault(); updateSliderY(e.touches[0].clientY); }
}, { passive: false });
window.addEventListener('touchend', () => {
  if (sliderVDragging) { sliderVDragging = false; sliderHandleV.classList.remove('active'); }
});

function updateSliderY(clientY) {
  const rect = wrap.getBoundingClientRect();
  const pct = clamp((clientY - rect.top) / rect.height * 100, 0, 100);
  box.style.setProperty('--slider-pct-v', pct + '%');
}

// ── Peek ──────────────────────────────────────────────────────
wrap.addEventListener('pointerdown', e => {
  if (view === 'peek' && !e.target.closest('.toolbar, .panel-label, .upload-btn, .empty-state, .menu-panel, .details-panel, .nav-zone'))
    box.classList.add('peeking');
});
wrap.addEventListener('pointerup', () => { if (view === 'peek') box.classList.remove('peeking'); });

// ── Zoom ──────────────────────────────────────────────────────
function showZoom(imgScale) {
  zoomPill.textContent = Math.round(fitScale * imgScale * 100) + '%';
  zoomPill.classList.add('show');
  clearTimeout(zoomTid);
  zoomTid = setTimeout(() => zoomPill.classList.remove('show'), 800);
}

wrap.addEventListener('wheel', e => {
  if (!$('#pairGallery').classList.contains('hidden') && e.target.closest('.pg-box')) return;
  e.preventDefault();
  if (panZoomLocked) return;
  const delta = e.ctrlKey ? e.deltaY * 0.5 : e.deltaY;
  const f = 1 - clamp(delta, -15, 15) * 0.01;
  zoomBy(f);
}, { passive: false });

function zoomBy(factor) {
  const cs = getComputedStyle(box);
  const cur = parseFloat(cs.getPropertyValue('--img-scale'));
  const next = clamp(cur * factor, 0.1, 40);
  box.style.setProperty('--img-scale', next);
  showZoom(next);
}

// ── Pan ───────────────────────────────────────────────────────
let dragging = false, sx = 0, sy = 0;

wrap.addEventListener('mousedown', e => {
  if (panZoomLocked) return;
  if (e.target.closest('.slider-handle, .slider-handle-v, .panel-label, .toolbar, .upload-btn, .empty-state, .swap-zone, .menu-panel')) return;
  dragging = true; sx = e.clientX; sy = e.clientY;
  wrap.classList.add('dragging');
});
window.addEventListener('mousemove', e => {
  if (!dragging) return;
  const cs = getComputedStyle(box);
  const sc = parseFloat(cs.getPropertyValue('--img-scale'));
  const ox = parseFloat(cs.getPropertyValue('--img-tx'));
  const oy = parseFloat(cs.getPropertyValue('--img-ty'));
  box.style.setProperty('--img-tx', (ox + (e.clientX - sx) / sc) + 'px');
  box.style.setProperty('--img-ty', (oy + (e.clientY - sy) / sc) + 'px');
  sx = e.clientX; sy = e.clientY;
});
window.addEventListener('mouseup', () => { dragging = false; wrap.classList.remove('dragging'); });

// ── Mobile touch: single-finger pan + two-finger pinch ────────
let pinchDist = null, pinchScale = null, pinchX = null, pinchY = null;
let touchPan = false, touchX = 0, touchY = 0, touchStartX = 0, touchStartY = 0;
let lastTapTime = 0, lastTapX = 0, lastTapY = 0;

function tdist(t) {
  const dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY;
  return Math.sqrt(dx*dx + dy*dy);
}

wrap.addEventListener('touchstart', e => {
  if (panZoomLocked) {
    if (view === 'slider-v' && e.touches.length === 1 &&
        !e.target.closest('.slider-handle-v, .toolbar, .upload-btn, .empty-state, .swap-zone, .menu-panel, .nav-zone')) {
      touchPan = true;
      touchStartX = touchX = e.touches[0].clientX;
      touchStartY = touchY = e.touches[0].clientY;
    }
    return;
  }
  if (e.touches.length === 2) {
    touchPan = false;
    pinchDist = tdist(e.touches);
    pinchScale = parseFloat(getComputedStyle(box).getPropertyValue('--img-scale'));
    pinchX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
    pinchY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
  } else if (e.touches.length === 1) {
    if (e.target.closest('.slider-handle, .slider-handle-v, .panel-label, .toolbar, .upload-btn, .empty-state, .swap-zone, .menu-panel')) return;
    touchPan = true;
    touchStartX = touchX = e.touches[0].clientX;
    touchStartY = touchY = e.touches[0].clientY;
  }
}, { passive: true });

wrap.addEventListener('touchmove', e => {
  if (panZoomLocked) return;
  if (e.touches.length >= 2 && pinchDist) {
    touchPan = false;
    const s = clamp((tdist(e.touches) / pinchDist) * pinchScale, 0.1, 40);
    box.style.setProperty('--img-scale', s);
    showZoom(s);
    const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
    const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    const cs = getComputedStyle(box);
    const sc = parseFloat(cs.getPropertyValue('--img-scale'));
    const ox = parseFloat(cs.getPropertyValue('--img-tx'));
    const oy = parseFloat(cs.getPropertyValue('--img-ty'));
    box.style.setProperty('--img-tx', (ox + (cx - pinchX) / sc) + 'px');
    box.style.setProperty('--img-ty', (oy + (cy - pinchY) / sc) + 'px');
    pinchX = cx; pinchY = cy;
  } else if (e.touches.length === 1 && touchPan) {
    const cs = getComputedStyle(box);
    const sc = parseFloat(cs.getPropertyValue('--img-scale'));
    const ox = parseFloat(cs.getPropertyValue('--img-tx'));
    const oy = parseFloat(cs.getPropertyValue('--img-ty'));
    const dx = e.touches[0].clientX - touchX;
    const dy = e.touches[0].clientY - touchY;
    box.style.setProperty('--img-tx', (ox + dx / sc) + 'px');
    box.style.setProperty('--img-ty', (oy + dy / sc) + 'px');
    touchX = e.touches[0].clientX;
    touchY = e.touches[0].clientY;
  }
}, { passive: true });

wrap.addEventListener('touchend', e => {
  const wasPinch = pinchDist !== null;
  pinchDist = null;
  const wasTouchOnArea = touchPan;
  touchPan = false;

  if (!wasTouchOnArea || wasPinch || e.changedTouches.length !== 1) return;
  const t = e.changedTouches[0];
  const moved = Math.hypot(t.clientX - touchStartX, t.clientY - touchStartY) > 10;
  if (moved) return; // was a pan, not a tap

  const now = Date.now();
  const dtx = t.clientX - lastTapX, dty = t.clientY - lastTapY;
  const nearSameSpot = Math.hypot(dtx, dty) < 40;
  if (now - lastTapTime < 300 && nearSameSpot) {
    // Double-tap detected — repurpose logic here
    lastTapTime = 0;
  } else {
    lastTapTime = now;
    lastTapX = t.clientX;
    lastTapY = t.clientY;
  }
});

// Safari trackpad pinch fires gesture events instead of wheel
let gestureBaseScale = 1;
function isGalleryEvent(e) {
  return !$('#pairGallery').classList.contains('hidden') && e.target.closest('.pg-box');
}
wrap.addEventListener('gesturestart', e => {
  if (isGalleryEvent(e)) return;
  e.preventDefault();
  if (panZoomLocked) return;
  gestureBaseScale = parseFloat(getComputedStyle(box).getPropertyValue('--img-scale'));
});
wrap.addEventListener('gesturechange', e => {
  if (isGalleryEvent(e)) return;
  e.preventDefault();
  if (panZoomLocked) return;
  const next = clamp(gestureBaseScale * e.scale, 0.1, 40);
  box.style.setProperty('--img-scale', next);
  showZoom(next);
});
wrap.addEventListener('gestureend', e => { if (!isGalleryEvent(e)) e.preventDefault(); });

// ── Fit / Actual ──────────────────────────────────────────────
function resetTransform() {
  box.style.setProperty('--img-scale', 1);
  box.style.setProperty('--img-tx', '0px');
  box.style.setProperty('--img-ty', '0px');
  box.style.setProperty('--slider-pct', '50%');
  box.style.setProperty('--slider-pct-v', '10%');
}

$('#btnFit').addEventListener('click', () => {
  resetTransform(); sizeImages(); showZoom(1);
  $('#btnFit').classList.add('active');
  $('#btnActual').classList.remove('active');
});

$('#btnActual').addEventListener('click', () => {
  if (!fitScale) return;
  resetTransform();
  const s = 1 / fitScale;
  box.style.setProperty('--img-scale', s);
  showZoom(s);
  $('#btnActual').classList.add('active');
  $('#btnFit').classList.remove('active');
});

// ── Swap (global — all adjacent slot pairs + folder state) ───
$('#btnSwap').addEventListener('click', () => {
  // Swap all adjacent pairs: (0,1), (2,3), …
  for (let i = 0; i + 1 < imageCount; i += 2) swapSlots(i, i + 1);

  // Keep folder logical state in sync
  if (folderSides[0] && folderSides[1]) {
    [folderSides[0], folderSides[1]] = [folderSides[1], folderSides[0]];
    folderPairs = folderPairs.map(p => ({ left: p.right, right: p.left }));
    buildFolderStrip(0, folderSides[0].files);
    buildFolderStrip(1, folderSides[1].files);
    if (currentPairIdx >= 0 && folderPairs[currentPairIdx]) {
      const p = folderPairs[currentPairIdx];
      setActiveStrip(0, folderSides[0].files.indexOf(p.left));
      setActiveStrip(1, folderSides[1].files.indexOf(p.right));
    }
  }
});

// ── Add image button ──────────────────────────────────────────
$('#btnAdd').addEventListener('click', () => {
  const nextIdx = slots.findIndex(s => !s.file);
  if (nextIdx === -1 || nextIdx >= MAX_IMAGES) return;
  // Reveal the panel immediately so the user sees where the image will land
  if (nextIdx >= Math.max(imageCount, 2)) {
    panels[nextIdx].classList.remove('hidden');
    box.dataset.count = nextIdx + 1;
  }
  // Open that panel's own file input — image is guaranteed to go there
  slots[nextIdx].fileInput.click();
});

// ── Per-panel upload & empty-state click ──────────────────────
slots.forEach((slot, i) => {
  slot.uploadBtn.addEventListener('click', () => slot.fileInput.click());
  slot.emptyState.addEventListener('click', () => slot.fileInput.click());
  slot.fileInput.addEventListener('change', e => {
    const raw = Array.from(e.target.files);
    e.target.value = '';
    if (!raw.length) return;
    // ZIP → folder mode (iOS workaround: zip a folder, then pick the .zip)
    if (raw.length === 1 && raw[0].name.toLowerCase().endsWith('.zip')) {
      const side = i <= 1 ? i : (folderSides[0] ? 1 : 0);
      extractZip(raw[0])
        .then(({ files, name }) => setFolderSide(side, files, name))
        .catch(() => showToast('Could not read ZIP file'));
      return;
    }
    // How many slots are available from this panel onwards
    const available = MAX_IMAGES - i;
    const accepted = raw.slice(0, available);
    const discarded = raw.length - accepted.length;
    normaliseFiles(accepted).then(fs => {
      fs.forEach((f, offset) => loadMediaAt(i + offset, f));
      if (discarded > 0) showToast(`Only ${MAX_IMAGES} images max — ${discarded} file${discarded > 1 ? 's' : ''} ignored.`);
    });
  });
});

// ── Folder comparison ─────────────────────────────────────────
// Common suffix patterns to strip when doing fuzzy name matching
const FOLDER_SUFFIX_RE = /[_\-\s]*(lr|hr|left|right|ref|dist|orig(?:inal)?|comp(?:ressed)?|before|after|src|in|out|hq|lq|small|large|raw|edit(?:ed)?|final|input|output|[ab12])$/i;

function getFileStem(name) {
  return name.replace(/\.[^.]+$/, '').replace(FOLDER_SUFFIX_RE, '').toLowerCase().trim();
}

function matchFolderPairs(lefts, rights) {
  const pairs = [];
  const usedL = new Set(), usedR = new Set();
  const rightByStem = new Map();
  for (const f of rights) {
    const s = getFileStem(f.name);
    if (!rightByStem.has(s)) rightByStem.set(s, []);
    rightByStem.get(s).push(f);
  }
  // Pass 1 — name / stem matches
  for (const lf of lefts) {
    const exact = rights.find(r => r.name === lf.name && !usedR.has(r));
    if (exact) { pairs.push({ left: lf, right: exact }); usedL.add(lf); usedR.add(exact); continue; }
    const cands = (rightByStem.get(getFileStem(lf.name)) || []).filter(f => !usedR.has(f));
    if (cands.length) { pairs.push({ left: lf, right: cands[0] }); usedL.add(lf); usedR.add(cands[0]); }
  }
  // Pass 2 — positional fallback for unmatched files (zip by sort order)
  const remL = lefts.filter(f => !usedL.has(f));
  const remR = rights.filter(f => !usedR.has(f));
  const common = Math.min(remL.length, remR.length);
  for (let i = 0; i < common; i++) pairs.push({ left: remL[i], right: remR[i] });
  // Pass 3 — truly unpaired leftovers
  for (let i = common; i < remL.length; i++) pairs.push({ left: remL[i], right: null });
  for (let i = common; i < remR.length; i++) pairs.push({ left: null, right: remR[i] });
  return pairs;
}

// Read files from a FileSystemDirectoryHandle (File System Access API — Chrome fallback)
async function readDirHandle(dirHandle) {
  const files = [];
  for await (const [, entry] of dirHandle.entries()) {
    if (entry.kind === 'file') files.push(await entry.getFile());
    // subdirectories intentionally skipped
  }
  return files;
}

// Unified folder reader: tries webkitGetAsEntry path first (works in Safari),
// then falls back to showDirectoryPicker (works in Chrome, especially file:// origin
// where the FileSystem API throws "URI malformed" errors).
async function readFolderForDrop(dirEntry) {
  try {
    return await readAllFromDirEntry(dirEntry);
  } catch (err) {
    console.warn('webkitGetAsEntry read failed, trying showDirectoryPicker:', err.message);
    if (!window.showDirectoryPicker) throw err;
    // Drop is a user gesture, so showDirectoryPicker can open without a separate click
    const handle = await window.showDirectoryPicker({ mode: 'read' });
    const files = await readDirHandle(handle);
    return { files, name: handle.name }; // return object so caller gets the real name
  }
}

// Read files from a FileSystemDirectoryEntry (webkitGetAsEntry path — Safari).
// Pure callbacks, no await, so Chrome doesn't invalidate the entries.
// Subdirectories are skipped; only files in the top-level directory are returned.
function readAllFromDirEntry(rootEntry) {
  return new Promise((resolve, reject) => {
    const files = [];
    let inflight = 1; // 1 for the root directory read

    function done() { if (--inflight === 0) resolve(files); }

    function readDir(reader) {
      reader.readEntries(batch => {
        if (!batch.length) { done(); return; }
        for (const entry of batch) {
          if (entry.isFile) {
            inflight++;
            entry.file(f => { files.push(f); done(); }, reject);
          }
          // subdirectories intentionally skipped
        }
        readDir(reader); // Chrome returns ≤100 entries/call; loop until empty
      }, reject);
    }

    readDir(rootEntry.createReader());
  });
}

// ── ZIP extraction (for iOS: zip a folder, then select/drop the .zip) ────
async function extractZip(zipFile) {
  const zip = await new JSZip().loadAsync(zipFile);
  const MIME = { jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', gif:'image/gif',
                 webp:'image/webp', avif:'image/avif', bmp:'image/bmp', svg:'image/svg+xml',
                 heic:'image/heic', heif:'image/heif', tiff:'image/tiff', tif:'image/tiff' };
  const files = [];
  const promises = [];
  zip.forEach((path, entry) => {
    if (entry.dir) return;
    // Skip macOS metadata and hidden files
    if (path.startsWith('__MACOSX/') || /\/\./.test(path) || path.startsWith('.')) return;
    const name = path.split('/').pop();
    if (!isImageFile({ name, type: '' })) return;
    const ext = name.split('.').pop().toLowerCase();
    promises.push(
      entry.async('blob').then(blob =>
        files.push(new File([blob], name, { type: MIME[ext] || 'application/octet-stream' }))
      )
    );
  });
  await Promise.all(promises);
  return { files, name: zipFile.name.replace(/\.zip$/i, '') };
}

let folderSides = [null, null];  // each: { name, files }
let folderPairs = [];
let currentPairIdx = -1;

// ── Thumbnail generation ───────────────────────────────────────
// Renders the file down to a small JPEG on a canvas so the gallery
// never has to decode/load the full original image.
const THUMB_MAX = 260; // max dimension for gallery thumbnails
const thumbCache = new Map(); // file → Promise<string|null>

function generateThumb(file) {
  if (thumbCache.has(file)) return thumbCache.get(file);
  const p = new Promise(resolve => {
    const rawUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(rawUrl);
      const scale = Math.min(THUMB_MAX / img.naturalWidth, THUMB_MAX / img.naturalHeight, 1);
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      try {
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.75));
      } catch(_) { resolve(null); }
    };
    img.onerror = () => { URL.revokeObjectURL(rawUrl); resolve(null); };
    img.src = rawUrl;
  });
  thumbCache.set(file, p);
  return p;
}

// Pre-generate thumbnails for all pairs in the background, one at a time
// so the gallery opens instantly once the user triggers it.
async function prefetchThumbs(pairs) {
  for (const pair of pairs) {
    const file = pair.left || pair.right;
    if (file) {
      await generateThumb(file);
      await new Promise(r => setTimeout(r, 0)); // yield to keep UI responsive
    }
  }
}

function buildFolderStrip(sideIdx, files) {
  if (sideIdx > 1) return;
  const strip = slots[sideIdx].panel.querySelector('.folder-strip');
  strip.innerHTML = '';
  files.forEach((f, i) => {
    const thumb = document.createElement('div');
    thumb.className = 'fs-thumb';
    thumb.dataset.i = i;
    const img = document.createElement('img');
    img.alt = '';
    generateThumb(f).then(url => { if (url) img.src = url; else applyPlaceholder(img); });
    thumb.appendChild(img);
    thumb.addEventListener('click', () => {
      if (folderPairs.length) {
        const pi = folderPairs.findIndex(p => (sideIdx === 0 ? p.left : p.right) === f);
        if (pi >= 0) { loadPair(pi); return; }
      }
      loadMediaAt(sideIdx, f);
      setActiveStrip(sideIdx, i);
    });
    strip.appendChild(thumb);
  });
  strip.classList.remove('hidden');
}

function setActiveStrip(sideIdx, fileIdx) {
  if (sideIdx > 1) return;
  const strip = slots[sideIdx].panel.querySelector('.folder-strip');
  strip.querySelectorAll('.fs-thumb').forEach((t, i) => t.classList.toggle('active', i === fileIdx));
  const active = strip.querySelector('.fs-thumb.active');
  if (active) active.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
}

function loadPair(idx) {
  if (!folderPairs.length) return;
  idx = ((idx % folderPairs.length) + folderPairs.length) % folderPairs.length;
  currentPairIdx = idx;
  const pair = folderPairs[idx];
  [pair.left, pair.right].forEach((f, side) => {
    if (f) {
      loadMediaAt(side, f);
      if (folderSides[side]) slots[side].labelInput.value = folderSides[side].name + '/' + f.name;
    }
  });
  if (view === 'slider-v') { cancelSliderVAnim(); pendingSliderVAnim = true; box.style.setProperty('--slider-pct-v', '10%'); }
  else box.style.setProperty('--slider-pct-v', '10%');
  updateFolderNav();
}

function updateFolderNav() {
  const folderMode = !!(folderSides[0] || folderSides[1]);
  const show = folderSides[0] && folderSides[1] &&
               folderPairs.length > 0 && currentPairIdx >= 0;
  ['sepFolderNav','btnPairPrev','btnPairGallery','btnPairNext','pairCount']
    .forEach(id => $('#' + id).classList.toggle('hidden', !show));
  const pc = $('#pairCount');
  pc.textContent = show ? (currentPairIdx + 1) + ' / ' + folderPairs.length : '';
  // Hide + button while any folder is loaded
  $('#btnAdd').classList.toggle('hidden', folderMode);
  // Bottom-center and corner tap zones
  const zoneDisplay = show ? 'flex' : 'none';
  $('#navZonePrev').style.display = zoneDisplay;
  $('#navZoneCenter').style.display = zoneDisplay;
  $('#navZoneNext').style.display = zoneDisplay;
}

// ── Bottom-corner tap zones for pair navigation (touch) ────────
['navZonePrev', 'navZoneNext'].forEach((id, i) => {
  const el = $('#' + id);
  let tapStartX, tapStartY;
  el.addEventListener('touchstart', e => {
    tapStartX = e.touches[0].clientX;
    tapStartY = e.touches[0].clientY;
  }, { passive: true });
  el.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - tapStartX;
    const dy = e.changedTouches[0].clientY - tapStartY;
    if (Math.hypot(dx, dy) > 10 || pinchDist) return;
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 150);
    loadPair(currentPairIdx + (i === 0 ? -1 : 1));
  }, { passive: true });
});

// ── Center-bottom tap zone: reset zoom / animate slider-v ──────
(function () {
  const el = document.getElementById('navZoneCenter');
  let tapStartX, tapStartY;
  el.addEventListener('touchstart', e => {
    tapStartX = e.touches[0].clientX;
    tapStartY = e.touches[0].clientY;
  }, { passive: true });
  el.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - tapStartX;
    const dy = e.changedTouches[0].clientY - tapStartY;
    if (Math.hypot(dx, dy) > 10 || pinchDist) return;
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 150);
    if (panZoomLocked && view === 'slider-v') {
      animateSliderV();
    } else {
      resetTransform(); sizeImages(); showZoom(1);
      $('#btnFit').classList.add('active');
      $('#btnActual').classList.remove('active');
    }
  }, { passive: true });
})();

async function setFolderSide(sideIdx, files, dirName) {
  const imgs = files.filter(isImageFile).sort((a, b) => a.name.localeCompare(b.name));
  if (!imgs.length) { showToast('No images found in folder'); return; }

  folderSides[sideIdx] = { name: dirName, files: imgs };
  loadMediaAt(sideIdx, imgs[0]);
  slots[sideIdx].labelInput.value = dirName + '/' + imgs[0].name;

  if (folderSides[0] && folderSides[1]) {
    folderPairs = matchFolderPairs(folderSides[0].files, folderSides[1].files);
    currentPairIdx = 0;
    loadPair(0);
    const matched = folderPairs.filter(p => p.left && p.right).length;
    showToast(matched + ' pairs matched from ' + folderSides[0].files.length + ' + ' + folderSides[1].files.length + ' images');
    prefetchThumbs(folderPairs); // generate small thumbnails in background
  }
  updateFolderNav();
}

// ── Gallery popup ──────────────────────────────────────────────
// Placeholder SVG rendered as inline element — never used as img.src
const PLACEHOLDER_SVG_HTML = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' width='32' height='32' fill='none' stroke='rgba(255,255,255,.25)' stroke-width='1.3' stroke-linecap='round' stroke-linejoin='round'><rect x='3' y='3' width='18' height='18' rx='2.5'/><circle cx='8.5' cy='8.5' r='1.5'/><polyline points='21 15 16 10 5 21'/></svg>`;

// IntersectionObserver — triggers thumb generation when item enters the viewport
let galleryObserver = null;
function getGalleryObserver() {
  if (!galleryObserver) {
    galleryObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        galleryObserver.unobserve(entry.target);
        const wrap = entry.target;
        const file = wrap._thumbFile;
        if (!file) return;
        generateThumb(file).then(url => {
          if (!url) return;
          const img = wrap.querySelector('.pg-thumb-img');
          if (!img) return;
          img.onload = () => img.classList.add('ready');
          img.src = url;
        });
      });
    }, { root: $('#pgGrid'), rootMargin: '60px', threshold: 0 });
  }
  return galleryObserver;
}

function makeThumbWrap(file) {
  const wrap = document.createElement('div');
  wrap.className = 'pg-thumb-wrap';
  wrap._thumbFile = file;

  // Placeholder always visible underneath
  const ph = document.createElement('div');
  ph.className = 'pg-thumb-placeholder';
  ph.innerHTML = PLACEHOLDER_SVG_HTML;
  wrap.appendChild(ph);

  // Real image — starts transparent, fades in when loaded
  const img = document.createElement('img');
  img.className = 'pg-thumb-img';
  img.alt = '';

  // If thumb already generated, show immediately
  const cached = thumbCache.get(file);
  if (cached) {
    cached.then(url => {
      if (!url) return;
      img.onload = () => img.classList.add('ready');
      img.src = url;
    });
  }
  // else: IntersectionObserver will trigger generation when visible

  wrap.appendChild(img);
  return wrap;
}

function showGallery() {
  if (!folderPairs.length) return;
  const grid = $('#pgGrid');

  if (galleryObserver) { galleryObserver.disconnect(); galleryObserver = null; }

  grid.innerHTML = '';
  const wraps = [];

  folderPairs.forEach((pair, idx) => {
    const el = document.createElement('div');
    el.className = 'pg-pair' + (idx === currentPairIdx ? ' active' : '');
    const primaryFile = pair.left || pair.right;

    const wrap = makeThumbWrap(primaryFile);
    el.appendChild(wrap);
    wraps.push(wrap);

    const name = document.createElement('div');
    name.className = 'pg-pair-name';
    name.title = primaryFile.name;
    name.textContent = primaryFile.name;
    el.appendChild(name);

    el.addEventListener('click', () => { loadPair(idx); hideGallery(); });
    grid.appendChild(el);
  });

  $('#pairGallery').classList.remove('hidden');

  // Defer observer setup until after the grid has laid out so
  // IntersectionObserver can properly detect visible entries
  requestAnimationFrame(() => {
    const obs = getGalleryObserver();
    wraps.forEach(w => obs.observe(w));
    const active = grid.querySelector('.pg-pair.active');
    if (active) active.scrollIntoView({ block: 'nearest' });
  });
}

function hideGallery() { $('#pairGallery').classList.add('hidden'); }


$('#btnPairPrev').addEventListener('click', () => loadPair(currentPairIdx - 1));
$('#btnPairNext').addEventListener('click', () => loadPair(currentPairIdx + 1));
$('#btnPairGallery').addEventListener('click', showGallery);
$('#btnPgClose').addEventListener('click', hideGallery);
$('#pairGallery').addEventListener('click', e => {
  if (!e.target.closest('.pg-box')) hideGallery();
});

// ── Drag & drop ───────────────────────────────────────────────
let dragCnt = 0;

['dragenter','dragover','dragleave','drop'].forEach(ev =>
  window.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); })
);

window.addEventListener('dragenter', () => {
  dragCnt++;
  if (dragCnt > 0 && imageCount === 0) overlay.classList.add('active');
});
window.addEventListener('dragleave', () => {
  dragCnt--;
  if (dragCnt <= 0) { overlay.classList.remove('active'); dragCnt = 0; }
});
window.addEventListener('drop', () => {
  dragCnt = 0; overlay.classList.remove('active');
});

overlay.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; overlay.classList.add('dragover'); });
overlay.addEventListener('dragleave', () => overlay.classList.remove('dragover'));
overlay.addEventListener('drop', async e => {
  overlay.classList.remove('dragover');
  const entries = [...(e.dataTransfer?.items || [])].map(it => it.webkitGetAsEntry?.() ?? null);
  const dirEntry = entries.find(en => en?.isDirectory);
  if (dirEntry) {
    try {
      const result = await readFolderForDrop(dirEntry);
      const files = result?.files ?? result;
      const name  = result?.name  ?? dirEntry.name;
      setFolderSide(folderSides[0] ? 1 : 0, files, name);
    } catch (err) {
      if (err?.name !== 'AbortError') showToast('Could not read folder');
    }
    return;
  }
  const droppedZip = [...e.dataTransfer.files].find(f => f.name.toLowerCase().endsWith('.zip'));
  if (droppedZip) {
    extractZip(droppedZip)
      .then(({ files, name }) => setFolderSide(folderSides[0] ? 1 : 0, files, name))
      .catch(() => showToast('Could not read ZIP file'));
    return;
  }
  normaliseFiles(e.dataTransfer.files).then(fs => addMedia(fs));
});

// Needed so the browser accepts drops on panels (not just the overlay)
wrap.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });

wrap.addEventListener('drop', async e => {
  e.preventDefault();
  const panel = e.target.closest('.panel');
  const targetIdx = panel ? parseInt(panel.dataset.idx) : undefined;
  const entries = [...(e.dataTransfer?.items || [])].map(it => it.webkitGetAsEntry?.() ?? null);
  const dirEntry = entries.find(en => en?.isDirectory);
  if (dirEntry) {
    try {
      const result = await readFolderForDrop(dirEntry);
      const files = result?.files ?? result;
      const name  = result?.name  ?? dirEntry.name;
      const side = (targetIdx !== undefined && targetIdx <= 1) ? targetIdx : (folderSides[0] ? 1 : 0);
      setFolderSide(side, files, name);
    } catch (err) {
      if (err?.name !== 'AbortError') showToast('Could not read folder');
    }
    return;
  }
  if (!e.dataTransfer?.files?.length) return;
  const droppedZip = [...e.dataTransfer.files].find(f => f.name.toLowerCase().endsWith('.zip'));
  if (droppedZip) {
    const side = (targetIdx !== undefined && targetIdx <= 1) ? targetIdx : (folderSides[0] ? 1 : 0);
    extractZip(droppedZip)
      .then(({ files, name }) => setFolderSide(side, files, name))
      .catch(() => showToast('Could not read ZIP file'));
    return;
  }
  normaliseFiles(e.dataTransfer.files).then(fs => addMedia(fs, targetIdx));
});

// ── Paste handler ─────────────────────────────────────────────
window.addEventListener('paste', async e => {
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return; // don't intercept label editing

  // File paste (e.g. screenshot from clipboard)
  if (e.clipboardData?.files?.length) {
    e.preventDefault();
    normaliseFiles(e.clipboardData.files).then(fs => addMedia(fs));
    return;
  }

  // URL paste
  const text = (e.clipboardData?.getData('text/plain') || '').trim();
  if (!text) return;
  if (text.startsWith('data:')) return; // reject data: URIs
  try { new URL(text); } catch { return; } // must be a valid URL
  if (!/^https?:\/\//i.test(text)) return;
  // Must look like an image or video URL
  if (!isImageFile({ name: text, type: '' }) && !isVideoFile({ name: text, type: '' })) return;

  e.preventDefault();
  const targetIdx = slots.findIndex(s => !s.file);
  if (targetIdx < 0) { showToast('All slots full. Clear one first.'); return; }
  loadMediaFromUrl(targetIdx, text);
});

// ── Video sync engine ─────────────────────────────────────────
const playPauseBtn = $('#btnPlayPause');
const seekBar = $('#seekBar');
const timeDisplay = $('#timeDisplay');
const speedSelect = $('#speedSelect');
const videoEls = ['sepVideo', 'btnPlayPause', 'seekBar', 'timeDisplay', 'speedSelect', 'btnRecordVideo'];
const playSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
const pauseSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';

function updateVideoControls() {
  const show = mediaMode === 'video' && imageCount >= 1;
  videoEls.forEach(id => $('#' + id).classList.toggle('hidden', !show));
  if (!show) return;

  const durations = slots.filter(s => s.mediaType === 'video' && s.duration).map(s => s.duration);
  if (durations.length) {
    const maxDur = Math.max(...durations);
    timeDisplay.textContent = fmtTime(0) + ' / ' + fmtTime(maxDur);
  }
}

function getVideoSlots() {
  return slots.filter(s => s.mediaType === 'video' && s.file);
}

function getMasterDuration() {
  const vs = getVideoSlots();
  if (!vs.length) return 0;
  return Math.max(...vs.map(s => s.duration || 0));
}

function pauseAllVideos() {
  getVideoSlots().forEach(s => { try { s.video.pause(); } catch(_){} });
  isPlaying = false;
  playPauseBtn.innerHTML = playSvg;
}

function playAllVideos() {
  const vs = getVideoSlots();
  if (vs.length < 2) return;
  vs.forEach(s => { s.video.playbackRate = parseFloat(speedSelect.value) || 1; });
  vs.forEach(s => { s.video.play().catch(()=>{}); });
  isPlaying = true;
  playPauseBtn.innerHTML = pauseSvg;
}

function togglePlayPause() {
  if (mediaMode !== 'video') return;
  if (isPlaying) pauseAllVideos();
  else playAllVideos();
}

function seekAllVideos(time) {
  const vs = getVideoSlots();
  vs.forEach(s => {
    const dur = s.duration || 0;
    if (dur > 0) {
      s.video.currentTime = dur > 0 ? (time % dur) : 0;
    }
  });
}

function initVideoSync() {
  const vs = getVideoSlots();
  updateVideoControls();
  if (vs.length < 2) return;

  vs.forEach(s => {
    s.video.onended = () => {
      const maxDur = getMasterDuration();
      if (s.duration < maxDur) {
        s.video.currentTime = 0;
        if (isPlaying) s.video.play().catch(()=>{});
      } else {
        // longest video ended — loop back to start
        seekAllVideos(0);
        seekBar.value = 0;
        const md = getMasterDuration();
        timeDisplay.textContent = fmtTime(0) + ' / ' + fmtTime(md);
        if (isPlaying) playAllVideos();
      }
    };

    s.video.ontimeupdate = () => {
      if (s.duration < getMasterDuration()) return;
      const maxDur = getMasterDuration();
      if (!maxDur) return;
      const pct = (s.video.currentTime / maxDur) * 1000;
      seekBar.value = Math.round(pct);
      timeDisplay.textContent = fmtTime(s.video.currentTime) + ' / ' + fmtTime(maxDur);

      // drift correction
      const masterTime = s.video.currentTime;
      vs.forEach(other => {
        if (other === s) return;
        const otherDur = other.duration || 0;
        if (!otherDur) return;
        const expectedTime = otherDur > 0 ? (masterTime % otherDur) : 0;
        if (Math.abs(other.video.currentTime - expectedTime) > 0.15) {
          other.video.currentTime = expectedTime;
        }
      });
    };
  });

  playAllVideos();
}

playPauseBtn.addEventListener('click', togglePlayPause);

seekBar.addEventListener('input', () => {
  const maxDur = getMasterDuration();
  const time = (seekBar.value / 1000) * maxDur;
  seekAllVideos(time);
  timeDisplay.textContent = fmtTime(time) + ' / ' + fmtTime(maxDur);
});

speedSelect.addEventListener('change', () => {
  const rate = parseFloat(speedSelect.value) || 1;
  getVideoSlots().forEach(s => { s.video.playbackRate = rate; });
});

// ── Keyboard shortcuts ────────────────────────────────────────
window.addEventListener('keydown', e => {
  if (['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)) return;

  if (e.key === ' ' && mediaMode === 'video') {
    e.preventDefault();
    togglePlayPause();
    return;
  }
  if (e.key === 'ArrowLeft' && folderPairs.length && mediaMode !== 'video') {
    e.preventDefault(); loadPair(currentPairIdx - 1); return;
  }
  if (e.key === 'ArrowRight' && folderPairs.length && mediaMode !== 'video') {
    e.preventDefault(); loadPair(currentPairIdx + 1); return;
  }

  if (e.key === 'ArrowLeft' && mediaMode === 'video') {
    e.preventDefault();
    const vs = getVideoSlots();
    const master = vs.find(s => s.duration === getMasterDuration());
    if (master) {
      const t = Math.max(0, master.video.currentTime - 5);
      seekAllVideos(t);
      seekBar.value = Math.round((t / getMasterDuration()) * 1000);
      timeDisplay.textContent = fmtTime(t) + ' / ' + fmtTime(getMasterDuration());
    }
    return;
  }
  if (e.key === 'ArrowRight' && mediaMode === 'video') {
    e.preventDefault();
    const vs = getVideoSlots();
    const master = vs.find(s => s.duration === getMasterDuration());
    if (master) {
      const maxDur = getMasterDuration();
      const t = Math.min(maxDur, master.video.currentTime + 5);
      seekAllVideos(t);
      seekBar.value = Math.round((t / maxDur) * 1000);
      timeDisplay.textContent = fmtTime(t) + ' / ' + fmtTime(maxDur);
    }
    return;
  }

  if (e.key === 's' || e.key === 'S') $('#btnSwap').click();
  if (mode === 'two') {
    if (e.key === '1') setView('split');
    if (e.key === '2') setView('slider');
    if (e.key === '3') setView('peek');
  } else {
    if (e.key === '1') setView('horizontal');
    if (e.key === '2') setView('vertical');
    if (e.key === '3') setView('mix');
  }
  if (e.key === 'f' || e.key === 'F') $('#btnFit').click();
  if (e.key === 'a' || e.key === 'A') $('#btnActual').click();
  if (e.key === 'd' || e.key === 'D') $('#btnDet').click();
  if (e.key === 'l' || e.key === 'L') $('#btnLabel').click();
  if (e.key === 'e' || e.key === 'E') $('#btnSnap').click();
  if (e.key === 'r' || e.key === 'R') $('#btnReload').click();
  if (e.key === '+' || e.key === '=') $('#btnAdd').click();
  if (e.key === 'g' || e.key === 'G') { if (folderPairs.length) showGallery(); }
  if (e.key === 'Escape') hideGallery();
});

// ── Electron integration (safe to call in browser too) ────────
if (window.electronAPI) {
  window.electronAPI.onOpenFiles(async (filePaths) => {
    const files = [];
    for (const fp of filePaths) {
      try {
        const resp = await fetch('file://' + fp);
        const blob = await resp.blob();
        const name = fp.split(/[\\/]/).pop();
        files.push(new File([blob], name, { type: blob.type }));
      } catch (e) { console.warn('Could not load', fp, e); }
    }
    if (files.length) normaliseFiles(files).then(fs => addMedia(fs));
  });

  const menuMap = {
    split: () => setView('split'), slider: () => setView('slider'), peek: () => setView('peek'),
    swap: () => $('#btnSwap').click(), add: () => $('#btnAdd').click(),
    fit: () => $('#btnFit').click(), actual: () => $('#btnActual').click(),
    details: () => $('#btnDet').click(), labels: () => $('#btnLabel').click(),
    snap: () => $('#btnSnap').click(), reload: () => $('#btnReload').click(),
  };
  window.electronAPI.onMenuAction(action => { if (menuMap[action]) menuMap[action](); });
}

// ── Auto-load default folders on startup ─────────────────────
(async function loadDefaultFolders() {
  if (!DEFAULT_FOLDERS.length || DEFAULT_FOLDERS.every(p => !p)) return;
  if (slots[0].file || slots[1].file) return; // user already loaded something

  const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif|bmp|heic|heif|tiff?)$/i;

  async function fetchFile(filePath) {
    const r = await fetch('file://' + filePath);
    const blob = await r.blob();
    const name = filePath.split('/').pop();
    return new File([blob], name, { type: blob.type });
  }

  async function readDirViaFetch(dirPath) {
    // Works with Firefox's file:// directory listing; also tried if electronAPI.readDir absent.
    const resp = await fetch('file://' + dirPath + '/');
    const html = await resp.text();
    return [...html.matchAll(/href="([^"?#/][^"?#]*)"/g)]
      .map(m => decodeURIComponent(m[1]))
      .filter(n => IMAGE_EXT.test(n));
  }

  const loaded = [false, false];

  for (let i = 0; i < Math.min(DEFAULT_FOLDERS.length, 2); i++) {
    const dirPath = DEFAULT_FOLDERS[i] && DEFAULT_FOLDERS[i].replace(/\/$/, '');
    if (!dirPath) continue;

    try {
      let names;

      if (window.electronAPI && typeof window.electronAPI.readDir === 'function') {
        // Electron preload exposes readDir(path) → string[]
        names = (await window.electronAPI.readDir(dirPath)).filter(n => IMAGE_EXT.test(n));
      } else {
        names = await readDirViaFetch(dirPath);
      }

      if (!names.length) continue;
      names.sort();

      const results = await Promise.allSettled(
        names.map(name => fetchFile(dirPath + '/' + name))
      );
      const files = results.filter(r => r.status === 'fulfilled').map(r => r.value);
      if (!files.length) continue;

      await setFolderSide(i, files, dirPath.split('/').pop());
      loaded[i] = true;
    } catch (e) {
      console.log('Could not auto-load folder:', dirPath, e.message);
    }
  }
})();

// ── Embed mode ───────────────────────────────────────────────
if (new URLSearchParams(location.search).has('embed')) {
  document.body.classList.add('embed-mode');
}

// ── Load demo images from URL ─────────────────────────────────
(function loadDemo() {
  const params = new URLSearchParams(location.search);
  if (!params.has('demo')) return;

  function loadDemoSlot(idx, src, label) {
    return new Promise(resolve => {
      const slot = slots[idx];
      const wasEmpty = !slot.file;
      slot.file = { name: label, size: 0, type: 'image/jpeg' };
      slot.name = label;
      slot.size = '';
      slot.type = 'image/jpeg';
      slot.mediaType = 'image';
      slot.labelInput.value = label;
      mediaMode = 'image';
      slot.img.onload = () => {
        slot.res = slot.img.naturalWidth + ' \u00d7 ' + slot.img.naturalHeight;
        slot.panel.classList.add('has-image');
        if (wasEmpty) imageCount++;
        updateMode();
        sizeImages();
        requestAnimationFrame(positionSwapZones);
        refreshDetails();
        resolve();
      };
      slot.img.src = src;
    });
  }

  Promise.all([
    loadDemoSlot(0, 'sample-color.jpg', 'Color'),
    loadDemoSlot(1, 'sample-bw.jpg', 'Black & White'),
  ]).then(() => {
    setView('slider');
    box.classList.add('labels-visible');
    $('#btnLabel').classList.add('active');
  });
})();

// ── Record Comparison Video ────────────────────────────────────
(function () {
  let recorder = null;
  let chunks   = [];
  let rafId    = null;
  let recCanvas, recCtx;

  const btn = $('#btnRecordVideo');
  const recSvg  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4" fill="currentColor" stroke="none"/></svg>';
  const stopSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" fill="currentColor" stroke="none"/></svg>';

  function drawFrame() {
    const boxRect = box.getBoundingClientRect();
    const w = Math.round(boxRect.width);
    const h = Math.round(boxRect.height);
    if (recCanvas.width !== w || recCanvas.height !== h) { recCanvas.width = w; recCanvas.height = h; }
    const ctx = recCtx;
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#111';
    ctx.fillRect(0, 0, w, h);

    const cs = getComputedStyle(box);
    const isSlider = view === 'slider';
    const isSliderV = view === 'slider-v';
    const sliderPct = isSlider ? parseFloat(cs.getPropertyValue('--slider-pct')) / 100 : 1;
    const sliderPctV = isSliderV ? parseFloat(cs.getPropertyValue('--slider-pct-v')) / 100 : 1;
    const labelsOn = box.classList.contains('labels-visible');
    const visibleSlots = [];

    slots.forEach((slot, i) => {
      if (!slot.file || panels[i].classList.contains('hidden')) return;
      const pr = panels[i].getBoundingClientRect();
      const px = Math.round(pr.left - boxRect.left);
      const py = Math.round(pr.top  - boxRect.top);
      const pw = Math.round(pr.width);
      const ph = Math.round(pr.height);
      visibleSlots.push({ slot, i, px, py, pw, ph });

      ctx.save();
      if (isSlider && mode === 'two') {
        ctx.beginPath();
        if (i === 0) ctx.rect(0, 0, w * sliderPct, h);
        else         ctx.rect(w * sliderPct, 0, w * (1 - sliderPct), h);
        ctx.clip();
      } else if (isSliderV && mode === 'two') {
        ctx.beginPath();
        if (i === 0) ctx.rect(0, 0, w, h * sliderPctV);
        else         ctx.rect(0, h * sliderPctV, w, h * (1 - sliderPctV));
        ctx.clip();
      }
      ctx.beginPath(); ctx.rect(px, py, pw, ph); ctx.clip();
      const el = activeMedia(slot);
      const ir = el.getBoundingClientRect();
      ctx.drawImage(el, ir.left - boxRect.left, ir.top - boxRect.top, ir.width, ir.height);
      ctx.restore();
    });

    // panel borders
    if (!isSlider && !isSliderV && view !== 'peek') {
      ctx.save();
      ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--border').trim() || '#2a2a30';
      ctx.lineWidth = 1;
      for (let j = 1; j < visibleSlots.length; j++) {
        const p = visibleSlots[j];
        ctx.beginPath();
        if (p.px > 0) { ctx.moveTo(p.px, p.py); ctx.lineTo(p.px, p.py + p.ph); }
        if (p.py > 0) { ctx.moveTo(p.px, p.py); ctx.lineTo(p.px + p.pw, p.py); }
        ctx.stroke();
      }
      ctx.restore();
    }

    // slider divider line
    if (isSlider && mode === 'two') {
      const sx = w * sliderPct;
      ctx.save(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, h); ctx.stroke(); ctx.restore();
    }
    if (isSliderV && mode === 'two') {
      const sy = h * sliderPctV;
      ctx.save(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(w, sy); ctx.stroke(); ctx.restore();
    }

    // labels
    if (labelsOn) {
      visibleSlots.forEach(({ slot, i }) => {
        if (!slot.labelInput.value) return;
        const labelEl   = slot.panel.querySelector('.panel-label');
        const labelRect = labelEl.getBoundingClientRect();
        const lx = Math.round(labelRect.left - boxRect.left);
        const ly = Math.round(labelRect.top  - boxRect.top);
        const lw = Math.round(labelRect.width);
        const lh = Math.round(labelRect.height);
        ctx.save();
        if (isSlider && mode === 'two') {
          ctx.beginPath();
          if (i === 0) ctx.rect(0, 0, w * sliderPct, h);
          else         ctx.rect(w * sliderPct, 0, w * (1 - sliderPct), h);
          ctx.clip();
        } else if (isSliderV && mode === 'two') {
          ctx.beginPath();
          if (i === 0) ctx.rect(0, 0, w, h * sliderPctV);
          else         ctx.rect(0, h * sliderPctV, w, h * (1 - sliderPctV));
          ctx.clip();
        }
        ctx.fillStyle = 'rgba(0,0,0,.55)';
        ctx.beginPath(); ctx.roundRect(lx, ly, lw, lh, 8); ctx.fill();
        ctx.font = '500 12px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.textBaseline = 'middle'; ctx.fillStyle = 'rgba(255,255,255,.85)';
        const textRect = slot.labelInput.getBoundingClientRect();
        ctx.fillText(slot.labelInput.value, Math.round(textRect.left - boxRect.left), Math.round(textRect.top - boxRect.top + textRect.height / 2));
        ctx.restore();
      });
    }

    rafId = requestAnimationFrame(drawFrame);
  }

  function startRecording() {
    const vs = getVideoSlots();
    if (vs.length < 2) { showToast('Load two videos first.'); return; }
    recCanvas = document.createElement('canvas');
    const boxRect = box.getBoundingClientRect();
    recCanvas.width  = Math.round(boxRect.width);
    recCanvas.height = Math.round(boxRect.height);
    recCtx = recCanvas.getContext('2d');

    const stream   = recCanvas.captureStream(30);
    const mimeType = ['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'].find(t => MediaRecorder.isTypeSupported(t)) || '';
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
    chunks   = [];

    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = () => {
      cancelAnimationFrame(rafId); rafId = null;
      const blob = new Blob(chunks, { type: recorder.mimeType || 'video/webm' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      const now  = new Date();
      const pad  = n => String(n).padStart(2, '0');
      const dp   = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
      const tp   = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
      a.href = url; a.download = `video_${dp}_${tp}.webm`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      btn.innerHTML = recSvg; btn.classList.remove('recording'); btn.title = 'Record Comparison Video';
      recorder = null;
    };

    drawFrame();
    recorder.start(100);
    btn.innerHTML = stopSvg; btn.classList.add('recording'); btn.title = 'Stop Recording';
    showToast('Recording\u2026 click \u23f9 to stop');
  }

  function stopRecording() {
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }

  btn.addEventListener('click', () => {
    if (recorder && recorder.state === 'recording') stopRecording();
    else startRecording();
  });

})();

// ── Hamburger Menu (toolbar) ──────────────────────────────────
(function () {
  const menuBtn = document.getElementById('btnToolbarMenu');
  const menuPanel = document.getElementById('menuPanel');
  menuBtn.addEventListener('click', e => {
    e.stopPropagation();
    menuPanel.classList.toggle('open');
    menuBtn.classList.toggle('active', menuPanel.classList.contains('open'));
    if (menuPanel.classList.contains('open')) {
      const r = menuBtn.getBoundingClientRect();
      menuPanel.style.top = (r.bottom + 6) + 'px';
      menuPanel.style.left = r.left + 'px';
    }
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('#menuPanel') && !e.target.closest('#btnToolbarMenu')) {
      menuPanel.classList.remove('open');
      menuBtn.classList.remove('active');
    }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { menuPanel.classList.remove('open'); menuBtn.classList.remove('active'); }
  });

  // ── Auto-hide toolbar toggle ──
  const autoHideBtn = document.getElementById('btnAutoHide');
  const autoHideCheck = document.getElementById('autoHideCheck');
  const toolbar = document.querySelector('.toolbar');
  let tbTimer = 0;

  function setAutoHide(on) {
    document.body.classList.toggle('toolbar-autohide', on);
    autoHideCheck.classList.toggle('on', on);
    localStorage.setItem('tl-toolbar-autohide', on ? '1' : '0');
  }

  // restore from localStorage — default ON
  setAutoHide(localStorage.getItem('tl-toolbar-autohide') !== '0');

  autoHideBtn.addEventListener('click', () => {
    setAutoHide(!document.body.classList.contains('toolbar-autohide'));
  });

  // ── Lock Pan & Zoom toggle ──
  const lockPanZoomBtn = document.getElementById('btnLockPanZoom');
  const lockPanZoomCheck = document.getElementById('lockPanZoomCheck');

  function setLockPanZoom(on) {
    panZoomLocked = on;
    lockPanZoomCheck.classList.toggle('on', on);
    localStorage.setItem('tl-lock-pan-zoom', on ? '1' : '0');
    if (on) { resetTransform(); sizeImages(); }
  }

  // restore from localStorage — default ON
  setLockPanZoom(localStorage.getItem('tl-lock-pan-zoom') !== '0');

  lockPanZoomBtn.addEventListener('click', () => {
    setLockPanZoom(!panZoomLocked);
  });

  // top-edge hover zone — show toolbar when mouse near top
  document.addEventListener('mousemove', e => {
    if (!document.body.classList.contains('toolbar-autohide')) return;
    const detP = document.getElementById('detPanel');
    if (e.clientY < 60) {
      clearTimeout(tbTimer);
      toolbar.classList.add('tb-show');
      detP.classList.add('det-show');
    } else if (toolbar.classList.contains('tb-show') && !toolbar.matches(':hover') && !detP.matches(':hover')) {
      clearTimeout(tbTimer);
      tbTimer = setTimeout(() => { toolbar.classList.remove('tb-show'); detP.classList.remove('det-show'); }, 400);
    }
  });
  toolbar.addEventListener('mouseleave', () => {
    if (!document.body.classList.contains('toolbar-autohide')) return;
    const detP = document.getElementById('detPanel');
    if (detP.matches(':hover')) return;
    clearTimeout(tbTimer);
    tbTimer = setTimeout(() => { toolbar.classList.remove('tb-show'); detP.classList.remove('det-show'); }, 400);
  });
  document.getElementById('detPanel').addEventListener('mouseleave', () => {
    if (!document.body.classList.contains('toolbar-autohide')) return;
    if (toolbar.matches(':hover')) return;
    clearTimeout(tbTimer);
    tbTimer = setTimeout(() => { toolbar.classList.remove('tb-show'); document.getElementById('detPanel').classList.remove('det-show'); }, 400);
  });
})();

