import { useState } from 'react';
import { ChevronDown, Copy, CheckCircle2, Clock3, XCircle, Terminal, FileQuestion } from 'lucide-react';
import type { Evidence } from '@shared/schema';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

export function StatusTag({tone='pending',children}:{tone?:'ok'|'bad'|'pending'|'info';children:React.ReactNode}) {
 return <span className={`status-tag status-${tone}`}>{tone==='ok'?<CheckCircle2/>:tone==='bad'?<XCircle/>:<Clock3/>}{children}</span>;
}
// 只脱敏真正的凭据字段；业务 code、page_token 等需要原样展示用于排查。
const SECRET_KEY=/^(authorization|cookie|set-cookie|access_token|refresh_token|id_token|client_secret|secret)$/i;
function safe(value:unknown):unknown{if(Array.isArray(value))return value.map(safe);if(value&&typeof value==='object'){return Object.fromEntries(Object.entries(value as Record<string,unknown>).map(([k,v])=>[SECRET_KEY.test(k)?[k,'••••••••（已脱敏）']:[k,safe(v)]]))}return value}
export async function copy(value:string,label='已复制'){try{if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(value);else{const t=document.createElement('textarea');t.value=value;t.style.position='fixed';t.style.opacity='0';document.body.appendChild(t);t.select();const ok=document.execCommand('copy');t.remove();if(!ok)throw new Error('copy')}toast.success(label)}catch{toast.error('复制失败，请手动选择文本复制')}}
export function CodeBlock({value,label='复制'}:{value:string;label?:string}) {return <div className="code-block"><div className="code-toolbar"><span><Terminal/>JSON</span><Button variant="ghost" size="sm" onClick={()=>copy(value)}><Copy/>{label}</Button></div><pre>{value}</pre></div>}
function curlOf(e:Evidence){const headers=Object.entries(e.request.headers||{}).map(([k,v])=>`-H '${k}: ${/authorization/i.test(k)?'Bearer ••••••••':v}'`).join(' \\\n  ');const body=e.request.body===undefined?'':` \\\n  --data '${JSON.stringify(safe(e.request.body)).replaceAll("'","'\\''")}'`;return `curl -X ${e.request.method} '${e.request.url}'${headers?` \\\n  ${headers}`:''}${body}`}
export function EvidencePanel({evidence,title='API 请求检视器'}:{evidence?:Evidence|null;title?:string}) {
 const [open,setOpen]=useState(false);if(!evidence)return <div className="pending-box"><FileQuestion/><div><b>暂无请求证据</b><span>执行真实请求后显示脱敏请求、curl、响应与耗时。</span></div></div>;
 const request=evidence.request||{method:'—',url:'—',headers:{}};const ok=evidence.httpStatus>=200&&evidence.httpStatus<300;const response=JSON.stringify(safe({httpStatus:evidence.httpStatus,code:evidence.code,msg:evidence.msg,data:evidence.data,limitedRead:evidence.limitedRead,frames:evidence.frames}),null,2);
 return <section className="evidence"><button className="evidence-head" onClick={()=>setOpen(!open)} aria-expanded={open}><span><Terminal/>{title}</span><span className="evidence-meta"><StatusTag tone={ok?'ok':'bad'}>{evidence.httpStatus?`HTTP ${evidence.httpStatus}`:'未送达'}</StatusTag><code>{evidence.durationMs} ms</code><ChevronDown className={open?'rotate-180':''}/></span></button>{open&&<div className="evidence-body"><div className="request-summary"><span className="method-badge">{request.method}</span><code>{request.url}</code><span>业务码 {String(evidence.code??'—')}</span></div><div className="inspector-grid"><div><div className="inspector-title"><h4>请求</h4><Button size="sm" variant="outline" onClick={()=>copy(curlOf({...evidence,request}),'curl 已复制（Authorization 已脱敏）')}><Copy/>复制 curl</Button></div><CodeBlock value={JSON.stringify(safe({headers:request.headers,body:request.body}),null,2)}/></div><div><div className="inspector-title"><h4>响应</h4><Button size="sm" variant="outline" onClick={()=>copy(response,'响应已复制')}><Copy/>复制响应</Button></div><CodeBlock value={response}/></div></div></div>}</section>
}
export function EmptyState({title,description,action}:{title:string;description:string;action?:React.ReactNode}) {return <div className="empty-state"><FileQuestion/><b>{title}</b><p>{description}</p>{action}</div>}
export function ErrorBox({message}:{message:string}) {return <div className="error-box" role="alert"><XCircle/><div><b>操作未完成</b><p>{message}</p><small>输入内容已保留。请按提示修正后重试；若仍失败，展开请求检视器核对真实响应。</small></div></div>}
export function errText(error:unknown){return error instanceof Error?error.message:'发生未知错误，请重试。'}
