import test from 'node:test';
import assert from 'node:assert/strict';
import { ImageGenerationService } from './ImageGenerationService.js';
import type { ImageGeneration } from '../../domain/image-generation/ImageGeneration.js';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3XcAAAAASUVORK5CYII=','base64');
function fixture(){
  const job:ImageGeneration={id:'job',userId:'owner',dispatcherUserId:'dispatcher',prompt:'Фото',status:'running',claimToken:'lease',storageKey:null,errorMessage:null,createdAt:new Date(),startedAt:new Date(),finishedAt:null};
  let stored:Buffer|undefined;let updates=0;
  const service=new ImageGenerationService({jobs:{async quota(){return {active:0,remaining:10,releaseAfterSeconds:[]};},async create(input){return {...job,...input,status:'queued'};},async get(){return job;},async list(user){return user===job.userId?[job]:[];},async claim(){return job;},async complete(_id,_token,key,error){updates++;Object.assign(job,{status:key?'succeeded':'failed',storageKey:key,errorMessage:error});return true;}},storage:{async put(input){stored=input.data;},async read(){return stored?{data:stored,mimeType:'image/png'}:null;},async delete(){}},dispatcherUserId:'dispatcher',idGen:()=> 'job'});
  return {job,service,updates:()=>updates};
}
test('only the author can read generated files; the dispatcher cannot bypass ownership',async()=>{
  const f=fixture();await f.service.complete('dispatcher','job','lease',png);
  assert.deepEqual(await f.service.image('owner','job'),png);
  for(const user of ['other','dispatcher'])await assert.rejects(f.service.image(user,'job'),{status:404});
  await f.service.complete('dispatcher','job','lease',png);assert.equal(f.updates(),1);
});
test('only the configured dispatcher and exact claim can complete an image job',async()=>{
  const f=fixture();
  await assert.rejects(f.service.claim('other'),{status:403});
  await assert.rejects(f.service.complete('other','job','lease',png),{status:403});
  await assert.rejects(f.service.complete('dispatcher','job','wrong',png),{status:404});
  await assert.rejects(f.service.complete('dispatcher','job','lease',Buffer.from('not png')),{status:400});
  assert.equal(f.updates(),0);
});
test('empty prompts are rejected and failed generations expose a safe retry message',async()=>{
  const f=fixture();await assert.rejects(f.service.create('owner',' '),{status:400});
  await assert.rejects(f.service.create('owner','x'.repeat(8001)),{status:400});
  await f.service.complete('dispatcher','job','lease');assert.equal(f.job.status,'failed');assert.match(f.job.errorMessage!,/Попробуйте/);
});

test('conversation images use the existing conversation authorization and survive service restart', async () => {
  const jobs = new Map<string, ImageGeneration>();
  let allowed = true;
  const deps = {
    jobs: {
      async quota() { return { active: 0, remaining: 10, releaseAfterSeconds: [] }; },
      async create(input: Pick<ImageGeneration, 'id'|'userId'|'dispatcherUserId'|'prompt'|'conversationId'>) {
        const job = { ...fixture().job, ...input, status: 'queued' as const };
        jobs.set(job.id, job); return job;
      },
      async list(user: string, chat?: string) { return [...jobs.values()].filter(job => job.userId === user && (!chat || job.conversationId === chat)); },
      async get(id: string) { return jobs.get(id) ?? null; },
      async claim() { return null; },
      async complete() { return true; },
    },
    conversations: { async get(user: string, chat: string) { if (!allowed || user !== 'owner' || chat !== 'chat') throw new Error('chat access denied'); return {} as never; } },
    storage: { async put() {}, async read() { return null; }, async delete() {} },
    dispatcherUserId: 'dispatcher', idGen: () => 'photo',
  };
  const first = new ImageGenerationService(deps);
  await first.create('owner', 'Фото чашки', 'chat');
  const reopened = new ImageGenerationService(deps);
  assert.equal((await reopened.list('owner', 'chat'))[0]!.conversationId, 'chat');
  await assert.rejects(reopened.create('other', 'Фото', 'chat'));
  assert.equal(jobs.size, 1);
  allowed = false;
  await assert.rejects(reopened.list('owner', 'chat'));
  await assert.rejects(reopened.owned('owner', 'photo'));
});
