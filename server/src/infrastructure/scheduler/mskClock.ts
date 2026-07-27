// Московское «сейчас» для планировщиков: час, минута, дата (YYYY-MM-DD) и день недели.
// Вынесено из WorkspaceAssigneeDigestScheduler, чтобы планировщики не расходились в
// трактовке времени (у сводки руководителя те же правила, что у рассылки по ответственным).
export type MskNow = {
  readonly hour: number;
  readonly minute: number;
  readonly date: string;
  readonly dayOfWeek: 0 | 1 | 2 | 3 | 4 | 5 | 6;
};

export function mskNow(at: Date): MskNow {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(at);
  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
  const date = `${get('year')}-${get('month')}-${get('day')}`;
  const [year, month, day] = date.split('-').map(Number);
  const weekDay = new Date(Date.UTC(year!, (month ?? 1) - 1, day!)).getUTCDay();
  return {
    hour: Number(get('hour')) % 24,
    minute: Number(get('minute')),
    date,
    dayOfWeek: weekDay as 0 | 1 | 2 | 3 | 4 | 5 | 6,
  };
}
