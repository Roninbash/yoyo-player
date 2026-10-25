const popBtn = document.getElementById('popout');
const floatBtn = document.getElementById('float');
const statusText = document.getElementById('status');
const isSafari = api.runtime.getURL('').startsWith('safari-web-extension:');
const browserName = isSafari ? 'Safari' : 'the browser';
let tabId = null;
let states = []; // per-frame status, see frameStates() in send.js
let current = null;

function render(state, message) {
  current = state;
  const mode = state?.mode;
  const active = !!mode || !!state?.pip;
  popBtn.disabled = !state || (!state.hasVideo && !active);
  floatBtn.disabled = popBtn.disabled || mode === 'window' || !!state?.pip || (!state.canFloat && mode !== 'page');
  popBtn.textContent = mode === 'window' || state?.pip ? 'Bring back into page' : `Pop out of ${browserName}`;
  floatBtn.textContent = mode === 'page' ? 'Put back into page' : 'Float in page';
  statusText.textContent = message ||
    (!state ? "Can't run on this page." :
    mode === 'window' || state.pip ? `Video is popped out of ${browserName}.` :
    mode === 'page' ? 'Video is floating — drag it anywhere.' :
    !state.hasVideo ? 'No video found on this page.' :
    !state.canFloat ? "This site's player can only pop out." :
    'Video found on this page.');
}

async function refresh(message) {
  states = await frameStates(tabId);
  render(summarize(states), message);
}

// Frame states are fetched when the popup opens, so a click reaches the page
// straight away while it still counts as a user gesture.
popBtn.addEventListener('click', async () => {
  const wasOut = current?.mode === 'window' || !!current?.pip;
  await runAction(tabId, 'popOut', states);
  states = await frameStates(tabId);
  const state = summarize(states);
  if (!wasOut && (state?.mode === 'window' || state?.pip)) return window.close();
  render(state, !wasOut && state?.mode === 'page'
    ? `${isSafari ? 'Safari' : 'The browser'} needs a click on the page: press the pop-out button on the floating player.`
    : undefined);
});
floatBtn.addEventListener('click', async () => {
  await runAction(tabId, 'float', states);
  await refresh();
});

// Settings
const DEFAULTS = { autoFloat: true, autoPip: true };
api.storage.sync.get(DEFAULTS).then((s) => {
  for (const key of Object.keys(DEFAULTS)) document.getElementById(key).checked = s[key];
});
for (const key of Object.keys(DEFAULTS)) {
  const box = document.getElementById(key);
  box.addEventListener('change', () => api.storage.sync.set({ [key]: box.checked }));
}

// Safari has no automatic picture-in-picture on tab switch and no shortcut settings page.
if (isSafari) {
  document.getElementById('autoPip-row').hidden = true;
  document.getElementById('shortcuts').hidden = true;
}

api.commands.getAll().then((commands) => {
  for (const c of commands) {
    const kbd = document.getElementById(`key-${c.name}`);
    if (kbd && c.shortcut) kbd.textContent = c.shortcut;
  }
}).catch(() => {
  document.getElementById('shortcut-hint').hidden = true;
});
document.getElementById('shortcuts').addEventListener('click', (e) => {
  e.preventDefault();
  api.tabs.create({ url: 'chrome://extensions/shortcuts' });
});

api.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
  if (tab?.id == null) return render(null);
  tabId = tab.id;
  await refresh();
});
