import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {BotdSupervisor} from '../src/botd/supervisor';
test('desktop supervisor initializes independent roots and reports dependencies',async()=>{const roots=[mkdtempSync(join(tmpdir(),'desktop-a-')),mkdtempSync(join(tmpdir(),'desktop-b-'))];const supervisors=roots.map(root=>new BotdSupervisor({root}));try{await Promise.all(supervisors.map(supervisor=>supervisor.init()));expect(await supervisors[0]!.list()).toEqual([]);expect(await supervisors[1]!.list()).toEqual([]);const doctor=await supervisors[0]!.doctor();expect(doctor.root).toBe(roots[0]);expect(Object.keys(doctor.dependencies)).toContain('Xvfb');await expect(supervisors[0]!.get('../escape')).rejects.toThrow();}finally{for(const supervisor of supervisors)await supervisor.close();for(const root of roots)rmSync(root,{recursive:true,force:true});}});
test('terminals are scoped to a desktop and broadcast output without draining the buffer',async()=>{
  const root=mkdtempSync(join(tmpdir(),'desktop-terminal-'));
  const supervisor=new BotdSupervisor({root});
  const id='demo-computer';
  try{
    await supervisor.init();
    const dir=join(root,'desktops',id);
    mkdirSync(join(dir,'home'),{recursive:true});
    (supervisor as any).desktops.set(id,{config:{id,botId:'demo',width:1280,height:800},state:'ready',processes:[]});
    const created=await supervisor.terminal_create(id,{cols:80,rows:24,cwd:join(dir,'home')});
    const chunks:string[]=[];
    const off=supervisor.terminal_subscribe(id,created.pid,chunk=>chunks.push(chunk));
    await supervisor.terminal_send(id,created.pid,'stty size\n');
    for(let i=0;i<40&&!chunks.join('').includes('24 80');i++)await new Promise(resolve=>setTimeout(resolve,50));
    expect(chunks.join('')).toContain('24 80');
    await supervisor.terminal_send(id,created.pid,'printf "hello-terminal\\n"\n');
    for(let i=0;i<40&&!chunks.join('').includes('hello-terminal');i++)await new Promise(resolve=>setTimeout(resolve,50));
    expect(chunks.join('')).toContain('hello-terminal');
    expect(await supervisor.terminal_read(id,created.pid)).toContain('hello-terminal');
    await supervisor.terminal_resize(id,created.pid,100,30);
    await supervisor.terminal_send(id,created.pid,'stty size\n');
    for(let i=0;i<40&&!chunks.join('').includes('30 100');i++)await new Promise(resolve=>setTimeout(resolve,50));
    expect(chunks.join('')).toContain('30 100');
    await expect(supervisor.terminal_resize('other-computer',created.pid,100,30)).rejects.toThrow();
    await expect(supervisor.terminal_send('other-computer',created.pid,'x')).rejects.toThrow();
    await expect(supervisor.terminal_info('other-computer',created.pid)).rejects.toThrow();
    off();
    expect((await supervisor.terminal_info(id,created.pid)).alive).toBe(true);
    await supervisor.terminal_close(id,created.pid);
    await expect(supervisor.terminal_info(id,created.pid)).rejects.toThrow();
    const second=await supervisor.terminal_create(id,{cols:80,rows:24,cwd:join(dir,'home')});
    await supervisor.stop(id);
    await expect(supervisor.terminal_info(id,second.pid)).rejects.toThrow();
  }finally{
    await supervisor.close();
    rmSync(root,{recursive:true,force:true});
  }
});
