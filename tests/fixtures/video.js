// A fake "video": an animated canvas streamed into <video>, so tests need no media files.
function fakeStream() {
  const c = document.createElement('canvas');
  c.width = 640;
  c.height = 360;
  const g = c.getContext('2d');
  let t = 0;
  setInterval(() => {
    g.fillStyle = `hsl(${t++ % 360}, 70%, 50%)`;
    g.fillRect(0, 0, 640, 360);
    g.fillStyle = '#fff';
    g.font = '48px sans-serif';
    g.fillText(`Frame ${t}`, 200, 200);
  }, 33);
  return c.captureStream(30);
}

customElements.define('shadow-player', class extends HTMLElement {
  constructor() {
    super();
    const v = document.createElement('video');
    v.style.cssText = 'display:block;width:640px;height:360px';
    this.attachShadow({ mode: 'open' }).append(v);
  }
});

for (const host of document.querySelectorAll('shadow-player')) {
  const v = host.shadowRoot.querySelector('video');
  v.srcObject = fakeStream();
  v.play();
}
for (const v of document.querySelectorAll('video')) {
  v.srcObject = fakeStream();
  v.play();
}
