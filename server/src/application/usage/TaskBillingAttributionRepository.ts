// Узкий compatibility-порт для задач, созданных до tasks.created_by (db/088).
// Историческая task_delegations-строка используется только чтобы определить, с чьего
// тарифа списывать старый AI-запуск. На ответственного, доступ и отображение не влияет.
export interface TaskBillingAttributionRepository {
  findLegacyCreatorForTask(taskId: string): Promise<string | null>;
}
