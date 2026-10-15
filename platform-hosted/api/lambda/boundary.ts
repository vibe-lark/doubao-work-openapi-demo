import { Api, Data, Post, useAnygen } from '@anygen/server';
import { z } from 'zod';
import { boundaryRunSchema, type BoundaryResult, type ProxyResult } from '@shared/schema';
import { baseUrl, proxyRequest, streamRequest } from './_client';
import { getEnvironment, maskedHeaders, type AgLike } from './_doubao';

const probeSchema = z.object({ kind: z.enum(['missing','forged']) });
const CASES = [
  { id:'a', title:'无 token', expected:'网关原始鉴权错误' },
  { id:'b', title:'伪造 token', expected:'网关原始鉴权错误' },
  { id:'c', title:'创建会话缺省 uuid', expected:'HTTP 400 / 400001' },
  { id:'d', title:'initial_events 非法', expected:'HTTP 400 / 400001' },
  { id:'e', title:'page_size=0', expected:'HTTP 400 / 400001' },
  { id:'f', title:'不存在会话', expected:'HTTP 404 / 404001' },
  { id:'g', title:'空消息 contents', expected:'HTTP 400 / 400001' },
  { id:'h', title:'更新 257 字符', expected:'HTTP 400 / 400001' },
  { id:'i', title:'会话级 Stream 探测', expected:'原样记录暂缓接口状态与响应体' },
  { id:'j', title:'幂等/隔离清理前置检查', expected:'有 token 时执行；无 token 待判定' },
  { id:'k', title:'429 限流', expected:'不主动压测，仅记录文档边界' },
] as const;

function decode(payload: unknown) { if (!payload || typeof payload !== 'object') return { code:null, msg:'', data:payload }; const p=payload as Record<string,unknown>; return { code:(p.code as string|number|undefined)??null, msg:String(p.msg??p.message??''), data:p.data??payload }; }
async function authProbe(ag: AgLike, forged: boolean): Promise<ProxyResult> {
  const environment = await getEnvironment(ag); const url = `${baseUrl(environment)}/v1/sessions?page_size=1`;
  const headers: Record<string,string> = { ...(environment==='ppe'?{'X-Tt-Env':'ppe_doubao_oapi','X-Use-Ppe':'1'}:{}), ...(forged?{Authorization:'Bearer forged-token-for-boundary-test'}:{}) };
  const shown = { ...maskedHeaders(environment, forged) }; const start = Date.now();
  try {
    const response = await fetch(url,{headers,signal:AbortSignal.timeout(8000)}); const text=await response.text(); let payload:unknown=text; try{payload=JSON.parse(text)}catch{/* raw body */}
    return { httpStatus:response.status, ...decode(payload), durationMs:Date.now()-start, request:{method:'GET',url,headers:shown} };
  } catch(error) { return { httpStatus:0, code:'NETWORK_ERROR', msg:error instanceof Error?error.message:'网络错误', data:null, durationMs:Date.now()-start, request:{method:'GET',url,headers:shown} }; }
}
function verdict(evidence: ProxyResult, expectedCode?: string): BoundaryResult['verdict'] {
  if (evidence.code === 'NOT_CONNECTED') return 'undetermined';
  if (!expectedCode) return evidence.httpStatus > 0 ? 'pass' : 'undetermined';
  return String(evidence.code) === expectedCode ? 'pass' : 'mismatch';
}
async function execute(ag: AgLike, caseId: string): Promise<BoundaryResult> {
  const meta = CASES.find(item=>item.id===caseId)!; let evidence: ProxyResult | undefined; let expectedCode: string | undefined; let cleanup='未创建资源，无需清理';
  if(caseId==='a') evidence=await authProbe(ag,false);
  if(caseId==='b') evidence=await authProbe(ag,true);
  if(caseId==='c'){evidence=await proxyRequest(ag,'POST','/v1/sessions',{name:'boundary-no-uuid'});expectedCode='400001'}
  if(caseId==='d'){evidence=await proxyRequest(ag,'POST','/v1/sessions',{uuid:`boundary-${Date.now()}`,initial_events:[{type:'interrupt'}]});expectedCode='400001'}
  if(caseId==='e'){evidence=await proxyRequest(ag,'GET','/v1/sessions',undefined,{page_size:0});expectedCode='400001'}
  if(caseId==='f'){evidence=await proxyRequest(ag,'GET',`/v1/sessions/boundary-not-found-${Date.now()}`);expectedCode='404001'}
  if(caseId==='g'){evidence=await proxyRequest(ag,'POST',`/v1/sessions/boundary-not-found-${Date.now()}/events`,{type:'user.message',contents:[]});expectedCode='400001'}
  if(caseId==='h'){evidence=await proxyRequest(ag,'PATCH',`/v1/sessions/boundary-not-found-${Date.now()}`,{name:'界'.repeat(257)});expectedCode='400001'}
  if(caseId==='i'){evidence=await streamRequest(ag,`/v1/sessions/boundary-not-found-${Date.now()}/events`,undefined,undefined,2000);cleanup='探测不创建资源'}
  if(caseId==='j'){evidence=await proxyRequest(ag,'GET','/v1/sessions',undefined,{page_size:1});cleanup='仅检查运行前置条件；完整幂等流程需真人 OAuth 后运行'}
  if(caseId==='k') return { id:meta.id,title:meta.title,expected:meta.expected,verdict:'undetermined',actual:'按安全约束未主动制造 429',cleanup:'无请求、无需清理' };
  const actual = evidence ? `HTTP ${evidence.httpStatus}${evidence.code!==null?` / code ${String(evidence.code)}`:''}${evidence.msg?` / ${evidence.msg}`:''}` : '未运行';
  return { id:meta.id,title:meta.title,expected:meta.expected,verdict:evidence?verdict(evidence,expectedCode):'undetermined',actual,evidence,cleanup };
}
function markdown(results: BoundaryResult[]) {
  return ['# Boundary Lab 脱敏报告','',`- 导出时间：${new Date().toISOString()}`,'- Authorization 与 OAuth 私密值均未导出','','| 用例 | 期望 | 实际 | 判定 | 清理 |','|---|---|---|---|---|',...results.map(r=>`| ${r.id}. ${r.title} | ${r.expected} | ${r.actual.replaceAll('|','\\|')} | ${r.verdict} | ${r.cleanup||''} |`)].join('\n');
}

export const noTokenProbe = Api(Post('/boundary/no-token'), async () => authProbe(useAnygen(),false));
export const probeAuthorizationBoundary = Api(Post('/boundary/auth'), Data(probeSchema), async ({ data }) => authProbe(useAnygen(),data.kind==='forged'));
export const boundaryLab = Api(Post('/boundary/run'), Data(boundaryRunSchema), async ({ data }) => {
  const ag=useAnygen(); const ids=data.caseId?[data.caseId]:CASES.map(item=>item.id); const results:BoundaryResult[]=[];
  for(const caseId of ids) results.push(await execute(ag,caseId));
  return { ok:true, cases:CASES, results, markdown:markdown(results) };
});
