// generator.js - Master Autonomous Runner with State Database & Dedicated Per-Slide Folders (v4.3)
const ChatGPTDriver = require('./core/chatgpt_driver');
const GenerationDatabase = require('./core/database');
const { launchPersistentChrome, isPortListening } = require('./core/chrome_launcher');
const fs = require('fs');
const path = require('path');

const LOCK_FILE = path.join(__dirname, 'outputs', 'generator.lock');

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
  const outputsDir = path.dirname(LOCK_FILE);
  if (!fs.existsSync(outputsDir)) {
    fs.mkdirSync(outputsDir, { recursive: true });
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

// Migrasi file slide_001.png lama ke folder dedicated jika ada
function migrateLegacyFiles(db) {
  const rootSlide1 = path.join(__dirname, 'outputs', 'slide_001.png');
  const { folderPath } = db.getSlideFolder(1);
  const targetSlide1 = path.join(folderPath, 'slide_001.png');

  if (fs.existsSync(rootSlide1) && !fs.existsSync(targetSlide1)) {
    fs.copyFileSync(rootSlide1, targetSlide1);
    const stats = fs.statSync(targetSlide1);
    db.updateSlide(1, {
      name: 'slide_001',
      title: 'Sampul Interaktif Batch 1',
      status: 'SUCCESS',
      imagePath: targetSlide1,
      fileSizeKB: (stats.size / 1024).toFixed(1),
      migrated: true
    });
    console.log(`📦 [DATABASE MIGRASI] File slide_001.png berhasil dimigrasikan ke: ${targetSlide1}`);
  }
}

async function parseArguments() {
  const args = process.argv.slice(2);
  let prompt = null;
  let file = null;
  let delayBetween = 6;
  let forceSlide = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--prompt' || args[i] === '-p') {
      prompt = args[i + 1];
      i++;
    } else if (args[i] === '--file' || args[i] === '-f') {
      file = args[i + 1];
      i++;
    } else if (args[i] === '--delay' || args[i] === '-d') {
      delayBetween = parseInt(args[i + 1]) || 6;
      i++;
    } else if (args[i] === '--force-slide') {
      forceSlide = parseInt(args[i + 1]);
      i++;
    }
  }

  return { prompt, file, delayBetween, forceSlide };
}

async function run() {
  acquireLock();

  console.log('========================================================');
  console.log('  🎨 ChatGPT HD Batch Generator with State Database (v4.3)');
  console.log('========================================================\n');

  const { prompt, file, delayBetween, forceSlide } = await parseArguments();
  const db = new GenerationDatabase();

  // Migrasi slide lama ke folder terstruktur
  migrateLegacyFiles(db);

  // 1. Pastikan Chrome Port 9222 aktif
  let isListening = await isPortListening(9222);
  if (!isListening) {
    console.log('🚀 Chrome Port 9222 belum aktif. Membuka Chrome persistent...');
    await launchPersistentChrome();
  }

  const driver = new ChatGPTDriver();
  
  try {
    await driver.init();

    // 2. Verifikasi status login
    const status = await driver.checkStatus();
    if (!status || !status.isLoggedIn) {
      console.log('\n⚠️ ========================================================');
      console.log(' Akun ChatGPT belum login atau halaman masih memuat!');
      console.log(' Silakan login di jendela Chrome yang terbuka.');
      console.log(' ========================================================\n');
      return;
    }

    console.log('✅ Akun ChatGPT terhubung & siap memproses antrean!\n');

    // 3. Muat antrean prompt
    let rawQueue = [];
    if (prompt) {
      rawQueue.push({ name: 'custom_001', prompt: prompt, title: 'Custom Prompt' });
    } else if (file && fs.existsSync(file)) {
      const content = fs.readFileSync(file, 'utf8');
      if (file.endsWith('.json')) {
        const json = JSON.parse(content);
        rawQueue = Array.isArray(json) ? json : json.prompts || [];
      } else {
        const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('#'));
        rawQueue = lines.map((p, idx) => ({ name: `slide_${String(idx + 1).padStart(3, '0')}`, prompt: p, title: `Slide ${idx + 1}` }));
      }
    } else {
      const defaultJson = path.join(__dirname, 'prompts.json');
      if (fs.existsSync(defaultJson)) {
        rawQueue = JSON.parse(fs.readFileSync(defaultJson, 'utf8'));
      }
    }

    if (rawQueue.length === 0) {
      console.log('📌 Antrean prompt kosong. Silakan sediakan file prompts.json.');
      return;
    }

    const stats = db.getStats(rawQueue.length);
    console.log(`📊 [DATABASE STATUS] Total: ${stats.total} | Selesai: ${stats.completed} | Sisa: ${stats.pending}`);

    for (let index = 0; index < rawQueue.length; index++) {
      const currentSlideNum = index + 1;
      const item = rawQueue[index];
      const seqNumber = String(currentSlideNum).padStart(3, '0');
      const itemPrompt = typeof item === 'string' ? item : item.prompt;
      const itemName = (typeof item === 'object' && item.name) ? item.name : `slide_${seqNumber}`;
      const itemTitle = (typeof item === 'object' && item.title) ? item.title : `Slide ${currentSlideNum}`;

      // Buat folder khusus untuk slide ini: outputs/slide_001/, outputs/slide_002/, dst.
      const { folderName, folderPath } = db.getSlideFolder(currentSlideNum);

      // Cek apakah slide ini SUDAH selesai di database
      if (forceSlide !== currentSlideNum && db.isCompleted(currentSlideNum)) {
        const record = db.data.slides[String(currentSlideNum)];
        console.log(`⏩ [DATABASE SKIP] ${itemTitle} (${folderName}) SUDAH SELESAI tersimpan di: ${record.imagePath}`);
        console.log(`   (Tidak akan digenerate ulang, langsung lanjut ke slide berikutnya!)\n`);
        continue;
      }

      console.log(`\n========================================================`);
      console.log(`🚀 [PROSES SLIDE ${currentSlideNum}/${rawQueue.length}] ${itemTitle} -> [${folderName}/]`);
      console.log(`========================================================`);
      console.log(`📁 Target Folder: ${folderPath}`);
      console.log(`📝 Cuplikan Prompt:\n"${itemPrompt.slice(0, 150)}..."\n`);

      let slideSuccess = false;
      let attempts = 0;
      const maxAttempts = 3;

      while (!slideSuccess && attempts < maxAttempts) {
        attempts++;
        try {
          // A. Setiap slide WAJIB Obrolan Baru
          await driver.startNewChat();

          // B. Suntikkan prompt
          const injected = await driver.setPromptWithImageTool(itemPrompt);
          if (!injected) {
            console.warn(`⚠️ [Attempt ${attempts}] Gagal menyuntikkan prompt, mencoba lagi...`);
            await driver.cdp.sleep(2000);
            continue;
          }

          await driver.cdp.sleep(1200);

          // C. Kirim prompt
          const sent = await driver.sendPrompt();
          if (!sent.clicked) {
            console.warn(`⚠️ [Attempt ${attempts}] Tombol Kirim tidak merespons, mencoba lagi...`);
            await driver.cdp.sleep(2000);
            continue;
          }

          // D. Pantau pembuatan gambar dengan Smart Inspector & Countdown Timer
          let genResult = await driver.waitForGeneration(240, `${itemTitle}`);

          // Jika outputnya hanya teks deskripsi, kirim follow-up paksa generate gambar
          if (genResult.isTextOnly) {
            console.log('🔄 Mengirim perintah ulang untuk memvisualisasikan gambar...');
            await driver.setPromptWithImageTool('Buatkan dan visualisasikan langsung gambarnya sekarang secara nyata, jangan berikan teks penjelasan!');
            await driver.sendPrompt();
            genResult = await driver.waitForGeneration(180, `${itemTitle} Visual Retry`);
          }

          // E. Download file gambar asli (HD) langsung ke folder khusus slide ini
          const hdResult = await driver.downloadHDImageToFolder(folderPath, itemName);

          // F. Ambil screenshot halaman ke folder khusus slide ini
          const screenshotPath = await driver.captureResultScreenshotToFolder(folderPath, 'screenshot');

          // G. Simpan metadata per slide
          const metadata = {
            slide: currentSlideNum,
            name: itemName,
            title: itemTitle,
            prompt: itemPrompt,
            status: hdResult.success ? 'SUCCESS' : 'FAILED',
            attempts,
            elapsedSeconds: genResult.elapsedSeconds || null,
            imagePath: hdResult.success ? hdResult.filePath : null,
            resolution: hdResult.resolution || null,
            fileSizeKB: hdResult.sizeKB || null,
            screenshotPath,
            completedAt: new Date().toISOString()
          };

          fs.writeFileSync(path.join(folderPath, 'metadata.json'), JSON.stringify(metadata, null, 2));

          // H. Update Database Master
          db.updateSlide(currentSlideNum, metadata);

          if (hdResult.success) {
            slideSuccess = true;
            console.log(`✅ [DATABASE UPDATED] ${itemTitle} (${folderName}) berhasil disimpan & tercatat di database!`);
          } else {
            console.warn(`⚠️ Download belum berhasil pada attempt ${attempts}, mencoba ulang...`);
          }

        } catch (err) {
          console.warn(`⚠️ Kendala di Slide ${currentSlideNum} (Attempt ${attempts}):`, err.message);
          await driver.cdp.reconnect().catch(() => {});
          await driver.cdp.sleep(3000);
        }
      }

      if (!slideSuccess) {
        console.warn(`❌ Slide ${currentSlideNum} belum berhasil setelah ${maxAttempts} percobaan. Mencatat status FAILED dan melanjutkan ke slide berikutnya...`);
        db.updateSlide(currentSlideNum, { status: 'FAILED', attempts: maxAttempts, lastError: 'Max attempts reached' });
      }

      // Jeda antar slide berikutnya
      if (index < rawQueue.length - 1) {
        console.log(`⏳ Jeda ${delayBetween} detik sebelum memulai slide berikutnya...`);
        await driver.cdp.sleep(delayBetween * 1000);
      }
    }

    const finalStats = db.getStats(rawQueue.length);
    console.log(`\n========================================================`);
    console.log(`🎉 BATCH GENERATION SELESAI DIPROSES!`);
    console.log(`📊 Hasil Akhir: ${finalStats.completed}/${finalStats.total} Slide Sukses Ter-generate`);
    console.log(`📁 Database Master: ${db.dbPath}`);
    console.log(`========================================================\n`);

  } catch (err) {
    console.error('❌ Terjadi kesalahan fatal:', err.message);
  } finally {
    await driver.close();
    releaseLock();
  }
}

if (require.main === module) {
  run();
}

module.exports = { run };
