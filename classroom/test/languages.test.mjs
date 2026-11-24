import test from 'node:test';
import assert from 'node:assert/strict';
import { SOURCE_MODES, sourceMode, languageInstruction, transcriptionHints } from '../languages.js';
test('source choices include auto, Korean-English and independent common languages',()=>{assert.deepEqual(SOURCE_MODES.map(x=>x.value),['auto','ko-en','ko','en','ja','zh','fr','de','es','ru']);assert.equal(sourceMode('invalid'),undefined);assert.throws(()=>languageInstruction('invalid'));});
test('automatic ASR stays automatic; single languages use language codes',()=>{assert.deepEqual(transcriptionHints('auto'),{});for(const mode of SOURCE_MODES.filter(x=>!['auto','ko-en'].includes(x.value)))assert.equal(transcriptionHints(mode.value).language,mode.value);});
test('Korean-English remains multilingual and adds a recognizer hint where supported',()=>{const hints=transcriptionHints('ko-en','affordance = 可供性');assert.equal(hints.language,undefined);assert.match(hints.prompt,/Korean and English/);assert.match(hints.prompt,/affordance/);assert.match(languageInstruction('ko-en'),/韩语和英语/);assert.match(languageInstruction('ko-en'),/不要遗漏英语片段/);});
