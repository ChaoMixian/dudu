import { mkdirSync, readFileSync, existsSync, readdirSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { id, object, text, type BotConfig, type GlobalConfig } from '../contracts';
import { workspaceRoot } from './workspace';
import { ensureBotFiles } from './bot-files';
export function saveJson(path: string, data: unknown) { const tmp = `${path}.${crypto.randomUUID()}.tmp`; writeFileSync(tmp, JSON.stringify(data,null,2)+'\n', {mode:0o600}); renameSync(tmp,path); }
export class ConfigStore {
  root: string;
  constructor(root = workspaceRoot()) { this.root=workspaceRoot(root); for(const p of ['bots','connectors','.dudu']) mkdirSync(join(this.root,p),{recursive:true}); if(!existsSync(this.globalPath)) saveJson(this.globalPath,{host:'127.0.0.1',port:7331,providers:[],autoStartComputers:true}); }
  get globalPath() { return join(this.root,'.dudu/config.json'); }
  global(): GlobalConfig { return JSON.parse(readFileSync(this.globalPath,'utf8')); }
  setGlobal(config: GlobalConfig) { if(!Number.isInteger(config.port)||config.port<1||config.port>65535) throw new Error('Invalid port'); saveJson(this.globalPath,config); }
  botPath(botId:string) { return join(this.root,'bots',id(botId)); }
  bot(botId:string): BotConfig { return JSON.parse(readFileSync(join(this.botPath(botId),'bot.json'),'utf8')); }
  removeBot(botId:string) { const path=this.botPath(botId); if(!existsSync(join(path,'bot.json'))) throw new Error('Bot not found'); rmSync(path,{recursive:true,force:true}); }
  bots(): BotConfig[] { return readdirSync(join(this.root,'bots'),{withFileTypes:true}).filter(x=>x.isDirectory()&&existsSync(join(this.root,'bots',x.name,'bot.json'))).map(x=>this.bot(x.name)); }
  saveBot(value: unknown, create=false) { const v=object(value); const botId=id(v.id); const path=this.botPath(botId); if(create&&existsSync(join(path,'bot.json'))) throw new Error('Bot already exists'); const bindings=v.bindings ?? [{id:'computer',connectorId:'computer',config:{desktopId:`${botId}-computer`}}]; if(!Array.isArray(bindings)) throw new Error('Invalid bindings'); const seen=new Set<string>(); for(const b of bindings) { id(b.id);id(b.connectorId);object(b.config); if(seen.has(b.id)) throw new Error('Duplicate binding id'); seen.add(b.id); }
    const optionalText=(value:unknown,max=1024)=>{if(value===undefined||value===null||value==='')return undefined;if(typeof value!=='string'||value.length>max)throw new Error('Invalid bot field');return value;};
    const bot:BotConfig={id:botId,name:text(v.name,'name'),description:typeof v.description==='string'?v.description:'',avatar:optionalText(v.avatar,2048),color:optionalText(v.color,64),provider:v.provider||undefined,model:v.model||undefined,thinkingLevel:v.thinkingLevel??'off',paused:v.paused===true,bindings};
    for(const dir of ['','work','home','sources','artifacts','.pi']) mkdirSync(join(path,dir),{recursive:true});
    ensureBotFiles(path, bot);
    saveJson(join(path,'bot.json'),bot); return bot;
  }
}
