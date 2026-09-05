// core/database.js - Persistent JSON Database & State Manager for ChatGPT Image Automation
const fs = require('fs');
const path = require('path');

class GenerationDatabase {
  constructor(dbPath = null) {
    this.dbPath = dbPath || path.join(process.cwd(), 'outputs', 'database.json');
    this.outputsDir = path.dirname(this.dbPath);
    if (!fs.existsSync(this.outputsDir)) {
      fs.mkdirSync(this.outputsDir, { recursive: true });
    }
    this.data = this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.dbPath)) {
        const raw = fs.readFileSync(this.dbPath, 'utf8');
        return JSON.parse(raw);
      }
    } catch (e) {
      console.warn('⚠️ Gagal membaca database, membuat baru:', e.message);
    }
    return {
      version: '1.0',
      lastUpdated: new Date().toISOString(),
      slides: {}
    };
  }

  save() {
    try {
      this.data.lastUpdated = new Date().toISOString();
      fs.writeFileSync(this.dbPath, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (e) {
      console.error('❌ Gagal menyimpan database:', e.message);
    }
  }

  getSlideFolder(slideNumber) {
    const seq = String(slideNumber).padStart(3, '0');
    const folderName = `slide_${seq}`;
    const folderPath = path.join(this.outputsDir, folderName);
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }
    return { folderName, folderPath };
  }

  isCompleted(slideNumber) {
    const key = String(slideNumber);
    const record = this.data.slides[key];
    if (!record || record.status !== 'SUCCESS') {
      return false;
    }

    // Verifikasi fisik file gambar di folder khususnya
    if (record.imagePath && fs.existsSync(record.imagePath)) {
      const stats = fs.statSync(record.imagePath);
      if (stats.size > 50000) { // Minimal 50KB untuk gambar HD valid
        return true;
      }
    }
    return false;
  }

  updateSlide(slideNumber, recordData) {
    const key = String(slideNumber);
    this.data.slides[key] = {
      ...(this.data.slides[key] || {}),
      ...recordData,
      slide: slideNumber,
      updatedAt: new Date().toISOString()
    };
    this.save();
  }

  getStats(totalSlides = 10) {
    let completed = 0;
    let failed = 0;
    for (let i = 1; i <= totalSlides; i++) {
      if (this.isCompleted(i)) {
        completed++;
      } else if (this.data.slides[String(i)]?.status === 'FAILED') {
        failed++;
      }
    }
    return {
      total: totalSlides,
      completed,
      pending: totalSlides - completed,
      failed
    };
  }
}

module.exports = GenerationDatabase;
