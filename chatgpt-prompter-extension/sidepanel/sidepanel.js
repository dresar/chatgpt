// sidepanel/sidepanel.js - AI Multi-Tab Batch Prompter Controller (v2.4 with Silent Auto-Download & Mass Extractor)

// State
let availableTabs = [];
let selectedTabIds = new Set();
let tabFolders = {}; // tabId -> custom folder string
let promptQueue = [];
let generationDatabase = []; // Database of all completed generations
let isRunning = false;
let activeWorkers = new Map(); // tabId -> { title, platform }

// DOM Elements - Navigation
const navTabs = document.querySelectorAll('.nav-tab');
const viewPanels = document.querySelectorAll('.view-panel');
const navQueueBadge = document.getElementById('navQueueBadge');
const navTabBadge = document.getElementById('navTabBadge');
const navDbBadge = document.getElementById('navDbBadge');
const btnRefreshAll = document.getElementById('btnRefreshAll');

// DOM Elements - View 1: Control
const heroPercentText = document.getElementById('heroPercentText');
const heroProgressBar = document.getElementById('heroProgressBar');
const metricTotal = document.getElementById('metricTotal');
const metricSuccess = document.getElementById('metricSuccess');
const metricRunning = document.getElementById('metricRunning');
const metricPending = document.getElementById('metricPending');
const activeWorkersList = document.getElementById('activeWorkersList');
const btnQuickAddTab = document.getElementById('btnQuickAddTab');

const chkAutoDownload = document.getElementById('chkAutoDownload');
const chkAutoRecovery = document.getElementById('chkAutoRecovery');
const chkAutoArchive = document.getElementById('chkAutoArchive');
const txtSubfolder = document.getElementById('txtSubfolder');
const btnPickGlobalFolder = document.getElementById('btnPickGlobalFolder');
const btnStartBatch = document.getElementById('btnStartBatch');
const btnStopBatch = document.getElementById('btnStopBatch');

// DOM Elements - View 2: Queue
const fileInput = document.getElementById('fileInput');
const btnUploadFile = document.getElementById('btnUploadFile');
const btnTogglePaste = document.getElementById('btnTogglePaste');
const btnClearCompletedQueue = document.getElementById('btnClearCompletedQueue');
const btnClearQueue = document.getElementById('btnClearQueue');
const pasteDrawer = document.getElementById('pasteDrawer');
const txtPasteInput = document.getElementById('txtPasteInput');
const btnConfirmPaste = document.getElementById('btnConfirmPaste');
const btnClosePaste = document.getElementById('btnClosePaste');
const queueListContainer = document.getElementById('queueListContainer');

// DOM Elements - View 3: Tabs (ChatGPT & Gemini)
const tabListContainer = document.getElementById('tabListContainer');
const btnSelectAllTabs = document.getElementById('btnSelectAllTabs');
const btnMassDownloadActiveTab = document.getElementById('btnMassDownloadActiveTab');
const btnOpenNewChatGptTab = document.getElementById('btnOpenNewChatGptTab');
const btnOpenNewGeminiTab = document.getElementById('btnOpenNewGeminiTab');

// DOM Elements - View 4: Database
const txtSearchDb = document.getElementById('txtSearchDb');
const btnClearDatabase = document.getElementById('btnClearDatabase');
const btnDownloadDatabaseJson = document.getElementById('btnDownloadDatabaseJson');
const dbListContainer = document.getElementById('dbListContainer');

// DOM Elements - View 5: Logs
const consoleLog = document.getElementById('consoleLog');
const btnClearLogs = document.getElementById('btnClearLogs');

// 1. Navigation Tab Switcher
navTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    const targetId = tab.getAttribute('data-target');
    navTabs.forEach(t => t.classList.remove('active'));
    viewPanels.forEach(p => p.classList.remove('active'));

    tab.classList.add('active');
    const targetPanel = document.getElementById(targetId);
    if (targetPanel) targetPanel.classList.add('active');

    if (targetId === 'view-database') {
      renderDatabase();
    }
  });
});

// 2. Logging Function
function log(msg, type = 'info') {
  const row = document.createElement('div');
  row.className = `log-row log-${type}`;
  const time = new Date().toLocaleTimeString();
  row.textContent = `[${time}] ${msg}`;
  consoleLog.appendChild(row);
  consoleLog.scrollTop = consoleLog.scrollHeight;
}

// 3. Storage Persistence
async function loadState() {
  const data = await chrome.storage.local.get([
    'promptQueue',
    'generationDatabase',
    'subfolder',
    'autoDownload',
    'autoRecovery',
    'autoArchive',
    'selectedTabs',
    'tabFolders'
  ]);

  if (data.promptQueue && Array.isArray(data.promptQueue)) {
    promptQueue = data.promptQueue;
  }
  if (data.generationDatabase && Array.isArray(data.generationDatabase)) {
    generationDatabase = data.generationDatabase;
  }
  if (data.subfolder) txtSubfolder.value = data.subfolder;
  if (data.autoDownload !== undefined) chkAutoDownload.checked = data.autoDownload;
  if (data.autoRecovery !== undefined) chkAutoRecovery.checked = data.autoRecovery;
  if (data.autoArchive !== undefined) chkAutoArchive.checked = data.autoArchive;
  if (data.selectedTabs && Array.isArray(data.selectedTabs)) {
    selectedTabIds = new Set(data.selectedTabs);
  }
  if (data.tabFolders && typeof data.tabFolders === 'object') {
    tabFolders = data.tabFolders;
  }

  updateMetrics();
  renderQueue();
  renderDatabase();
}

async function saveState() {
  await chrome.storage.local.set({
    promptQueue,
    generationDatabase,
    subfolder: txtSubfolder.value,
    autoDownload: chkAutoDownload.checked,
    autoRecovery: chkAutoRecovery.checked,
    autoArchive: chkAutoArchive.checked,
    selectedTabs: Array.from(selectedTabIds),
    tabFolders
  });
}

// 4. Metrics & UI Updates
function updateMetrics() {
  const total = promptQueue.length;
  const success = promptQueue.filter(i => i.status === 'SUCCESS').length;
  const running = promptQueue.filter(i => i.status === 'RUNNING').length;
  const pending = promptQueue.filter(i => i.status === 'PENDING').length;
  const percent = total > 0 ? Math.round((success / total) * 100) : (generationDatabase.length > 0 ? 100 : 0);

  metricTotal.textContent = total;
  metricSuccess.textContent = success + generationDatabase.length;
  metricRunning.textContent = running;
  metricPending.textContent = pending;

  heroPercentText.textContent = `${percent}%`;
  heroProgressBar.style.width = `${percent}%`;
  navQueueBadge.textContent = total;
  navDbBadge.textContent = generationDatabase.length;

  // Render active workers pill
  if (activeWorkers.size === 0) {
    activeWorkersList.innerHTML = '<div class="empty-hint-sm">Semua worker sedang idle / menunggu tugas.</div>';
  } else {
    activeWorkersList.innerHTML = '';
    activeWorkers.forEach((workerInfo, tabId) => {
      const folderName = tabFolders[tabId] || txtSubfolder.value || 'Default';
      const pill = document.createElement('div');
      pill.className = 'worker-pill';
      pill.innerHTML = `
        <span class="worker-dot busy"></span>
        <span>Tab #${tabId} [${workerInfo.platform || 'AI'}] 📁 [${folderName}]: <b>${workerInfo.title}</b></span>
      `;
      activeWorkersList.appendChild(pill);
    });
  }
}

// 5. Tab Worker Management & Mass Download Actions
async function refreshTabs() {
  try {
    const [chatGptTabs, geminiTabs] = await Promise.all([
      chrome.tabs.query({ url: 'https://chatgpt.com/*' }),
      chrome.tabs.query({ url: 'https://gemini.google.com/*' })
    ]);

    const combinedTabs = [...chatGptTabs, ...geminiTabs];
    availableTabs = combinedTabs;
    navTabBadge.textContent = combinedTabs.length;

    tabListContainer.innerHTML = '';
    if (combinedTabs.length === 0) {
      tabListContainer.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">⚠️</span>
          <p>Tidak ada tab ChatGPT atau Gemini yang terbuka.</p>
          <span class="empty-sub">Buka ChatGPT atau Gemini dan login terlebih dahulu.</span>
        </div>
      `;
      selectedTabIds.clear();
      saveState();
      return;
    }

    if (selectedTabIds.size === 0 && combinedTabs.length > 0) {
      selectedTabIds.add(combinedTabs[0].id);
    }

    combinedTabs.forEach((tab, index) => {
      const isSelected = selectedTabIds.has(tab.id);
      const isGeminiTab = tab.url && tab.url.includes('gemini.google.com');
      const platformBadge = isGeminiTab ? '<span class="badge-platform gemini">Gemini</span>' : '<span class="badge-platform chatgpt">ChatGPT</span>';
      const defaultTabFolder = tabFolders[tab.id] || (isGeminiTab ? `Gemini_Outputs/Tab_${index + 1}` : `ChatGPT_Outputs/Tab_${index + 1}`);

      const card = document.createElement('div');
      card.className = `tab-custom-card ${isSelected ? 'selected' : ''}`;
      card.innerHTML = `
        <div class="tab-card-header">
          <div class="tab-id-group">
            <span class="tab-id-badge">Tab #${tab.id}</span>
            ${platformBadge}
            <span class="tab-title-text" title="${tab.title || (isGeminiTab ? 'Gemini' : 'ChatGPT')}">${tab.title || (isGeminiTab ? 'Google Gemini' : 'ChatGPT')}</span>
          </div>
          <input type="checkbox" ${isSelected ? 'checked' : ''} class="ios-switch tab-toggle" data-tab-id="${tab.id}">
        </div>

        <div class="tab-folder-box">
          <label class="tab-folder-label">
            <span>📁 Folder Unduhan Khusus Tab Ini:</span>
          </label>
          <div class="tab-folder-row">
            <input type="text" class="tab-folder-input" data-tab-id="${tab.id}" value="${defaultTabFolder}" placeholder="Contoh: PPTMORPH/TEMPLATES_001 atau paste path">
            <button class="btn-pick-folder btn-pick-tab-folder" data-tab-id="${tab.id}" title="Pilih folder di komputer">📂 Pilih</button>
            <button class="btn-pick-folder btn-mass-tab-download" data-tab-id="${tab.id}" style="background:rgba(16,185,129,0.15); border-color:rgba(16,185,129,0.4); color:#34D399;" title="Unduh semua gambar yang ada di obrolan tab ini">📥 Unduh Massal</button>
          </div>
        </div>
      `;

      // Event Switch Worker
      const toggle = card.querySelector('.tab-toggle');
      toggle.addEventListener('change', (e) => {
        if (e.target.checked) {
          selectedTabIds.add(tab.id);
          card.classList.add('selected');
        } else {
          selectedTabIds.delete(tab.id);
          card.classList.remove('selected');
        }
        saveState();
      });

      // Event Custom Folder Input
      const folderInput = card.querySelector('.tab-folder-input');
      folderInput.addEventListener('input', (e) => {
        tabFolders[tab.id] = e.target.value.trim();
        saveState();
      });

      // Event Pick Folder Button
      const btnPick = card.querySelector('.btn-pick-tab-folder');
      btnPick.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          if ('showDirectoryPicker' in window) {
            const dirHandle = await window.showDirectoryPicker();
            if (dirHandle && dirHandle.name) {
              folderInput.value = dirHandle.name;
              tabFolders[tab.id] = dirHandle.name;
              saveState();
              log(`Tab #${tab.id} folder diatur ke: "${dirHandle.name}"`, 'success');
            }
          } else {
            alert('Fitur pemilih folder tidak didukung di browser ini. Kamu bisa langsung ketik / paste nama foldernya.');
          }
        } catch (err) {}
      });

      // Event Unduh Massal Gambar di Tab Ini
      const btnMassTab = card.querySelector('.btn-mass-tab-download');
      btnMassTab.addEventListener('click', async (e) => {
        e.stopPropagation();
        await performMassDownloadForTab(tab.id);
      });

      tabListContainer.appendChild(card);
    });

    log(`Ditemukan ${combinedTabs.length} tab AI aktif (${chatGptTabs.length} ChatGPT, ${geminiTabs.length} Gemini).`, 'info');
  } catch (err) {
    log(`Gagal memindai tab: ${err.message}`, 'error');
  }
}

// Handler Unduh Massal Gambar dari Tab Tertentu (Silent Auto-Download)
async function performMassDownloadForTab(tabId) {
  const tabObj = availableTabs.find(t => t.id === tabId);
  const isGem = tabObj && tabObj.url && tabObj.url.includes('gemini.google.com');
  const platform = isGem ? 'Gemini' : 'ChatGPT';
  const targetFolder = tabFolders[tabId] || txtSubfolder.value.trim() || (isGem ? 'Gemini_Outputs' : 'ChatGPT_Outputs');

  log(`[Tab #${tabId} (${platform})] 🔍 Memindai seluruh gambar di obrolan...`, 'info');

  try {
    await injectContentScriptIfNeeded(tabId);
    const response = await chrome.tabs.sendMessage(tabId, { action: 'EXTRACT_ALL_IMAGES' });

    if (!response || !response.success || !response.images || response.images.length === 0) {
      alert(`Tidak ditemukan gambar visual yang dapat diunduh di Tab #${tabId}.`);
      log(`[Tab #${tabId}] Tidak ada gambar visual yang ditemukan di obrolan.`, 'warning');
      return;
    }

    log(`[Tab #${tabId}] Ditemukan ${response.images.length} gambar visual! Memulai unduh otomatis massal ke "${targetFolder}"...`, 'info');

    for (const img of response.images) {
      const ext = img.mimeType?.includes('png') ? 'png' : 'jpg';
      const filename = `${targetFolder}/slide_${String(img.index).padStart(3, '0')}.${ext}`;

      chrome.runtime.sendMessage({
        type: 'DOWNLOAD_HD_IMAGE',
        dataUrl: img.dataUrl,
        filename: filename
      });

      // Simpan ke Database
      generationDatabase.unshift({
        id: 'db_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        title: `Bulk Slide ${img.index}`,
        fileName: `slide_${String(img.index).padStart(3, '0')}`,
        prompt: `Auto Mass Extracted from ${platform}`,
        folder: targetFolder,
        tabId: tabId,
        platform: platform,
        timestamp: new Date().toLocaleString(),
        resolution: `${img.width}x${img.height}`,
        fileSizeKB: (img.sizeBytes / 1024).toFixed(1),
        savedFile: filename,
        status: 'SUCCESS'
      });

      await new Promise(r => setTimeout(r, 400));
    }

    saveState();
    renderDatabase();
    updateMetrics();
    log(`[Tab #${tabId}] 🎉 Berhasil mengunduh massal ${response.images.length} gambar ke folder "${targetFolder}" tanpa gangguan!`, 'success');
  } catch (err) {
    log(`[Tab #${tabId}] Gagal unduh massal: ${err.message}`, 'error');
  }
}

// Global Mass Download Button (Semua Tab Terpilih)
btnMassDownloadActiveTab?.addEventListener('click', async () => {
  if (selectedTabIds.size === 0) {
    alert('Pilih minimal 1 Tab di daftar checklist worker!');
    return;
  }

  const tabs = Array.from(selectedTabIds);
  for (const tid of tabs) {
    await performMassDownloadForTab(tid);
  }
});

// Global Folder Picker
btnPickGlobalFolder?.addEventListener('click', async () => {
  try {
    if ('showDirectoryPicker' in window) {
      const dirHandle = await window.showDirectoryPicker();
      if (dirHandle && dirHandle.name) {
        txtSubfolder.value = dirHandle.name;
        saveState();
        log(`Default folder global diatur ke: "${dirHandle.name}"`, 'success');
      }
    } else {
      alert('Fitur pemilih folder tidak didukung di browser ini. Kamu bisa langsung ketik / paste nama foldernya.');
    }
  } catch (err) {}
});

btnSelectAllTabs.addEventListener('click', () => {
  const allSelected = selectedTabIds.size === availableTabs.length;
  selectedTabIds.clear();
  if (!allSelected) {
    availableTabs.forEach(t => selectedTabIds.add(t.id));
  }
  saveState();
  refreshTabs();
});

btnOpenNewChatGptTab?.addEventListener('click', async () => {
  const tab = await chrome.tabs.create({ url: 'https://chatgpt.com/' });
  selectedTabIds.add(tab.id);
  saveState();
  await new Promise(r => setTimeout(r, 1200));
  refreshTabs();
});

btnOpenNewGeminiTab?.addEventListener('click', async () => {
  const tab = await chrome.tabs.create({ url: 'https://gemini.google.com/app' });
  selectedTabIds.add(tab.id);
  saveState();
  await new Promise(r => setTimeout(r, 1200));
  refreshTabs();
});

btnQuickAddTab?.addEventListener('click', () => {
  btnOpenNewChatGptTab ? btnOpenNewChatGptTab.click() : null;
});

btnRefreshAll.addEventListener('click', () => {
  refreshTabs();
  renderQueue();
  renderDatabase();
  updateMetrics();
  log('Data dan tab disegarkan.', 'info');
});

// 6. Queue Rendering & Management
function renderQueue() {
  updateMetrics();
  queueListContainer.innerHTML = '';

  if (promptQueue.length === 0) {
    queueListContainer.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">📋</span>
        <p>Antrean prompt aktif kosong.</p>
        <span class="empty-sub">Upload file JSON/TXT atau drag & drop file ke area ini!</span>
      </div>
    `;
    return;
  }

  promptQueue.forEach((item, index) => {
    const card = document.createElement('div');
    card.className = 'queue-card';

    let statusBadge = `<span class="badge-status badge-pending">Pending</span>`;
    if (item.status === 'RUNNING') {
      statusBadge = `<span class="badge-status badge-running">⚡ ${item.workerText || 'Proses'}</span>`;
    } else if (item.status === 'SUCCESS') {
      statusBadge = `<span class="badge-status badge-success">✓ Selesai ${item.fileSizeKB ? '(' + item.fileSizeKB + ' KB)' : ''}</span>`;
    } else if (item.status === 'FAILED') {
      statusBadge = `<span class="badge-status badge-failed">✗ Gagal</span>`;
    }

    card.innerHTML = `
      <div class="card-left">
        <span class="slide-num-badge">${String(index + 1).padStart(2, '0')}</span>
        <div class="card-text-group">
          <span class="card-item-title">${item.title || 'Slide ' + (index + 1)}</span>
          <span class="card-item-snippet">${item.prompt}</span>
        </div>
      </div>
      <div class="card-right">
        ${statusBadge}
        <button class="card-del-btn" title="Hapus prompt ini" data-del-idx="${index}">🗑️</button>
      </div>
    `;

    card.querySelector('.card-del-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      promptQueue.splice(index, 1);
      saveState();
      renderQueue();
    });

    queueListContainer.appendChild(card);
  });
}

function addItemsToQueue(items) {
  const formatted = items.map((it, i) => ({
    id: 'item_' + Date.now() + '_' + i,
    title: it.title || `Slide ${promptQueue.length + i + 1}`,
    fileName: it.fileName || `slide_${String(promptQueue.length + i + 1).padStart(3, '0')}`,
    prompt: it.prompt,
    status: 'PENDING'
  }));

  promptQueue.push(...formatted);
  saveState();
  renderQueue();
  log(`Ditambahkan ${formatted.length} prompt baru ke antrean. Total antrean aktif: ${promptQueue.length}`, 'success');
}

// 7. Multi-File Upload & Drag-and-Drop Handlers
btnUploadFile.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', async (e) => {
  const files = Array.from(e.target.files);
  if (!files || files.length === 0) return;

  files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  log(`Membaca ${files.length} file yang dipilih...`, 'info');
  await processFilesBatch(files);
  fileInput.value = '';
});

// Drag and Drop Multi-File Zone
queueListContainer.addEventListener('dragover', (e) => {
  e.preventDefault();
  queueListContainer.style.borderColor = 'var(--cyan-main)';
  queueListContainer.style.background = 'rgba(0, 240, 255, 0.08)';
});

queueListContainer.addEventListener('dragleave', (e) => {
  e.preventDefault();
  queueListContainer.style.borderColor = '';
  queueListContainer.style.background = '';
});

queueListContainer.addEventListener('drop', async (e) => {
  e.preventDefault();
  queueListContainer.style.borderColor = '';
  queueListContainer.style.background = '';

  const files = Array.from(e.dataTransfer.files).filter(f => f.name.endsWith('.txt') || f.name.endsWith('.json'));
  if (files.length === 0) return;

  files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  log(`Menerima ${files.length} file dari Drag & Drop...`, 'info');
  await processFilesBatch(files);
});

async function processFilesBatch(files) {
  const allParsedItems = [];

  for (const file of files) {
    try {
      const content = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (evt) => resolve(evt.target.result);
        reader.onerror = (err) => reject(err);
        reader.readAsText(file);
      });

      if (file.name.endsWith('.json')) {
        const parsed = JSON.parse(content);
        const list = Array.isArray(parsed) ? parsed : parsed.slides ? Object.values(parsed.slides) : [parsed];
        const items = list.map(item => ({
          title: item.title || item.name || file.name.replace(/\.json$/i, ''),
          fileName: item.name || item.fileName || 'slide_' + (promptQueue.length + allParsedItems.length + 1),
          prompt: item.prompt || item.prompt_english || JSON.stringify(item)
        }));
        allParsedItems.push(...items);
      } else {
        const lines = content.split('\n');
        let targetFileName = '';
        const promptLines = [];

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('# Target File:') || trimmed.startsWith('# Target:')) {
            const match = trimmed.match(/# Target(?:\s+File)?:\s*(?:assets\/)?(.+)/i);
            if (match) {
              const baseWithExt = match[1].trim().split(/[\/\\]/).pop();
              targetFileName = baseWithExt.replace(/\.(png|jpg|webp)$/i, '');
            }
          } else if (!trimmed.startsWith('#') && trimmed.length > 0) {
            promptLines.push(trimmed);
          }
        }

        const cleanPrompt = promptLines.join(' ').trim();
        if (cleanPrompt) {
          const fileBaseName = file.name.replace(/\.txt$/i, '');
          allParsedItems.push({
            title: fileBaseName.replace(/_/g, ' '),
            fileName: targetFileName || fileBaseName,
            prompt: cleanPrompt
          });
        }
      }
    } catch (err) {
      log(`Gagal memproses file "${file.name}": ${err.message}`, 'error');
    }
  }

  if (allParsedItems.length > 0) {
    addItemsToQueue(allParsedItems);
  }
}

btnTogglePaste.addEventListener('click', () => {
  pasteDrawer.classList.toggle('hidden');
  txtPasteInput.focus();
});

btnClosePaste.addEventListener('click', () => {
  pasteDrawer.classList.add('hidden');
});

btnConfirmPaste.addEventListener('click', () => {
  const raw = txtPasteInput.value.trim();
  if (!raw) return;

  try {
    if (raw.startsWith('{') || raw.startsWith('[')) {
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      const items = list.map(item => ({
        title: item.title || 'Slide',
        fileName: item.name || 'image',
        prompt: item.prompt || item.prompt_english || JSON.stringify(item)
      }));
      addItemsToQueue(items);
    } else {
      const paragraphs = raw.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
      const items = paragraphs.map((p, i) => ({
        title: `Slide ${promptQueue.length + i + 1}`,
        fileName: `slide_${String(promptQueue.length + i + 1).padStart(3, '0')}`,
        prompt: p
      }));
      addItemsToQueue(items);
    }
    pasteDrawer.classList.add('hidden');
    txtPasteInput.value = '';
  } catch (err) {
    log(`Gagal parsing teks: ${err.message}`, 'error');
  }
});

btnClearCompletedQueue.addEventListener('click', () => {
  const initialLen = promptQueue.length;
  promptQueue = promptQueue.filter(it => it.status !== 'SUCCESS');
  const removed = initialLen - promptQueue.length;
  saveState();
  renderQueue();
  log(`Dibersihkan ${removed} item yang telah selesai dari antrean aktif.`, 'info');
});

btnClearQueue.addEventListener('click', () => {
  if (confirm('Yakin ingin mengosongkan seluruh antrean aktif? (Data di database tetap aman)')) {
    promptQueue = [];
    saveState();
    renderQueue();
    log('Antrean aktif telah dikosongkan.', 'info');
  }
});

// 8. Multi-Tab Batch Generator Engine (ChatGPT & Google Gemini Concurrent)
async function injectContentScriptIfNeeded(tabId) {
  try {
    const ping = await chrome.tabs.sendMessage(tabId, { action: 'PING' });
    if (ping && ping.status === 'PONG') return { success: true, platform: ping.platform };
  } catch (e) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content/content.js']
      });
      await new Promise(r => setTimeout(r, 600));
      return { success: true };
    } catch (err) {
      log(`Gagal injeksi script ke Tab #${tabId}: ${err.message}`, 'error');
      return { success: false };
    }
  }
  return { success: true };
}

btnStartBatch.addEventListener('click', async () => {
  if (selectedTabIds.size === 0) {
    alert('Pilih minimal 1 Tab ChatGPT atau Gemini di menu "Worker"!');
    return;
  }

  const pendingItems = promptQueue.filter(it => it.status === 'PENDING' || it.status === 'FAILED');
  if (pendingItems.length === 0) {
    alert('Semua prompt dalam antrean sudah selesai!');
    return;
  }

  isRunning = true;
  btnStartBatch.disabled = true;
  btnStopBatch.disabled = false;

  const targetTabs = Array.from(selectedTabIds);
  log(`🚀 Memulai Multi-Tab Batch Generator dengan ${targetTabs.length} Worker Tab Simultan (ChatGPT & Gemini)!`, 'success');

  const workerPromises = targetTabs.map((tabId, idx) => runWorkerLoop(tabId, idx + 1));
  await Promise.all(workerPromises);

  isRunning = false;
  activeWorkers.clear();
  btnStartBatch.disabled = false;
  btnStopBatch.disabled = true;
  updateMetrics();
  renderQueue();
  renderDatabase();
  log('🎉 Seluruh proses antrean batch selesai!', 'success');
  saveState();
});

btnStopBatch.addEventListener('click', () => {
  isRunning = false;
  activeWorkers.clear();
  btnStartBatch.disabled = false;
  btnStopBatch.disabled = true;
  updateMetrics();
  renderQueue();
  log('⏹️ Batch generation dihentikan oleh pengguna.', 'warning');
});

async function runWorkerLoop(tabId, workerNum) {
  const ready = await injectContentScriptIfNeeded(tabId);
  if (!ready || !ready.success) {
    log(`[Worker #${tabId}] Tab tidak dapat diakses. Worker dilewati.`, 'error');
    return;
  }

  const tabObj = availableTabs.find(t => t.id === tabId);
  const isGem = tabObj && tabObj.url && tabObj.url.includes('gemini.google.com');
  const platform = isGem ? 'Gemini' : 'ChatGPT';
  const customFolder = tabFolders[tabId] || txtSubfolder.value || (isGem ? 'Gemini_Outputs' : 'ChatGPT_Outputs');
  const prefix = `[Worker #${tabId} (${platform}) 📁 ${customFolder}]`;

  log(`${prefix} Siap memproses antrean!`, 'info');

  while (isRunning) {
    const item = promptQueue.find(it => it.status === 'PENDING');
    if (!item) break;

    item.status = 'RUNNING';
    item.workerText = `Tab #${tabId} (${platform})`;
    activeWorkers.set(tabId, { title: item.title || item.fileName, platform });
    updateMetrics();
    renderQueue();
    saveState();

    log(`${prefix} Memproses: "${item.title}"...`, 'info');

    try {
      const response = await chrome.tabs.sendMessage(tabId, {
        action: 'PROCESS_ITEM',
        prompt: item.prompt,
        tabId
      });

      if (response && response.success && response.dataUrl) {
        item.status = 'SUCCESS';
        item.resolution = `${response.width}x${response.height}`;
        item.fileSizeKB = (response.sizeBytes / 1024).toFixed(1);

        log(`${prefix} ✓ Selesai (${item.resolution} | ${item.fileSizeKB} KB)!`, 'success');

        // Target Folder
        const targetFolder = tabFolders[tabId] || txtSubfolder.value.trim() || (isGem ? 'Gemini_Outputs' : 'ChatGPT_Outputs');
        const ext = response.mimeType?.includes('png') ? 'png' : 'jpg';
        const cleanFilename = `${targetFolder}/${item.fileName}.${ext}`;

        // SIMPAN KE DATABASE LOKAL LENGKAP
        const dbEntry = {
          id: 'db_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
          title: item.title,
          fileName: item.fileName,
          prompt: item.prompt,
          folder: targetFolder,
          tabId: tabId,
          platform: response.platform || platform,
          timestamp: new Date().toLocaleString(),
          resolution: item.resolution,
          fileSizeKB: item.fileSizeKB,
          savedFile: cleanFilename,
          status: 'SUCCESS'
        };
        generationDatabase.unshift(dbEntry);

        // SILENT AUTO DOWNLOAD
        if (chkAutoDownload.checked) {
          chrome.runtime.sendMessage({
            type: 'DOWNLOAD_HD_IMAGE',
            dataUrl: response.dataUrl,
            filename: cleanFilename
          }, (res) => {
            if (res?.success) {
              log(`${prefix} 📥 Unduh HD Otomatis: ${cleanFilename}`, 'info');
            }
          });
        }

        // AUTO-ARCHIVE DARI ANTREAN AKTIF
        if (chkAutoArchive.checked) {
          const itemIdx = promptQueue.indexOf(item);
          if (itemIdx !== -1) {
            promptQueue.splice(itemIdx, 1);
            log(`${prefix} 💾 Slide diarsipkan otomatis ke Database.`, 'info');
          }
        }
      } else {
        item.status = 'FAILED';
        log(`${prefix} ✗ Gagal: ${response?.error || 'Unknown error'}`, 'error');
      }
    } catch (err) {
      item.status = 'FAILED';
      log(`${prefix} Error komunikasi tab: ${err.message}`, 'error');
    }

    activeWorkers.delete(tabId);
    updateMetrics();
    renderQueue();
    saveState();
    await new Promise(r => setTimeout(r, 2000));
  }

  activeWorkers.delete(tabId);
  updateMetrics();
  log(`${prefix} Tugas antrean selesai.`, 'info');
}

// 9. Database View Renderer & Actions
function renderDatabase() {
  updateMetrics();
  dbListContainer.innerHTML = '';

  const searchKeyword = (txtSearchDb.value || '').toLowerCase().trim();
  const filtered = generationDatabase.filter(entry => 
    !searchKeyword || 
    (entry.title && entry.title.toLowerCase().includes(searchKeyword)) ||
    (entry.fileName && entry.fileName.toLowerCase().includes(searchKeyword)) ||
    (entry.folder && entry.folder.toLowerCase().includes(searchKeyword)) ||
    (entry.platform && entry.platform.toLowerCase().includes(searchKeyword))
  );

  if (filtered.length === 0) {
    dbListContainer.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">💾</span>
        <p>${searchKeyword ? 'Tidak ada hasil yang cocok.' : 'Database riwayat masih kosong.'}</p>
        <span class="empty-sub">Slide yang selesai di-generate akan otomatis tercatat di sini.</span>
      </div>
    `;
    return;
  }

  filtered.forEach((entry) => {
    const isGeminiEntry = entry.platform && entry.platform.toLowerCase().includes('gemini');
    const platformBadge = isGeminiEntry ? '<span class="badge-platform gemini">Gemini</span>' : '<span class="badge-platform chatgpt">ChatGPT</span>';

    const card = document.createElement('div');
    card.className = 'db-item-card';
    card.innerHTML = `
      <div class="db-item-header">
        <div style="display:flex; align-items:center; gap:6px;">
          ${platformBadge}
          <span class="db-item-title">${entry.title || entry.fileName}</span>
        </div>
        <button class="link-btn btn-requeue" data-id="${entry.id}" title="Masukkan kembali ke antrean aktif">🔄 Re-Queue</button>
      </div>
      <p class="db-item-prompt">${entry.prompt}</p>
      <div class="db-item-tags">
        <span class="db-tag folder">📁 ${entry.folder || 'Default'}</span>
        <span class="db-tag success">✓ ${entry.resolution || 'HD'}</span>
        <span class="db-tag">Tab #${entry.tabId || '-'}</span>
        <span class="db-tag">${entry.timestamp || ''}</span>
      </div>
    `;

    // Re-Queue Action
    card.querySelector('.btn-requeue').addEventListener('click', (e) => {
      e.stopPropagation();
      addItemsToQueue([{
        title: entry.title,
        fileName: entry.fileName,
        prompt: entry.prompt
      }]);
      log(`Slide "${entry.title}" dimasukkan kembali ke antrean aktif.`, 'info');
    });

    dbListContainer.appendChild(card);
  });
}

txtSearchDb.addEventListener('input', renderDatabase);

// Download database.json
btnDownloadDatabaseJson.addEventListener('click', () => {
  if (generationDatabase.length === 0) {
    alert('Database masih kosong.');
    return;
  }

  const jsonStr = JSON.stringify(generationDatabase, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `AI_Prompter_Database_${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  log('Database berhasil diunduh sebagai file JSON.', 'success');
});

// Clear Database
btnClearDatabase.addEventListener('click', () => {
  if (confirm('Yakin ingin menghapus seluruh rekaman di Database?')) {
    generationDatabase = [];
    saveState();
    renderDatabase();
    updateMetrics();
    log('Database riwayat berhasil dibersihkan.', 'info');
  }
});

// 10. Logs Handler
btnClearLogs.addEventListener('click', () => {
  consoleLog.innerHTML = '<div class="log-row log-info">[SYSTEM] Log dibersihkan.</div>';
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'WORKER_LOG') {
    const platformText = msg.platform ? `[${msg.platform}] ` : '';
    log(`[Tab #${msg.tabId}] ${platformText}${msg.text}`, 'info');
  }
});

// Initialization
loadState().then(() => {
  refreshTabs();
});
