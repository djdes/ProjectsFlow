import { useState } from 'react';
import { ImagePlus, Loader2 } from 'lucide-react';
import type { ImageGeneration } from '@/domain/image-generation/ImageGeneration';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

export function ConversationImageMessage({ job, onImageLoad, onRetry }: {
  job: ImageGeneration;
  onImageLoad: () => void;
  onRetry: (prompt: string) => void;
}): React.ReactElement {
  const [preview, setPreview] = useState(false);
  const pending = job.status === 'queued' || job.status === 'running';
  return (
    <article className="min-w-0 space-y-3" data-image-job={job.id}>
      <div className="flex justify-end"><p className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl bg-muted px-4 py-3 text-sm">{job.prompt}</p></div>
      <div className="min-w-0 space-y-2 pbs-2">
        <p className="flex items-center gap-2 text-xs text-muted-foreground"><ImagePlus className="size-4 shrink-0" />Генерация фото</p>
        {pending && <p role="status" className="flex items-center gap-2 py-4 text-sm text-muted-foreground"><Loader2 className="size-4 motion-safe:animate-spin" />{job.status === 'queued' ? 'Фотография в очереди…' : 'Создаём фотографию…'}</p>}
        {job.status === 'failed' && <div className="space-y-2"><p role="alert" className="text-sm text-destructive">{job.error || 'Не удалось создать фотографию'}</p><Button variant="outline" onClick={() => onRetry(job.prompt)}>Использовать описание</Button></div>}
        {job.imageUrl && <>
          <button type="button" aria-label="Открыть фотографию" onClick={() => setPreview(true)} className="block w-full max-w-xl rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring active:opacity-80">
            <img src={job.imageUrl} alt={job.prompt} onLoad={onImageLoad} className="h-auto max-h-[65dvh] w-full rounded-xl object-contain" />
          </button>
          <a href={job.imageUrl} download={`photo-${job.id}.png`} className="inline-flex rounded-md px-2 py-1 text-sm text-primary focus-visible:outline active:opacity-70">Скачать фотографию</a>
        </>}
      </div>
      <Dialog open={preview} onOpenChange={setPreview}><DialogContent className="w-[96vw] max-w-[96vw] p-3"><DialogTitle className="sr-only">Фотография</DialogTitle>{job.imageUrl && <img src={job.imageUrl} alt={job.prompt} className="mx-auto max-h-[90dvh] max-w-full object-contain" />}</DialogContent></Dialog>
    </article>
  );
}
