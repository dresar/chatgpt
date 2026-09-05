# 🚀 ChatGPT Image Generation Automation Master Suite (CDP Port 9222)

Sistem otomasi mutakhir berbasis **Chrome DevTools Protocol (CDP)** untuk mengontrol browser Google Chrome, mengirim prompt pembuatan gambar beruntun (DALL-E 3 / Image Generator), dan memantau status pembuatan secara realtime hingga **100% selesai**.

---

## ⚡ 1. Cara Membuka Browser & Login ke Akun ChatGPT

### Opsi A: Menggunakan PowerShell / Terminal
Jalankan perintah berikut di PowerShell:
```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --remote-allow-origins=* --user-data-dir="C:\Users\NCN0C\.chrome-automation" --no-first-run --no-default-browser-check "https://chatgpt.com"
```

### Opsi B: Menggunakan File Batch
Klik ganda file:
```cmd
start_chrome.bat
```

> **Catatan Login:**
> Anda hanya perlu melakukan login akun ChatGPT **1 kali saja** di browser yang terbuka tersebut. Sesi login akan tersimpan secara permanen di profil `C:\Users\NCN0C\.chrome-automation`.

---

## 🎨 2. Cara Menjalankan Otomasi Generate Gambar

### Menjalankan 1 Prompt Langsung
```powershell
node generator.js --prompt "Buatkan gambar kucing astronot di bulan bergaya 3D Pixar 8k"
```

### Menjalankan Antrean Banyak Prompt dari File (`prompts.txt`)
```powershell
node generator.js --file prompts.txt --delay 5
```

### Memeriksa Status Tab & Koneksi Chrome
```powershell
npm run test-connection
```

---

## 📁 3. Output & Hasil Pembuatan Gambar
- Seluruh screenshot hasil generasi ChatGPT dan metadata URL gambar akan otomatis tersimpan di folder `outputs/`.
- File laporan ringkasan: `outputs/generation_report.json`.
