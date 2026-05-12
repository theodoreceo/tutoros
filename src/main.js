import '/src/styles/index.css';

import { initLocalStorage } from './core/store.js';
import { state } from './core/state.js';
import { restoreSession, selectRole, applyRoleUI, logout } from './core/auth.js';
import { navigate, registerRenderer, setupNav } from './core/router.js';
import { initSidebar } from './components/sidebar.js';
import { closeModal } from './components/modal.js';
import { toast } from './components/toast.js';

import { renderDashboard } from './pages/dashboard.js';
import { renderHistoryPage, undoHistory } from './pages/history-page.js';
import {
  renderStudents, setCRMView, setCRMStatusFilter,
  openStudentModal, saveStudent, deleteStudent,
  openStudentDetail, openStatusDateModal, confirmStatusChange,
  openPaymentModalFor, savePaymentFor,
} from './pages/students.js';
import {
  renderGroups, openGroupModal, saveGroup, deleteGroup,
  openGroupDetail, closeGroupDetail,
  openLessonModal, saveLesson, deleteLesson,
  addStudentToGroup, removeStudentFromGroup,
} from './pages/groups.js';
import { renderCalendar, setCalView, calNav, calToday, openLessonCard, openLessonFormModal, saveLessonForm, deleteLessonFromCal } from './pages/calendar.js';
import { renderIncome, openPaymentModal, savePayment, deletePayment } from './pages/income.js';
import { renderExpenses, openExpenseModal, saveExpense, deleteExpense, toggleChannelField } from './pages/expenses.js';
import { renderAnalytics, setAnTab, setAnPeriod } from './pages/analytics.js';
import { renderAssistantTasks, openAssistantTaskModal, saveAssistantTask, changeTaskStatus, deleteAssistantTask, setTaskFilter } from './pages/tasks.js';
import { renderAccess, openRoleModal, saveRole, deleteRole } from './pages/access.js';

// ─── BOOT ─────────────────────────────────────────────────────────────────────

function init() {
  initLocalStorage();
  initSidebar();

  // Register page renderers
  registerRenderer('dashboard', renderDashboard);
  registerRenderer('history', renderHistoryPage);
  registerRenderer('crm_students', renderStudents);
  registerRenderer('students', renderStudents);
  registerRenderer('groups', renderGroups);
  registerRenderer('income', renderIncome);
  registerRenderer('expenses', renderExpenses);
  registerRenderer('tasks', renderAssistantTasks);
  registerRenderer('lessons_cal', renderCalendar);
  registerRenderer('analytics', renderAnalytics);
  registerRenderer('access', renderAccess);

  // Restore session or show setup screen
  const restored = restoreSession();
  if (!restored) {
    document.getElementById('setup-screen')?.classList.add('show');
  }
}

// ─── WINDOW GLOBALS (for HTML inline onclick handlers) ────────────────────────

window.__navigate = navigate;
window.__closeModal = closeModal;
window.__toast = toast;
window.__logout = logout;

// Auth
window.__selectRole = selectRole;

// Students
window.__openStudentModal = openStudentModal;
window.__saveStudent = saveStudent;
window.__deleteStudent = deleteStudent;
window.__openStudentDetail = openStudentDetail;
window.__setCRMView = setCRMView;
window.__setCRMStatusFilter = setCRMStatusFilter;
window.__openStatusDateModal = openStatusDateModal;
window.__confirmStatusChange = confirmStatusChange;
window.__openPaymentModalFor = openPaymentModalFor;
window.__savePaymentFor = savePaymentFor;

// Groups
window.__openGroupModal = openGroupModal;
window.__saveGroup = saveGroup;
window.__deleteGroup = deleteGroup;
window.__openGroupDetail = openGroupDetail;
window.__closeGroupDetail = closeGroupDetail;
window.__openLessonModal = openLessonModal;
window.__saveLesson = saveLesson;
window.__deleteLesson = deleteLesson;
window.__addStudentToGroup = addStudentToGroup;
window.__removeStudentFromGroup = removeStudentFromGroup;

// Calendar
window.__setCalView = setCalView;
window.__calNav = calNav;
window.__calToday = calToday;
window.__openLessonCard = openLessonCard;
window.__openLessonFormModal = openLessonFormModal;
window.__saveLessonForm = saveLessonForm;
window.__deleteLessonFromCal = deleteLessonFromCal;

// Income
window.__openPaymentModal = openPaymentModal;
window.__savePayment = savePayment;
window.__deletePayment = deletePayment;

// Expenses
window.__openExpenseModal = openExpenseModal;
window.__saveExpense = saveExpense;
window.__deleteExpense = deleteExpense;
window.__toggleChannelField = toggleChannelField;

// Analytics
window.__setAnTab = setAnTab;
window.__setAnPeriod = setAnPeriod;

// Tasks
window.__openAssistantTaskModal = openAssistantTaskModal;
window.__saveAssistantTask = saveAssistantTask;
window.__changeTaskStatus = changeTaskStatus;
window.__deleteAssistantTask = deleteAssistantTask;
window.__setTaskFilter = setTaskFilter;

// Access
window.__openRoleModal = openRoleModal;
window.__saveRole = saveRole;
window.__deleteRole = deleteRole;

// History
window.__undoHistory = undoHistory;

// ─── START ────────────────────────────────────────────────────────────────────

init();
