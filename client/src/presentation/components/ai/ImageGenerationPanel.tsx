import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useContainer } from '@/infrastructure/di/container';
import type { ImageGeneration } from '@/domain/image-generation/ImageGeneration';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

const labels = {queued:'В очереди',running:'Создаём фотографию…',succeeded:'Готово',failed:'Не получилось'};
export function ImageGenerationPanel(): React.ReactElement {
  const { imageGenerationRepository } = useContainer();
  const [prompt,setPrompt] = useState('');
  const [jobs,setJobs] = useState<ImageGeneration[]>([]);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [loading,setLoading] = useState(true);
  const [preview,setPreview] = useState<ImageGeneration | null>(null);
  const submitting=useRef(false);
  const revision=useRef(0);
  useEffect(()=>{
    let alive=true;let pending=false;
    const refresh=():void=>{
      if(pending)return;pending=true;const requestedRevision=revision.current;
      void imageGenerationRepository.list().then(items=>{if(alive&&requestedRevision===revision.current){setJobs(items);setError('');}}).catch(()=>{if(alive)setError('Не удалось обновить фотографии. Проверим соединение ещё раз.');}).finally(()=>{pending=false;if(alive)setLoading(false);});
    };
    refresh();const timer=window.setInterval(refresh,4000);window.addEventListener('focus',refresh);
    return()=>{alive=false;window.clearInterval(timer);window.removeEventListener('focus',refresh);};
  },[imageGenerationRepository]);
  const submit=async():Promise<void>=>{
    if(submitting.current||!prompt.trim())return;submitting.current=true;revision.current++;setBusy(true);setError('');
    try{const job=await imageGenerationRepository.create(prompt);setJobs(items=>[job,...items.filter(item=>item.id!==job.id)]);setPrompt('');}
    catch(e){setError(e instanceof Error?e.message:'Не удалось запустить генерацию');}
    finally{submitting.current=false;setBusy(false);}
  };
  return <section className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6 sm:px-6">
    <div><h1 className="text-2xl font-semibold">Генерация фото</h1><p className="mbs-2 text-sm text-muted-foreground">Опиши фотографию, которую хочешь получить. Результаты сохранятся здесь.</p></div>
    <form className="space-y-3 rounded-xl border border-border bg-card p-4" onSubmit={event=>{event.preventDefault();void submit();}}>
      <label htmlFor="image-prompt" className="block text-sm font-medium">Что создать</label>
      <textarea id="image-prompt" value={prompt} onChange={event=>setPrompt(event.target.value)} maxLength={8000} rows={4} placeholder="Например: предметная фотография жёлтой кружки на светлом столе, мягкий утренний свет" className="w-full resize-y rounded-lg border border-input bg-background p-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" />
      <div className="flex flex-wrap items-center justify-between gap-3"><span className="text-xs text-muted-foreground">Обычно несколько минут · одна фотография за запрос</span><Button type="submit" disabled={busy||!prompt.trim()}>{busy?'Отправляем…':'Создать фотографию'}</Button></div>
    </form>
    {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
    {loading?<p className="text-sm text-muted-foreground">Загрузка…</p>:jobs.length===0?<p className="py-8 text-center text-sm text-muted-foreground">Здесь появятся созданные фотографии</p>:<div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,18rem),1fr))] gap-4">
      {jobs.map(job=><article key={job.id} className="min-w-0 space-y-3 rounded-xl border border-border bg-card p-3">
        {job.imageUrl?<button type="button" onClick={()=>setPreview(job)} aria-label="Открыть фотографию" className="block w-full rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary active:opacity-80"><img src={job.imageUrl} alt={job.prompt} className="aspect-square w-full rounded-lg object-contain" /></button>:<div className="grid aspect-square place-items-center rounded-lg bg-muted p-4 text-center text-sm text-muted-foreground" role="status">{job.error||labels[job.status]}</div>}
        <p className="break-words text-sm">{job.prompt}</p><div className="flex items-center justify-between gap-2 text-xs text-muted-foreground"><span>{labels[job.status]}</span>{job.imageUrl&&<a href={job.imageUrl} download={`photo-${job.id}.png`} className="rounded px-2 py-1 text-primary focus-visible:outline active:opacity-70">Скачать</a>}</div>
        {job.status==='failed'&&<Button variant="outline" onClick={()=>setPrompt(job.prompt)}>Попробовать с этим описанием</Button>}
      </article>)}
    </div>}
    <Dialog open={preview!==null} onOpenChange={open=>{if(!open)setPreview(null);}}><DialogContent className="w-[96vw] max-w-[96vw] p-3"><DialogTitle className="sr-only">Фотография</DialogTitle>{preview?.imageUrl&&<img src={preview.imageUrl} alt={preview.prompt} className="mx-auto max-h-[90dvh] max-w-full object-contain" />}</DialogContent></Dialog>
  </section>;
}
