// background.js - Service Worker for AI Prompter Extension (100% Floating In-Page Window)

// 1. Klik Icon Extension -> Toggle Jendela Melayang di Atas Halaman Aktif
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id) return;

  const isSupported = tab.url && (tab.url.includes('chatgpt.com') || tab.url.includes('gemini.google.com'));
  if (!isSupported) {
    // Jika bukan di ChatGPT atau Gemini, buka ChatGPT baru
    chrome.tabs.create({ url: 'https://chatgpt.com/' });
    return;
  }

  try {
    await chrome.tabs.sendMessage(tab.id, { action: 'TOGGLE_FLOATING_WIDGET' });
  } catch (err) {
    try {
      await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['content/widget.css'] });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/content.js'] });
      await new Promise(r => setTimeout(r, 300));
      await chrome.tabs.sendMessage(tab.id, { action: 'TOGGLE_FLOATING_WIDGET' });
    } catch (e) {
      console.error('Gagal toggle window melayang:', e);
    }
  }
});

// 2. Message Router & Silent Downloader Handler
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'DOWNLOAD_HD_IMAGE') {
    (async () => {
      try {
        let rawFilename = message.filename || 'chatgpt_image.png';

        // Bersihkan drive letter Windows (misal C:\, D:/) dan backslash
        let sanitized = rawFilename
          .replace(/^[a-zA-Z]:[\\\/]+/g, '')
          .replace(/^Users[\\\/][^\\\/]+[\\\/]Downloads[\\\/]*/i, '')
          .replace(/\\/g, '/')
          .replace(/\/+/g, '/')
          .replace(/^\/+/, '');

        if (!sanitized) sanitized = 'chatgpt_image.png';

        const downloadId = await chrome.downloads.download({
          url: message.dataUrl,
          filename: sanitized,
          saveAs: false,
          conflictAction: 'uniquify'
        });
        sendResponse({ success: true, downloadId, filename: sanitized });
      } catch (err) {
        console.error('Download error:', err);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  if (message.type === 'GET_ALL_AI_TABS') {
    (async () => {
      try {
        const [gptTabs, geminiTabs] = await Promise.all([
          chrome.tabs.query({ url: 'https://chatgpt.com/*' }),
          chrome.tabs.query({ url: 'https://gemini.google.com/*' })
        ]);
        sendResponse({ success: true, tabs: [...gptTabs, ...geminiTabs] });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }
});
