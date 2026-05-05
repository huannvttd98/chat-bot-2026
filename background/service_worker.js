importScripts('../shared/storage.js');

const log = (...args) => console.log('[ReplySuggester:bg]', ...args);

function matchRule(rule, text) {
  if (!rule.enabled) return false;
  const m = rule.match || {};

  if (m.type === 'keyword') {
    const patterns = Array.isArray(m.patterns) ? m.patterns : [];
    if (!patterns.length) return false;
    const haystack = m.caseSensitive ? text : text.toLowerCase();
    return patterns.some(p => {
      const needle = m.caseSensitive ? p : String(p).toLowerCase();
      return needle && haystack.includes(needle);
    });
  }

  if (m.type === 'regex') {
    if (!m.pattern) return false;
    try {
      return new RegExp(m.pattern, m.flags || '').test(text);
    } catch (e) {
      log('regex error', m.pattern, e.message);
      return false;
    }
  }

  return false;
}

function findMatchingRule(rules, text) {
  if (!Array.isArray(rules)) return null;
  for (const rule of rules) {
    if (matchRule(rule, text)) return rule;
  }
  return null;
}

function padReplies(replies) {
  const arr = (Array.isArray(replies) ? replies : []).slice(0, 3);
  while (arr.length < 3) arr.push(arr[arr.length - 1] || '...');
  return arr;
}

async function getSuggestions({ lastIncoming }) {
  const config = await self.Storage.getAll();

  if (!config.enabled) {
    return { items: [], source: 'disabled' };
  }

  const rule = findMatchingRule(config.rules, lastIncoming || '');
  if (rule) {
    log('rule matched:', rule.name);
    return {
      items: padReplies(rule.replies),
      source: 'rule',
      ruleName: rule.name
    };
  }

  log('no rule matched');
  return { items: [], source: 'no-match' };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'GET_SUGGESTIONS') {
    getSuggestions(msg).then(sendResponse).catch(e => {
      sendResponse({ items: [], source: 'error', error: e.message });
    });
    return true;
  }

  if (msg?.type === 'PING') {
    sendResponse({ ok: true });
    return false;
  }
});

chrome.runtime.onInstalled.addListener(() => {
  log('extension installed');
});
