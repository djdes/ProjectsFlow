export class EmployeeNotFoundError extends Error {
  constructor() {
    super('employee not found');
    this.name = 'EmployeeNotFoundError';
  }
}

export class FinanceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FinanceValidationError';
  }
}

// Сотрудник назначен на проект — не отдаётся не-владельцу. Используется как 404,
// чтобы не палить существование.
export class AssignmentNotFoundError extends Error {
  constructor() {
    super('assignment not found');
    this.name = 'AssignmentNotFoundError';
  }
}
