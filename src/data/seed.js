// ─── Date helpers ─────────────────────────────────────────────────────────────
export const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate()-n); return d.toISOString().slice(0,10); }
export const daysFromNow = (n) => { const d = new Date(); d.setDate(d.getDate()+n); return d.toISOString().slice(0,10); }

function monthAgo(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0,10);
}

function dateOf(year, month, day) {
  return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}

function hist(...steps) {
  return steps.map(([status, date]) => ({ status, date }));
}

// ─── Groups ───────────────────────────────────────────────────────────────────
const groups = [
  { id:'g1', name:'ЕГЭ Математика 11А', schedule:'Пн/Ср 18:00', price_per_student:6000, capacity:6, type:'exam', created_at:'2025-09-01T10:00:00Z' },
  { id:'g2', name:'ЕГЭ Математика 11Б', schedule:'Вт/Чт 17:00', price_per_student:6000, capacity:6, type:'exam', created_at:'2025-09-02T10:00:00Z' },
  { id:'g3', name:'ОГЭ Математика 9',   schedule:'Сб 11:00',     price_per_student:5000, capacity:8, type:'exam', created_at:'2025-09-05T10:00:00Z' },
  { id:'g4', name:'ЕГЭ Физика 11',      schedule:'Пн/Пт 17:00', price_per_student:6500, capacity:5, type:'exam', created_at:'2025-09-03T10:00:00Z' },
  { id:'g5', name:'ЕГЭ Русский язык 11',schedule:'Ср/Пт 19:00', price_per_student:5500, capacity:8, type:'exam', created_at:'2025-09-04T10:00:00Z' },
];

// ─── Students (70+) ───────────────────────────────────────────────────────────
const students = [
  // ── ACTIVE (g1 — ЕГЭ Мат 11А) ──
  { id:'s1',  name:'Иванова Мария',       contact:'@masha_ivanova',  grade:'11', group_id:'g1', format:'group',      crm_status:'active',          price_per_hour:2500, lessons_per_month:8, paid:true,  trial_score:52, target_score:80,  source:'Авито',    notes:'Очень старательная, всегда делает домашку. Нужно усилить тему интегралов.',        created_at:'2025-09-05T10:00:00Z', first_contact_at:'2025-09-03', left_at:null,            status_history: hist(['lead','2025-09-03'],['trial_scheduled','2025-09-06'],['trial_done','2025-09-10'],['active','2025-09-12']) },
  { id:'s2',  name:'Петров Артём',        contact:'+79161234567',    grade:'11', group_id:'g1', format:'group',      crm_status:'active',          price_per_hour:2500, lessons_per_month:8, paid:true,  trial_score:61, target_score:85,  source:'Сарафан',  notes:'Хорошо разбирается в алгебре, геометрия слабее.',                                  created_at:'2025-09-08T10:00:00Z', first_contact_at:'2025-09-07', left_at:null,            status_history: hist(['lead','2025-09-07'],['trial_done','2025-09-11'],['active','2025-09-15']) },
  { id:'s3',  name:'Новикова Дарья',      contact:'@dasha_nov',      grade:'11', group_id:'g1', format:'group',      crm_status:'active',          price_per_hour:2500, lessons_per_month:8, paid:true,  trial_score:48, target_score:75,  source:'ВКонтакте',notes:'Готовится к профильному ЕГЭ. Слабое место — тригонометрия.',                         created_at:'2025-09-10T10:00:00Z', first_contact_at:'2025-09-09', left_at:null,            status_history: hist(['lead','2025-09-09'],['trial_done','2025-09-14'],['active','2025-09-18']) },
  { id:'s4',  name:'Орлов Никита',        contact:'+79265559871',    grade:'11', group_id:'g1', format:'group',      crm_status:'active',          price_per_hour:2500, lessons_per_month:8, paid:false, trial_score:55, target_score:80,  source:'Авито',    notes:'Хорошо работает на занятиях, ДЗ делает не всегда.',                                created_at:'2025-09-12T10:00:00Z', first_contact_at:'2025-09-11', left_at:null,            status_history: hist(['lead','2025-09-11'],['trial_done','2025-09-16'],['active','2025-09-20']) },
  { id:'s5',  name:'Смирнова Полина',     contact:'@polina_smir',    grade:'11', group_id:'g1', format:'group',      crm_status:'active',          price_per_hour:2500, lessons_per_month:8, paid:true,  trial_score:44, target_score:72,  source:'Telegram', notes:'Целеустремлённая, нужно над задачами части 2.',                                    created_at:'2025-09-15T10:00:00Z', first_contact_at:'2025-09-14', left_at:null,            status_history: hist(['lead','2025-09-14'],['trial_done','2025-09-19'],['active','2025-09-22']) },

  // ── ACTIVE (g2 — ЕГЭ Мат 11Б) ──
  { id:'s6',  name:'Козлов Дмитрий',      contact:'@kozlov_d',       grade:'11', group_id:'g2', format:'group',      crm_status:'active',          price_per_hour:2500, lessons_per_month:8, paid:true,  trial_score:58, target_score:82,  source:'Профи.ру', notes:'Отличная геометрия, тригонометрия подтягивается.',                                  created_at:'2025-09-06T10:00:00Z', first_contact_at:'2025-09-05', left_at:null,            status_history: hist(['lead','2025-09-05'],['trial_done','2025-09-10'],['active','2025-09-14']) },
  { id:'s7',  name:'Лебедева Анастасия',  contact:'+79031112233',    grade:'11', group_id:'g2', format:'group',      crm_status:'active',          price_per_hour:2500, lessons_per_month:8, paid:true,  trial_score:62, target_score:90,  source:'Сарафан',  notes:'Высокая цель. Хорошо работает с теорией.',                                         created_at:'2025-09-09T10:00:00Z', first_contact_at:'2025-09-08', left_at:null,            status_history: hist(['lead','2025-09-08'],['trial_done','2025-09-13'],['active','2025-09-17']) },
  { id:'s8',  name:'Фёдоров Илья',        contact:'@ilya_fed',       grade:'11', group_id:'g2', format:'group',      crm_status:'active',          price_per_hour:2500, lessons_per_month:8, paid:true,  trial_score:39, target_score:70,  source:'Авито',    notes:'Нужно много практики. Медленно, но верно прогрессирует.',                          created_at:'2025-09-13T10:00:00Z', first_contact_at:'2025-09-12', left_at:null,            status_history: hist(['lead','2025-09-12'],['trial_done','2025-09-17'],['active','2025-09-21']) },
  { id:'s9',  name:'Борисова Виктория',   contact:'+79174443322',    grade:'11', group_id:'g2', format:'group',      crm_status:'active',          price_per_hour:2500, lessons_per_month:8, paid:false, trial_score:47, target_score:76,  source:'ВКонтакте',notes:'Пропускала в ноябре. Нужно восстановить материал.',                                created_at:'2025-09-16T10:00:00Z', first_contact_at:'2025-09-15', left_at:null,            status_history: hist(['lead','2025-09-15'],['trial_done','2025-09-20'],['active','2025-09-24']) },

  // ── ACTIVE (g3 — ОГЭ Математика 9) ──
  { id:'s10', name:'Николаева Ксения',    contact:'+79263456789',    grade:'9',  group_id:'g3', format:'group',      crm_status:'active',          price_per_hour:2000, lessons_per_month:4, paid:true,  trial_score:28, target_score:40,  source:'Профи.ру', notes:'Хороший прогресс в алгебре.',                                                      created_at:'2025-09-07T10:00:00Z', first_contact_at:'2025-09-06', left_at:null,            status_history: hist(['lead','2025-09-06'],['trial_done','2025-09-11'],['active','2025-09-15']) },
  { id:'s11', name:'Тарасов Егор',        contact:'@egor_tar',       grade:'9',  group_id:'g3', format:'group',      crm_status:'active',          price_per_hour:2000, lessons_per_month:4, paid:true,  trial_score:24, target_score:37,  source:'Авито',    notes:'Хочет 4 на ОГЭ. Нужно закрыть базовые темы.',                                     created_at:'2025-09-10T10:00:00Z', first_contact_at:'2025-09-09', left_at:null,            status_history: hist(['lead','2025-09-09'],['trial_done','2025-09-14'],['active','2025-09-18']) },
  { id:'s12', name:'Попова Алина',        contact:'+79098765432',    grade:'9',  group_id:'g3', format:'group',      crm_status:'active',          price_per_hour:2000, lessons_per_month:4, paid:true,  trial_score:31, target_score:42,  source:'Сарафан',  notes:'Хорошо разбирается в геометрии, алгебра слабее.',                                  created_at:'2025-09-14T10:00:00Z', first_contact_at:'2025-09-13', left_at:null,            status_history: hist(['lead','2025-09-13'],['trial_done','2025-09-18'],['active','2025-09-22']) },
  { id:'s13', name:'Кузнецов Матвей',     contact:'@matvey_k',       grade:'9',  group_id:'g3', format:'group',      crm_status:'active',          price_per_hour:2000, lessons_per_month:4, paid:true,  trial_score:26, target_score:38,  source:'Telegram', notes:'Активно работает на занятиях, дома ленится.',                                      created_at:'2025-09-18T10:00:00Z', first_contact_at:'2025-09-17', left_at:null,            status_history: hist(['lead','2025-09-17'],['trial_done','2025-09-22'],['active','2025-09-26']) },
  { id:'s14', name:'Соколова Вера',       contact:'+79151234567',    grade:'9',  group_id:'g3', format:'group',      crm_status:'active',          price_per_hour:2000, lessons_per_month:4, paid:false, trial_score:20, target_score:35,  source:'Авито',    notes:'Нужно больше внимания к задачам с параметрами.',                                   created_at:'2025-09-22T10:00:00Z', first_contact_at:'2025-09-21', left_at:null,            status_history: hist(['lead','2025-09-21'],['trial_done','2025-09-26'],['active','2025-09-30']) },

  // ── ACTIVE (g4 — ЕГЭ Физика 11) ──
  { id:'s15', name:'Захаров Павел',       contact:'@pasha_z',        grade:'11', group_id:'g4', format:'group',      crm_status:'active',          price_per_hour:2700, lessons_per_month:8, paid:true,  trial_score:45, target_score:75,  source:'Профи.ру', notes:'Хорошая математическая база, физику подтягивает.',                                  created_at:'2025-09-05T10:00:00Z', first_contact_at:'2025-09-04', left_at:null,            status_history: hist(['lead','2025-09-04'],['trial_done','2025-09-09'],['active','2025-09-13']) },
  { id:'s16', name:'Михайлова Алёна',     contact:'+79263344556',    grade:'11', group_id:'g4', format:'group',      crm_status:'active',          price_per_hour:2700, lessons_per_month:8, paid:true,  trial_score:50, target_score:78,  source:'Сарафан',  notes:'Целеустремлённая. Хочет в физтех.',                                                created_at:'2025-09-08T10:00:00Z', first_contact_at:'2025-09-07', left_at:null,            status_history: hist(['lead','2025-09-07'],['trial_done','2025-09-12'],['active','2025-09-16']) },
  { id:'s17', name:'Волков Роман',        contact:'@roman_vol',      grade:'11', group_id:'g4', format:'group',      crm_status:'active',          price_per_hour:2700, lessons_per_month:8, paid:true,  trial_score:42, target_score:70,  source:'Авито',    notes:'Нужно поработать над задачами по механике.',                                       created_at:'2025-09-11T10:00:00Z', first_contact_at:'2025-09-10', left_at:null,            status_history: hist(['lead','2025-09-10'],['trial_done','2025-09-15'],['active','2025-09-19']) },

  // ── ACTIVE (g5 — ЕГЭ Русский 11) ──
  { id:'s18', name:'Белова Надежда',      contact:'+79171112233',    grade:'11', group_id:'g5', format:'group',      crm_status:'active',          price_per_hour:2200, lessons_per_month:8, paid:true,  trial_score:56, target_score:85,  source:'ВКонтакте',notes:'Отличное сочинение, нужно подтянуть тестовую часть.',                               created_at:'2025-09-06T10:00:00Z', first_contact_at:'2025-09-05', left_at:null,            status_history: hist(['lead','2025-09-05'],['trial_done','2025-09-10'],['active','2025-09-14']) },
  { id:'s19', name:'Морозов Степан',      contact:'@stepan_mor',     grade:'11', group_id:'g5', format:'group',      crm_status:'active',          price_per_hour:2200, lessons_per_month:8, paid:true,  trial_score:49, target_score:78,  source:'Авито',    notes:'Проблема с пунктуацией. Хорошо работает со словарём.',                             created_at:'2025-09-09T10:00:00Z', first_contact_at:'2025-09-08', left_at:null,            status_history: hist(['lead','2025-09-08'],['trial_done','2025-09-13'],['active','2025-09-17']) },
  { id:'s20', name:'Воробьёва Елена',     contact:'+79284445566',    grade:'11', group_id:'g5', format:'group',      crm_status:'active',          price_per_hour:2200, lessons_per_month:8, paid:false, trial_score:53, target_score:82,  source:'Сарафан',  notes:'Хорошо пишет, нужно над грамматикой.',                                             created_at:'2025-09-13T10:00:00Z', first_contact_at:'2025-09-12', left_at:null,            status_history: hist(['lead','2025-09-12'],['trial_done','2025-09-17'],['active','2025-09-21']) },

  // ── ACTIVE (individual) ──
  { id:'s21', name:'Сидорова Анна',       contact:'@sidorova_anya',  grade:'11', group_id:null, format:'individual', crm_status:'active',          price_per_hour:3500, lessons_per_month:6, paid:true,  trial_score:44, target_score:75,  source:'Авито',    notes:'Готовится к профильной математике. Слабое место — задания на геометрию (часть 2).', created_at:'2025-09-12T10:00:00Z', first_contact_at:'2025-09-11', left_at:null,            status_history: hist(['lead','2025-09-11'],['trial_done','2025-09-15'],['active','2025-09-18']) },
  { id:'s22', name:'Громов Алексей',      contact:'+79041231234',    grade:'10', group_id:null, format:'individual', crm_status:'active',          price_per_hour:3000, lessons_per_month:6, paid:true,  trial_score:38, target_score:68,  source:'Профи.ру', notes:'Индивидуальный темп. Нравится разбирать нестандартные задачи.',                    created_at:'2025-10-01T10:00:00Z', first_contact_at:'2025-09-29', left_at:null,            status_history: hist(['lead','2025-09-29'],['trial_done','2025-10-03'],['active','2025-10-07']) },
  { id:'s23', name:'Павлова Светлана',    contact:'@sveta_pavlova',  grade:'11', group_id:null, format:'individual', crm_status:'active',          price_per_hour:4000, lessons_per_month:8, paid:true,  trial_score:65, target_score:95,  source:'Сарафан',  notes:'Призёр олимпиады. Готовится на 100 баллов ЕГЭ.',                                   created_at:'2025-10-15T10:00:00Z', first_contact_at:'2025-10-14', left_at:null,            status_history: hist(['lead','2025-10-14'],['trial_done','2025-10-17'],['active','2025-10-20']) },
  { id:'s24', name:'Васильев Тимур',      contact:'+79139876543',    grade:'11', group_id:null, format:'individual', crm_status:'active',          price_per_hour:3500, lessons_per_month:6, paid:true,  trial_score:57, target_score:84,  source:'Авито',    notes:'Хочет в МГТУ. Нужно усилить часть 2.',                                            created_at:'2025-11-01T10:00:00Z', first_contact_at:'2025-10-30', left_at:null,            status_history: hist(['lead','2025-10-30'],['trial_done','2025-11-03'],['active','2025-11-06']) },
  { id:'s25', name:'Кириллова Юлия',      contact:'@yulya_kirill',   grade:'10', group_id:null, format:'individual', crm_status:'active',          price_per_hour:3000, lessons_per_month:4, paid:true,  trial_score:41, target_score:70,  source:'Telegram', notes:'Начала с нуля. Отличная мотивация.',                                               created_at:'2025-11-10T10:00:00Z', first_contact_at:'2025-11-09', left_at:null,            status_history: hist(['lead','2025-11-09'],['trial_done','2025-11-13'],['active','2025-11-16']) },
  { id:'s26', name:'Дмитриев Сергей',     contact:'+79266667788',    grade:'11', group_id:null, format:'individual', crm_status:'active',          price_per_hour:3500, lessons_per_month:6, paid:false, trial_score:50, target_score:80,  source:'Авито',    notes:'Ещё не оплатил этот месяц. Нужно напомнить.',                                     created_at:'2025-12-01T10:00:00Z', first_contact_at:'2025-11-29', left_at:null,            status_history: hist(['lead','2025-11-29'],['trial_done','2025-12-03'],['active','2025-12-07']) },
  { id:'s27', name:'Антонова Ирина',      contact:'@irina_antonova', grade:'11', group_id:null, format:'individual', crm_status:'active',          price_per_hour:4000, lessons_per_month:8, paid:true,  trial_score:70, target_score:96,  source:'Сарафан',  notes:'Очень сильная ученица. Цель — победа на олимпиаде и 100 баллов.',                  created_at:'2025-12-10T10:00:00Z', first_contact_at:'2025-12-09', left_at:null,            status_history: hist(['lead','2025-12-09'],['trial_done','2025-12-13'],['active','2025-12-16']) },
  { id:'s28', name:'Жуков Артур',         contact:'+79177778899',    grade:'11', group_id:null, format:'individual', crm_status:'active',          price_per_hour:3000, lessons_per_month:4, paid:true,  trial_score:35, target_score:65,  source:'Профи.ру', notes:'Слабая база. Занимаемся с нуля.',                                                  created_at:'2026-01-05T10:00:00Z', first_contact_at:'2026-01-04', left_at:null,            status_history: hist(['lead','2026-01-04'],['trial_done','2026-01-08'],['active','2026-01-12']) },
  { id:'s29', name:'Куликова Карина',     contact:'@karina_kul',     grade:'10', group_id:null, format:'individual', crm_status:'active',          price_per_hour:3000, lessons_per_month:6, paid:true,  trial_score:43, target_score:72,  source:'Авито',    notes:'Хочет поступить на экономфак. Нужна профильная мат.',                             created_at:'2026-01-20T10:00:00Z', first_contact_at:'2026-01-19', left_at:null,            status_history: hist(['lead','2026-01-19'],['trial_done','2026-01-23'],['active','2026-01-27']) },
  { id:'s30', name:'Яковлев Михаил',      contact:'+79351234567',    grade:'11', group_id:null, format:'individual', crm_status:'active',          price_per_hour:3500, lessons_per_month:6, paid:true,  trial_score:60, target_score:88,  source:'Сарафан',  notes:'Второй год готовится. Хороший прогресс.',                                          created_at:'2026-02-01T10:00:00Z', first_contact_at:'2026-01-30', left_at:null,            status_history: hist(['lead','2026-01-30'],['trial_done','2026-02-04'],['active','2026-02-08']) },
  { id:'s31', name:'Назарова Оксана',     contact:'@oksana_naz',     grade:'11', group_id:'g2', format:'group',      crm_status:'active',          price_per_hour:2500, lessons_per_month:8, paid:true,  trial_score:46, target_score:74,  source:'ВКонтакте',notes:'Активна на занятиях. Нужно над самостоятельными работами.',                        created_at:'2025-10-03T10:00:00Z', first_contact_at:'2025-10-02', left_at:null,            status_history: hist(['lead','2025-10-02'],['trial_done','2025-10-07'],['active','2025-10-11']) },
  { id:'s32', name:'Степанов Кирилл',     contact:'+79483214567',    grade:'11', group_id:'g2', format:'group',      crm_status:'active',          price_per_hour:2500, lessons_per_month:8, paid:true,  trial_score:53, target_score:79,  source:'Авито',    notes:'Хороший уровень. Нужны сложные задачи.',                                          created_at:'2025-10-06T10:00:00Z', first_contact_at:'2025-10-05', left_at:null,            status_history: hist(['lead','2025-10-05'],['trial_done','2025-10-10'],['active','2025-10-14']) },
  { id:'s33', name:'Романова Арина',      contact:'@arina_roman',    grade:'9',  group_id:'g3', format:'group',      crm_status:'active',          price_per_hour:2000, lessons_per_month:4, paid:true,  trial_score:22, target_score:34,  source:'Профи.ру', notes:'Занимается с ноября. Видно улучшение.',                                            created_at:'2025-11-05T10:00:00Z', first_contact_at:'2025-11-04', left_at:null,            status_history: hist(['lead','2025-11-04'],['trial_done','2025-11-09'],['active','2025-11-13']) },
  { id:'s34', name:'Соловьёв Андрей',     contact:'+79292345678',    grade:'11', group_id:'g5', format:'group',      crm_status:'active',          price_per_hour:2200, lessons_per_month:8, paid:true,  trial_score:58, target_score:86,  source:'Telegram', notes:'Любит литературу. Русский идёт легко.',                                           created_at:'2025-10-12T10:00:00Z', first_contact_at:'2025-10-11', left_at:null,            status_history: hist(['lead','2025-10-11'],['trial_done','2025-10-16'],['active','2025-10-20']) },
  { id:'s35', name:'Крылова Дина',        contact:'@dina_kryl',      grade:'11', group_id:'g5', format:'group',      crm_status:'active',          price_per_hour:2200, lessons_per_month:8, paid:true,  trial_score:51, target_score:80,  source:'Авито',    notes:'Хороший потенциал. Нужно над ударениями.',                                         created_at:'2025-10-15T10:00:00Z', first_contact_at:'2025-10-14', left_at:null,            status_history: hist(['lead','2025-10-14'],['trial_done','2025-10-19'],['active','2025-10-23']) },
  { id:'s36', name:'Тихонов Вадим',       contact:'+79162223344',    grade:'11', group_id:'g4', format:'group',      crm_status:'active',          price_per_hour:2700, lessons_per_month:8, paid:true,  trial_score:48, target_score:77,  source:'Профи.ру', notes:'Физика идёт хорошо, задачи на оптику слабые.',                                     created_at:'2025-10-18T10:00:00Z', first_contact_at:'2025-10-17', left_at:null,            status_history: hist(['lead','2025-10-17'],['trial_done','2025-10-22'],['active','2025-10-26']) },
  { id:'s37', name:'Зайцева Катерина',    contact:'@kate_zaitseva',  grade:'11', group_id:'g1', format:'group',      crm_status:'active',          price_per_hour:2500, lessons_per_month:8, paid:true,  trial_score:59, target_score:83,  source:'Сарафан',  notes:'Занимается с октября. Хорошо прогрессирует.',                                      created_at:'2025-10-21T10:00:00Z', first_contact_at:'2025-10-20', left_at:null,            status_history: hist(['lead','2025-10-20'],['trial_done','2025-10-25'],['active','2025-10-29']) },
  { id:'s38', name:'Герасимов Антон',     contact:'+79057778899',    grade:'10', group_id:null, format:'individual', crm_status:'active',          price_per_hour:3000, lessons_per_month:4, paid:true,  trial_score:33, target_score:62,  source:'Авито',    notes:'10 класс, начали заранее. Хорошая мотивация.',                                     created_at:'2026-02-10T10:00:00Z', first_contact_at:'2026-02-09', left_at:null,            status_history: hist(['lead','2026-02-09'],['trial_done','2026-02-13'],['active','2026-02-17']) },

  // ── TRIALS ──
  { id:'s39', name:'Медведева Юля',       contact:'@julia_med',      grade:'11', group_id:'g1', format:'group',      crm_status:'trial_scheduled', price_per_hour:null, lessons_per_month:null, paid:false, trial_score:null, target_score:null, source:'Авито',    notes:'Пробное занятие назначено на следующую неделю.',                                   created_at:daysAgo(5)+'T10:00:00Z', first_contact_at:daysAgo(7), left_at:null,             status_history: hist(['lead',daysAgo(7)],['trial_scheduled',daysAgo(4)]) },
  { id:'s40', name:'Кочетов Глеб',        contact:'+79283334455',    grade:'11', group_id:null, format:'individual', crm_status:'trial_scheduled', price_per_hour:null, lessons_per_month:null, paid:false, trial_score:null, target_score:null, source:'Профи.ру', notes:'Хочет индивидуальные. Пробное на этой неделе.',                                    created_at:daysAgo(3)+'T10:00:00Z', first_contact_at:daysAgo(4), left_at:null,             status_history: hist(['lead',daysAgo(4)],['trial_scheduled',daysAgo(2)]) },
  { id:'s41', name:'Исаева Полина',       contact:'@polina_isaeva',  grade:'9',  group_id:'g3', format:'group',      crm_status:'trial_done',      price_per_hour:null, lessons_per_month:null, paid:false, trial_score:25, target_score:40,   source:'Telegram', notes:'Пробник прошёл. Думает о записи.',                                                 created_at:daysAgo(8)+'T10:00:00Z', first_contact_at:daysAgo(10), left_at:null,            status_history: hist(['lead',daysAgo(10)],['trial_scheduled',daysAgo(7)],['trial_done',daysAgo(3)]) },
  { id:'s42', name:'Панов Артём',         contact:'+79194445566',    grade:'11', group_id:'g4', format:'group',      crm_status:'trial_done',      price_per_hour:null, lessons_per_month:null, paid:false, trial_score:42, target_score:73,   source:'Авито',    notes:'Понравилось пробное. Хочет в группу физики.',                                     created_at:daysAgo(6)+'T10:00:00Z', first_contact_at:daysAgo(8), left_at:null,             status_history: hist(['lead',daysAgo(8)],['trial_scheduled',daysAgo(5)],['trial_done',daysAgo(1)]) },
  { id:'s43', name:'Осипова Наташа',      contact:'@natasha_osip',   grade:'11', group_id:null, format:'individual', crm_status:'trial_scheduled', price_per_hour:null, lessons_per_month:null, paid:false, trial_score:null, target_score:null, source:'Сарафан',  notes:'Рекомендация от Смирновой. Ждёт пробного.',                                        created_at:daysAgo(2)+'T10:00:00Z', first_contact_at:daysAgo(3), left_at:null,             status_history: hist(['lead',daysAgo(3)],['trial_scheduled',daysAgo(1)]) },
  { id:'s44', name:'Рябов Денис',         contact:'+79065556677',    grade:'10', group_id:null, format:'individual', crm_status:'trial_done',      price_per_hour:null, lessons_per_month:null, paid:false, trial_score:36, target_score:66,   source:'ВКонтакте',notes:'Пробное прошло нормально. Цена показалась высокой.',                               created_at:daysAgo(9)+'T10:00:00Z', first_contact_at:daysAgo(11), left_at:null,            status_history: hist(['lead',daysAgo(11)],['trial_scheduled',daysAgo(8)],['trial_done',daysAgo(4)]) },
  { id:'s45', name:'Тарасова Маша',       contact:'@masha_tar',      grade:'11', group_id:'g5', format:'group',      crm_status:'trial_scheduled', price_per_hour:null, lessons_per_month:null, paid:false, trial_score:null, target_score:null, source:'Авито',    notes:'Хочет ЕГЭ по русскому 80+.',                                                      created_at:daysAgo(4)+'T10:00:00Z', first_contact_at:daysAgo(5), left_at:null,             status_history: hist(['lead',daysAgo(5)],['trial_scheduled',daysAgo(3)]) },
  { id:'s46', name:'Никифоров Саша',      contact:'+79381234567',    grade:'11', group_id:'g2', format:'group',      crm_status:'trial_done',      price_per_hour:null, lessons_per_month:null, paid:false, trial_score:54, target_score:82,   source:'Профи.ру', notes:'Сильный ученик. Пробное прошло отлично.',                                          created_at:daysAgo(7)+'T10:00:00Z', first_contact_at:daysAgo(9), left_at:null,             status_history: hist(['lead',daysAgo(9)],['trial_scheduled',daysAgo(6)],['trial_done',daysAgo(2)]) },

  // ── LEFT (was active, then left) ──
  { id:'s47', name:'Фомина Алла',         contact:'@alla_fom',       grade:'11', group_id:null, format:'individual', crm_status:'left',            price_per_hour:3000, lessons_per_month:6, paid:false, trial_score:48, target_score:72,  source:'Авито',    notes:'Взяла паузу из-за болезни. Планирует вернуться.',                                  created_at:'2025-10-20T10:00:00Z', first_contact_at:'2025-10-18', left_at:'2026-02-01',    status_history: hist(['lead','2025-10-18'],['trial_done','2025-10-23'],['active','2025-10-27'],['left','2026-02-01']) },
  { id:'s48', name:'Казаков Виктор',      contact:'+79471112233',    grade:'11', group_id:'g1', format:'group',      crm_status:'left',            price_per_hour:2500, lessons_per_month:8, paid:false, trial_score:35, target_score:65,  source:'Сарафан',  notes:'Ушёл к другому репетитору.',                                                       created_at:'2025-10-25T10:00:00Z', first_contact_at:'2025-10-24', left_at:'2026-01-15',    status_history: hist(['lead','2025-10-24'],['trial_done','2025-10-29'],['active','2025-11-03'],['left','2026-01-15']) },
  { id:'s49', name:'Громова Лиза',        contact:'@liza_gromova',   grade:'9',  group_id:'g3', format:'group',      crm_status:'left',            price_per_hour:2000, lessons_per_month:4, paid:false, trial_score:19, target_score:33,  source:'ВКонтакте',notes:'Переехала в другой город.',                                                         created_at:'2025-11-01T10:00:00Z', first_contact_at:'2025-10-30', left_at:'2026-01-20',    status_history: hist(['lead','2025-10-30'],['trial_done','2025-11-04'],['active','2025-11-08'],['left','2026-01-20']) },
  { id:'s50', name:'Ефимов Константин',   contact:'+79184445566',    grade:'11', group_id:null, format:'individual', crm_status:'left',            price_per_hour:3500, lessons_per_month:6, paid:false, trial_score:40, target_score:70,  source:'Профи.ру', notes:'Не смог совмещать с секциями.',                                                    created_at:'2025-11-15T10:00:00Z', first_contact_at:'2025-11-14', left_at:'2026-02-10',    status_history: hist(['lead','2025-11-14'],['trial_done','2025-11-19'],['active','2025-11-23'],['left','2026-02-10']) },
  { id:'s51', name:'Лукина Оля',          contact:'@olya_lukin',     grade:'10', group_id:null, format:'individual', crm_status:'left',            price_per_hour:3000, lessons_per_month:4, paid:false, trial_score:37, target_score:65,  source:'Авито',    notes:'Семейные обстоятельства.',                                                         created_at:'2025-12-01T10:00:00Z', first_contact_at:'2025-11-30', left_at:'2026-03-01',    status_history: hist(['lead','2025-11-30'],['trial_done','2025-12-05'],['active','2025-12-09'],['left','2026-03-01']) },

  // ── EXAM PASSED ──
  { id:'s52', name:'Волков Игорь',        contact:'+79991112233',    grade:'11', group_id:null, format:'individual', crm_status:'exam_passed',     price_per_hour:3000, lessons_per_month:8, paid:true,  trial_score:49, target_score:85,  source:'Сарафан',  notes:'Сдал на 89 баллов!',                                                               created_at:'2025-09-15T10:00:00Z', first_contact_at:'2025-09-14', left_at:'2025-06-30',    status_history: hist(['lead','2025-09-14'],['trial_done','2025-09-19'],['active','2025-09-23'],['exam_passed','2025-06-30']) },
  { id:'s53', name:'Орлова Катя',         contact:'@katya_orl',      grade:'11', group_id:'g1', format:'group',      crm_status:'exam_passed',     price_per_hour:2500, lessons_per_month:8, paid:true,  trial_score:55, target_score:80,  source:'Авито',    notes:'Сдала на 82 балла. Рада результату.',                                              created_at:'2025-09-10T10:00:00Z', first_contact_at:'2025-09-09', left_at:'2025-06-28',    status_history: hist(['lead','2025-09-09'],['trial_done','2025-09-14'],['active','2025-09-18'],['exam_passed','2025-06-28']) },
  { id:'s54', name:'Беляев Стас',         contact:'+79053334455',    grade:'11', group_id:'g4', format:'group',      crm_status:'exam_passed',     price_per_hour:2700, lessons_per_month:8, paid:true,  trial_score:62, target_score:88,  source:'Профи.ру', notes:'Физика 91 балл! Поступил в МФТИ.',                                                 created_at:'2025-09-05T10:00:00Z', first_contact_at:'2025-09-04', left_at:'2025-06-27',    status_history: hist(['lead','2025-09-04'],['trial_done','2025-09-09'],['active','2025-09-13'],['exam_passed','2025-06-27']) },
  { id:'s55', name:'Крутова Света',       contact:'@sveta_krutova',  grade:'11', group_id:'g5', format:'group',      crm_status:'exam_passed',     price_per_hour:2200, lessons_per_month:8, paid:true,  trial_score:60, target_score:85,  source:'Сарафан',  notes:'Русский 88. Написала отличное эссе.',                                              created_at:'2025-09-08T10:00:00Z', first_contact_at:'2025-09-07', left_at:'2025-06-28',    status_history: hist(['lead','2025-09-07'],['trial_done','2025-09-12'],['active','2025-09-16'],['exam_passed','2025-06-28']) },
  { id:'s56', name:'Семёнов Павел',       contact:'+79165556677',    grade:'11', group_id:'g2', format:'group',      crm_status:'exam_passed',     price_per_hour:2500, lessons_per_month:8, paid:true,  trial_score:45, target_score:74,  source:'Авито',    notes:'Сдал на 76 баллов. Доволен.',                                                      created_at:'2025-09-11T10:00:00Z', first_contact_at:'2025-09-10', left_at:'2025-06-29',    status_history: hist(['lead','2025-09-10'],['trial_done','2025-09-15'],['active','2025-09-19'],['exam_passed','2025-06-29']) },

  // ── LEADS ──
  { id:'s57', name:'Широков Денис',       contact:'@denis_shir',     grade:'11', group_id:null, format:'individual', crm_status:'lead',            price_per_hour:null, lessons_per_month:null, paid:false, trial_score:null, target_score:null, source:'Авито',    notes:'Написал вчера. Хочет на 85+.',                                                     created_at:daysAgo(1)+'T10:00:00Z', first_contact_at:daysAgo(1), left_at:null,             status_history: hist(['lead',daysAgo(1)]) },
  { id:'s58', name:'Жданова Вера',        contact:'+79241113344',    grade:'11', group_id:null, format:'group',      crm_status:'lead',            price_per_hour:null, lessons_per_month:null, paid:false, trial_score:null, target_score:null, source:'ВКонтакте',notes:'Ищет группу по математике.',                                                        created_at:daysAgo(2)+'T10:00:00Z', first_contact_at:daysAgo(2), left_at:null,             status_history: hist(['lead',daysAgo(2)]) },
  { id:'s59', name:'Ершов Кирилл',        contact:'@kirill_ershov',  grade:'10', group_id:null, format:'individual', crm_status:'lead',            price_per_hour:null, lessons_per_month:null, paid:false, trial_score:null, target_score:null, source:'Профи.ру', notes:'Пришёл через Профи. Хочет начать с нового учебного года.',                         created_at:daysAgo(3)+'T10:00:00Z', first_contact_at:daysAgo(3), left_at:null,             status_history: hist(['lead',daysAgo(3)]) },
  { id:'s60', name:'Миронова Алина',      contact:'+79358889900',    grade:'9',  group_id:null, format:'group',      crm_status:'lead',            price_per_hour:null, lessons_per_month:null, paid:false, trial_score:null, target_score:null, source:'Сарафан',  notes:'Рекомендация от Таrasова. Интересует ОГЭ.',                                        created_at:daysAgo(4)+'T10:00:00Z', first_contact_at:daysAgo(4), left_at:null,             status_history: hist(['lead',daysAgo(4)]) },
  { id:'s61', name:'Рогов Игорь',         contact:'@igor_rogov',     grade:'11', group_id:null, format:'individual', crm_status:'lead',            price_per_hour:null, lessons_per_month:null, paid:false, trial_score:null, target_score:null, source:'Telegram', notes:'Пишет в Telegram. Уточняет расписание.',                                           created_at:daysAgo(5)+'T10:00:00Z', first_contact_at:daysAgo(5), left_at:null,             status_history: hist(['lead',daysAgo(5)]) },
  { id:'s62', name:'Харитонова Надя',     contact:'+79059994411',    grade:'11', group_id:null, format:'group',      crm_status:'lead',            price_per_hour:null, lessons_per_month:null, paid:false, trial_score:null, target_score:null, source:'Авито',    notes:'Нашла объявление на Авито. Спрашивала про ЕГЭ по русскому.',                      created_at:daysAgo(6)+'T10:00:00Z', first_contact_at:daysAgo(6), left_at:null,             status_history: hist(['lead',daysAgo(6)]) },

  // ── MORE ACTIVE (added Nov 2025 – Mar 2026) ──
  { id:'s63', name:'Волкова Алиса',       contact:'@alisa_volkova',  grade:'11', group_id:'g1', format:'group',      crm_status:'active',          price_per_hour:2500, lessons_per_month:8, paid:true,  trial_score:50, target_score:78,  source:'Telegram', notes:'Добавилась в ноябре. Быстро догнала группу.',                                      created_at:'2025-11-20T10:00:00Z', first_contact_at:'2025-11-19', left_at:null,            status_history: hist(['lead','2025-11-19'],['trial_done','2025-11-23'],['active','2025-11-27']) },
  { id:'s64', name:'Зубков Максим',       contact:'+79182223344',    grade:'11', group_id:'g2', format:'group',      crm_status:'active',          price_per_hour:2500, lessons_per_month:8, paid:true,  trial_score:54, target_score:81,  source:'Авито',    notes:'Хороший уровень. Учится с декабря.',                                               created_at:'2025-12-03T10:00:00Z', first_contact_at:'2025-12-02', left_at:null,            status_history: hist(['lead','2025-12-02'],['trial_done','2025-12-06'],['active','2025-12-10']) },
  { id:'s65', name:'Петрова Алина',       contact:'@alina_petrova',  grade:'9',  group_id:'g3', format:'group',      crm_status:'active',          price_per_hour:2000, lessons_per_month:4, paid:true,  trial_score:27, target_score:39,  source:'Профи.ру', notes:'Пришла в январе. Активная ученица.',                                               created_at:'2026-01-10T10:00:00Z', first_contact_at:'2026-01-09', left_at:null,            status_history: hist(['lead','2026-01-09'],['trial_done','2026-01-13'],['active','2026-01-17']) },
  { id:'s66', name:'Сорокина Вика',       contact:'+79364445566',    grade:'11', group_id:'g5', format:'group',      crm_status:'active',          price_per_hour:2200, lessons_per_month:8, paid:true,  trial_score:54, target_score:83,  source:'Сарафан',  notes:'Хочет поступить в журналистику. Русский идёт хорошо.',                            created_at:'2026-01-15T10:00:00Z', first_contact_at:'2026-01-14', left_at:null,            status_history: hist(['lead','2026-01-14'],['trial_done','2026-01-18'],['active','2026-01-22']) },
  { id:'s67', name:'Чернов Артём',        contact:'@art_chernov',    grade:'11', group_id:'g4', format:'group',      crm_status:'active',          price_per_hour:2700, lessons_per_month:8, paid:true,  trial_score:47, target_score:76,  source:'Авито',    notes:'Занимается с февраля. Хороший потенциал.',                                         created_at:'2026-02-03T10:00:00Z', first_contact_at:'2026-02-02', left_at:null,            status_history: hist(['lead','2026-02-02'],['trial_done','2026-02-06'],['active','2026-02-10']) },
  { id:'s68', name:'Лисицына Оля',        contact:'+79291112233',    grade:'11', group_id:null, format:'individual', crm_status:'active',          price_per_hour:3500, lessons_per_month:6, paid:true,  trial_score:63, target_score:91,  source:'Сарафан',  notes:'Целеустремлённая. Готовится на 90+.',                                              created_at:'2026-02-20T10:00:00Z', first_contact_at:'2026-02-19', left_at:null,            status_history: hist(['lead','2026-02-19'],['trial_done','2026-02-23'],['active','2026-02-27']) },
  { id:'s69', name:'Щербаков Никита',     contact:'@nikita_sher',    grade:'10', group_id:null, format:'individual', crm_status:'active',          price_per_hour:3000, lessons_per_month:4, paid:true,  trial_score:38, target_score:67,  source:'Профи.ру', notes:'10 класс, отличная база. Думает о МГТУ.',                                          created_at:'2026-03-01T10:00:00Z', first_contact_at:'2026-02-28', left_at:null,            status_history: hist(['lead','2026-02-28'],['trial_done','2026-03-04'],['active','2026-03-08']) },
  { id:'s70', name:'Потапова Евгения',    contact:'+79156667788',    grade:'11', group_id:'g1', format:'group',      crm_status:'active',          price_per_hour:2500, lessons_per_month:8, paid:true,  trial_score:56, target_score:84,  source:'Telegram', notes:'Присоединилась в марте. Хорошая мотивация.',                                       created_at:'2026-03-10T10:00:00Z', first_contact_at:'2026-03-09', left_at:null,            status_history: hist(['lead','2026-03-09'],['trial_done','2026-03-13'],['active','2026-03-17']) },
  { id:'s71', name:'Гусев Роман',         contact:'@roman_gus',      grade:'11', group_id:'g2', format:'group',      crm_status:'active',          price_per_hour:2500, lessons_per_month:8, paid:false, trial_score:49, target_score:77,  source:'Авито',    notes:'Апрельский ученик. Ещё не оплатил текущий месяц.',                                 created_at:'2026-04-01T10:00:00Z', first_contact_at:'2026-03-31', left_at:null,            status_history: hist(['lead','2026-03-31'],['trial_done','2026-04-04'],['active','2026-04-08']) },
  { id:'s72', name:'Давыдова Светлана',   contact:'+79487778899',    grade:'11', group_id:null, format:'individual', crm_status:'active',          price_per_hour:3500, lessons_per_month:6, paid:true,  trial_score:61, target_score:89,  source:'Сарафан',  notes:'Начала в апреле. Сильный уровень.',                                               created_at:'2026-04-10T10:00:00Z', first_contact_at:'2026-04-09', left_at:null,            status_history: hist(['lead','2026-04-09'],['trial_done','2026-04-13'],['active','2026-04-17']) },
  { id:'s73', name:'Мартынов Глеб',       contact:'@gleb_mart',      grade:'11', group_id:null, format:'individual', crm_status:'refused',         price_per_hour:null, lessons_per_month:null, paid:false, trial_score:38, target_score:70, source:'Авито',    notes:'Попробовал, решил пойти к другому репетитору.',                                   created_at:'2025-10-10T10:00:00Z', first_contact_at:'2025-10-09', left_at:'2025-10-20',    status_history: hist(['lead','2025-10-09'],['trial_scheduled','2025-10-12'],['trial_done','2025-10-17'],['refused','2025-10-20']) },
  { id:'s74', name:'Алексеева Марина',    contact:'+79303334455',    grade:'11', group_id:null, format:'individual', crm_status:'refused',         price_per_hour:null, lessons_per_month:null, paid:false, trial_score:null, target_score:80, source:'ВКонтакте',notes:'Пообщались, не устроила цена.',                                                   created_at:'2025-11-25T10:00:00Z', first_contact_at:'2025-11-25', left_at:'2025-11-28',    status_history: hist(['lead','2025-11-25'],['refused','2025-11-28']) },
  { id:'s75', name:'Семёнова Наташа',     contact:'@natasha_sem',    grade:'9',  group_id:null, format:'group',      crm_status:'trial_scheduled', price_per_hour:null, lessons_per_month:null, paid:false, trial_score:null, target_score:null, source:'Профи.ру', notes:'Пробное назначено на следующую неделю. ОГЭ.',                                     created_at:daysAgo(4)+'T10:00:00Z', first_contact_at:daysAgo(5), left_at:null,             status_history: hist(['lead',daysAgo(5)],['trial_scheduled',daysAgo(3)]) },
];

// ─── Payments (50+) ────────────────────────────────────────────────────────────
const payments = (() => {
  const ps = [];
  let idx = 1;

  function pay(studentId, dateStr, amount, method, subEndDays) {
    const sub_end = subEndDays != null ? daysFromNow(subEndDays) : null;
    ps.push({ id: `p${idx++}`, student_id: studentId, date: dateStr, amount, method: method||'СБП', period: dateStr.slice(0,7), sub_end, created_at: dateStr+'T10:00:00Z' });
  }

  // Sep 2025
  pay('s1','2025-09-13',20000,'СБП',30);       pay('s2','2025-09-14',20000,'Перевод',30);
  pay('s3','2025-09-15',20000,'СБП',30);        pay('s4','2025-09-16',20000,'Наличные',30);
  pay('s5','2025-09-17',20000,'СБП',30);        pay('s6','2025-09-13',20000,'Перевод',30);
  pay('s7','2025-09-14',20000,'СБП',30);        pay('s8','2025-09-15',20000,'Наличные',30);
  pay('s9','2025-09-16',20000,'СБП',30);        pay('s10','2025-09-14',8000,'СБП',30);
  pay('s11','2025-09-15',8000,'Перевод',30);    pay('s12','2025-09-16',8000,'СБП',30);
  pay('s15','2025-09-13',21600,'СБП',30);       pay('s16','2025-09-14',21600,'Перевод',30);
  pay('s17','2025-09-15',21600,'Наличные',30);  pay('s18','2025-09-13',17600,'СБП',30);
  pay('s19','2025-09-14',17600,'Перевод',30);   pay('s21','2025-09-18',21000,'СБП',30);

  // Oct 2025
  pay('s1','2025-10-12',20000,'СБП',15);        pay('s2','2025-10-13',20000,'Перевод',15);
  pay('s3','2025-10-14',20000,'СБП',15);        pay('s4','2025-10-15',20000,'Наличные',15);
  pay('s5','2025-10-16',20000,'СБП',15);        pay('s6','2025-10-12',20000,'Перевод',15);
  pay('s7','2025-10-13',20000,'СБП',15);        pay('s10','2025-10-14',8000,'СБП',15);
  pay('s21','2025-10-16',21000,'Перевод',15);   pay('s22','2025-10-07',18000,'СБП',15);
  pay('s23','2025-10-20',32000,'Перевод',15);   pay('s31','2025-10-11',20000,'СБП',15);
  pay('s32','2025-10-14',20000,'СБП',15);

  // Nov 2025
  pay('s1','2025-11-11',20000,'СБП',10);        pay('s2','2025-11-12',20000,'Перевод',10);
  pay('s6','2025-11-11',20000,'СБП',10);        pay('s7','2025-11-12',20000,'Перевод',10);
  pay('s21','2025-11-16',21000,'СБП',10);       pay('s22','2025-11-07',18000,'Наличные',10);
  pay('s23','2025-11-20',32000,'Перевод',10);   pay('s24','2025-11-06',21000,'СБП',10);
  pay('s25','2025-11-16',12000,'Перевод',10);   pay('s34','2025-11-20',17600,'СБП',10);
  pay('s35','2025-11-23',17600,'Перевод',10);   pay('s36','2025-11-26',21600,'СБП',10);
  pay('s37','2025-11-29',20000,'Наличные',10);

  // Dec 2025
  pay('s1','2025-12-10',20000,'СБП',5);         pay('s2','2025-12-11',20000,'Перевод',5);
  pay('s3','2025-12-12',20000,'СБП',5);         pay('s6','2025-12-10',20000,'Перевод',5);
  pay('s21','2025-12-15',21000,'СБП',5);        pay('s23','2025-12-19',32000,'Перевод',5);
  pay('s24','2025-12-06',21000,'СБП',5);        pay('s26','2025-12-07',21000,'Перевод',5);
  pay('s27','2025-12-16',32000,'СБП',5);        pay('s34','2025-12-20',17600,'Перевод',5);
  pay('s37','2025-12-28',20000,'СБП',5);

  // Jan 2026
  pay('s1','2026-01-12',20000,'СБП',10);        pay('s2','2026-01-13',20000,'Перевод',10);
  pay('s3','2026-01-14',20000,'СБП',10);        pay('s6','2026-01-12',20000,'Перевод',10);
  pay('s21','2026-01-15',21000,'СБП',10);       pay('s23','2026-01-19',32000,'Перевод',10);
  pay('s27','2026-01-17',32000,'СБП',10);       pay('s28','2026-01-12',12000,'Перевод',10);
  pay('s29','2026-01-27',18000,'СБП',10);

  // Feb 2026
  pay('s1','2026-02-11',20000,'СБП',8);         pay('s2','2026-02-12',20000,'Перевод',8);
  pay('s3','2026-02-13',20000,'СБП',8);         pay('s21','2026-02-16',21000,'Перевод',8);
  pay('s23','2026-02-20',32000,'СБП',8);        pay('s27','2026-02-18',32000,'Перевод',8);
  pay('s29','2026-02-27',18000,'СБП',8);        pay('s30','2026-02-08',21000,'Перевод',8);
  pay('s38','2026-02-17',12000,'СБП',8);

  // Mar 2026
  pay('s1','2026-03-12',20000,'СБП',5);         pay('s2','2026-03-13',20000,'Перевод',5);
  pay('s3','2026-03-14',20000,'СБП',5);         pay('s21','2026-03-17',21000,'Перевод',5);
  pay('s23','2026-03-21',32000,'СБП',5);        pay('s27','2026-03-19',32000,'Перевод',5);
  pay('s30','2026-03-09',21000,'СБП',5);

  // Apr 2026
  pay('s1','2026-04-11',20000,'СБП',3);         pay('s2','2026-04-12',20000,'Перевод',3);
  pay('s3','2026-04-13',20000,'СБП',3);         pay('s21','2026-04-16',21000,'Перевод',3);
  pay('s23','2026-04-20',32000,'СБП',3);        pay('s27','2026-04-18',32000,'Перевод',3);

  // May 2026 (current month)
  pay('s1', daysAgo(12), 20000,'СБП', 18);      pay('s2', daysAgo(10), 20000,'Перевод', 20);
  pay('s3', daysAgo(9),  20000,'СБП', 21);      pay('s5', daysAgo(11), 20000,'Наличные', 19);
  pay('s21',daysAgo(8),  21000,'СБП', 22);      pay('s23',daysAgo(6),  32000,'Перевод', 24);

  return ps;
})();

// ─── Expenses (20+) ───────────────────────────────────────────────────────────
const expenses = [
  { id:'e1',  date:'2025-09-05', category:'Реклама',      amount:3500,  note:'Авито Про подписка',         channel:'Авито',     created_at:'2025-09-05T10:00:00Z' },
  { id:'e2',  date:'2025-09-10', category:'Платформа',    amount:990,   note:'Zoom подписка',              channel:'',          created_at:'2025-09-10T10:00:00Z' },
  { id:'e3',  date:'2025-09-15', category:'Материалы',    amount:2400,  note:'Учебники Шестаков ЕГЭ',      channel:'',          created_at:'2025-09-15T10:00:00Z' },
  { id:'e4',  date:'2025-09-20', category:'Реклама',      amount:2500,  note:'Таргет ВКонтакте сентябрь',  channel:'ВКонтакте', created_at:'2025-09-20T10:00:00Z' },
  { id:'e5',  date:'2025-10-05', category:'Реклама',      amount:3500,  note:'Авито Про октябрь',           channel:'Авито',     created_at:'2025-10-05T10:00:00Z' },
  { id:'e6',  date:'2025-10-10', category:'Платформа',    amount:990,   note:'Zoom октябрь',               channel:'',          created_at:'2025-10-10T10:00:00Z' },
  { id:'e7',  date:'2025-10-15', category:'Реклама',      amount:2000,  note:'Telegram Ads октябрь',        channel:'Telegram',  created_at:'2025-10-15T10:00:00Z' },
  { id:'e8',  date:'2025-10-25', category:'Реклама',      amount:1500,  note:'Профи.ру подписка',           channel:'Профи.ру',  created_at:'2025-10-25T10:00:00Z' },
  { id:'e9',  date:'2025-11-05', category:'Реклама',      amount:3500,  note:'Авито Про ноябрь',            channel:'Авито',     created_at:'2025-11-05T10:00:00Z' },
  { id:'e10', date:'2025-11-08', category:'Платформа',    amount:990,   note:'Zoom ноябрь',                channel:'',          created_at:'2025-11-08T10:00:00Z' },
  { id:'e11', date:'2025-11-12', category:'Материалы',    amount:1200,  note:'Распечатка вариантов ЕГЭ',   channel:'',          created_at:'2025-11-12T10:00:00Z' },
  { id:'e12', date:'2025-12-05', category:'Реклама',      amount:3500,  note:'Авито Про декабрь',           channel:'Авито',     created_at:'2025-12-05T10:00:00Z' },
  { id:'e13', date:'2025-12-08', category:'Платформа',    amount:990,   note:'Zoom декабрь',               channel:'',          created_at:'2025-12-08T10:00:00Z' },
  { id:'e14', date:'2025-12-20', category:'Оборудование', amount:4500,  note:'Графический планшет Wacom',   channel:'',          created_at:'2025-12-20T10:00:00Z' },
  { id:'e15', date:'2026-01-05', category:'Реклама',      amount:3500,  note:'Авито Про январь',            channel:'Авито',     created_at:'2026-01-05T10:00:00Z' },
  { id:'e16', date:'2026-01-07', category:'Платформа',    amount:990,   note:'Zoom январь',                channel:'',          created_at:'2026-01-07T10:00:00Z' },
  { id:'e17', date:'2026-01-15', category:'Материалы',    amount:1800,  note:'Сборники задач ОГЭ',          channel:'',          created_at:'2026-01-15T10:00:00Z' },
  { id:'e18', date:'2026-02-05', category:'Реклама',      amount:3500,  note:'Авито Про февраль',           channel:'Авито',     created_at:'2026-02-05T10:00:00Z' },
  { id:'e19', date:'2026-02-08', category:'Платформа',    amount:990,   note:'Zoom февраль',               channel:'',          created_at:'2026-02-08T10:00:00Z' },
  { id:'e20', date:'2026-02-14', category:'Реклама',      amount:2500,  note:'ВКонтакте Реклама февраль',   channel:'ВКонтакте', created_at:'2026-02-14T10:00:00Z' },
  { id:'e21', date:'2026-03-05', category:'Реклама',      amount:3500,  note:'Авито Про март',              channel:'Авито',     created_at:'2026-03-05T10:00:00Z' },
  { id:'e22', date:'2026-03-08', category:'Платформа',    amount:990,   note:'Zoom март',                  channel:'',          created_at:'2026-03-08T10:00:00Z' },
  { id:'e23', date:'2026-03-15', category:'Прочее',       amount:3200,  note:'Доп. освещение для занятий',  channel:'',          created_at:'2026-03-15T10:00:00Z' },
  { id:'e24', date:'2026-04-05', category:'Реклама',      amount:3500,  note:'Авито Про апрель',            channel:'Авито',     created_at:'2026-04-05T10:00:00Z' },
  { id:'e25', date:'2026-04-08', category:'Платформа',    amount:990,   note:'Zoom апрель',                channel:'',          created_at:'2026-04-08T10:00:00Z' },
  { id:'e26', date:daysAgo(10),  category:'Реклама',      amount:3500,  note:'Авито Про май',               channel:'Авито',     created_at:daysAgo(10)+'T10:00:00Z' },
  { id:'e27', date:daysAgo(8),   category:'Материалы',    amount:1200,  note:'Распечатка вариантов',        channel:'',          created_at:daysAgo(8)+'T10:00:00Z' },
  { id:'e28', date:daysAgo(7),   category:'Платформа',    amount:990,   note:'Zoom май',                   channel:'',          created_at:daysAgo(7)+'T10:00:00Z' },
];

// ─── Lessons (60+) ────────────────────────────────────────────────────────────
const lessons = (() => {
  const ls = [];
  let idx = 1;

  function lesson(groupId, date, startTime, topic, attendance, notes) {
    ls.push({
      id: `l${idx++}`,
      group_id: groupId,
      date,
      start_time: startTime,
      duration: 60,
      topic,
      student_attendance: attendance || [],
      notes: notes || '',
      created_at: date + 'T' + startTime + ':00Z',
    });
  }

  function att(studentId, present, note) {
    return { student_id: studentId, present: present !== false, note: note || '' };
  }

  // g1 — ЕГЭ Мат 11А (s1,s2,s3,s4,s5,s37)
  lesson('g1','2025-09-15','18:00','Входная диагностика',[att('s1'),att('s2'),att('s3'),att('s4'),att('s5')],'Разбор базовых тем');
  lesson('g1','2025-09-22','18:00','Квадратные уравнения и неравенства',[att('s1'),att('s2'),att('s3'),att('s4'),att('s5')],'Все справились');
  lesson('g1','2025-09-29','18:00','Тригонометрия: единичная окружность',[att('s1'),att('s2'),att('s3'),att('s4',false,'Заболел'),att('s5')],'');
  lesson('g1','2025-10-06','18:00','Тригонометрия: основные тождества',[att('s1'),att('s2'),att('s3'),att('s4'),att('s5')],'Хорошо разобрали формулы приведения');
  lesson('g1','2025-10-13','18:00','Тригонометрические уравнения',[att('s1'),att('s2',false,'Болел'),att('s3'),att('s4'),att('s5')],'Артём отсутствовал');
  lesson('g1','2025-10-20','18:00','Производная: правила дифференцирования',[att('s1'),att('s2'),att('s3'),att('s4'),att('s5'),att('s37')],'Добавился новый ученик');
  lesson('g1','2025-11-03','18:00','Производная: задачи на экстремум',[att('s1'),att('s2'),att('s3'),att('s4'),att('s5'),att('s37')],'');
  lesson('g1','2025-11-10','18:00','Интеграл: введение',[att('s1'),att('s2'),att('s3'),att('s4',false,'Пропустил'),att('s5'),att('s37')],'');
  lesson('g1','2025-11-17','18:00','Интеграл: методы вычисления',[att('s1'),att('s2'),att('s3'),att('s4'),att('s5'),att('s37')],'');
  lesson('g1','2025-12-01','18:00','Показательные функции',[att('s1'),att('s2'),att('s3'),att('s4'),att('s5'),att('s37')],'');
  lesson('g1','2025-12-08','18:00','Логарифмы: свойства',[att('s1'),att('s2',false,'Не предупредил'),att('s3'),att('s4'),att('s5'),att('s37')],'');
  lesson('g1','2025-12-15','18:00','Логарифмические уравнения',[att('s1'),att('s2'),att('s3'),att('s4'),att('s5'),att('s37')],'');
  lesson('g1','2026-01-12','18:00','Геометрия: планиметрия',[att('s1'),att('s2'),att('s3'),att('s4'),att('s5'),att('s37')],'');
  lesson('g1','2026-01-19','18:00','Геометрия: стереометрия',[att('s1'),att('s2'),att('s3'),att('s4',false,'Опоздал'),att('s5'),att('s37')],'');
  lesson('g1','2026-02-09','18:00','Разбор пробного варианта',[att('s1'),att('s2'),att('s3'),att('s4'),att('s5'),att('s37')],'Пробный результат улучшился');
  lesson('g1','2026-02-23','18:00','Задачи части 2',[att('s1'),att('s2'),att('s3'),att('s4'),att('s5'),att('s37')],'');
  lesson('g1','2026-03-09','18:00','Теория вероятностей',[att('s1'),att('s2'),att('s3'),att('s4'),att('s5'),att('s37')],'');
  lesson('g1','2026-03-23','18:00','Экономические задачи',[att('s1'),att('s2'),att('s3'),att('s4'),att('s5'),att('s37')],'');
  lesson('g1','2026-04-06','18:00','Финансовая математика',[att('s1'),att('s2'),att('s3'),att('s4'),att('s5'),att('s37')],'');
  lesson('g1',daysAgo(13),'18:00','Тригонометрия: повторение',[att('s1'),att('s2'),att('s3'),att('s4'),att('s5'),att('s37')],'');
  lesson('g1',daysAgo(6), '18:00','Интегралы: задачи ЕГЭ',[att('s1'),att('s2',false,'Снова пропустил'),att('s3'),att('s4'),att('s5'),att('s37')],'Артём снова пропустил');

  // g2 — ЕГЭ Мат 11Б (s6,s7,s8,s9,s31,s32)
  lesson('g2','2025-09-16','17:00','Входная диагностика',[att('s6'),att('s7'),att('s8'),att('s9')],'');
  lesson('g2','2025-09-23','17:00','Степени и логарифмы',[att('s6'),att('s7'),att('s8'),att('s9')],'');
  lesson('g2','2025-10-07','17:00','Тригонометрия: формулы сложения',[att('s6'),att('s7'),att('s8',false,'Болел'),att('s9')],'');
  lesson('g2','2025-10-14','17:00','Тригонометрические уравнения',[att('s6'),att('s7'),att('s8'),att('s9'),att('s31'),att('s32')],'Добавились новые');
  lesson('g2','2025-11-04','17:00','Производная и интеграл',[att('s6'),att('s7'),att('s8'),att('s9'),att('s31'),att('s32')],'');
  lesson('g2','2025-12-02','17:00','Геометрия: планиметрия',[att('s6'),att('s7'),att('s8'),att('s9'),att('s31'),att('s32')],'');
  lesson('g2','2026-01-13','17:00','Геометрия: стереометрия',[att('s6'),att('s7'),att('s8',false,'Не предупредил'),att('s9'),att('s31'),att('s32')],'');
  lesson('g2','2026-02-10','17:00','Разбор сложных задач',[att('s6'),att('s7'),att('s8'),att('s9'),att('s31'),att('s32')],'');
  lesson('g2','2026-03-10','17:00','Теория вероятностей',[att('s6'),att('s7'),att('s8'),att('s9'),att('s31'),att('s32')],'');
  lesson('g2','2026-04-07','17:00','Финансовая математика',[att('s6'),att('s7'),att('s8'),att('s9'),att('s31'),att('s32')],'');
  lesson('g2',daysAgo(12),'17:00','Показательные уравнения',[att('s6'),att('s7'),att('s8'),att('s9'),att('s31'),att('s32')],'');
  lesson('g2',daysAgo(5), '17:00','Задачи части 2',[att('s6'),att('s7'),att('s8',false,'Не пришёл'),att('s9'),att('s31'),att('s32')],'');

  // g3 — ОГЭ Математика 9 (s10,s11,s12,s13,s14,s33)
  lesson('g3','2025-09-20','11:00','Входная диагностика',[att('s10'),att('s11'),att('s12'),att('s13')],'');
  lesson('g3','2025-09-27','11:00','Квадратные уравнения',[att('s10'),att('s11'),att('s12'),att('s13')],'');
  lesson('g3','2025-10-04','11:00','Системы уравнений',[att('s10'),att('s11'),att('s12',false,'Болела'),att('s13')],'');
  lesson('g3','2025-11-01','11:00','Геометрия: окружность',[att('s10'),att('s11'),att('s12'),att('s13'),att('s33')],'');
  lesson('g3','2025-12-06','11:00','Функции и графики',[att('s10'),att('s11'),att('s12'),att('s13'),att('s14'),att('s33')],'');
  lesson('g3','2026-01-10','11:00','Задачи на проценты',[att('s10'),att('s11'),att('s12'),att('s13'),att('s14'),att('s33')],'');
  lesson('g3','2026-02-07','11:00','Вероятность и статистика',[att('s10'),att('s11'),att('s12'),att('s13'),att('s14'),att('s33')],'');
  lesson('g3','2026-03-07','11:00','Разбор пробного варианта',[att('s10'),att('s11'),att('s12'),att('s13'),att('s14'),att('s33')],'');
  lesson('g3','2026-04-04','11:00','Задачи с параметрами',[att('s10'),att('s11'),att('s12'),att('s13'),att('s14'),att('s33')],'');
  lesson('g3',daysAgo(15),'11:00','Квадратные неравенства',[att('s10'),att('s11'),att('s12'),att('s13'),att('s14'),att('s33')],'');
  lesson('g3',daysAgo(8), '11:00','Системы уравнений II',[att('s10'),att('s11'),att('s12'),att('s13'),att('s14',false,'Опоздала'),att('s33')],'');

  // g4 — ЕГЭ Физика 11 (s15,s16,s17,s36)
  lesson('g4','2025-09-15','17:00','Кинематика: равноускоренное движение',[att('s15'),att('s16'),att('s17')],'');
  lesson('g4','2025-09-19','17:00','Динамика: второй закон Ньютона',[att('s15'),att('s16'),att('s17')],'');
  lesson('g4','2025-10-06','17:00','Законы сохранения',[att('s15'),att('s16'),att('s17')],'');
  lesson('g4','2025-10-27','17:00','Колебания и волны',[att('s15'),att('s16'),att('s17'),att('s36')],'');
  lesson('g4','2025-11-10','17:00','Электростатика',[att('s15'),att('s16',false,'Болела'),att('s17'),att('s36')],'');
  lesson('g4','2025-12-08','17:00','Постоянный ток',[att('s15'),att('s16'),att('s17'),att('s36')],'');
  lesson('g4','2026-01-12','17:00','Магнетизм',[att('s15'),att('s16'),att('s17'),att('s36')],'');
  lesson('g4','2026-02-09','17:00','Оптика',[att('s15'),att('s16'),att('s17'),att('s36')],'');
  lesson('g4','2026-03-09','17:00','Квантовая физика',[att('s15'),att('s16'),att('s17'),att('s36')],'');
  lesson('g4',daysAgo(11),'17:00','Разбор вариантов ЕГЭ',[att('s15'),att('s16'),att('s17'),att('s36')],'');

  // g5 — ЕГЭ Русский 11 (s18,s19,s20,s34,s35)
  lesson('g5','2025-09-17','19:00','Орфография: проверяемые гласные',[att('s18'),att('s19'),att('s20')],'');
  lesson('g5','2025-09-19','19:00','Пунктуация: простое предложение',[att('s18'),att('s19'),att('s20')],'');
  lesson('g5','2025-10-08','19:00','Пунктуация: сложное предложение',[att('s18'),att('s19'),att('s20'),att('s34')],'');
  lesson('g5','2025-10-22','19:00','Сочинение: структура и аргументы',[att('s18'),att('s19'),att('s20'),att('s34'),att('s35')],'');
  lesson('g5','2025-11-05','19:00','Сочинение: практика',[att('s18'),att('s19',false,'Болел'),att('s20'),att('s34'),att('s35')],'');
  lesson('g5','2025-12-03','19:00','Грамматика: причастие и деепричастие',[att('s18'),att('s19'),att('s20'),att('s34'),att('s35')],'');
  lesson('g5','2026-01-14','19:00','Сложные случаи правописания',[att('s18'),att('s19'),att('s20'),att('s34'),att('s35')],'');
  lesson('g5','2026-02-11','19:00','Разбор вариантов ЕГЭ',[att('s18'),att('s19'),att('s20'),att('s34'),att('s35')],'');
  lesson('g5','2026-03-11','19:00','Анализ текста',[att('s18'),att('s19'),att('s20'),att('s34'),att('s35')],'');
  lesson('g5',daysAgo(10),'19:00','Итоговый пробник',[att('s18'),att('s19'),att('s20'),att('s34'),att('s35')],'');

  // Upcoming lessons
  lesson('g1', daysFromNow(2), '18:00', 'Интегралы: сложные примеры', [], '');
  lesson('g2', daysFromNow(3), '17:00', 'Тригонометрия: уравнения', [], '');
  lesson('g3', daysFromNow(4), '11:00', 'Системы уравнений III', [], '');
  lesson('g4', daysFromNow(4), '17:00', 'Молекулярная физика', [], '');
  lesson('g5', daysFromNow(2), '19:00', 'Синтаксис: практика', [], '');

  return ls;
})();

// ─── Roles ────────────────────────────────────────────────────────────────────
const ALL_PAGE_IDS = ['dashboard','history','students','crm_students','groups','lessons_cal','homework','income','expenses','analytics','access'];

const roles = [
  { id:'r2', name:'Анна (куратор)',   role_type:'curator',  pages:['curator_dash','groups','lessons_cal','homework'], can_edit:true,  isOwner:false, pin:'1234', created_at:'2025-09-01T10:00:00Z' },
  { id:'r3', name:'Дима (маркетолог)',role_type:'marketer', pages:['students','crm_students'],         can_edit:false, isOwner:false, pin:'5678', created_at:'2025-09-01T10:00:00Z' },
];

// ─── Assistant ↔ Groups ───────────────────────────────────────────────────────
const assistant_groups = [
  { id:'ag1', assistant_id:'r2', group_id:'g1' },
  { id:'ag2', assistant_id:'r2', group_id:'g2' },
];

// ─── Homework Assignments ─────────────────────────────────────────────────────
const homework_assignments = [
  { id:'ha1', group_id:'g1', lesson_id:null, topic:'Тригонометрия: формулы приведения',       description:'Задачи 1–15 из сборника Ященко, стр. 47',          due_date:daysAgo(3),       assigned_at:daysAgo(7)+'T18:30:00Z', hw_type:'detailed', is_advanced:false },
  { id:'ha2', group_id:'g1', lesson_id:null, topic:'Производная: задачи на экстремум',         description:'Вариант 3 полностью, задачи 13–16',                 due_date:daysFromNow(4),   assigned_at:daysAgo(3)+'T18:30:00Z', hw_type:'detailed', is_advanced:false },
  { id:'ha3', group_id:'g2', lesson_id:null, topic:'Показательные уравнения',                  description:'Самостоятельная работа, все 10 задач',               due_date:daysAgo(1),       assigned_at:daysAgo(6)+'T17:30:00Z', hw_type:'brief',    is_advanced:false },
  { id:'ha4', group_id:'g2', lesson_id:null, topic:'Логарифмы: сложные преобразования',        description:'Задачи повышенного уровня, стр. 84–85',             due_date:daysFromNow(6),   assigned_at:daysAgo(2)+'T17:30:00Z', hw_type:'trial',    is_advanced:true  },
];

// ─── Homework Submissions ─────────────────────────────────────────────────────
const homework_submissions = [
  // ha1 (g1, просрочено) — часть сдала, часть нет
  { id:'hs1',  assignment_id:'ha1', student_id:'s1', submission_url:'https://t.me/c/123/456',      source:'telegram', submitted_at:daysAgo(4)+'T20:15:00Z', status:'submitted', score:null,  comment:'',                              errors:[], checked_by:null, checked_at:null },
  { id:'hs2',  assignment_id:'ha1', student_id:'s2', submission_url:'https://vk.com/doc123',       source:'vk',       submitted_at:daysAgo(5)+'T21:30:00Z', status:'submitted', score:null,  comment:'',                              errors:[], checked_by:null, checked_at:null },
  { id:'hs3',  assignment_id:'ha1', student_id:'s3', submission_url:'',                            source:'manual',   submitted_at:null,                    status:'overdue',   score:null,  comment:'',                              errors:[], checked_by:null, checked_at:null },
  { id:'hs4',  assignment_id:'ha1', student_id:'s4', submission_url:'https://t.me/c/123/460',      source:'telegram', submitted_at:daysAgo(3)+'T19:45:00Z', status:'submitted', score:null,  comment:'',                              errors:[], checked_by:null, checked_at:null },
  { id:'hs5',  assignment_id:'ha1', student_id:'s5', submission_url:'https://docs.google.com/123', source:'web',      submitted_at:daysAgo(6)+'T22:00:00Z', status:'checked',   score:84,    comment:'Хорошая работа! Ошибки в знаках.', errors:['Формула sin(π−x) применена неверно','Потеряно решение в тригонометрическом уравнении'], checked_by:'r2', checked_at:daysAgo(5)+'T10:00:00Z' },
  { id:'hs6',  assignment_id:'ha1', student_id:'s37',submission_url:'https://t.me/c/123/461',      source:'telegram', submitted_at:daysAgo(4)+'T20:00:00Z', status:'checked',   score:91,    comment:'Отлично, почти без ошибок.',      errors:['Опечатка в задаче 7'], checked_by:'r2', checked_at:daysAgo(3)+'T11:00:00Z' },

  // ha2 (g1, в срок) — кто-то сдал, кто-то ещё нет
  { id:'hs7',  assignment_id:'ha2', student_id:'s1', submission_url:'https://t.me/c/123/470',      source:'telegram', submitted_at:daysAgo(1)+'T21:00:00Z', status:'submitted', score:null,  comment:'',                              errors:[], checked_by:null, checked_at:null },
  { id:'hs8',  assignment_id:'ha2', student_id:'s2', submission_url:'',                            source:'manual',   submitted_at:null,                    status:'assigned',  score:null,  comment:'',                              errors:[], checked_by:null, checked_at:null },
  { id:'hs9',  assignment_id:'ha2', student_id:'s3', submission_url:'https://t.me/c/123/471',      source:'telegram', submitted_at:daysAgo(1)+'T22:30:00Z', status:'submitted', score:null,  comment:'',                              errors:[], checked_by:null, checked_at:null },
  { id:'hs10', assignment_id:'ha2', student_id:'s4', submission_url:'',                            source:'manual',   submitted_at:null,                    status:'assigned',  score:null,  comment:'',                              errors:[], checked_by:null, checked_at:null },
  { id:'hs11', assignment_id:'ha2', student_id:'s5', submission_url:'',                            source:'manual',   submitted_at:null,                    status:'assigned',  score:null,  comment:'',                              errors:[], checked_by:null, checked_at:null },

  // ha3 (g2, просрочено) — 2 сдали, 1 проверена, 1 не сдал
  { id:'hs12', assignment_id:'ha3', student_id:'s6', submission_url:'https://t.me/c/456/201',      source:'telegram', submitted_at:daysAgo(2)+'T20:00:00Z', status:'submitted', score:null,  comment:'',                              errors:[], checked_by:null, checked_at:null },
  { id:'hs13', assignment_id:'ha3', student_id:'s7', submission_url:'https://vk.com/doc456',       source:'vk',       submitted_at:daysAgo(4)+'T18:00:00Z', status:'checked',   score:95,    comment:'Блестящая работа!',              errors:[], checked_by:'r2', checked_at:daysAgo(3)+'T09:00:00Z' },
  { id:'hs14', assignment_id:'ha3', student_id:'s8', submission_url:'https://t.me/c/456/202',      source:'telegram', submitted_at:daysAgo(1)+'T23:00:00Z', status:'submitted', score:null,  comment:'',                              errors:[], checked_by:null, checked_at:null },
  { id:'hs15', assignment_id:'ha3', student_id:'s9', submission_url:'',                            source:'manual',   submitted_at:null,                    status:'overdue',   score:null,  comment:'',                              errors:[], checked_by:null, checked_at:null },

  // ha4 (g2, в срок) — только 1 сдала досрочно
  { id:'hs16', assignment_id:'ha4', student_id:'s6', submission_url:'',                            source:'manual',   submitted_at:null,                    status:'assigned',  score:null,  comment:'',                              errors:[], checked_by:null, checked_at:null },
  { id:'hs17', assignment_id:'ha4', student_id:'s7', submission_url:'https://docs.google.com/456', source:'web',      submitted_at:daysAgo(1)+'T14:00:00Z', status:'submitted', score:null,  comment:'',                              errors:[], checked_by:null, checked_at:null },
  { id:'hs18', assignment_id:'ha4', student_id:'s8', submission_url:'',                            source:'manual',   submitted_at:null,                    status:'assigned',  score:null,  comment:'',                              errors:[], checked_by:null, checked_at:null },
  { id:'hs19', assignment_id:'ha4', student_id:'s9', submission_url:'',                            source:'manual',   submitted_at:null,                    status:'assigned',  score:null,  comment:'',                              errors:[], checked_by:null, checked_at:null },
];

// ─── Export ───────────────────────────────────────────────────────────────────
export const SEED = {
  students,
  groups,
  payments,
  expenses,
  lessons,
  roles,
  modules: [],
  folders: [],
  events: [],
  student_notes: [],
  hw_submissions: [],
  history_log: [],
  homework_assignments,
  homework_submissions,
  assistant_groups,
};
