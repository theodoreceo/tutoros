import { ALL_PAGES } from '../utils/helpers.js';
import { state } from './state.js';

const TITLES = {
  dashboard:    'Дашборд',
  history:      'История изменений',
  students:     'CRM',
  crm_students: 'Ученики',
  groups:       'Группы',
  lessons_cal:  'Занятия',
  income:       'Доходы',
  expenses:     'Расходы',
  analytics:    'Аналитика',
  tasks:        'Задачи ассистентам',
  homework:     'Домашние задания',
  access:       'Управление доступами',
  curator_dash: 'Дашборд куратора',
  manager_dash: 'Дашборд менеджера',
};

const renderers = {};

export function registerRenderer(page, fn) {
  renderers[page] = fn;
}

export function navigate(pg, { replace = false } = {}) {
  const role = state.currentRole;
  if (role && !role.isOwner && role.pages && !role.pages.includes(pg)) {
    import('../components/toast.js').then(({ toast }) => toast('Нет доступа'));
    return;
  }
  const hash = '#' + pg;
  if (replace) {
    history.replaceState({ pg }, '', hash);
  } else if (location.hash !== hash) {
    history.pushState({ pg }, '', hash);
  }
  _render(pg);
}

function _render(pg) {
  document.querySelectorAll('.sb-item').forEach(el => el.classList.toggle('on', el.dataset.pg === pg));
  document.querySelectorAll('.pg').forEach(el => el.classList.toggle('on', el.id === `pg-${pg}`));
  const titleEl = document.getElementById('page-title');
  if (titleEl) titleEl.textContent = TITLES[pg] || pg;
  if (renderers[pg]) renderers[pg]();
}

export function setupNav() {
  document.querySelectorAll('.sb-item[data-pg]').forEach(el => {
    el.addEventListener('click', () => {
      navigate(el.dataset.pg);
      document.getElementById('sidebar')?.classList.remove('open');
      document.getElementById('sb-overlay')?.classList.remove('show');
    });
  });

  window.addEventListener('popstate', (e) => {
    const pg = e.state?.pg || location.hash.slice(1);
    if (pg && renderers[pg]) _render(pg);
  });
}

export function navigateFromHash() {
  const pg = location.hash.slice(1);
  return pg || null;
}
