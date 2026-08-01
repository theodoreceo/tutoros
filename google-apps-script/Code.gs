const TUTOROS_GROUPS = [
  { sheetName: 'Группа А', methodSheetName: 'Базовая', program: 'base' },
  { sheetName: 'Группа Б', methodSheetName: 'Продвинутая', program: 'advanced' },
];

const TUTOROS_LAYOUT = {
  statisticsRow: 3,
  studentIdRow: 8,
  studentNameRow: 9,
  studentHeaderRow: 10,
  lessonStartRow: 11,
  monthColumn: 2,
  weekColumn: 3,
  eventCodeColumn: 4,
  blockColumn: 5,
  studentStartColumns: [6, 9, 12, 15, 18],
};

const TUTOROS_EVENT_SHEET = '_TutorOS';
const TUTOROS_EVENT_HEADERS = [
  'Время', 'Событие', 'Группа ID', 'Урок ID', 'ДЗ ID', 'Ученик ID',
  'Ученик', 'Статус', 'Сдано', 'В срок', 'Балл', 'Максимум',
  'Результаты заданий', 'Баллы по заданиям', 'Комментарий', 'JSON',
];

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('TutorOS')
    .addItem('Подготовить таблицу', 'prepareTutorOS')
    .addItem('Синхронизировать группы и уроки', 'syncTutorOS')
    .addItem('Обновить статистику', 'refreshTutorOSStats')
    .addToUi();
}

function prepareTutorOS() {
  const spreadsheet = SpreadsheetApp.getActive();
  PropertiesService.getScriptProperties()
    .setProperty('TUTOROS_SPREADSHEET_ID', spreadsheet.getId());
  spreadsheet.setSpreadsheetTimeZone('Europe/Moscow');
  TUTOROS_GROUPS.forEach(config => {
    const sheet = spreadsheet.getSheetByName(config.sheetName);
    if (sheet) sheet.hideRows(TUTOROS_LAYOUT.studentIdRow);
  });
  getTutorOSEventSheet_();
  refreshTutorOSStats_();
  SpreadsheetApp.getUi().alert('TutorOS: часовой пояс установлен на Москву, технические данные скрыты.');
}

function syncTutorOS() {
  const properties = PropertiesService.getScriptProperties();
  const apiUrl = properties.getProperty('TUTOROS_API_URL');
  const secret = properties.getProperty('TUTOROS_SYNC_SECRET');
  if (!apiUrl || !secret) {
    throw new Error('Добавьте TUTOROS_API_URL и TUTOROS_SYNC_SECRET в Script Properties.');
  }

  const spreadsheet = tutorOSSpreadsheet_();
  if (spreadsheet.getSpreadsheetTimeZone() !== 'Europe/Moscow') {
    throw new Error('Сначала выберите TutorOS → Подготовить таблицу.');
  }

  const groups = [];
  const lessons = [];
  const seenLessonIds = {};

  TUTOROS_GROUPS.forEach(config => {
    const groupSheet = spreadsheet.getSheetByName(config.sheetName);
    const methodSheet = spreadsheet.getSheetByName(config.methodSheetName);
    if (!groupSheet || !methodSheet) return;

    const groupId = tutorOSGroupId_(spreadsheet, groupSheet);
    groups.push({
      id: groupId,
      name: config.sheetName,
      program: config.program,
      sheet_key: config.sheetName,
      active: true,
    });

    const methodTopics = readMethodTopics_(methodSheet);
    const lastRow = groupSheet.getLastRow();
    if (lastRow < TUTOROS_LAYOUT.lessonStartRow) return;

    const rowCount = lastRow - TUTOROS_LAYOUT.lessonStartRow + 1;
    const rows = groupSheet
      .getRange(TUTOROS_LAYOUT.lessonStartRow, TUTOROS_LAYOUT.monthColumn, rowCount, 4)
      .getDisplayValues();

    rows.forEach((row, index) => {
      const month = String(row[0] || '').trim();
      const week = String(row[1] || '').trim();
      const eventCode = String(row[2] || '').trim();
      const block = String(row[3] || '').trim();
      if (!eventCode) return;

      const topic = methodTopics[eventCode] || block || eventCode;
      const lessonId = stableTutorOSId_('lesson', groupId, eventCode);
      if (seenLessonIds[lessonId]) {
        throw new Error(`В листе «${config.sheetName}» код «${eventCode}» встречается больше одного раза.`);
      }
      seenLessonIds[lessonId] = true;
      lessons.push({
        id: lessonId,
        group_id: groupId,
        sheet_lesson_key: eventCode,
        course_month: month,
        course_week: week,
        lesson_number: eventCode,
        sequence: index + 1,
        topic: topic,
        block: block,
        event_type: tutorOSEventType_(eventCode),
        scheduled_date: null,
        active: true,
      });
    });
  });

  const response = UrlFetchApp.fetch(apiUrl.replace(/\/$/, '') + '/api/sync-lessons', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-tutoros-sync-secret': secret },
    payload: JSON.stringify({ groups: groups, lessons: lessons }),
    muteHttpExceptions: true,
  });

  if (response.getResponseCode() !== 200) {
    throw new Error('TutorOS sync failed: ' + response.getContentText());
  }
  SpreadsheetApp.getUi().alert(`TutorOS: синхронизировано групп — ${groups.length}, событий — ${lessons.length}.`);
}

function doPost(event) {
  const lock = LockService.getScriptLock();
  try {
    const body = JSON.parse(event.postData.contents || '{}');
    const expectedSecret = PropertiesService.getScriptProperties().getProperty('TUTOROS_SYNC_SECRET');
    if (!expectedSecret || body.secret !== expectedSecret) {
      return tutorOSJson_({ ok: false, error: 'Unauthorized' });
    }

    lock.waitLock(20000);
    appendTutorOSEvent_(body);
    applyTutorOSEvent_(body);
    refreshTutorOSStats_();
    return tutorOSJson_({ ok: true });
  } catch (error) {
    console.error(error);
    return tutorOSJson_({ ok: false, error: error.message });
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
}

function readMethodTopics_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 6) return {};
  const rows = sheet.getRange(6, 1, lastRow - 5, 5).getDisplayValues();
  return rows.reduce((topics, row) => {
    const eventCode = String(row[2] || '').trim();
    const topic = String(row[4] || '').trim();
    if (eventCode) topics[eventCode] = topic;
    return topics;
  }, {});
}

function tutorOSEventType_(eventCode) {
  if (/^В/.test(eventCode)) return 'webinar';
  if (/^З/.test(eventCode)) return 'test';
  if (/^ПП/.test(eventCode)) return 'half_mock';
  if (/^П/.test(eventCode)) return 'mock';
  return 'lesson';
}

function stableTutorOSId_(prefix) {
  const parts = Array.prototype.slice.call(arguments, 1);
  const source = [prefix].concat(parts).join('|');
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, source);
  const hex = bytes.slice(0, 12).map(byte => {
    const unsigned = byte < 0 ? byte + 256 : byte;
    return ('0' + unsigned.toString(16)).slice(-2);
  }).join('');
  return prefix + '_' + hex;
}

function tutorOSGroupId_(spreadsheet, sheet) {
  return stableTutorOSId_('group', spreadsheet.getId(), sheet.getSheetId());
}

function applyTutorOSEvent_(event) {
  const payload = event.payload || {};
  if (event.type === 'student.created') {
    addStudentToGroupSheet_(payload);
    return;
  }
  if (event.type === 'submission.submitted' || event.type === 'submission.checked') {
    writeSubmissionToGroupSheet_(event.type, payload);
  }
}

function addStudentToGroupSheet_(payload) {
  const config = findGroupConfigById_(payload.group_id);
  if (!config || !payload.student_id) return;
  const sheet = tutorOSSpreadsheet_().getSheetByName(config.sheetName);
  if (!sheet) return;

  const existingColumn = findStudentColumn_(sheet, payload.student_id);
  const targetColumn = existingColumn || TUTOROS_LAYOUT.studentStartColumns.find(column =>
    !sheet.getRange(TUTOROS_LAYOUT.studentIdRow, column).getDisplayValue()
  );
  if (!targetColumn) throw new Error(`В группе «${config.sheetName}» нет свободного места для ученика.`);

  sheet.getRange(TUTOROS_LAYOUT.studentIdRow, targetColumn).setValue(payload.student_id);
  sheet.getRange(TUTOROS_LAYOUT.studentNameRow, targetColumn).setValue(payload.name || 'Ученик');
  sheet.getRange(1, targetColumn).setValue('Статистика ' + (payload.name || 'ученика'));
  sheet.hideRows(TUTOROS_LAYOUT.studentIdRow);
}

function writeSubmissionToGroupSheet_(eventType, payload) {
  const config = findGroupConfigById_(payload.group_id);
  if (!config || !payload.lesson_id || !payload.student_id) return;
  const sheet = tutorOSSpreadsheet_().getSheetByName(config.sheetName);
  if (!sheet) return;

  const studentColumn = findStudentColumn_(sheet, payload.student_id);
  const lessonRow = findLessonRow_(sheet, payload.lesson_id, payload.group_id);
  if (!studentColumn || !lessonRow) return;

  const resultColumn = studentColumn + 1;
  const value = eventType === 'submission.submitted'
    ? 'Сдано'
    : `${payload.score ?? '—'}/${payload.max_score ?? '—'}`;
  sheet.getRange(lessonRow, resultColumn).setValue(value);
}

function findStudentColumn_(sheet, studentId) {
  return TUTOROS_LAYOUT.studentStartColumns.find(column =>
    String(sheet.getRange(TUTOROS_LAYOUT.studentIdRow, column).getDisplayValue()) === String(studentId)
  ) || null;
}

function findLessonRow_(sheet, lessonId, groupId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < TUTOROS_LAYOUT.lessonStartRow) return null;
  const values = sheet
    .getRange(TUTOROS_LAYOUT.lessonStartRow, TUTOROS_LAYOUT.eventCodeColumn,
      lastRow - TUTOROS_LAYOUT.lessonStartRow + 1, 1)
    .getDisplayValues();
  const index = values.findIndex(row =>
    stableTutorOSId_('lesson', groupId, String(row[0] || '').trim()) === lessonId
  );
  return index < 0 ? null : TUTOROS_LAYOUT.lessonStartRow + index;
}

function findGroupConfigById_(groupId) {
  const spreadsheet = tutorOSSpreadsheet_();
  return TUTOROS_GROUPS.find(config => {
    const sheet = spreadsheet.getSheetByName(config.sheetName);
    return sheet && tutorOSGroupId_(spreadsheet, sheet) === groupId;
  }) || null;
}

function appendTutorOSEvent_(event) {
  const payload = event.payload || {};
  const sheet = getTutorOSEventSheet_();
  sheet.appendRow([
    event.occurred_at || new Date(),
    event.type || '',
    payload.group_id || '',
    payload.lesson_id || '',
    payload.assignment_id || '',
    payload.student_id || '',
    payload.name || '',
    payload.status || '',
    payload.submitted_at || '',
    payload.on_time === null || payload.on_time === undefined ? '' : payload.on_time,
    payload.score ?? '',
    payload.max_score ?? '',
    JSON.stringify(payload.task_results || []),
    JSON.stringify(payload.task_scores || []),
    payload.comment || '',
    JSON.stringify(payload),
  ]);
}

function refreshTutorOSStats() {
  refreshTutorOSStats_();
  SpreadsheetApp.getUi().alert('TutorOS: статистика обновлена.');
}

function refreshTutorOSStats_() {
  const spreadsheet = tutorOSSpreadsheet_();
  const eventSheet = getTutorOSEventSheet_();
  const assignments = {};
  const submissions = {};

  if (eventSheet.getLastRow() > 1) {
    const rows = eventSheet
      .getRange(2, 1, eventSheet.getLastRow() - 1, TUTOROS_EVENT_HEADERS.length)
      .getValues();
    rows.forEach(row => {
      const type = String(row[1] || '');
      let payload;
      try {
        payload = JSON.parse(row[15] || '{}');
      } catch (error) {
        return;
      }

      if (type === 'homework.created' && payload.assignment_id) {
        assignments[payload.assignment_id] = {
          groupId: payload.group_id,
          hwType: payload.hw_type,
          studentIds: Array.isArray(payload.student_ids) ? payload.student_ids.map(String) : [],
        };
      }

      if ((type === 'submission.submitted' || type === 'submission.checked')
          && payload.assignment_id && payload.student_id) {
        const key = payload.assignment_id + '|' + payload.student_id;
        const previous = submissions[key] || {};
        submissions[key] = {
          submitted: true,
          score: type === 'submission.checked' ? tutorOSNumber_(payload.score) : previous.score,
          maxScore: type === 'submission.checked' ? tutorOSNumber_(payload.max_score) : previous.maxScore,
          checkedAt: type === 'submission.checked' ? row[0] : previous.checkedAt,
        };
      }
    });
  }

  TUTOROS_GROUPS.forEach(config => {
    const sheet = spreadsheet.getSheetByName(config.sheetName);
    if (!sheet) return;
    const groupId = tutorOSGroupId_(spreadsheet, sheet);
    const studentStats = [];

    TUTOROS_LAYOUT.studentStartColumns.forEach(studentColumn => {
      const studentId = String(
        sheet.getRange(TUTOROS_LAYOUT.studentIdRow, studentColumn).getDisplayValue() || ''
      );
      if (!studentId) {
        sheet.getRange(TUTOROS_LAYOUT.statisticsRow, studentColumn, 1, 3)
          .setValues([['—', '—', '—']]);
        return;
      }

      const expectedAssignments = Object.keys(assignments).filter(assignmentId => {
        const assignment = assignments[assignmentId];
        return assignment.groupId === groupId && assignment.studentIds.includes(studentId);
      });
      const submittedAssignments = expectedAssignments.filter(assignmentId =>
        submissions[assignmentId + '|' + studentId]?.submitted
      );
      const homeworkRate = expectedAssignments.length
        ? submittedAssignments.length / expectedAssignments.length * 100
        : null;
      const attendanceRate = tutorOSAttendanceRate_(sheet, studentColumn);
      const mockScores = expectedAssignments
        .filter(assignmentId => assignments[assignmentId].hwType === 'trial')
        .map(assignmentId => submissions[assignmentId + '|' + studentId])
        .filter(result => result && result.score !== null && result.score !== undefined)
        .sort((a, b) => new Date(b.checkedAt || 0) - new Date(a.checkedAt || 0))
        .slice(0, 3)
        .map(result => result.score);
      const mockAverage = mockScores.length
        ? mockScores.reduce((sum, score) => sum + score, 0) / mockScores.length
        : null;

      studentStats.push({ homeworkRate, attendanceRate, mockAverage });
      sheet.getRange(TUTOROS_LAYOUT.statisticsRow, studentColumn, 1, 3).setValues([[
        tutorOSPercent_(homeworkRate),
        tutorOSPercent_(attendanceRate),
        tutorOSDecimal_(mockAverage),
      ]]);
    });

    sheet.getRange(TUTOROS_LAYOUT.statisticsRow, 2, 1, 3).setValues([[
      tutorOSPercent_(tutorOSAverage_(studentStats.map(item => item.homeworkRate))),
      tutorOSPercent_(tutorOSAverage_(studentStats.map(item => item.attendanceRate))),
      tutorOSDecimal_(tutorOSAverage_(studentStats.map(item => item.mockAverage))),
    ]]);
  });
}

function tutorOSAttendanceRate_(sheet, studentColumn) {
  const lastRow = sheet.getLastRow();
  if (lastRow < TUTOROS_LAYOUT.lessonStartRow) return null;
  const values = sheet
    .getRange(TUTOROS_LAYOUT.lessonStartRow, studentColumn,
      lastRow - TUTOROS_LAYOUT.lessonStartRow + 1, 1)
    .getValues()
    .map(row => tutorOSAttendanceValue_(row[0]))
    .filter(value => value !== null);
  if (!values.length) return null;
  return values.filter(Boolean).length / values.length * 100;
}

function tutorOSAttendanceValue_(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  const normalized = String(value || '').trim().toLowerCase();
  if (['да', 'был', 'была', '+', '✅'].includes(normalized)) return true;
  if (['нет', 'не был', 'не была', '-', 'н', '❌'].includes(normalized)) return false;
  return null;
}

function tutorOSNumber_(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function tutorOSAverage_(values) {
  const numbers = values.filter(value => value !== null && value !== undefined);
  return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : null;
}

function tutorOSPercent_(value) {
  return value === null || value === undefined ? '—' : Math.round(value) + '%';
}

function tutorOSDecimal_(value) {
  if (value === null || value === undefined) return '—';
  return Math.round(value * 10) / 10;
}

function getTutorOSEventSheet_() {
  const spreadsheet = tutorOSSpreadsheet_();
  let sheet = spreadsheet.getSheetByName(TUTOROS_EVENT_SHEET);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(TUTOROS_EVENT_SHEET);
    sheet.getRange(1, 1, 1, TUTOROS_EVENT_HEADERS.length).setValues([TUTOROS_EVENT_HEADERS]);
    sheet.setFrozenRows(1);
    sheet.hideSheet();
  }
  return sheet;
}

function tutorOSSpreadsheet_() {
  const active = SpreadsheetApp.getActive();
  if (active) return active;
  const spreadsheetId = PropertiesService.getScriptProperties()
    .getProperty('TUTOROS_SPREADSHEET_ID');
  if (!spreadsheetId) {
    throw new Error('Сначала запустите TutorOS → Подготовить таблицу.');
  }
  return SpreadsheetApp.openById(spreadsheetId);
}

function tutorOSJson_(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
