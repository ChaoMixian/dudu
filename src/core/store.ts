import { Database } from 'bun:sqlite';
import { eventInput, type BotThread, type BotThreadMessage, type DuduEvent, type EventInput, type InboxStatus, type MessageAttachment, type MessageKind, type Route } from '../contracts';
export interface Message { id:string; botId:string; conversationId:string; sender:string; text:string; kind:MessageKind; options?:string[]; targetId?:string; emoji?:string; replyTo?:string; attachments?:MessageAttachment[]; status:string; createdAt:string; seq:number }
const BOT_PAIR_LIMIT = 20;
export class Store {
  db: Database;
  listeners=new Set<(event:DuduEvent)=>void>();
  private botPairTurns=new Map<string,number>();
  constructor(path:string) { this.db=new Database(path,{create:true}); this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,event_id TEXT UNIQUE NOT NULL,bot_id TEXT NOT NULL,source_id TEXT NOT NULL,dedupe_key TEXT,body TEXT NOT NULL,wake INTEGER NOT NULL,status TEXT NOT NULL,error TEXT);
    CREATE UNIQUE INDEX IF NOT EXISTS event_dedupe ON events(bot_id,source_id,dedupe_key) WHERE dedupe_key IS NOT NULL;
    CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY, bot_id TEXT NOT NULL,conversation_id TEXT NOT NULL,sender TEXT NOT NULL,text TEXT NOT NULL,kind TEXT NOT NULL DEFAULT 'message',options TEXT,target_id TEXT,emoji TEXT,reply_to TEXT,attachments TEXT,status TEXT NOT NULL,created_at TEXT NOT NULL,seq INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS bot_messages(id TEXT PRIMARY KEY, from_bot TEXT NOT NULL, to_bot TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS bot_messages_pair ON bot_messages(from_bot,to_bot,created_at);
    CREATE TABLE IF NOT EXISTS sessions(bot_id TEXT PRIMARY KEY,path TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,bot_id TEXT NOT NULL,started_at TEXT NOT NULL,ended_at TEXT,status TEXT NOT NULL,error TEXT);
    UPDATE events SET status='pending' WHERE status='delivering';
    UPDATE runs SET status='interrupted',ended_at=datetime('now') WHERE status='running';`);
    const columns = this.db.query('PRAGMA table_info(messages)').all() as {name:string}[];
    for (const [name, type] of [['options','TEXT'],['kind',"TEXT NOT NULL DEFAULT 'message'"],['target_id','TEXT'],['emoji','TEXT'],['reply_to','TEXT'],['attachments','TEXT']] as const) {
      if (!columns.some(column => column.name === name)) this.db.exec(`ALTER TABLE messages ADD COLUMN ${name} ${type};`);
    }
    this.db.exec("UPDATE messages SET kind='message' WHERE kind IS NULL OR kind='';");
  }
  publish(input:EventInput): {event:DuduEvent; duplicate:boolean} { const v=eventInput(input); const event={...v,eventId:v.eventId??crypto.randomUUID(),priority:v.priority??'normal',createdAt:new Date().toISOString(),wake:v.wake!==false,seq:0} as DuduEvent;
    const result=this.db.transaction(()=>{ const previous=this.db.query('SELECT seq,body FROM events WHERE event_id=? OR (bot_id=? AND source_id=? AND dedupe_key=?)').get(event.eventId,event.botId,event.sourceId,event.dedupeKey??null) as {seq:number;body:string}|null; if(previous) return {event:{...JSON.parse(previous.body),seq:previous.seq} as DuduEvent,duplicate:true};
      const row=this.db.query('INSERT INTO events(event_id,bot_id,source_id,dedupe_key,body,wake,status) VALUES(?,?,?,?,?,?,?)').run(event.eventId,event.botId,event.sourceId,event.dedupeKey??null,JSON.stringify(event),event.wake?1:0,event.wake?'pending':'completed'); event.seq=Number(row.lastInsertRowid); this.db.query('UPDATE events SET body=? WHERE seq=?').run(JSON.stringify(event),event.seq); return {event,duplicate:false}; })();
    if(!result.duplicate) for(const listener of this.listeners) listener(result.event); return result;
  }
  replay(after:number,limit=500):DuduEvent[] { return (this.db.query('SELECT body FROM events WHERE seq>? ORDER BY seq LIMIT ?').all(after,limit) as {body:string}[]).map(x=>JSON.parse(x.body)); }
  latestSeq():number { return (this.db.query('SELECT COALESCE(MAX(seq),0) AS seq FROM events').get() as {seq:number}).seq; }
  pending(botId:string):DuduEvent[] { return (this.db.query("SELECT body FROM events WHERE bot_id=? AND status='pending' AND wake=1 ORDER BY CASE json_extract(body,'$.priority') WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, seq").all(botId) as {body:string}[]).map(x=>JSON.parse(x.body)); }
  pendingSeq(botId:string):DuduEvent[] { return (this.db.query("SELECT body FROM events WHERE bot_id=? AND status='pending' AND wake=1 ORDER BY seq").all(botId) as {body:string}[]).map(x=>JSON.parse(x.body)); }
  mark(ids:string[],status:InboxStatus,error?:string) { const stmt=this.db.query('UPDATE events SET status=?,error=? WHERE event_id=?'); this.db.transaction(()=>{ for(const id of ids) stmt.run(status,error??null,id); })(); }
  status(eventId:string) { return this.db.query('SELECT status,error FROM events WHERE event_id=?').get(eventId); }
  session(botId:string):string|undefined { return (this.db.query('SELECT path FROM sessions WHERE bot_id=?').get(botId) as {path:string}|null)?.path; }
  setSession(botId:string,path:string) { this.db.query('INSERT INTO sessions VALUES(?,?) ON CONFLICT(bot_id) DO UPDATE SET path=excluded.path').run(botId,path); }
  messages():Message[] { const rows=this.db.query('SELECT id,bot_id AS botId,conversation_id AS conversationId,sender,text,kind,options,target_id AS targetId,emoji,reply_to AS replyTo,attachments,status,created_at AS createdAt,seq FROM messages ORDER BY seq').all() as (Omit<Message,'options'|'kind'|'attachments'> & {options:string|null; kind:string|null; attachments:string|null})[]; return rows.map(({options,kind,attachments,...row})=>({...row,kind:(kind||'message') as MessageKind,...(options?{options:JSON.parse(options) as string[]}:{}),...(attachments?{attachments:JSON.parse(attachments) as MessageAttachment[]}:{})})); }
  messageById(messageId:string):Message|undefined { return this.messages().find(message=>message.id===messageId); }
  deleteBotData(botId:string) { this.db.transaction(()=>{for(const table of ['messages','events','runs','sessions'])this.db.query(`DELETE FROM ${table} WHERE bot_id=?`).run(botId);})(); }
  toggleReaction(botId:string,conversationId:string,targetId:string,emoji:string,sender:string):{added:boolean;message?:Message} { const existing=this.db.query("SELECT id FROM messages WHERE bot_id=? AND conversation_id=? AND sender=? AND kind='reaction' AND target_id=? AND emoji=? LIMIT 1").get(botId,conversationId,sender,targetId,emoji) as {id:string}|null; if(existing){this.db.query('DELETE FROM messages WHERE id=?').run(existing.id);this.publish({botId,sourceId:'reaction',type:'message.reaction',payload:{targetId,emoji,added:false},wake:false});return {added:false};} const message=this.message(botId,conversationId,sender,'', 'sent', undefined,'reaction',targetId,emoji);return {added:true,message}; }
  message(botId:string,conversationId:string,sender:string,content:string,status='sent',options?:string[],kind:MessageKind='message',targetId?:string,emoji?:string,replyTo?:string,attachments?:MessageAttachment[]):Message { const message:Message={id:crypto.randomUUID(),botId,conversationId,sender,text:content,kind,status,createdAt:new Date().toISOString(),seq:0,...(options?.length?{options}:{}),...(targetId?{targetId}:{}),...(emoji?{emoji}:{}),...(replyTo?{replyTo}:{}),...(attachments?.length?{attachments}:{})}; this.db.transaction(()=>{ const {event}=this.publish({botId,sourceId:'message',type:'message.created',payload:message,wake:false}); message.seq=event.seq; this.db.query('INSERT INTO messages(id,bot_id,conversation_id,sender,text,kind,options,target_id,emoji,reply_to,attachments,status,created_at,seq) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(message.id,botId,conversationId,sender,content,kind,options?.length?JSON.stringify(options):null,targetId??null,emoji??null,replyTo??null,attachments?.length?JSON.stringify(attachments):null,status,message.createdAt,message.seq); })(); return message; }
  noteHumanMessage(botId:string) { for(const key of [...this.botPairTurns.keys()])if(key.split('|').includes(botId))this.botPairTurns.delete(key); }
  private registerBotTurn(from:string,to:string) { const key=[from,to].sort().join('|');const turns=(this.botPairTurns.get(key)??0)+1;this.botPairTurns.set(key,turns);return {turns,allowed:turns<=BOT_PAIR_LIMIT,remaining:Math.max(0,BOT_PAIR_LIMIT-turns)}; }
  send(from:string,route:Route,content:string,correlationId?:string,options?:string[],kind:MessageKind='message',targetId?:string,emoji?:string,replyTo?:string,attachments?:MessageAttachment[]) { if(route.kind==='web') return this.message(from,route.id,from,content,'sent',options,kind,targetId,emoji,replyTo,attachments);
    const budget=this.registerBotTurn(from,route.id);
    const notice=!budget.allowed?'Automatic bot-to-bot budget exhausted. This message is stored but will not wake the peer. Ask the human to continue.':budget.remaining===0?'This is the last automatic bot-to-bot turn for this pair. Do not reply automatically; ask the human to continue.':budget.remaining<=3?`Only ${budget.remaining} automatic bot-to-bot messages remain for this pair.`:undefined;
    const botBudget={used:budget.turns,limit:BOT_PAIR_LIMIT,remaining:budget.remaining,throttled:!budget.allowed,...(notice?{notice}:{})};
    const accepted=this.publish({botId:route.id,sourceId:`bot:${from}`,type:'message.bot',payload:{text:content,from,kind,options,targetId,emoji,replyTo,attachments,botBudget},replyTo:{kind:'bot',id:from},correlationId,wake:budget.allowed});
    this.db.query('INSERT INTO bot_messages VALUES(?,?,?,?,?)').run(crypto.randomUUID(),from,route.id,content,new Date().toISOString());
    this.message(from,'default',from,content,'sent',undefined,'bot_out',route.id);
    this.message(route.id,'default',from,content,'sent',undefined,'bot_in',from);
    return {status:'accepted',eventId:accepted.event.eventId,...botBudget}; }
  botHistory(botId:string,peerId:string):BotThreadMessage[] { const direct=(this.db.query('SELECT id,from_bot AS fromBot,to_bot AS toBot,text,created_at AS createdAt FROM bot_messages WHERE (from_bot=? AND to_bot=?) OR (from_bot=? AND to_bot=?) ORDER BY created_at').all(botId,peerId,peerId,botId) as {id:string;fromBot:string;toBot:string;text:string;createdAt:string}[]).map(row=>({id:row.id,from:row.fromBot,to:row.toBot,text:row.text,createdAt:row.createdAt}));
    const legacy=(this.db.query("SELECT id,bot_id AS toBot,conversation_id AS sender,text,created_at AS createdAt FROM messages WHERE kind='message' AND conversation_id!='default' AND sender!='user' AND ((bot_id=? AND conversation_id=?) OR (bot_id=? AND conversation_id=?))").all(botId,peerId,peerId,botId) as {id:string;toBot:string;sender:string;text:string;createdAt:string}[]).map(row=>({id:row.id,from:row.sender,to:row.toBot,text:row.text,createdAt:row.createdAt}));
    return [...direct,...legacy].sort((a,b)=>a.createdAt.localeCompare(b.createdAt)); }
  botThreads():BotThread[] { const map=new Map<string,BotThread>(); const add=(botId:string,peerId:string,text:string,lastAt:string)=>{if(botId===peerId)return;const key=`${botId}|${peerId}`;const current=map.get(key);if(current){current.count++;if(lastAt>current.lastAt){current.lastAt=lastAt;current.lastText=text;}}else map.set(key,{botId,peerId,count:1,lastText:text,lastAt});};
    for(const row of this.db.query('SELECT from_bot AS fromBot,to_bot AS toBot,text,created_at AS createdAt FROM bot_messages').all() as {fromBot:string;toBot:string;text:string;createdAt:string}[]){add(row.fromBot,row.toBot,row.text,row.createdAt);add(row.toBot,row.fromBot,row.text,row.createdAt);}
    for(const row of this.db.query("SELECT bot_id AS botId,conversation_id AS peerId,sender,text,created_at AS createdAt FROM messages WHERE kind='message' AND conversation_id!='default' AND sender!='user'").all() as {botId:string;peerId:string;sender:string;text:string;createdAt:string}[]){add(row.botId,row.peerId,row.text,row.createdAt);add(row.peerId,row.botId,row.text,row.createdAt);}
    return [...map.values()].sort((a,b)=>b.lastAt.localeCompare(a.lastAt)); }
  close() { this.db.close(); }
}
