(() => {
  const log = (...args) => console.log('[ReplySuggester]', ...args);

  const DEFAULT_SELECTORS = {
    threadContainer: '[role="main"]',
    messageRow: '[role="row"]',
    messageText: 'div[dir="auto"]',
    inputBox: '[role="textbox"][contenteditable="true"]'
  };

  const state = {
    selectors: { ...DEFAULT_SELECTORS },
    enabled: true,
    observer: null,
    threadContainer: null,
    lastSeenHash: null,
    initializedForThread: false,
    currentPath: location.pathname,
    overlayHost: null,
    overlayShadow: null,
    overlayCssText: null,
    positionRafId: null
  };

  log('content script loaded');

  init();

  async function init() {
    try {
      const stored = await chrome.storage.local.get(['selectors', 'enabled']);
      if (stored.selectors && typeof stored.selectors === 'object') {
        state.selectors = { ...DEFAULT_SELECTORS, ...stored.selectors };
      }
      state.enabled = stored.enabled !== false;
    } catch (e) {
      log('storage read failed', e.message);
    }

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.enabled) state.enabled = changes.enabled.newValue !== false;
      if (changes.selectors) {
        state.selectors = { ...DEFAULT_SELECTORS, ...(changes.selectors.newValue || {}) };
        rebindObserver();
      }
    });

    setupObserver();
    watchNavigation();
    setupMessageHandler();
  }

  function setupObserver() {
    const tc = document.querySelector(state.selectors.threadContainer);
    if (!tc) {
      setTimeout(setupObserver, 1000);
      return;
    }
    if (tc === state.threadContainer && state.observer) return;

    state.threadContainer = tc;
    log('thread container found');

    state.observer?.disconnect();
    state.observer = new MutationObserver(debounce(handleMutations, 300));
    state.observer.observe(tc, { childList: true, subtree: true });

    handleMutations();
  }

  function rebindObserver() {
    state.observer?.disconnect();
    state.observer = null;
    state.threadContainer = null;
    state.initializedForThread = false;
    setupObserver();
  }

  function watchNavigation() {
    setInterval(() => {
      if (location.pathname !== state.currentPath) {
        state.currentPath = location.pathname;
        log('navigation:', location.pathname);
        state.lastSeenHash = null;
        state.initializedForThread = false;
        hideOverlay();
        setTimeout(rebindObserver, 600);
      }
    }, 1000);
  }

  function handleMutations() {
    if (!state.enabled || !state.threadContainer) return;

    const rows = state.threadContainer.querySelectorAll(state.selectors.messageRow);
    if (!rows.length) return;

    const lastRow = rows[rows.length - 1];
    const text = extractText(lastRow);
    if (!text) return;
    if (isFromSelf(lastRow)) return;

    const hash = hashString(text);
    if (hash === state.lastSeenHash) return;
    state.lastSeenHash = hash;

    if (!state.initializedForThread) {
      state.initializedForThread = true;
      log('initial scan, recorded last incoming without triggering:', text.slice(0, 60));
      return;
    }

    log('new incoming message:', text.slice(0, 80));
    triggerSuggestions(text);
  }

  function extractText(row) {
    const nodes = row.querySelectorAll(state.selectors.messageText);
    if (!nodes.length) return '';
    const txt = Array.from(nodes).map(n => n.innerText || '').join(' ').trim();
    return txt;
  }

  function isFromSelf(row) {
    let el = row;
    let depth = 0;
    while (el && depth < 8) {
      const style = getComputedStyle(el);
      if (style.justifyContent === 'flex-end') return true;
      if (style.justifyContent === 'flex-start') return false;
      el = el.parentElement;
      depth++;
    }
    const rect = row.getBoundingClientRect();
    const parentRect = row.parentElement?.getBoundingClientRect();
    if (rect && parentRect) {
      const rightGap = parentRect.right - rect.right;
      const leftGap = rect.left - parentRect.left;
      if (rightGap < leftGap - 40) return true;
    }
    return false;
  }

  async function triggerSuggestions(incoming) {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_SUGGESTIONS',
        lastIncoming: incoming
      });

      if (!response) {
        showOverlay({ error: 'Không nhận được phản hồi từ background' });
        return;
      }
      if (response.source === 'error') {
        showOverlay({ error: response.error || 'Lỗi không xác định' });
        return;
      }
      if (response.source === 'no-match' || response.source === 'disabled') {
        hideOverlay();
        return;
      }
      showOverlay({ items: response.items, source: response.source });
    } catch (e) {
      showOverlay({ error: e.message });
    }
  }

  // ============ Overlay ============

  async function ensureOverlay() {
    if (state.overlayShadow) return state.overlayShadow;

    const host = document.createElement('div');
    host.id = 'reply-suggester-host';
    host.style.cssText = 'position: fixed; z-index: 2147483647; pointer-events: none; left: 0; top: 0;';
    document.documentElement.appendChild(host);

    const shadow = host.attachShadow({ mode: 'open' });

    if (!state.overlayCssText) {
      try {
        const url = chrome.runtime.getURL('content/overlay.css');
        state.overlayCssText = await (await fetch(url)).text();
      } catch (e) {
        log('failed to load overlay.css', e.message);
        state.overlayCssText = '';
      }
    }

    const style = document.createElement('style');
    style.textContent = state.overlayCssText;
    shadow.appendChild(style);

    state.overlayHost = host;
    state.overlayShadow = shadow;
    return shadow;
  }

  async function showOverlay({ items, error }) {
    const shadow = await ensureOverlay();
    if (!shadow) return;

    const isDark = matchMedia('(prefers-color-scheme: dark)').matches;
    const root = document.createElement('div');
    root.className = 'suggester' + (isDark ? ' dark' : '');

    const header = document.createElement('div');
    header.className = 'header';

    const badge = document.createElement('span');
    badge.className = 'badge ' + (error ? 'error' : 'rule');
    badge.textContent = error ? 'Lỗi' : 'Rule';
    header.appendChild(badge);

    const label = document.createElement('span');
    label.textContent = 'Gợi ý trả lời';
    header.appendChild(label);

    const spacer = document.createElement('span');
    spacer.className = 'spacer';
    header.appendChild(spacer);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'icon-btn';
    closeBtn.title = 'Đóng';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', hideOverlay);
    header.appendChild(closeBtn);

    root.appendChild(header);

    if (error) {
      const err = document.createElement('div');
      err.className = 'error';
      err.textContent = error;
      root.appendChild(err);
    } else {
      const chipsEl = document.createElement('div');
      chipsEl.className = 'chips';

      (items || []).forEach((text) => {
        const chip = document.createElement('button');
        chip.className = 'chip';
        chip.textContent = text || ' ';
        chip.title = text || '';
        chip.addEventListener('click', () => fillInputBox(text));
        chip.addEventListener('contextmenu', (ev) => {
          ev.preventDefault();
          navigator.clipboard.writeText(text).catch(() => {});
          flashChip(chip, 'Đã copy');
        });
        chipsEl.appendChild(chip);
      });
      root.appendChild(chipsEl);
    }

    while (shadow.children.length > 1) shadow.removeChild(shadow.lastChild);
    shadow.appendChild(root);

    state.overlayHost.style.display = 'block';
    schedulePosition();
  }

  function flashChip(chip, msg) {
    const original = chip.textContent;
    chip.textContent = msg;
    setTimeout(() => { chip.textContent = original; }, 800);
  }

  function hideOverlay() {
    if (state.overlayHost) state.overlayHost.style.display = 'none';
    cancelPosition();
  }

  function schedulePosition() {
    cancelPosition();
    const tick = () => {
      positionOverlay();
      state.positionRafId = requestAnimationFrame(tick);
    };
    state.positionRafId = requestAnimationFrame(tick);
  }

  function cancelPosition() {
    if (state.positionRafId) {
      cancelAnimationFrame(state.positionRafId);
      state.positionRafId = null;
    }
  }

  function positionOverlay() {
    if (!state.overlayHost) return;
    const inputBox = document.querySelector(state.selectors.inputBox);
    if (!inputBox) {
      state.overlayHost.style.display = 'none';
      return;
    }
    const rect = inputBox.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      state.overlayHost.style.display = 'none';
      return;
    }
    const top = rect.top - 8;
    state.overlayHost.style.left = rect.left + 'px';
    state.overlayHost.style.top = (top - 60) + 'px';
    state.overlayHost.style.width = rect.width + 'px';
    state.overlayHost.style.transform = 'translateY(-100%)';
    state.overlayHost.style.transformOrigin = 'bottom left';
    state.overlayHost.style.display = 'block';
  }

  function fillInputBox(text) {
    const inputBox = document.querySelector(state.selectors.inputBox);
    if (!inputBox) {
      navigator.clipboard.writeText(text).catch(() => {});
      log('input box not found, copied to clipboard instead');
      return;
    }
    inputBox.focus();
    try {
      const ok = document.execCommand('insertText', false, text);
      if (!ok) throw new Error('execCommand returned false');
    } catch (e) {
      log('execCommand failed, fallback dispatch', e.message);
      const dataTransfer = new DataTransfer();
      dataTransfer.setData('text/plain', text);
      inputBox.dispatchEvent(new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: dataTransfer
      }));
    }
    hideOverlay();
  }

  // ============ Export all messages ============

  function setupMessageHandler() {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg?.type === 'EXPORT_ALL') {
        exportAllMessages(msg.options || {})
          .then(messages => sendResponse({ ok: true, messages }))
          .catch(e => sendResponse({ ok: false, error: e.message }));
        return true;
      }
    });
  }

  function findScrollContainer() {
    const tc = state.threadContainer || document.querySelector(state.selectors.threadContainer);
    if (!tc) return null;
    let el = tc.querySelector(state.selectors.messageRow)?.parentElement || tc;
    while (el && el !== document.body) {
      const style = getComputedStyle(el);
      if ((style.overflowY === 'auto' || style.overflowY === 'scroll') &&
          el.scrollHeight > el.clientHeight + 10) {
        return el;
      }
      el = el.parentElement;
    }
    return tc;
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function detectMessageSelector(scrollEl) {
    const candidates = [
      state.selectors.messageRow,
      '[role="row"]',
      '[role="gridcell"]',
      '[data-scope="messages_table"]',
      'div[role="article"]'
    ];
    let best = { selector: null, count: 0 };
    for (const sel of candidates) {
      try {
        const c = scrollEl.querySelectorAll(sel).length;
        log(`probe selector "${sel}" → ${c} elements`);
        if (c > best.count) best = { selector: sel, count: c };
      } catch (_) {}
    }
    return best;
  }

  function collectFallbackMessages(scrollEl) {
    const seen = new Set();
    const result = [];
    const textNodes = scrollEl.querySelectorAll('div[dir="auto"]');
    log(`fallback: ${textNodes.length} div[dir=auto] nodes`);

    textNodes.forEach((node) => {
      const text = (node.innerText || '').trim();
      if (!text || text.length < 1) return;
      if (seen.has(text)) return;
      let p = node;
      let depth = 0;
      while (p && depth < 10) {
        if (p.matches?.('input, textarea, [contenteditable="true"]')) return;
        p = p.parentElement;
        depth++;
      }
      seen.add(text);
      result.push({
        index: result.length,
        sender: isFromSelf(node) ? 'self' : 'other',
        text,
        ariaLabel: node.closest('[aria-label]')?.getAttribute('aria-label') || ''
      });
    });
    return result;
  }

  async function exportAllMessages(options) {
    const tc = state.threadContainer || document.querySelector(state.selectors.threadContainer);
    if (!tc) throw new Error('Chưa tìm thấy thread container. Mở 1 cuộc hội thoại trước.');
    state.threadContainer = tc;
    log('export: thread container =', tc.tagName, 'aria-label=', tc.getAttribute('aria-label'));

    const scrollEl = findScrollContainer();
    if (!scrollEl) throw new Error('Không tìm được scroll container.');
    log('export: scroll container =', scrollEl.tagName, 'scrollHeight/clientHeight =', scrollEl.scrollHeight, '/', scrollEl.clientHeight);

    const probe = detectMessageSelector(scrollEl);
    log('export: best selector =', probe.selector, 'count =', probe.count);

    const wasEnabled = state.enabled;
    state.enabled = false;
    hideOverlay();

    const originalScrollTop = scrollEl.scrollTop;
    const useFallback = probe.count === 0;
    const rowSelector = probe.selector || 'div[dir="auto"]';

    try {
      const maxIters = options.maxIters ?? 500;
      const stallLimit = options.stallLimit ?? 4;
      const waitMs = options.waitMs ?? 1500;

      let lastCount = -1;
      let stalled = 0;
      let iter = 0;

      while (iter < maxIters && stalled < stallLimit) {
        iter++;

        const firstRow = scrollEl.querySelector(rowSelector);
        if (firstRow) firstRow.scrollIntoView({ block: 'start' });
        scrollEl.scrollTop = 0;

        await sleep(waitMs);

        const count = scrollEl.querySelectorAll(rowSelector).length;
        chrome.runtime.sendMessage({
          type: 'EXPORT_PROGRESS',
          count,
          stalled,
          iter
        }).catch(() => {});

        if (count === lastCount) {
          stalled++;
        } else {
          stalled = 0;
          lastCount = count;
        }
        log(`export iter ${iter}: ${count} rows, stalled ${stalled}/${stallLimit}`);
      }

      let messages;
      if (useFallback) {
        log('using fallback collector');
        messages = collectFallbackMessages(scrollEl);
      } else {
        const rows = Array.from(scrollEl.querySelectorAll(rowSelector));
        messages = rows.map((row, idx) => {
          const text = extractText(row);
          if (!text) return null;
          return {
            index: idx,
            sender: isFromSelf(row) ? 'self' : 'other',
            text,
            ariaLabel: row.getAttribute('aria-label') || ''
          };
        }).filter(Boolean);

        if (messages.length === 0) {
          log('primary selector returned 0 messages with text, trying fallback');
          messages = collectFallbackMessages(scrollEl);
        }
      }

      log(`export done: ${messages.length} messages (selector: ${useFallback ? 'fallback div[dir=auto]' : rowSelector})`);

      if (messages.length === 0) {
        throw new Error('Không trích xuất được tin nhắn nào. Mở DevTools → Console xem log [ReplySuggester] để debug. Có thể cần override selectors trong tab Advanced.');
      }
      return messages;
    } finally {
      scrollEl.scrollTop = originalScrollTop;
      state.enabled = wasEnabled;
    }
  }

  // ============ Helpers ============

  function debounce(fn, ms) {
    let t = null;
    return (...args) => {
      if (t) clearTimeout(t);
      t = setTimeout(() => { t = null; fn(...args); }, ms);
    };
  }

  function hashString(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) - h) + s.charCodeAt(i);
      h |= 0;
    }
    return h;
  }
})();
