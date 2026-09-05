// core/chatgpt_driver.js - ChatGPT Master CDP Controller (v4.5 PRO - Ultra Resilient Error & Internal Server Error Detector)
const CDPClient = require('./cdp');
const path = require('path');
const fs = require('fs');

class ChatGPTDriver {
  constructor(options = {}) {
    this.cdp = new CDPClient(options);
    this.outputDir = options.outputDir || path.join(process.cwd(), 'outputs');
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  async init() {
    console.log('🔗 Menghubungkan ke browser Chrome (Port 9222)...');
    await this.cdp.connect();
    await this.cdp.enableDomains();
    console.log('✅ Driver ChatGPT berhasil terhubung!');

    const currentUrl = await this.cdp.eval('window.location.href');
    if (!currentUrl || !currentUrl.includes('chatgpt.com')) {
      console.log('🌐 Mengarahkan tab ke https://chatgpt.com...');
      await this.cdp.navigate('https://chatgpt.com');
      await this.cdp.sleep(3500);
    }
  }

  async checkStatus(maxRetries = 10) {
    for (let i = 0; i < maxRetries; i++) {
      const status = await this.cdp.eval(`(() => {
        const url = window.location.href;
        const editor = document.querySelector('#prompt-textarea') || document.querySelector('div[contenteditable="true"]');
        const hasTextarea = !!editor;
        const hasLoginBtn = !!document.querySelector('button[data-testid="login-button"], a[href*="/auth/login"], button[data-testid="welcome-login-button"]');
        const isGenerating = !!(document.querySelector('button[data-testid="stop-button"]') || document.querySelector('button[aria-label*="Stop"]'));
        const sendBtn = document.querySelector('button[data-testid="send-button"], button[data-testid="fruitjuice-send-button"], button[aria-label="Send prompt"]');
        const sendEnabled = sendBtn ? !sendBtn.disabled : false;
        const allImgs = Array.from(document.querySelectorAll('article img, div[data-testid*="image"] img, img[alt]'));

        return {
          url,
          isLoggedIn: hasTextarea && !hasLoginBtn,
          hasTextarea,
          isGenerating,
          sendEnabled,
          imagesCount: allImgs.length
        };
      })()`);

      if (status && (status.isLoggedIn || status.hasTextarea)) {
        return status;
      }
      if (i < maxRetries - 1) {
        await this.cdp.sleep(1200);
      }
    }

    return await this.cdp.eval(`(() => {
      const editor = document.querySelector('#prompt-textarea') || document.querySelector('div[contenteditable="true"]');
      const hasLoginBtn = !!document.querySelector('button[data-testid="login-button"], a[href*="/auth/login"]');
      return {
        url: window.location.href,
        isLoggedIn: !!editor && !hasLoginBtn,
        hasTextarea: !!editor
      };
    })()`);
  }

  async startNewChat() {
    console.log('🆕 [OBROLAN BARU] Membuka sesi obrolan baru...');
    try {
      const clickedNewChat = await this.cdp.eval(`(() => {
        const newChatBtn = document.querySelector('a[href="/"], button[aria-label*="New chat"], button[aria-label*="Obrolan baru"], a[data-testid*="new-chat"], button[data-testid="create-new-chat-button"]');
        if (newChatBtn) {
          newChatBtn.click();
          return true;
        }
        return false;
      })()`);

      if (!clickedNewChat) {
        await this.cdp.navigate('https://chatgpt.com/');
      }

      for (let i = 0; i < 15; i++) {
        await this.cdp.sleep(700);
        const editorReady = await this.cdp.eval(`!!(document.querySelector('#prompt-textarea') || document.querySelector('div[contenteditable="true"]'))`);
        if (editorReady) {
          console.log('✨ Obrolan baru siap!');
          await this.cdp.sleep(600);
          return true;
        }
      }
    } catch (e) {
      console.warn('⚠️ Fallback navigasi obrolan baru:', e.message);
      await this.cdp.navigate('https://chatgpt.com/');
      await this.cdp.sleep(3000);
    }
    return true;
  }

  async setPromptWithImageTool(promptText) {
    console.log(`📝 Menyuntikkan prompt: "${promptText.length > 70 ? promptText.slice(0, 70) + '...' : promptText}"`);

    const result = await this.cdp.eval(`((text) => {
      try {
        const editor = document.querySelector('#prompt-textarea') || document.querySelector('div[contenteditable="true"]');
        if (!editor) return { ok: false, error: 'Editor prompt tidak ditemukan' };

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
            editor.innerHTML = '<p>' + text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\\n/g, '<br>') + '</p>';
            editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
          }
        }

        editor.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        editor.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true }));

        return { ok: true };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    })(${JSON.stringify(promptText)})`);

    await this.cdp.sleep(600);
    return result && result.ok;
  }

  async sendPrompt() {
    console.log('🚀 Mengirim prompt ke ChatGPT...');
    const result = await this.cdp.eval(`(() => {
      const sendBtn = document.querySelector('button[data-testid="send-button"], button[data-testid="fruitjuice-send-button"], button[aria-label="Send prompt"], button[aria-label="Kirim prompt"]');
      if (sendBtn && !sendBtn.disabled) {
        sendBtn.click();
        return { clicked: true, method: 'button' };
      }

      const editor = document.querySelector('#prompt-textarea') || document.querySelector('div[contenteditable="true"]');
      if (editor) {
        editor.focus();
        const enterDown = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true });
        editor.dispatchEvent(enterDown);
        return { clicked: true, method: 'enter_key' };
      }

      return { clicked: false, error: 'Tombol kirim tidak aktif / tidak ditemukan' };
    })()`);

    await this.cdp.sleep(1200);
    return result;
  }

  async waitForGeneration(maxWaitSeconds = 180, label = 'Asset') {
    console.log(`⏳ Memantau pembuatan gambar (${label}) - Smart Inspector...`);
    const startTime = Date.now();
    let lastLogged = 0;

    while ((Date.now() - startTime) < (maxWaitSeconds * 1000)) {
      await this.cdp.sleep(2000);
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      const remaining = maxWaitSeconds - elapsed;

      const inspect = await this.cdp.eval(`(() => {
        const isGenerating = !!(document.querySelector('button[data-testid="stop-button"]') || document.querySelector('button[aria-label*="Stop"]'));
        
        let actualError = null;
        
        // 1. Cek error merah standar
        const potentialErrors = Array.from(document.querySelectorAll('.text-red-500, .bg-red-500, [data-testid*="error"]'));
        for (const el of potentialErrors) {
          const txt = (el.innerText || '').trim();
          if (txt && !txt.includes('Berpikir') && !txt.includes('Thinking') && !txt.includes('Thought for') && txt.length > 5) {
            if (txt.toLowerCase().includes('error') || txt.toLowerCase().includes('kesalahan') || txt.toLowerCase().includes('limit') || txt.toLowerCase().includes('try again')) {
              actualError = txt;
              break;
            }
          }
        }

        // 2. Cek pesan error server di bubble assistant ("kesalahan di pihak saya")
        if (!actualError) {
          const assistantBubbles = Array.from(document.querySelectorAll('[data-message-author-role="assistant"], .markdown'));
          for (const bubble of assistantBubbles) {
            const txt = (bubble.innerText || '').trim().toLowerCase();
            if (txt.includes('kesalahan di pihak saya') || 
                txt.includes('terjadi kesalahan') || 
                txt.includes('tidak dapat menghasilkan gambar') || 
                txt.includes('an error occurred') || 
                txt.includes('unable to generate image') ||
                txt.includes('something went wrong')) {
              actualError = bubble.innerText.trim();
              break;
            }
          }
        }

        const loadingIndicator = document.querySelector('.animate-spin, [data-testid*="loading"], [role="progressbar"]');
        
        // Cari gambar visual hasil generate
        const allAssistantTurns = Array.from(document.querySelectorAll('[data-message-author-role="assistant"], article, .conversation-turn'));
        const lastTurn = allAssistantTurns.length > 0 ? allAssistantTurns[allAssistantTurns.length - 1] : document.body;
        
        const visualImgs = Array.from(lastTurn.querySelectorAll('img')).filter(img => {
          const isAvatar = (img.src && (img.src.includes('avatar') || img.src.includes('profile') || img.src.includes('auth0'))) || (img.alt && img.alt.toLowerCase().includes('profil'));
          const hasValidSrc = img.src && (img.src.startsWith('blob:') || img.src.includes('oaiusercontent') || img.src.startsWith('data:') || img.naturalWidth > 150);
          return !isAvatar && hasValidSrc;
        });

        // Fallback cari di seluruh dokumen jika belum ketemu
        let allVisualImgs = visualImgs;
        if (allVisualImgs.length === 0) {
          allVisualImgs = Array.from(document.querySelectorAll('img')).filter(img => {
            const isAvatar = (img.src && (img.src.includes('avatar') || img.src.includes('profile') || img.src.includes('auth0'))) || (img.alt && img.alt.toLowerCase().includes('profil'));
            return !isAvatar && (img.src.includes('oaiusercontent') || img.src.startsWith('blob:') || img.naturalWidth > 200);
          });
        }

        const textContent = lastTurn ? lastTurn.innerText.trim() : '';
        const isTextOnly = !isGenerating && !loadingIndicator && allVisualImgs.length === 0 && textContent.length > 40 && !actualError;

        return {
          isGenerating: isGenerating || !!loadingIndicator,
          actualError,
          hasNewImage: allVisualImgs.length > 0,
          visualImagesCount: allVisualImgs.length,
          isTextOnly,
          textContent: textContent.slice(0, 140)
        };
      })()`);

      if (elapsed - lastLogged >= 5) {
        lastLogged = elapsed;
        const statusText = inspect?.isGenerating ? '🎨 Sedang memproses & merender gambar HD...' : inspect?.hasNewImage ? '🖼️ Gambar ditemukan, memvalidasi render...' : 'Memeriksa respons AI...';
        console.log(`⏱️ [⏳ ${elapsed}s / ${maxWaitSeconds}s] (Sisa: ${remaining}s) - ${statusText}`);
      }

      if (inspect && inspect.actualError) {
        console.warn(`⚠️ Error ChatGPT terdeteksi: "${inspect.actualError}"`);
        return { success: false, error: inspect.actualError };
      }

      if (inspect && inspect.isTextOnly && elapsed >= 12) {
        console.warn(`⚠️ Output terdeteksi HANYA TEKS: "${inspect.textContent}..."`);
        return { success: false, isTextOnly: true, textContent: inspect.textContent };
      }

      if (!inspect?.isGenerating && inspect?.hasNewImage && elapsed >= 6) {
        console.log(`✨ [100% SELESAI] Gambar HD berhasil terdeteksi dalam ${elapsed} detik!`);
        await this.cdp.sleep(2500);
        return { success: true, elapsedSeconds: elapsed };
      }
    }

    console.warn(`⚠️ Waktu tunggu habis (${maxWaitSeconds}s).`);
    return { success: false, timeout: true };
  }

  async downloadHDImageToFolder(targetFolder, outputFileName = 'image') {
    if (!fs.existsSync(targetFolder)) {
      fs.mkdirSync(targetFolder, { recursive: true });
    }
    console.log(`📥 Mengekstrak file gambar HD asli ke folder: ${path.basename(targetFolder)}/${outputFileName}...`);

    const imageData = await this.cdp.eval(`(async () => {
      try {
        let imgs = Array.from(document.querySelectorAll('img')).filter(img => {
          const isAvatar = (img.src && (img.src.includes('avatar') || img.src.includes('profile') || img.src.includes('auth0'))) || (img.alt && img.alt.toLowerCase().includes('profil'));
          return !isAvatar && (img.src.includes('oaiusercontent') || img.src.startsWith('blob:') || img.naturalWidth > 150);
        });

        if (imgs.length === 0) {
          return { error: 'Tidak ditemukan elemen gambar visual di halaman' };
        }

        const targetImg = imgs[imgs.length - 1];
        const srcUrl = targetImg.src;
        const altText = targetImg.alt || '';
        const width = targetImg.naturalWidth || targetImg.width;
        const height = targetImg.naturalHeight || targetImg.height;

        const response = await fetch(srcUrl);
        const blob = await response.blob();
        
        return new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            resolve({
              ok: true,
              dataUrl: reader.result,
              mimeType: blob.type,
              sizeBytes: blob.size,
              srcUrl: srcUrl,
              altText: altText,
              width: width,
              height: height
            });
          };
          reader.onerror = () => resolve({ error: 'Gagal membaca blob gambar' });
          reader.readAsDataURL(blob);
        });
      } catch (err) {
        return { error: err.message };
      }
    })()`);

    if (imageData && imageData.ok && imageData.dataUrl) {
      const base64Data = imageData.dataUrl.replace(/^data:image\/\w+;base64,/, '');
      const ext = imageData.mimeType.includes('png') ? 'png' : imageData.mimeType.includes('webp') ? 'webp' : 'jpg';
      const finalFileName = `${outputFileName}.${ext}`;
      const filePath = path.join(targetFolder, finalFileName);

      fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
      console.log(`🎯 [DOWNLOAD HD SUKSES] File: ${finalFileName} (${(imageData.sizeBytes / 1024).toFixed(1)} KB)`);

      return {
        success: true,
        filePath,
        fileName: finalFileName,
        resolution: `${imageData.width}x${imageData.height}`,
        sizeKB: (imageData.sizeBytes / 1024).toFixed(1),
        altText: imageData.altText,
        srcUrl: imageData.srcUrl
      };
    } else {
      console.warn('⚠️ Gagal download gambar blob:', imageData?.error);
      return { success: false, error: imageData?.error };
    }
  }

  async close() {
    await this.cdp.close();
  }
}

module.exports = ChatGPTDriver;
