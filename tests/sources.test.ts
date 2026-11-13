import { describe, test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SourceManager, validateSource } from '../src/sources';
import type { EventInput, SourceConfig } from '../src/contracts';
function fixture() { const root=mkdtempSync(join(tmpdir(),'dudu-sources-')); const db=new Database(':memory:'); const events:EventInput[]=[]; const manager=new SourceManager(root,db,e=>{events.push(e);}); return {root,db,events,manager,clean:async()=>{await manager.stop();db.close();rmSync(root,{recursive:true,force:true});}}; }
const delivered=(events:EventInput[])=>events.filter(event=>event.type!=='source.changed');
const base={botId:'bot',enabled:true,priority:'normal' as const,payload:{hello:'world'}};
describe('source fixtures',()=>{
  test('files are truth, IDs globally unique, validation and management',async()=>{
    const f=fixture();try{
      f.manager.register({...base,id:'web',kind:'webhook'});
      expect(existsSync(join(f.root,'bots/bot/sources/web.json'))).toBe(true);
      expect(f.manager.list('bot')).toHaveLength(1);
      expect(()=>f.manager.register({...base,botId:'other',id:'web',kind:'webhook'})).toThrow('globally unique');
      f.manager.enable('web',false); await expect(f.manager.trigger('web')).rejects.toThrow('disabled');
      f.manager.enable('web',true);await f.manager.trigger('web',{manual:true});expect(delivered(f.events)[0].payload).toEqual({manual:true});
      expect(f.events.filter(event=>event.type==='source.changed').map(event=>(event.payload as {action:string}).action)).toEqual(expect.arrayContaining(['saved','disabled','enabled']));
      f.manager.remove('web');expect(f.manager.list()).toHaveLength(0);
      expect(f.events.filter(event=>event.type==='source.changed').at(-1)!.payload).toMatchObject({action:'removed',sourceId:'web'});
      expect(()=>validateSource({...base,id:'../bad',kind:'webhook'})).toThrow();
      expect(()=>validateSource({...base,id:'bad',kind:'interval',intervalMs:0})).toThrow();
      expect(()=>validateSource({...base,id:'bad',kind:'cron',cron:'not a cron'})).toThrow();
    }finally{await f.clean();}
  });
  test('once and interval persist cursor, missed schedules coalesce',async()=>{
    const f=fixture();try{
      const now=Date.now();
      f.manager.register({...base,id:'once',kind:'once',at:new Date(now-1000).toISOString()});
      f.manager.register({...base,id:'interval',kind:'interval',intervalMs:1000});
      await f.manager.tick(now+10000);expect(delivered(f.events)).toHaveLength(2);
      const second=new SourceManager(f.root,f.db,e=>{f.events.push(e);});
      await second.tick(now+10001);expect(delivered(f.events)).toHaveLength(2);
      await second.tick(now+11001);expect(delivered(f.events)).toHaveLength(3);expect(delivered(f.events).filter(e=>e.sourceId==='once')).toHaveLength(1);
      expect(f.manager.getCursor('interval')!.nextAt).toBe(now+12001);
    }finally{await f.clean();}
  });
  test('cron next time is persisted and advances beyond now',async()=>{
    const f=fixture();try{
      f.manager.register({...base,id:'cron',kind:'cron',cron:'* * * * *',timezone:'UTC'});
      const due=f.manager.getCursor('cron')!.nextAt!;
      await f.manager.tick(due+600000);expect(delivered(f.events)).toHaveLength(1);expect(f.manager.getCursor('cron')!.nextAt!).toBeGreaterThan(due+600000);
      await f.manager.tick(due+600001);expect(delivered(f.events)).toHaveLength(1);
    }finally{await f.clean();}
  });
  test('process JSON lines, stderr logs, restart cursor and stop',async()=>{
    const f=fixture();try{
      const source:SourceConfig={...base,id:'process',kind:'process',argv:[process.execPath,'-e',`console.log(JSON.stringify({type:'fixture.event',payload:{ok:true},botId:'escape',sourceId:'escape'}));console.error('fixture stderr')`]};
      f.manager.register(source);f.manager.start(20);
      const deadline=Date.now()+5000;while((!delivered(f.events).length || !f.manager.getCursor('process')?.nextAt) && Date.now()<deadline) await Bun.sleep(20);
      expect(delivered(f.events)).toHaveLength(1);expect(delivered(f.events)[0].botId).toBe('bot');expect(delivered(f.events)[0].sourceId).toBe('process');expect(delivered(f.events)[0].type).toBe('fixture.event');
      expect(f.manager.getCursor('process')!.nextAt!).toBeGreaterThan(Date.now());
      const logs=f.db.query('SELECT level,message FROM source_runs WHERE source_id=?').all('process') as {level:string;message:string}[];
      expect(logs.some(l=>l.level==='stderr'&&l.message.includes('fixture stderr'))).toBe(true);
      await f.manager.tick(f.manager.getCursor('process')!.nextAt!+1);
      const restartedDeadline=Date.now()+3000;while(delivered(f.events).length<2 && Date.now()<restartedDeadline) await Bun.sleep(20);
      expect(delivered(f.events)).toHaveLength(2);
      await f.manager.stop();const length=f.events.length;await Bun.sleep(50);expect(f.events).toHaveLength(length);
    }finally{await f.clean();}
  });
});
