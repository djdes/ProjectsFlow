import { Router, type NextFunction, type Request, type Response } from 'express';
import type { ManageEmployees } from '../../application/finance/ManageEmployees.js';
import type { Employee } from '../../domain/finance/types.js';
import { requireAuth } from '../middleware/requireAuth.js';

type Deps = {
  readonly manage: ManageEmployees;
};

function toDto(e: Employee): Record<string, unknown> {
  return {
    id: e.id,
    name: e.name,
    monthlySalaryKopecks: e.monthlySalaryKopecks,
    active: e.active,
    createdAt: e.createdAt.toISOString(),
  };
}

// Личный ростер сотрудников аккаунта. Scope — req.user.id.
export function employeesRouter(deps: Deps): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const list = await deps.manage.list(req.user!.id);
      res.json({ employees: list.map(toDto) });
    } catch (e) {
      next(e);
    }
  });

  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body ?? {};
      const emp = await deps.manage.create(req.user!.id, {
        name: String(body.name ?? ''),
        monthlySalaryKopecks: Number(body.monthlySalaryKopecks ?? 0),
      });
      res.status(201).json({ employee: toDto(emp) });
    } catch (e) {
      next(e);
    }
  });

  router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params['id'] as string;
      const body = req.body ?? {};
      const patch: { name?: string; monthlySalaryKopecks?: number; active?: boolean } = {};
      if (typeof body.name === 'string') patch.name = body.name;
      if (body.monthlySalaryKopecks !== undefined) patch.monthlySalaryKopecks = Number(body.monthlySalaryKopecks);
      if (typeof body.active === 'boolean') patch.active = body.active;
      const emp = await deps.manage.update(req.user!.id, id, patch);
      res.json({ employee: toDto(emp) });
    } catch (e) {
      next(e);
    }
  });

  // Архивация (soft): active=false + закрытие открытых назначений.
  router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params['id'] as string;
      await deps.manage.archive(req.user!.id, id);
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  return router;
}
