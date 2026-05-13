import './styles/index.css';

import { initLocalStorage, clearDemoData } from './core/store.js';
import { state } from './core/state.js';
import { restoreSession, selectRole, applyRoleUI, logout, promptSwitchRole, confirmSwitch } from './core/auth.js';
import { navigate, registerRenderer, setupNav } from './core/router.js';
import { initSidebar } from './components/sidebar.js';
import { closeModal } from './components/modal.js';
import { toast } from './components/toast.js';

import { renderDashboard } from './pages/dashboard.js';
import { renderHistoryPage, undoHistoryEntry } from './pages/history-page.js';
import {
  renderStudents, renderCRMStudents, renderPipeline, setCRMView, setCRMStatusFilter,
  openStudentModal, calcLTV, editStudent, saveStudent, deleteStudent,
  openStudentDetail, openStatusDateModal, confirmStatusChange,
  openTrialFromCalendar, scheduleTrialLesson,
  openPaymentModalFor, addStudentNote, selectChip,
} from './pages/students.js';
import {
  renderGroups, openGroupModal, editGroup, saveGroup, deleteGroup,
  openGroupDetail, closeGroupDetail, renderGroupDetail, renderLessonJournal,
  openLessonModal, saveLesson, deleteLesson,
  setHwStatus as groupsSetHwStatus,
} from './pages/groups.js';
import {
  setCalView, calNav, calToday, renderCalendar,
  openLessonFromCalendar, openLessonFormModal, toggleAttendance,
  setHwStatus as calSetHwStatus,
  saveLessonForm, openLessonCard, deleteLesson as calDeleteLesson, exportICS,
} from './pages/calendar.js';
import { renderIncome, openPaymentModal, savePayment, deletePayment } from './pages/income.js';
import { renderExpenses, openExpenseModal, toggleChannelField, addExpenseCategory, saveExpense, deleteExpense } from './pages/expenses.js';
import { renderAnalytics, setAnTab, setAnPeriod } from './pages/analytics.js';
import {
  setTaskFilter, renderAssistantTasks, openAssistantTaskModal, editAssistantTask,
  saveAssistantTask, changeTaskStatus, deleteAssistantTask,
} from './pages/tasks.js';
import { renderAccess, openRoleModal, editRole, saveRole, deleteRole } from './pages/access.js';

// ─── BOOT ─────────────────────────────────────────────────────────────────────

function init() {
  initLocalStorage();
  initSidebar();

  registerRenderer('dashboard', renderDashboard);
  registerRenderer('history', renderHistoryPage);
  registerRenderer('students', renderStudents);
  registerRenderer('crm_students', renderCRMStudents);
  registerRenderer('groups', renderGroups);
  registerRenderer('income', renderIncome);
  registerRenderer('expenses', renderExpenses);
  registerRenderer('tasks', renderAssistantTasks);
  registerRenderer('lessons_cal', renderCalendar);
  registerRenderer('analytics', renderAnalytics);
  registerRenderer('access', renderAccess);

  const restored = restoreSession();
  if (!restored) {
    document.getElementById('setup-screen')?.classList.add('show');
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
window.clearDemoData = () => { if (confirm('Сбросить все данные?')) { clearDemoData(); location.reload(); } };

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
window.openLessonFormModal = openLessonFormModal;
window.toggleAttendance = toggleAttendance;
window.saveLessonForm = saveLessonForm;
window.openLessonCard = openLessonCard;
window.exportICS = exportICS;

// setHwStatus dispatch — groups version takes 4 string args, calendar takes 2 (second is element)
window.setHwStatus = function(...args) {
  if (args.length === 4) return groupsSetHwStatus(...args);
  return calSetHwStatus(...args);
};

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

// History
window.undoHistoryEntry = undoHistoryEntry;

// ─── START ────────────────────────────────────────────────────────────────────

init();
