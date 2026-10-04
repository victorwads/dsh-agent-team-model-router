import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit';
import Persistence from '@deepseek-ai/dsh-session-persistence-jsonl';
import Subagents from '@deepseek-ai/dsh-subagent';
import * as Spawn from '@deepseek-ai/dsh-subagent-spawn-in-process';
import * as Fork from '@deepseek-ai/dsh-subagent-fork-in-process';
import Teams from '@deepseek-ai/dsh-experimental-agent-team';
import { SessionId } from '@deepseek-ai/dsh-session';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { MockAdapter, textResponse, toolCallResponse } from './adapter.mjs';
import { TestSessionQuery } from './query.mjs';
import * as Router from '../lib/index.js';
import * as TeamTools from '@deepseek-ai/dsh-experimental-tool-agent-team';
import Loader from '@deepseek-ai/cordis-plugin-loader';
import { assertCompatibility } from '../lib/compatibility/dsh-0.2.0-rc.2.js';
const signal = new AbortController().signal;
async function setup(t, script, options = {}) {
  const ctx = new Context();
  t.after(() => ctx.fiber.dispose());
  await mountAgentLoopTestDependencies(ctx);
  const storageRoot = options.root ?? await mkdtemp(join(tmpdir(), 'router-test-'));
  await ctx.plugin(Persistence, { root: storageRoot });
  await ctx.plugin(TestSessionQuery);
  await ctx.plugin(AgentLoop, { agents: [] });
  await ctx.plugin(Subagents);
  await ctx.plugin(Spawn, { providerName: 'spawn' });
  await ctx.plugin(Fork, { providerName: 'fork' });
  await ctx.plugin(Teams);
  const adapter = new MockAdapter(script);
  adapter.resolveModel = async (provider, model) => {
    if (!['A','B','C'].includes(model)) throw new Error('Unknown model "' + model + '" for provider "' + provider + '"');
    return {provider,id:model,name:model,reasoning:{efforts:[{id:'low',name:'Low'},{id:'high',name:'High'}],defaultEffort:'low'}};
  };
  const secondAdapter = new MockAdapter([]);
  secondAdapter.resolveModel = adapter.resolveModel;
  secondAdapter.stream = async function* (request) { secondAdapter.requests.push(request); yield* adapter.stream(request); };
  ctx.llm.registerAdapter(['one'], adapter);
  ctx.llm.registerAdapter(['two'], secondAdapter);
  ctx.on('agent/pre-step', async (payload,next) => payload.agent.id === 'lead' && !options.driveLead ? {kind:'reject'} : next(), {prepend:true});
  ctx.provide('subagentModelSelection', { current: () => ({enabled:options.enabled !== false,allowedModels:[{provider:'one',model:'A'},{provider:'two',model:'B'},{provider:'one',model:'C'}]}) });
  let routerFiber;
  if (options.loader) {
    await ctx.plugin(Loader,{baseUrl:new URL('../',import.meta.url).href});
    if(options.reverseLoader)await ctx.loader.create({name:'@deepseek-ai/dsh-experimental-tool-agent-team',config:{}});
    const routerId=await ctx.loader.create({name:'./lib/index.js'});
    if(!options.reverseLoader)await ctx.loader.create({name:'@deepseek-ai/dsh-experimental-tool-agent-team',config:{}});
    await ctx.loader.await();
    routerFiber=ctx.loader.resolve(routerId).fiber;
    assert.equal(routerFiber.state,2);
    for(const entry of ctx.loader.entries())assert.equal(entry.fiber?.state,2);
  } else if (!options.noRouter) routerFiber = await ctx.plugin(Router);
  const lead = options.resume ? (await ctx.agents.resume({resumeSessionId:SessionId('lead'),agentOptions:{provider:'one',model:'A'}})).agent : await ctx.agentLoop.create(SessionId('lead'), {provider:'one',model:'A'});
  return {ctx,lead,adapter,secondAdapter,storageRoot,routerFiber};
}
async function call(ctx, agent, name, args) { const def = ctx.tools.get(name,agent); assert.ok(def,'tool '+name); return def.execute(args,{agent,signal}); }
async function until(predicate) { const deadline=Date.now()+5000; while(!predicate()){if(Date.now()>deadline)throw new Error('Timed out');await new Promise(r=>setTimeout(r,10));} }
async function spawn(ctx,lead,args={}) { const result = await call(ctx,lead,'spawn_teammate',{name:'backend',description:'Implementation',prompt:'Work',...args}); return { ...result, member: ctx.agentTeams.listMembers(lead).find(row=>row.name===result.member.target) }; }
test('explicit spawn reaches actual provider B; default spawn inherits A', async t => {
 const {ctx,lead,adapter,secondAdapter}=await setup(t,[textResponse('B'),textResponse('A')]);
 const first=await spawn(ctx,lead,{provider:'two',model:'B',reasoning_effort:'high'});
 await until(()=>adapter.requests.length>=1).catch(error=>{console.log('REQUESTS',adapter.requests,'MEMBERS',ctx.agentTeams.listMembers(lead));throw error;});
 await until(()=>!ctx.agents.get(first.member.id));
 assert.equal(adapter.requests[0].provider,'two'); assert.equal(adapter.requests[0].model,'B');
 assert.equal(secondAdapter.requests.length,1);assert.equal(secondAdapter.requests[0].reasoningEffort,'high');
 await spawn(ctx,lead,{name:'inherited'}); await until(()=>adapter.requests.length===2);
 assert.equal(adapter.requests[1].provider,'one'); assert.equal(adapter.requests[1].model,'A');
});
test('self switch applies on next actual inference; same session and cold resume preserve B', async t => {
 const {ctx,lead,adapter}=await setup(t,[toolCallResponse('switch-1','switch_model',{provider:'two',model:'B'}),textResponse('B next'),textResponse('B resumed')]);
 const started=await spawn(ctx,lead);
 await until(()=>adapter.requests.length===2 && !ctx.agents.get(started.member.id));
 assert.deepEqual(adapter.requests.slice(0,2).map(r=>r.model),['A','B']);
 const handle=await ctx.sessionPersistence.open(started.member.id,'read');
 const events=(await handle.read()).events;await handle.close();
 assert.ok(events.some(e=>e.type==='model/selection'));
 assert.equal(ctx.agentTeams.listMembers(lead)[1].id,started.member.id);
 await ctx.agentTeams.sendMessage(lead,{target:'backend',content:[{type:'text',text:'Continue, retaining prior work'}],signal});
 await until(()=>adapter.requests.length===3 && !ctx.agents.get(started.member.id));
 assert.equal(adapter.requests[2].model,'B');
 assert.ok(JSON.stringify(adapter.requests[2]).includes('B next'));
});
test('multiple switches A → B → C → A preserve one session and full history', async t => {
 const {ctx,lead,adapter}=await setup(t,[toolCallResponse('s1','switch_model',{provider:'two',model:'B'}),toolCallResponse('s2','switch_model',{provider:'one',model:'C'}),toolCallResponse('s3','switch_model',{provider:'one',model:'A'}),textResponse('done')]);
 const started=await spawn(ctx,lead);
 await until(()=>adapter.requests.length===4 && !ctx.agents.get(started.member.id));
 assert.deepEqual(adapter.requests.map(r=>[r.provider,r.model]),[['one','A'],['two','B'],['one','C'],['one','A']]);
 assert.ok(adapter.requests.every(r=>r.sessionId===started.member.id));
 assert.equal(ctx.agentTeams.listMembers(lead).length,2);
 assert.ok(JSON.stringify(adapter.requests[3].messages).includes('switch_model'));
});
test('same route is a no-op, invalid effort and disallowed route do not commit', async t => {
 const {ctx,lead,adapter}=await setup(t,[toolCallResponse('same','switch_model',{provider:'one',model:'A'}),toolCallResponse('bad-effort','switch_model',{provider:'two',model:'B',reasoning_effort:'impossible'}),toolCallResponse('bad-model','switch_model',{provider:'one',model:'nonexistent'}),textResponse('done')]);
 const started=await spawn(ctx,lead);
 await until(()=>adapter.requests.length===4 && !ctx.agents.get(started.member.id));
 assert.ok(adapter.requests.every(r=>r.model==='A'));
 const handle=await ctx.sessionPersistence.open(started.member.id,'read');const events=(await handle.read()).events;await handle.close();
 assert.equal(events.filter(e=>e.type==='model/selection').length,0);
});
test('model discovery reports runtime metadata and allowed routes only', async t => {
 const {ctx,lead}=await setup(t,[]);
 const result=await call(ctx,lead,'list_models',{});
 assert.equal(result.routes.length,3);assert.ok(result.routes.every(r=>r.available && r.metadata.reasoning.defaultEffort==='low'));
 await assert.rejects(call(ctx,lead,'list_models',{provider:'unallowed'}),/not allowed/);
});
test('Lead switch waits for next inference, duplicates are no-ops, Team state survives', async t => {
 const {ctx,lead,adapter}=await setup(t,[toolCallResponse('inspect','get_current_model',{}),textResponse('new route')]);
 let release;const blocked=new Promise(resolve=>{release=resolve;});let entered=false;
 const original=adapter.stream.bind(adapter);
 adapter.stream=async function* (options) { for await(const chunk of original(options)){if(!entered){entered=true;await blocked;}yield chunk;} };
 const started=await spawn(ctx,lead);await until(()=>entered);
 const live=ctx.agents.get(started.member.id);assert.ok(live);
 const task=await ctx.agentTeams.createTask(lead,{subject:'Implementation',description:'Retain owner'});
 await ctx.agentTeams.updateTask(live,{taskId:task.id,expectedRevision:task.revision,action:'claim'});
 const before=ctx.agentTeams.listTasks(lead);
 const switched=await call(ctx,lead,'switch_teammate_model',{teammate:'backend',provider:'two',model:'B'});
 assert.equal(switched.current.model,'A');assert.equal(switched.pending.model,'B');
 const duplicate=await call(ctx,lead,'switch_teammate_model',{teammate:'backend',provider:'two',model:'B'});
 assert.equal(duplicate.changed,false);assert.equal(ctx.agents.get(live.id),live);
 await assert.rejects(call(ctx,live,'switch_teammate_model',{teammate:'backend',provider:'one',model:'C'}),/Only the Team Lead/);
 const receipt=await ctx.agentTeams.sendMessage(lead,{target:'backend',content:[{type:'text',text:'mailbox context retained'}],signal});
 assert.ok(receipt.messageId);assert.deepEqual(ctx.agentTeams.listTasks(lead),before);
 release();await until(()=>adapter.requests.length===2 && !ctx.agents.get(live.id));
 assert.deepEqual(adapter.requests.map(r=>r.model),['A','B']);
 assert.equal(adapter.requests[0].sessionId,adapter.requests[1].sessionId);
 assert.ok(JSON.stringify(adapter.requests[1].messages).includes('mailbox context retained'));
 assert.deepEqual(ctx.agentTeams.listTasks(lead),before);
 await assert.rejects(call(ctx,lead,'switch_teammate_model',{teammate:'backend',provider:'one',model:'C'}),/cold/);
});
test('unknown registered-route model fails adapter validation without changing inference', async t => {
 const {ctx,lead,adapter,secondAdapter}=await setup(t,[toolCallResponse('invalid','switch_model',{provider:'two',model:'B'}),textResponse('still A')]);
 const original=adapter.resolveModel;
 adapter.resolveModel=async (provider,model)=>{if(model==='B')throw new Error('Unknown model B');return original(provider,model);};
 secondAdapter.resolveModel=adapter.resolveModel;
 const started=await spawn(ctx,lead);await until(()=>adapter.requests.length===2 && !ctx.agents.get(started.member.id));
 assert.ok(adapter.requests.every(r=>r.model==='A'));
});
test('full runtime restart restores selection and Team identity from native persisted events', async t => {
 const first=await setup(t,[toolCallResponse('s1','switch_model',{provider:'two',model:'B'}),textResponse('Before restart')]);
 const started=await spawn(first.ctx,first.lead);
 await until(()=>first.adapter.requests.length===2 && !first.ctx.agents.get(started.member.id));
 await first.ctx.sessions.flush(first.lead.session);await first.ctx.fiber.dispose();
 const second=await setup(t,[textResponse('After restart')],{root:first.storageRoot,resume:true});
 await second.ctx.agentTeams.sendMessage(second.lead,{target:'backend',content:[{type:'text',text:'After process restart'}],signal});
 await until(()=>second.adapter.requests.length===1 && !second.ctx.agents.get(started.member.id));
 assert.equal(second.adapter.requests[0].provider,'two');assert.equal(second.adapter.requests[0].model,'B');
 assert.ok(JSON.stringify(second.adapter.requests[0].messages).includes('Before restart'));
 assert.equal(second.ctx.agentTeams.listMembers(second.lead)[1].id,started.member.id);
});
test('fork spawn overrides route without inheriting Lead model-selection intent', async t => {
 const {ctx,lead,adapter}=await setup(t,[textResponse('forked')]);
 lead.session.append('model/selection',{provider:'one',model:'C'});
 const started=await spawn(ctx,lead,{context:'fork',provider:'two',model:'B'});
 await until(()=>adapter.requests.length===1 && !ctx.agents.get(started.member.id));
 assert.equal(adapter.requests[0].model,'B');assert.equal(adapter.requests[0].provider,'two');
});
test('disabled model selection preserves spawn inheritance but rejects explicit selection', async t => {
 const {ctx,lead,adapter}=await setup(t,[textResponse('inherit')],{enabled:false});
 assert.equal((await call(ctx,lead,'list_models',{})).enabled,false);
 await assert.rejects(spawn(ctx,lead,{provider:'two',model:'B'}),/disabled/);
 const started=await spawn(ctx,lead);await until(()=>adapter.requests.length===1 && !ctx.agents.get(started.member.id));
 assert.equal(adapter.requests[0].model,'A');
});
test('missing compatibility API fails clearly', () => {
 assert.throws(()=>assertCompatibility({}),/Missing DSH API/);
});
test('invalid and aborted lead switches leave actual current route intact', async t => {
 const {ctx,lead,adapter}=await setup(t,['hang']);
 const started=await spawn(ctx,lead);await until(()=>adapter.requests.length===1);
 const live=ctx.agents.get(started.member.id);
 await assert.rejects(call(ctx,live,'switch_model',{provider:'two',model:'B',reasoning_effort:'unsupported'}),/effort/);
 const aborted=new AbortController();aborted.abort(new Error('cancelled'));
 await assert.rejects(ctx.tools.get('switch_model',live).execute({provider:'two',model:'B'},{agent:live,signal:aborted.signal}),/cancelled/);
 assert.equal((await call(ctx,live,'get_current_model',{})).current.model,'A');
 assert.equal((await call(ctx,live,'get_current_model',{})).pending,null);
 assert.equal(live.session.snapshotEvents().filter(e=>e.type==='model/selection').length,0);
 live.cancel({kind:'user'});await until(()=>!ctx.agents.get(live.id));
});
test('provider removed after opt-in is unavailable and rejects switch without route mutation', async t => {
 const {ctx,lead,adapter}=await setup(t,['hang']);
 const started=await spawn(ctx,lead);await until(()=>adapter.requests.length===1);
 const live=ctx.agents.get(started.member.id);const original=ctx.llm.listProviders.bind(ctx.llm);
 ctx.llm.listProviders=()=>original().filter(p=>p.id!=='two');
 const models=await call(ctx,live,'list_models',{provider:'two'});assert.equal(models.routes[0].available,false);
 await assert.rejects(call(ctx,live,'switch_model',{provider:'two',model:'B'}),/Unknown provider/);
 assert.equal((await call(ctx,live,'get_current_model',{})).pending,null);
 live.cancel({kind:'user'});await until(()=>!ctx.agents.get(live.id));
});
test('concurrent spawn routes are isolated and tool schemas expose routing fields', async t => {
 const {ctx,lead,adapter}=await setup(t,[textResponse('first'),textResponse('second')]);
 const schema=ctx.tools.schemas(lead).find(tool=>tool.name==='spawn_teammate');
 assert.ok(schema.parameters.properties.provider);assert.ok(schema.parameters.properties.model);
 const [one,two]=await Promise.all([spawn(ctx,lead,{name:'worker-one',provider:'two',model:'B'}),spawn(ctx,lead,{name:'worker-two',provider:'one',model:'C'})]);
 await until(()=>adapter.requests.length===2 && !ctx.agents.get(one.member.id) && !ctx.agents.get(two.member.id));
 assert.equal(adapter.requests.find(r=>r.sessionId===one.member.id).model,'B');
 assert.equal(adapter.requests.find(r=>r.sessionId===two.member.id).model,'C');
});
test('switch after assembly snapshot leaves admitted inference A; following invocation uses B', async t => {
 const {ctx,lead,adapter}=await setup(t,[toolCallResponse('info','get_current_model',{}),textResponse('B')]);
 let release;const blocked=new Promise(r=>{release=r;});let captured;
 ctx.on('agent/created',({agent})=>{
   if(agent.id==='lead')return;
   agent.ctx.on('system-prompt/assemble',async (_assembly,_context,next)=>{
     if(!captured){captured=agent;await blocked;}
     return next();
   });
 });
 const startedPromise=spawn(ctx,lead);
 await until(()=>captured!==undefined);
 const result=await call(ctx,lead,'switch_teammate_model',{teammate:'backend',provider:'two',model:'B'});
 assert.equal(result.next.model,'B');release();
 const started=await startedPromise;
 await until(()=>adapter.requests.length===2 && !ctx.agents.get(started.member.id));
 assert.deepEqual(adapter.requests.map(r=>r.model),['A','B']);
});
test('plugin disposal removes routing tools and does not destroy Lead identity', async t => {
 const {ctx,lead,routerFiber}=await setup(t,[]);
 assert.ok(ctx.tools.get('switch_model',lead));
 await routerFiber.dispose();
 assert.equal(ctx.agents.get(lead.id),lead);
 assert.equal(ctx.tools.get('switch_model',lead),undefined);
 assert.equal(ctx.tools.get('spawn_teammate',lead),undefined);
});
test('standalone Team Tools re-enabled after router does not duplicate policy or block sessions', async t => {
 const {ctx,lead,adapter,routerFiber}=await setup(t,[toolCallResponse('update','switch_model',{provider:'two',model:'B'}),textResponse('updated')]);
 const standalone=await ctx.plugin(TeamTools,{});
 const started=await spawn(ctx,lead);await until(()=>adapter.requests.length===2 && !ctx.agents.get(started.member.id));
 assert.deepEqual(adapter.requests.map(r=>r.model),['A','B']);
 await standalone.dispose();assert.ok(ctx.tools.get('spawn_teammate',lead));
 await routerFiber.dispose();assert.equal(ctx.tools.get('spawn_teammate',lead),undefined);
});
test('real Loader duplicate-enabled profile creates Lead and teammate, updates route, and toggles component', async t => {
 const {ctx,lead,adapter}=await setup(t,[toolCallResponse('switch-loader','switch_model',{provider:'two',model:'B'}),textResponse('B after Loader startup')],{loader:true});
 const started=await spawn(ctx,lead);
 await until(()=>adapter.requests.length===2 && !ctx.agents.get(started.member.id));
 assert.deepEqual(adapter.requests.map(request=>request.model),['A','B']);
 const standalone=[...ctx.loader.entries()].find(entry=>entry.options.name==='@deepseek-ai/dsh-experimental-tool-agent-team');
 await ctx.loader.update(standalone.id,{disabled:true});await ctx.loader.await();
 assert.ok(ctx.tools.get('spawn_teammate',lead));
 await ctx.loader.update(standalone.id,{disabled:false});await ctx.loader.await();
 assert.equal(standalone.fiber.state,2);assert.ok(ctx.tools.get('spawn_teammate',lead));
 const resumed=await ctx.agents.create({sessionId:SessionId('second-root'),agentOptions:{provider:'one',model:'A'}});
 assert.ok(ctx.tools.get('spawn_teammate',resumed.agent));await resumed.dispose();
});
test('router refuses unsafe hot-install over existing tools without breaking existing or new sessions', async t => {
 const {ctx,lead,adapter}=await setup(t,[textResponse('original tools still work')],{noRouter:true});
 await ctx.plugin(TeamTools,{});
 await assert.rejects(async () => { await ctx.plugin(Router); },/Team tools are already mounted/);
 assert.equal(ctx.agents.get(lead.id),lead);assert.equal(ctx.tools.get('switch_model',lead),undefined);
 const started=await spawn(ctx,lead);await until(()=>adapter.requests.length===1 && !ctx.agents.get(started.member.id));
 assert.equal(adapter.requests[0].model,'A');
 const other=await ctx.agents.create({sessionId:SessionId('still-working'),agentOptions:{provider:'one',model:'A'}});
 assert.ok(ctx.tools.get('spawn_teammate',other.agent));await other.dispose();
});
test('Loader original-first order before sessions does not double-register Team tools', async t => {
 const {ctx,lead,adapter}=await setup(t,[toolCallResponse('reverse-switch','switch_model',{provider:'two',model:'B'}),textResponse('switched')],{loader:true,reverseLoader:true});
 const started=await spawn(ctx,lead);await until(()=>adapter.requests.length===2 && !ctx.agents.get(started.member.id));
 assert.deepEqual(adapter.requests.map(request=>request.model),['A','B']);
 for(const entry of ctx.loader.entries())assert.equal(entry.fiber.state,2);
});
test('display name changes UI projection, persists across restart, and leaves target identity intact', async t => {
 const first=await setup(t,[toolCallResponse('alias','set_teammate_display_name',{target:'lead',display_name:'Líder — Revisão Ágil'}),textResponse('renamed')],{driveLead:true});
 first.lead.followup(createUserMessage({content:[{type:'text',text:'rename yourself visually'}],source:{kind:'user'}}));await first.lead.whenIdle();
 const started={member:{id:first.lead.id}};
 assert.equal(first.ctx.sessionProjections.snapshot(first.lead.session).values.agentTeamDisplayNames[started.member.id],'Líder — Revisão Ágil');
 assert.equal(first.ctx.agentTeams.listMembers(first.lead)[0].name,'lead');
 await first.ctx.sessions.flush(first.lead.session);await first.ctx.fiber.dispose();
 const second=await setup(t,[],{root:first.storageRoot,resume:true});
 assert.equal(second.ctx.sessionProjections.snapshot(second.lead.session).values.agentTeamDisplayNames[started.member.id],'Líder — Revisão Ágil');
 const reset=await call(second.ctx,second.lead,'set_teammate_display_name',{target:'lead',display_name:null});assert.equal(reset.display_name,'lead');
 await assert.rejects(call(second.ctx,second.lead,'set_teammate_display_name',{target:'lead',display_name:'  '}),/1–120/);
});
test('Lead names a cold teammate without changing tasks and teammate cannot rename members', async t => {
 const {ctx,lead,adapter}=await setup(t,['hang']);
 const started=await spawn(ctx,lead);await until(()=>adapter.requests.length===1);
 const live=ctx.agents.get(started.member.id);
 const task=await ctx.agentTeams.createTask(lead,{subject:'Own me',description:'Preserve ownership'});
 await ctx.agentTeams.updateTask(live,{taskId:task.id,expectedRevision:task.revision,action:'claim'});
 const before=ctx.agentTeams.listTasks(lead);
 await assert.rejects(call(ctx,live,'set_teammate_display_name',{target:'backend',display_name:'ADMIN'}),/Only the Team Lead/);
 live.cancel({kind:'user'});await until(()=>!ctx.agents.get(live.id));
 const renamed=await call(ctx,lead,'set_teammate_display_name',{target:'backend',display_name:'ADMIN — Ágil'});
 assert.equal(renamed.session,started.member.id);assert.equal(renamed.target,'backend');
 assert.deepEqual(ctx.agentTeams.listTasks(lead),before);assert.equal(ctx.agentTeams.listMembers(lead)[1].name,'backend');
 await assert.rejects(call(ctx,lead,'set_teammate_display_name',{target:'missing',display_name:'Unknown'}),/not found/);
});
test('old Team without policy is authorized by Host without opt-in or age restriction',async t=>{
 const first=await setup(t,[textResponse('legacy decision')],{enabled:false});
 const started=await spawn(first.ctx,first.lead);await until(()=>first.adapter.requests.length===1&&!first.ctx.agents.get(started.member.id));
 await first.ctx.sessions.flush(first.lead.session);await first.ctx.fiber.dispose();
 const second=await setup(t,[toolCallResponse('legacy-switch','switch_model',{provider:'two',model:'B'}),textResponse('legacy preserved')],{root:first.storageRoot,resume:true,enabled:true});
 assert.equal((await call(second.ctx,second.lead,'list_models',{})).enabled,true);
 await second.ctx.agentTeams.sendMessage(second.lead,{target:'backend',content:[{type:'text',text:'Continue legacy decision'}],signal});
 await until(()=>second.adapter.requests.length===2&&!second.ctx.agents.get(started.member.id));
 assert.equal(second.adapter.requests[1].model,'B');assert.ok(JSON.stringify(second.adapter.requests[1]).includes('legacy decision'));
 assert.equal(second.ctx.agentTeams.listMembers(second.lead)[1].id,started.member.id);
});
test('compact_teammate delegates exact native target/signal and preserves identity, tasks and route',async t=>{
 const {ctx,lead,adapter}=await setup(t,['hang']);const started=await spawn(ctx,lead);await until(()=>adapter.requests.length===1);
 const live=ctx.agents.get(started.member.id);const before=ctx.agentTeams.listMembers(lead);
 await assert.rejects(call(ctx,live,'compact_teammate',{target:'backend'}),/Only the Team Lead/);
 await assert.rejects(call(ctx,lead,'compact_teammate',{target:'lead'}),/Teammate not found/);
 await assert.rejects(call(ctx,lead,'compact_teammate',{target:'backend'}),/unavailable/);
 let received;ctx.provide('compaction',{compactNow:async (agent,requestSignal)=>{received={agent,requestSignal};return {summarySeq:123,shadowedSeqs:[1,2],shadowedTokenCount:500};}});
 const result=await call(ctx,lead,'compact_teammate',{target:'backend'});
 assert.equal(received.agent,live);assert.equal(received.requestSignal,signal);assert.equal(result.session,live.id);assert.equal(result.compacted,true);assert.equal(result.history_items,2);
 assert.deepEqual(ctx.agentTeams.listMembers(lead),before);assert.equal((await call(ctx,live,'get_current_model',{})).next.model,'A');
 ctx.get('compaction').compactNow=async()=>null;assert.equal((await call(ctx,lead,'compact_teammate',{target:'backend'})).compacted,false);
 ctx.get('compaction').compactNow=async agent=>agent.runMaintenance(async()=>null);
 await assert.rejects(call(ctx,lead,'compact_teammate',{target:'backend'}));
 const controller=new AbortController();controller.abort();
 await assert.rejects(ctx.tools.get('compact_teammate',lead).execute({target:'backend'},{agent:lead,signal:controller.signal}));
 live.cancel({kind:'user'});await until(()=>!ctx.agents.get(live.id));await assert.rejects(call(ctx,lead,'compact_teammate',{target:'backend'}),/cold/);
});
test('invalid selection is rejected before creating a roster member', async t => {
 const {ctx,lead,adapter}=await setup(t,[]);
 await assert.rejects(spawn(ctx,lead,{provider:'two',model:'nonexistent'}),/not allowed/);
 assert.equal(ctx.agentTeams.listMembers(lead).length,1);assert.equal(adapter.requests.length,0);
});
