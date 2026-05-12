import { ALL_PAGES } from '../utils/helpers.js';
import { state } from './state.js';

const TITLES = {
  dashboard:    'Дашборд',
  history:      'История изменений',
  crm_students: 'CRM / Ученики',
  students:     'Воронка',
  groups:       'Группы',
  income:       'Доходы',
  expenses:     'Расходы',
  tasks:        'Задачи',
  lessons_cal:  'Расписание',
  analytics:    'Аналитика',
  access:       'Доступы и роли',
};

const renderers = {};

export function registerRenderer(page, fn) {
  renderers[page] = fn;
}

export function navigate(page) {
  if (!ALL_PAGES.includes(page)) return;

  // Update active sidebar item
  document.querySelectorAll('.sb-item').forEach(el => {
    el.classList.toggle('on', el.dataset.page === page);
  });

  // Show/hide page sections
  document.querySelectorAll('.pg').forEach(el => {
    el.classList.toggle('on', el.id === `pg-${page}`);
  });

  // Update topbar title
  const titleEl = document.getElementById('page-title');
  if (titleEl) titleEl.textContent = TITLES[page] || page;

  // Render page content
  if (renderers[page]) {
    renderers[page]();
  }
}

export function setupNav() {
  document.querySelectorAll('.sb-item[data-page]').forEach(el => {
    el.addEventListener('click', () => navigate(el.dataset.page));
  });
}
