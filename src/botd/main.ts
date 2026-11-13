import { BotdClient } from './client';
import { BotdSupervisor } from './supervisor';
import { startBotdServer } from './server';
import { DEFAULT_ROOT, type DesktopConfig } from './types';
import { readFile, writeFile } from 'node:fs/promises';

export const HELP = `Usage: bun src/botd/main.ts <command> [arguments] [--root PATH] [--url URL]
  serve [--host 127.0.0.1] [--port 7332]   Run the standalone loopback HTTP daemon (debugging)
  doctor                                  Report dependencies, without starting a desktop
  health | list | status [ID]              Query daemon
  start ID [--bot-id ID] [--width 1280] [--height 800]
  stop ID | restart ID | watch ID
  shot ID OUTPUT.png
  click ID X Y [--button 1] [--count 1]
  key ID ctrl+l | type ID '你好'
  scroll ID up|down|left|right [--amount 3]
  exec ID [--timeout 30000] -- PROGRAM [ARGS...]
  upload ID LOCAL REMOTE | download ID REMOTE LOCAL
  record-start ID [--fps 15] | record-stop ID
  recording ID RECORD_ID OUTPUT.mkv
Default root: ${DEFAULT_ROOT}
All daemon configuration, private homes, state, logs and recordings live under root.
This is same-UID session separation, NOT a security sandbox. No system packages are installed.
Watch uses a loopback-only voxl URL/password; the main dudu server proxies it for remote viewing.
`;
export async function main(argv=process.argv.slice(2)): Promise<number> {
  const args:string[]=[], flags:Record<string,string>={}; let pass=false;
  for(let i=0;i<argv.length;i++) {const a=argv[i]!;if(pass){args.push(a);continue;}if(a==='--'){pass=true;continue;}if(a==='--help'||a==='-h'){console.log(HELP);return 0;}if(a.startsWith('--')){const split=a.indexOf('=');if(split>0){flags[a.slice(2,split)]=a.slice(split+1);continue;}const v=argv[++i];if(v===undefined||v.startsWith('--'))throw new Error(`Missing value for ${a}`);flags[a.slice(2)]=v;}else args.push(a);}
  const command=args.shift() ?? 'help', root=flags.root ?? DEFAULT_ROOT;
  const number=(value:string|undefined,fallback:number) => {if(value===undefined)return fallback;if(!/^\d+$/.test(value))throw new Error(`Invalid integer: ${value}`);return Number(value);};
  const required=(index:number,name:string) => {const a=args[index];if(!a)throw new Error(`Missing ${name}; run --help`);return a;};
  if(command==='help'){console.log(HELP);return 0;}
  if(command==='doctor'){console.log(JSON.stringify(await new BotdSupervisor({root}).doctor(),null,2));return 0;}
  if(command==='serve') {
    const app=await startBotdServer({root,host:flags.host,port:number(flags.port,7332)});
    console.log(`botd listening at ${app.baseUrl}`);
    let closing=false;const close=async()=>{if(closing)return;closing=true;try{await app.close();process.exitCode=0;}catch(e){console.error(e);process.exitCode=1;}};
    process.once('SIGINT',()=>void close());process.once('SIGTERM',()=>void close());
    return 0;
  }
  const c=new BotdClient({baseUrl:flags.url});let result:unknown;
  switch(command) {
    case 'health':result=await c.health();break;
    case 'list':result=await c.list();break;
    case 'status':result=await c.status(args[0]);break;
    case 'start': {const id=required(0,'desktop ID');const config:DesktopConfig={id,botId:flags['bot-id'] ?? id,width:number(flags.width,1280),height:number(flags.height,800)};result=await c.start(config);break;}
    case 'stop':result=await c.stop(required(0,'desktop ID'));break;
    case 'restart':result=await c.restart(required(0,'desktop ID'));break;
    case 'watch':result=await c.watch(required(0,'desktop ID'));break;
    case 'shot':await writeFile(required(1,'output PNG'),await c.shot(required(0,'desktop ID')),{mode:0o600});result={path:args[1]};break;
    case 'click':result=await c.click(required(0,'desktop ID'),{x:number(required(1,'x'),0),y:number(required(2,'y'),0),button:number(flags.button,1),count:number(flags.count,1)});break;
    case 'key':result=await c.key(required(0,'desktop ID'),required(1,'key sequence'));break;
    case 'type':result=await c.type(required(0,'desktop ID'),required(1,'text'));break;
    case 'scroll':result=await c.scroll(required(0,'desktop ID'),{direction:required(1,'direction') as any,amount:number(flags.amount,3)});break;
    case 'exec':result=await c.exec(required(0,'desktop ID'),{argv:args.slice(1),timeoutMs:number(flags.timeout,30000),cwd:flags.cwd});break;
    case 'upload':result=await c.upload(required(0,'desktop ID'),required(2,'remote path'),await readFile(required(1,'local file')));break;
    case 'download':await writeFile(required(2,'local file'),await c.download(required(0,'desktop ID'),required(1,'remote path')),{mode:0o600});result={path:args[2]};break;
    case 'record-start':result=await c.recordStart(required(0,'desktop ID'),{fps:number(flags.fps,15)});break;
    case 'record-stop':result=await c.recordStop(required(0,'desktop ID'));break;
    case 'recording':await writeFile(required(2,'output file'),await c.recording(required(0,'desktop ID'),required(1,'record ID')),{mode:0o600});result={path:args[2]};break;
    default:throw new Error(`Unknown command: ${command}; run --help`);
  }
  console.log(JSON.stringify(result,null,2));return command==='exec'?(result as {code:number}).code:0;
}
if(import.meta.main) main().then(code=>{process.exitCode=code;}).catch(e=>{console.error(`botd: ${e instanceof Error?e.message:String(e)}`);process.exitCode=1;});
