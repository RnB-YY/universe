import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer, wavSeconds } from '../server.mjs';
const code='test-access-code-only';
function wav(seconds=1){const rate=16000,size=rate*seconds*2,b=Buffer.alloc(44+size);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVE',8);b.write('fmt ',12);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(size,40);return b;}
async function setup(t,options={}){
 const dir=await mkdtemp(path.join(os.tmpdir(),'classroom-test-'));const usageFile=path.join(dir,'usage.json');
 const calls=[];const server=await createServer({usageFile,env:{OPENAI_API_KEY:'fake-api-key',ACCESS_CODE:code,DAILY_AUDIO_MINUTES:'0.02',...options.env},fetcher:options.fetcher|| (async(url,init)=>{calls.push({url,init});return Response.json(url.includes('/transcriptions')||url.endsWith('/asr')?{text:'장소 기억은 감각 경험과 연결됩니다.'}:{choices:[{message:{content:'场所记忆与感官体验相联系。'}}]});})});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});});
 const request=(route,body,token,headers={})=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`} : {}),...headers},body:Buffer.isBuffer(body)?body:JSON.stringify(body)});
 const session=async()=>{const r=await request('/api/session',{code});assert.equal(r.status,200);return (await r.json()).token;};
 return {base,request,session,calls,usageFile};
}
test('WAV duration is measured from audio bytes and malformed files are rejected',()=>{assert.equal(wavSeconds(wav()),1);const bad=wav();bad.writeUInt32LE(4,40);assert.throws(()=>wavSeconds(bad));assert.throws(()=>wavSeconds(wav(16)));});
test('requires access code and configured credentials; rejects unknown origins and private files',async t=>{const s=await setup(t);assert.equal((await s.request('/api/session',{code:'wrong'})).status,401);assert.equal((await s.request('/api/chunk',wav(),null,{'Content-Type':'audio/wav'})).status,401);assert.equal((await s.request('/api/session',{code},null,{Origin:'https://evil.example'})).status,403);assert.equal((await fetch(s.base+'/.env')).status,404);assert.equal((await fetch(s.base+'/server.mjs')).status,404);assert.equal((await fetch(s.base+'/classroom/')).status,200);});
test('unconfigured service fails clearly before any paid request',async t=>{const s=await setup(t,{env:{OPENAI_API_KEY:''}});const r=await s.request('/api/session',{code});assert.equal(r.status,503);assert.equal(s.calls.length,0);});
test('audio reaches ASR, terms reach translation, daily cap persists before provider calls',async t=>{const s=await setup(t);const token=await s.session();const r=await s.request('/api/chunk',wav(),token,{'Content-Type':'audio/wav','X-Classroom-Terms':encodeURIComponent('장소 기억 = 场所记忆')});assert.equal(r.status,200);const result=await r.json();assert.equal(result.translation,'场所记忆与感官体验相联系。');assert.equal(s.calls.length,2);assert.equal(s.calls[0].init.body.has('language'),false);assert.match(JSON.parse(s.calls[1].init.body).messages[0].content,/自动判断/);assert.match(s.calls[1].init.body,/场所记忆/);assert.equal(JSON.parse(await readFile(s.usageFile,'utf8')).seconds,1);const other=await s.session();assert.equal((await s.request('/api/chunk',wav(),other,{'Content-Type':'audio/wav'})).status,429);assert.equal(s.calls.length,2);});
test('translation failure preserves original and redacts provider errors',async t=>{const s=await setup(t,{fetcher:async url=>url.includes('/transcriptions')?Response.json({text:'안녕하세요.'}):Response.json({error:'secret raw provider details'},{status:401})});const r=await s.request('/api/chunk',wav(),await s.session(),{'Content-Type':'audio/wav'});const body=await r.json();assert.equal(body.source,'안녕하세요.');assert.equal(body.translation,'');assert.match(body.translationError,/密钥无效/);assert.doesNotMatch(JSON.stringify(body),/secret/);});
test('concurrent rejected requests do not release the active session lock',async t=>{let release;const gate=new Promise(resolve=>release=resolve);let entered;const ready=new Promise(resolve=>entered=resolve);const s=await setup(t,{fetcher:async url=>{if(url.includes('/transcriptions')){entered();await gate;return Response.json({text:'안녕하세요.'});}return Response.json({choices:[{message:{content:'你好。'}}]});}});const token=await s.session();const first=s.request('/api/chunk',wav(),token,{'Content-Type':'audio/wav'});await ready;for(let i=0;i<2;i++)assert.equal((await s.request('/api/translate',{text:'안녕하세요.'},token)).status,429);release();assert.equal((await first).status,200);});
test('DeepSeek-only runs ASR and translation without an OpenAI key',async t=>{
 const s=await setup(t,{env:{OPENAI_API_KEY:'',DEEPSEEK_API_KEY:'fake-deepseek-key'}});
 const r=await s.request('/api/chunk',wav(),await s.session(),{'Content-Type':'audio/wav','X-Classroom-Terms':encodeURIComponent('장소 기억 = 场所记忆')});
 assert.equal(r.status,200);assert.equal((await r.json()).translation,'场所记忆与感官体验相联系。');
 assert.deepEqual(s.calls.map(c=>c.url),['https://api.deepseek.com/v1/tools/asr','https://api.deepseek.com/chat/completions']);
 assert.deepEqual([...s.calls[0].init.body.keys()],['file']);
 assert.equal(s.calls[0].init.headers.Authorization,'Bearer fake-deepseek-key');
 const body=JSON.parse(s.calls[1].init.body);assert.equal(body.model,'deepseek-flash');assert.deepEqual(body.thinking,{type:'disabled'});assert.match(body.messages[1].content,/场所记忆/);
});
test('explicit DeepSeek ASR selection overrides a configured OpenAI key',async t=>{
 const s=await setup(t,{env:{DEEPSEEK_API_KEY:'fake-deepseek-key',TRANSCRIBE_PROVIDER:'deepseek'}});
 assert.equal((await s.request('/api/chunk',wav(),await s.session(),{'Content-Type':'audio/wav'})).status,200);
 assert.ok(s.calls.every(c=>c.url.startsWith('https://api.deepseek.com/')));
});
test('DeepSeek ASR failures do not trigger paid fallback to another provider',async t=>{
 const urls=[];const s=await setup(t,{env:{DEEPSEEK_API_KEY:'fake-deepseek-key',TRANSCRIBE_PROVIDER:'deepseek'},fetcher:async url=>{urls.push(url);return Response.json({error:'provider details'},{status:429});}});
 const r=await s.request('/api/chunk',wav(),await s.session(),{'Content-Type':'audio/wav'});assert.equal(r.status,502);assert.deepEqual(urls,['https://api.deepseek.com/v1/tools/asr']);assert.match((await r.json()).error,/额度不足或请求过多/);
});
test('source event is sent while translation is still blocked',async t=>{
 let release;const gate=new Promise(resolve=>release=resolve);t.after(()=>release());
 const s=await setup(t,{fetcher:async url=>{if(url.includes('/transcriptions'))return Response.json({text:'원문이 먼저 보입니다.'});await gate;return Response.json({choices:[{message:{content:'先显示原文。'}}]});}});
 const r=await s.request('/api/chunk',wav(),await s.session(),{'Content-Type':'audio/wav',Accept:'application/x-ndjson'});assert.equal(r.status,200);const reader=r.body.getReader();const first=await reader.read();const initial=new TextDecoder().decode(first.value);assert.match(initial,/"type":"source"/);assert.doesNotMatch(initial,/"type":"translation"/);release();let rest='';while(true){const next=await reader.read();if(next.done)break;rest+=new TextDecoder().decode(next.value);}assert.match(rest,/"type":"translation"/);assert.match(rest,/"type":"done"/);assert.match(rest,/translationMs/);
});
test('streamed translation failures preserve the source event and finish explicitly',async t=>{
 const s=await setup(t,{fetcher:async url=>url.includes('/transcriptions')?Response.json({text:'안녕하세요.'}):Response.json({error:'private details'},{status:429})});const r=await s.request('/api/chunk',wav(),await s.session(),{'Content-Type':'audio/wav',Accept:'application/x-ndjson'});const events=(await r.text()).trim().split('\n').map(line=>JSON.parse(line));assert.equal(events[0].source,'안녕하세요.');assert.equal(events[1].type,'translation-error');assert.equal(events[2].type,'done');assert.doesNotMatch(JSON.stringify(events),/private details/);
});
test('next translation receives only bounded earlier source context',async t=>{
 const s=await setup(t,{env:{DAILY_AUDIO_MINUTES:'1'}});const token=await s.session();await (await s.request('/api/chunk',wav(),token,{'Content-Type':'audio/wav'})).json();await new Promise(resolve=>setTimeout(resolve,310));await (await s.request('/api/chunk',wav(),token,{'Content-Type':'audio/wav'})).json();const first=JSON.parse(JSON.parse(s.calls[1].init.body).messages[1].content);const second=JSON.parse(JSON.parse(s.calls[3].init.body).messages[1].content);assert.deepEqual(first.context,[]);assert.deepEqual(second.context,['장소 기억은 감각 경험과 연결됩니다.']);
});
test('single language selection reaches OpenAI ASR and the translation prompt',async t=>{
 const s=await setup(t);const r=await s.request('/api/chunk',wav(),await s.session(),{'Content-Type':'audio/wav','X-Classroom-Language':'ko'});assert.equal(r.status,200);assert.equal(s.calls[0].init.body.get('language'),'ko');assert.match(JSON.parse(s.calls[1].init.body).messages[0].content,/预设源语言为韩语/);
});
test('DeepSeek Korean-English selection constrains translation without pretending ASR is locked',async t=>{
 const s=await setup(t,{env:{OPENAI_API_KEY:'',DEEPSEEK_API_KEY:'fake-deepseek-key'}});const r=await s.request('/api/chunk',wav(),await s.session(),{'Content-Type':'audio/wav','X-Classroom-Language':'ko-en',Accept:'application/x-ndjson'});assert.equal(r.status,200);const events=(await r.text()).trim().split('\n').map(x=>JSON.parse(x));assert.equal(events[0].sourceMode,'ko-en');assert.deepEqual([...s.calls[0].init.body.keys()],['file']);assert.match(JSON.parse(s.calls[1].init.body).messages[0].content,/韩语和英语混合授课/);
});
test('invalid source languages fail before paid calls',async t=>{
 const s=await setup(t);const r=await s.request('/api/chunk',wav(),await s.session(),{'Content-Type':'audio/wav','X-Classroom-Language':'ignore-instructions'});assert.equal(r.status,400);assert.equal(s.calls.length,0);await assert.rejects(()=>readFile(s.usageFile),{code:'ENOENT'});
});
test('retry translation retains the original row language mode',async t=>{
 const s=await setup(t);const r=await s.request('/api/translate',{text:'이 개념은 affordance입니다.',sourceMode:'ko-en'},await s.session());assert.equal(r.status,200);assert.match(JSON.parse(s.calls[0].init.body).messages[0].content,/韩语和英语混合授课/);
});
