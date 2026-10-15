import { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Brain, Check, ChevronDown, CircleAlert, Clock3, Copy, Download, ExternalLink, File, FileText, Image as ImageIcon, Link2, LoaderCircle, Play, RefreshCw, Radio, Square, User, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Markdown } from '@/components/kit/markdown';
import { copy } from './common';
import type { ChatEntry, Part, StreamFrame, TrackingMode } from '@/lib/playground-message';

export type { ChatEntry, Part, StreamFrame } from '@/lib/playground-message';

function str(v:unknown){return typeof v==='string'?v:''}
function num(v:unknown){return typeof v==='number'?v:undefined}
function displaySize(v:unknown){const n=num(v);if(n===undefined)return '';if(n<1024)return `${n} B`;if(n<1048576)return `${(n/1024).toFixed(1)} KB`;return `${(n/1048576).toFixed(1)} MB`}
function artifactKind(a:Record<string,unknown>){return str(a.artifact_type||a.sub_type||a.content_type||a.type).toLowerCase()}
function artifactLink(a:Record<string,unknown>){return str(a.url||a.download_url||a.uri||a.link)}

function ArtifactCard({artifact}:{artifact:Record<string,unknown>}){
 const kind=artifactKind(artifact);const url=artifactLink(artifact);const name=str(artifact.name||artifact.filename||artifact.title)||'未命名产物';
 const Icon=kind.includes('image')?ImageIcon:kind.includes('video')?Video:kind.includes('link')?Link2:kind.includes('document')?FileText:File;
 const expired=artifact.expires_at?new Date(String(artifact.expires_at)).getTime()<Date.now():false;
 return <article className="artifact-card"><div className="artifact-icon"><Icon/></div><div className="artifact-main"><b>{name}</b><span>{str(artifact.sub_type||artifact.content_type)} {displaySize(artifact.size)}</span>{artifact.editable!==undefined&&<small>{artifact.editable?'可编辑':'只读'}</small>}{expired&&<small className="artifact-expired">下载链接已过期</small>}</div>{url&&<a href={url} target="_blank" rel="noreferrer" className="artifact-open">{kind.includes('video')?<Play/>:kind.includes('file')?<Download/>:<ExternalLink/>}<span>{kind.includes('video')?'播放':'打开'}</span></a>}</article>
}

function Reasoning({part,generating}:{part:Part;generating:boolean}){
 const [open,setOpen]=useState(false);const segments=part.segments?.length?part.segments:[part.text];
 return <section className="reasoning"><button onClick={()=>setOpen(!open)} aria-expanded={open}><Brain/><span>{generating&&!part.complete?'思考中…':'思考过程'}</span>{generating&&!part.complete&&<span className="thinking-dots" aria-hidden="true">•••</span>}<ChevronDown className={open?'rotate-180':''}/></button>{open&&<div className="reasoning-segments">{segments.map((segment,index)=><Markdown key={`${part.id}-${index}`} className="reasoning-body">{segment||'正在整理思路…'}</Markdown>)}</div>}</section>
}

function runningMeta(mode:TrackingMode|undefined){
 if(mode==='waiting')return {label:'等待开始',Icon:Clock3,spin:false};
 if(mode==='stream')return {label:'流式窗口进行中',Icon:Radio,spin:true};
 if(mode==='poll')return {label:'轮询中',Icon:RefreshCw,spin:true};
 return {label:'生成中',Icon:LoaderCircle,spin:true};
}
export function StatusStrip({status='in_progress',reason,trackingMode}:{status?:string;reason?:string;trackingMode?:TrackingMode}){
 const running=status.includes('progress')||status==='running';const failed=status.includes('failed');const cancelled=status.includes('cancel');const meta=runningMeta(trackingMode);const Icon=meta.Icon;
 return <div className={`message-strip ${running?'running':failed?'failed':cancelled?'cancelled':'done'}`}>{running?<Icon className={meta.spin?'spin':''}/>:failed?<CircleAlert/>:cancelled?<Square/>:<Check/>}<span>{running?meta.label:failed?`生成失败${reason?`：${reason}`:''}`:cancelled?'已停止':'已完成'}</span></div>
}

export function Conversation({entries}:{entries:ChatEntry[]}){
 const listRef=useRef<HTMLDivElement>(null);const followRef=useRef(true);
 useEffect(()=>{const node=listRef.current;if(!node||!followRef.current)return;const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;node.scrollTo({top:node.scrollHeight,behavior:reduced?'auto':'smooth'})},[entries]);
 if(!entries.length)return <div className="chat-empty"><Bot/><b>开始一段真实对话</b><span>发送后会自动续取近实时结果，无需手动刷新。</span></div>;
 return <div className="chat-list" ref={listRef} onScroll={event=>{const node=event.currentTarget;followRef.current=node.scrollHeight-node.scrollTop-node.clientHeight<80}}>{entries.map(entry=><article className={`chat-entry ${entry.role}`} key={entry.id}><div className="chat-avatar">{entry.role==='user'?<User/>:<Bot/>}</div><div className="chat-content"><div className="chat-label">{entry.role==='user'?'你':'豆包工作助手'}</div>{entry.role==='assistant'&&<StatusStrip status={entry.status} reason={entry.reason} trackingMode={entry.trackingMode}/>} {entry.text&&<div className="user-bubble">{entry.text}</div>}{entry.parts?.map(part=>part.kind==='reasoning'?<Reasoning key={part.id} part={part} generating={entry.status==='in_progress'}/>:part.kind==='artifact'&&part.artifact?<ArtifactCard key={part.id} artifact={part.artifact}/>:<Markdown key={part.id} className="assistant-markdown">{part.text}</Markdown>)}</div></article>)}</div>
}

function category(event:string){if(event.includes('error')||event.includes('failed'))return '错误';if(event.includes('delta')||event.includes('start'))return '预览';if(event.includes('text')||event.includes('reasoning')||event.includes('artifact'))return '内容';return '生命周期'}
export function RawFrames({frames,lastEventId}:{frames:StreamFrame[];lastEventId:string}){
 const [open,setOpen]=useState(false);const ordered=useMemo(()=>[...frames].sort((a,b)=>a.seq-b.seq),[frames]);
 return <section className="raw-console"><div className="raw-console-head"><button className="raw-console-toggle" onClick={()=>setOpen(!open)} aria-expanded={open}><ChevronDown className={open?'rotate-180':''}/>原始帧{frames.length?` · ${frames.length}`:''}</button><button className="raw-console-copy" disabled={!lastEventId} onClick={()=>copy(lastEventId,'Last-Event-ID 已复制')} title="复制 Last-Event-ID"><code>Last-Event-ID: {lastEventId||'—'}</code><Copy/></button></div>{open&&<div className="raw-frame-list">{ordered.length?ordered.map((f,i)=><details key={`${f.id}-${i}`}><summary><time>{new Date(f.at).toLocaleTimeString('zh-CN')}</time><span className={`event-badge event-${category(f.event)}`}>{category(f.event)}</span><b>{f.event}</b><code>seq {f.seq}</code></summary><pre>{f.parsed?JSON.stringify(f.parsed,null,2):f.data}</pre></details>):<p>尚未收到帧。</p>}</div>}</section>
}
