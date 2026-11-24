import { SpeechSegments, readCaptionEvents } from './captions.js';
const $ = id => document.getElementById(id);
const state = { rows: [], token: '', running: false, starting: false, stopping: false, draining: false, testing: false, queue: [], elapsed: 0, busy: false };
let audio, stream, source, processor, silent, tick, segments, playbackURL;
const storageKey = 'classroom-notes-v1';
function save() { try { localStorage.setItem(storageKey, JSON.stringify({ rows: state.rows, course: $('course').value, terms: $('terms').value, elapsed: state.elapsed })); } catch { notice('浏览器无法暂存笔记，请在离开前导出。'); } }
function notice(message = '') { $('notice').textContent = message; $('notice').hidden = !message; }
function clock(seconds) { return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`; }
function status(value) { $('status').textContent = value; }
function render() {
  const list = $('transcript');
  const follow = list.scrollHeight - list.scrollTop - list.clientHeight < 100;
  list.querySelectorAll('.entry').forEach(el => el.remove());
  $('empty').hidden = state.rows.length > 0;
  $('empty').style.display = state.rows.length ? 'none' : '';
  for (const row of state.rows) {
    const el = document.createElement('article'); el.className = `entry${row.error ? ' failed' : ''}`;
    const meta = document.createElement('div'); meta.className = 'entry-meta';
    const time = document.createElement('span'); time.textContent = clock(row.time);
    const tag = document.createElement('span'); tag.textContent = row.demo ? '示例 · 非课堂录音' : '原文 / 中文'; meta.append(time, tag);
    const ko = document.createElement('p'); ko.className = 'source'; ko.lang = row.demo ? (row.language || 'ko') : 'und'; ko.textContent = row.source;
    const zh = document.createElement('p'); zh.className = 'translation'; zh.textContent = row.translation || row.error || '正在翻译…';
    el.append(meta, ko, zh);
    if(row.metrics){const timing=document.createElement('div');timing.className='entry-diagnostics';const m=row.metrics;timing.textContent=`采集 ${m.audioSeconds.toFixed(1)} 秒 · 排队 ${(m.queueMs/1000).toFixed(1)} 秒 · 识别 ${(m.asrMs/1000).toFixed(1)} 秒${m.translationMs!=null?` · 翻译 ${(m.translationMs/1000).toFixed(1)} 秒`:''}`;el.append(timing);}
    if (row.error && !row.demo) { const retry = document.createElement('button'); retry.className = 'retry'; retry.textContent = '重试此句翻译'; retry.onclick = async () => { retry.disabled = true; try { const result = await api('/api/translate', { text: row.source, terms: $('terms').value }); row.translation = result.translation; delete row.error; save(); } catch(e) { notice(e.message); } finally { render(); } }; el.append(retry); }
    list.append(el);
  }
  $('count').textContent = `${state.rows.length} 条笔记`;
  if (follow) list.scrollTop = list.scrollHeight;
}
function base() {
  const value = $('endpoint').value.trim().replace(/\/$/, '');
  if (!value) return location.origin;
  const url = new URL(value);
  if (url.protocol !== 'https:' && !(['localhost', '127.0.0.1'].includes(url.hostname) && url.protocol === 'http:')) throw new Error('服务地址需要使用 HTTPS，本机服务可用 http://127.0.0.1:8787。');
  return url.origin;
}
async function api(path, body, isAudio = false) {
  const headers = { Authorization: `Bearer ${state.token}`, 'Content-Type': isAudio ? 'audio/wav' : 'application/json' };
  if (isAudio) headers['X-Classroom-Terms'] = encodeURIComponent($('terms').value.slice(0, 2000));
  let response;
  try { response = await fetch(`${base()}${path}`, { method: 'POST', headers, body: isAudio ? body : JSON.stringify(body), signal: AbortSignal.timeout(65000) }); }
  catch { throw new Error('连接中断或请求超时。请检查服务地址和网络；本次音频不会自动重复提交。'); }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `服务返回错误（${response.status}）`);
  return result;
}
async function connect() {
  const response = await fetch(`${base()}/api/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: $('access').value }), signal: AbortSignal.timeout(12000) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || '服务未连接，请检查服务地址和访问码。');
  state.token = result.token; $('connection').textContent = '已连接';
  try { localStorage.setItem('classroom-endpoint', $('endpoint').value); } catch {}
  return result;
}
$('connect').onclick = async () => { $('connect').disabled = true; notice(); try { const result = await connect(); notice(`服务已连接。今日最多还可处理约 ${Math.floor(result.remainingMinutes)} 分钟音频。`); } catch(e) { $('connection').textContent = '未连接'; notice(e.message || '连接失败，请检查服务地址。'); } finally { $('connect').disabled = false; } };
function microphoneOptions(){return {channelCount:1,echoCancellation:true,noiseSuppression:$('noise').checked,autoGainControl:true,...($('microphone').value?{deviceId:{exact:$('microphone').value}}:{})};}
async function microphones(){
  try{const devices=await navigator.mediaDevices?.enumerateDevices();if(!devices)return;const chosen=$('microphone').value;const options=[new Option('系统默认麦克风','')];for(const d of devices.filter(d=>d.kind==='audioinput'))options.push(new Option(d.label||`麦克风 ${options.length}`,d.deviceId));$('microphone').replaceChildren(...options);if(options.some(o=>o.value===chosen))$('microphone').value=chosen;}catch{notice('无法列出麦克风，仍可尝试使用系统默认设备。');}
}
$('mic-refresh').onclick=microphones;
$('mic-check').onclick=async()=>{
  if(state.running||state.starting||state.busy||state.testing||state.draining)return;
  state.testing=true;$('start').disabled=true;$('mic-check').disabled=true;$('microphone').disabled=true;$('noise').disabled=true;
  let testStream,ctx,node,input,mute;let frames=[],samples=0;
  try{
    $('mic-check-hint').textContent='正在请求麦克风；本次仅在本机录制，不上传。';
    testStream=await navigator.mediaDevices.getUserMedia({audio:microphoneOptions()});await microphones();
    ctx=new AudioContext({sampleRate:48000});await ctx.resume();await ctx.audioWorklet.addModule(new URL('./pcm-worklet.js',import.meta.url));
    input=ctx.createMediaStreamSource(testStream);node=new AudioWorkletNode(ctx,'classroom-pcm');mute=ctx.createGain();mute.gain.value=0;
    node.port.onmessage=event=>{frames.push(event.data);samples+=event.data.length;};input.connect(node);node.connect(mute);mute.connect(ctx.destination);
    $('mic-check-hint').textContent='正在录制 5 秒，请按平时上课的音量和距离说话…';
    await new Promise(resolve=>setTimeout(resolve,5000));
    if(!samples)throw new Error('没有收到麦克风音频，请检查输入设备。');
    if(playbackURL)URL.revokeObjectURL(playbackURL);playbackURL=URL.createObjectURL(new Blob([wav(frames,samples,ctx.sampleRate)],{type:'audio/wav'}));$('mic-playback').src=playbackURL;$('mic-playback').hidden=false;
    $('mic-check-hint').textContent='录制完成。请播放，听人声是否清楚、有没有漏字或噪声；可换麦克风或切换降噪再比较。音频只在此页面内存中。';
  }catch(e){$('mic-check-hint').textContent=e.name==='NotAllowedError'?'没有麦克风权限，请允许后再试。':(e.message||'收音检查失败，请检查麦克风。');}
  finally{node?.disconnect();input?.disconnect();mute?.disconnect();testStream?.getTracks().forEach(t=>t.stop());if(ctx&&ctx.state!=='closed')await ctx.close();state.testing=false;$('start').disabled=false;$('mic-check').disabled=false;$('microphone').disabled=false;$('noise').disabled=false;}
};
function wav(frames, sampleCount, rate) {
  const data = new ArrayBuffer(44 + sampleCount * 2), view = new DataView(data);
  const str = (offset, text) => [...text].forEach((c,i) => view.setUint8(offset+i,c.charCodeAt(0)));
  str(0,'RIFF'); view.setUint32(4,36+sampleCount*2,true); str(8,'WAVE'); str(12,'fmt '); view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,1,true); view.setUint32(24,rate,true); view.setUint32(28,rate*2,true); view.setUint16(32,2,true); view.setUint16(34,16,true); str(36,'data'); view.setUint32(40,sampleCount*2,true);
  let offset = 44; for (const frame of frames) for (const x of frame) { view.setInt16(offset, Math.round(Math.max(-1,Math.min(1,x))*32767), true); offset += 2; }
  return data;
}
function queueChunk(chunk){if(!chunk)return;state.queue.push({wav:wav(chunk.frames,chunk.samples,audio.sampleRate),time:Math.max(0,state.elapsed-chunk.samples/audio.sampleRate),audioSeconds:chunk.samples/audio.sampleRate,overlap:chunk.overlap,queuedAt:performance.now()});void drain();}
function flush() { queueChunk(segments?.flush()); }
async function processChunk(chunk,onEvent){
  let response;try{response=await fetch(`${base()}/api/chunk`,{method:'POST',headers:{Authorization:`Bearer ${state.token}`,'Content-Type':'audio/wav',Accept:'application/x-ndjson','X-Classroom-Terms':encodeURIComponent($('terms').value.slice(0,2000)),'X-Classroom-Overlap':chunk.overlap?'1':'0'},body:chunk.wav,signal:AbortSignal.timeout(65000)});}catch{throw new Error('连接中断或超时，请检查网络。音频不会自动重传。');}
  if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(body.error||`服务错误（${response.status}）`);}
  await readCaptionEvents(response,onEvent);
}
async function drain() {
  if (state.busy) return;
  state.busy = true;
  while (state.queue.length) {
    const chunk = state.queue.shift();const queueMs=performance.now()-chunk.queuedAt;let row;status(`正在识别 · 等待 ${state.queue.length} 段`);
    try {
      await processChunk(chunk,event=>{
        if(event.type==='source'){row={source:event.source,translation:'',time:chunk.time,metrics:{audioSeconds:chunk.audioSeconds,queueMs,asrMs:event.asrMs}};state.rows.push(row);status('原文已显示，正在翻译');}
        if(event.type==='translation'&&row){row.translation=event.translation;row.metrics.translationMs=event.translationMs;}
        if(event.type==='translation-error'&&row)row.error=event.error;
        save();render();
      });
    } catch(e) {if(row&&!row.translation){row.error='翻译连接中断，请重试此句。';save();render();}notice(`${clock(chunk.time)} 的音频片段处理失败：${e.message}`); void stop(false); state.queue.length = 0; break; }
  }
  state.busy = false;
  if (state.running) status('正在听课'); else { status('已暂停'); state.draining = false; $('start').disabled = false; }
}
function onPCM(frame) {
  if (!state.running) return;
  let energy = 0; for (const x of frame) energy += x*x;
  const rms = Math.sqrt(energy / frame.length);
  $('level').style.height = `${Math.min(18, Math.max(3,rms*450))}px`;
  const db=Math.max(-90,Math.round(20*Math.log10(Math.max(rms,.00001))));
  $('capture-label').textContent=`收音 ${db} dB · 本段 ${(segments.samples/audio.sampleRate).toFixed(1)} 秒`;
  queueChunk(segments.add(frame));
  if (state.queue.length >= 6) { notice('翻译速度暂时跟不上收音，已暂停麦克风并处理已有片段。请等待后继续。'); void stop(); }
}
async function start() {
  if (state.running || state.starting || state.stopping || state.draining || state.busy || state.testing) return;
  if (state.rows.some(r=>r.demo)) { notice('当前是示例笔记。请先导出或清空本课，再开始真实听课。'); return; }
  state.starting = true; $('start').disabled = true; notice(); status('正在连接');
  try {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('麦克风需要 HTTPS 或本机 localhost 页面，请使用受支持的浏览器。');
    if (!state.token) await connect();
    stream = await navigator.mediaDevices.getUserMedia({ audio: microphoneOptions() });
    await microphones();
    audio = new AudioContext({sampleRate:48000}); await audio.resume(); await audio.audioWorklet.addModule(new URL('./pcm-worklet.js', import.meta.url));
    segments=new SpeechSegments(audio.sampleRate,$('segment-mode').value);
    source = audio.createMediaStreamSource(stream); processor = new AudioWorkletNode(audio,'classroom-pcm'); silent = audio.createGain(); silent.gain.value = 0;
    processor.port.onmessage = event => onPCM(event.data);
    source.connect(processor); processor.connect(silent); silent.connect(audio.destination);
    state.running = true; $('terms').disabled = true; $('demo').disabled=true; $('microphone').disabled=true;$('noise').disabled=true;$('segment-mode').disabled=true;$('mic-check').disabled=true; $('stop').disabled = false; $('start').textContent = '继续听课'; $('capture-label').textContent = '正在收音'; status('正在听课');
    stream.getAudioTracks()[0].onended = ()=>{if(state.running){notice('麦克风已断开，已暂停收音。请检查设备后继续。');void stop();}};
    tick = setInterval(()=>{state.elapsed++; $('timer').textContent=clock(state.elapsed); if(state.elapsed % 10 === 0) save(); if(state.elapsed>=7200){notice('本课已达两小时，已暂停。请导出后清空本课，再开始下一堂课。');void stop();}},1000);
  } catch(e) { stream?.getTracks().forEach(t=>t.stop()); if (audio?.state !== 'closed') await audio?.close(); status('未开始'); $('settings').open = true; notice(e.name === 'NotAllowedError' ? '没有获得麦克风权限，请在浏览器设置中允许后重试。' : (e.message || '连接失败，请检查翻译服务。')); $('start').disabled = false; }
  finally { state.starting = false; }
}
async function stop(sendLast = true) {
  if (!state.running) return;
  state.running = false;state.stopping=true;clearInterval(tick); $('stop').disabled = true; state.draining = true;
  if (sendLast) flush(); else segments?.reset();
  processor?.disconnect(); source?.disconnect(); silent?.disconnect(); stream?.getTracks().forEach(t=>t.stop()); if(audio?.state!=='closed') await audio?.close();
  state.stopping=false;$('level').style.height='3px'; $('capture-label').textContent='麦克风已关闭'; $('terms').disabled=false;$('demo').disabled=false;$('microphone').disabled=false;$('noise').disabled=false;$('segment-mode').disabled=false;$('mic-check').disabled=false;save();
  if (!state.busy) { state.draining=false; $('start').disabled=false; status('已暂停'); }
}
$('start').onclick = start; $('stop').onclick = ()=>stop();
$('demo').onclick = () => { state.rows = [
  {source:'오늘은 감각 경험과 장소 기억의 관계에 대해 이야기하겠습니다.',translation:'今天我们来讨论感官体验与场所记忆之间的关系。',time:0,demo:true},
  {source:'The same place can be remembered differently through sound and smell.',translation:'同一个场所也可能因声音和气味而留下不同的记忆。',time:8,demo:true,language:'en'},
  {source:'大切なのは、複数の感覚がどのように一緒に働くかです。',translation:'重要的是，多种感官如何共同发挥作用。',time:17,demo:true,language:'ja'}
]; save(); render(); status('字幕示例'); notice('正在展示预设示例，没有录音或调用 API。'); };
$('font').onclick=()=>{document.body.classList.toggle('large');$('font').textContent=document.body.classList.contains('large')?'标准字':'大字';};
$('focus').onclick=()=>{document.body.classList.toggle('focus');$('focus').textContent=document.body.classList.contains('focus')?'退出专注':'专注';window.scrollTo({top:0,behavior:'instant'});};
$('clear').onclick=()=>{if(state.running||state.starting||state.busy||state.draining||state.testing){notice('请先暂停，并等待已有片段处理完成。');return;}if(state.rows.length&&!confirm('清空这堂课的本地笔记？需要保留时，请先导出。'))return;state.rows=[];state.elapsed=0;state.token='';$('connection').textContent='未连接';$('timer').textContent='00:00';notice();status('准备就绪');save();render();};
$('export').onclick=()=>{if(!state.rows.length){notice('还没有可以导出的笔记。');return;}const title=$('course').value.trim()||'课堂双语笔记';const text=`# ${title}\n\n导出时间：${new Date().toLocaleString('zh-CN')}\n${state.rows.some(r=>r.demo)?'\n注意：包含预设字幕示例。\n':''}\n${state.rows.map(r=>`[${clock(r.time)}]${r.demo?'（示例）':''}\n原文：${r.source}\n中文：${r.translation||r.error||'待翻译'}\n`).join('\n')}\n---\n自动识别与翻译，请结合课堂原意核对。\n`;const url=URL.createObjectURL(new Blob(['\uFEFF',text],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`${title.replace(/[<>:"/\\|?*]/g,'_')}.txt`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
for(const id of ['course','terms']) $(id).addEventListener('change',save);
for(const id of ['endpoint','access']) $(id).addEventListener('change',()=>{state.token='';$('connection').textContent='未连接';});
window.addEventListener('beforeunload',event=>{if(state.running||state.busy){event.preventDefault();event.returnValue='';}});
try {const cached=JSON.parse(localStorage.getItem(storageKey)||'null');if(cached){state.rows=Array.isArray(cached.rows)?cached.rows.slice(-2000):[];for(const row of state.rows)if(!row.demo&&!row.translation&&!row.error)row.error='上次翻译未完成，请重试此句。';state.elapsed=Number(cached.elapsed)||0;$('course').value=cached.course||'';$('terms').value=cached.terms||'';$('timer').textContent=clock(state.elapsed);}$('endpoint').value=localStorage.getItem('classroom-endpoint')||'';}catch{}
render();
