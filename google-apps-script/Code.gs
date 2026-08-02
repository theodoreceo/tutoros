const TUTOROS_GROUPS = [
  { sheetName: 'Группа А', methodSheetName: 'Базовая', program: 'base' },
  { sheetName: 'Группа Б', methodSheetName: 'Продвинутая', program: 'advanced' },
];

// Method sheets are reusable course templates. Actual groups are created in Telegram.
const TUTOROS_METHODS = [
  { sheetName: 'Базовая', program: 'base' },
  { sheetName: 'Продвинутая', program: 'advanced' },
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
    .addItem('Синхронизировать методики', 'syncTutorOS')
    .addItem('Обновить файл статистики', 'refreshTutorOSStatsFile')
    .addItem('Включить автообновление', 'installTutorOSStatsTrigger')
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
  tutorOSNotify_('TutorOS: часовой пояс установлен на Москву, технические данные скрыты.');
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

  const templates = [];
  const lessons = [];
  TUTOROS_METHODS.forEach(config => {
    const methodSheet = spreadsheet.getSheetByName(config.sheetName);
    if (!methodSheet) {
      throw new Error(`Не найден лист методики «${config.sheetName}».`);
    }

    const templateId = tutorOSShortId_('m', spreadsheet.getId(), methodSheet.getSheetId());
    templates.push({
      id: templateId,
      name: config.sheetName,
      program: config.program,
      sheet_key: config.sheetName,
      active: true,
    });

    const seenEventCodes = {};
    const lastRow = methodSheet.getLastRow();
    if (lastRow < 6) return;

    const rowCount = lastRow - 5;
    const rows = methodSheet
      .getRange(6, 1, rowCount, 5)
      .getDisplayValues();

    rows.forEach((row, index) => {
      const month = String(row[0] || '').trim();
      const week = String(row[1] || '').trim();
      const eventCode = String(row[2] || '').trim();
      const block = String(row[3] || '').trim();
      const topic = String(row[4] || '').trim();
      if (!eventCode) return;

      if (seenEventCodes[eventCode]) {
        throw new Error(
          `В листе «${config.sheetName}» код «${eventCode}» встречается в строках ` +
          `${seenEventCodes[eventCode]} и ${6 + index}.`
        );
      }
      if (!topic) {
        throw new Error(`В листе «${config.sheetName}» у кода «${eventCode}» не указана тема.`);
      }
      seenEventCodes[eventCode] = 6 + index;

      lessons.push({
        id: tutorOSShortId_('e', templateId, eventCode),
        template_id: templateId,
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

  const response = UrlFetchApp.fetch(apiUrl.replace(/\/$/, '') + '/api/sync-course', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-tutoros-sync-secret': secret },
    payload: JSON.stringify({ templates: templates, lessons: lessons }),
    muteHttpExceptions: true,
  });

  if (response.getResponseCode() !== 200) {
    throw new Error('TutorOS sync failed: ' + response.getContentText());
  }
  tutorOSNotify_(
    `TutorOS: синхронизировано методик — ${templates.length}, событий — ${lessons.length}.`
  );
}

function refreshTutorOSStatsFile() {
  const result = syncTutorOSStatsFile();
  tutorOSNotify_(
    `TutorOS: статистика обновлена. Групп — ${result.groups}, учеников — ${result.students}.`
  );
}

function installTutorOSStatsTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === 'syncTutorOSStatsFile')
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));
  ScriptApp.newTrigger('syncTutorOSStatsFile')
    .timeBased()
    .everyMinutes(10)
    .create();
  const result = syncTutorOSStatsFile();
  tutorOSNotify_(
    `TutorOS: автообновление включено. Групп — ${result.groups}, учеников — ${result.students}.`
  );
}

function syncTutorOSStatsFile() {
  const properties = PropertiesService.getScriptProperties();
  const apiUrl = properties.getProperty('TUTOROS_API_URL');
  const secret = properties.getProperty('TUTOROS_SYNC_SECRET');
  const statsSpreadsheetId = properties.getProperty('TUTOROS_STATS_SPREADSHEET_ID');
  if (!apiUrl || !secret || !statsSpreadsheetId) {
    throw new Error(
      'Добавьте TUTOROS_API_URL, TUTOROS_SYNC_SECRET и TUTOROS_STATS_SPREADSHEET_ID в Script Properties.'
    );
  }

  const response = UrlFetchApp.fetch(apiUrl.replace(/\/$/, '') + '/api/stats-export', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-tutoros-sync-secret': secret },
    payload: '{}',
    muteHttpExceptions: true,
  });
  if (response.getResponseCode() !== 200) {
    throw new Error('TutorOS stats failed: ' + response.getContentText());
  }

  const data = JSON.parse(response.getContentText());
  const spreadsheet = SpreadsheetApp.openById(statsSpreadsheetId);
  spreadsheet.setSpreadsheetTimeZone('Europe/Moscow');
  writeTutorOSStatsOverview_(spreadsheet, data);
  writeTutorOSStatsTable_(spreadsheet, 'Группы', [
    'Группа', 'Программа', 'Цель', 'Ученики', 'Выдано ДЗ',
    'Работ сдано', 'Средний результат', 'Сдано вовремя', 'Статус',
  ], data.groups.map(row => [
    row.group, row.program, row.target_score, row.students, row.assignments,
    row.submitted, row.average_score, row.on_time_rate, row.status,
  ]), [170, 120, 75, 85, 90, 100, 130, 120, 90], {
    integers: [3, 4, 5, 6], percentages: [7, 8],
  });
  writeTutorOSStatsTable_(spreadsheet, 'Ученики', [
    'Ученик', 'Группа', 'Программа', 'Цель', 'Статус', 'Выдано ДЗ',
    'Сдано', 'Проверено', 'Средний результат', 'Сдано вовремя',
  ], data.students.map(row => [
    row.student, row.group, row.program, row.target_score, row.status,
    row.assigned, row.submitted, row.checked, row.average_score, row.on_time_rate,
  ]), [180, 160, 120, 75, 95, 90, 80, 95, 130, 120], {
    integers: [4, 6, 7, 8], percentages: [9, 10],
  });
  writeTutorOSStatsTable_(spreadsheet, 'ДЗ', [
    'Выдано', 'Группа', 'Урок', 'Тема', 'Тип', 'Уровень', 'Дедлайн',
    'Учеников', 'Сдано', 'Проверено', 'Средний результат',
  ], data.assignments.map(row => [
    tutorOSStatsDate_(row.assigned_at), row.group, row.lesson, row.topic,
    row.type, row.level, tutorOSStatsDate_(row.due_date, true), row.students,
    row.submitted, row.checked, row.average_score,
  ]), [120, 150, 80, 280, 120, 105, 105, 90, 80, 95, 130], {
    dateTimes: [1], dates: [7], integers: [8, 9, 10], percentages: [11],
  });
  writeTutorOSStatsTable_(spreadsheet, 'Результаты', [
    'Выдано', 'Дедлайн', 'Группа', 'Ученик', 'Урок', 'Тема', 'Статус',
    'Сдано', 'Проверено', 'Балл', 'Максимум', 'Результат', 'Вовремя', 'Комментарий',
  ], data.results.map(row => [
    tutorOSStatsDate_(row.assigned_at), tutorOSStatsDate_(row.due_date, true),
    row.group, row.student, row.lesson, row.topic, row.status,
    tutorOSStatsDate_(row.submitted_at), tutorOSStatsDate_(row.checked_at),
    row.score, row.max_score, row.result, row.on_time, row.comment,
  ]), [120, 105, 150, 180, 80, 260, 105, 120, 120, 75, 85, 100, 90, 280], {
    dateTimes: [1, 8, 9], dates: [2], integers: [10, 11], percentages: [12],
  });
  SpreadsheetApp.flush();
  return { groups: data.groups.length, students: data.students.length };
}

function writeTutorOSStatsOverview_(spreadsheet, data) {
  const sheet = tutorOSStatsSheet_(spreadsheet, 'Обзор');
  sheet.getRange('A1:F20').clearContent();
  sheet.getRange('A1:F20').breakApart();
  sheet.getRange('A1:F1').merge();
  sheet.getRange('A2:F2').merge();
  sheet.getRange('A12:F12').merge();
  sheet.getRange('A1').setValue('TutorOS — учёт и статистика');
  sheet.getRange('A2').setValue('Данные обновляются из TutorOS автоматически каждые 10 минут.');
  sheet.getRange('A3:B3').setValues([[
    'Последнее обновление', tutorOSStatsDate_(data.updated_at),
  ]]);
  sheet.getRange('A5:A10').setValues([
    ['Активных групп'], ['Активных учеников'], ['Выдано ДЗ'],
    ['Проверено работ'], ['Средний результат'], ['Сдано вовремя'],
  ]);
  sheet.getRange('B5:B10').setValues([
    [data.overview.active_groups], [data.overview.active_students],
    [data.overview.assignments], [data.overview.checked],
    [data.overview.average_score], [data.overview.on_time_rate],
  ]);
  sheet.getRange('A12').setValue(
    'Чтобы посмотреть конкретную группу или ученика, включите фильтр на соответствующем листе.'
  );
  sheet.setHiddenGridlines(true);
  sheet.setFrozenRows(3);
  sheet.getRange('A1:F1').setBackground('#e8eaed').setFontWeight('bold').setFontSize(16);
  sheet.getRange('A2').setFontColor('#5f6368').setFontStyle('italic');
  sheet.getRange('A5:A10').setFontWeight('bold');
  sheet.getRange('B5:B10').setFontWeight('bold').setFontSize(13);
  sheet.getRange('B5:B8').setNumberFormat('0');
  sheet.getRange('B9:B10').setNumberFormat('0%');
  sheet.getRange('A12').setFontColor('#5f6368').setWrap(true);
  sheet.setColumnWidth(1, 190);
  sheet.setColumnWidth(2, 150);
  for (let column = 3; column <= 6; column++) sheet.setColumnWidth(column, 95);
}

function writeTutorOSStatsTable_(spreadsheet, name, headers, rows, widths, formats) {
  const sheet = tutorOSStatsSheet_(spreadsheet, name);
  const requiredRows = Math.max(2, rows.length + 1);
  if (sheet.getMaxRows() < requiredRows) {
    sheet.insertRowsAfter(sheet.getMaxRows(), requiredRows - sheet.getMaxRows());
  }
  const columns = headers.length;
  sheet.getRange(1, 1, sheet.getMaxRows(), columns).clearContent();
  sheet.getRange(1, 1, 1, columns).setValues([headers]);
  if (rows.length) sheet.getRange(2, 1, rows.length, columns).setValues(rows);

  const filter = sheet.getFilter();
  if (filter) filter.remove();
  sheet.getRange(1, 1, Math.max(2, rows.length + 1), columns).createFilter();
  sheet.setFrozenRows(1);
  sheet.setHiddenGridlines(true);
  sheet.getRange(1, 1, 1, columns)
    .setBackground('#e8eaed')
    .setFontWeight('bold')
    .setWrap(true)
    .setVerticalAlignment('middle');
  sheet.setRowHeight(1, 34);
  widths.forEach((width, index) => sheet.setColumnWidth(index + 1, width));

  const dataRows = Math.max(1, rows.length);
  (formats.integers || []).forEach(column =>
    sheet.getRange(2, column, dataRows, 1).setNumberFormat('0')
  );
  (formats.percentages || []).forEach(column =>
    sheet.getRange(2, column, dataRows, 1).setNumberFormat('0%')
  );
  (formats.dates || []).forEach(column =>
    sheet.getRange(2, column, dataRows, 1).setNumberFormat('dd.MM.yyyy')
  );
  (formats.dateTimes || []).forEach(column =>
    sheet.getRange(2, column, dataRows, 1).setNumberFormat('dd.MM.yyyy HH:mm')
  );
}

function tutorOSStatsSheet_(spreadsheet, name) {
  return spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
}

function tutorOSStatsDate_(value, dateOnly) {
  if (!value) return '';
  return dateOnly ? new Date(String(value).slice(0, 10) + 'T12:00:00Z') : new Date(value);
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
  return [prefix].concat(parts.map(part => String(part).trim())).join('__');
}

function tutorOSShortId_(prefix) {
  const parts = Array.prototype.slice.call(arguments, 1);
  const source = parts.map(part => String(part).trim()).join('|');
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, source);
  const hex = digest.map(byte => ('0' + ((byte + 256) % 256).toString(16)).slice(-2)).join('');
  return prefix + hex.slice(0, 20);
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
  tutorOSNotify_('TutorOS: статистика обновлена.');
}

function tutorOSNotify_(message) {
  try {
    SpreadsheetApp.getUi().alert(message);
  } catch (error) {
    console.log(message);
  }
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
