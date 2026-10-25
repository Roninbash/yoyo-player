// Chrome loads this as a service worker; Safari loads send.js and this as background scripts.
if (typeof importScripts === 'function') importScripts('send.js');

const COMMAND_ACTIONS = { 'pop-out': 'popOut', float: 'float' };

api.commands.onCommand.addListener(async (command, tab) => {
  const action = COMMAND_ACTIONS[command];
  if (!action) return;
  const tabId = tab?.id ?? (await api.tabs.query({ active: true, currentWindow: true }))[0]?.id;
  if (tabId != null) runAction(tabId, action);
});
