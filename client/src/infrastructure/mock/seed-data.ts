import type { Project } from '@/domain/project/Project';
import type { User } from '@/domain/user/User';

export const seedProjects: Project[] = [
  {
    id: '01HXXXXXXXXXXXXXXXXXXXXX01',
    name: 'Acme site',
    status: 'active',
    gitRepoUrl: null,
    kbRepoFullName: null,
    isInbox: false,
    createdAt: new Date('2025-01-15'),
  },
  {
    id: '01HXXXXXXXXXXXXXXXXXXXXX02',
    name: 'Mobile app',
    status: 'active',
    gitRepoUrl: null,
    kbRepoFullName: null,
    isInbox: false,
    createdAt: new Date('2025-03-20'),
  },
  {
    id: '01HXXXXXXXXXXXXXXXXXXXXX03',
    name: 'Internal CRM',
    status: 'paused',
    gitRepoUrl: null,
    kbRepoFullName: null,
    isInbox: false,
    createdAt: new Date('2024-11-02'),
  },
  {
    id: '01HXXXXXXXXXXXXXXXXXXXXX04',
    name: 'Marketing pages',
    status: 'archived',
    gitRepoUrl: null,
    kbRepoFullName: null,
    isInbox: false,
    createdAt: new Date('2024-05-10'),
  },
];

export const seedUser: User = {
  id: '01HUSR0000000000000000001',
  email: 'oleg@projectsflow.ru',
  displayName: 'Oleg',
  avatarUrl: null,
};
