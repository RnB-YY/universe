export const SOURCE_MODES = Object.freeze([
  {value:'auto',label:'自动检测',language:'und'},
  {value:'ko-en',label:'韩语＋英语',language:'und'},
  {value:'ko',label:'韩语',language:'ko'},
  {value:'en',label:'英语',language:'en'},
  {value:'ja',label:'日语',language:'ja'},
  {value:'zh',label:'中文',language:'zh-CN'},
  {value:'fr',label:'法语',language:'fr'},
  {value:'de',label:'德语',language:'de'},
  {value:'es',label:'西班牙语',language:'es'},
  {value:'ru',label:'俄语',language:'ru'}
]);
export const sourceMode=value=>SOURCE_MODES.find(mode=>mode.value===value);
export function languageInstruction(value){
  const mode=sourceMode(value);if(!mode)throw new Error('Unsupported source language');
  if(value==='auto')return '自动判断 text 中的语言，忠实翻译为简体中文。';
  if(value==='ko-en')return '本课预设为韩语和英语混合授课，可能在一句内或句间切换。结合两种语言理解 text，将韩语和英语内容统一翻译为简体中文，不要遗漏英语片段，不要把英语专业术语误当作韩语谐音。';
  return `本课预设源语言为${mode.label}，结合该语言理解 text，忠实翻译为简体中文；少量外语术语也需结合上下文理解。`;
}
export function transcriptionHints(value,terms=''){
  const mode=sourceMode(value);if(!mode)throw new Error('Unsupported source language');
  const fields={};
  if(value!=='auto'&&value!=='ko-en')fields.language=value;
  const hints=[];
  if(value==='ko-en')hints.push('This lecture mixes Korean and English, including English terminology in Korean sentences. Preserve both languages in the transcript.');
  if(terms)hints.push(`Reference vocabulary for this lecture: ${terms}`);
  if(hints.length)fields.prompt=hints.join('\n');
  return fields;
}
