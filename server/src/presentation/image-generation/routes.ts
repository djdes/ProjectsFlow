import { Router, type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import { z } from 'zod';
import type { ImageGenerationService } from '../../application/image-generation/ImageGenerationService.js';
import type { ImageGeneration } from '../../domain/image-generation/ImageGeneration.js';
import { ImageGenerationError } from '../../domain/image-generation/ImageGeneration.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireAgentToken } from '../middleware/requireAgentToken.js';
import type { AuthenticateAgentToken } from '../../application/agent/AuthenticateAgentToken.js';
const dto = (job: ImageGeneration) => ({ id: job.id, conversationId: job.conversationId ?? null, prompt: job.prompt, status: job.status, error: job.errorMessage, createdAt: job.createdAt.toISOString(), imageUrl: job.status==='succeeded'?`/api/ai/image-jobs/${job.id}/image`:null });
const wrap = (fn: (req: Request,res: Response) => Promise<void>) => async(req: Request,res: Response,next: NextFunction) => {
  try { await fn(req,res); } catch(error) { if(error instanceof ImageGenerationError)res.status(error.status).json({error:'image_generation_error',message:error.message});else next(error); }
};
export function imageGenerationRouter(service: ImageGenerationService, authenticate?: AuthenticateAgentToken): Router {
  const r=Router();
  if (authenticate) r.use((req,res,next) => {
    if (req.headers.authorization) {
      return requireAgentToken(authenticate)(req,res,error => {
        if (error) return next(error);
        if (req.agentToken?.scopeKind !== 'account') { res.status(403).json({error:'account_token_required'}); return; }
        next();
      });
    }
    next();
  });
  r.use(requireAuth);
  r.get('/',wrap(async(req,res)=>{const conversationId=z.string().uuid().optional().parse(req.query.conversationId);res.json({items:(await service.list(req.user!.id,conversationId)).map(dto)});}));
  // Register the literal path before /:id; "quota" is not a job UUID.
  r.get('/quota',wrap(async(req,res)=>{res.set('Cache-Control','private, no-store').json(await service.quota(req.user!.id));}));
  const references=multer({storage:multer.memoryStorage(),limits:{files:8,fileSize:6*1024*1024,fields:3,fieldSize:32000}});
  r.post('/',references.array('images',8),wrap(async(req,res)=>{
    const size=z.coerce.number().int().min(256).max(4096).optional();
    const body=z.object({prompt:z.string().trim().min(1).max(8000),width:size,height:size,conversationId:z.string().uuid().optional()}).strict().parse(req.body);
    const files=(req.files ?? []) as Express.Multer.File[];
    const input=files.length || body.width !== undefined || body.height !== undefined
      ? {width:body.width,height:body.height,images:files.map(file=>({data:file.buffer,mimeType:file.mimetype}))} : undefined;
    res.status(202).json(dto(await service.create(req.user!.id,body.prompt,body.conversationId,input)));
  }));
  r.get('/:id',wrap(async(req,res)=>{res.json(dto(await service.owned(req.user!.id,z.string().uuid().parse(req.params.id))));}));
  r.get('/:id/image',wrap(async(req,res)=>{const data=await service.image(req.user!.id,z.string().uuid().parse(req.params.id));res.set({'Content-Type':'image/png','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Disposition':`inline; filename="photo.png"`}).send(data);}));
  return r;
}
export function imageGenerationAgentRouter(service: ImageGenerationService, authenticate: AuthenticateAgentToken): Router {
  const r=Router();r.use(requireAgentToken(authenticate));
  r.use((req,res,next)=>{if(req.agentToken?.scopeKind!=='account'){res.status(403).json({error:'account_token_required'});return;}next();});
  r.post('/claim',wrap(async(req,res)=>{const job=await service.claim(req.user!.id);res.json({job:job?{id:job.id,prompt:job.prompt,claimToken:job.claimToken,input:await service.input(req.user!.id,job.id,job.claimToken!)}:null});}));
  const upload=multer({storage:multer.memoryStorage(),limits:{files:1,fileSize:24*1024*1024,fields:2,fieldSize:1000}});
  r.post('/:id/complete',upload.single('image'),wrap(async(req,res)=>{await service.complete(req.user!.id,z.string().uuid().parse(req.params.id),z.string().uuid().parse(req.body.claimToken),req.file?.buffer);res.json({ok:true});}));
  return r;
}
