const now = Date.now();
const day = 86400000;
export const daysAgo = (n) => new Date(now - n * day).toISOString().slice(0, 10);
export const daysFromNow = (n) => new Date(now + n * day).toISOString().slice(0, 10);

export const SEED = {
  students: [
    {
      id: 's1', name: 'Алиса Иванова', phone: '+7 900 111-22-33', email: 'alice@example.com',
      subject: 'Математика', teacher: 'Анна Петровна', level: 'B1',
      status: 'active', pipelineStage: 'active', trialDate: daysAgo(60),
      statusDate: daysAgo(55), statusNote: 'Перешла после пробного',
      lessonRate: 1800, lessonDuration: 60, lessonsPerWeek: 2,
      balance: 3600, totalPaid: 32400, nextLesson: daysFromNow(2),
      absences: 1, hwMissed: 0, paymentDelay: 0,
      notes: 'Готовится к ОГЭ. Западает геометрия.',
      subscriptionType: 'monthly', subscriptionStart: daysAgo(30), subscriptionEnd: daysFromNow(0),
      tags: ['ОГЭ', 'геометрия'],
      createdAt: daysAgo(60),
    },
    {
      id: 's2', name: 'Борис Смирнов', phone: '+7 900 222-33-44', email: 'boris@example.com',
      subject: 'Физика', teacher: 'Дмитрий Сергеевич', level: 'C1',
      status: 'active', pipelineStage: 'active', trialDate: daysAgo(90),
      statusDate: daysAgo(85), statusNote: '',
      lessonRate: 2200, lessonDuration: 60, lessonsPerWeek: 1,
      balance: 2200, totalPaid: 28600, nextLesson: daysFromNow(5),
      absences: 3, hwMissed: 2, paymentDelay: 5,
      notes: 'ЕГЭ цель 90+. Пропускал из-за болезни.',
      subscriptionType: 'lessons', subscriptionStart: null, subscriptionEnd: null,
      tags: ['ЕГЭ'],
      createdAt: daysAgo(90),
    },
    {
      id: 's3', name: 'Вера Козлова', phone: '+7 900 333-44-55', email: 'vera@example.com',
      subject: 'Английский', teacher: 'Елена Михайловна', level: 'A2',
      status: 'trial', pipelineStage: 'trial', trialDate: daysFromNow(3),
      statusDate: daysAgo(2), statusNote: 'Записалась через сайт',
      lessonRate: 1500, lessonDuration: 45, lessonsPerWeek: 2,
      balance: 0, totalPaid: 0, nextLesson: daysFromNow(3),
      absences: 0, hwMissed: 0, paymentDelay: 0,
      notes: 'Начинающий уровень. Хочет разговорный.',
      subscriptionType: null, subscriptionStart: null, subscriptionEnd: null,
      tags: ['разговорный'],
      createdAt: daysAgo(2),
    },
    {
      id: 's4', name: 'Глеб Новиков', phone: '+7 900 444-55-66', email: 'gleb@example.com',
      subject: 'Информатика', teacher: 'Анна Петровна', level: 'B2',
      status: 'paused', pipelineStage: 'paused', trialDate: daysAgo(120),
      statusDate: daysAgo(14), statusNote: 'Пауза на экзамены',
      lessonRate: 2000, lessonDuration: 60, lessonsPerWeek: 2,
      balance: 4000, totalPaid: 44000, nextLesson: null,
      absences: 0, hwMissed: 1, paymentDelay: 0,
      notes: 'Сессия. Возобновит через месяц.',
      subscriptionType: 'monthly', subscriptionStart: daysAgo(60), subscriptionEnd: daysFromNow(30),
      tags: [],
      createdAt: daysAgo(120),
    },
    {
      id: 's5', name: 'Дарья Петрова', phone: '+7 900 555-66-77', email: 'dasha@example.com',
      subject: 'Математика', teacher: 'Анна Петровна', level: 'C1',
      status: 'active', pipelineStage: 'active', trialDate: daysAgo(180),
      statusDate: daysAgo(175), statusNote: '',
      lessonRate: 2500, lessonDuration: 60, lessonsPerWeek: 3,
      balance: 0, totalPaid: 135000, nextLesson: daysFromNow(1),
      absences: 0, hwMissed: 0, paymentDelay: 12,
      notes: 'Один из лучших студентов. Должна за прошлый месяц.',
      subscriptionType: 'monthly', subscriptionStart: daysAgo(30), subscriptionEnd: daysAgo(1),
      tags: ['ЕГЭ', 'ВПР'],
      createdAt: daysAgo(180),
    },
  ],

  groups: [
    {
      id: 'g1', name: 'Матем B1 (утро)', subject: 'Математика', teacher: 'Анна Петровна',
      level: 'B1', schedule: 'Пн/Ср 10:00', maxStudents: 6, rate: 900,
      studentIds: ['s1'],
      createdAt: daysAgo(90),
    },
    {
      id: 'g2', name: 'Англ A2 (вечер)', subject: 'Английский', teacher: 'Елена Михайловна',
      level: 'A2', schedule: 'Вт/Чт 19:00', maxStudents: 8, rate: 700,
      studentIds: ['s3'],
      createdAt: daysAgo(45),
    },
  ],

  lessons: [
    {
      id: 'l1', studentId: 's1', groupId: null, teacherId: 't1',
      date: daysAgo(7), startTime: '10:00', endTime: '11:00',
      topic: 'Тригонометрические уравнения', homework: 'Задачи 5.1–5.8',
      difficulty: 'med', mood: 4, attended: true, hwStatus: 'done',
      notes: 'Хорошо усвоила формулы приведения.',
      cancelled: false, cancelReason: '', isTrial: false,
      createdAt: daysAgo(8),
    },
    {
      id: 'l2', studentId: 's2', groupId: null, teacherId: 't2',
      date: daysAgo(3), startTime: '16:00', endTime: '17:00',
      topic: 'Электромагнитная индукция', homework: 'Задачи §14 №1–6',
      difficulty: 'hard', mood: 3, attended: false, hwStatus: 'miss',
      notes: 'Не пришёл, предупредил заранее.',
      cancelled: false, cancelReason: '', isTrial: false,
      createdAt: daysAgo(4),
    },
    {
      id: 'l3', studentId: 's5', groupId: null, teacherId: 't1',
      date: daysFromNow(1), startTime: '14:00', endTime: '15:00',
      topic: 'Производная сложной функции', homework: '',
      difficulty: null, mood: null, attended: null, hwStatus: null,
      notes: '',
      cancelled: false, cancelReason: '', isTrial: false,
      createdAt: daysAgo(1),
    },
    {
      id: 'l4', studentId: 's3', groupId: null, teacherId: 't3',
      date: daysFromNow(3), startTime: '11:00', endTime: '11:45',
      topic: 'Пробный урок', homework: '',
      difficulty: null, mood: null, attended: null, hwStatus: null,
      notes: '',
      cancelled: false, cancelReason: '', isTrial: true,
      createdAt: daysAgo(2),
    },
  ],

  payments: [
    {
      id: 'p1', studentId: 's1', amount: 7200, date: daysAgo(30),
      method: 'card', comment: '4 урока', createdAt: daysAgo(30),
    },
    {
      id: 'p2', studentId: 's2', amount: 8800, date: daysAgo(45),
      method: 'cash', comment: '4 урока', createdAt: daysAgo(45),
    },
    {
      id: 'p3', studentId: 's5', amount: 30000, date: daysAgo(5),
      method: 'transfer', comment: 'Февраль (частично)', createdAt: daysAgo(5),
    },
  ],

  expenses: [
    {
      id: 'e1', category: 'marketing', amount: 15000, date: daysAgo(25),
      vendor: 'Яндекс Директ', comment: 'Реклама март', channel: 'yandex',
      createdAt: daysAgo(25),
    },
    {
      id: 'e2', category: 'software', amount: 3490, date: daysAgo(10),
      vendor: 'Notion', comment: 'Подписка команды', channel: null,
      createdAt: daysAgo(10),
    },
    {
      id: 'e3', category: 'marketing', amount: 8000, date: daysAgo(8),
      vendor: 'ВКонтакте', comment: 'Таргет апрель', channel: 'vk',
      createdAt: daysAgo(8),
    },
  ],

  tasks: [
    {
      id: 'tk1', title: 'Позвонить Борису по пропуску', assignedTo: 'admin',
      dueDate: daysFromNow(1), priority: 'high', status: 'open',
      studentId: 's2', note: '',
      createdAt: daysAgo(1),
    },
    {
      id: 'tk2', title: 'Выслать счёт Дарье', assignedTo: 'admin',
      dueDate: daysFromNow(0), priority: 'med', status: 'open',
      studentId: 's5', note: 'Должна за апрель',
      createdAt: daysAgo(3),
    },
    {
      id: 'tk3', title: 'Обновить расписание на май', assignedTo: 'admin',
      dueDate: daysFromNow(7), priority: 'low', status: 'done',
      studentId: null, note: '',
      createdAt: daysAgo(5),
    },
  ],

  roles: [
    { id: 'r1', name: 'Администратор', pin: '0000', access: 'admin', createdAt: daysAgo(200) },
    { id: 'r2', name: 'Анна Петровна', pin: '1111', access: 'teacher', teacherId: 't1', createdAt: daysAgo(180) },
    { id: 'r3', name: 'Дмитрий Сергеевич', pin: '2222', access: 'teacher', teacherId: 't2', createdAt: daysAgo(90) },
  ],

  history: [],
  events: [],
};
