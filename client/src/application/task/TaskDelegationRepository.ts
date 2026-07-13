import type { AssignedTask } from '@/domain/task/AssignedTask';

export interface TaskDelegationRepository {
  // Все поручённые мне задачи (accepted) по всем проектам — плоским списком.
  // Группировку (проект/дата/дедлайн/приоритет) делает презентация (assignedGrouping.ts).
  listAssignedToMe(): Promise<AssignedTask[]>;
  // Все активные делегирования «кому-то другому», видимые мне, по всем проектам —
  // вкладка «Другим». Тот же shape: delegation.creator* — от кого, delegate* — кому.
  listDelegatedToOthers(): Promise<AssignedTask[]>;
  // Создатель забирает задачу обратно (в т.ч. уже принятую) — drop на свою аву.
  withdraw(id: string): Promise<void>;
  // ДЕЛЕГАТ снимает с себя задачу (право отказа постфактум) — создателю уйдёт
  // уведомление task_delegation_resolved/declined.
  relinquish(id: string): Promise<void>;
}
