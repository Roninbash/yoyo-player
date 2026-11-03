// Behaves like YouTube where YoYo Player relies on it: links switch videos without
// reloading the page, the same <video> element plays the next video, and the Skip
// button only responds to a real click on the button itself.
const player = document.getElementById('movie_player');
const video = player.querySelector('video');
const skip = player.querySelector('.ytp-skip-ad-button');
const nextBtn = player.querySelector('.ytp-next-button');
const TITLES = { first000001: 'First video', second00002: 'Second video', third000003: 'Third video' };

document.addEventListener('click', (e) => {
  const link = e.target.closest('a[href*="/watch?v="]');
  if (!link) return;
  e.preventDefault();
  const id = new URL(link.href).searchParams.get('v');
  history.pushState(null, '', `/watch?v=${id}`);
  document.title = `${TITLES[id]} - YouTube`;
  video.srcObject = fakeStream();
  video.play();
  nextBtn.href = '/watch?v=third000003';
  nextBtn.dataset.tooltipText = 'Third video';
});

window.startAd = () => {
  player.classList.add('ad-showing');
  setTimeout(() => { skip.style.display = ''; }, 300); // skippable after a moment
};

skip.addEventListener('click', (e) => {
  // YouTube ignores clicks from scripts, and its handler fails on a click that lands on the icon.
  if (!e.isTrusted || e.target !== skip) return;
  skip.style.display = 'none';
  player.classList.remove('ad-showing');
  window.adSkipped = true;
});
