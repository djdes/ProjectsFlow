import type { RequestHandler } from 'express';

// Гард admin-раздела. Идёт ПОСЛЕ sessionFromCookie (req.user уже проставлен).
// Не-админу — 403 (роут известен клиентскому гарду, существование палить не страшно).
export const requireAdmin: RequestHandler = (req, res, next) => {
  if (!req.user) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  if (!req.user.isAdmin) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  next();
};
