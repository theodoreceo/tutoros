let _overlay = null;

function getOverlay() {
  if (!_overlay) {
    _overlay = document.createElement('div');
    _overlay.id = 'modal-overlay';
    _overlay.className = 'overlay';
    _overlay.addEventListener('click', (e) => { if (e.target === _overlay) closeModal(); });
    document.body.appendChild(_overlay);
  }
  return _overlay;
}

export function modal(html) {
  const overlay = getOverlay();
  const root = document.getElementById('modal-root') || overlay;
  overlay.innerHTML = html;
  overlay.classList.add('show');
  setTimeout(() => overlay.querySelector('input, textarea, select')?.focus(), 50);
}

export function closeModal() {
  const overlay = document.getElementById('modal-overlay');
  if (overlay) overlay.classList.remove('show');
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});
