import { Router, type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import { z } from 'zod';
import type { VoiceTranscriber } from '../../application/telegram/VoiceTranscriber.js';
import type { AuthenticateAgentToken } from '../../application/agent/AuthenticateAgentToken.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireAgentToken } from '../middleware/requireAgentToken.js';

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const DEFAULT_MODEL = 'whisper-large-v3-turbo';
const DEFAULT_LANGUAGE = 'ru';

const bodySchema = z.object({
  language: z.string().trim().min(2).max(16).optional(),
  prompt: z.string().trim().max(1000).optional(),
  model: z.string().trim().min(1).max(120).optional(),
  filename: z.string().trim().max(255).optional(),
  mimeType: z.string().trim().max(120).optional(),
  audioBase64: z.string().trim().min(1).optional(),
});

export function voiceTranscriptionRouter(
  transcriber: VoiceTranscriber,
  authenticate?: AuthenticateAgentToken,
): Router {
  const r = Router();

  if (authenticate) {
    r.use((req, res, next) => {
      if (req.headers.authorization) {
        return requireAgentToken(authenticate)(req, res, (error) => {
          if (error) return next(error);
          if (req.agentToken?.scopeKind !== 'account') {
            res.status(403).json({ error: 'account_token_required' });
            return;
          }
          next();
        });
      }
      next();
    });
  }
  r.use(requireAuth);

  r.get('/', (_req: Request, res: Response) => {
    res.set('Cache-Control', 'private, no-store').json({
      ok: true,
      enabled: transcriber.enabled,
      model: DEFAULT_MODEL,
      defaultLanguage: DEFAULT_LANGUAGE,
    });
  });

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      files: 1,
      fileSize: MAX_AUDIO_BYTES,
      fields: 6,
      fieldSize: 35 * 1024 * 1024,
    },
  });

  const handleUpload = upload.fields([
    { name: 'file', maxCount: 1 },
    { name: 'audio', maxCount: 1 },
  ]);

  r.post('/', (req: Request, res: Response, next: NextFunction) => {
    const contentType = (req.headers['content-type'] ?? '').toLowerCase();
    if (contentType.includes('multipart/form-data')) {
      handleUpload(req, res, (err) => {
        if (err) {
          res.status(400).json({
            error: 'invalid_audio',
            message: err instanceof Error ? err.message : 'Invalid multipart audio upload',
          });
          return;
        }
        void processTranscription(req, res, next);
      });
      return;
    }
    void processTranscription(req, res, next);
  });

  async function processTranscription(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!transcriber.enabled) {
        res.status(503).json({
          error: 'transcription_unavailable',
          message: 'Groq voice transcription is not configured on this server',
        });
        return;
      }

      const parsed = bodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({
          error: 'invalid_input',
          message: parsed.error.issues.map((i) => i.message).join('; '),
        });
        return;
      }

      const filesMap = (req.files ?? {}) as Record<string, Express.Multer.File[] | undefined>;
      const uploadedFile = filesMap.file?.[0] ?? filesMap.audio?.[0] ?? req.file;

      let data: Buffer | null = null;
      let filename = parsed.data.filename || 'voice.ogg';
      let mimeType = parsed.data.mimeType || 'audio/ogg';

      if (uploadedFile) {
        data = uploadedFile.buffer;
        filename = uploadedFile.originalname || filename;
        mimeType = uploadedFile.mimetype || mimeType;
      } else if (parsed.data.audioBase64) {
        const cleanBase64 = parsed.data.audioBase64.replace(/^data:[^;]+;base64,/i, '');
        data = Buffer.from(cleanBase64, 'base64');
      }

      if (!data || data.length === 0) {
        res.status(400).json({
          error: 'invalid_audio',
          message: 'Audio file is required (multipart field "file"/"audio" or JSON "audioBase64")',
        });
        return;
      }
      if (data.length > MAX_AUDIO_BYTES) {
        res.status(400).json({
          error: 'invalid_audio',
          message: `Audio file exceeds maximum size (${MAX_AUDIO_BYTES} bytes)`,
        });
        return;
      }

      const language = parsed.data.language || DEFAULT_LANGUAGE;
      const model = parsed.data.model || DEFAULT_MODEL;
      const text = await transcriber.transcribe({
        data,
        filename,
        mimeType,
        language,
        prompt: parsed.data.prompt,
        model,
      });

      res.set('Cache-Control', 'private, no-store').json({
        ok: true,
        text,
        model,
        language,
      });
    } catch (error) {
      if (error instanceof Error && /Groq|Voice file|empty voice/i.test(error.message)) {
        res.status(502).json({
          error: 'transcription_failed',
          message: error.message,
        });
        return;
      }
      next(error);
    }
  }

  return r;
}
