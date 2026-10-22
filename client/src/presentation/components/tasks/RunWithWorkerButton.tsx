import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useContainer } from '@/infrastructure/di/container';
import { useWorkerEnabled } from '@/presentation/hooks/useWorkerEnabled';
import type { Task } from '@/domain/task/Task';

export function RunWithWorkerButton({task,onChanged,onQueued}:{task:Task;onChanged?:()=>void;onQueued?:()=>void}):React.ReactElement|null {
  const {taskRepository}=useContainer();const enabled=useWorkerEnabled();
  const [busy,setBusy]=useState(false),[queued,setQueued]=useState(false),[error,setError]=useState('');
  const sending=useRef(false);
  if(!enabled||task.canEdit===false||!['backlog','manual','todo','custom_1','custom_2','custom_3','custom_4','custom_5'].includes(task.status))return null;
  const waiting=queued||task.status==='todo';
  const run=async():Promise<void>=>{
    if(sending.current||waiting)return;sending.current=true;setBusy(true);setError('');
    try{await taskRepository.move(task.projectId,task.id,{targetStatus:'todo',beforeTaskId:null,afterTaskId:null});setQueued(true);onQueued?.();onChanged?.();}
    catch(e){setError(e instanceof Error?e.message:'Не удалось отправить задачу воркеру');}
    finally{sending.current=false;setBusy(false);}
  };
  return <div data-pf-worker-start="" className="mx-3 mbs-3 mbe-2 space-y-2">{!waiting&&<p className="text-xs text-muted-foreground">Передай задачу воркеру — ход выполнения появится в LIVE.</p>}<Button type="button" disabled={busy||waiting} onClick={()=>void run()}>{waiting?'Задача в очереди':busy?'Отправляем…':'Сделать с помощью воркера'}</Button>{error&&<p role="alert" className="max-w-xs text-xs text-destructive">{error}</p>}</div>;
}
