// A small energy gate, not a speech-recognition model. Browser noise reduction is optional.
export class SpeechSegments {
  constructor(rate, mode='responsive') { this.rate=rate;this.max=mode==='complete'?10:6;this.min=1.2;this.silence=.45;this.reset(); }
  reset(){this.frames=[];this.samples=0;this.quiet=0;this.active=false;this.overlap=false;this.floor=.0007;}
  add(frame){
    let energy=0;for(const x of frame)energy+=x*x;
    const rms=Math.sqrt(energy/frame.length),gate=Math.max(.0018,Math.min(.007,this.floor*2.8));
    const voiced=rms>gate;
    if(!voiced)this.floor=this.floor*.98+rms*.02;
    if(voiced){this.active=true;this.quiet=0;}else this.quiet+=frame.length/this.rate;
    this.frames.push(frame);this.samples+=frame.length;
    if(!this.active){while(this.samples>this.rate*.3&&this.frames.length>1)this.samples-=this.frames.shift().length;return null;}
    const duration=this.samples/this.rate;
    if(duration>=this.max)return this.flush(true);
    if(duration>=this.min&&this.quiet>=this.silence)return this.flush(false);
    return null;
  }
  flush(keepTail=false){
    const chunk=this.active&&this.samples>this.rate*.4?{frames:this.frames,samples:this.samples,overlap:this.overlap}:null;
    const tail=[];let samples=0;
    if(keepTail&&chunk)for(let i=this.frames.length-1;i>=0&&samples<this.rate*.35;i--){tail.unshift(this.frames[i]);samples+=this.frames[i].length;}
    this.frames=tail;this.samples=samples;this.active=tail.length>0;this.overlap=tail.length>0;this.quiet=0;
    return chunk;
  }
}

export async function readCaptionEvents(response,onEvent){
  if(!response.body)throw new Error('没有收到字幕数据。');
  const reader=response.body.getReader(),decoder=new TextDecoder();let pending='';let ended=false;
  const parse=line=>{if(!line.trim())return;const event=JSON.parse(line);if(event.type==='error')throw new Error(event.error||'字幕处理失败。');if(event.type==='done')ended=true;onEvent(event);};
  try{while(true){const {done,value}=await reader.read();pending+=decoder.decode(value,{stream:!done});let split;while((split=pending.indexOf('\n'))>=0){parse(pending.slice(0,split));pending=pending.slice(split+1);}if(done)break;}if(pending.trim())parse(pending);if(!ended)throw new Error('字幕连接中断；已有原文已保留。');}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}

// Called only when the client explicitly retained audio at a hard segment boundary.
export function trimAudioOverlap(previous,current){
  const letters=text=>{const chars=[],ends=[];let at=0;for(const c of text){at+=c.length;if(/[\p{L}\p{N}]/u.test(c)){chars.push(c.toLocaleLowerCase());ends.push(at);}}return {chars,ends};};
  const a=letters(previous),b=letters(current);
  for(let n=Math.min(80,a.chars.length,b.chars.length);n>=6;n--){if(a.chars.slice(-n).join('')===b.chars.slice(0,n).join(''))return current.slice(b.ends[n-1]).replace(/^[\s.,!?，。！？;；:：]+/u,'');}
  return current;
}
