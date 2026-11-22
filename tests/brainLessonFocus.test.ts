import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../web/public/brain-contributions.js',import.meta.url),'utf8');
const start=source.indexOf('  function focusSavedLesson()');
const end=source.indexOf('  function renderInsights(',start);
assert.ok(start>=0&&end>start,'The lesson deep-link implementation is present');
const handler=source.slice(start,end);
test('lesson badge opens the exact durable lesson rather than an unrelated legacy insight',()=>{
 const id='11111111-2222-4333-8444-555555555555';
 const events=new Map<string,(event:unknown)=>void>();let menuOpens=0,tabClicks=0,focused=0,scrolled=0,loads=0;
 const outer={tagName:'DETAILS',open:false,parentElement:null as unknown};
 const summary={focus:()=>{focused++;}};
 const card={dataset:{coreLessonId:id},tagName:'DETAILS',open:false,parentElement:outer,
  querySelector:()=>summary,scrollIntoView:()=>{scrolled++;}};
 const wrong={dataset:{coreLessonId:'66666666-7777-4888-8999-aaaaaaaaaaaa'},tagName:'DETAILS',open:false};
 const host={querySelectorAll:()=>[wrong,card],querySelector:()=>null};outer.parentElement=host;
 const ctx=vm.createContext({host,focusedCoreLessonId:null,lessonFocusPending:false,state:null,
  window:{addEventListener:(name:string,fn:(event:unknown)=>void)=>events.set(name,fn),__zeronineBrainMenu:{open:()=>{menuOpens++;}}},
  $:()=>({click:()=>{tabClicks++;}}),setTimeout:(fn:()=>void)=>fn(),load:()=>{loads++;},
 });
 vm.runInContext(handler,ctx);
 events.get('zeronine:brain-lesson-focus')!({detail:{lessonId:id}});
 assert.equal(menuOpens,1);assert.equal(tabClicks,1);assert.equal(card.open,true);assert.equal(outer.open,true);
 assert.equal(wrong.open,false);assert.equal(focused,1);assert.equal(scrolled,1);assert.equal(loads,0);
 events.get('zeronine:brain-lesson-focus')!({detail:{lessonId:'not-a-rule'}});
 assert.equal(menuOpens,1,'Malformed IDs do not open menus or request data');
});
test('a lesson not yet loaded requests memories without inventing a matching card',()=>{
 let loads=0;const events=new Map<string,(event:unknown)=>void>();
 const ctx=vm.createContext({host:{querySelectorAll:()=>[],querySelector:()=>null},
  focusedCoreLessonId:null,lessonFocusPending:false,state:null,
  window:{addEventListener:(name:string,fn:(event:unknown)=>void)=>events.set(name,fn),__zeronineBrainMenu:{open:()=>{}}},
  $:()=>({click:()=>{}}),setTimeout:(fn:()=>void)=>fn(),load:()=>{loads++;},
 });
 vm.runInContext(handler,ctx);
 events.get('zeronine:brain-lesson-focus')!({detail:{lessonId:'11111111-2222-4333-8444-555555555555'}});
 assert.equal(loads,1);assert.equal(vm.runInContext('lessonFocusPending',ctx),true);
});

