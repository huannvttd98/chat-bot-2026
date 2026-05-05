const STORAGE_KEYS = {
  rules: 'rules',
  selectors: 'selectors',
  enabled: 'enabled'
};

const DEFAULTS = {
  rules: [],
  selectors: null,
  enabled: true
};

async function getAll() {
  const result = await chrome.storage.local.get(Object.values(STORAGE_KEYS));
  return { ...DEFAULTS, ...result };
}

async function get(key) {
  const result = await chrome.storage.local.get(key);
  return result[key] !== undefined ? result[key] : DEFAULTS[key];
}

async function set(key, value) {
  await chrome.storage.local.set({ [key]: value });
}

async function setMany(obj) {
  await chrome.storage.local.set(obj);
}

if (typeof self !== 'undefined') {
  self.Storage = { STORAGE_KEYS, DEFAULTS, getAll, get, set, setMany };
}
