// content/content.js - AI Multi-Tab Autonomous Engine & Draggable Floating Window (ChatGPT & Gemini)

const isGemini = window.location.hostname.includes('gemini.google.com');
const isChatGPT = window.location.hostname.includes('chatgpt.com');
const platformName = isGemini ? 'Google Gemini' : (isChatGPT ? 'ChatGPT' : 'AI Engine');

console.log(`🤖 [AI Prompter Pro] Autonomous Engine Active on: ${platformName}`);

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ==========================================
// 1. STATE & STORAGE
// ==========================================
let inPageQueue = [];
let inPageDb = [];
let inPageFolder = isGemini ? 'Gemini_Outputs' : 'ChatGPT_Outputs';
let isBatchRunning = false;

async function syncStateFromStorage() {
  const data = await chrome.storage.local.get(['promptQueue', 'generationDatabase', 'subfolder']);
  if (data.promptQueue && Array.isArray(data.promptQueue)) inPageQueue = data.promptQueue;
  if (data.generationDatabase && Array.isArray(data.generationDatabase)) inPageDb = data.generationDatabase;
  if (data.subfolder) inPageFolder = data.subfolder;
  updateFloatingUI();
}

async function saveStateToStorage() {
  await chrome.storage.local.set({
    promptQueue: inPageQueue,
    generationDatabase: inPageDb,
    subfolder: inPageFolder
  });
}

// ==========================================
// 2. DOM HELPERS & STOP BUTTON DETECTOR
// ==========================================

function getEditor() {
  if (isGemini) {
    return document.querySelector('rich-textarea div[contenteditable="true"]') ||
           document.querySelector('div.ql-editor[contenteditable="true"]') ||
           document.querySelector('div[contenteditable="true"][role="textbox"]') ||
           document.querySelector('.input-area [contenteditable="true"]') ||
           document.querySelector('textarea.textarea');
  } else {
    return document.querySelector('#prompt-textarea') ||
           document.querySelector('div[contenteditable="true"]');
  }
}

async function injectPrompt(text) {
  const editor = getEditor();
  if (!editor) return { success: false, error: `Editor input di ${platformName} tidak ditemukan` };

  editor.focus();

  if (editor.tagName === 'TEXTAREA') {
    editor.value = text;
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    editor.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    editor.focus();
    document.execCommand('selectAll', false, null);
    const inserted = document.execCommand('insertText', false, text);
    if (!inserted || !editor.innerText.trim()) {
      editor.innerHTML = '<p>' + text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>') + '</p>';
      editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    }
  }

  editor.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
  editor.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true }));
  await sleep(600);
  return { success: true };
}

async function clickSend() {
  if (isGemini) {
    const sendBtn = document.querySelector('button[aria-label*="Kirim"], button[aria-label*="Send"], button.send-button, button.mat-mdc-icon-button[aria-label*="Send"], button[mattooltip="Send message"], button.send-button-container');
    if (sendBtn && !sendBtn.disabled && !sendBtn.getAttribute('aria-disabled')) {
      sendBtn.click();
      await sleep(1000);
      return { success: true, method: 'gemini_button' };
    }
  } else {
    const sendBtn = document.querySelector('button[data-testid="send-button"], button[data-testid="fruitjuice-send-button"], button[aria-label="Send prompt"], button[aria-label="Kirim prompt"]');
    if (sendBtn && !sendBtn.disabled) {
      sendBtn.click();
      await sleep(1000);
      return { success: true, method: 'chatgpt_button' };
    }
  }

  const editor = getEditor();
  if (editor) {
    editor.focus();
    const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true });
    editor.dispatchEvent(enterEvent);
    await sleep(1000);
    return { success: true, method: 'enter_key' };
  }

  return { success: false, error: 'Tombol kirim tidak aktif' };
}

// DETEKSI TOMBOL STOP (SESUAI GAMBAR PENGGUNA: LINGKARAN BIRU/HITAM DENGAN KOTAK PUTIH)
function isStopButtonPresent() {
  // 1. ChatGPT Stop Button
  const gptStop = document.querySelector([
    'button[data-testid="stop-button"]',
    'button[aria-label="Stop generating"]',
    'button[aria-label="Hentikan pembuatan"]',
    'button[aria-label*="Stop"]',
    'button[aria-label*="Hentikan"]',
    'button:has(svg rect)',
    'button:has(rect)'
  ].join(', '));

  // 2. Gemini Stop Button & Spinners
  const geminiStop = document.querySelector([
    'button[aria-label*="Stop"]',
    'button[aria-label*="Hentikan"]',
    '.sparkle-spinner',
    'mat-progress-spinner',
    'mat-progress-bar',
    '.loading-dots'
  ].join(', '));

  const streaming = document.querySelector('.result-streaming, .streaming, [data-testid*="loading"], .animate-spin');

  return !!(gptStop || geminiStop || streaming);
}

function getAllGeneratedImages() {
  return Array.from(document.querySelectorAll('img')).filter(img => {
    const src = img.src || '';
    const alt = (img.alt || '').toLowerCase();
    if (!src) return false;

    // Filter icon profil & avatar
    const isAvatar = (src.includes('avatar') || 
                      src.includes('profile') || 
                      src.includes('auth0') || 
                      src.includes('googleusercontent.com/a/') ||
                      alt.includes('profil') ||
                      alt.includes('avatar')) &&
                      !src.includes('estuary') &&
                      !src.includes('backend-api');

    if (isAvatar && (img.width < 100 || img.naturalWidth < 100)) return false;

    // Pola URL AI Image yang valid
    const isAiGenerated = src.includes('backend-api/estuary/content') ||
                          src.includes('estuary/content') ||
                          src.includes('oaiusercontent') || 
                          src.includes('googleusercontent.com') ||
                          src.startsWith('blob:') || 
                          src.startsWith('data:image') || 
                          img.naturalWidth > 200;

    return isAiGenerated;
  });
}

async function extractImageDataUrl(imgElement) {
  try {
    const response = await fetch(imgElement.src, { credentials: 'include' });
    const blob = await response.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve({
        success: true,
        dataUrl: reader.result,
        mimeType: blob.type || 'image/png',
        sizeBytes: blob.size,
        width: imgElement.naturalWidth || imgElement.width || 1080,
        height: imgElement.naturalHeight || imgElement.height || 1350,
        src: imgElement.src
      });
      reader.onerror = () => resolve(extractViaCanvas(imgElement));
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    return extractViaCanvas(imgElement);
  }
}

function extractViaCanvas(imgElement) {
  try {
    const canvas = document.createElement('canvas');
    const w = imgElement.naturalWidth || imgElement.width || 1080;
    const h = imgElement.naturalHeight || imgElement.height || 1350;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(imgElement, 0, 0, w, h);
    const dataUrl = canvas.toDataURL('image/png');
    return {
      success: true,
      dataUrl,
      mimeType: 'image/png',
      sizeBytes: Math.round(dataUrl.length * 0.75),
      width: w,
      height: h,
      src: imgElement.src
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ==========================================
// 3. MONITOR GENERATION DENGAN VALIDASI KETAT
// ==========================================

async function monitorGenerationStrict(baselineCount = 0, baselineLastSrc = '', maxSeconds = 180, onLog = () => {}) {
  const startTime = Date.now();
  let hasTriggeredAutoRecovery = false;
  let generationEverStarted = false;

  onLog('⏳ Menunggu AI memulai proses rendering (mendeteksi tombol Stop)...');

  // FASE 1: Tunggu tombol Stop muncul (Tanda AI mulai memproses)
  for (let i = 0; i < 15; i++) {
    await sleep(600);
    if (isStopButtonPresent()) {
      generationEverStarted = true;
      onLog('⚡ Tombol Stop aktif! AI sedang me-render gambar...');
      break;
    }
  }

  // FASE 2: Tunggu sampai tombol Stop HILANG / SELESAI (AI selesai membuat gambar)
  while ((Date.now() - startTime) < (maxSeconds * 1000)) {
    if (!isBatchRunning) break;
    await sleep(1500);
    const elapsed = Math.round((Date.now() - startTime) / 1000);

    const isGenerating = isStopButtonPresent();

    // 1. Cek Error Balon ChatGPT / Gemini
    const bubbles = Array.from(document.querySelectorAll(
      isGemini 
        ? 'model-response, .model-response-text, .response-container, message-content' 
        : '[data-message-author-role="assistant"], .markdown'
    ));

    let internalErrorDetected = false;
    const lastBubble = bubbles.length > 0 ? bubbles[bubbles.length - 1] : null;
    if (lastBubble) {
      const txt = (lastBubble.innerText || '').toLowerCase();
      if (txt.includes('kesalahan di pihak saya') || 
          txt.includes('terjadi kesalahan') || 
          txt.includes('terjadi masalah') ||
          txt.includes('tidak dapat menghasilkan gambar') || 
          txt.includes('tidak dapat membuat gambar') ||
          txt.includes('unable to generate') ||
          txt.includes('something went wrong')) {
        internalErrorDetected = true;
      }
    }

    if (internalErrorDetected && !hasTriggeredAutoRecovery) {
      hasTriggeredAutoRecovery = true;
      onLog(`⚠️ Error server terdeteksi. Mengirim perintah Auto-Recovery ke obrolan...`);
      await sleep(1000);
      await injectPrompt('Lanjutkan sesuai instruksi sebelumnya dan visualisasikan langsung gambarnya sekarang secara nyata!');
      await sleep(600);
      await clickSend();
      onLog('🚀 Auto-Recovery terkirim!');
      continue;
    }

    // 2. Jika Tombol Stop Masih Ada -> JANGAN DOWNLOAD! AI masih me-render!
    if (isGenerating) {
      onLog(`⏳ [${elapsed}s] AI sedang aktif me-render (Tombol Stop terdeteksi aktif)...`);
      continue;
    }

    // 3. Jika Tombol Stop SUDAH HILANG -> Berikan jeda 2 detik untuk memastikan DOM siap
    if (!isGenerating) {
      onLog(`✨ Tombol Stop selesai! Memvalidasi gambar baru yang dihasilkan...`);
      await sleep(2000);

      const currentImages = getAllGeneratedImages();
      const latestImage = currentImages.length > 0 ? currentImages[currentImages.length - 1] : null;

      // VALIDASI KETAT: Pastikan gambar ini BENAR-BENAR GAMBAR BARU (bukan gambar lama yang sudah ada sebelumnya)
      const isGenuinelyNewImage = latestImage && (
        currentImages.length > baselineCount ||
        (latestImage.src && latestImage.src !== baselineLastSrc)
      );

      if (isGenuinelyNewImage) {
        onLog(`🎉 Gambar baru terverifikasi valid (${latestImage.naturalWidth || 1080}x${latestImage.naturalHeight || 1350})! Mengekstrak HD...`);
        const extracted = await extractImageDataUrl(latestImage);
        return { success: true, ...extracted, elapsedSeconds: elapsed, platform: platformName };
      }

      // Jika AI membalas teks bukannya gambar
      const lastText = lastBubble ? lastBubble.innerText.trim() : '';
      if (!isGenuinelyNewImage && lastText.length > 30 && elapsed >= 12 && !hasTriggeredAutoRecovery) {
        hasTriggeredAutoRecovery = true;
        onLog(`⚠️ Respon AI berupa teks. Memaksa visual...`);
        await injectPrompt('Buatkan dan visualisasikan langsung gambarnya sekarang secara nyata, jangan berikan teks penjelasan!');
        await sleep(600);
        await clickSend();
        continue;
      }
    }
  }

  // Fallback jika timeout
  const currentImages = getAllGeneratedImages();
  if (currentImages.length > baselineCount) {
    const latest = currentImages[currentImages.length - 1];
    onLog('ℹ️ Mengambil gambar baru di bagian paling bawah obrolan...');
    const extracted = await extractImageDataUrl(latest);
    return { success: true, ...extracted, elapsedSeconds: 180, platform: platformName };
  }

  return { success: false, error: `Waktu tunggu habis (timeout) di ${platformName}` };
}

// ==========================================
// 4. AUTONOMOUS IN-PAGE RUNNER LOOP
// ==========================================

async function startInPageBatch() {
  if (isBatchRunning) return;
  await syncStateFromStorage();

  if (inPageQueue.length === 0) {
    alert('Antrean prompt masih kosong (0 item)!\n\nSilakan upload file prompt (.txt / .json) pada menu [📋 Antrean] terlebih dahulu.');
    const qTab = document.querySelector('.ai-widget-tab[data-view="ai-view-queue"]');
    if (qTab) qTab.click();
    return;
  }

  const pending = inPageQueue.filter(i => i.status === 'PENDING' || i.status === 'FAILED');
  if (pending.length === 0) {
    if (confirm('Semua item di antrean sudah selesai (SUCCESS).\n\nIngin me-reset dan mengulang antrean dari awal?')) {
      inPageQueue.forEach(i => i.status = 'PENDING');
      await saveStateToStorage();
    } else {
      return;
    }
  }

  isBatchRunning = true;
  updateFloatingUI();
  addInPageLog('🚀 Memulai Batch Generator di Tab ini (Never-Stop Engine aktif)!', 'success');

  while (isBatchRunning) {
    const item = inPageQueue.find(i => i.status === 'PENDING');
    if (!item) break;

    item.status = 'RUNNING';
    updateFloatingUI();
    await saveStateToStorage();
    addInPageLog(`Memproses: "${item.title || item.fileName}"...`, 'info');

    // CATAT BASELINE GAMBAR LAMA SEBELUM PROMPT DIKIRIM (SUPAYA TIDAK MENGUNDUH GAMBAR SEBELUMNYA)
    const baselineImages = getAllGeneratedImages();
    const baselineCount = baselineImages.length;
    const baselineLastSrc = baselineCount > 0 ? baselineImages[baselineCount - 1].src : '';

    const injected = await injectPrompt(item.prompt);
    if (injected.success) {
      await sleep(600);
      await clickSend();

      // MONITOR DENGAN VALIDASI TOMBOL STOP LENGKAP
      const res = await monitorGenerationStrict(baselineCount, baselineLastSrc, 180, (txt) => {
        addInPageLog(txt, 'info');
      });

      if (res && res.success && res.dataUrl) {
        item.status = 'SUCCESS';
        item.resolution = `${res.width}x${res.height}`;
        item.fileSizeKB = (res.sizeBytes / 1024).toFixed(1);
        addInPageLog(`✓ Selesai Terverifikasi (${item.resolution} | ${item.fileSizeKB} KB)!`, 'success');

        const targetFolder = inPageFolder.trim() || (isGemini ? 'Gemini_Outputs' : 'ChatGPT_Outputs');
        const ext = res.mimeType?.includes('png') ? 'png' : 'jpg';
        const filename = `${targetFolder}/${item.fileName}.${ext}`;

        // Simpan ke DB
        inPageDb.unshift({
          id: 'db_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
          title: item.title,
          fileName: item.fileName,
          prompt: item.prompt,
          folder: targetFolder,
          platform: platformName,
          timestamp: new Date().toLocaleString(),
          resolution: item.resolution,
          fileSizeKB: item.fileSizeKB,
          savedFile: filename,
          status: 'SUCCESS'
        });

        // Silent Download HANYA GAMBAR BARU INI
        chrome.runtime.sendMessage({
          type: 'DOWNLOAD_HD_IMAGE',
          dataUrl: res.dataUrl,
          filename: filename
        });
        addInPageLog(`📥 Unduh HD Otomatis: ${filename}`, 'info');

        // Auto archive dari antrean
        const idx = inPageQueue.indexOf(item);
        if (idx !== -1) inPageQueue.splice(idx, 1);
      } else {
        item.status = 'FAILED';
        addInPageLog(`✗ Gagal: ${res?.error || 'Unknown error'}`, 'error');
      }
    } else {
      item.status = 'FAILED';
      addInPageLog(`✗ Gagal inject: ${injected.error}`, 'error');
    }

    updateFloatingUI();
    await saveStateToStorage();
    await sleep(2500);
  }

  isBatchRunning = false;
  updateFloatingUI();
  await saveStateToStorage();
  addInPageLog('🎉 Seluruh antrean batch selesai!', 'success');
}

function stopInPageBatch() {
  isBatchRunning = false;
  updateFloatingUI();
  addInPageLog('⏹️ Batch generation dihentikan.', 'warning');
}

// ==========================================
// 5. DRAGGABLE FLOATING MODAL UI CREATOR
// ==========================================

function makeDraggable(headerEl, panelEl) {
  let isDragging = false;
  let startX, startY, initialLeft, initialTop;

  headerEl.addEventListener('mousedown', (e) => {
    if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;

    const rect = panelEl.getBoundingClientRect();
    initialLeft = rect.left;
    initialTop = rect.top;

    panelEl.style.right = 'auto';
    panelEl.style.left = initialLeft + 'px';
    panelEl.style.top = initialTop + 'px';

    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    const newLeft = Math.max(10, Math.min(window.innerWidth - panelEl.offsetWidth - 10, initialLeft + dx));
    const newTop = Math.max(10, Math.min(window.innerHeight - panelEl.offsetHeight - 10, initialTop + dy));

    panelEl.style.left = newLeft + 'px';
    panelEl.style.top = newTop + 'px';
  });

  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
    }
  });
}

function createFloatingWidget() {
  if (document.getElementById('ai-prompter-floating-btn')) return;

  // 1. Floating Launcher Pill
  const floatBtn = document.createElement('div');
  floatBtn.id = 'ai-prompter-floating-btn';
  floatBtn.innerHTML = `
    <span class="ai-float-dot"></span>
    <span class="ai-float-text">AI Prompter Hub</span>
    <span id="aiFloatBadge" class="ai-float-badge">0 Item</span>
  `;
  document.body.appendChild(floatBtn);

  // 2. Floating Draggable Modal Panel
  const panel = document.createElement('div');
  panel.id = 'ai-prompter-floating-panel';
  panel.className = 'hidden';
  panel.innerHTML = `
    <div class="ai-widget-header" id="aiDraggableHeader" title="Tahan & geser untuk memindahkan posisi window">
      <div class="ai-widget-brand">
        <span class="ai-float-dot"></span>
        <span class="ai-widget-title">AI Prompter Hub</span>
        <span class="ai-widget-badge">${isGemini ? 'GEMINI' : 'CHATGPT'}</span>
      </div>
      <div class="ai-widget-actions">
        <button id="aiBtnRefresh" class="ai-btn-icon-sm" title="Segarkan">🔄</button>
        <button id="aiBtnMinimize" class="ai-btn-icon-sm" title="Sembunyikan Window (Tetap Berjalan)">─</button>
        <button id="aiBtnClose" class="ai-btn-icon-sm" title="Tutup">✕</button>
      </div>
    </div>

    <div class="ai-widget-nav">
      <button class="ai-widget-tab active" data-view="ai-view-control">🚀 Kontrol</button>
      <button class="ai-widget-tab" data-view="ai-view-queue">📋 Antrean</button>
      <button class="ai-widget-tab" data-view="ai-view-data">💾 Data</button>
      <button class="ai-widget-tab" data-view="ai-view-logs">📜 Log</button>
    </div>

    <div class="ai-widget-body">
      <!-- View 1: Kontrol -->
      <div id="ai-view-control" class="ai-widget-view active">
        <div class="ai-card">
          <div class="ai-card-title">
            <span>PROGRES BATCH GENERATE</span>
            <span id="aiHeroPercent" style="color:#00F0FF;">0%</span>
          </div>
          <div class="ai-progress-track">
            <div id="aiProgressBar" class="ai-progress-fill" style="width: 0%;"></div>
          </div>
          <div class="ai-metrics-row">
            <div class="ai-metric-item"><span id="aiMetricTotal" class="ai-metric-num">0</span><span class="ai-metric-lbl">Total</span></div>
            <div class="ai-metric-item"><span id="aiMetricSuccess" class="ai-metric-num" style="color:#10B981;">0</span><span class="ai-metric-lbl">Selesai</span></div>
            <div class="ai-metric-item"><span id="aiMetricRunning" class="ai-metric-num" style="color:#00F0FF;">0</span><span class="ai-metric-lbl">Proses</span></div>
            <div class="ai-metric-item"><span id="aiMetricPending" class="ai-metric-num" style="color:#F59E0B;">0</span><span class="ai-metric-lbl">Sisa</span></div>
          </div>
        </div>

        <div class="ai-card">
          <div class="ai-card-title"><span>📁 Folder Penyimpanan</span></div>
          <input type="text" id="aiTxtFolder" value="${inPageFolder}" style="background:#04060A; border:1px solid rgba(255,255,255,0.1); border-radius:5px; padding:6px; color:#00F0FF; font-size:11px; outline:none;" placeholder="Contoh: PPTMORPH/TEMPLATES_001">
        </div>

        <div style="display:flex; gap:6px; margin-top:2px;">
          <button id="aiBtnStart" class="ai-btn-primary">🚀 GAS GENERATE (TAB INI)</button>
          <button id="aiBtnStop" class="ai-btn-danger" disabled>⏹️ STOP</button>
        </div>
      </div>

      <!-- View 2: Antrean -->
      <div id="ai-view-queue" class="ai-widget-view">
        <input type="file" id="aiFileInput" accept=".json,.txt" multiple style="display:none">
        <div class="ai-toolbar">
          <button id="aiBtnUpload" class="ai-btn-tool">📁 Upload File</button>
          <button id="aiBtnMassDownload" class="ai-btn-tool" style="color:#34D399;">📥 Unduh Massal</button>
          <button id="aiBtnClearDone" class="ai-btn-tool">🧹 Hapus Selesai</button>
          <button id="aiBtnClearAll" class="ai-btn-tool" style="color:#F43F5E;">🗑️ Kosongkan</button>
        </div>

        <div id="aiQueueList" class="ai-list-box">
          <div style="text-align:center; padding:16px; color:#64748B;">Antrean kosong. Upload file untuk memulai!</div>
        </div>
      </div>

      <!-- View 3: Data -->
      <div id="ai-view-data" class="ai-widget-view">
        <div class="ai-card-title">
          <span>Riwayat Database</span>
          <button id="aiBtnDownloadDb" style="background:transparent; border:none; color:#00F0FF; cursor:pointer; font-size:10.5px;">📥 Unduh JSON</button>
        </div>
        <div id="aiDbList" class="ai-list-box">
          <div style="text-align:center; padding:16px; color:#64748B;">Database kosong.</div>
        </div>
      </div>

      <!-- View 4: Log -->
      <div id="ai-view-logs" class="ai-widget-view">
        <div class="ai-card-title"><span>Live Stream Terminal</span></div>
        <div id="aiConsole" class="ai-console">
          <div style="color:#38BDF8;">[SYSTEM] AI Prompter In-Page Engine siap.</div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(panel);

  // Aktifkan Drag & Drop Posisi Modal
  const draggableHeader = document.getElementById('aiDraggableHeader');
  makeDraggable(draggableHeader, panel);

  // Event Listeners
  floatBtn.addEventListener('click', () => {
    panel.classList.toggle('hidden');
    syncStateFromStorage();
  });

  document.getElementById('aiBtnMinimize').addEventListener('click', () => panel.classList.add('hidden'));
  document.getElementById('aiBtnClose').addEventListener('click', () => panel.classList.add('hidden'));
  document.getElementById('aiBtnRefresh').addEventListener('click', () => syncStateFromStorage());

  // Nav Switcher
  panel.querySelectorAll('.ai-widget-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      panel.querySelectorAll('.ai-widget-tab').forEach(t => t.classList.remove('active'));
      panel.querySelectorAll('.ai-widget-view').forEach(v => v.classList.remove('active'));
      tab.classList.add('active');
      const target = document.getElementById(tab.getAttribute('data-view'));
      if (target) target.classList.add('active');
    });
  });

  // Start / Stop
  document.getElementById('aiBtnStart').addEventListener('click', () => startInPageBatch());
  document.getElementById('aiBtnStop').addEventListener('click', () => stopInPageBatch());

  // Folder
  const txtFold = document.getElementById('aiTxtFolder');
  txtFold.addEventListener('input', (e) => {
    inPageFolder = e.target.value.trim();
    saveStateToStorage();
  });

  // Upload Multi-File
  const fileInput = document.getElementById('aiFileInput');
  document.getElementById('aiBtnUpload').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    if (!files || files.length === 0) return;
    files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

    for (const file of files) {
      try {
        const text = await file.text();
        if (file.name.endsWith('.json')) {
          const parsed = JSON.parse(text);
          const list = Array.isArray(parsed) ? parsed : [parsed];
          list.forEach((it, i) => inPageQueue.push({
            id: 'item_' + Date.now() + '_' + i,
            title: it.title || file.name.replace(/\.json$/i, ''),
            fileName: it.name || it.fileName || 'slide_' + (inPageQueue.length + 1),
            prompt: it.prompt || JSON.stringify(it),
            status: 'PENDING'
          }));
        } else {
          const lines = text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
          const clean = lines.join(' ').trim();
          if (clean) {
            inPageQueue.push({
              id: 'item_' + Date.now() + '_' + inPageQueue.length,
              title: file.name.replace(/\.txt$/i, ''),
              fileName: file.name.replace(/\.txt$/i, ''),
              prompt: clean,
              status: 'PENDING'
            });
          }
        }
      } catch (err) {}
    }
    updateFloatingUI();
    await saveStateToStorage();
    fileInput.value = '';
  });

  // Mass Download Button in Widget
  document.getElementById('aiBtnMassDownload').addEventListener('click', async () => {
    const images = getAllGeneratedImages();
    if (images.length === 0) {
      alert('Tidak ada gambar visual di obrolan.');
      return;
    }
    addInPageLog(`Memulai unduh massal ${images.length} gambar...`, 'info');
    const targetFolder = inPageFolder.trim() || (isGemini ? 'Gemini_Outputs' : 'ChatGPT_Outputs');

    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      const extRes = await extractImageDataUrl(img);
      if (extRes.success) {
        const ext = extRes.mimeType?.includes('png') ? 'png' : 'jpg';
        const filename = `${targetFolder}/slide_${String(i + 1).padStart(3, '0')}.${ext}`;
        chrome.runtime.sendMessage({
          type: 'DOWNLOAD_HD_IMAGE',
          dataUrl: extRes.dataUrl,
          filename: filename
        });
      }
      await sleep(350);
    }
    addInPageLog(`🎉 Sukses mengunduh massal ${images.length} gambar!`, 'success');
  });

  // Clear Done & Clear All
  document.getElementById('aiBtnClearDone').addEventListener('click', () => {
    inPageQueue = inPageQueue.filter(i => i.status !== 'SUCCESS');
    updateFloatingUI();
    saveStateToStorage();
  });

  document.getElementById('aiBtnClearAll').addEventListener('click', () => {
    if (confirm('Kosongkan antrean?')) {
      inPageQueue = [];
      updateFloatingUI();
      saveStateToStorage();
    }
  });

  // Download DB JSON
  document.getElementById('aiBtnDownloadDb').addEventListener('click', () => {
    if (inPageDb.length === 0) return alert('Database kosong.');
    const blob = new Blob([JSON.stringify(inPageDb, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `AI_Database_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });
}

function updateFloatingUI() {
  const floatBadge = document.getElementById('aiFloatBadge');
  const heroPercent = document.getElementById('aiHeroPercent');
  const progressBar = document.getElementById('aiProgressBar');
  const mTotal = document.getElementById('aiMetricTotal');
  const mSuccess = document.getElementById('aiMetricSuccess');
  const mRunning = document.getElementById('aiMetricRunning');
  const mPending = document.getElementById('aiMetricPending');
  const btnStart = document.getElementById('aiBtnStart');
  const btnStop = document.getElementById('aiBtnStop');
  const queueList = document.getElementById('aiQueueList');
  const dbList = document.getElementById('aiDbList');

  if (!floatBadge) return;

  const total = inPageQueue.length;
  const success = inPageQueue.filter(i => i.status === 'SUCCESS').length;
  const running = inPageQueue.filter(i => i.status === 'RUNNING').length;
  const pending = inPageQueue.filter(i => i.status === 'PENDING').length;
  const percent = total > 0 ? Math.round((success / total) * 100) : (inPageDb.length > 0 ? 100 : 0);

  floatBadge.textContent = isBatchRunning ? `⚡ Sedang Render (${percent}%)` : `${total} Item`;
  heroPercent.textContent = `${percent}%`;
  progressBar.style.width = `${percent}%`;
  mTotal.textContent = total;
  mSuccess.textContent = success + inPageDb.length;
  mRunning.textContent = isBatchRunning ? Math.max(1, running) : running;
  mPending.textContent = pending;

  if (btnStart) {
    if (isBatchRunning) {
      btnStart.disabled = true;
      btnStart.innerHTML = '<span class="ai-float-dot"></span> SEDANG ME-RENDER GAMBAR...';
      btnStart.classList.add('running');
    } else {
      btnStart.disabled = false;
      btnStart.innerHTML = '🚀 GAS GENERATE (TAB INI)';
      btnStart.classList.remove('running');
    }
  }

  if (btnStop) {
    btnStop.disabled = !isBatchRunning;
  }

  // Render Queue
  if (queueList) {
    queueList.innerHTML = '';
    if (inPageQueue.length === 0) {
      queueList.innerHTML = '<div style="text-align:center; padding:16px; color:#64748B;">Antrean kosong.</div>';
    } else {
      inPageQueue.forEach((item, idx) => {
        const row = document.createElement('div');
        row.className = 'ai-queue-card';
        let pillClass = 'ai-pill-pending';
        let pillTxt = 'Pending';
        if (item.status === 'RUNNING') { pillClass = 'ai-pill-running'; pillTxt = '⚡ Proses'; }
        else if (item.status === 'SUCCESS') { pillClass = 'ai-pill-success'; pillTxt = '✓ Selesai'; }
        else if (item.status === 'FAILED') { pillClass = 'ai-pill-failed'; pillTxt = '✗ Gagal'; }

        row.innerHTML = `
          <div style="display:flex; align-items:center; gap:6px;">
            <span style="font-size:9.5px; font-weight:800; color:#00F0FF;">${idx + 1}.</span>
            <span class="ai-card-title-sm">${item.title}</span>
          </div>
          <span class="ai-status-pill ${pillClass}">${pillTxt}</span>
        `;
        queueList.appendChild(row);
      });
    }
  }

  // Render DB
  if (dbList) {
    dbList.innerHTML = '';
    if (inPageDb.length === 0) {
      dbList.innerHTML = '<div style="text-align:center; padding:16px; color:#64748B;">Database kosong.</div>';
    } else {
      inPageDb.slice(0, 30).forEach(entry => {
        const row = document.createElement('div');
        row.className = 'ai-queue-card';
        row.innerHTML = `
          <div style="display:flex; flex-direction:column;">
            <span class="ai-card-title-sm">${entry.title || entry.fileName}</span>
            <span style="font-size:8.5px; color:#64748B;">${entry.folder} • ${entry.resolution || 'HD'}</span>
          </div>
          <span class="ai-status-pill ai-pill-success">✓ Tersimpan</span>
        `;
        dbList.appendChild(row);
      });
    }
  }
}

function addInPageLog(msg, type = 'info') {
  const consoleEl = document.getElementById('aiConsole');
  if (!consoleEl) return;
  const row = document.createElement('div');
  const colors = { info: '#38BDF8', success: '#34D399', warning: '#FBBF24', error: '#F87171' };
  row.style.color = colors[type] || '#94A3B8';
  const time = new Date().toLocaleTimeString();
  row.textContent = `[${time}] ${msg}`;
  consoleEl.appendChild(row);
  consoleEl.scrollTop = consoleEl.scrollHeight;
}

// ==========================================
// 6. INITIALIZATION & MESSAGE ROUTER
// ==========================================

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    createFloatingWidget();
    syncStateFromStorage();
  });
} else {
  createFloatingWidget();
  syncStateFromStorage();
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'TOGGLE_FLOATING_WIDGET') {
    const panel = document.getElementById('ai-prompter-floating-panel');
    if (panel) {
      panel.classList.toggle('hidden');
      syncStateFromStorage();
    } else {
      createFloatingWidget();
      const p = document.getElementById('ai-prompter-floating-panel');
      if (p) p.classList.remove('hidden');
    }
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'PING') {
    sendResponse({
      status: 'PONG',
      title: document.title,
      url: window.location.href,
      platform: isGemini ? 'Gemini' : (isChatGPT ? 'ChatGPT' : 'Unknown'),
      imageCount: getAllGeneratedImages().length
    });
    return true;
  }

  if (request.action === 'EXTRACT_ALL_IMAGES') {
    (async () => {
      try {
        const images = getAllGeneratedImages();
        const results = [];
        for (let i = 0; i < images.length; i++) {
          const img = images[i];
          const extracted = await extractImageDataUrl(img);
          if (extracted && extracted.success) {
            results.push({ index: i + 1, ...extracted });
          }
        }
        sendResponse({ success: true, count: results.length, images: results, platform: platformName });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  if (request.action === 'PROCESS_ITEM') {
    (async () => {
      try {
        const baselineImages = getAllGeneratedImages();
        const baselineCount = baselineImages.length;
        const baselineLastSrc = baselineCount > 0 ? baselineImages[baselineCount - 1].src : '';

        const injected = await injectPrompt(request.prompt);
        if (!injected.success) throw new Error(injected.error || 'Gagal inject');
        await sleep(600);

        const sent = await clickSend();
        if (!sent.success) throw new Error(sent.error || 'Gagal kirim');

        const result = await monitorGenerationStrict(baselineCount, baselineLastSrc, 180, (logText) => {
          addInPageLog(logText, 'info');
          chrome.runtime.sendMessage({
            type: 'WORKER_LOG',
            tabId: request.tabId,
            platform: isGemini ? 'Gemini' : 'ChatGPT',
            text: logText
          }).catch(() => {});
        });

        sendResponse(result);
      } catch (err) {
        sendResponse({ success: false, error: err.message, platform: platformName });
      }
    })();
    return true;
  }
});
