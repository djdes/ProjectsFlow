async (page) => {
  await page.unroute('**/api/**');
  const now = '2026-10-07T12:00:00Z';
  const user = { id:'owner', email:'owner@example.test', displayName:'Алексей', avatarUrl:null, isAdmin:false, createdAt:now };
  const workspace = { id:'access-ws', name:'Команда проекта', icon:'🚀', kind:'team', ownerUserId:'owner', role:'owner', projectCount:3, memberCount:4, isCurrent:true, requireTaskApproval:true, workerEnabled:false, commitSyncMode:'off', createdAt:now };
  const members = [{userId:'owner', displayName:'Алексей', email:'owner@example.test', role:'owner', avatarUrl:null},{userId:'lead', displayName:'Наталья', email:'lead@example.test', role:'lead', avatarUrl:null},{userId:'editor', displayName:'Денис Волков', email:'editor@example.test', role:'editor', avatarUrl:null},{userId:'viewer', displayName:'Анна', email:'viewer@example.test', role:'viewer', avatarUrl:null}];
  const projects = ['Сайт компании','Каталог товаров','Внутренние процессы'].map((name,i)=>({id:'access-p'+i,workspaceId:workspace.id,name,icon:['🚀','📦','⚙️'][i],ownerId:'owner',isInbox:false,role:'owner',status:'active',memberCount:4,taskCount:0,description:null,coverUrl:null,gitRepoUrl:null,kbRepoFullName:null,kbKind:'native',financeVisibility:'all',createdAt:now}));
  const hidden = new Map(members.map(m=>[m.userId,[]]));
  const invites = [{id:'waiting',workspaceId:'access-ws',email:'colleague@example.test',role:'editor',excludedProjectIds:['access-p2'],expiresAt:'2026-10-14T12:00:00Z',createdAt:now,acceptedAt:null,acceptedByUserId:null,createdByUserId:'owner'}];
  const writes = [];
  const controls = { failInvites: false, delay: 0 };
  const tomorrow = '2026-10-14T12:00:00Z';
  page.on('pageerror',error=>writes.push({error:error.message}));
  await page.route('**/api/**', async route=>{
    const req=route.request(); const path=new URL(req.url()).pathname.replace(/^\/api/,''); const method=req.method();
    const json=(body,status=200)=>route.fulfill({status,contentType:'application/json; charset=utf-8',body:JSON.stringify(body)});
    if(path==='/fixture/state') return json({invites,writes,members});
    if(path==='/fixture/control') { const value=req.postDataJSON(); if(value.role) workspace.role=value.role; Object.assign(controls,value);return json({ok:true}); }
    if(path.includes('/stream')) return route.abort();
    if(path.endsWith('/dispatcher-candidates')) return json({candidates:[]});
    if(path.endsWith('/git-token-delegation')) return json({mine:{enabled:false,hasGithubToken:false},all:[]});
    if(method!=='GET') writes.push({path,method,body:req.postDataJSON()});
    if(path==='/me/stats/completed-today') return json({count:0});
    if(path==='/auth/me') return json({user});
    if(path==='/auth/me/usage') return json({plan:'prime',subscription:{startedAt:now,expiresAt:null},windows:{},isBlocked:false,blockedWindow:null,rubPerUsd:90,primeTrialAvailable:false,isAdmin:false});
    if(path==='/workspaces') return json({workspaces:[workspace]});
    if(path==='/workspaces/access-ws' && method==='PATCH') { Object.assign(workspace,req.postDataJSON()); return json({workspace}); }
    if(path==='/workspaces/access-ws/members') return json({members});
    if(path==='/workspaces/access-ws/projects') return json({projects});
    if(path==='/workspaces/access-ws/project-access') return json({projects:projects.map(({id,name,icon})=>({id,name,icon})),members:members.map(m=>({userId:m.userId,hiddenProjectIds:hidden.get(m.userId)}))});
    if(path.startsWith('/workspaces/access-ws/project-access/')) {
      const parts=path.split('/'); const p=parts[4], m=parts[5], visible=req.postDataJSON().visible;
      hidden.set(m,visible ? hidden.get(m).filter(id=>id!==p) : [...new Set([...hidden.get(m),p])]);
      return route.fulfill({status:204});
    }
    if(path==='/workspaces/access-ws/invites') {
      if(controls.failInvites) return json({message:'Не удалось загрузить приглашения'},503);
      if(controls.delay) await new Promise(r=>setTimeout(r,controls.delay));
      if(method==='POST'){
        const input=req.postDataJSON(), existing=invites.find(i=>i.email===input.email);
        if(existing) return json({invite:{...existing,reused:true}});
        const invite={...input,id:'inv'+invites.length,workspaceId:workspace.id,expiresAt:tomorrow,acceptedAt:null,acceptedByUserId:null,createdByUserId:user.id,createdAt:now,delivery:{email:'sent',site:'sent',telegram:'sent'},deliveryNextAttemptAt:null,lastSentAt:new Date().toISOString(),url:'https://example.test/invite/'+invites.length};
        invites.push(invite);return json({invite},201);
      }
      return json({invites});
    }
    if(path.startsWith('/workspaces/access-ws/invites/')) {
      const id=path.split('/')[4], invite=invites.find(i=>i.id===id);
      if(path.endsWith('/link')) return json({url:'https://example.test/invite/'+id});
      if(path.endsWith('/resend')) { Object.assign(invite,{expiresAt:tomorrow,lastSentAt:new Date().toISOString(),delivery:{email:'sent',site:'sent',telegram:'not_connected'}});return json({invite}); }
      if(method==='DELETE') {invites.splice(invites.findIndex(i=>i.id===id),1);return route.fulfill({status:204});}
    }
    if(path==='/workspaces/access-ws/assignee-digest') return json({settings:{enabled:false,hour:9,minute:0,daysOfWeek:[1,2,3,4,5],telegramGroupChatId:null,telegramGroupTitle:null,recipientMode:'all',recipientUserIds:[],projectMode:'all',projectIds:[],commitSyncEnabled:false,commitSyncHour:17,commitSyncMinute:0,commitSyncAction:'propose',eodReminderEnabled:false,eodReminderHour:17,eodReminderMinute:20},members:[]});
    if(path.endsWith('/assignee-digest/groups')) return json({groups:[]});
    if(path.endsWith('/commit-sync/projects')) return json({projects:[]});
    if(path.endsWith('/kanban-columns')) return json({columns:[]});
    if(path==='/projects') return json({projects});
    const project=projects.find(p=>path.startsWith('/projects/'+p.id));
    if(project) {
      if(path==='/projects/'+project.id) return json({project});
      if(path.endsWith('/members')) return json({members:members.filter(m=>!hidden.get(m.userId).includes(project.id)).map(m=>({userId:m.userId,role:m.role,projectId:project.id,joinedAt:now,user:{...m,id:m.userId,createdAt:now}}))});
      if(path.endsWith('/tasks')) return json({tasks:[]});
      if(path.endsWith('/views')) return json({views:[]});
      if(path.endsWith('/commits')) return json({commits:[]});
      if(path.endsWith('/properties')) return json({properties:[],values:[]});
      if(path.endsWith('/activity')) return json({items:[],nextCursor:null});
    }
    if(path==='/workspaces/chat/rooms') return json({rooms:[]});
    if(path==='/me/kanban-colors') return json({colors:{}});
    if(path==='/me/ui-prefs') return json({prefs:{}});
    return json({});
  });
  await page.setViewportSize({width:1440,height:1000});
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto('http://127.0.0.1:5184/workspaces/access-ws/settings');
  await page.getByRole('heading',{name:'Ожидают принятия',exact:true}).waitFor({timeout:30000});
  await page.getByRole('textbox',{name:'Email для приглашения'}).scrollIntoViewIfNeeded();
  await page.screenshot({path:'C:/www/ProjectsFlow/reference/invitations/actual/01-workspace.png'});
  return {title:await page.title(),url:page.url(),writes,body:(await page.locator('body').innerText()).slice(0,2200)};
}
