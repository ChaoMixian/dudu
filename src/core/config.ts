import { mkdirSync, readFileSync, existsSync, readdirSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { id, object, text, type BotConfig, type ComputerConfig, type GlobalConfig } from '../contracts';
import { workspaceRoot } from './workspace';
import { ensureBotFiles } from './bot-files';
export function saveJson(path: string, data: unknown) { const tmp = `${path}.${crypto.randomUUID()}.tmp`; writeFileSync(tmp, JSON.stringify(data,null,2)+'\n', {mode:0o600}); renameSync(tmp,path); }
function legacyComputer(value: unknown): unknown {
  if (!Array.isArray(value)) return undefined;
  const binding = value.find((item: any) => item && item.connectorId === 'computer' && item.config && typeof item.config === 'object');
  return binding?.config;
}
function computerConfig(value: unknown, botId: string): ComputerConfig {
  const v = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const width = Number.isInteger(v.width) && (v.width as number) >= 320 && (v.width as number) <= 3840 ? v.width as number : 1280;
  const height = Number.isInteger(v.height) && (v.height as number) >= 240 && (v.height as number) <= 2160 ? v.height as number : 800;
  const desktopId = typeof v.desktopId === 'string' && v.desktopId ? id(v.desktopId) : id(`${botId}-computer`);
  const watchUrl = typeof v.watchUrl === 'string' && v.watchUrl ? v.watchUrl.slice(0, 2048) : undefined;
  return { desktopId, width, height, ...(watchUrl ? { watchUrl } : {}) };
}
export class ConfigStore {
  root: string;
  constructor(root = workspaceRoot()) {
    this.root=workspaceRoot(root);
    for(const p of ['bots','connectors','.dudu']) mkdirSync(join(this.root,p),{recursive:true});
    if(!existsSync(this.globalPath)) {
      saveJson(this.globalPath,{host:'127.0.0.1',port:7331,providers:[],autoStartComputers:true,setupCompleted:false});
    } else {
      const current=this.global();
      if(typeof current.setupCompleted!=='boolean') {
        // Existing workspaces predate the setup gate. Treat a workspace that
        // already has a Bot or provider as configured; keep fresh ones pending.
        const configured=(Array.isArray(current.providers)&&current.providers.length>0) || readdirSync(join(this.root,'bots'),{withFileTypes:true})
          .some(entry=>entry.isDirectory()&&existsSync(join(this.root,'bots',entry.name,'bot.json')));
        saveJson(this.globalPath,{...current,setupCompleted:configured});
      }
    }
    // Refresh generated BOTS.md for existing Bots on load so identity changes reach them.
    for(const bot of this.bots()) ensureBotFiles(this.botPath(bot.id),bot);
  }
  get globalPath() { return join(this.root,'.dudu/config.json'); }
  global(): GlobalConfig { return JSON.parse(readFileSync(this.globalPath,'utf8')); }
  setGlobal(config: GlobalConfig) { if(!Number.isInteger(config.port)||config.port<1||config.port>65535) throw new Error('Invalid port'); saveJson(this.globalPath,config); }
  botPath(botId:string) { return join(this.root,'bots',id(botId)); }
  bot(botId:string): BotConfig { const raw=JSON.parse(readFileSync(join(this.botPath(botId),'bot.json'),'utf8')); return {id:raw.id??botId,name:raw.name,description:raw.description??'',avatar:raw.avatar,color:raw.color,provider:raw.provider,model:raw.model,thinkingLevel:raw.thinkingLevel??'off',paused:raw.paused===true,computer:computerConfig(raw.computer??legacyComputer(raw.bindings),botId)}; }
  removeBot(botId:string) { const path=this.botPath(botId); if(!existsSync(join(path,'bot.json'))) throw new Error('Bot not found'); rmSync(path,{recursive:true,force:true}); }
  bots(): BotConfig[] { return readdirSync(join(this.root,'bots'),{withFileTypes:true}).filter(x=>x.isDirectory()&&existsSync(join(this.root,'bots',x.name,'bot.json'))).map(x=>this.bot(x.name)); }
  saveBot(value: unknown, create=false) { const v=object(value); const botId=id(v.id); const path=this.botPath(botId); if(create&&existsSync(join(path,'bot.json'))) throw new Error('Bot already exists'); const computer=computerConfig(v.computer??legacyComputer(v.bindings),botId);
    const optionalText=(value:unknown,max=1024)=>{if(value===undefined||value===null||value==='')return undefined;if(typeof value!=='string'||value.length>max)throw new Error('Invalid bot field');return value;};
    const bot:BotConfig={id:botId,name:text(v.name,'name'),description:typeof v.description==='string'?v.description:'',avatar:optionalText(v.avatar,2048),color:optionalText(v.color,64),provider:v.provider||undefined,model:v.model||undefined,thinkingLevel:v.thinkingLevel??'off',paused:v.paused===true,computer};
    for(const dir of ['','work','home','sources','artifacts','.pi']) mkdirSync(join(path,dir),{recursive:true});
    ensureBotFiles(path, bot);
    saveJson(join(path,'bot.json'),bot); return bot;
  }
}
