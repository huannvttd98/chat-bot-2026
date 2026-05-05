const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const DEFAULT_SELECTORS = {
  threadContainer: '[role="main"]',
  messageRow: '[role="row"]',
  messageText: 'div[dir="auto"]',
  inputBox: '[role="textbox"][contenteditable="true"]'
};

let rules = [];

document.addEventListener('DOMContentLoaded', init);

async function init() {
  setupTabs();
  setupRulesSection();
  setupAdvancedSection();
  setupExportSection();
  setupEnabledToggle();
  await loadAll();
}

async function loadAll() {
  const data = await chrome.storage.local.get(['rules', 'selectors', 'enabled']);

  $('#enabled-toggle').checked = data.enabled !== false;

  rules = Array.isArray(data.rules) ? data.rules : [];
  renderRules();

  if (data.selectors) {
    $('#selectors-json').value = JSON.stringify(data.selectors, null, 2);
  } else {
    $('#selectors-json').value = '';
  }
}

// ============ Tabs ============

function setupTabs() {
  $$('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const name = tab.dataset.tab;
      $$('.tab').forEach(t => t.classList.toggle('active', t === tab));
      $$('.panel').forEach(p => p.classList.toggle('active', p.dataset.panel === name));
    });
  });
}

// ============ Enabled toggle ============

function setupEnabledToggle() {
  $('#enabled-toggle').addEventListener('change', async (e) => {
    await chrome.storage.local.set({ enabled: e.target.checked });
  });
}

// ============ Rules ============

function setupRulesSection() {
  $('#add-rule').addEventListener('click', () => openRuleDialog());
  $('#export-rules').addEventListener('click', exportRules);
  $('#import-rules').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', importRules);

  const ruleType = $('#rule-type');
  ruleType.addEventListener('change', () => updateRuleTypeFields(ruleType.value));

  $('#rule-cancel').addEventListener('click', () => $('#rule-dialog').close());
  $('#rule-form').addEventListener('submit', saveRule);
}

function renderRules() {
  const tbody = $('#rules-body');
  tbody.innerHTML = '';

  if (!rules.length) {
    $('#rules-empty').style.display = 'block';
    return;
  }
  $('#rules-empty').style.display = 'none';

  rules.forEach((rule, idx) => {
    const tr = document.createElement('tr');

    const tdName = document.createElement('td');
    tdName.textContent = rule.name || '(no name)';

    const tdType = document.createElement('td');
    tdType.textContent = rule.match?.type || '?';

    const tdPattern = document.createElement('td');
    const m = rule.match || {};
    if (m.type === 'keyword') {
      tdPattern.textContent = (m.patterns || []).join(', ');
    } else {
      tdPattern.textContent = m.pattern || '';
    }
    tdPattern.style.maxWidth = '160px';
    tdPattern.style.overflow = 'hidden';
    tdPattern.style.textOverflow = 'ellipsis';
    tdPattern.style.whiteSpace = 'nowrap';
    tdPattern.title = tdPattern.textContent;

    const tdEnabled = document.createElement('td');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = rule.enabled !== false;
    cb.addEventListener('change', async () => {
      rules[idx].enabled = cb.checked;
      await persistRules();
    });
    tdEnabled.appendChild(cb);

    const tdActions = document.createElement('td');
    tdActions.className = 'actions';
    const editBtn = document.createElement('button');
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => openRuleDialog(idx));
    const delBtn = document.createElement('button');
    delBtn.textContent = 'Del';
    delBtn.addEventListener('click', async () => {
      if (!confirm('Xóa rule "' + rule.name + '"?')) return;
      rules.splice(idx, 1);
      await persistRules();
      renderRules();
    });
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'actions';
    actionsDiv.appendChild(editBtn);
    actionsDiv.appendChild(delBtn);
    tdActions.appendChild(actionsDiv);

    tr.append(tdName, tdType, tdPattern, tdEnabled, tdActions);
    tbody.appendChild(tr);
  });
}

function openRuleDialog(idx) {
  const dlg = $('#rule-dialog');
  const isEdit = typeof idx === 'number';
  const rule = isEdit ? rules[idx] : null;

  $('#rule-dialog-title').textContent = isEdit ? 'Sửa rule' : 'Thêm rule';
  $('#rule-id').value = isEdit ? String(idx) : '';
  $('#rule-name').value = rule?.name || '';
  $('#rule-type').value = rule?.match?.type || 'keyword';
  $('#rule-patterns').value = (rule?.match?.patterns || []).join('\n');
  $('#rule-pattern').value = rule?.match?.pattern || '';
  $('#rule-flags').value = rule?.match?.flags || 'i';
  $('#rule-case').checked = !!rule?.match?.caseSensitive;
  $('#rule-replies').value = (rule?.replies || []).join('\n');
  $('#rule-enabled').checked = rule ? rule.enabled !== false : true;

  updateRuleTypeFields($('#rule-type').value);
  dlg.showModal();
}

function updateRuleTypeFields(type) {
  $('#patterns-label').style.display = type === 'keyword' ? 'block' : 'none';
  $('#pattern-label').style.display = type === 'regex' ? 'block' : 'none';
  $('#flags-label').style.display = type === 'regex' ? 'block' : 'none';
}

async function saveRule(ev) {
  ev.preventDefault();

  const idStr = $('#rule-id').value;
  const idx = idStr === '' ? -1 : parseInt(idStr, 10);
  const type = $('#rule-type').value;
  const replies = $('#rule-replies').value.split('\n').map(s => s.trim()).filter(Boolean);
  if (!replies.length) {
    alert('Cần ít nhất 1 reply');
    return;
  }

  const match = { type };
  if (type === 'keyword') {
    match.patterns = $('#rule-patterns').value.split('\n').map(s => s.trim()).filter(Boolean);
    match.caseSensitive = $('#rule-case').checked;
    if (!match.patterns.length) {
      alert('Cần ít nhất 1 keyword');
      return;
    }
  } else {
    match.pattern = $('#rule-pattern').value.trim();
    match.flags = $('#rule-flags').value.trim();
    if (!match.pattern) {
      alert('Cần regex pattern');
      return;
    }
    try { new RegExp(match.pattern, match.flags); }
    catch (e) { alert('Regex không hợp lệ: ' + e.message); return; }
  }

  const rule = {
    id: idx >= 0 ? rules[idx].id : 'r' + Date.now(),
    name: $('#rule-name').value.trim() || 'Untitled',
    match,
    replies,
    enabled: $('#rule-enabled').checked
  };

  if (idx >= 0) rules[idx] = rule;
  else rules.push(rule);

  await persistRules();
  renderRules();
  $('#rule-dialog').close();
}

async function persistRules() {
  await chrome.storage.local.set({ rules });
}

function exportRules() {
  const blob = new Blob([JSON.stringify(rules, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'reply-suggester-rules.json';
  a.click();
  URL.revokeObjectURL(url);
}

async function importRules(ev) {
  const file = ev.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) throw new Error('File phải là JSON array');
    rules = parsed;
    await persistRules();
    renderRules();
    alert('Imported ' + rules.length + ' rules');
  } catch (e) {
    alert('Import lỗi: ' + e.message);
  }
  ev.target.value = '';
}

// ============ Advanced ============

function setupAdvancedSection() {
  $('#save-selectors').addEventListener('click', async () => {
    const text = $('#selectors-json').value.trim();
    const status = $('#selectors-status');

    if (!text) {
      await chrome.storage.local.remove('selectors');
      status.textContent = 'Reset về default';
      status.className = 'status ok';
      return;
    }
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed !== 'object') throw new Error('Phải là JSON object');
      await chrome.storage.local.set({ selectors: parsed });
      status.textContent = 'Đã lưu';
      status.className = 'status ok';
    } catch (e) {
      status.textContent = 'JSON lỗi: ' + e.message;
      status.className = 'status err';
    }
  });

  $('#reset-selectors').addEventListener('click', async () => {
    $('#selectors-json').value = JSON.stringify(DEFAULT_SELECTORS, null, 2);
  });
}

// ============ Export ============

let lastExportData = null;

function setupExportSection() {
  $('#export-start').addEventListener('click', startExport);
  $('#download-json').addEventListener('click', () => downloadExport('json'));
  $('#download-txt').addEventListener('click', () => downloadExport('txt'));

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'EXPORT_PROGRESS') {
      showExportStatus(`Đang scroll: ${msg.count} tin (chờ thêm ${msg.stalled}/4)`);
    }
  });
}

function showExportStatus(msg, isError) {
  const el = $('#export-status');
  el.textContent = msg;
  el.className = 'status ' + (isError ? 'err' : 'ok');
}

async function startExport() {
  $('#export-result').style.display = 'none';
  $('#export-start').disabled = true;
  showExportStatus('Đang khởi động...');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url || !/messenger\.com|facebook\.com\/messages/.test(tab.url)) {
      showExportStatus('Tab hiện tại không phải messenger.com', true);
      return;
    }

    const response = await chrome.tabs.sendMessage(tab.id, { type: 'EXPORT_ALL' });
    if (!response) {
      showExportStatus('Không nhận được phản hồi từ content script', true);
      return;
    }
    if (!response.ok) {
      showExportStatus(response.error || 'Lỗi không xác định', true);
      return;
    }

    lastExportData = response.messages || [];
    $('#export-count').textContent = lastExportData.length;
    $('#export-result').style.display = 'block';
    showExportStatus(`Hoàn tất: ${lastExportData.length} tin`);
  } catch (e) {
    showExportStatus('Lỗi: ' + e.message, true);
  } finally {
    $('#export-start').disabled = false;
  }
}

function downloadExport(format) {
  if (!lastExportData || !lastExportData.length) return;

  let content, filename, mime;
  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

  if (format === 'json') {
    content = JSON.stringify(lastExportData, null, 2);
    filename = `messenger-export-${ts}.json`;
    mime = 'application/json';
  } else {
    content = lastExportData.map(m => {
      const tag = m.sender === 'self' ? 'Tôi' : 'Đối phương';
      return `${tag}: ${m.text}`;
    }).join('\n');
    filename = `messenger-export-${ts}.txt`;
    mime = 'text/plain;charset=utf-8';
  }

  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
