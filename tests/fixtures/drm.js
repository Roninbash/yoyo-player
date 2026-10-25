// A video with Clear Key media keys attached, which is how DRM players (Netflix,
// Prime Video, ...) look to the extension. Media keys can't be attached to a live
// stream, so this records a few seconds of canvas animation into a real WebM first.
const v = document.querySelector('video');
const c = document.createElement('canvas');
c.width = 640;
c.height = 360;
const g = c.getContext('2d');
let t = 0;
setInterval(() => {
  g.fillStyle = `hsl(${t++ % 360}, 70%, 50%)`;
  g.fillRect(0, 0, 640, 360);
}, 33);

const chunks = [];
const rec = new MediaRecorder(c.captureStream(30), { mimeType: 'video/webm' });
rec.ondataavailable = (e) => chunks.push(e.data);
rec.onstop = async () => {
  try {
    const access = await navigator.requestMediaKeySystemAccess('org.w3.clearkey', [{
      initDataTypes: ['keyids'],
      videoCapabilities: [{ contentType: 'video/webm; codecs="vp8"' }],
    }]);
    await v.setMediaKeys(await access.createMediaKeys());
    v.src = URL.createObjectURL(new Blob(chunks, { type: 'video/webm' }));
    await v.play();
    document.body.dataset.drm = 'ready';
  } catch (e) {
    document.body.dataset.drm = `failed: ${e.message}`;
  }
};
rec.start();
setTimeout(() => rec.stop(), 6000);
