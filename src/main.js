import './styles/index.css';

import { supabase } from './lib/supabase.js';
import { initSupabase, clearDemoData, seedDemoData, isDemoMode, setDemoMode } from './core/store.js';
import { state } from './core/state.js';
import {
  restoreSession, selectRole, applyRoleUI, logout, promptSwitchRole, confirmSwitch,
  showLoginForm, showRegisterForm, handleLogin, handleRegister,
} from './core/auth.js';
import { navigate, registerRenderer, setupNav } from './core/router.js';
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
  copyRegToken,
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
  saveLessonForm, openLessonCard, deleteLesson as calDeleteLesson, exportICS,
} from './pages/calendar.js';
import { renderIncome, openPaymentModal, savePayment, deletePayment } from './pages/income.js';
import { renderExpenses, openExpenseModal, toggleChannelField, addExpenseCategory, saveExpense, deleteExpense } from './pages/expenses.js';
import { renderAnalytics, setAnTab, setAnPeriod } from './pages/analytics.js';
import {
  setTaskFilter, renderAssistantTasks, openAssistantTaskModal, editAssistantTask,
  saveAssistantTask, changeTaskStatus, deleteAssistantTask,
} from './pages/tasks.js';
import { renderAccess, openRoleModal, editRole, saveRole, deleteRole, toggleAssistantGroup, openInviteModal, createInvite } from './pages/access.js';
import {
  renderHomeworkPage, setHwTab, openReviewModal, saveReview,
  updateScorePreview, updateTotalScore, renderAllHwFiltered,
  updateHwBadge, openCreateHwModal, updateHwLessonOpts, saveNewHw, changeHwStatus,
} from './pages/homework.js';
import { renderCuratorDashPage } from './pages/curator-dash.js';

// ─── BOOT ─────────────────────────────────────────────────────────────────────

function _updateModeUI() {
  const demo = isDemoMode();
  const dot = document.getElementById('sync-dot');
  const label = document.getElementById('sync-label');
  const btn = document.getElementById('demo-toggle');
  if (dot) dot.style.background = demo ? '#f59e0b' : '#22c55e';
  if (label) label.textContent = demo ? 'Демо-режим' : 'Supabase · онлайн';
  if (btn) {
    btn.textContent = demo ? 'Выйти из демо' : 'Демо';
    btn.style.color = demo ? '#f59e0b' : 'rgba(247,243,238,.5)';
    btn.style.borderColor = demo ? 'rgba(245,158,11,.4)' : 'rgba(247,243,238,.2)';
  }
}

async function init() {
  const loadingEl = document.getElementById('loading-screen');

  initSidebar();
  registerRenderer('dashboard', renderDashboard);
  registerRenderer('history', renderHistoryPage);
  registerRenderer('students', renderStudents);
  registerRenderer('crm_students', renderCRMStudents);
  registerRenderer('groups', renderGroups);
  registerRenderer('income', renderIncome);
  registerRenderer('expenses', renderExpenses);
  registerRenderer('tasks', renderAssistantTasks);
  registerRenderer('homework', renderHomeworkPage);
  registerRenderer('lessons_cal', renderCalendar);
  registerRenderer('analytics', renderAnalytics);
  registerRenderer('access', renderAccess);
  registerRenderer('curator_dash', renderCuratorDashPage);

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

// ─── WINDOW GLOBALS (for HTML inline onclick handlers) ────────────────────────

// Core
window.navigate = navigate;
window.closeModal = closeModal;
window.toast = toast;
window.logout = logout;
window.promptSwitchRole = promptSwitchRole;
window.confirmSwitch = confirmSwitch;
window.selectRole = selectRole;
window.showLoginForm = showLoginForm;
window.showRegisterForm = showRegisterForm;
window.handleLogin = handleLogin;
window.handleRegister = handleRegister;
window.clearDemoData = async () => { if (confirm('Сбросить все данные?')) { await clearDemoData(); location.reload(); } };
window.seedDemoData = async () => {
  if (!confirm('Загрузить тестовые данные в пустую базу?')) return;
  await seedDemoData();
  location.reload();
};
window.toggleDemoMode = () => {
  const going = !isDemoMode();
  const msg = going
    ? 'Включить демо-режим?\n\nДанные из вашей базы не изменятся — вы просто увидите тестовые данные.'
    : 'Выйти из демо-режима и вернуться к реальной базе данных?';
  if (!confirm(msg)) return;
  setDemoMode(going);
  location.reload();
};

// Students
window.renderStudents = renderStudents;
window.renderCRMStudents = renderCRMStudents;
window.renderPipeline = renderPipeline;
window.setCRMView = setCRMView;
window.setCRMStatusFilter = setCRMStatusFilter;
window.openStudentModal = openStudentModal;
window.calcLTV = calcLTV;
window.editStudent = editStudent;
window.saveStudent = saveStudent;
window.deleteStudent = deleteStudent;
window.openStudentDetail = openStudentDetail;
window.openStatusDateModal = openStatusDateModal;
window.confirmStatusChange = confirmStatusChange;
window.openTrialFromCalendar = openTrialFromCalendar;
window.scheduleTrialLesson = scheduleTrialLesson;
window.openPaymentModalFor = openPaymentModalFor;
window.addStudentNote = addStudentNote;
window.selectChip = selectChip;
window.resetStudentRisk = resetStudentRisk;
window.copyRegToken = copyRegToken;

// Groups
window.renderGroups = renderGroups;
window.openGroupModal = openGroupModal;
window.editGroup = editGroup;
window.saveGroup = saveGroup;
window.deleteGroup = deleteGroup;
window.openGroupDetail = openGroupDetail;
window.closeGroupDetail = closeGroupDetail;
window.renderGroupDetail = renderGroupDetail;
window.renderLessonJournal = renderLessonJournal;
window.openLessonModal = openLessonModal;
window.saveLesson = saveLesson;
window.deleteLesson = deleteLesson;

// Calendar
window.setCalView = setCalView;
window.calNav = calNav;
window.calToday = calToday;
window.renderCalendar = renderCalendar;
window.openLessonFromCalendar = openLessonFromCalendar;
window.openLessonFormFromPicker = openLessonFormFromPicker;
window.openLessonFormModal = openLessonFormModal;
window.toggleAttendance = toggleAttendance;
window.saveLessonForm = saveLessonForm;
window.openLessonCard = openLessonCard;
window.exportICS = exportICS;

window.setGroupHwStatus = setGroupHwStatus;
window.setCalHwStatus = setCalHwStatus;

// Income
window.openPaymentModal = openPaymentModal;
window.savePayment = savePayment;
window.deletePayment = deletePayment;

// Expenses
window.openExpenseModal = openExpenseModal;
window.toggleChannelField = toggleChannelField;
window.addExpenseCategory = addExpenseCategory;
window.saveExpense = saveExpense;
window.deleteExpense = deleteExpense;

// Analytics
window.setAnTab = setAnTab;
window.setAnPeriod = setAnPeriod;

// Tasks
window.setTaskFilter = setTaskFilter;
window.openAssistantTaskModal = openAssistantTaskModal;
window.editAssistantTask = editAssistantTask;
window.saveAssistantTask = saveAssistantTask;
window.changeTaskStatus = changeTaskStatus;
window.deleteAssistantTask = deleteAssistantTask;

// Access
window.openRoleModal = openRoleModal;
window.editRole = editRole;
window.saveRole = saveRole;
window.deleteRole = deleteRole;
window.toggleAssistantGroup = toggleAssistantGroup;
window.openInviteModal = openInviteModal;
window.createInvite = createInvite;

// Homework
window.setHwTab = setHwTab;
window.openReviewModal = openReviewModal;
window.saveReview = saveReview;
window.updateScorePreview = updateScorePreview;
window.updateTotalScore = updateTotalScore;
window.renderAllHwFiltered = renderAllHwFiltered;
window.openCreateHwModal = openCreateHwModal;
window.updateHwLessonOpts = updateHwLessonOpts;
window.saveNewHw = saveNewHw;
window.changeHwStatus = changeHwStatus;

// Dashboard
window.setDashTab = setDashTab;

// Mobile sidebar
window.toggleSidebar = () => {
  const sb = document.getElementById('sidebar');
  const ov = document.getElementById('sb-overlay');
  const open = sb?.classList.toggle('open');
  ov?.classList.toggle('show', open);
};
window.closeSidebar = () => {
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('sb-overlay')?.classList.remove('show');
};

// History
window.undoHistoryEntry = undoHistoryEntry;

// ─── START ────────────────────────────────────────────────────────────────────

init();
