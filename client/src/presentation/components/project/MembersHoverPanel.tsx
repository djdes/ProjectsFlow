import * as React from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { ProjectMember, ProjectRole } from '@/domain/project/ProjectMembership';
import { avatarColor, getInitials } from '@/presentation/layout/projectIcons';
import { Collapse } from '@/presentation/components/motion/Collapse';
import { MembersInviteForm } from './MembersInviteForm';

// Сколько участников показываем сразу; остальные — под кнопкой «Показать всех».
const VISIBLE = 6;

// «Владелец» на уровне проекта не показываем: роли — «Редактор»/«Наблюдатель», а создателя
// (projects.owner_id) помечаем нейтральным «Создал» (см. MemberRow).
const ROLE_LABEL: Record<ProjectRole, string> = {
  owner: 'Редактор',
  editor: 'Редактор',
  viewer: 'Наблюдатель',
};

// Панель участников проекта (раскрывается при наведении на аватар-стек, см. MemberAvatarStack).
// Показывает часть участников (аватар + ник + email + роль); ниже — «Показать всех» с плавным
// раскрытием остальных. Клик по аватару — увеличение в маленьком модальном окне.
export function MembersHoverPanel({
  members,
  canInvite = false,
  ownerId,
}: {
  members: ProjectMember[];
  // Право приглашать (editor+). Если true — в подвале панели рисуем форму приглашения
  // в пространство (email + «Из знакомых» + роль + отправка).
  canInvite?: boolean;
  // Создатель проекта (projects.owner_id) — помечаем его «Создал», а не ролью.
  ownerId?: string;
}): React.ReactElement {
  const [showAll, setShowAll] = React.useState(false);
  const [zoom, setZoom] = React.useState<ProjectMember | null>(null);

  const head = members.slice(0, VISIBLE);
  const rest = members.slice(VISIBLE);

  return (
    <div className="flex flex-col">
      <div className="px-3 py-2 text-xs font-medium text-muted-foreground">
        Участники · {members.length}
      </div>
      <div className="max-h-[60vh] overflow-y-auto pb-1">
        {head.map((m) => (
          <MemberRow key={m.userId} member={m} isCreator={m.userId === ownerId} onZoom={() => setZoom(m)} />
        ))}
        {rest.length > 0 && (
          <Collapse open={showAll}>
            {rest.map((m) => (
              <MemberRow key={m.userId} member={m} isCreator={m.userId === ownerId} onZoom={() => setZoom(m)} />
            ))}
          </Collapse>
        )}
      </div>

      {rest.length > 0 && !showAll && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="mx-1 mb-1 rounded-md px-2 py-1.5 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
        >
          Показать всех (+{rest.length})
        </button>
      )}

      {canInvite && <MembersInviteForm />}

      <AvatarZoom member={zoom} onClose={() => setZoom(null)} />
    </div>
  );
}

function MemberRow({
  member,
  isCreator = false,
  onZoom,
}: {
  member: ProjectMember;
  isCreator?: boolean;
  onZoom: () => void;
}): React.ReactElement {
  return (
    <div className="flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-hover">
      <button
        type="button"
        onClick={onZoom}
        className="shrink-0 rounded-full outline-none transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Увеличить аватар: ${member.user.displayName}`}
      >
        <Avatar className="size-8">
          {member.user.avatarUrl ? (
            <AvatarImage src={member.user.avatarUrl} alt={member.user.displayName} />
          ) : null}
          <AvatarFallback className={cn('text-[10px]', avatarColor(member.user.displayName))}>
            {getInitials(member.user.displayName)}
          </AvatarFallback>
        </Avatar>
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{member.user.displayName}</span>
          <span className="shrink-0 text-[10px] text-muted-foreground">
            {isCreator ? 'Создал' : ROLE_LABEL[member.role]}
          </span>
        </div>
        <div className="truncate text-xs text-muted-foreground">{member.user.email}</div>
      </div>
    </div>
  );
}

// Увеличенный аватар участника в маленьком модальном окне.
function AvatarZoom({
  member,
  onClose,
}: {
  member: ProjectMember | null;
  onClose: () => void;
}): React.ReactElement {
  return (
    <Dialog open={member !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xs gap-4 sm:max-w-xs">
        <DialogTitle className="truncate pr-6 text-base">
          {member?.user.displayName ?? ''}
        </DialogTitle>
        <div className="flex flex-col items-center gap-3">
          <Avatar className="size-40">
            {member?.user.avatarUrl ? (
              <AvatarImage src={member.user.avatarUrl} alt={member.user.displayName} />
            ) : null}
            <AvatarFallback
              className={cn('text-4xl', member ? avatarColor(member.user.displayName) : '')}
            >
              {member ? getInitials(member.user.displayName) : ''}
            </AvatarFallback>
          </Avatar>
          <div className="text-center">
            <div className="text-sm font-medium">{member?.user.displayName}</div>
            <div className="text-xs text-muted-foreground">{member?.user.email}</div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
