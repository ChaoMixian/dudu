import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {BotdSupervisor} from '../src/botd/supervisor';
test('desktop supervisor initializes independent roots and reports dependencies',async()=>{const roots=[mkdtempSync(join(tmpdir(),'desktop-a-')),mkdtempSync(join(tmpdir(),'desktop-b-'))];const supervisors=roots.map(root=>new BotdSupervisor({root}));try{await Promise.all(supervisors.map(supervisor=>supervisor.init()));expect(await supervisors[0]!.list()).toEqual([]);expect(await supervisors[1]!.list()).toEqual([]);const doctor=await supervisors[0]!.doctor();expect(doctor.root).toBe(roots[0]);expect(Object.keys(doctor.dependencies)).toContain('Xvfb');await expect(supervisors[0]!.get('../escape')).rejects.toThrow();}finally{for(const supervisor of supervisors)await supervisor.close();for(const root of roots)rmSync(root,{recursive:true,force:true});}});
