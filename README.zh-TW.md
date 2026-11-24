<div align="center">

![AWTRIX Google Calendar CJK Preview](assets/preview_zh.svg)

# AWTRIX Google Calendar CJK (繁體中文版說明)

[![AWTRIX NG](https://img.shields.io/badge/AWTRIX-NG-blue.svg)](https://github.com/Blueforcer/awtrix-light)
[![Platform](https://img.shields.io/badge/Hardware-ESP32%20%7C%20Ulanzi%20TC002-orange.svg)]()
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare)](https://workers.cloudflare.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Font License: OFL 1.1](https://img.shields.io/badge/Font%20License-SIL%20OFL%201.1-green.svg)](https://scripts.sil.org/OFL)

[English](README.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md)

<p>專為 <strong>Ulanzi TC002</strong> 與 <strong>AWTRIX NG</strong> / <strong>ESP32</strong> 點陣像素時鐘打造的開源 Google 日曆行程應用程式，支援完整中日韓多國語系。</p>

</div>

徹底解決微控制器因記憶體受限而無法正常顯示中日韓文字、只能顯示為問號（`???`）或缺字方塊（豆腐塊）的問題。透過輕量 Cloudflare Worker 代理服務，在雲端將日曆行程文字即時轉碼為 8 像素點陣資料，完美支援**繁體中文、簡體中文、日文（漢字與平假名／片假名）以及 100% 現代韓文全音節（11,172 個諺文字元）**。

---

## ✨ 核心特色

> [!NOTE]
> **點陣顯示備註**：由於 8 像素（8px）的硬體點陣限制，筆畫較多的文字可能無法完全清楚辨識；字庫已盡可能進行最佳化顯示，如有不便敬請見諒。

- **完整東亞語系支援**：
  - **中文**：繁體與簡體中文（14,719 個 CJK 統一漢字）。
  - **日文**：平假名、片假名、長音符（`ー`）、促音與日文漢字。
  - **韓文**：**100% 覆蓋 Unicode 全部 11,172 個現代韓文音節**（U+AC00 至 U+D7A3），絕不缺字。
- **完整支援重複活動**：每日／每週／每月／每年重複（含「每月最後一個週五」）、例外日期、單次改期、已取消活動、跨日全天活動與活動各自的時區，都由 Worker 正確處理。
- **重視隱私**：私人 iCal 網址可存成 Worker secret（`ICAL_URL`），不會出現在請求網址與記錄中；Worker 以存取金鑰（`ACCESS_KEY`，透過標頭傳送）保護，且只會抓取 Google 日曆，不會被當成開放代理濫用。
- **雙行動態排版**：
  - 上行：格式化日期、時間與在地化星期（週一、月、Mon、월 等）。
  - 下行：事件標題，長標題支援平滑跑馬燈滾動顯示。
- **旋鈕切換與手動模式**：
  - 順時針／逆時針旋轉旋鈕瀏覽前後行程。
  - 按壓旋鈕立即跳回第一筆即將到來的行程。
  - 輪播秒數設為 `0` 即可完全關閉自動輪播，變身為 100% 旋鈕手動操控模式。
- **連線自動修復與狀態指示**：
  - 連線失敗時自動以遞增間隔重試（`Retry 5s` → `10s` → `20s`…，最長為同步間隔）；設定錯誤則直接顯示，不會一直重試。
  - 隨時按下設備上方按鍵即可強制立即重新整理。
  - 載入中（`Loading...`）、重試（`Retry`）、設定提醒（`Set Worker` / `Set iCal`）、金鑰錯誤（`Bad key`）、其他錯誤（`Err 4xx`）等提示在 16px 螢幕上皆垂直置中顯示。
- **邊緣快取與極速響應**：
  - Worker 具備 2.5 分鐘記憶體快取，避免頻繁向 Google 重新拉取 300KB 的 iCal 檔案。
  - Cloudflare Edge 回應速度低至 20~50 毫秒。

---

## 🏗️ 系統架構

```
┌─────────────────────────────────┐
│     Ulanzi TC002 / ESP32        │
│  (calendar_cjk.be Berry Script) │
└────────────────┬────────────────┘
                 │ HTTP GET ?tz=...&lang=...  (header: X-Access-Key)
                 ▼
┌─────────────────────────────────┐
│       Cloudflare Worker         │
│     (worker/worker.js ~32KB)    │
└────────┬──────────────────────┬─┘
         │                      │
         │ 抓取並快取 iCal        │ 邊緣快取字庫
         ▼                      ▼
┌──────────────────┐  ┌───────────────────────────────┐
│ Google Calendar  │  │   jsDelivr / GitHub CDN       │
│   (私人 iCal)    │  │ (assets/cjk_font.bin ~230 KB) │
└──────────────────┘  └───────────────────────────────┘
```

1. **TC002** 發送包含語系、時區（以及選填的 iCal 網址）的請求，並以標頭附上存取金鑰。
2. **Cloudflare Worker** 解析 iCal，並利用 2.6 萬字的二進位點陣字庫將文字轉換為 8px 像素列二進位資料。
3. **TC002** 接收後直接畫出像素，設備端完全不需浪費 ESP32 內部 Flash 空間存放龐大字庫。

---

## 🚀 快速安裝與設定指南

### 步驟 0：取得 Google 日曆的私人 iCal 網址

時鐘需要透過「iCal 格式的私人網址」取得行程：

1. 使用電腦瀏覽器打開 [Google 日曆網頁版](https://calendar.google.com/)。
2. 在左側「我的日曆」清單中，將滑鼠移至欲顯示的日曆名稱上，點擊旁邊的 **「⋮」（選項）** $\rightarrow$ **「設定與共用」**（Settings and sharing）。
3. 於左側選單點選 **「整合日曆」**（或向下滑動至該區塊）。
4. 找到 **「iCal 格式的非公開網址」**（Secret address in iCal format），點擊右側的複製按鈕。

> [!IMPORTANT]
> 請務必複製「**非公開網址**」（網址格式通常包含 `private-.../basic.ics`）。**切勿**複製「公開網址」，否則在未公開日曆下會無法讀取行程。

---

### 第一步：部署 Cloudflare Worker

提供兩種佈署選擇：

#### 方案 A：CDN 乾淨版（強烈推薦，原始碼僅約 32KB，Gzip 後僅 11KB）
1. Fork 或將此專案 Push 至您的 GitHub。
2. 前往 [Cloudflare Dashboard](https://dash.cloudflare.com/) $\rightarrow$ **Workers & Pages** $\rightarrow$ **Create Worker**。
3. 為 Worker 命名（例如 `tc002-calendar`）並點擊 **Deploy**。
4. 點擊右上角 **Edit code**，將內容替換為 [`worker/worker.js`](worker/worker.js)，點擊 **Deploy** 即可。
   > *預設會自動從 `https://cdn.jsdelivr.net/gh/patw0929/awtrix-calendar-cjk@master/assets/cjk_font.bin` 抓取字庫並進行邊緣快取。若使用自訂網域或 R2，可在 Worker 環境變數設定 `FONT_URL`。*

#### 方案 B：單檔獨立版（無需 CDN）
若暫時不想託管字庫於 CDN，直接將 [`worker/worker.standalone.js`](worker/worker.standalone.js) 的全部內容貼入 Cloudflare Worker 即可。

---

### 第一步之二：保護 Worker（建議）

把 iCal 網址存在 Worker 而不是時鐘上，並要求存取金鑰：

1. 產生一組隨機金鑰，例如 `openssl rand -hex 24`。
2. 在 **Cloudflare Dashboard** → 您的 Worker → **Settings** → **Variables and Secrets** 新增兩個類型為 **Secret** 的變數：
   - `ICAL_URL`：步驟 0 取得的私人 iCal 網址。
   - `ACCESS_KEY`：剛才產生的隨機金鑰。

   也可以在 `worker/` 資料夾用 Wrangler：`wrangler secret put ICAL_URL` 與 `wrangler secret put ACCESS_KEY`。
3. 在第三步的設定中，把同一組金鑰填入 **Access key**，**iCal URL** 留空。

> [!WARNING]
> 請勿只設定 `ICAL_URL` 而不設定 `ACCESS_KEY`：任何知道 Worker 網址的人都能讀到您的行事曆。Worker 遇到這種設定會直接回傳錯誤。

> [!TIP]
> Worker 只會透過 HTTPS 抓取 `calendar.google.com` 的 iCal。若要允許其他來源，可設定 `ALLOWED_HOSTS` 變數（以逗號分隔）。若 iCal 網址曾外流，請在 Google 日曆私人網址旁按「重設」，再更新 `ICAL_URL`。

---

### 第二步：安裝設備端腳本（Berry Script）

1. 在瀏覽器打開您的 AWTRIX 設備後台（`http://<設備IP>/`）。
2. 進入頂部導覽列的 **Scripts** 頁面。
3. 點擊 **SCRIPTS** 列表旁的 **`+`** 按鈕新增腳本。
4. 將 [`app/calendar_cjk.be`](app/calendar_cjk.be) 的內容完整貼入右側程式碼編輯器。
5. 點擊下方／右下角的 **Save**（儲存並編譯）。

> [!TIP]
> **舊版韌體使用者**：若您的介面沒有 **Scripts** 標籤，請前往 **Files** $\rightarrow$ 切換至 `/app` 目錄建立 `calendar_cjk.be`。

---

### 第三步：設定參數

進入 AWTRIX 後台 $\rightarrow$ **Apps** $\rightarrow$ **Google Calendar CJK**：

| 設定項目 | 說明 | 預設值 |
| :--- | :--- | :--- |
| **iCal URL** | Google 日曆私人地址（iCal 格式）。若已存成 Worker 的 `ICAL_URL` secret（建議），請留空 | *(空白)* |
| **Access key** | 需與 Worker 的 `ACCESS_KEY` secret 相同，以 `X-Access-Key` 標頭傳送 | *(空白)* |
| **Worker URL** | 您的 Cloudflare Worker 網址（`https://<name>.<subdomain>.workers.dev`） | *(必填)* |
| **Language** | 星期與相對日期語言：`zh-TW`、`zh-CN`、`en`、`ja`、`ko` | `zh-TW` |
| **Time zone** | 標準 IANA 時區（如 `Asia/Taipei`、`Asia/Tokyo`、`America/New_York`） | `Asia/Taipei` |
| **Max future days** | 抓取未來幾天內的日曆事件 | `14` |
| **Auto cycle (sec)**| 事件自動輪播秒數。**設為 `0` 即完全關閉輪播，改為 100% 旋鈕手動操控** | `8` |
| **Refresh interval**| 向 Google 同步日曆的間隔（分鐘） | `15` |
| **Scroll speed** | 長標題跑馬燈滾動速度百分比 | `100` |
| **Time / day colour**| 日期、時間、星期幾的顯示顏色 | `#8AB4F8` |
| **Hide when empty** | 未來無行程時自動在輪播清單中隱藏此 App | `true` |

---

## 🎮 操作指南

- **旋鈕向右轉**：查看下一筆行程。
- **旋鈕向左轉**：查看上一筆行程。
- **按壓旋鈕**：快速返回第一筆最即將到來的行程。
- **上方 Select 鍵**：立即強制重新向 Worker 同步最新行程。

---

## 🛠️ 自行編譯字型資料庫

`assets/cjk_font.bin` 包含由 TakWolf 開源像素字體萃取出的 26,212 個字符點陣：

```bash
node scripts/build_font.js /path/to/ja.bdf /path/to/ko.bdf
```

資料結構規格：
- 每個字符固定為 **9 位元組（Bytes）**：
  - `bytes 0-1`：Unicode 碼點（16-bit Big-Endian）。
  - `bytes 2-8`：7 列各 8 位元的點陣數據。
- 陣列依照 Unicode 碼點嚴格遞增排序，於 Worker 中進行二分搜尋（Binary Search）只需 $\le 15$ 次比對（低於 0.001 毫秒）。

---

## 🧪 開發

```bash
node scripts/test_worker.mjs
```

執行 Worker 的離線回歸測試（重複活動、時區、標點、網址白名單、存取金鑰）。

```bash
node scripts/build_standalone.js --check
node scripts/build_standalone.js
```

`worker/worker.standalone.js` 是由 `worker/worker.js` 加上字庫自動產生。請只修改 `worker.js`，再重新產生。

---

## 📄 授權與鳴謝

- 本專案程式碼採用 **[MIT License](LICENSE)** 開源授權 © 2026 patw。
- 靈感與基礎邏輯源自 **[Mvrcl1005](https://awtrix.de/scripts/all?query=Mvrcl1005)** 的 [Google Calendar Agenda](https://awtrix.de/script/hmrKzlDZJrBm)。
- 點陣字庫萃取自 TakWolf 的 **[Fusion Pixel Font](https://github.com/TakWolf/fusion-pixel-font)**，依據 **SIL Open Font License 1.1** 授權使用。
