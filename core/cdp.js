// core/cdp.js - Robust Chrome DevTools Protocol Client (Native Node.js WebSocket & Multi-Tab Worker Engine)
const http = require('http');
const path = require('path');
const fs = require('fs');

class CDPClient {
  constructor(options = {}) {
    this.host = options.host || '127.0.0.1';
    this.port = options.port || 9222;
    this.wsUrl = options.wsUrl || null;
    this.targetId = options.targetId || null;
    this.ws = null;
    this.id = 0;
    this.callbacks = new Map();
  }

  static async getActivePages(host = '127.0.0.1', port = 9222, maxAttempts = 6) {
    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const list = await new Promise((resolve, reject) => {
          const req = http.get(`http://${host}:${port}/json/list`, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
              try {
                resolve(JSON.parse(data));
              } catch (e) {
                reject(new Error(`Gagal parse JSON dari Chrome CDP: ${e.message}`));
              }
            });
          });
          req.on('error', (err) => reject(err));
          req.setTimeout(3000, () => {
            req.destroy();
            reject(new Error('Timeout menghubungi Chrome CDP'));
          });
        });
        return list;
      } catch (err) {
        lastError = err;
        if (attempt < maxAttempts) {
          await new Promise(r => setTimeout(r, 1200));
        }
      }
    }
    throw new Error(`Tidak dapat terhubung ke Chrome Remote Debugging di ${host}:${port}. Pastikan jendela Chrome Port 9222 tetap terbuka.`);
  }

  static async createNewTab(url = 'https://chatgpt.com', host = '127.0.0.1', port = 9222) {
    return new Promise((resolve, reject) => {
      const req = http.get(`http://${host}:${port}/json/new?${encodeURIComponent(url)}`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Gagal parse new tab JSON: ${e.message}`));
          }
        });
      });
      req.on('error', (err) => reject(err));
      req.setTimeout(5000, () => {
        req.destroy();
        reject(new Error('Timeout create new tab'));
      });
    });
  }

  static async closeTab(targetId, host = '127.0.0.1', port = 9222) {
    return new Promise((resolve) => {
      const req = http.get(`http://${host}:${port}/json/close/${targetId}`, () => resolve(true));
      req.on('error', () => resolve(false));
      req.setTimeout(3000, () => {
        req.destroy();
        resolve(false);
      });
    });
  }

  static async findTargetTab(host = '127.0.0.1', port = 9222, urlFilter = 'chatgpt.com') {
    const list = await CDPClient.getActivePages(host, port);
    const page = list.find(p => p.type === 'page' && p.url && (p.url.includes(urlFilter) || p.title.toLowerCase().includes('chatgpt'))) ||
                 list.find(p => p.type === 'page' && p.url && p.url.startsWith('http')) ||
                 list.find(p => p.type === 'page');
    return page;
  }

  async connect(targetWsUrl = null) {
    const wsUrl = targetWsUrl || this.wsUrl;
    if (!wsUrl) {
      const target = await CDPClient.findTargetTab(this.host, this.port);
      if (!target || !target.webSocketDebuggerUrl) {
        throw new Error('Tidak ditemukan tab ChatGPT aktif di Chrome Remote Debugging (port 9222).');
      }
      this.wsUrl = target.webSocketDebuggerUrl;
      this.targetId = target.id;
      console.log(`🔌 Terhubung ke Tab Chrome: "${target.title}" (${target.url})`);
    } else {
      this.wsUrl = wsUrl;
    }

    return new Promise((resolve, reject) => {
      const connectTimeout = setTimeout(() => {
        reject(new Error('WebSocket connection timeout to ' + this.wsUrl));
      }, 8000);

      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => {
        clearTimeout(connectTimeout);
        resolve(this);
      };
      this.ws.onerror = (err) => {
        clearTimeout(connectTimeout);
        reject(err);
      };
      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.id && this.callbacks.has(msg.id)) {
            const cb = this.callbacks.get(msg.id);
            this.callbacks.delete(msg.id);
            if (msg.error) {
              cb.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
            } else {
              cb.resolve(msg.result);
            }
          }
        } catch (e) {}
      };
    });
  }

  async reconnect(maxRetries = 5) {
    for (let i = 1; i <= maxRetries; i++) {
      try {
        if (this.ws) {
          try { this.ws.close(); } catch(e){}
        }
        this.callbacks.clear();
        await this.connect(this.wsUrl);
        await this.enableDomains();
        console.log('🔄 [CDP Client] Berhasil re-koneksi otomatis ke tab Chrome!');
        return true;
      } catch (e) {
        if (i < maxRetries) {
          await this.sleep(1500);
        } else {
          console.warn(`⚠️ Re-koneksi CDP gagal setelah ${maxRetries} percobaan:`, e.message);
          return false;
        }
      }
    }
    return false;
  }

  async send(method, params = {}, timeoutMs = 25000) {
    if (!this.ws || this.ws.readyState !== 1) {
      const ok = await this.reconnect();
      if (!ok || !this.ws || this.ws.readyState !== 1) {
        throw new Error(`Gagal mengirim [${method}]: WebSocket tidak aktif.`);
      }
    }

    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.callbacks.has(id)) {
          this.callbacks.delete(id);
          reject(new Error(`Timeout CDP [${method}] setelah ${timeoutMs}ms`));
        }
      }, timeoutMs);

      this.callbacks.set(id, {
        resolve: (val) => { clearTimeout(timer); resolve(val); },
        reject: (err) => { clearTimeout(timer); reject(err); }
      });

      try {
        this.ws.send(JSON.stringify({ id, method, params }));
      } catch (err) {
        clearTimeout(timer);
        this.callbacks.delete(id);
        reject(err);
      }
    });
  }

  async enableDomains() {
    try {
      await Promise.allSettled([
        this.send('Runtime.enable', {}, 4000),
        this.send('DOM.enable', {}, 4000),
        this.send('Page.enable', {}, 4000)
      ]);
    } catch (e) {}
  }

  async eval(expression, timeoutMs = 25000) {
    try {
      const res = await this.send('Runtime.evaluate', {
        expression: expression,
        returnByValue: true,
        awaitPromise: true
      }, timeoutMs);
      return res && res.result ? res.result.value : null;
    } catch (e) {
      return null;
    }
  }

  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async navigate(url) {
    await this.send('Page.navigate', { url });
  }

  async captureScreenshot(name = 'screenshot', outputDir = null) {
    try {
      const res = await this.send('Page.captureScreenshot', { format: 'png' });
      if (res && res.data) {
        const targetDir = outputDir || process.cwd();
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }
        const outPath = path.join(targetDir, `${name}.png`);
        fs.writeFileSync(outPath, Buffer.from(res.data, 'base64'));
        return outPath;
      }
    } catch (e) {
      console.warn('Gagal ambil screenshot:', e.message);
    }
    return null;
  }

  async close() {
    if (this.ws) {
      try { this.ws.close(); } catch (e) {}
    }
  }
}

module.exports = CDPClient;
