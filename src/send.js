// Shared by the popup and the background worker.
const api = globalThis.browser ?? globalThis.chrome;

// Talks to the content script in every frame of a tab. Videos can live in the page
// itself or in embedded frames (YouTube/Vimeo embeds, course players, ...), so each
// frame reports its own status and actions run in whichever frame has the video.
//
// This uses scripting.executeScript rather than messaging so the click or shortcut
// that triggered it still counts as a user gesture in the page, which browsers
// require before they'll open a picture-in-picture window.

// [{ frameId, mode, pip, ownVideo, hasVideo, score, canFloat }] for each frame where
// the extension can run. Empty on pages it can't run on (browser settings, stores, ...).
async function frameStates(tabId) {
  const query = () => api.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: () => window.__floatingPlayer?.status() ?? null,
  });
  try {
    let results = await query();
    if (results.some((r) => r.result == null)) {
      // Some frames were opened before the extension was installed or updated.
      await api.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['content.js'] }).catch(() => {});
      results = await query();
    }
    return results.filter((r) => r.result).map((r) => ({ ...r.result, frameId: r.frameId }));
  } catch {
    return [];
  }
}

// One status for the whole tab, for the popup.
function summarize(states) {
  if (!states.length) return null;
  const top = states.find((s) => s.frameId === 0) ?? {};
  return {
    mode: top.mode ?? null,
    pip: states.some((s) => s.pip),
    hasVideo: states.some((s) => s.hasVideo),
    canFloat: !!top.canFloat,
  };
}

// Pop-out runs where something is already popped out (to bring it back), otherwise
// in the frame with the most prominent video.
function popOutFrame(states) {
  const active = states.find((s) => s.mode === 'window' || s.pip);
  if (active) return active.frameId;
  let best = null;
  for (const s of states) if (s.ownVideo && (!best || s.score > best.score)) best = s;
  return best?.frameId ?? 0;
}

async function runInFrame(tabId, frameId, action) {
  try {
    const [res] = await api.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      func: (a) => window.__floatingPlayer?.[a]() ?? null,
      args: [action],
    });
    return res?.result ?? null;
  } catch {
    return null;
  }
}

// Runs 'float' or 'popOut' in the right frame. Pass states you already have so
// nothing is awaited before the call and a click still counts as a user gesture.
async function runAction(tabId, action, states) {
  states ??= await frameStates(tabId);
  // Floating in the page is always done by the top frame, including for embeds.
  const frameId = action === 'float' ? 0 : popOutFrame(states);
  return runInFrame(tabId, frameId, action);
}
