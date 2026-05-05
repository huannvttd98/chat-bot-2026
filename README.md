# Messenger Reply Suggester

Chrome Extension gợi ý câu trả lời tin nhắn Messenger theo **rule (keyword/regex)**. **KHÔNG auto-send** — chỉ điền gợi ý vào ô input, người dùng tự bấm gửi.

## Tính năng

- Đọc tin nhắn đến mới nhất trong cuộc hội thoại đang mở trên `messenger.com`.
- Khi nội dung tin khớp rule (keyword hoặc regex) → hiện 3 chip gợi ý phía trên ô input. Không khớp rule → không hiện gì.
- Click chip gợi ý → fill vào input box. Right-click → copy clipboard.
- Quản lý rules (CRUD), bật/tắt extension, override DOM selectors khi messenger đổi giao diện, export/import rules.
- **Export toàn bộ tin nhắn** của cuộc hội thoại đang mở (auto-scroll lên đầu) → tải về file JSON hoặc TXT.

## Cài đặt (load unpacked)

1. Mở Chrome, vào `chrome://extensions/`.
2. Bật **Developer mode** (toggle góc trên phải).
3. Click **Load unpacked** → chọn thư mục `d:\laragon\www\chat-bot-2026\` (thư mục chứa `manifest.json`).
4. Extension xuất hiện trong danh sách. Click icon trên thanh công cụ để mở popup.

## Cấu hình

### Tạo rule

Tab **Rules** → **+ Thêm**:

- **Keyword**: nhập 1 keyword/dòng. Match nếu tin nhắn chứa BẤT KỲ keyword nào (substring, case-insensitive mặc định).
- **Regex**: nhập regex pattern + flags (`i` = case-insensitive). Match nếu regex test pass.
- **Replies**: nhập 1 câu/dòng. Tối thiểu 1, hệ thống sẽ pad đủ 3 chip cho overlay.

Rules duyệt theo thứ tự — rule **đầu tiên match** sẽ được dùng. Không có rule nào match → overlay không hiện.

### Export tin nhắn

Tab **Export** → click **Lấy toàn bộ tin nhắn**.

Extension sẽ:

1. Auto-scroll lên đầu cuộc hội thoại đang mở để load toàn bộ lịch sử.
2. Mỗi vòng scroll chờ 1.5s cho messenger fetch tin cũ. Dừng khi 4 vòng liên tiếp không có thêm tin mới (đã hết) hoặc đạt giới hạn 500 vòng.
3. Trả về danh sách tin nhắn → bạn chọn **Download JSON** (đầy đủ metadata) hoặc **Download TXT** (đọc dễ).

**Lưu ý:**

- Hội thoại dài có thể mất vài phút. Đừng đóng popup trong khi chạy.
- Auto-scroll sẽ jump view của bạn. Sau khi xong sẽ khôi phục vị trí scroll cũ.
- Format JSON: `[{index, sender: "self"|"other", text, ariaLabel}]`.
- Format TXT: `Tôi: ...` / `Đối phương: ...` mỗi tin một dòng.
- Có thể bị Facebook rate-limit nếu chạy quá nhiều lần liên tiếp.

### Override selectors (advanced)

Khi messenger.com đổi DOM, extension có thể không tìm được container. Tab **Advanced** → paste JSON selector mới. Để trống = dùng default.

## Sử dụng

1. Mở https://www.messenger.com/, login.
2. Mở 1 cuộc hội thoại, chờ tin nhắn đến.
3. Khi có tin mới (không phải của mình) khớp rule → overlay 3 chip xuất hiện phía trên ô input.
4. **Click chip** → fill vào input box. **Bấm Enter để gửi** (manual).
5. Nút **✕** = đóng overlay.

## Tránh vi phạm Facebook ToS

- Extension **chỉ ĐỌC DOM và GỢI Ý** — không tự gửi tin nhắn.
- Người dùng phải tự bấm Enter để gửi từng tin → hành vi giống người dùng thông thường.
- Không spam, không bot reply hàng loạt.

## Quyền riêng tư

- Tất cả config (rules, selectors) lưu **local** trong `chrome.storage.local`. Không gửi đi đâu khác.
- Không gọi API bên ngoài, không tích hợp analytics/tracking.

## Cấu trúc dự án

```
manifest.json
background/service_worker.js   — msg handler, rule matcher
content/
  ├── content_script.js        — MutationObserver, detector, Shadow DOM overlay
  └── overlay.css              — styles cho overlay
popup/
  ├── popup.html               — UI settings
  ├── popup.css
  └── popup.js                 — CRUD rules, toggle, selectors
shared/
  └── storage.js               — wrapper chrome.storage.local
docs/
  └── plan-messenger-reply-suggester.md
```

## Debug

- **Service worker logs**: vào `chrome://extensions/` → click "service worker" link dưới extension.
- **Content script logs**: F12 trên tab messenger.com → Console → filter `[ReplySuggester]`.
- **Popup logs**: right-click popup → Inspect.

## Khi messenger.com đổi DOM

Nếu overlay không hiện hoặc không detect được tin nhắn:

1. Mở DevTools tại messenger.com.
2. Inspect 1 tin nhắn → tìm selector bao quanh thread (`[role="main"]`, `[role="row"]`, ô input `[contenteditable="true"]`).
3. Vào popup tab **Advanced** → cập nhật selectors JSON → Save.
4. Reload tab messenger.com.

## Limitations

- Không hỗ trợ tin nhắn ảnh/sticker/voice (chỉ text).
- Heuristic phát hiện tin của mình vs đối phương dựa vào CSS `justify-content` — có thể sai trong một số layout.
- DOM messenger.com obfuscated → có thể cần update selectors định kỳ.
- Chỉ hoạt động trên `www.messenger.com` và `www.facebook.com/messages/*`.

## License

MIT — sử dụng cho mục đích cá nhân.
