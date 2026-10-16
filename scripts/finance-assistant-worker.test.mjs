import test from 'node:test';
import assert from 'node:assert/strict';
import {TeachingWorker} from '../teaching-worker/worker.mjs';
import {ResearchWorker} from '../research-worker/worker.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

test('research worker can answer a saved card chat and still polls research in the same cycle',async()=>{
 const calls=[],config={baseUrl:'http://127.0.0.1:8080',token:'synthetic',documentEnabled:false};
 const chatWorker=new TeachingWorker(config,{
  request:async(url,options)=>{const route=url.split('/worker/')[1];calls.push(route);if(route==='workspace-claim')return {ok:true,json:async()=>({job:null})};if(route==='claim')return {ok:true,json:async()=>({job:{id:'saved-chat',lease:'existing-lease',text:'저장된 질문'}})};assert.equal(route,'saved-chat/result');assert.equal(JSON.parse(options.body).lease,'existing-lease');return {ok:true,json:async()=>({success:true})}},
  interpret:async()=>({kind:'unclear',summary:'답변입니다.',patch:{},quotes:{}}),log:()=>{}
 });
 const worker=new ResearchWorker(config,'unused',{chatWorker});
 worker.api=async route=>{calls.push('research/'+route);return {job:null}};
 assert.equal(await worker.cycle(),true);
 assert.deepEqual(calls,['workspace-claim','claim','saved-chat/result','research/claim','research/evaluation/claim']);
});

test('a hosted chat job with the action catalogue is answered from the research worker with its own endpoint and the result route of the SAME job',async()=>{
 const calls=[],jobs=[],config={baseUrl:'http://127.0.0.1:8080',token:'synthetic',documentEnabled:false,directory:'C:/synthetic-vault'};
 const chatWorker=new TeachingWorker(config,{
  request:async(url,options)=>{const route=url.split('/worker/')[1];calls.push(route);if(route==='workspace-claim')return {ok:true,json:async()=>({job:null})};if(route==='claim')return {ok:true,json:async()=>({job:{id:'0123456789abcdef01234567',lease:'existing-lease',text:'제안대로 등록해 줘',tools:[{name:'apply_referenced_proposal'}],nextSlot:1,actions:[],references:[{kind:'chat',snapshot:{summary:'s',patch:{purpose:'company'}}}]}})};assert.equal(route,'0123456789abcdef01234567/result');assert.equal(JSON.parse(options.body).lease,'existing-lease');return {ok:true,json:async()=>({success:true})}},
  interpret:async(c,job)=>{jobs.push({config:c,job});return {kind:'unclear',summary:'등록했어요.',patch:{},quotes:{}}},log:()=>{}
 });
 const worker=new ResearchWorker(config,'unused',{chatWorker});worker.api=async route=>{calls.push('research/'+route);return {job:null}};
 assert.equal(await worker.cycle(),true);
 assert.deepEqual(calls,['workspace-claim','claim','0123456789abcdef01234567/result','research/claim','research/evaluation/claim']);
 assert.equal(jobs[0].job.actionEndpoint,'http://127.0.0.1:8080/api/finance-chat/worker/0123456789abcdef01234567/actions');assert.equal(jobs[0].config.directory,'C:/synthetic-vault','the hosting Vault directory reaches the interpreter');
});
test('idle teaching does not consume document jobs or suppress research/evaluation polling',async()=>{
 const calls=[],config={baseUrl:'http://127.0.0.1:8080',token:'synthetic',documentEnabled:false};
 const chatWorker=new TeachingWorker(config,{request:async url=>{calls.push(url.split('/worker/')[1]);return {ok:true,json:async()=>({job:null})}},interpret:async()=>{assert.fail('No inference for an empty queue')},log:()=>{}});
 const worker=new ResearchWorker(config,'unused',{chatWorker});worker.api=async route=>{calls.push('research/'+route);return {job:null}};
 assert.equal(await worker.cycle(),false);
 assert.deepEqual(calls,['workspace-claim','claim','research/claim','research/evaluation/claim']);
});

test('a long research job keeps its actual chat consumer connected and clears the heartbeat after failure',async t=>{
 t.mock.timers.enable({apis:['setInterval']});
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'omf-chat-heartbeat-'));
 let beats=0,release,entered;const gate=new Promise(resolve=>release=resolve),started=new Promise(resolve=>entered=resolve);
 const chatWorker={cycle:async()=>false,api:async route=>{assert.equal(route,'heartbeat');beats++;return {success:true}}};
 const worker=new ResearchWorker({baseUrl:'http://127.0.0.1:8080'},directory,{chatWorker,invokeInterpreter:async()=>{entered();await gate;throw Error('Synthetic interrupted inference')},log:()=>{}});
 worker.api=async route=>route==='claim'?{job:{id:'synthetic-research',lease:'synthetic-lease',context:{},sources:[],instruction:'Synthetic purchase'}}:{success:true};
 try{
  const pending=worker.cycle();await started;
  t.mock.timers.tick(60000);await Promise.resolve();assert.ok(beats>0,'Research activity must not make a real chat consumer look disconnected');
  release();assert.equal(await pending,true);const after=beats;
  t.mock.timers.tick(60000);await Promise.resolve();assert.equal(beats,after,'A completed or interrupted cycle must not leave a ghost heartbeat');
 }finally{
  release();t.mock.timers.reset();const resolved=await fs.realpath(directory),temp=await fs.realpath(os.tmpdir());
  assert.ok(resolved.startsWith(temp+path.sep)&&path.basename(resolved).startsWith('omf-chat-heartbeat-'));await fs.rm(resolved,{recursive:true,force:true});
 }
});
