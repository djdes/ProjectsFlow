const {test}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
test('the installed MCP advertises approval and custom columns and actually submits approval to the API',async()=>{
 const entry=path.resolve(__dirname,'../dist/index.js');
 const requireMcp=createRequire(path.resolve(entry));
 const {Client}=requireMcp('@modelcontextprotocol/sdk/client/index.js'),{StdioClientTransport}=requireMcp('@modelcontextprotocol/sdk/client/stdio.js');
 const requests=[];
 const server=http.createServer((req,res)=>{let body='';req.on('data',chunk=>{body+=chunk});req.on('end',()=>{const payload=JSON.parse(body);requests.push({url:req.url,payload});res.setHeader('Content-Type','application/json');res.end(JSON.stringify({task:{id:'task',status:payload.targetStatus??payload.status}}))})});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const transport=new StdioClientTransport({command:process.execPath,args:[entry],env:{...process.env,PROJECTSFLOW_API_URL:'http://127.0.0.1:'+server.address().port+'/api',PROJECTSFLOW_AGENT_TOKEN:'pfat_test_contract'},stderr:'pipe'});
 const client=new Client({name:'worker-contract-test',version:'1.0.0'});
 try{
  await client.connect(transport);const tools=(await client.listTools()).tools;
  const move=tools.find(t=>t.name==='pf_move_task');const domain=fs.readFileSync(path.resolve(__dirname,'../../server/src/domain/task/Task.ts'),'utf8');const block=domain.match(/export const TASK_STATUSES[^=]*=\s*\[([\s\S]*?)\];/)[1];const expected=[...block.matchAll(/'([a-z_0-9]+)'/g)].map(m=>m[1]).filter(status=>status!=='todo');assert.deepEqual([...move.inputSchema.properties.targetStatus.enum].sort(),expected.sort());assert.ok(move.inputSchema.properties.targetStatus.enum.includes('pending_approval'));assert.ok(move.inputSchema.properties.targetStatus.enum.includes('custom_5'));
  for(const status of ['pending_approval','custom_5']){
   const result=await client.callTool({name:'pf_move_task',arguments:{projectId:'project',taskId:'task',targetStatus:status}});
   assert.equal(result.isError,undefined);assert.ok(JSON.stringify(result.content).includes(status));
  }
  assert.equal(requests.length,2);assert.equal(requests[0].payload.targetStatus,'pending_approval');
  assert.equal(requests[0].url,'/api/agent/projects/project/tasks/task/move');
  const invalid=await client.callTool({name:'pf_move_task',arguments:{projectId:'project',taskId:'task',targetStatus:'unknown'}});
  assert.equal(invalid.isError,true);assert.equal(requests.length,2,'unknown statuses never reach the API');
  const create=tools.find(t=>t.name==='pf_create_task');
  for(const status of ['todo','in_progress','awaiting_clarification']){
   assert.ok(!create.inputSchema.properties.status.enum.includes(status));
   const blocked=await client.callTool({name:'pf_create_task',arguments:{projectId:'project',description:'Черновик',status}});
   assert.equal(blocked.isError,true);assert.equal(requests.length,2);
  }
  const queued=await client.callTool({name:'pf_move_task',arguments:{projectId:'project',taskId:'task',targetStatus:'todo'}});
  assert.equal(queued.isError,true);assert.equal(requests.length,2);
  const draft=await client.callTool({name:'pf_create_task',arguments:{projectId:'project',description:'Черновик'}});
  assert.equal(draft.isError,undefined);assert.equal(requests.at(-1).payload.status,'backlog');
 }finally{await client.close();await new Promise(resolve=>server.close(resolve))}
});
