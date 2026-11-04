import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bot, ChartLine, FolderGit2, LifeBuoy, Mail, Megaphone, Shield, Users } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AdminLlmPanel } from '@/presentation/components/admin/AdminLlmPanel';
import { AdminMailingPanel } from '@/presentation/components/admin/mailing/AdminMailingPanel';
import { AdminStatsPanel } from '@/presentation/components/admin/AdminStatsPanel';
import { AdminProjectsTab } from '@/presentation/components/admin/AdminProjectsTab';
import { AdminSupportTab } from '@/presentation/components/admin/AdminSupportTab';
import { AdminEmailTab } from '@/presentation/components/admin/AdminEmailTab';
import { AdminUsersConsole } from '@/presentation/components/admin/users/AdminUsersConsole';
import { SectionPage } from '@/presentation/pages/SectionPage';

type Tab = 'stats' | 'projects' | 'users' | 'support' | 'mailing' | 'email' | 'ai';

const TABS: readonly { value: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { value: 'users', label: 'Пользователи', icon: Users },
  { value: 'stats', label: 'Статистика', icon: ChartLine },
  { value: 'projects', label: 'Проекты', icon: FolderGit2 },
  { value: 'support', label: 'Поддержка', icon: LifeBuoy },
  { value: 'mailing', label: 'Рассылки', icon: Megaphone },
  { value: 'email', label: 'Email', icon: Mail },
  { value: 'ai', label: 'ИИ', icon: Bot },
];

const isTab = (v: string | null): v is Tab => TABS.some((t) => t.value === v);

// «Администрирование». The tab lives in the URL (?tab=…): deep links from notifications
// (?tab=support) and the users console state (?tab=users&q=…&user=…) survive a reload.
// An inactive tab is not mounted, so each section loads its data only when opened.
export function AdminPage(): React.ReactElement {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab: Tab = isTab(raw) ? raw : 'users';
  // Recipients picked in «Пользователи» for «Рассылка выбранным».
  const [mailRecipients, setMailRecipients] = useState<readonly string[] | null>(null);

  const selectTab = (next: Tab): void => {
    // Other sections' parameters do not travel between tabs.
    setParams(next === 'users' ? {} : { tab: next });
  };

  return (
    <SectionPage icon={Shield} label="Администрирование">
      <Tabs value={tab} onValueChange={(next) => selectTab(next as Tab)} className="-mbs-1">
        {/* On phones the row is wider than the screen: it scrolls sideways instead of wrapping. */}
        <div className="-mx-4 overflow-x-auto overscroll-x-contain px-4 pf-scrollbar-hide sm:mx-0 sm:px-0">
          <TabsList className="w-max">
            {TABS.map(({ value, label, icon: Icon }) => (
              <TabsTrigger key={value} value={value} data-admin-tab={value}>
                <Icon className="size-3.5" /> {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="users" className="mbs-4">
          <AdminUsersConsole onMailSelected={(ids) => { setMailRecipients(ids); setParams({ tab: 'mailing' }); }} />
        </TabsContent>
        <TabsContent value="stats" className="mbs-4"><AdminStatsPanel /></TabsContent>
        <TabsContent value="projects" className="mbs-4"><AdminProjectsTab /></TabsContent>
        <TabsContent value="support" className="mbs-4"><AdminSupportTab /></TabsContent>
        <TabsContent value="mailing" className="mbs-4">
          <AdminMailingPanel presetUserIds={mailRecipients} onClearPreset={() => setMailRecipients(null)} />
        </TabsContent>
        <TabsContent value="email" className="mbs-4"><AdminEmailTab /></TabsContent>
        <TabsContent value="ai" className="mbs-4"><AdminLlmPanel /></TabsContent>
      </Tabs>
    </SectionPage>
  );
}
