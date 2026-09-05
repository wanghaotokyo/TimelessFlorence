import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
async function moduleFrom(path){const source=ts.transpileModule(fs.readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;return import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));}
const {SentenceSpeaker}=await moduleFrom('../lib/speech.ts');
const {splitSentences,validateTitle,safeUrl}=await moduleFrom('../lib/types.ts');
function setup(voice={localService:true,lang:'zh-CN'}){const spoken=[];const engine={speak:u=>spoken.push(u),cancel(){}};const speaker=new SentenceSpeaker(engine,()=>({}),()=>{},['第一句。','第二句。','第三句。'],voice);return {speaker,spoken};}
test('late callbacks cannot advance a new sentence session',()=>{const {speaker,spoken}=setup();speaker.start();const old=spoken[0];speaker.move(1);old.onend();assert.equal(speaker.state.index,1);assert.equal(spoken.length,2);spoken[1].onend();assert.equal(speaker.state.index,2);});
test('pause and navigation stay silent, resume repeats selected sentence',()=>{const {speaker,spoken}=setup();speaker.start();speaker.pause();speaker.move(1);assert.equal(speaker.state.status,'paused');assert.equal(spoken.length,1);speaker.resume();assert.equal(spoken[1].text,'第二句。');});
test('first and last sentence boundaries and end replay',()=>{const {speaker,spoken}=setup();speaker.start();speaker.move(-1);assert.equal(spoken.length,1);speaker.start(2);speaker.move(1);assert.equal(spoken.length,2);spoken[1].onend();assert.equal(speaker.state.status,'ended');speaker.resume();assert.equal(spoken[2].text,'第一句。');});
test('stop invalidates callbacks and resets state',()=>{const {speaker,spoken}=setup();speaker.start();speaker.stop();spoken[0].onend();spoken[0].onerror({error:'cancelled'});assert.equal(speaker.state.status,'idle');assert.equal(speaker.state.index,0);assert.equal(spoken.length,1);});
test('remote or absent voice is never used as silent fallback',()=>{for(const voice of [null,{localService:false,lang:'zh-CN'}]){const {speaker,spoken}=setup(voice);speaker.start();assert.equal(speaker.state.status,'error');assert.equal(spoken.length,0);}});
test('splitting preserves long Chinese text and sentence order',()=>{const text='看这件作品。它是什么？\n再仔细看看！';assert.deepEqual(splitSentences(text),['看这件作品。','它是什么？','再仔细看看！']);const long='画'.repeat(500)+'。';assert.equal(splitSentences(long).join(''),long);assert.ok(splitSentences(long).every(s=>s.length<=160));});
test('title and source URL validation',()=>{assert.throws(()=>validateTitle('  '));assert.throws(()=>validateTitle('字'.repeat(101)));assert.equal(validateTitle(' 我的讲解 '),'我的讲解');for(const bad of ['javascript:alert(1)','http://example.com','https://user:secret@example.com'])assert.equal(safeUrl(bad),null);assert.equal(safeUrl('https://www.uffizi.it/en/artworks/birth-of-venus'),'https://www.uffizi.it/en/artworks/birth-of-venus');});
