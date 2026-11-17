import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ConfigStore } from './core/config';
import { Store } from './core/store';
import { Scheduler, type SessionFactory } from './agent/scheduler';
import { readSessionHistory, sanitizeSessionEvent } from './agent/session-view';
import { createPi } from './agent/pi';
import { ConnectorRegistry } from './connectors';
import { SourceManager } from './sources';
import { Computer } from './core/computer';
import { saveAttachments } from './core/attachments';
import { deleteWorkspace, listWorkspace, mkdirWorkspace, uploadWorkspaceFiles, workAttachment, workspaceFile } from './core/workspace-files';
import { eventInput, id, object, text, type DuduEvent, type ProviderConfig } from './contracts';
const STATIC_TYPES: Record<string,string> = {
  html:'text/html; charset=utf-8', htm:'text/html; charset=utf-8',
  js:'text/javascript; charset=utf-8', mjs:'text/javascript; charset=utf-8',
  css:'text/css; charset=utf-8', json:'application/json', map:'application/json',
  webmanifest:'application/manifest+json', xml:'application/xml',
  svg:'image/svg+xml', png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg',
  webp:'image/webp', gif:'image/gif', ico:'image/x-icon',
  woff:'font/woff', woff2:'font/woff2', ttf:'font/ttf', otf:'font/otf',
  txt:'text/plain; charset=utf-8', wasm:'application/wasm', pdf:'application/pdf',
  mp4:'video/mp4', webm:'video/webm', mkv:'video/x-matroska',
};
const staticType = (name: string) => STATIC_TYPES[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
const staticHeaders = (name: string) => ({
  'content-type': staticType(name),
  ...(/(?:^|\/)(?:build\.json|index\.html|manifest\.webmanifest)$/.test(name) ? { 'cache-control': 'no-store' } : {}),
});
function generatedBotId(name:string, taken:Set<string>) {
  const base=name.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,48)||'bot';
  let candidate='';
  do { candidate=`${base}-${crypto.randomUUID().slice(0,4)}`; } while(taken.has(candidate));
  return candidate;
}
export interface AppOptions { assets?: Record<string,string>; autoStart?: boolean }
export function createApp(root?:string, factory?:SessionFactory, options: AppOptions = {}) {
  const config=new ConfigStore(root);const store=new Store(join(config.root,'.dudu/state.sqlite'));const registry=new ConnectorRegistry(config.root);
  // One-time migration: the old built-in computer connector is now a core capability.
  const legacyComputer=join(config.root,'connectors','computer','connector.json');
  if(existsSync(legacyComputer)){try{const legacy=JSON.parse(readFileSync(legacyComputer,'utf8'));if(legacy?.id==='computer'&&legacy?.transport==='local')rmSync(join(config.root,'connectors','computer'),{recursive:true,force:true});}catch{}}
  const computer=new Computer(config,store);
  const submit=(input:any)=>{config.bot(input.botId);if(input.type==='message.web'||String(input.sourceId??'').startsWith('web:'))store.noteHumanMessage(input.botId);return store.publish(eventInput(input));};
  const sources=new SourceManager(config.root,store.db,submit);const scheduler=new Scheduler(store,config,factory??(botId=>createPi(botId,config,store,registry,sources,computer)));
  // Any wake event, including bare publishes from bot-to-bot sends and agent-submitted events,
  // must wake the scheduler without waiting for a later human interaction. Bot-to-bot events are
  // coalesced in a one-second window so a burst becomes one sequence-ordered idle batch.
  const systemEvent=(type:string,payload:unknown,botId='system')=>store.publish({botId,sourceId:'config',type,payload,delivery:'ignore'});
  const publishDigest=(type:string,payload:unknown,exclude?:string)=>{for(const bot of config.bots()){if(bot.id===exclude)continue;store.publish({botId:bot.id,sourceId:'workspace',type,payload,delivery:'digest'});}};
  const botWakeTimers=new Map<string,ReturnType<typeof setTimeout>>();
  store.listeners.add(event => {
    if(event.type==='agent.activity'){scheduler.setActivity(event.botId,String((event.payload as {summary?:unknown})?.summary??''));return;}
    if(event.delivery!=='wake')return;
    if(event.type==='message.bot'){if(!botWakeTimers.has(event.botId))botWakeTimers.set(event.botId,setTimeout(()=>{botWakeTimers.delete(event.botId);scheduler.notify(event.botId);},1000));return;}
    const pendingTimer=botWakeTimers.get(event.botId);if(pendingTimer){clearTimeout(pendingTimer);botWakeTimers.delete(event.botId);}
    queueMicrotask(() => scheduler.notify(event.botId));
  });
  const json=(body:unknown,status=200)=>Response.json(body,{status});
  const createToken=()=>`${crypto.randomUUID().replace(/-/g,'')}${crypto.randomUUID().replace(/-/g,'')}`;
  const advancedMode=()=>config.global().advancedMode===true;
  const requireAdvanced=()=>advancedMode()?null:json({error:'Advanced mode is disabled'},403);
  const formFiles=(form:FormData)=>form.getAll('files').filter((value):value is File => !!value && typeof value==='object' && typeof (value as File).arrayBuffer==='function');
  // The computer stream is proxied through this same HTTP port so remote (frp) users never
  // need to reach voxl's loopback port. Short-lived tickets authorize iframe asset/WS requests.
  const liveTickets=new Map<string,{url:string;expires:number}>();
  const terminalTickets=new Map<string,{botId:string;desktopId:string;pid:number;expires:number}>();
  let httpServer:any;
  const issueLiveUrl=(botId:string,watchUrl:string)=>{const now=Date.now();for(const [key,ticket] of liveTickets)if(ticket.expires<now)liveTickets.delete(key);const ticket=crypto.randomUUID();liveTickets.set(ticket,{url:watchUrl,expires:now+4*60*60_000});return `/api/bots/${encodeURIComponent(botId)}/computer/live/${ticket}/`;};
  async function proxyLive(req:Request,url:URL,parts:string[]):Promise<Response>{
    const ticket=liveTickets.get(parts[5]??'');
    if(!ticket||ticket.expires<Date.now())return json({error:'Live computer session expired'},403);
    if(parts.length===6&&!url.pathname.endsWith('/'))return new Response(null,{status:302,headers:{location:`${url.pathname}/${url.search}`}});
    const asset=parts.slice(6).join('/');
    const target=new URL(ticket.url);
    if(asset==='ws'){
      if(!httpServer)return json({error:'WebSocket server unavailable'},503);
      const wsTarget=new URL(ticket.url);wsTarget.protocol=wsTarget.protocol==='https:'?'wss:':'ws:';wsTarget.pathname='/ws';
      const upgraded=httpServer.upgrade(req,{data:{target:wsTarget.href,queue:[]}});
      return upgraded?undefined as unknown as Response:json({error:'WebSocket upgrade failed'},400);
    }
    target.pathname=`/${asset}`;
    const response=await fetch(target,{headers:{accept:req.headers.get('accept')??'*/*'},signal:AbortSignal.timeout(30000)});
    const headers=new Headers();for(const name of ['content-type','cache-control']) {const value=response.headers.get(name);if(value)headers.set(name,value);}
    return new Response(response.body,{status:response.status,headers});
  }
  const websocket={
    open(ws:any){
      if(ws.data.mode==='terminal'){
        try {
          const initial=computer.supervisor.terminal_snapshot(ws.data.desktopId,ws.data.pid);
          ws.data.off=computer.supervisor.terminal_subscribe(ws.data.desktopId,ws.data.pid,(data:string)=>{try{ws.send(JSON.stringify({type:'output',data}));}catch{}});
          if(initial)ws.send(JSON.stringify({type:'output',data:initial}));
          ws.send(JSON.stringify({type:'ready'}));
        } catch { try{ws.close();}catch{} }
        return;
      }
      const upstream=new WebSocket(ws.data.target);upstream.binaryType='arraybuffer';ws.data.upstream=upstream;upstream.addEventListener('open',()=>{for(const message of ws.data.queue.splice(0))upstream.send(message);});upstream.addEventListener('message',(event:any)=>ws.send(event.data));upstream.addEventListener('close',()=>{try{ws.close();}catch{}});upstream.addEventListener('error',()=>{try{ws.close();}catch{}});
    },
    message(ws:any,message:any){
      if(ws.data.mode==='terminal'){
        let value:any;
        try { value=JSON.parse(typeof message==='string'?message:Buffer.from(message).toString()); } catch { return; }
        if(value?.type==='input'&&typeof value.data==='string')void computer.supervisor.terminal_send(ws.data.desktopId,ws.data.pid,value.data).catch(()=>{});
        if(value?.type==='resize'&&Number.isInteger(value.cols)&&Number.isInteger(value.rows))void computer.supervisor.terminal_resize(ws.data.desktopId,ws.data.pid,value.cols,value.rows).catch(()=>{});
        if(value?.type==='close'){try{ws.close();}catch{}}
        return;
      }
      const upstream=ws.data.upstream;if(upstream&&upstream.readyState===WebSocket.OPEN)upstream.send(message);else ws.data.queue.push(message);
    },
    close(ws:any){
      if(ws.data.mode==='terminal'){try{ws.data.off?.();}catch{}return;}
      try{ws.data.upstream?.close();}catch{}
    },
  };
  async function handle(req:Request):Promise<Response> { const url=new URL(req.url);const path=url.pathname;try {
    if(path==='/healthz')return json({ok:true});
    if(path.startsWith('/api/')) {const current=config.global();const token=current.token??process.env.DUDU_TOKEN;const authRequired=!!token||!!current.passwordHash;
      const liveProxyPath=/^\/api\/bots\/[^/]+\/computer\/live\/[^/]+(?:\/|$)/.test(path);
      const terminalWsPath=/^\/api\/bots\/[^/]+\/terminal\/ws$/.test(path);
      if(path==='/api/auth/status')return json({authRequired});
      if(path==='/api/auth/login'&&req.method==='POST') {
        const v=object(await req.json());
        const password=typeof v.password==='string'?v.password.trim():'';
        let valid=false;
        if(current.passwordHash) valid=await Bun.password.verify(password,current.passwordHash).catch(()=>false);
        else if(token) valid=password===token;
        else valid=!authRequired;
        if(!valid)return json({error:'Invalid password'},401);
        let accessToken=token;
        if(!accessToken&&current.passwordHash) {
          const latest=config.global();
          accessToken=latest.token??process.env.DUDU_TOKEN;
          if(!accessToken) {
            accessToken=createToken();
            config.setGlobal({...latest,token:accessToken});
            systemEvent('config.changed',{section:'auth'});
          }
        }
        return json({token:accessToken??''});
      }
      const authorized=!!token&&req.headers.get('authorization')===`Bearer ${token}`;
      if(authRequired&&!liveProxyPath&&!terminalWsPath&&!authorized&&!(path==='/api/stream'&&url.searchParams.get('token')===token))return json({error:'Unauthorized'},401);
      if(req.method==='OPTIONS')return new Response(null,{status:204,headers:{'access-control-allow-methods':'GET,POST,PUT,DELETE,OPTIONS','access-control-allow-headers':'content-type,authorization,last-event-id','access-control-max-age':'600'}});
      const parts=path.split('/').filter(Boolean);const data=async()=>object(await req.json());
      if(liveProxyPath)return await proxyLive(req,url,parts);
      if(terminalWsPath){
        if(!httpServer)return json({error:'WebSocket server unavailable'},503);
        if(!advancedMode())return json({error:'Advanced mode is disabled'},403);
        const key=url.searchParams.get('ticket')??'';
        const ticket=terminalTickets.get(key);
        terminalTickets.delete(key);
        const botId=parts[2]??'';
        if(!ticket||ticket.expires<Date.now()||ticket.botId!==botId)return json({error:'Terminal session expired'},403);
        const upgraded=httpServer.upgrade(req,{data:{mode:'terminal',botId:ticket.botId,desktopId:ticket.desktopId,pid:ticket.pid}});
        return upgraded?undefined as unknown as Response:json({error:'WebSocket upgrade failed'},400);
      }
      if(path==='/api/state') {const c=config.global();return json({bots:config.bots(),connectors:registry.list(),sources:sources.list(),providers:c.providers,defaults:{provider:c.defaultProvider,model:c.defaultModel},autoStartComputers:c.autoStartComputers!==false,advancedMode:c.advancedMode===true,setupCompleted:c.setupCompleted===true,profile:c.profile??{},statuses:config.bots().map(b=>scheduler.status(b.id)),messages:store.messages(),botThreads:store.botThreads(),desktops:await computer.desktops(),seq:store.latestSeq()});}
      if(path==='/api/events'&&req.method==='POST')return json(submit(await data()),202);
      if(path==='/api/events'&&req.method==='GET')return json(store.replay(Number(url.searchParams.get('after')??0)));
      if(path==='/api/stream') {const after=Number(req.headers.get('last-event-id')??url.searchParams.get('after')??0);if(!Number.isSafeInteger(after)||after<0)throw new Error('Invalid SSE cursor');const encoder=new TextEncoder();let cleanup=()=>{};const stream=new ReadableStream<Uint8Array>({start(controller){let cursor=after;const send=(e:DuduEvent)=>{if(e.seq<=cursor)return;cursor=e.seq;controller.enqueue(encoder.encode(`id: ${e.seq}\nevent: update\ndata: ${JSON.stringify(e)}\n\n`));};let page:DuduEvent[];do{page=store.replay(cursor);for(const e of page)send(e);}while(page.length===500);const listener=(e:DuduEvent)=>send(e);store.listeners.add(listener);const timer=setInterval(()=>controller.enqueue(encoder.encode(': heartbeat\n\n')),15000);cleanup=()=>{clearInterval(timer);store.listeners.delete(listener);};req.signal.addEventListener('abort',()=>{cleanup();try{controller.close();}catch{}},{once:true});},cancel(){cleanup();}});return new Response(stream,{headers:{'content-type':'text/event-stream','cache-control':'no-cache','connection':'keep-alive'}});}
      if(path==='/api/bots'&&req.method==='POST'){const input=await data();if(!input.id){input.id=generatedBotId(typeof input.name==='string'?input.name:'',new Set(config.bots().map(b=>b.id)));}
        const bot=config.saveBot(input,true);store.setContextSeq(bot.id,store.latestSeq());publishDigest('bot.created',{botId:bot.id,name:bot.name,description:bot.description},bot.id);
        store.publish({botId:bot.id,sourceId:'dudu',type:'bot.init',replyTo:{kind:'web',id:'default'},payload:{instruction:`You were just created as “${bot.name}”. ${bot.description?`Your description or instructions: ${bot.description}. `:''}Based on this, decide what kind of work you can take on. Call environment action="bots" to see existing Bots. Use reply route {"kind":"web","id":"default"} for message_send; do not use your Bot ID as the conversation ID. Send one short introduction with message_send, and ask what the user wants to do using kind="ask" with 2–4 concise options; the UI adds a free-text answer row automatically.`},delivery:'wake'});
        void computer.call(bot.id,'start').catch(error=>store.publish({botId:bot.id,sourceId:'computer',type:'computer.error',payload:{error:String(error)},delivery:'digest'}));return json(bot,201);}
      if(parts[1]==='bots'&&parts[2]) {const botId=id(parts[2]);const bot=config.bot(botId);
        if(parts.length===3&&req.method==='DELETE'){void computer.call(botId,'stop').catch(()=>{});await scheduler.cancel(botId);scheduler.slots.delete(botId);config.removeBot(botId);store.deleteBotData(botId);publishDigest('bot.deleted',{botId,name:bot.name},botId);return json({removed:true});}
        if(parts.length===3&&req.method==='PUT'){const input=await data();const next=config.saveBot({...bot,...input,id:botId});publishDigest('bot.updated',{botId,name:next.name});scheduler.invalidate(botId);return json(next);}
        if(parts[3]==='pause'||parts[3]==='resume'||parts[3]==='stop') {if(req.method!=='POST')return json({error:'Method not allowed'},405);const action=parts[3];if(action==='stop'||action==='pause'){config.saveBot({...bot,paused:true});await scheduler.cancel(botId);}else {config.saveBot({...bot,paused:false});if(action==='resume')scheduler.notify(botId);}systemEvent('bot.state.changed',{action,paused:action!=='resume'},botId);return json(scheduler.status(botId));}
        if(parts[3]==='peers'&&parts[4]&&parts[5]==='messages') {const peerId=id(parts[4]);config.bot(peerId);return json(store.botHistory(botId,peerId));}
        if(parts[3]==='uploads'&&req.method==='POST'){const files=formFiles(await req.formData());if(!files.length)throw new Error('No files');return json({files:await uploadWorkspaceFiles(config,botId,'work/uploads',files,{ensureDir:true})},201);}
        if(parts[3]==='files'&&parts[4]==='mkdir'&&req.method==='POST'){const denied=requireAdvanced();if(denied)return denied;const v=await data();return json(await mkdirWorkspace(config,botId,String(v.path??'')),201);}
        if(parts[3]==='files'&&!parts[4]){const denied=requireAdvanced();if(denied)return denied;const target=url.searchParams.get('path')??'';if(req.method==='GET')return json({path:target,entries:await listWorkspace(config,botId,target)});if(req.method==='POST'){const files=formFiles(await req.formData());if(!files.length)throw new Error('No files');return json({files:await uploadWorkspaceFiles(config,botId,target,files)},201);}if(req.method==='DELETE')return json(await deleteWorkspace(config,botId,target,url.searchParams.get('recursive')==='1'));return json({error:'Method not allowed'},405);}
        if(parts[3]==='file'&&req.method==='GET'){const denied=requireAdvanced();if(denied)return denied;const file=await workspaceFile(config,botId,url.searchParams.get('path')??'');const headers:Record<string,string>={'content-type':file.mime,'cache-control':'no-store','content-length':String(file.size)};if(url.searchParams.get('download')==='1')headers['content-disposition']=`attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`;return new Response(file.file,{headers});}
        if(parts[3]==='terminal'&&parts[4]==='kill'&&req.method==='POST'){
          const denied=requireAdvanced();if(denied)return denied;
          const v=await data();
          const pid=Number.isSafeInteger(v.pid)&&v.pid>0?v.pid:0;
          if(!pid)throw new Error('Invalid terminal pid');
          const target=computer.target(botId);
          await computer.supervisor.terminal_close(target.desktopId,pid);
          return json({closed:true});
        }
        if(parts[3]==='terminal'&&!parts[4]&&req.method==='POST'){
          const denied=requireAdvanced();if(denied)return denied;
          const v=await data();
          const cols=Number.isInteger(v.cols)?v.cols:100, rows=Number.isInteger(v.rows)?v.rows:30;
          const status=await computer.call(botId,'status');
          if(status.state!=='ready')await computer.call(botId,'start');
          const target=computer.target(botId);
          const requested=Number.isSafeInteger(v.pid)&&v.pid>0?v.pid:undefined;
          let pid: number | undefined;
          if(requested){
            try {
              const info=await computer.supervisor.terminal_info(target.desktopId,requested);
              if(info.alive){
                pid=requested;
                await computer.supervisor.terminal_resize(target.desktopId,requested,cols,rows).catch(()=>{});
              }
            } catch { /* stale terminal from before a restart */ }
          }
          if(!pid){
            const created=await computer.supervisor.terminal_create(target.desktopId,{cols,rows,cwd:join(config.botPath(botId),'work')});
            pid=created.pid;
          }
          const now=Date.now();for(const [key,ticket] of terminalTickets)if(ticket.expires<now)terminalTickets.delete(key);
          const ticket=crypto.randomUUID();
          terminalTickets.set(ticket,{botId,desktopId:target.desktopId,pid,expires:now+60_000});
          return json({ticket,pid,desktopId:target.desktopId},201);
        }
        if(parts[3]==='session'&&parts[4]==='history'&&req.method==='GET'){
          const denied=requireAdvanced();if(denied)return denied;
          const raw=url.searchParams.get('before');
          const before=raw===null?undefined:Number(raw);
          if(before!==undefined&&(!Number.isSafeInteger(before)||before<0))throw new Error('Invalid history cursor');
          return json(await readSessionHistory(config,botId,before));
        }
        if(parts[3]==='session'&&parts[4]==='stream'&&req.method==='GET'){
          const denied=requireAdvanced();if(denied)return denied;
          const encoder=new TextEncoder();
          let cleanup=()=>{};
          const stream=new ReadableStream<Uint8Array>({
            start(controller){
              let closed=false,live=false;const pending:any[]=[];let heartbeat:ReturnType<typeof setInterval>|undefined;
              const frame=(kind:string,payload:Record<string,unknown>)=>{if(closed)return;try{controller.enqueue(encoder.encode(`event: session\ndata: ${JSON.stringify({kind,...payload})}\n\n`));}catch{}};
              const off=scheduler.observe(botId,event=>{if(closed)return;if(!live){pending.push(event);return;}frame('agent',{event:sanitizeSessionEvent(event),at:new Date().toISOString()});});
              cleanup=()=>{if(closed)return;closed=true;off();if(heartbeat)clearInterval(heartbeat);};
              req.signal.addEventListener('abort',()=>{cleanup();try{controller.close();}catch{}},{once:true});
              void readSessionHistory(config,botId).then(history=>{
                if(closed)return;
                frame('history',{entries:history.entries,cursor:history.cursor,hasMore:history.hasMore});
                live=true;
                for(const event of pending.splice(0))frame('agent',{event:sanitizeSessionEvent(event),at:new Date().toISOString()});
                heartbeat=setInterval(()=>{try{controller.enqueue(encoder.encode(': heartbeat\n\n'));}catch{}},15000);
              }).catch(error=>{if(closed)return;frame('error',{error:String(error)});cleanup();try{controller.close();}catch{}});
            },
            cancel(){cleanup();}
          });
          return new Response(stream,{headers:{'content-type':'text/event-stream','cache-control':'no-cache','connection':'keep-alive'}});
        }
        if(parts[3]==='computer'&&parts[4]) {const action=parts[4];let result:any;try{result=await computer.call(botId,action,req.method==='POST'?await data():{});}catch(error){if(action==='start'||action==='stop')store.publish({botId,sourceId:'computer',type:'computer.error',payload:{error:String(error)},delivery:'digest'});throw error;}if(action==='shot')return new Response(Buffer.from(result.base64,'base64'),{headers:{'content-type':'image/png'}});if(action==='watch'&&typeof result.url==='string')result.proxyUrl=issueLiveUrl(botId,result.url);return json(result);}
      }
      if(path==='/api/messages'&&req.method==='POST'){const v=await data();const botId=id(v.botId);config.bot(botId);const conversationId=id(v.conversationId??'default');const content=typeof v.text==='string'?v.text.trim():'';const replyTo=v.replyTo?id(v.replyTo):undefined;if(replyTo){const target=store.messageById(replyTo);if(!target||target.botId!==botId)throw new Error('Unknown reply target');}const inputs=Array.isArray(v.attachments)?v.attachments.map(item=>{const attachment=object(item);return {path:attachment.path,name:attachment.name};}):[];if(!content&&!inputs.length)throw new Error('text or attachments are required');if(inputs.length>8)throw new Error('At most 8 attachments are allowed');const resolved:{relative:string;name:string;mime:string;size:number}[]=[];for(const input of inputs){const file=await workAttachment(config,botId,input.path);resolved.push({...file,name:typeof input.name==='string'&&input.name.trim()?input.name.trim().slice(0,200):file.name});}const attachments=resolved.length?saveAttachments(config,botId,resolved.map(file=>({path:file.relative,name:file.name}))):undefined;const message=store.message(botId,conversationId,'user',content,'accepted',undefined,'message',undefined,undefined,replyTo,attachments);const accepted=submit({botId,sourceId:`web:${conversationId}`,type:'message.web',payload:{text:content,messageId:message.id,replyTo,...(resolved.length?{attachments:resolved.map(file=>({name:file.name,path:file.relative,mime:file.mime,size:file.size}))}:{})},replyTo:{kind:'web',id:conversationId}});return json({message,...accepted,status:'accepted'},202);}
      if(path==='/api/reactions'&&req.method==='POST'){const v=await data();const botId=id(v.botId);config.bot(botId);const messageId=id(v.messageId);const emoji=text(v.emoji,'emoji').slice(0,32);const target=store.messageById(messageId);if(!target||target.botId!==botId||target.kind==='reaction')throw new Error('Unknown reaction target');return json(store.toggleReaction(botId,target.conversationId,messageId,emoji,'user'));}
      if(path==='/api/connectors'&&req.method==='POST'){const result=registry.register(await data() as any);for(const b of config.bots())scheduler.invalidate(b.id);systemEvent('config.changed',{section:'connectors',connectorId:result.id});publishDigest('connector.changed',{connectorId:result.id,action:'saved'});return json(result,201);}
      if(path==='/api/sources'&&req.method==='POST'){const v=await data();config.bot(v.botId);return json(sources.register(v as any),201);}
      if(parts[1]==='sources'&&parts[2]) {const sourceId=id(parts[2]);if(req.method==='DELETE')return json({removed:sources.remove(sourceId)});if(req.method==='POST'){if(parts[3]==='trigger')return json(await sources.trigger(sourceId),202);if(['enable','disable'].includes(parts[3]))return json(sources.enable(sourceId,parts[3]==='enable'));}}
      if(path==='/api/defaults'&&req.method==='PUT'){const v=await data();const provider=typeof v.provider==='string'&&v.provider?String(v.provider):undefined;const model=typeof v.model==='string'&&v.model?String(v.model):undefined;
        if(provider){const selected=config.global().providers.find(p=>p.id===provider);if(!selected||!model||!selected.models.some(m=>m.id===model))throw new Error('Choose an existing provider and model');}
        const previous=config.global();const next={...previous,defaultProvider:provider,defaultModel:provider?model:undefined};config.setGlobal(next);
        for(const b of config.bots())if(!b.model)scheduler.invalidate(b.id);systemEvent('config.changed',{section:'defaults'});publishDigest('config.defaults',{previousProvider:previous.defaultProvider,previousModel:previous.defaultModel,provider:next.defaultProvider,model:next.defaultModel});return json({defaults:{provider:next.defaultProvider,model:next.defaultModel}});}
      if(path==='/api/profile'&&req.method==='PUT'){const v=await data();const name=typeof v.name==='string'?v.name.trim():'';if(name.length>80)throw new Error('Name is too long');const avatar=typeof v.avatar==='string'&&v.avatar? v.avatar: undefined;if(avatar&&avatar.length>2_000_000)throw new Error('Avatar is too large');if(avatar&&!/^data:image\/(?:png|jpe?g|webp|gif|svg\+xml)[;,]/.test(avatar)&&!/^https?:\/\//.test(avatar))throw new Error('Invalid avatar');const avatarStyle=typeof v.avatarStyle==='string'&&/^[a-z0-9-]{1,32}$/.test(v.avatarStyle)?v.avatarStyle:undefined;const avatarPreset=typeof v.avatarPreset==='string'&&/^[a-z0-9-]{1,32}$/.test(v.avatarPreset)?v.avatarPreset:undefined;const profile={...(name?{name}:{}),...(avatar?{avatar}:{}),...(avatarStyle?{avatarStyle}:{}),...(avatarPreset?{avatarPreset}:{})};config.setGlobal({...config.global(),profile});systemEvent('config.changed',{section:'profile'});return json({profile});}
      if(path==='/api/computer-settings'&&req.method==='PUT'){const v=await data();if(typeof v.autoStart!=='boolean')throw new Error('autoStart must be a boolean');config.setGlobal({...config.global(),autoStartComputers:v.autoStart});systemEvent('config.changed',{section:'computer',autoStart:v.autoStart});return json({autoStartComputers:v.autoStart});}
      if(path==='/api/advanced-settings'&&req.method==='PUT'){const v=await data();if(typeof v.advancedMode!=='boolean')throw new Error('advancedMode must be a boolean');config.setGlobal({...config.global(),advancedMode:v.advancedMode});systemEvent('config.changed',{section:'advanced',advancedMode:v.advancedMode});return json({advancedMode:v.advancedMode});}
      if(path==='/api/setup/password'&&req.method==='PUT'){
        const v=await data();
        const password=typeof v.password==='string'?v.password.trim():'';
        if(password.length<6||password.length>128)throw new Error('Password must be 6-128 characters');
        const current=config.global();
        const accessToken=current.token??createToken();
        const passwordHash=await Bun.password.hash(password);
        config.setGlobal({...current,token:accessToken,passwordHash});
        systemEvent('config.changed',{section:'auth'});
        return json({token:accessToken});
      }
      if(path==='/api/setup'&&req.method==='PUT'){const v=await data();if(typeof v.completed!=='boolean')throw new Error('completed must be a boolean');config.setGlobal({...config.global(),setupCompleted:v.completed});systemEvent('config.changed',{section:'setup',setupCompleted:v.completed});return json({setupCompleted:v.completed});}
      if(path==='/api/providers/models'&&req.method==='POST'){const v=await data();const baseUrl=text(v.baseUrl,'baseUrl');const target=new URL(baseUrl);if(!['http:','https:'].includes(target.protocol))throw new Error('baseUrl must be an HTTP(S) URL');if(!['openai-completions','openai-responses','anthropic-messages'].includes(v.api))throw new Error('Unsupported provider API');
        const base=baseUrl.replace(/\/+$/,'');const endpoint=base.endsWith('/v1')?`${base}/models`:`${base}/v1/models`;const headers:Record<string,string>={accept:'application/json'};const key=typeof v.apiKey==='string'?v.apiKey.trim():'';
        if(v.api==='anthropic-messages'){if(key)headers['x-api-key']=key;headers['anthropic-version']='2023-06-01';}else if(key)headers.authorization=`Bearer ${key}`;
        const response=await fetch(endpoint,{headers,signal:AbortSignal.any([req.signal,AbortSignal.timeout(15000)])});if(!response.ok)throw new Error(`Model discovery failed: HTTP ${response.status} ${response.statusText}`.trim());
        const payload=await response.json() as {data?:unknown[];models?:unknown[]};const rows=Array.isArray(payload.data)?payload.data:Array.isArray(payload.models)?payload.models:[];
        const models=rows.map(row=>typeof row==='string'?{id:row,name:row}:{id:(row as any)?.id,name:(row as any)?.name??(row as any)?.display_name??(row as any)?.id}).filter((model):model is {id:string;name:string}=>typeof model.id==='string'&&model.id.length>0);
        return json({models});}
      if(path==='/api/providers'&&req.method==='PUT'){const v=await data();if(!Array.isArray(v.providers))throw new Error('providers must be an array');const providers=v.providers as ProviderConfig[];for(const p of providers){id(p.id);new URL(p.baseUrl);if(!['openai-completions','openai-responses','anthropic-messages'].includes(p.api))throw new Error('Unsupported provider API');if(p.apiKey!==undefined&&typeof p.apiKey!=='string')throw new Error('apiKey must be a string');if(p.name!==undefined&&(typeof p.name!=='string'||p.name.length>160))throw new Error('Invalid provider name');if(!Array.isArray(p.models)||!p.models.length)throw new Error('Provider requires models');for(const m of p.models){text(m.id);if(m.name!==undefined)text(m.name);m.name??=m.id;}}
        const previous=config.global();const next={...previous,providers};if(next.defaultProvider){const selected=providers.find(p=>p.id===next.defaultProvider);if(!selected||!next.defaultModel||!selected.models.some(m=>m.id===next.defaultModel)){delete next.defaultProvider;delete next.defaultModel;}}
        config.setGlobal(next);for(const b of config.bots())scheduler.invalidate(b.id);systemEvent('config.changed',{section:'providers'});publishDigest('config.providers',{});if(previous.defaultProvider!==next.defaultProvider||previous.defaultModel!==next.defaultModel)publishDigest('config.defaults',{previousProvider:previous.defaultProvider,previousModel:previous.defaultModel,provider:next.defaultProvider,model:next.defaultModel});return json({providers,defaults:{provider:next.defaultProvider,model:next.defaultModel}});}
      if(parts[1]==='artifacts'&&parts.length===4){const name=parts[3];if(!/^[\w.-]+$/.test(name))throw new Error('Invalid artifact name');const file=Bun.file(join(config.botPath(id(parts[2])),'artifacts',name));if(!await file.exists())return json({error:'Not found'},404);return new Response(file,{headers:{'content-type':file.type||staticType(name)}});}
      return json({error:'Not found'},404);
    }
    const relative=path==='/'?'index.html':decodeURIComponent(path).replace(/^\//,'');
    // Compiled binaries embed the UI; source runs serve the dist directory.
    if(options.assets){const key=options.assets[`/${relative}`]?`/${relative}`:'/index.html';const embedded=options.assets[key];if(!embedded)return new Response('Build UI first: bun run build',{status:503});return new Response(Bun.file(embedded),{headers:staticHeaders(key)});}
    const dist=resolve(import.meta.dir,'../dist');let filePath=resolve(dist,relative);if(!filePath.startsWith(dist+'/'))return json({error:'Invalid path'},400);let file=Bun.file(filePath);if(!await file.exists()){filePath=join(dist,'index.html');file=Bun.file(filePath);}if(!await file.exists())return new Response('Build UI first: npm run build',{status:503});return new Response(file,{headers:staticHeaders(filePath)});
  }catch(error){return json({error:error instanceof Error?error.message:String(error)},400);} }
  // Echo the request origin so the LAN-facing dev UI (vite on 0.0.0.0) can call the API from any host address.
  async function fetchRequest(req:Request):Promise<Response> { const origin=req.headers.get('origin');const response=await handle(req);if(!response)return response as unknown as Response;if(origin)response.headers.set('access-control-allow-origin',origin);return response; }
  sources.start();for(const bot of config.bots())scheduler.notify(bot.id);
  if(options.autoStart)void computer.startConfigured();
  return {fetch:fetchRequest,websocket,bindServer(server:any){httpServer=server;},config,store,sources,scheduler,registry,computer,async close(){for(const timer of botWakeTimers.values())clearTimeout(timer);botWakeTimers.clear();await sources.stop();await scheduler.close();await computer.close();store.close();}};
}
export interface StartOptions { workspace?: string; host?: string; port?: number; assets?: Record<string,string> }
export function startServer(options: StartOptions = {}) {
  const app=createApp(options.workspace, undefined, {assets: options.assets, autoStart: true});
  const c=app.config.global();
  const server=Bun.serve({hostname:options.host??process.env.DUDU_HOST??c.host,port:options.port??Number(process.env.DUDU_PORT??c.port),idleTimeout:0,fetch:app.fetch,websocket:app.websocket as any});
  app.bindServer(server);console.log(`dudu http://${server.hostname}:${server.port} workspace=${app.config.root}`);
  let closing=false;for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{
    if(closing){process.exit(1);return;}
    closing=true;server.stop(true);
    // A stuck agent or desktop cleanup must not leave an orphan server holding the workspace lock.
    const force=setTimeout(()=>process.exit(1),10000);force.unref();
    void app.close().finally(()=>{clearTimeout(force);process.exit(0);});
  });
  return {app,server};
}
if(import.meta.main) startServer();
