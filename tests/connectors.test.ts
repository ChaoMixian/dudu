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
      const result: any = await f.registry.call({id:'binding',connectorId:'echo',config:{answer:42}},'echo',{literal:'$(touch nope)'});
      expect(result.v.arguments.literal).toBe('$(touch nope)'); expect(result.v.config.answer).toBe(42); expect(result.secret).toBeNull(); expect(result.env).toBe('ok'); expect(f.registry.list()).toHaveLength(1);
      await expect(f.registry.call({id:'binding',connectorId:'echo',config:{}},'missing',{})).rejects.toThrow('Unknown tool');
      f.registry.remove('echo'); expect(f.registry.list()).toHaveLength(0);
    } finally { delete process.env.DUDU_FIXTURE_SECRET; f.clean(); }
  });
  test('command cancellation, timeout and invalid output', async () => {
    const f=fixture(); try {
      const base = {id:'slow',name:'Slow',description:'fixture',transport:'command' as const,tools:[tool]};
      f.registry.register({...base,argv:[process.execPath,'-e','setInterval(()=>{},1000)']});
      const binding={id:'b',connectorId:'slow',config:{}}; const ac=new AbortController();
      const running=f.registry.call(binding,'echo',{}, {signal:ac.signal}); setTimeout(()=>ac.abort(new Error('fixture cancellation')),30);
      await expect(running).rejects.toThrow('fixture cancellation');
      await expect(f.registry.call(binding,'echo',{}, {timeoutMs:30})).rejects.toThrow('timeout');
      f.registry.register({...base,argv:[process.execPath,'-e',`console.log('not json')`]});
      await expect(f.registry.call(binding,'echo',{})).rejects.toThrow('JSON');
    } finally {f.clean();}
  });
  test('HTTP JSON adapter and MCP direct binding namespace', async () => {
    const server = Bun.serve({port:0,fetch:async req=>Response.json(await req.json())}); const f=fixture();
    try {
      f.registry.register({id:'http',name:'HTTP',description:'fixture',transport:'http',url:server.url.toString(),tools:[tool]});
      const result:any=await f.registry.call({id:'api',connectorId:'http',config:{}},'echo',{x:1}); expect(result.arguments).toEqual({x:1});
      f.registry.register({id:'mcp',name:'MCP',description:'fixture',transport:'mcp',argv:['mcp-fixture','--fixed'],env:{FIXTURE:'1'},tools:[]});
      const config=toMcpServers([{id:'direct_namespace',connectorId:'mcp',config:{env:{EXTRA:'2'}}}],f.registry);
      expect(config.mcpServers.direct_namespace).toEqual({command:'mcp-fixture',args:['--fixed'],env:{FIXTURE:'1',EXTRA:'2'},exposure:'direct',description:'fixture'});
      expect(()=>toMcpServers([{id:'same',connectorId:'mcp',config:{}},{id:'same',connectorId:'mcp',config:{}}],f.registry)).toThrow('Duplicate');
    }finally{server.stop(true);f.clean();}
  });
  test('local transport is reserved for the built-in computer connector',async()=>{
    const f=fixture();try{
      expect(()=>f.registry.register({id:'local',name:'Local',description:'fixture',transport:'local',tools:[tool]})).toThrow('reserved');
      f.registry.register({id:'computer',name:'Computer',description:'builtin',transport:'local',tools:[tool]});
      expect(f.registry.list()[0]!.transport).toBe('local');
      await expect(f.registry.call({id:'b',connectorId:'computer',config:{}},'echo',{})).rejects.toThrow('in-process');
      expect(Object.keys(toMcpServers([{id:'b',connectorId:'computer',config:{}}],f.registry).mcpServers)).toHaveLength(0);
    }finally{f.clean();}
  });
  test('reject traversal and malformed definitions',()=>{
    expect(()=>validateConnector({id:'../escape'})).toThrow();
    expect(()=>validateConnector({id:'x',name:'X',description:'x',transport:'command',argv:[],tools:[]})).toThrow('argv');
  });
});
