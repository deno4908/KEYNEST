import { Router } from 'express';
import { z } from 'zod';
import { AppError } from './security.js';

export const categoryId = z.string().min(1).max(40).regex(/^[a-z][a-z0-9-]*$/).refine((v) => !['constructor','prototype'].includes(v));
const defaults = [ ['game','Game key'], ['gift','Gift card'], ['topup','Nạp game'], ['mmo','MMO & Proxy'] ];
export function createCategories(store) {
  if (store.db && !store.db.categories) {
    store.db.categories = defaults.map(([id,name],sort_order) => ({ id,name,sort_order }));
    store.save();
  }
  return {
    async list() {
      return store.db ? [...store.db.categories].sort((a,b) => a.sort_order-b.sort_order || a.id.localeCompare(b.id))
        : store.query(store.client.from('categories').select('id,name,sort_order').order('sort_order').order('id'));
    },
    async require(id) {
      if (!(await this.list()).some((c) => c.id === id)) throw new AppError('Danh mục không tồn tại.', 400);
    },
    async save(input, update) {
      if (store.db) {
        const existing = store.db.categories.find((c) => c.id === input.id);
        if (update && !existing) throw new AppError('Không tìm thấy danh mục.', 404);
        if (!update && existing) throw new AppError('Mã danh mục đã tồn tại.', 409);
        if (existing) Object.assign(existing, input); else store.db.categories.push(input);
        store.save(); return input;
      }
      if (update) await this.require(input.id);
      else if ((await this.list()).some((c) => c.id === input.id)) throw new AppError('Mã danh mục đã tồn tại.', 409);
      const q = store.client.from('categories');
      return store.query((update ? q.update({ name: input.name, sort_order: input.sort_order }).eq('id', input.id) : q.insert(input)).select().single());
    },
  };
}
export function categoriesRouter({ categories, auth, admin, limiter, store }) {
  const router = Router();
  router.get('/categories', async (req,res) => res.json(await categories.list()));
  router.use('/admin/categories', auth, admin, limiter(30,60000,'categories-write'));
  const fields = { name: z.string().trim().min(2).max(60), sort_order: z.number().int().min(0).max(9999).default(0) };
  router.post('/admin/categories', async (req,res) => {
    const input = z.object({ id: categoryId.refine((v) => v !== 'all'), ...fields }).strict().parse(req.body);
    const data = await categories.save(input, false);
    await store.audit(req.user.id,'create_category',input.id); res.status(201).json(data);
  });
  router.patch('/admin/categories/:id', async (req,res) => {
    const input = { ...z.object(fields).strict().parse(req.body), id: categoryId.parse(req.params.id) };
    const data = await categories.save(input,true);
    await store.audit(req.user.id,'update_category',input.id); res.json(data);
  });
  return router;
}
