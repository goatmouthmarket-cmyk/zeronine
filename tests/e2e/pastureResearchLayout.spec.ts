import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const assets = new URL('../../web/public/', import.meta.url);
for (const viewport of [{width:1280,height:800},{width:390,height:650},{width:320,height:568},{width:844,height:390}]) {
  test('paper art and right Research stack fit ' + viewport.width + 'x' + viewport.height, async ({page}) => {
    await page.setViewportSize(viewport); const errors:string[]=[], posts:string[]=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{
      class Socket extends EventTarget {
        static OPEN=1; static CLOSED=3; readyState=1;
        constructor(){super();queueMicrotask(()=>{this.dispatchEvent(new Event('open'));(this as any).onopen?.({});});}
        send(){} close(){this.readyState=3;}
      }
      (window as any).WebSocket=Socket;
    });
    await page.route('https://**',route=>route.abort());
    await page.route('https://layout.test/**',route=>{
      const path=new URL(route.request().url()).pathname;
      if(path==='/fixture.html') return route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width"><style>body{margin:0}iframe{position:fixed;inset:0;width:100%;height:100%;border:0}.account-balance-hud{position:fixed;z-index:5;right:12px;top:14px;width:146px;padding:6px;background:#fff4dc;border-radius:10px;color:#284732;font:800 12px system-ui}#rangerAutoMobilePnl{height:24px;padding-top:6px}#headerMenu{position:fixed;z-index:5;right:172px;top:18px;width:40px;height:40px}</style><iframe id="pasture" src="/trading-room.html?room=main"></iframe><div class="account-balance-hud">Demo 21,000.00<div id="rangerAutoMobilePnl">Auto +0.70</div></div><button id="headerMenu" aria-label="Menu">☰</button>'});
      if(path.startsWith('/api/')){
        if(route.request().method()==='POST')posts.push(path);
        if(path==='/api/core/research')return route.fulfill({contentType:'application/json',body:JSON.stringify({engineVersion:'core-v1',available:true,running:true,canActivate:false,readiness:{settled:82,target:200,fills:84,missing:2,netProfit:3.4,modelBrier:.14,baselineBrier:.15},run:{id:'fixture',running:true,phase:'Virtual trade open',balance:100.8,settled:3,wins:2,losses:1,netProfit:.8,maxDrawdown:1},recent:[],coverage:{complete:82,missing:2}})});
        return route.fulfill({status:path.includes('health')?200:401,contentType:'application/json',body:path.includes('health')?'{"feed":{"connected":true}}':'{"error":"Signed out"}'});
      }
      return route.fulfill({body:readFileSync(new URL(path.slice(1),assets)),contentType:path.endsWith('.html')?'text/html':path.endsWith('.js')?'application/javascript':path.endsWith('.css')?'text/css':path.endsWith('.svg')?'image/svg+xml':'application/octet-stream'});
    });
    await page.goto('https://layout.test/fixture.html');
    const frame=page.frames().find(frame=>frame.url().includes('trading-room.html'))!;
    await frame.waitForFunction(()=>!!(window as any).__zeronineBrainBridge&&!!document.querySelector('#coreResearchHud[data-ready]'));
    await page.evaluate(()=>{
      const child=document.querySelector('iframe')!.contentWindow!;
      child.postMessage({type:'zeronine:room-layout',headerHeight:64,bottomNavHeight:0},location.origin);
      child.postMessage({type:'zeronine:room-state',state:{accountId:'VRTC_LAYOUT',accountMode:'demo',authStatus:'signed-in',playerConnectionReady:true,feedConnected:true,currency:'USD',balance:21000,owner:false,trades:[],markets:[],paperSimulation:{phase:'idle',totalTrades:0,wins:0,losses:0,netPnl:0}}},location.origin);
      child.postMessage({type:'zeronine:room-auto-server-status',ok:true,running:true,state:{running:true,phase:'scanning'}},location.origin);
    });
    await expect(frame.locator('.crh-mini-results')).toContainText('82/200');
    const banner=frame.locator('.crh-banner'), level=frame.locator(viewport.width<=700?'#inspector':'#hud');
    await expect(banner).toBeVisible();
    await expect.poll(async()=>{const b=await banner.boundingBox(),l=await level.boundingBox();return !!b&&!!l&&b.y>=l.y+l.height+6&&Math.abs(b.x+b.width-l.x-l.width)<2;}).toBe(true);
    const b=await banner.boundingBox(), balance=await page.locator('.account-balance-hud').boundingBox();
    expect(b!.y).toBeGreaterThan(balance!.y+balance!.height); expect(b!.x+b!.width).toBeLessThanOrEqual(viewport.width-7);
    await banner.click(); await expect(frame.locator('.crh-panel')).toBeVisible();
    for(const selector of ['.crh-close','.crh-run','.crh-progress-label']){
      const rect=await frame.locator(selector).boundingBox(); expect(rect).not.toBeNull();expect(rect!.y).toBeGreaterThanOrEqual(0);expect(rect!.y+rect!.height).toBeLessThanOrEqual(viewport.height);
      expect(await frame.locator(selector).evaluate(element=>{const rect=element.getBoundingClientRect(),top=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2);return top===element||element.contains(top);})).toBe(true);
    }
    await frame.locator('.crh-settings summary').click();
    await expect(frame.locator('.crh-settings input').first()).toBeDisabled();
    const runRect=await frame.locator('.crh-run').boundingBox();expect(runRect!.y+runRect!.height).toBeLessThanOrEqual(viewport.height);
    await frame.locator('.crh-settings summary').click();
    await page.screenshot({path:test.info().outputPath('research-expanded-'+viewport.width+'.png')});
    await frame.evaluate(()=>{(window as any).notify('Paper result',{id:'queued-paper',status:'won',profit:.8,market:'Volatility 100 (1s) Index',direction:'over',barrier:1,virtualCurrency:'USD'});});
    await expect(frame.locator('.dc-toast[data-type="paper_result"]')).toHaveCount(0);
    await frame.locator('.crh-close').click();await expect(frame.locator('.dc-toast[data-type="paper_result"]')).toBeVisible();
    const toast=frame.locator('.dc-toast[data-type="paper_result"]'), art=toast.locator('img'), icon=toast.locator('.dc-toast-icon'), text=toast.locator('.dc-toast-body');
    await expect.poll(()=>art.evaluate((img:HTMLImageElement)=>img.complete&&img.naturalWidth>0)).toBe(true);
    const ir=await icon.boundingBox(),tr=await text.boundingBox(),ar=await art.boundingBox(),outer=await toast.boundingBox();
    expect(ir!.x+ir!.width).toBeLessThanOrEqual(tr!.x-5);expect(ar!.x).toBeGreaterThanOrEqual(ir!.x-1);expect(ar!.x+ar!.width).toBeLessThanOrEqual(ir!.x+ir!.width+1);
    expect(outer!.x).toBeGreaterThanOrEqual(0);expect(outer!.x+outer!.width).toBeLessThanOrEqual(viewport.width);expect(outer!.y+outer!.height).toBeLessThanOrEqual(viewport.height);
    expect(await text.evaluate(element=>element.scrollWidth<=element.clientWidth+1)).toBe(true);
    const research=await banner.boundingBox();
    expect(Math.max(0,Math.min(outer!.x+outer!.width,research!.x+research!.width)-Math.max(outer!.x,research!.x))*Math.max(0,Math.min(outer!.y+outer!.height,research!.y+research!.height)-Math.max(outer!.y,research!.y))).toBe(0);
    await page.screenshot({path:test.info().outputPath('paper-toast-'+viewport.width+'.png')});
    if(viewport.width<=700){
      await toast.locator('.dc-toast-close').click();
      await frame.locator('#inspector .target-menu>summary').click();await expect(frame.locator('#inspector .target-menu')).toHaveAttribute('open','');
      await expect(banner).toBeHidden();
      const menu=await frame.locator('#inspector').boundingBox();expect(menu!.x+menu!.width).toBeLessThanOrEqual(viewport.width);expect(menu!.y).toBeGreaterThanOrEqual(balance!.y+balance!.height);
      await frame.locator('#inspector .target-menu>summary').click();await expect(banner).toBeVisible();
    }
    expect(errors).toEqual([]);expect(posts.filter(path=>/trade|automation|core\/research\/(start|stop)/.test(path))).toEqual([]);
  });
}

