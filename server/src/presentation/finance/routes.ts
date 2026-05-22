import { Router, type NextFunction, type Request, type Response } from 'express';
import type { GetProjectFinance } from '../../application/finance/GetProjectFinance.js';
import type { ManageProjectFinance } from '../../application/finance/ManageProjectFinance.js';
import { FinanceValidationError } from '../../domain/finance/errors.js';
import type { ProjectFinance } from '../../domain/finance/types.js';
import { requireAuth } from '../middleware/requireAuth.js';

type Deps = {
  readonly getFinance: GetProjectFinance;
  readonly manage: ManageProjectFinance;
};

function parseDate(value: unknown, field: string): Date {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new FinanceValidationError(`Некорректная дата: ${field}`);
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new FinanceValidationError(`Некорректная дата: ${field}`);
  return d;
}

function financeToDto(f: ProjectFinance): Record<string, unknown> {
  return {
    laborTotalKopecks: f.laborTotalKopecks,
    labor: f.labor.map((l) => ({
      ...l,
      startedAt: l.startedAt.toISOString(),
      endedAt: l.endedAt ? l.endedAt.toISOString() : null,
    })),
    otherExpensesTotalKopecks: f.otherExpensesTotalKopecks,
    expenses: f.expenses.map((e) => ({
      ...e,
      incurredOn: e.incurredOn.toISOString(),
      createdAt: e.createdAt.toISOString(),
    })),
    incomeTotalKopecks: f.incomeTotalKopecks,
    incomes: f.incomes.map((i) => ({
      ...i,
      receivedOn: i.receivedOn.toISOString(),
      createdAt: i.createdAt.toISOString(),
    })),
    expenseTotalKopecks: f.expenseTotalKopecks,
    profitKopecks: f.profitKopecks,
    marginPercent: f.marginPercent,
  };
}

export function financeRouter(deps: Deps): Router {
  const router = Router({ mergeParams: true });
  router.use(requireAuth);

  const pid = (req: Request): string => req.params['projectId'] as string;

  router.get('/summary', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const finance = await deps.getFinance.execute(pid(req), req.user!.id);
      res.json({ finance: financeToDto(finance) });
    } catch (e) {
      next(e);
    }
  });

  // --- Assignments ---
  router.post('/assignments', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const b = req.body ?? {};
      await deps.manage.assign(pid(req), req.user!.id, {
        employeeId: String(b.employeeId ?? ''),
        allocationPercent: Number(b.allocationPercent ?? 100),
        startedAt: b.startedAt ? parseDate(b.startedAt, 'startedAt') : undefined,
        endedAt: b.endedAt ? parseDate(b.endedAt, 'endedAt') : null,
      });
      res.status(201).json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  router.patch('/assignments/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const b = req.body ?? {};
      await deps.manage.updateAssignment(pid(req), req.user!.id, req.params['id'] as string, {
        allocationPercent: b.allocationPercent !== undefined ? Number(b.allocationPercent) : undefined,
        startedAt: b.startedAt ? parseDate(b.startedAt, 'startedAt') : undefined,
        endedAt: b.endedAt === undefined ? undefined : b.endedAt ? parseDate(b.endedAt, 'endedAt') : null,
      });
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  router.delete('/assignments/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      await deps.manage.removeAssignment(pid(req), req.user!.id, req.params['id'] as string);
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  // --- Expenses ---
  router.post('/expenses', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const b = req.body ?? {};
      await deps.manage.addExpense(pid(req), req.user!.id, {
        amountKopecks: Number(b.amountKopecks ?? 0),
        category: String(b.category ?? 'other'),
        description: typeof b.description === 'string' ? b.description : null,
        incurredOn: parseDate(b.incurredOn, 'incurredOn'),
      });
      res.status(201).json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  router.delete('/expenses/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      await deps.manage.deleteExpense(pid(req), req.user!.id, req.params['id'] as string);
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  // --- Incomes ---
  router.post('/incomes', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const b = req.body ?? {};
      await deps.manage.addIncome(pid(req), req.user!.id, {
        amountKopecks: Number(b.amountKopecks ?? 0),
        source: typeof b.source === 'string' ? b.source : null,
        receivedOn: parseDate(b.receivedOn, 'receivedOn'),
      });
      res.status(201).json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  router.delete('/incomes/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      await deps.manage.deleteIncome(pid(req), req.user!.id, req.params['id'] as string);
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  // --- Visibility ---
  router.put('/visibility', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const v = req.body?.visibility;
      if (v !== 'owner' && v !== 'members') {
        throw new FinanceValidationError('visibility должен быть owner или members');
      }
      await deps.manage.setVisibility(pid(req), req.user!.id, v);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  return router;
}
