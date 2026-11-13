import { BotdError, type DesktopConfig, type DesktopStatus, type ExecOptions, type ExecResult, type WatchInfo, type RecordingInfo } from './types';
export interface BotdClientOptions { baseUrl?: string; timeoutMs?: number }
/** Thin loopback client for the standalone `dudu botd serve` debugging surface. */
export class BotdClient {
  constructor(readonly options: BotdClientOptions = {}) {}
  private async request<T>(path: string, method='GET', body?: unknown, binary=false): Promise<T> {
    const base=this.options.baseUrl ?? 'http://127.0.0.1:7332';
    const headers: Record<string,string>={};
    if(body !== undefined) headers['Content-Type']=body instanceof Uint8Array?'application/octet-stream':'application/json';
    const r=await fetch(`${String(base).replace(/\/$/,'')}${path}`,{method,headers,body:body===undefined?undefined:body instanceof Uint8Array?body as BodyInit:JSON.stringify(body),signal:AbortSignal.timeout(this.options.timeoutMs ?? 360000),redirect:'error'});
    if(!r.ok) {const data=await r.json().catch(()=>({error:`HTTP ${r.status}`})) as {error?:string};throw new BotdError(data.error ?? `HTTP ${r.status}`,r.status);}
    return (binary?new Uint8Array(await r.arrayBuffer()):await r.json()) as T;
  }
  private path(id:string,action='') {return `/v1/desktops/${encodeURIComponent(id)}${action?'/'+action:''}`;}
  health() {return this.request<{ok:boolean;service:string;version:number}>('/healthz');}
  /** 调用 cua 对齐方法：method 如 'click'，args 为参数对象；screenshot 返回 Uint8Array。 */
  async cua<T = unknown>(id: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
    return this.request<T>(this.path(id,`cua/${method}`),'POST',args,method === 'screenshot');
  }
  async cuaScreenshot(id: string, args: Record<string, unknown> = {}): Promise<Uint8Array> { return this.cua(id,'screenshot',args); }
  doctor() {return this.request<Record<string,unknown>>('/v1/doctor');}
  list() {return this.request<DesktopStatus[]>('/v1/desktops');}
  get(id:string) {return this.request<DesktopStatus>(this.path(id));}
  status(id?:string) {return id?this.get(id):this.list();}
  start(config:DesktopConfig) {return this.request<DesktopStatus>('/v1/desktops','POST',config);}
  stop(id:string) {return this.request<DesktopStatus>(this.path(id,'stop'),'POST');}
  restart(id:string) {return this.request<DesktopStatus>(this.path(id,'restart'),'POST');}
  shot(id:string) {return this.request<Uint8Array>(this.path(id,'shot'),'GET',undefined,true);}
  click(id:string,options:{x:number;y:number;button?:number;count?:number}) {return this.request<{ok:boolean}>(this.path(id,'click'),'POST',options);}
  key(id:string,key:string) {return this.request<{ok:boolean}>(this.path(id,'key'),'POST',{key});}
  scroll(id:string,options:{direction:'up'|'down'|'left'|'right';amount?:number}) {return this.request<{ok:boolean}>(this.path(id,'scroll'),'POST',options);}
  type(id:string,text:string) {return this.request<{ok:boolean}>(this.path(id,'type'),'POST',{text});}
  exec(id:string,options:ExecOptions) {return this.request<ExecResult>(this.path(id,'exec'),'POST',options);}
  upload(id:string,path:string,data:Uint8Array) {return this.request<{path:string;bytes:number}>(this.path(id,'files')+`?path=${encodeURIComponent(path)}`,'PUT',data);}
  download(id:string,path:string) {return this.request<Uint8Array>(this.path(id,'files')+`?path=${encodeURIComponent(path)}`,'GET',undefined,true);}
  recordStart(id:string,options:{fps?:number}={}) {return this.request<RecordingInfo>(this.path(id,'record-start'),'POST',options);}
  recordStop(id:string) {return this.request<RecordingInfo>(this.path(id,'record-stop'),'POST',{});}
  recording(id:string,recordId:string) {return this.request<Uint8Array>(this.path(id,'recording')+`?id=${encodeURIComponent(recordId)}`,'GET',undefined,true);}
  watch(id:string) {return this.request<WatchInfo>(this.path(id,'watch'));}
}
