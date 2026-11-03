import type { MailingContent } from './Mailing.js';

// Built-in starting points. They are not stored: the editor opens one as a new template.
export type MailingStarter = MailingContent & {
  readonly key: string;
  readonly name: string;
  readonly description: string;
};

export const MAILING_STARTERS: readonly MailingStarter[] = [
  {
    key: 'product_news',
    name: 'Новость продукта',
    description: 'Анонс новой возможности с кнопкой «Попробовать»',
    subject: '{{name}}, в ProjectsFlow появилось новое',
    preheader: 'Коротко о том, что изменилось и как этим пользоваться',
    bodyMarkdown: [
      'Здравствуйте, {{name}}!',
      '',
      '## Что нового',
      '',
      'Мы добавили **новую возможность**, которая экономит время команды каждый день. Расскажите здесь в двух-трёх предложениях, что она делает.',
      '',
      '- Первое, что станет удобнее',
      '- Второе — с примером из жизни',
      '- Третье — для тех, кто работает с телефона',
      '',
      'Всё уже доступно в пространстве «{{workspace}}».',
    ].join('\n'),
    ctaLabel: 'Попробовать',
    ctaUrl: 'https://projectsflow.ru/',
  },
  {
    key: 'update',
    name: 'Обновление',
    description: 'Сводка изменений за период',
    subject: 'Обновления ProjectsFlow',
    preheader: 'Что изменилось за последние недели',
    bodyMarkdown: [
      'Здравствуйте, {{name}}!',
      '',
      'Собрали главное, что изменилось в ProjectsFlow за последнее время.',
      '',
      '### Новое',
      '',
      '- Пункт об улучшении',
      '- Ещё один пункт',
      '',
      '### Исправлено',
      '',
      '- Что работало не так и теперь работает',
      '',
      'Спасибо, что пользуетесь ProjectsFlow. Если что-то мешает — просто ответьте на это письмо.',
    ].join('\n'),
    ctaLabel: 'Открыть ProjectsFlow',
    ctaUrl: 'https://projectsflow.ru/',
  },
  {
    key: 'come_back',
    name: 'Приглашение вернуться',
    description: 'Для тех, кто давно не заходил',
    subject: '{{name}}, мы скучаем',
    preheader: 'Ваши проекты ждут — вот что появилось, пока вас не было',
    bodyMarkdown: [
      'Здравствуйте, {{name}}!',
      '',
      'Давно не видели вас в ProjectsFlow. Пока вас не было, мы сделали работу с задачами быстрее и удобнее — особенно с телефона.',
      '',
      'Ваши проекты в пространстве «{{workspace}}» на месте и ждут вас.',
    ].join('\n'),
    ctaLabel: 'Вернуться к проектам',
    ctaUrl: 'https://projectsflow.ru/',
  },
];
