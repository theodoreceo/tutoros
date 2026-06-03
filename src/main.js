import './styles/index.css';

import { supabase } from './lib/supabase.js';
import { initSupabase, clearDemoData, seedDemoData, isDemoMode, setDemoMode, CACHE } from './core/store.js';
import { state } from './core/state.js';
import {
  restoreSession, selectRole, devSwitchRole, applyRoleUI, buildRole,
  logout, promptSwitchRole, confirmSwitch,
  showLoginForm, showRegisterForm, handleLogin, handleRegister,
} from './core/auth.js';
import { navigate, registerRenderer, setupNav } from './core/router.js';
import { ROLE_TYPES } from './utils/helpers.js';
import { initSidebar } from './components/sidebar.js';
import { closeModal } from './components/modal.js';
import { toast } from './components/toast.js';

import { renderDashboard, setDashTab } from './pages/dashboard.js';
import { renderHistoryPage, undoHistoryEntry } from './pages/history-page.js';
import {
  renderStudents, renderCRMStudents, renderPipeline, setCRMView, setCRMStatusFilter,
  openStudentModal, calcLTV, editStudent, saveStudent, deleteStudent,
  openStudentDetail, openStatusDateModal, confirmStatusChange,
  openTrialFromCalendar, scheduleTrialLesson,
  openPaymentModalFor, addStudentNote, selectChip, resetStudentRisk,
  copyRegToken, generateStudentToken,
} from './pages/students.js';
import {
  renderGroups, openGroupModal, editGroup, saveGroup, deleteGroup,
  openGroupDetail, closeGroupDetail, renderGroupDetail, renderLessonJournal,
  openLessonModal, saveLesson, deleteLesson,
  setGroupHwStatus,
} from './pages/groups.js';
import {
  setCalView, calNav, calToday, renderCalendar,
  openLessonFromCalendar, openLessonFormFromPicker, openLessonFormModal, toggleAttendance,
  setCalHwStatus,
  saveLessonForm, openLessonCard, deleteLesson as calDeleteLesson, exportICS, calSubscribe,
  openTrialLessonModal, saveTrialLesson,
} from './pages/calendar.js';
import { renderIncome, openPaymentModal, savePayment, deletePayment } from './pages/income.js';
import { renderExpenses, openExpenseModal, toggleChannelField, addExpenseCategory, saveExpense, deleteExpense } from './pages/expenses.js';
import { renderAnalytics, setAnTab, setAnPeriod } from './pages/analytics.js';
import { renderAccess, openRoleModal, editRole, saveRole, deleteRole, toggleAssistantGroup, openInviteModal, createInvite } from './pages/access.js';
import {
  renderHomeworkPage, renderHwStudentsPage, setHwTab, openReviewModal, saveReview,
  updateScorePreview, updateTotalScore, renderAllHwFiltered,
  updateHwBadge, openCreateHwModal, updateHwLessonOpts, saveNewHw, changeHwStatus,
} from './pages/homework.js';
import { renderCuratorDashPage } from './pages/curator-dash.js';
import { renderManagerDashPage } from './pages/manager-dash.js';
import { renderMarketerDashPage, setMktPeriod } from './pages/marketer-dash.js';
import { renderKpiOverviewPage } from './pages/kpi-overview.js';

// ─── BOOT ─────────────────────────────────────────────────────────────────────

function _updateModeUI() {
  const demo = isDemoMode();
  const dot = document.getElementById('sync-dot');
  const label = document.getElementById('sync-label');
  const btn = document.getElementById('demo-toggle');
  if (dot) dot.style.background = demo ? '#fbbf24' : '#34d399';
  if (label) label.textContent = demo ? 'Демо-режим' : 'Supabase · онлайн';
  if (btn) {
    btn.textContent = demo ? 'Выйти из демо' : 'Демо';
    btn.style.color = demo ? '#fbbf24' : 'rgba(226,232,240,.35)';
    btn.style.borderColor = demo ? 'rgba(251,191,36,.3)' : 'rgba(226,232,240,.12)';
  }
}

async function init() {
  const loadingEl = document.getElementById('loading-screen');

  initSidebar();
  setupDelegation();
  registerRenderer('dashboard', renderDashboard);
  registerRenderer('history', renderHistoryPage);
  registerRenderer('students', renderStudents);
  registerRenderer('crm_students', renderCRMStudents);
  registerRenderer('groups', renderGroups);
  registerRenderer('income', renderIncome);
  registerRenderer('expenses', renderExpenses);
  registerRenderer('homework', renderHomeworkPage);
  registerRenderer('hw_students', renderHwStudentsPage);
  registerRenderer('lessons_cal', renderCalendar);
  registerRenderer('analytics', renderAnalytics);
  registerRenderer('access', renderAccess);
  registerRenderer('curator_dash', renderCuratorDashPage);
  registerRenderer('manager_dash', renderManagerDashPage);
  registerRenderer('marketer_dash', renderMarketerDashPage);
  registerRenderer('kpi_overview', renderKpiOverviewPage);

  const showSetup = (formFn) => {
    if (loadingEl) loadingEl.style.display = 'none';
    document.getElementById('setup-screen')?.classList.add('show');
    formFn();
  };

  if (isDemoMode()) {
    try { await initSupabase(); } catch (err) {
      if (loadingEl) loadingEl.innerHTML = `<div style="color:#ef4444;font-size:14px"><b>Ошибка загрузки данных</b><br><span style="font-size:12px;opacity:.7">${err.message}</span></div>`;
      return;
    }
    if (loadingEl) loadingEl.style.display = 'none';
    _updateModeUI();
    updateHwBadge();
    const restored = await restoreSession();
    if (!restored) showSetup(promptSwitchRole);
    return;
  }

  // Production: check for invite token in URL first
  const inviteToken = new URLSearchParams(window.location.search).get('invite');

  // Check existing Supabase session
  const { data: { session } } = await supabase.auth.getSession();

  if (session) {
    try { await initSupabase(); } catch (err) {
      if (loadingEl) loadingEl.innerHTML = `<div style="color:#ef4444;font-size:14px"><b>Ошибка подключения к базе данных</b><br><span style="font-size:12px;opacity:.7">${err.message}</span></div>`;
      return;
    }
    if (loadingEl) loadingEl.style.display = 'none';
    _updateModeUI();
    updateHwBadge();
    const restored = await restoreSession();
    if (!restored) showSetup(showLoginForm);
  } else if (inviteToken) {
    showSetup(() => showRegisterForm(inviteToken));
  } else {
    showSetup(showLoginForm);
  }
}

// ─── EVENT DELEGATION ─────────────────────────────────────────────────────────

// Central event delegation - replaces all window.* globals
const ACTION_MAP = {
  // Navigation
  navigate: (el) => navigate(el.dataset.pg || el.dataset.arg),
  logout: () => logout(),

  // Owner: preview a role's dashboard
  viewAsRole: (el) => _viewAsRole(el.dataset.id),
  exitViewAs: () => _exitViewAs(),
  promptSwitchRole: () => promptSwitchRole(),
  confirmSwitch: (el) => confirmSwitch(el.dataset.id),
  selectRole: (el) => selectRole(el.dataset.id),
  devSwitchRole: (el) => devSwitchRole(el.dataset.id),
  showLoginForm: () => showLoginForm(),
  showRegisterForm: (el) => showRegisterForm(el.dataset.token || null),
  handleLogin: (el, e) => { e.preventDefault(); handleLogin(e); },
  handleRegister: (el, e) => { e.preventDefault(); handleRegister(e); },
  closeModal: () => closeModal(),

  clearDemoData: async () => { if (confirm('Сбросить все данные?')) { await clearDemoData(); location.reload(); } },
  seedDemoData: async () => { if (!confirm('Загрузить тестовые данные в пустую базу?')) return; await seedDemoData(); location.reload(); },
  toggleDemoMode: () => {
    const going = !isDemoMode();
    const msg = going ? 'Включить демо-режим?\n\nДанные из вашей базы не изменятся — вы просто увидите тестовые данные.' : 'Выйти из демо-режима и вернуться к реальной базе данных?';
    if (!confirm(msg)) return;
    setDemoMode(going);
    location.reload();
  },

  // Students
  openStudentModal: () => openStudentModal(),
  editStudent: (el) => editStudent(el.dataset.id),
  saveStudent: () => saveStudent(),
  deleteStudent: (el) => deleteStudent(el.dataset.id),
  openStudentDetail: (el) => openStudentDetail(el.dataset.id),
  openStatusDateModal: (el) => openStatusDateModal(el.dataset.id, el.dataset.status),
  confirmStatusChange: () => confirmStatusChange(),
  openTrialFromCalendar: (el) => openTrialFromCalendar(el.dataset.id),
  scheduleTrialLesson: () => scheduleTrialLesson(),
  openPaymentModalFor: (el) => openPaymentModalFor(el.dataset.id),
  addStudentNote: (el) => addStudentNote(el.dataset.id),
  selectChip: (el) => selectChip(el.dataset.field, el.dataset.value, el),
  resetStudentRisk: (el) => resetStudentRisk(el.dataset.id),
  copyRegToken: (el) => copyRegToken(el.dataset.token),
  generateStudentToken: (el) => generateStudentToken(el.dataset.id),
  setCRMView: (el) => setCRMView(el.dataset.view),
  setCRMStatusFilter: (el) => setCRMStatusFilter(el.dataset.status),
  calcLTV: () => calcLTV(),

  // Groups
  openGroupModal: () => openGroupModal(),
  editGroup: (el) => editGroup(el.dataset.id),
  saveGroup: () => saveGroup(),
  deleteGroup: (el) => deleteGroup(el.dataset.id),
  openGroupDetail: (el) => openGroupDetail(el.dataset.id),
  closeGroupDetail: () => closeGroupDetail(),
  renderGroupDetail: (el) => renderGroupDetail(el.dataset.id),
  renderLessonJournal: (el) => renderLessonJournal(el.dataset.id),
  openLessonModal: (el) => openLessonModal(el.dataset.id),
  saveLesson: () => saveLesson(),
  deleteLesson: (el) => deleteLesson(el.dataset.id),
  setGroupHwStatus: (el) => setGroupHwStatus(el.dataset.id, el.dataset.status),

  // Calendar
  setCalView: (el) => setCalView(el.dataset.view),
  calNav: (el) => calNav(parseInt(el.dataset.dir)),
  calToday: () => calToday(),
  openLessonFromCalendar: (el) => openLessonFromCalendar(el.dataset.id),
  openLessonFormFromPicker: (el) => openLessonFormFromPicker(el.dataset.date, el.dataset.groupId),
  openLessonFormModal: (el) => openLessonFormModal(el.dataset.id),
  toggleAttendance: (el) => toggleAttendance(el.dataset.lessonId, el.dataset.studentId),
  saveLessonForm: () => saveLessonForm(),
  openLessonCard: (el) => openLessonCard(el.dataset.id),
  calDeleteLesson: (el) => calDeleteLesson(el.dataset.id),
  exportICS: () => exportICS(),
  calSubscribe: () => calSubscribe(),
  setCalHwStatus: (el) => setCalHwStatus(el.dataset.id, el.dataset.status),
  openTrialLessonModal: (el) => openTrialLessonModal(el.dataset.date, el.dataset.id || undefined),
  saveTrialLesson: (el) => saveTrialLesson(el.dataset.id || undefined),

  // Income
  openPaymentModal: () => openPaymentModal(),
  savePayment: () => savePayment(),
  deletePayment: (el) => deletePayment(el.dataset.id),

  // Expenses
  openExpenseModal: () => openExpenseModal(),
  toggleChannelField: () => toggleChannelField(),
  addExpenseCategory: () => addExpenseCategory(),
  saveExpense: () => saveExpense(),
  deleteExpense: (el) => deleteExpense(el.dataset.id),

  // Analytics
  setAnTab: (el) => setAnTab(el.dataset.tab),
  setAnPeriod: (el) => setAnPeriod(parseInt(el.dataset.months)),
  setMktPeriod: (el) => setMktPeriod(+el.dataset.days),

  // Access
  openRoleModal: () => openRoleModal(),
  editRole: (el) => editRole(el.dataset.id),
  saveRole: () => saveRole(),
  deleteRole: (el) => deleteRole(el.dataset.id),
  toggleAssistantGroup: (el) => toggleAssistantGroup(el.dataset.roleId, el.dataset.groupId, el.checked),
  openInviteModal: (el) => openInviteModal(el.dataset.roleId),
  createInvite: () => createInvite(),

  // Homework
  setHwTab: (el) => setHwTab(el.dataset.tab),
  openReviewModal: (el) => openReviewModal(el.dataset.id),
  saveReview: () => saveReview(),
  updateScorePreview: () => updateScorePreview(),
  updateTotalScore: () => updateTotalScore(),
  renderAllHwFiltered: () => renderAllHwFiltered(),
  openCreateHwModal: () => openCreateHwModal(),
  updateHwLessonOpts: () => updateHwLessonOpts(),
  saveNewHw: () => saveNewHw(),
  changeHwStatus: (el) => changeHwStatus(el.dataset.id, el.dataset.status),

  // Dashboard
  setDashTab: (el) => setDashTab(el.dataset.tab),

  // History
  undoHistoryEntry: (el) => undoHistoryEntry(el.dataset.id),

  // Mobile sidebar
  toggleSidebar: () => {
    const sb = document.getElementById('sidebar');
    const ov = document.getElementById('sb-overlay');
    const open = sb?.classList.toggle('open');
    ov?.classList.toggle('show', open);
  },
  closeSidebar: () => {
    document.getElementById('sidebar')?.classList.remove('open');
    document.getElementById('sb-overlay')?.classList.remove('show');
  },
};

function setupDelegation() {
  document.body.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    // Checkboxes are handled by the 'change' listener — skip here
    if (e.target.type === 'checkbox') return;
    const action = el.dataset.action;
    const handler = ACTION_MAP[action];
    if (handler) {
      e.preventDefault();
      handler(el, e);
    }
  });

  // Form submit delegation
  document.body.addEventListener('submit', (e) => {
    const action = e.target.dataset.action;
    if (!action) return;
    const handler = ACTION_MAP[action];
    if (handler) {
      e.preventDefault();
      handler(e.target, e);
    }
  });

  // Checkbox change delegation (for toggleAssistantGroup etc.)
  document.body.addEventListener('change', (e) => {
    if (e.target.type !== 'checkbox') return;
    const el = e.target.closest('[data-action]') || e.target;
    if (!el.dataset.action) return;
    const handler = ACTION_MAP[el.dataset.action];
    if (handler) handler(el, e);
  });
}

// ─── VIEW-AS (owner previewing a role) ───────────────────────────────────────

function _viewAsRole(roleId) {
  if (!state.currentRole?.isOwner) return;
  const role = (CACHE.roles || []).find(r => r.id === roleId);
  if (!role) return;
  const rt = ROLE_TYPES[role.role_type];
  if (!rt) { toast('Неизвестный тип роли'); return; }

  state.viewAsRole = buildRole(role);

  // Show banner
  const banner = document.getElementById('view-as-banner');
  const nameEl = document.getElementById('view-as-name');
  if (banner) banner.style.display = 'flex';
  if (nameEl) nameEl.textContent = `${role.name} (${rt.label})`;

  // Redraw sidebar as this role sees it
  applyRoleUI(state.viewAsRole);

  navigate(rt.homePage || rt.pages?.[0] || 'dashboard');
}

function _exitViewAs() {
  state.viewAsRole = null;
  const banner = document.getElementById('view-as-banner');
  if (banner) banner.style.display = 'none';

  // Restore owner sidebar
  applyRoleUI(state.currentRole);

  navigate('dashboard');
}

// Keep these as window globals for static HTML elements (index.html)
window.toggleDemoMode = ACTION_MAP.toggleDemoMode;
window.toggleSidebar = ACTION_MAP.toggleSidebar;
window.closeSidebar = ACTION_MAP.closeSidebar;
// oninput/onchange on static search inputs in index.html
window.renderStudents = renderStudents;
window.renderCRMStudents = renderCRMStudents;

// ─── START ────────────────────────────────────────────────────────────────────

init();
