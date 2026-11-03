<div align="center">

![AWTRIX Google Calendar CJK Preview](assets/preview_ko.svg)

# AWTRIX Google Calendar CJK (한국어 문서)

[![AWTRIX NG](https://img.shields.io/badge/AWTRIX-NG-blue.svg)](https://github.com/Blueforcer/awtrix-light)
[![Platform](https://img.shields.io/badge/Hardware-ESP32%20%7C%20Ulanzi%20TC002-orange.svg)]()
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare)](https://workers.cloudflare.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Font License: OFL 1.1](https://img.shields.io/badge/Font%20License-SIL%20OFL%201.1-green.svg)](https://scripts.sil.org/OFL)

[English](README.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md)

<p><strong>Ulanzi TC002</strong> 및 <strong>AWTRIX NG</strong> / <strong>ESP32</strong> 픽셀 클락을 위한 오픈소스 Google 캘린더 일정 디스플레이 앱으로, 한국어·일본어·중국어·영어를 완벽하게 지원합니다.</p>

</div>

마이크로컨트롤러(ESP32)의 한정된 메모리로 인해 한글·한자·일본어가 물음표(`???`)나 빈 네모(□)로 깨지는 문제를 근본적으로 해결했습니다. 초경량 Cloudflare Worker 프록시를 통해 캘린더 일정을 8px 도트 매트릭스 데이터로 실시간 래스터라이징(비트맵 변환)하여, **현대 한글 11,172자 전체 음절, 일본어(가나/한자/장음 부호), 중국어(번체/간체)**를 글자 깨짐 없이 선명하게 표시합니다.

---

## ✨ 핵심 기능

> [!NOTE]
> **도트 폰트 표시 안내**: 8픽셀(8px)의 제한된 도트 매트릭스 해상도 특성상, 획수가 많거나 복잡한 한자 및 일부 한글 음절은 선명하게 구분하기 어려울 수 있습니다. 최대한 가독성을 높이도록 디스플레이를 최적화하였으나 한계가 있을 수 있는 점 너른 양해 부탁드립니다.

- **동아시아 CJK 언어 완벽 지원**:
  - **한국어**: **Unicode 현대 한글 전 음절 11,172자 100% 지원** (U+AC00 ~ U+D7A3), 희귀 음절도 깨짐 없이 표시.
  - **일본어**: 히라가나, 가타카나, 장음 부호(`ー`), 탁음/반탁음, 촉음 및 한자.
  - **중국어**: 번체 및 간체 (CJK 통합 한자 14,719자).
- **철저한 개인정보 보호**: Google 캘린더의 비공개 iCal 주소는 기기 로컬에만 저장되며 Worker 코드에 하드코딩되지 않아 안전합니다.
- **2줄 동적 레이아웃**:
  - 상단: 포맷된 날짜, 시간 및 현지화된 요일 (월, 화, 수... 또는 오늘, 내일).
  - 하단: 일정 제목 (긴 제목은 매끄러운 전광판 마키 스크롤 지원).
- **로터리 노브 조작 & 완전 수동 모드**:
  - 노브를 시계/반시계 방향으로 돌려 전후 일정을 직접 탐색.
  - 노브를 꾹 누르면 가장 가까운 첫 번째 일정으로 즉시 복귀.
  - 자동 전환 시간을 `0`초로 설정하면 자동 롤링이 꺼지고 100% 노브 수동 제어 모드로 작동.
- **네트워크 자동 복구 및 상태 인디케이터**:
  - 네트워크 지연이나 순단 발생 시 화면에 실시간 카운트다운 표시 (`Retry 5s` $\rightarrow$ `Loading...`).
  - 기기 상단의 Select 버튼을 누르면 언제든지 즉시 새로고침.
  - 로딩 중(`Loading...`), 재시도(`Retry`), 초기 설정 안내(`Set Worker` / `Set iCal`) 등의 상태 문구는 16px 디스플레이 중앙에 깔끔하게 정렬됩니다.
- **엣지 캐싱 및 초고속 응답**:
  - Worker 내부 2.5분 메모리 캐시를 통해 Google로부터 300KB iCal 파일을 불필요하게 반복 다운로드하는 것을 방지.
  - Cloudflare Edge를 통한 20~50ms 수준의 초고속 응답.

---

## 🏗️ 시스템 아키텍처

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
         │ iCal 가져오기 & 캐싱    │ 폰트 엣지 캐싱
         ▼                      ▼
┌──────────────────┐  ┌───────────────────────────────┐
│ Google Calendar  │  │   jsDelivr / GitHub CDN       │
│   (개인 iCal)     │  │ (assets/cjk_font.bin ~229 KB) │
└──────────────────┘  └───────────────────────────────┘
```

1. **TC002**가 언어, 시간대, iCal URL이 포함된 요청을 전송합니다.
2. **Cloudflare Worker**가 iCal을 파싱하고, 2.6만 자 바이너리 폰트를 참조하여 텍스트를 8px 도트 매트릭스 열 데이터로 변환합니다.
3. **TC002**는 수신된 도트 데이터를 화면에 즉시 렌더링합니다. ESP32 내부 플래시 메모리에 대용량 폰트를 저장할 필요가 전혀 없습니다.

---

## 🚀 빠른 설치 및 설정 가이드

### 0단계: Google 캘린더의 비공개 iCal URL 가져오기

시계가 내 캘린더 일정을 안전하게 가져오려면 Google 캘린더의 '비공개 iCal 주소'가 필요합니다:

1. PC 브라우저에서 [Google 캘린더 웹페이지](https://calendar.google.com/)에 접속합니다.
2. 좌측 '내 캘린더' 목록에서 표시할 캘린더 위에 마우스를 올린 뒤, **옵션 메뉴(⋮)** $\rightarrow$ **설정 및 공유**(Settings and sharing)를 클릭합니다.
3. 좌측 메뉴에서 **캘린더 통합**을 클릭합니다.
4. **iCal 형식의 비공개 주소**(Secret address in iCal format) 항목을 찾아 우측의 복사 버튼을 클릭합니다.

> [!IMPORTANT]
> 반드시 **'비공개 주소(Secret address)'**(URL에 `private-.../basic.ics`가 포함된 주소)를 복사해야 합니다. '공개 주소'를 복사하면 비공개 일정이 조회되지 않습니다.

---

### 1단계: Cloudflare Worker 배포

두 가지 배포 옵션 중 하나를 선택할 수 있습니다:

#### 옵션 A: CDN 에디션 (강력 추천, 코드 크기 약 14KB, Gzip 후 약 4KB)
1. 본 저장소를 Fork하거나 GitHub에 푸시합니다.
2. [Cloudflare Dashboard](https://dash.cloudflare.com/) $\rightarrow$ **Workers & Pages** $\rightarrow$ **Create Worker**로 이동합니다.
3. Worker 이름(예: `tc002-calendar`)을 입력하고 **Deploy**를 클릭합니다.
4. 우측 상단의 **Edit code**를 클릭하고, 내용을 [`worker/worker.js`](worker/worker.js)의 전체 코드로 교체한 뒤 **Deploy**를 누릅니다.
   > *기본적으로 `https://cdn.jsdelivr.net/gh/patw0929/awtrix-calendar-cjk@master/assets/cjk_font.bin`에서 폰트를 자동 로드하여 엣지 캐싱합니다. 사용자 정의 도메인이나 R2를 사용하는 경우 환경 변수 `FONT_URL`을 통해 지정할 수 있습니다.*

#### 옵션 B: 독립형 단일 파일 에디션 (CDN 불필요)
외부 CDN을 거치지 않고 단일 파일로 동작시키고 싶다면, [`worker/worker.standalone.js`](worker/worker.standalone.js)의 내용을 그대로 Cloudflare Worker에 복사하여 배포하세요 (전체 폰트 데이터가 Base64로 내장되어 있습니다).

---

### 2단계: 기기용 Berry 스크립트 설치

1. 브라우저에서 AWTRIX 기기 관리 페이지에 접속합니다 (`http://<기기IP>/`).
2. 상단 내비게이션 바에서 **Scripts** 탭으로 이동합니다.
3. **SCRIPTS** 목록 우측의 **`+`** 버튼을 클릭합니다.
4. 스크립트 이름에 `calendar_cjk`를 입력합니다 (영문, 숫자, `-`, `_`만 지원, 공백 불가).
5. 우측 코드 편집기에 [`app/calendar_cjk.be`](app/calendar_cjk.be)의 전체 내용을 붙여넣습니다.
6. 우측 하단의 **Save**를 클릭하여 저장하고 컴파일합니다.

> [!TIP]
> **이전 버전 펌웨어 사용자**: 관리 페이지에 **Scripts** 탭이 없는 경우, **Files** $\rightarrow$ `/app` 디렉토리로 이동하여 `calendar_cjk.be` 파일을 생성한 후 코드를 붙여넣으세요.

---

### 3단계: 설정 매개변수 구성

AWTRIX 관리 페이지 $\rightarrow$ **Apps** $\rightarrow$ **Google Calendar CJK**로 이동합니다:

| 설정 항목 | 설명 | 기본값 |
| :--- | :--- | :--- |
| **iCal URL** | Google 캘린더 비밀 주소 (iCal 형식 URL) | *(필수)* |
| **Worker URL** | 배포한 Cloudflare Worker 주소 (`https://<name>.<subdomain>.workers.dev`) | *(필수)* |
| **Language** | 요일 및 상대 날짜 언어: `ko`, `zh-TW`, `zh-CN`, `en`, `ja` | `zh-TW` *(한국어는 `ko`로 설정)* |
| **Time zone** | 표준 IANA 시간대 (예: `Asia/Seoul`, `Asia/Tokyo`) | `Asia/Taipei` *(한국은 `Asia/Seoul`)* |
| **Max future days** | 향후 며칠 동안의 일정을 표시할지 설정 | `14` |
| **Auto cycle (sec)**| 일정 자동 롤링 간격(초). **`0`으로 설정하면 자동 롤링이 꺼지고 100% 노브 수동 제어 모드가 됩니다** | `8` |
| **Refresh interval**| 캘린더 동기화 주기(분) | `15` |
| **Scroll speed** | 긴 제목 전광판 스크롤 속도 비율(%) | `100` |
| **Time / day colour**| 날짜, 시간, 요일 표시 색상 (HEX) | `#8AB4F8` |
| **Hide when empty** | 예정된 일정이 없을 때 앱을 회전 목록에서 숨김 | `true` |

---

## 🎮 조작 가이드

- **노브 오른쪽 회전**: 다음 일정 보기.
- **노브 왼쪽 회전**: 이전 일정 보기.
- **노브 클릭**: 가장 가까운 첫 번째 일정으로 즉시 복귀.
- **본체 상단 Select 버튼**: Worker를 통해 최신 캘린더 일정을 강제로 즉시 동기화.

---

## 🛠️ 소스에서 폰트 바이너리 빌드하기

`assets/cjk_font.bin` 파일은 TakWolf의 오픈소스 폰트(Fusion Pixel Font)에서 추출한 26,068자의 도트 매트릭스를 포함하고 있습니다:

```bash
node scripts/build_font.js /path/to/ja.bdf /path/to/ko.bdf
```

데이터 구조 규격:
- 각 글자당 고정 **9 바이트(Bytes)**:
  - `bytes 0-1`: Unicode 코드 포인트 (16-bit Big-Endian).
  - `bytes 2-8`: 7개 행의 각 8-bit 비트맵 데이터.
- 데이터는 유니코드 코드 포인트 오름차순으로 엄격하게 정렬되어 있어, Worker에서 이진 탐색(Binary Search) 수행 시 최대 $\le 15$회의 비교(0.001ms 미만)로 즉시 문자를 찾아냅니다.

---

## 📄 라이선스 및 크레딧

- 애플리케이션 코드는 **[MIT License](LICENSE)** 오픈소스 라이선스에 따라 배포됩니다 © 2026 patw.
- 원본 아이디어 및 기본 로직: **[Mvrcl1005](https://awtrix.de/scripts/all?query=Mvrcl1005)** 님의 [Google Calendar Agenda](https://awtrix.de/script/hmrKzlDZJrBm).
- 폰트 글리프: TakWolf 님의 **[Fusion Pixel Font](https://github.com/TakWolf/fusion-pixel-font)** (**SIL Open Font License 1.1** 라이선스 준수).

