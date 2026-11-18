import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useContainer } from '@/infrastructure/di/container';
import { useWorkerEnabled } from '@/presentation/hooks/useWorkerEnabled';
import type { RunMode, Task } from '@/domain/task/Task';
import { RunModeSelect } from './RunMode';

export function RunWithWorkerButton({task,onChanged,onQueued}:{task:Task;onChanged?:()=>void;onQueued?:()=>void}):React.ReactElement|null {
  const {taskRepository}=useContainer();const enabled=useWorkerEnabled();
  const [busy,setBusy]=useState(false),[queued,setQueued]=useState(false),[error,setError]=useState('');
  // Режим запуска выбирает человек на каждой задаче (spec 2026-11-17 §5); дефолт — режим задачи.
  const [runMode,setRunMode]=useState<RunMode>(task.runMode==='full'?'full':'quick');
  const sending=useRef(false);
  if(!enabled||task.canEdit===false||!['backlog','manual','todo','custom_1','custom_2','custom_3','custom_4','custom_5'].includes(task.status))return null;
  const waiting=queued||task.status==='todo';
  const run=async():Promise<void>=>{
    if(sending.current||waiting)return;sending.current=true;setBusy(true);setError('');
    try{
      // Режим сохраняем ДО постановки в очередь: диспетчер читает его из задачи.
      if(runMode!==(task.runMode==='full'?'full':'quick'))await taskRepository.update(task.projectId,task.id,{runMode});
      await taskRepository.move(task.projectId,task.id,{targetStatus:'todo',beforeTaskId:null,afterTaskId:null});setQueued(true);onQueued?.();onChanged?.();}
    catch(e){setError(e instanceof Error?e.message:'Не удалось отправить задачу воркеру');}
    finally{sending.current=false;setBusy(false);}
  };
  return <div data-pf-worker-start="" className="mx-3 mbs-3 mbe-2 space-y-2">{!waiting&&<p className="text-xs text-muted-foreground">Передай задачу воркеру — ход выполнения появится в LIVE.</p>}{!waiting&&<div className="max-w-xs"><RunModeSelect value={runMode} onChange={setRunMode} disabled={busy}/></div>}<Button type="button" disabled={busy||waiting} onClick={()=>void run()}>{waiting?'Задача в очереди':busy?'Отправляем…':'Сделать с помощью воркера'}</Button>{error&&<p role="alert" className="max-w-xs text-xs text-destructive">{error}</p>}</div>;
}
