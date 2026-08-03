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
    'Группа', 'Формат', 'Программа', 'Цель', 'Ученики', 'Выдано ДЗ',
    'Работ сдано', 'Средний результат', 'Сдано вовремя', 'Статус',
  ], data.groups.map(row => [
    row.group, row.format, row.program, row.target_score, row.students, row.assignments,
    row.submitted, row.average_score, row.on_time_rate, row.status,
  ]), [190, 120, 120, 75, 85, 90, 100, 130, 120, 90], {
    integers: [4, 5, 6, 7], percentages: [8, 9],
  });
  writeTutorOSStatsTable_(spreadsheet, 'Ученики', [
    'Ученик', 'Формат', 'Группа', 'Программа', 'Цель', 'Статус', 'Выдано ДЗ',
    'Сдано', 'Проверено', 'Средний результат', 'Сдано вовремя',
  ], data.students.map(row => [
    row.student, row.format, row.group, row.program, row.target_score, row.status,
    row.assigned, row.submitted, row.checked, row.average_score, row.on_time_rate,
  ]), [180, 120, 190, 120, 75, 95, 90, 80, 95, 130, 120], {
    integers: [5, 7, 8, 9], percentages: [10, 11],
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
  sheet.getRange('A13:F13').merge();
  sheet.getRange('A1').setValue('TutorOS — учёт и статистика');
  sheet.getRange('A2').setValue('Данные обновляются из TutorOS автоматически каждые 10 минут.');
  sheet.getRange('A3:B3').setValues([[
    'Последнее обновление', tutorOSStatsDate_(data.updated_at),
  ]]);
  sheet.getRange('A5:A11').setValues([
    ['Активных мини-групп'], ['Индивидуальных учеников'], ['Всего активных учеников'], ['Выдано ДЗ'],
    ['Проверено работ'], ['Средний результат'], ['Сдано вовремя'],
  ]);
  sheet.getRange('B5:B11').setValues([
    [data.overview.active_mini_groups], [data.overview.active_individuals], [data.overview.active_students],
    [data.overview.assignments], [data.overview.checked],
    [data.overview.average_score], [data.overview.on_time_rate],
  ]);
  sheet.getRange('A13').setValue(
    'Чтобы посмотреть конкретную группу или ученика, включите фильтр на соответствующем листе.'
  );
  sheet.setHiddenGridlines(true);
  sheet.setFrozenRows(3);
  sheet.getRange('A1:F1').setBackground('#e8eaed').setFontWeight('bold').setFontSize(16);
  sheet.getRange('A2').setFontColor('#5f6368').setFontStyle('italic');
  sheet.getRange('A5:A11').setFontWeight('bold');
  sheet.getRange('B5:B11').setFontWeight('bold').setFontSize(13);
  sheet.getRange('B5:B9').setNumberFormat('0');
  sheet.getRange('B10:B11').setNumberFormat('0%');
  sheet.getRange('A13').setFontColor('#5f6368').setWrap(true);
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

function tutorOSNotify_(message) {
  try {
    SpreadsheetApp.getUi().alert(message);
  } catch (error) {
    console.log(message);
  }
}
