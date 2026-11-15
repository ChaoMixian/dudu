import { describe, test, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConnectorRegistry, toMcpServers, validateConnector } from '../src/connectors';

function fixture() { const root = mkdtempSync(join(tmpdir(), 'dudu-connectors-')); return { root, registry: new ConnectorRegistry(root), clean: () => rmSync(root,{recursive:true,force:true}) }; }
const tool = { name: 'echo', description: 'echo input', parameters: { type:'object' } };
describe('connector fixtures', () => {
  test('registry, fixed argv JSON protocol and explicit environment', async () => {
    const f = fixture(); try {
      f.registry.register({ id:'echo', name:'Echo', description:'fixture', transport:'command', argv:[process.execPath,'-e', `let s='';for await(const c of process.stdin)s+=c; const v=JSON.parse(s); console.log(JSON.stringify({v,secret:process.env.DUDU_FIXTURE_SECRET??null,env:process.env.FIXTURE}));`], env:{FIXTURE:'ok'}, tools:[tool] });
      process.env.DUDU_FIXTURE_SECRET = 'not-inherited';
      const result: any = await f.registry.call('echo','echo',{literal:'$(touch nope)'});
      expect(result.v.arguments.literal).toBe('$(touch nope)'); expect(result.v.config).toEqual({}); expect(result.secret).toBeNull(); expect(result.env).toBe('ok'); expect(f.registry.list()).toHaveLength(1);
      await expect(f.registry.call('echo','missing',{})).rejects.toThrow('Unknown tool');
      f.registry.remove('echo'); expect(f.registry.list()).toHaveLength(0);
    } finally { delete process.env.DUDU_FIXTURE_SECRET; f.clean(); }
  });
  test('command cancellation, timeout and invalid output', async () => {
    const f=fixture(); try {
      const base = {id:'slow',name:'Slow',description:'fixture',transport:'command' as const,tools:[tool]};
      f.registry.register({...base,argv:[process.execPath,'-e','setInterval(()=>{},1000)']});
      const ac=new AbortController();
      const running=f.registry.call('slow','echo',{}, {signal:ac.signal}); setTimeout(()=>ac.abort(new Error('fixture cancellation')),30);
      await expect(running).rejects.toThrow('fixture cancellation');
      await expect(f.registry.call('slow','echo',{}, {timeoutMs:30})).rejects.toThrow('timeout');
      f.registry.register({...base,argv:[process.execPath,'-e',`console.log('not json')`]});
      await expect(f.registry.call('slow','echo',{})).rejects.toThrow('JSON');
    } finally {f.clean();}
  });
  test('HTTP JSON adapter and MCP namespace', async () => {
    const server = Bun.serve({port:0,fetch:async req=>Response.json(await req.json())}); const f=fixture();
    try {
      f.registry.register({id:'http',name:'HTTP',description:'fixture',transport:'http',url:server.url.toString(),tools:[tool]});
      const result:any=await f.registry.call('http','echo',{x:1}); expect(result.arguments).toEqual({x:1});
      f.registry.register({id:'mcp',name:'MCP',description:'fixture',transport:'mcp',argv:['mcp-fixture','--fixed'],env:{FIXTURE:'1'},tools:[]});
      const config=toMcpServers(f.registry.list());
      expect(config.mcpServers.mcp).toEqual({command:'mcp-fixture',args:['--fixed'],env:{FIXTURE:'1'},exposure:'direct',description:'fixture'});
      expect(Object.keys(config.mcpServers)).toEqual(['mcp']);
    }finally{server.stop(true);f.clean();}
  });
  test('local transport is removed',()=>{
    const f=fixture();try{
      expect(()=>f.registry.register({id:'local',name:'Local',description:'fixture',transport:'local',tools:[tool]} as any)).toThrow('Invalid connector transport');
      expect(()=>f.registry.register({id:'computer',name:'Computer',description:'fixture',transport:'http',url:'https://example.com',tools:[tool]})).toThrow('reserved');
      expect(f.registry.list()).toHaveLength(0);
    }finally{f.clean();}
  });
  test('reject traversal and malformed definitions',()=>{
    expect(()=>validateConnector({id:'../escape'})).toThrow();
    expect(()=>validateConnector({id:'x',name:'X',description:'x',transport:'command',argv:[],tools:[]})).toThrow('argv');
  });
});
