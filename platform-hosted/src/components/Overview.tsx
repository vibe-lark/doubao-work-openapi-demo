import { ArrowRight, Boxes, FlaskConical, MessageSquareText, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusTag } from './common';

const objects=['Environment','Session','Event','Message','Item','Artifact','Subagent'];
const apis=['创建会话','读取会话','更新会话','删除会话','会话列表','提交事件','会话级 Stream','MessageStream','消息列表','读取消息','上传文件'];
export function Overview({go}:{go:(view:string)=>void}){
 return <div className="page-stack"><header className="page-title"><div><span className="eyebrow"><Boxes/>能力地图</span><h1>API 能力总览</h1><p>关系图解释对象模型；接口卡只显示能力准备状态，不伪造运行结果。</p></div></header>
  <section className="panel"><div className="section-head"><div><h2>七类对象关系</h2><p>Environment 决定请求域名与 PPE 头；其余对象由真实接口返回。</p></div><StatusTag tone="info">概念模型</StatusTag></div>
    <div className="object-flow">{objects.map((x,i)=><div key={x} className="object-node"><span>{i+1}</span><b>{x}</b>{i<objects.length-1&&<ArrowRight/>}</div>)}</div>
  </section>
  <div className="overview-grid"><section className="panel"><div className="section-head"><h2>11 项接口</h2><span>10 就绪 · 1 暂缓</span></div><div className="api-grid">{apis.map((x,i)=><div className="api-card" key={x}><span>{String(i+1).padStart(2,'0')}</span><b>{x}</b><StatusTag tone={i===6?'pending':'info'}>{i===6?'文档暂缓':'可验证'}</StatusTag></div>)}</div></section>
    <section className="panel"><h2>最近 Boundary Lab</h2><div className="metric"><strong>—</strong><span>尚未运行</span></div><p>通过率只会读取最近一次真实执行结果。完成授权后前往实验室运行。</p><Button variant="outline" onClick={()=>go('boundary')}>打开 Boundary Lab</Button></section></div>
  <section className="quick-grid">{[[MessageSquareText,'创建会话','sessions'],[MessageSquareText,'开始对话','playground'],[Upload,'上传文件','files'],[FlaskConical,'运行边界验证','boundary']].map(([Icon,title,to])=><button key={String(title)} onClick={()=>go(String(to))}><Icon/><span>{String(title)}</span><ArrowRight/></button>)}</section>
 </div>
}
