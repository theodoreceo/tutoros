function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('TutorOS')
    .addItem('Обновить файл статистики', 'refreshTutorOSStatsFile')
    .addItem('Включить автообновление', 'installTutorOSStatsTrigger')
    .addToUi();
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
    'Группа', 'Формат', 'Ученики', 'Выдано ДЗ',
    'Работ сдано', 'Выполнение', 'Просрочено', 'Ждут проверки',
    'Средний результат', 'Сдано вовремя', 'Проверка, ч', 'Подключены', 'Статус',
  ], data.groups.map(row => [
    row.group, row.format, row.students, row.assignments,
    row.submitted, row.completion_rate, row.overdue, row.awaiting_review,
    row.average_score, row.on_time_rate, row.review_hours, row.connected_rate, row.status,
  ]), [190, 120, 85, 90, 100, 105, 95, 110, 130, 120, 105, 105, 90], {
    integers: [3, 4, 5, 7, 8], percentages: [6, 9, 10, 12], decimals: [11],
  });
  writeTutorOSStatsTable_(spreadsheet, 'Ученики', [
    'Ученик', 'Формат', 'Группа', 'Статус', 'Подключён', 'Что требует внимания',
    'Выдано ДЗ', 'Сдано', 'Проверено', 'Выполнение', 'Просрочено',
    'Ждут проверки', 'Средний результат', 'Динамика', 'Сдано вовремя', 'Последняя сдача',
  ], data.students.map(row => [
    row.student, row.format, row.group, row.status, row.connected ? 'Да' : 'Нет', row.attention,
    row.assigned, row.submitted, row.checked, row.completion_rate, row.overdue,
    row.awaiting_review, row.average_score, row.trend, row.on_time_rate,
    tutorOSStatsDate_(row.last_submitted_at),
  ]), [180, 120, 190, 95, 95, 155, 90, 80, 95, 105, 95, 110, 130, 105, 120, 125], {
    integers: [7, 8, 9, 11, 12], percentages: [10, 13, 14, 15], dateTimes: [16],
  });
  writeTutorOSStatsTable_(spreadsheet, 'ДЗ', [
    'Выдано', 'Группа', 'Урок', 'Тема', 'Тип', 'Уровень', 'Состояние', 'Дедлайн',
    'Учеников', 'Сдано', 'Проверено', 'Выполнение', 'Просрочено',
    'Ждут проверки', 'Средний результат', 'Сдано вовремя', 'Проверка, ч',
  ], data.assignments.map(row => [
    tutorOSStatsDate_(row.assigned_at), row.group, row.lesson, row.topic,
    row.type, row.level, row.state, tutorOSStatsDate_(row.due_date, true), row.students,
    row.submitted, row.checked, row.completion_rate, row.overdue,
    row.awaiting_review, row.average_score, row.on_time_rate, row.review_hours,
  ]), [120, 150, 80, 280, 120, 105, 95, 105, 90, 80, 95, 105, 95, 110, 130, 120, 105], {
    dateTimes: [1], dates: [8], integers: [9, 10, 11, 13, 14],
    percentages: [12, 15, 16], decimals: [17],
  });
  writeTutorOSStatsTable_(spreadsheet, 'Результаты', [
    'Выдано', 'Дедлайн', 'Группа', 'Ученик', 'Урок', 'Тема', 'Состояние ДЗ', 'Статус',
    'Сдано', 'Проверено', 'Балл', 'Максимум', 'Результат', 'Вовремя', 'Комментарий',
  ], data.results.map(row => [
    tutorOSStatsDate_(row.assigned_at), tutorOSStatsDate_(row.due_date, true),
    row.group, row.student, row.lesson, row.topic, row.assignment_state, row.status,
    tutorOSStatsDate_(row.submitted_at), tutorOSStatsDate_(row.checked_at),
    row.score, row.max_score, row.result, row.on_time, row.comment,
  ]), [120, 105, 150, 180, 80, 260, 105, 140, 120, 120, 75, 85, 100, 90, 280], {
    dateTimes: [1, 9, 10], dates: [2], integers: [11, 12], percentages: [13],
  });
  writeTutorOSStatsTable_(spreadsheet, 'Темы', [
    'Тема', 'ДЗ', 'Работ выдано', 'Выполнение', 'Просрочено',
    'Средний результат', 'Сдано вовремя',
  ], data.topics.map(row => [
    row.topic, row.assignments, row.students, row.completion_rate, row.overdue,
    row.average_score, row.on_time_rate,
  ]), [280, 75, 110, 105, 95, 130, 120], {
    integers: [2, 3, 5], percentages: [4, 6, 7],
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
  sheet.getRange('A17:F17').merge();
  sheet.getRange('A1').setValue('TutorOS — учёт и статистика');
  sheet.getRange('A2').setValue('Данные обновляются из TutorOS автоматически каждые 10 минут.');
  sheet.getRange('A3:B3').setValues([[
    'Последнее обновление', tutorOSStatsDate_(data.updated_at),
  ]]);
  sheet.getRange('A5:A15').setValues([
    ['Активных мини-групп'], ['Индивидуальных учеников'], ['Всего активных учеников'], ['Выдано ДЗ'],
    ['Проверено работ'], ['Ждут проверки'], ['Просрочено работ'], ['Выполнение ДЗ'],
    ['Средний результат'], ['Сдано вовремя'], ['Среднее время проверки, ч'],
  ]);
  sheet.getRange('B5:B15').setValues([
    [data.overview.active_mini_groups], [data.overview.active_individuals], [data.overview.active_students],
    [data.overview.assignments], [data.overview.checked], [data.overview.awaiting_review],
    [data.overview.overdue], [data.overview.completion_rate], [data.overview.average_score],
    [data.overview.on_time_rate], [data.overview.review_hours],
  ]);
  sheet.getRange('A17').setValue(
    'Чтобы посмотреть конкретную группу или ученика, включите фильтр на соответствующем листе.'
  );
  sheet.setHiddenGridlines(true);
  sheet.setFrozenRows(3);
  sheet.getRange('A1:F1').setBackground('#e8eaed').setFontWeight('bold').setFontSize(16);
  sheet.getRange('A2').setFontColor('#5f6368').setFontStyle('italic');
  sheet.getRange('A5:A15').setFontWeight('bold');
  sheet.getRange('B5:B15').setFontWeight('bold').setFontSize(13);
  sheet.getRange('B5:B11').setNumberFormat('0');
  sheet.getRange('B12:B14').setNumberFormat('0%');
  sheet.getRange('B15').setNumberFormat('0.0');
  sheet.getRange('A17').setFontColor('#5f6368').setWrap(true);
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
  (formats.decimals || []).forEach(column =>
    sheet.getRange(2, column, dataRows, 1).setNumberFormat('0.0')
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

function tutorOSNotify_(message) {
  try {
    SpreadsheetApp.getUi().alert(message);
  } catch (error) {
    console.log(message);
  }
}
