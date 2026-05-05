# Plan: Chrome Extension gợi ý reply Messenger

## Context

Người dùng muốn xây ứng dụng tự động trả lời tin nhắn cho **tài khoản Facebook cá nhân**. Đã làm rõ:

- Facebook không có API chính thức cho tài khoản cá nhân. Auto-send qua thư viện không chính thức / browser automation **vi phạm ToS** và có nguy cơ khóa account vĩnh viễn.
- Người dùng chọn phương án **hợp lệ**: Chrome Extension chạy trên `messenger.com`, đọc tin nhắn đến và **gợi ý** câu trả lời. Người dùng tự bấm gửi (không auto-send) → không vi phạm ToS.
- Logic gợi ý: **rule-based match trước**, không match thì gọi **Claude API** sinh câu trả lời.

Project hiện tại tại `d:\laragon\www\chat-bot-2026` rỗng (chỉ có `CLAUDE.md` + `docs/` trống) → triển khai từ đầu.

## Stack & Quyết định kiến trúc cốt lõi

| Mục | Quyết định | Lý do |
|---|---|---|
| Build tool | **Không có** — vanilla JS/HTML/CSS thuần | Scope nhỏ (~900 LOC), tránh phức tạp build step |
| Framework UI | **Không có** — Shadow DOM + DOM API | Tránh xung đột với React của messenger.com |
| Manifest | **MV3** | Chuẩn hiện tại, MV2 đã deprecated |
| Storage | `chrome.storage.local` | API key + rules + selectors override |
| API call site | **Background service worker** | API key không lộ ra page context, CORS OK với host_permissions |
| Model AI | `claude-haiku-4-5` (default) | Latency ~1s, ~$0.0001/request |

## Cấu trúc thư mục

```
d:\laragon\www\chat-bot-2026\
├── manifest.json
├── README.md                          (hướng dẫn load unpacked)
├── icons/                             (16, 48, 128)
├── background/service_worker.js       (msg handler, rule matcher, Claude client)
├── content/
│   ├── content_script.js              (MutationObserver, detector, overlay controller)
│   └── overlay.css                    (styles cho Shadow DOM)
├── popup/
│   ├── popup.html
│   ├── popup.css
│   └── popup.js                       (settings + rules CRUD)
└── shared/                            (chỉ dùng cho popup + service worker, không content script)
    ├── storage.js                     (wrapper chrome.storage.local)
    └── claude_client.js               (fetch Claude API)
```

## manifest.json

```json
{
  "manifest_version": 3,
  "name": "Messenger Reply Suggester",
  "version": "0.1.0",
  "permissions": ["storage", "clipboardWrite"],
  "host_permissions": [
    "https://www.messenger.com/*",
    "https://www.facebook.com/messages/*",
    "https://api.anthropic.com/*"
  ],
  "background": { "service_worker": "background/service_worker.js" },
  "content_scripts": [{
    "matches": ["https://www.messenger.com/*", "https://www.facebook.com/messages/*"],
    "js": ["content/content_script.js"],
    "css": ["content/overlay.css"],
    "run_at": "document_idle"
  }],
  "action": { "default_popup": "popup/popup.html" }
}
```

## Detect tin nhắn mới (3 lớp selector)

1. **ARIA & semantic** (ổn định nhất): `[role="main"]` cho thread container, `[role="row"]` cho message bubble, parse `aria-label` để lấy sender + content.
2. **Alignment heuristic** (xác định self vs other): `getComputedStyle(parent).justifyContent === 'flex-end'` → tin nhắn của mình.
3. **Text fallback**: `<div dir="auto">` lồng nhau → `innerText`.

**MutationObserver setup:**
- Observe `threadContainer` với `{ childList: true, subtree: true }`.
- Debounce callback **300ms** (messenger render nhiều mutation cho 1 message).
- So sánh hash(`text + timestamp`) với `lastSeenMessageId` — chỉ trigger nếu mới + không phải self.
- **Re-attach observer khi đổi conversation** (SPA, không có navigation event): poll `location.pathname` mỗi 1s hoặc observe `document.title`.

**Selector override:** lưu trong `chrome.storage.local.selectors` (default hard-coded), advanced user có thể paste JSON trong popup khi DOM thay đổi.

## Rule schema

```json
{
  "id": "r1",
  "name": "Greeting",
  "match": {
    "type": "keyword",
    "patterns": ["hi", "chào"],
    "pattern": "(giá|price)",
    "flags": "i",
    "caseSensitive": false
  },
  "replies": ["Chào bạn!", "Hi", "Xin chào"],
  "enabled": true
}
```

- Duyệt rules theo thứ tự, **rule đầu tiên match** → return `replies` (3 items, pad nếu < 3).
- Không match → fallback Claude.

## UI overlay gợi ý

- **Vị trí**: floating chip row **ngay phía trên input box** (`position: absolute; bottom: 100%`), bọc trong **Shadow DOM** để CSS không bị messenger override.
- **3 suggestion chip ngang**, mỗi chip max 60 ký tự + tooltip full text.
- **Auto-show** khi detect tin nhắn mới + nút **X (dismiss)** + nút **↻ (refresh / re-generate)**.
- Click chip → fill input box (dispatch `input` events để React của messenger nhận thay đổi). Long-press / right-click → copy clipboard.
- **Badge nguồn**: "rule" (xanh) hoặc "AI" (tím) để user biết suggestion đến từ đâu.
- Loading state: 3 skeleton chip với shimmer khi gọi Claude.

## Claude API integration

**Endpoint**: `POST https://api.anthropic.com/v1/messages`

**Headers bắt buộc**:
- `x-api-key: <user_key>`
- `anthropic-version: 2023-06-01`
- `anthropic-dangerous-direct-browser-access: true` ← **bắt buộc** khi gọi từ browser context, thiếu sẽ 403
- `content-type: application/json`

**Request body**:
```javascript
{
  model: "claude-haiku-4-5",
  max_tokens: 300,
  system: [{
    type: "text",
    text: "Bạn là trợ lý gợi ý câu trả lời tin nhắn Messenger. Trả về EXACTLY 3 gợi ý ngắn gọn (mỗi gợi ý <= 100 ký tự), tự nhiên, đúng văn phong tiếng Việt thân thiện. Format: JSON array of 3 strings, không giải thích.",
    cache_control: { type: "ephemeral" }
  }],
  messages: [{
    role: "user",
    content: `Hội thoại gần đây:\n${last5Messages}\n\nTin nhắn mới nhất từ đối phương: "${incoming}"\n\nGợi ý 3 câu trả lời:`
  }]
}
```

**Context**: 5 tin nhắn gần nhất (cả self + other), mỗi tin truncate 200 ký tự.

**Parsing defensive**: `JSON.parse()` → fallback regex extract `"..."` → fallback split newline. Luôn return array length = 3 (pad/truncate).

## Luồng message passing

```
content_script ─[GET_SUGGESTIONS {messages, lastIncoming}]→ service_worker
                                                              │
                                                              ├─ check rules từ storage
                                                              ├─ match? → return rule replies
                                                              └─ không? → fetch Claude → return
content_script ←[SUGGESTIONS {items[3], source: 'rule'|'claude'}]
              → render overlay trong Shadow DOM
              → click chip → fill input box
```

Dùng `chrome.runtime.sendMessage` (one-shot, không cần long-lived port).

## Popup UI (settings)

- Section 1: **Claude API key** (input password) + nút Save + status "configured/missing".
- Section 2: **Rules table** — 4 cột Name | Type | Pattern | Enabled + Edit/Delete. Modal `<dialog>` native cho add/edit. Nút Export/Import JSON.
- Section 3: **Selectors override** — `<textarea>` JSON cho advanced user.
- Section 4: **Toggle enable/disable extension globally**.

## Critical files (sẽ tạo)

- [manifest.json](../manifest.json)
- [background/service_worker.js](../background/service_worker.js) — msg handler, rule matcher, Claude client wrapper
- [content/content_script.js](../content/content_script.js) — observer, detector, Shadow DOM overlay
- [content/overlay.css](../content/overlay.css)
- [popup/popup.html](../popup/popup.html) + [popup/popup.js](../popup/popup.js) + [popup/popup.css](../popup/popup.css)
- [shared/storage.js](../shared/storage.js)
- [shared/claude_client.js](../shared/claude_client.js)
- [README.md](../README.md)

## Verification plan

### Smoke test
1. `chrome://extensions/` → bật Developer mode → "Load unpacked" chọn `d:\laragon\www\chat-bot-2026\` → verify load không lỗi.
2. Click icon → popup mở → nhập API key → Save → verify persisted (`chrome.storage.local.get(null, console.log)`).

### Test content script
3. Mở `https://www.messenger.com/`, login → DevTools Console → check `[ReplySuggester] content script loaded`.
4. Mở conversation → check `[ReplySuggester] thread container found`.
5. Nhờ tài khoản khác gửi tin → check `[ReplySuggester] new incoming message: "..."` → overlay xuất hiện trên input box với 3 chip.

### Test rule matching
6. Popup → add rule `keyword: ["test"]` → replies 3 items.
7. Nhận tin "this is a test" → overlay show 3 reply từ rule (badge xanh "rule").
8. Click chip 1 → input box được fill đúng text.

### Test Claude fallback
9. Disable rule, nhận tin "Hello bạn ơi" → console log `no rule matched, calling Claude` → service worker DevTools Network thấy request `api.anthropic.com/v1/messages` → overlay show 3 suggestion (badge tím "AI").
10. Xóa API key → nhận tin → overlay show error "API key chưa cấu hình".

### Edge cases
- Switch conversation → observer re-attach, không leak listener.
- Multiple message dồn nhanh → debounce work, chỉ 1 lần trigger.
- Self-sent message → KHÔNG trigger.
- Tin nhắn ảnh/sticker không có text → gracefully skip.
- DOM selector thay đổi → override JSON trong popup → verify hoạt động.

## Lưu ý quan trọng

- **KHÔNG bao giờ auto-send**. Click chip chỉ fill input box, người dùng tự bấm Enter.
- **KHÔNG đọc/lưu nội dung tin nhắn ra ngoài máy người dùng** ngoại trừ gửi đến Claude API (cần thông báo trong README).
- DOM của messenger.com **sẽ thay đổi** trong tương lai → có sẵn cơ chế override selector qua storage để giảm rủi ro extension chết.
- Header `anthropic-dangerous-direct-browser-access: true` bắt buộc khi gọi Claude từ extension.
