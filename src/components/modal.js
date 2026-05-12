export function modal(id, html, opts = {}) {
  let overlay = document.getElementById('modal-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'modal-overlay';
    overlay.className = 'overlay';
    document.body.appendChild(overlay);
  }

  const size = opts.size || 'md'; // sm | md | lg | xl
  const sizeClass = size === 'sm' ? 'modal-sm' : size === 'lg' ? 'modal-lg' : size === 'xl' ? 'modal-xl' : '';

  overlay.innerHTML = `<div class="modal ${sizeClass}" id="${id}">${html}</div>`;
  overlay.classList.add('show');

  if (opts.onClose) {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) { closeModal(); opts.onClose(); }
    }, { once: true });
  } else {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    }, { once: true });
  }

  // Focus first input
  setTimeout(() => overlay.querySelector('input, textarea, select')?.focus(), 50);
}

export function closeModal() {
  const overlay = document.getElementById('modal-overlay');
  if (overlay) overlay.classList.remove('show');
}

// ESC key global handler
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});
