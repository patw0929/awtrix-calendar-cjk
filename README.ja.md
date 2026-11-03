<div align="center">

![AWTRIX Google Calendar CJK Preview](assets/preview_ja.svg)

# AWTRIX Google Calendar CJK (日本語版ドキュメント)

[![AWTRIX NG](https://img.shields.io/badge/AWTRIX-NG-blue.svg)](https://github.com/Blueforcer/awtrix-light)
[![Platform](https://img.shields.io/badge/Hardware-ESP32%20%7C%20Ulanzi%20TC002-orange.svg)]()
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare)](https://workers.cloudflare.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Font License: OFL 1.1](https://img.shields.io/badge/Font%20License-SIL%20OFL%201.1-green.svg)](https://scripts.sil.org/OFL)

[English](README.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md)

<p><strong>Ulanzi TC002</strong> および <strong>AWTRIX NG</strong> / <strong>ESP32</strong> ピクセルクロック向けに開発された、日本語・英語・中国語・韓国語に完全対応する Google カレンダー予定表示アプリです。</p>

</div>

マイコン（ESP32）のメモリ制約による日本語・中国語・韓国語の文字化け（「???」や空白の豆腐「□」）を根本から解決します。軽量な Cloudflare Worker プロキシを介してカレンダーの予定を 8px ドットマトリクスデータへと動的にラスタライズ（文字描画）し、**日本語（漢字・ひらがな・カタカナ・長音符）、中国語（繁体字・簡体字）、現代韓国語ハングル全音節（11,172文字）**を文字欠けなく美しく表示します。

---

## ✨ 主な機能

> [!NOTE]
> **ドットフォント表示に関する注記**：8ピクセル（8px）という限られたドット数の仕様上、画数の多い文字や複雑な漢字は一部鮮明に判別できない場合があります。可能な限り判読性を高める表示最適化を行っておりますが、あらかじめご了承いただけますと幸いです。

- **東アジア言語（CJK）の完全サポート**：
  - **日本語**：ひらがな、カタカナ、長音符（`ー`）、濁音・半濁音、促音、および常用・人名漢字。
  - **韓国語**：**Unicode 現代ハングル全 11,172 音節を 100% カバー**（U+AC00 〜 U+D7A3）、文字欠けしません。
  - **中国語**：繁体字および簡体字（14,719 個の CJK 統合漢字）。
- **完全なプライバシー保護**：秘密の Google カレンダー iCal URL はご自身のデバイス内部にのみ保存され、Worker にハードコードされないため安全です。
- **2行構成のダイナミックレイアウト**：
  - 上段：フォーマットされた日付・時刻・ローカライズされた曜日（月、火、水… や今日、明日）。
  - 下段：予定のタイトル（長いタイトルは滑らかな電光掲示板風マーキースクロールに対応）。
- **ロータリーノブ操作と完全手動モード**：
  - ノブを時計回り／反時計回りに回して前後の予定を閲覧。
  - ノブを押し込むことで最も直近の予定へ即座にリセット。
  - 巡回間隔を `0` 秒に設定すると自動巡回が停止し、100% ノブによる手動コントロールモードに移行可能。
- **自動復旧とステータス表示**：
  - ネットワークの瞬断時にはカウントダウン表示（`Retry 5s` $\rightarrow$ `Loading...`）。
  - デバイス上部の Select ボタンを押すといつでも即座に再同期。
  - 読み込み中（`Loading...`）、再試行（`Retry`）、初期設定案内（`Set Worker` / `Set iCal`）などのステータス表示は 16px 画面の中央に綺麗に配置。
- **エッジキャッシュと高速レスポンス**：
  - Worker 内部で 2.5 分間のインメモリキャッシュを保持し、Google への過度な iCal 取得（約 300KB）を防止。
  - Cloudflare Edge による 20〜50ms の超高速レスポンス。

---

## 🏗️ システム構成

```
┌─────────────────────────────────┐
│     Ulanzi TC002 / ESP32        │
│  (calendar_cjk.be Berry Script) │
└────────────────┬────────────────┘
                 │ HTTP GET ?ical=...&tz=...&lang=...
                 ▼
┌─────────────────────────────────┐
│       Cloudflare Worker         │
│    (worker/worker.js ~14KB)     │
└────────┬──────────────────────┬─┘
         │                      │
         │ iCal 取得 & キャッシュ  │ フォントをエッジキャッシュ
         ▼                      ▼
┌──────────────────┐  ┌───────────────────────────────┐
│ Google Calendar  │  │   jsDelivr / GitHub CDN       │
│  (秘密の iCal)    │  │ (assets/cjk_font.bin ~229 KB) │
└──────────────────┘  └───────────────────────────────┘
```

1. **TC002** が言語、タイムゾーン、iCal URL を含めてリクエストを送信。
2. **Cloudflare Worker** が iCal を解析し、2.6 万字のバイナリフォントを参照してテキストを 8px ドットマトリクス列データへ変換。
3. **TC002** は受け取ったドットデータを画面に直接描画。ESP32 内部ストレージに巨大なフォントファイルを保存する必要がありません。

---

## 🚀 クイックスタートガイド

### ステップ 0：Google カレンダーの非公開 iCal URL の取得

時計がカレンダーの予定を安全に取得するため、Google カレンダーの「非公開の iCal URL」を取得します：

1. パソコンのブラウザで [Google カレンダー](https://calendar.google.com/) を開きます。
2. 左サイドバーの「マイカレンダー」から表示したいカレンダーの上にカーソルを合わせ、**「⋮」（オーバーフローメニュー）** $\rightarrow$ **「設定と共有」**（Settings and sharing）をクリックします。
3. 左側のメニューで **「カレンダーの統合」** をクリックします。
4. **「iCal 形式の非公開アドレス」**（Secret address in iCal format）を見つけ、右側のコピーボタンをクリックします。

> [!IMPORTANT]
> 必ず「**非公開アドレス**（Secret address）」（URL に `private-.../basic.ics` が含まれるもの）をコピーしてください。「公開アドレス」をコピーすると、非公開の予定が読み取れなくなります。

---

### ステップ 1：Cloudflare Worker のデプロイ

以下の 2 つの方法から選択できます：

#### プラン A：CDN エディション（推奨、コードサイズ約 14KB、Gzip 後約 4KB）
1. 本リポジトリを Fork または GitHub にプッシュします。
2. [Cloudflare Dashboard](https://dash.cloudflare.com/) $\rightarrow$ **Workers & Pages** $\rightarrow$ **Create Worker** を開きます。
3. Worker 名（例：`tc002-calendar`）を入力し、**Deploy** をクリックします。
4. 右上の **Edit code** をクリックし、内容を [`worker/worker.js`](worker/worker.js) のコードに置き換えて **Deploy** します。
   > *デフォルトでは `https://cdn.jsdelivr.net/gh/patw0929/awtrix-calendar-cjk@master/assets/cjk_font.bin` からフォントを自動取得しエッジキャッシュします。カスタムドメインや R2 をご利用の場合は環境変数 `FONT_URL` で指定可能です。*

#### プラン B：スタンドアロン単一ファイル版（CDN 不要）
フォントを外部 CDN に依存させたくない場合は、[`worker/worker.standalone.js`](worker/worker.standalone.js) の内容をそのまま Cloudflare Worker に貼り付けてデプロイしてください（全フォントデータが Base64 で内包されています）。

---

### ステップ 2：デバイス側スクリプト（Berry Script）のインストール

1. ブラウザで AWTRIX デバイスの管理画面を開きます（`http://<デバイスのIP>/`）。
2. 上部ナビゲーションの **Scripts** タブに移動します。
3. **SCRIPTS** 一覧の横にある **`+`** ボタンをクリックします。
4. スクリプト名に `calendar_cjk`（英数字、`-`、`_` のみ、スペース不可）と入力します。
5. 右側のエディタに [`app/calendar_cjk.be`](app/calendar_cjk.be) の全内容を貼り付けます。
6. 右下の **Save** をクリックして保存・コンパイルします。

> [!TIP]
> **旧バージョンファームウェアをご利用の方**：管理画面に **Scripts** タブがない場合は、**Files** $\rightarrow$ `/app` ディレクトリを開き、`calendar_cjk.be` というファイルを作成してコードを貼り付けてください。

---

### ステップ 3：パラメータの設定

AWTRIX 管理画面 $\rightarrow$ **Apps** $\rightarrow$ **Google Calendar CJK** を開きます：

| 設定項目 | 説明 | デフォルト値 |
| :--- | :--- | :--- |
| **iCal URL** | Google カレンダーの秘密のアドレス（iCal 形式の非公開 URL） | *(必須)* |
| **Worker URL** | デプロイした Cloudflare Worker の URL（`https://<name>.<subdomain>.workers.dev`） | *(必須)* |
| **Language** | 曜日および相対日付の言語：`ja`、`zh-TW`、`zh-CN`、`en`、`ko` | `zh-TW` *(日本語表示の場合は `ja` に変更)* |
| **Time zone** | 標準 IANA タイムゾーン（例：`Asia/Tokyo`、`Asia/Taipei`） | `Asia/Taipei` *(日本の場合は `Asia/Tokyo`)* |
| **Max future days** | 今後何日後までの予定を表示するか | `14` |
| **Auto cycle (sec)**| 予定の自動切り替え秒数。**`0` に設定すると自動巡回を停止し、ノブによる 100% 手動切り替えになります** | `8` |
| **Refresh interval**| カレンダー同期間隔（分） | `15` |
| **Scroll speed** | 長いタイトルのマーキースクロール速度（%） | `100` |
| **Time / day colour**| 日付、時刻、曜日の表示カラー（HEX） | `#8AB4F8` |
| **Hide when empty** | 直近の予定がない場合にアプリを自動で非表示にする | `true` |

---

## 🎮 操作方法

- **ノブを右に回す**：次の予定を表示。
- **ノブを左に回す**：前の予定を表示。
- **ノブを押し込む**：最も直近の最初の予定に戻る。
- **本体上部の Select ボタン**：即座に Worker 経由で最新の予定を再同期。

---

## 🛠️ フォントバイナリのソースビルド

`assets/cjk_font.bin` には TakWolf 氏のオープンソースフォント（Fusion Pixel Font）から抽出した 26,068 文字のドットマトリクスが含まれています：

```bash
node scripts/build_font.js /path/to/ja.bdf /path/to/ko.bdf
```

データ構造仕様：
- 1文字あたり固定 **9 バイト（Bytes）**：
  - `bytes 0-1`：Unicode コードポイント（16-bit Big-Endian）。
  - `bytes 2-8`：7 行分の各 8-bit ドットデータ。
- 配列は Unicode コードポイント順に昇順ソートされており、Worker 側の二分探索（Binary Search）により最大 $\le 15$ 回の比較（0.001 ミリ秒未満）で目的の文字を抽出できます。

---

## 📄 ライセンスとクレジット

- アプリケーションコードは **[MIT License](LICENSE)** に基づきオープンソース化されています © 2026 patw。
- オリジナルの着想およびロジック：**[Mvrcl1005](https://awtrix.de/scripts/all?query=Mvrcl1005)** 氏の [Google Calendar Agenda](https://awtrix.de/script/hmrKzlDZJrBm)。
- フォントグリフ：TakWolf 氏による **[Fusion Pixel Font](https://github.com/TakWolf/fusion-pixel-font)**（**SIL Open Font License 1.1** 準拠）。

