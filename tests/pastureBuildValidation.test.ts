import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';

test('the copied frame must match the source pair Fastify actually inlines',()=>{
 const f=fixture();try{
  const runtime=path.join(f.root,'runtime');mkdirSync(runtime);
  f.write('runtime/trading-room.html',readFileSync(path.join(f.root,'trading-room.html'),'utf8'));
  f.write('runtime/trading-room-core.js',readFileSync(path.join(f.root,'trading-room-core.js'),'utf8'));
  assert.equal(verifyPastureBuild(f.root,runtime).scripts,3);
  f.write('runtime/trading-room-core.js','window.newSourceNotCopied=true;');
  assert.throws(()=>verifyPastureBuild(f.root,runtime),/does not match the runtime source/);
 }finally{f.close();}
});

import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { verifyPastureBuild } from '../scripts/verify-pasture-build.ts';

function fixture(): { root: string; write: (name:string, source:string)=>void; close:()=>void } {
 const root=mkdtempSync(path.join(tmpdir(),'pasture-build-test-'));
 const write=(name:string,source:string)=>{mkdirSync(path.dirname(path.join(root,name)),{recursive:true});writeFileSync(path.join(root,name),source);};
 write('index.html','<link rel="stylesheet" href="/assets/index-a1b2.css"><script type="module" src="/assets/index-a1b2.js"></script>');
 write('assets/index-a1b2.css','body{color:green}');
 write('assets/index-a1b2.js','export const moduleOnlySyntax = true;');
 write('trading-room.html',"<link rel='stylesheet' href='/frame.css?v=new'><script defer src='/trading-room-core.js?v=changed-again'></script><script src='/helper.js?v=123'></script><script>const inlineReady=true;</script>");
 write('frame.css','canvas{display:block}');
 write('trading-room-core.js','window.rendererReady=true;');
 write('helper.js','window.helperReady=true;');
 return{root,write,close:()=>rmSync(root,{recursive:true,force:true})};
}
test('actual output accepts renderer cache changes and does not parse Vite ESM as classic JavaScript',()=>{
 const f=fixture();try{assert.deepEqual(verifyPastureBuild(f.root),{assets:4,scripts:3});}finally{f.close();}
});
test('missing or duplicate pasture renderer fails before deployment',()=>{
 const f=fixture();try{
  f.write('trading-room.html','<script>window.shellOnly=true;</script>');
  assert.throws(()=>verifyPastureBuild(f.root),/exactly one/);
  f.write('trading-room.html','<script src="/trading-room-core.js?v=a"></script><script src="/trading-room-core.js?v=b"></script>');
  assert.throws(()=>verifyPastureBuild(f.root),/exactly one/);
 }finally{f.close();}
});
test('missing built bundle, renderer and referenced frame assets are rejected',()=>{
 for(const file of ['assets/index-a1b2.js','assets/index-a1b2.css','trading-room-core.js','helper.js','frame.css']){
  const f=fixture();try{rmSync(path.join(f.root,file));assert.throws(()=>verifyPastureBuild(f.root),/missing/,file);}finally{f.close();}
 }
});
test('malformed actual renderer, external script and inline frame code fail validation',()=>{
 for(const file of ['trading-room-core.js','helper.js','trading-room.html']){
  const f=fixture();try{
   if(file==='trading-room.html')f.write(file,'<script src="/trading-room-core.js?v=cache"></script><script>const broken = ;</script>');
   else f.write(file,'const broken = ;');
   assert.throws(()=>verifyPastureBuild(f.root),SyntaxError,file);
  }finally{f.close();}
 }
});
test('application JSON and module scripts are checked as assets without classic parsing',()=>{
 const f=fixture();try{
  f.write('trading-room.html','<script src="/trading-room-core.js"></script><script type="application/json">{"not":"JavaScript"}</script><script type="module" src="/assets/index-a1b2.js"></script>');
  assert.equal(verifyPastureBuild(f.root).scripts,1);
 }finally{f.close();}
});

