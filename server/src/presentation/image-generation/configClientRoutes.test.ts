import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import express from 'express';
import { ImageGenerationService } from '../../application/image-generation/ImageGenerationService.js';
import type { ImageGeneration } from '../../domain/image-generation/ImageGeneration.js';
import type { AuthenticateAgentToken } from '../../application/agent/AuthenticateAgentToken.js';
import { AgentTokenInvalidError } from '../../domain/agent/errors.js';
import { imageGenerationRouter, imageGenerationAgentRouter } from './routes.js';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3XcAAAAASUVORK5CYII=','base64');
const id='8f562b2b-75c9-42c0-9e07-f8424728dc24';
async function fixture() {
  let job: ImageGeneration | null=null;
  const files=new Map<string,Buffer>();
  const service=new ImageGenerationService({dispatcherUserId:'dispatcher',idGen:()=>id,
    jobs:{async create(input){ job={...input,status:'queued',claimToken:null,storageKey:null,errorMessage:null,createdAt:new Date(),startedAt:null,finishedAt:null};return job;},
      async get(){return job;},async list(user){return job?.userId===user?[job]:[];},async claim(){if(!job)return null;job.status='running';job.claimToken=id;return job;},
      async complete(_id,_token,key,error){if(!job)return false;Object.assign(job,{storageKey:key,errorMessage:error,status:key?'succeeded':'failed'});return true;}},
    storage:{async put(input){files.set(input.storageKey,input.data);},async read(key){const data=files.get(key);return data?{data,mimeType:'image/png'}:null;},async delete(key){files.delete(key);}}});
  const authenticate={async execute(token:string){
    if(token==='invalid')throw new AgentTokenInvalidError();
    return {user:{id:token==='project'?'owner':token},token:{id:'token',scopeKind:token==='project'?'project':'account'}};
  }} as unknown as AuthenticateAgentToken;
  const app=express();app.use(express.json());
  app.use((req,_res,next)=>{if(req.get('X-Test-Session'))req.user={id:req.get('X-Test-Session')!} as express.Request['user'];next();});
  app.use('/api/ai/image-jobs',imageGenerationRouter(service,authenticate));
  app.use('/api/agent/image-jobs',imageGenerationAgentRouter(service,authenticate));
  const server=createServer(app);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();if(!address||typeof address==='string')throw Error('No address');
  const url=`http://127.0.0.1:${address.port}`;
  const request=(path:string,token?:string,init:RequestInit={})=>fetch(url+path,{...init,headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...init.headers}});
  return {service,files,request,async close(){server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}};
}

test('image API accepts sessions and account tokens; invalid and project tokens cannot create or read jobs',async()=>{
  const f=await fixture();try{
    const path='/api/ai/image-jobs';
    assert.equal((await f.request(path)).status,401);
    assert.equal((await f.request(path,'invalid')).status,401);
    assert.equal((await f.request(path,'project')).status,403);
    const created=await f.request(path,'owner',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:'Фото'})});
    assert.equal(created.status,202);
    assert.equal((await f.request(`${path}/${id}`,'other')).status,404);
    assert.equal((await f.request(`${path}/${id}`,undefined,{headers:{'X-Test-Session':'owner'}})).status,200);
    assert.equal((await f.request(`${path}/${id}/image`,'owner')).status,409);
  }finally{await f.close();}
});

test('Config uploads references and sizes; only the claimed dispatcher gets inputs and only the author gets the result',async()=>{
  const f=await fixture();try{
    const form=new FormData();form.set('prompt','Переделать обложку');form.set('width','1080');form.set('height','1350');form.append('images',new Blob([png],{type:'image/png'}),'cover.png');
    const created=await f.request('/api/ai/image-jobs','owner',{method:'POST',body:form});assert.equal(created.status,202);
    const state=await created.json() as Record<string,unknown>;assert.equal('input' in state,false);
    assert.equal((await f.request('/api/agent/image-jobs/claim','other',{method:'POST'})).status,403);
    const claimed=await(await f.request('/api/agent/image-jobs/claim','dispatcher',{method:'POST'})).json() as {job:{input:{width:number;height:number;images:string[]}}};
    assert.equal(claimed.job.input.width,1080);assert.equal(claimed.job.input.height,1350);assert.equal(claimed.job.input.images[0],`data:image/png;base64,${png.toString('base64')}`);
    await assert.rejects(f.service.input('dispatcher',id,'wrong'),{status:404});
    await f.service.complete('dispatcher',id,id,png);
    assert.equal((await f.request(`/api/ai/image-jobs/${id}/image`,'dispatcher')).status,404);
    const result=await f.request(`/api/ai/image-jobs/${id}/image`,'owner');assert.equal(result.status,200);assert.deepEqual(Buffer.from(await result.arrayBuffer()),png);
  }finally{await f.close();}
});

test('invalid image inputs are rejected before anything is stored or queued',async()=>{
  const f=await fixture();try{
    await assert.rejects(f.service.create('owner','Фото',undefined,{images:[{mimeType:'image/png',data:Buffer.from('not png')}]}),{status:400});
    await assert.rejects(f.service.create('owner','Фото',undefined,{width:100000}),{status:400});
    await assert.rejects(f.service.create('owner','Фото',undefined,{images:Array.from({length:9},()=>({mimeType:'image/png',data:png}))}),{status:400});
    assert.equal(f.files.size,0);assert.deepEqual(await f.service.list('owner'),[]);
  }finally{await f.close();}
});
