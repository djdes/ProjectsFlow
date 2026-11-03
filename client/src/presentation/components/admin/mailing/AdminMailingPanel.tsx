import { useState } from 'react';
import { FileText, Megaphone } from 'lucide-react';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { MailingCampaignsView } from './MailingCampaignsView';
import { MailingTemplatesView } from './MailingTemplatesView';

type View = 'campaigns' | 'templates';

const VIEWS = [
  { value: 'campaigns', label: 'Рассылки', icon: <Megaphone className="size-3.5" /> },
  { value: 'templates', label: 'Шаблоны', icon: <FileText className="size-3.5" /> },
] as const;

// «Администрирование» → «Рассылки»: marketing letters to platform users.
export function AdminMailingPanel(): React.ReactElement {
  const [view, setView] = useState<View>('campaigns');
  // «Создать рассылку» from a template opens the composer with that template.
  const [preselect, setPreselect] = useState<string | null>(null);

  return (
    <div className="space-y-4" data-pf-admin-mailing>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SegmentedControl value={view} onChange={setView} options={VIEWS} />
        <p className="text-xs text-muted-foreground">Письма уходят постепенно, с учётом лимита почтового сервера. Отписавшимся не отправляются.</p>
      </div>
      {view === 'campaigns' ? (
        <MailingCampaignsView preselectTemplateId={preselect} />
      ) : (
        <MailingTemplatesView onUseTemplate={(id) => { setPreselect(id); setView('campaigns'); }} />
      )}
    </div>
  );
}
