// Chrome loads this as a service worker; Safari loads send.js and this as background scripts.
if (typeof importScripts === 'function') importScripts('send.js');

const COMMAND_ACTIONS = { 'pop-out': 'popOut', float: 'float' };

api.commands.onCommand.addListener(async (command, tab) => {
  const action = COMMAND_ACTIONS[command];
  if (!action) return;
  const tabId = tab?.id ?? (await api.tabs.query({ active: true, currentWindow: true }))[0]?.id;
  if (tabId != null) runAction(tabId, action);
});

// While a video is popped out, relay play/pause between its page and the YoYo Companion
// Mac app. An open native port also keeps this worker alive for as long as it's needed.
api.runtime.onConnect.addListener((page) => {
  if (page.name !== 'companion') return;
  let app = api.runtime.connectNative(COMPANION_HOST);
  app.onDisconnect.addListener(() => {
    void api.runtime.lastError; // the Mac app isn't installed; nothing to relay to
    app = null;
  });
  app.onMessage.addListener((message) => page.postMessage(message));
  app.postMessage({ action: 'relay' });
  page.onMessage.addListener((message) => app?.postMessage(message));
  page.onDisconnect.addListener(() => app?.disconnect());
});
