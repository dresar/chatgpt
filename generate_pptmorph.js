// generate_pptmorph.js - Multi-Tab Parallel Asset Generator for PPTMORPH Templates (v2.0 PRO)
const CDPClient = require('./core/cdp');
const ChatGPTDriver = require('./core/chatgpt_driver');
const { launchPersistentChrome, isPortListening } = require('./core/chrome_launcher');
const fs = require('fs');
const path = require('path');

const PROMPTS_DIR = 'C:\\Users\\NCN0C\\Pictures\\PPTMORPH\\prompts';
const ASSETS_BASE_DIR = 'C:\\Users\\NCN0C\\Pictures\\PPTMORPH\\assets\\TEMPLATES 001';
const DB_PATH = path.join(ASSETS_BASE_DIR, 'database.json');
const LOCK_FILE = path.join(ASSETS_BASE_DIR, 'generator.lock');

// Parse arguments (contoh: node generate_pptmorph.js --concurrency 2 --delay 4)
const args = process.argv.slice(2);
let CONCURRENCY = 2; // Default 2 tab paralel
let DELAY_BETWEEN = 4; // Detik jeda antar generasi di worker yang sama

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--concurrency' && args[i + 1]) {
    CONCURRENCY = Math.max(1, Math.min(4, parseInt(args[i + 1])));
  }
  if (args[i] === '--delay' && args[i + 1]) {
    DELAY_BETWEEN = parseInt(args[i + 1]);
  }
}

function acquireLock() {
  if (fs.existsSync(LOCK_FILE)) {
    try {
      const pid = parseInt(fs.readFileSync(LOCK_FILE, 'utf8').trim());
      process.kill(pid, 0);
      console.warn(`⚠️ [MUTEX LOCK] Generator sudah aktif di PID: ${pid}. Mencegah duplikasi proses!`);
      process.exit(0);
    } catch (e) {
      try { fs.unlinkSync(LOCK_FILE); } catch (err) {}
    }
  }
  if (!fs.existsSync(ASSETS_BASE_DIR)) {
    fs.mkdirSync(ASSETS_BASE_DIR, { recursive: true });
  }
  fs.writeFileSync(LOCK_FILE, String(process.pid), 'utf8');
}

function releaseLock() {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      fs.unlinkSync(LOCK_FILE);
    }
  } catch (e) {}
}

process.on('exit', releaseLock);
process.on('SIGINT', () => { releaseLock(); process.exit(0); });
process.on('SIGTERM', () => { releaseLock(); process.exit(0); });

class PPTMorphDatabase {
  constructor() {
    this.data = this.load();
    this.inFlight = new Set(); // Mencegah perebutan item antar worker
  }

  load() {
    try {
      if (fs.existsSync(DB_PATH)) {
        return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
      }
    } catch (e) {}
    return {
      version: '2.0',
      lastUpdated: new Date().toISOString(),
      assets: {}
    };
  }

  save() {
    try {
      this.data.lastUpdated = new Date().toISOString();
      fs.writeFileSync(DB_PATH, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (e) {
      console.error('❌ Gagal menyimpan database:', e.message);
    }
  }

  isCompleted(assetId, targetFilePath) {
    const record = this.data.assets[assetId];
    if (record && record.status === 'SUCCESS' && fs.existsSync(targetFilePath)) {
      const stats = fs.statSync(targetFilePath);
      if (stats.size > 50000) {
        return true;
      }
    }
    if (fs.existsSync(targetFilePath)) {
      const stats = fs.statSync(targetFilePath);
      if (stats.size > 50000) {
        this.updateAsset(assetId, {
          status: 'SUCCESS',
          destPath: targetFilePath,
          fileSizeKB: (stats.size / 1024).toFixed(1)
        });
        return true;
      }
    }
    return false;
  }

  claimNextItem(allItems) {
    for (const item of allItems) {
      if (this.inFlight.has(item.id)) continue;
      if (this.isCompleted(item.id, item.destPath)) continue;
      this.inFlight.add(item.id);
      return item;
    }
    return null;
  }

  releaseClaim(assetId) {
    this.inFlight.delete(assetId);
  }

  updateAsset(assetId, recordData) {
    this.data.assets[assetId] = {
      ...(this.data.assets[assetId] || {}),
      ...recordData,
      id: assetId,
      updatedAt: new Date().toISOString()
    };
    this.save();
  }

  getStats(total) {
    let completed = 0;
    let failed = 0;
    for (const key of Object.keys(this.data.assets)) {
      if (this.data.assets[key].status === 'SUCCESS') completed++;
      else if (this.data.assets[key].status === 'FAILED') failed++;
    }
    return { total, completed, pending: total - completed, failed };
  }
}

function parseAllPrompts() {
  function getAllFiles(dir, fileList = []) {
    if (!fs.existsSync(dir)) return fileList;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        getAllFiles(fullPath, fileList);
      } else if (entry.name.endsWith('.txt')) {
        fileList.push(fullPath);
      }
    }
    return fileList;
  }

  const promptFiles = getAllFiles(PROMPTS_DIR);
  const items = [];

  for (const filePath of promptFiles) {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    let targetRelPath = '';
    const promptLines = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('# Target File:') || trimmed.startsWith('# Target:')) {
        const match = trimmed.match(/# Target(?:\s+File)?:\s*(?:assets\/)?(.+)/i);
        if (match) {
          targetRelPath = match[1].trim();
        }
      } else if (!trimmed.startsWith('#') && trimmed.length > 0) {
        promptLines.push(trimmed);
      }
    }

    if (!targetRelPath) {
      const rel = path.relative(PROMPTS_DIR, filePath);
      const parsed = path.parse(rel);
      const folder = parsed.dir.replace(/^00_/, '').replace(/^00_shared_props/, 'shared').replace(/^shared_props/, 'shared');
      const filename = parsed.name.replace(/^\d+_/, '') + '.png';
      targetRelPath = path.join(folder, filename);
    }

    targetRelPath = targetRelPath.replace(/^assets[\/\\]/, '');
    const destPath = path.join(ASSETS_BASE_DIR, targetRelPath);
    const destDir = path.dirname(destPath);
    const baseNameWithoutExt = path.basename(destPath, path.extname(destPath));
    const assetId = path.relative(ASSETS_BASE_DIR, destPath).replace(/[\\\/]/g, '_').replace(/\.png$/i, '');

    items.push({
      id: assetId,
      sourceFile: path.relative(PROMPTS_DIR, filePath),
      destPath,
      destDir,
      baseNameWithoutExt,
      destFileName: path.basename(destPath),
      prompt: promptLines.join(' ')
    });
  }

  return items;
}

// Worker function yang mengontrol satu Tab Chrome secara independen
async function runWorker(workerId, wsUrl, targetId, allItems, db) {
  const prefix = `[Worker ${workerId}]`;
  console.log(`⚡ ${prefix} Inisialisasi tab worker paralel...`);

  const driver = new ChatGPTDriver({ outputDir: ASSETS_BASE_DIR });
  driver.cdp.wsUrl = wsUrl;
  driver.cdp.targetId = targetId;

  try {
    await driver.cdp.connect(wsUrl);
    await driver.cdp.enableDomains();

    const status = await driver.checkStatus(8);
    if (!status || !status.isLoggedIn) {
      console.warn(`⚠️ ${prefix} Tab belum siap atau belum login.`);
      return;
    }

    console.log(`✅ ${prefix} Siap menerima antrean tugas!`);

    while (true) {
      const item = db.claimNextItem(allItems);
      if (!item) {
        console.log(`🏁 ${prefix} Tidak ada tugas tersisa dalam antrean. Worker selesai!`);
        break;
      }

      const currentStats = db.getStats(allItems.length);
      const progressPercent = ((currentStats.completed / allItems.length) * 100).toFixed(1);

      console.log(`\n========================================================`);
      console.log(`🚀 ${prefix} [Total Progres: ${currentStats.completed}/${allItems.length} (${progressPercent}%)]`);
      console.log(`🎯 ASET: ${item.id}`);
      console.log(`📁 Target: ${path.relative(ASSETS_BASE_DIR, item.destPath)}`);
      console.log(`--------------------------------------------------------`);
      console.log(`📝 Prompt: "${item.prompt.slice(0, 120)}..."\n`);

      if (!fs.existsSync(item.destDir)) {
        fs.mkdirSync(item.destDir, { recursive: true });
      }

      let success = false;
      let attempts = 0;
      const maxAttempts = 3;

      while (!success && attempts < maxAttempts) {
        attempts++;
        try {
          // 1. Buka Obrolan Baru di Tab ini
          await driver.startNewChat();

          // 2. Suntikkan prompt
          const injected = await driver.setPromptWithImageTool(item.prompt);
          if (!injected) {
            console.warn(`⚠️ ${prefix} [Attempt ${attempts}] Gagal menyuntikkan prompt, mencoba ulang...`);
            await driver.cdp.sleep(1500);
            continue;
          }

          await driver.cdp.sleep(800);

          // 3. Kirim prompt
          const sent = await driver.sendPrompt();
          if (!sent.clicked) {
            console.warn(`⚠️ ${prefix} [Attempt ${attempts}] Tombol kirim tidak aktif, mencoba ulang...`);
            await driver.cdp.sleep(1500);
            continue;
          }

          // 4. Pantau pembuatan gambar (Timer non-stop)
          let genResult = await driver.waitForGeneration(240, `${item.baseNameWithoutExt} (W${workerId})`);

          // Deteksi cerdas text-only -> re-prompt paksa visual
          if (genResult.isTextOnly) {
            console.log(`🔄 ${prefix} Output hanya teks! Mengirim perintah ulang untuk visualisasi...`);
            await driver.setPromptWithImageTool('Buatkan dan visualisasikan langsung gambarnya sekarang secara nyata, jangan berikan teks penjelasan!');
            await driver.sendPrompt();
            genResult = await driver.waitForGeneration(180, `${item.baseNameWithoutExt} (W${workerId} Retry)`);
          }

          // 5. Ekstrak & Download Gambar HD Asli (TANPA Screenshot agar super cepat)
          const hdResult = await driver.downloadHDImageToFolder(item.destDir, item.baseNameWithoutExt);

          if (hdResult.success) {
            success = true;
            db.updateAsset(item.id, {
              id: item.id,
              sourcePromptFile: item.sourceFile,
              destPath: item.destPath,
              status: 'SUCCESS',
              attempts,
              elapsedSeconds: genResult.elapsedSeconds || null,
              resolution: hdResult.resolution || null,
              fileSizeKB: hdResult.sizeKB || null,
              workerId,
              completedAt: new Date().toISOString()
            });

            console.log(`🎯 ${prefix} [SUKSES BERHASIL] ${item.destFileName} (${hdResult.sizeKB} KB | ${hdResult.resolution})`);
          } else {
            console.warn(`⚠️ ${prefix} Download gagal pada attempt ${attempts}.`);
          }

        } catch (err) {
          console.warn(`⚠️ ${prefix} Kendala pada ${item.id}:`, err.message);
          await driver.cdp.reconnect().catch(() => {});
          await driver.cdp.sleep(2000);
        }
      }

      db.releaseClaim(item.id);

      if (!success) {
        console.warn(`❌ ${prefix} Gagal memproses ${item.id} setelah ${maxAttempts} attempt.`);
        db.updateAsset(item.id, { status: 'FAILED', attempts: maxAttempts });
      }

      // Jeda ringan antar item di worker ini
      await driver.cdp.sleep(DELAY_BETWEEN * 1000);
    }

  } catch (err) {
    console.error(`❌ ${prefix} Fatal error:`, err.message);
  } finally {
    await driver.close();
  }
}

async function run() {
  acquireLock();

  console.log('========================================================');
  console.log(`  ⚡ PPTMORPH TEMPLATES 001 - Multi-Tab Parallel Generator (v2.0 PRO)`);
  console.log(`  🚀 Concurrency: ${CONCURRENCY} Worker Tabs Simultan | Anti-Screenshot`);
  console.log('========================================================\n');

  const allItems = parseAllPrompts();
  const db = new PPTMorphDatabase();

  console.log(`📂 Direktori Prompts : ${PROMPTS_DIR}`);
  console.log(`📁 Direktori Assets  : ${ASSETS_BASE_DIR}`);
  console.log(`📋 Total Aset        : ${allItems.length} Item`);

  const initialStats = db.getStats(allItems.length);
  console.log(`📊 [DATABASE] Sudah Selesai: ${initialStats.completed}/${allItems.length} | Sisa: ${initialStats.pending}\n`);

  if (initialStats.pending === 0) {
    console.log('🎉 Seluruh 55 aset sudah selesai ter-generate!');
    releaseLock();
    return;
  }

  let isListening = await isPortListening(9222);
  if (!isListening) {
    console.log('🚀 Chrome Port 9222 belum aktif. Membuka Chrome persistent...');
    await launchPersistentChrome();
  }

  // Siapkan Tab Worker
  const pages = await CDPClient.getActivePages('127.0.0.1', 9222);
  const chatGptPages = pages.filter(p => p.type === 'page' && (p.url.includes('chatgpt.com') || p.title.toLowerCase().includes('chatgpt')));

  const workerTabs = [];

  // Tab 1: Tab yang sudah ada
  if (chatGptPages.length > 0) {
    workerTabs.push({
      workerId: 1,
      wsUrl: chatGptPages[0].webSocketDebuggerUrl,
      targetId: chatGptPages[0].id
    });
  } else {
    const newTab = await CDPClient.createNewTab('https://chatgpt.com');
    workerTabs.push({
      workerId: 1,
      wsUrl: newTab.webSocketDebuggerUrl,
      targetId: newTab.id
    });
  }

  // Buka Tab tambahan sesuai jumlah Concurrency
  for (let w = 2; w <= CONCURRENCY; w++) {
    console.log(`🌐 Membuka Tab Baru untuk Worker ${w}...`);
    try {
      const newTab = await CDPClient.createNewTab('https://chatgpt.com');
      workerTabs.push({
        workerId: w,
        wsUrl: newTab.webSocketDebuggerUrl,
        targetId: newTab.id
      });
      await new Promise(r => setTimeout(r, 2000));
    } catch (e) {
      console.warn(`⚠️ Gagal membuka tab untuk Worker ${w}:`, e.message);
    }
  }

  console.log(`\n🔥 Memulai ${workerTabs.length} Worker Paralel Simultan!\n`);

  // Jalankan semua worker secara simultan menggunakan Promise.all
  await Promise.all(
    workerTabs.map(tab => runWorker(tab.workerId, tab.wsUrl, tab.targetId, allItems, db))
  );

  const finalStats = db.getStats(allItems.length);
  console.log(`\n========================================================`);
  console.log(`🎉 SELURUH BATCH MULTI-TAB PARALEL SELESAI!`);
  console.log(`📊 Hasil Akhir: ${finalStats.completed}/${allItems.length} Aset Berhasil Ter-generate`);
  console.log(`📁 Lokasi Assets: ${ASSETS_BASE_DIR}`);
  console.log(`📊 Master Database: ${DB_PATH}`);
  console.log(`========================================================\n`);

  releaseLock();
}

if (require.main === module) {
  run();
}

module.exports = { run };
