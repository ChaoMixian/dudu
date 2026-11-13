import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {BotdSupervisor} from '../src/botd/supervisor';
import {createBotdHandler} from '../src/botd/server';
import {BotdClient} from '../src/botd/client';
test('botd independent roots, loopback HTTP client, missing dependencies are not ready',async()=>{const roots=[mkdtempSync(join(tmpdir(),'botd-a-')),mkdtempSync(join(tmpdir(),'botd-b-'))];const supervisors=roots.map(root=>new BotdSupervisor({root,port:0}));const servers:any[]=[];try{for(const supervisor of supervisors){await supervisor.init();servers.push(Bun.serve({port:0,hostname:'127.0.0.1',fetch:createBotdHandler(supervisor)}));}const clients=servers.map(server=>new BotdClient({baseUrl:`http://127.0.0.1:${server.port}`}));expect((await clients[0].health()).ok).toBe(true);expect(await clients[1].list()).toEqual([]);const missing=Object.values((await supervisors[0].doctor()).dependencies).some(x=>!x);if(missing){await expect(clients[0].start({id:'a',botId:'a',width:1280,height:800})).rejects.toThrow('Missing desktop dependencies');expect((await clients[0].get('a')).state).toBe('error');expect(await clients[1].list()).toHaveLength(0);}await expect(clients[0].get('../escape')).rejects.toThrow();}finally{for(const server of servers)server.stop(true);for(const s of supervisors)await s.close();for(const root of roots)rmSync(root,{recursive:true,force:true});}});
