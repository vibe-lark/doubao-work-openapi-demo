import { useEffect, useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { connectionStatus } from '@api/auth';
import { createQueryClient } from '@/lib/query';
import { ErrorBoundary } from '@/components/kit/error-boundary';
import { Toaster } from '@/components/ui/sonner';
import { ConnectionGate } from '@/components/ConnectionGate';
import { AppShell } from '@/components/AppShell';
import { ErrorBox } from '@/components/common';
import './styles.css';

type State={connected:boolean;expired?:boolean;refreshable?:boolean;expiresAt:number|null;environment:'ppe'|'online';account?:{name:string|null;avatar:string|null}};
function Root(){const [state,setState]=useState<State|null>(null);const [error,setError]=useState('');async function refresh(){setError('');try{setState(await connectionStatus() as State)}catch(e){setError(e instanceof Error?e.message:'无法读取连接状态')}}useEffect(()=>{refresh();document.title='豆包工作 Open API 能力展示台'},[]);
 // 令牌可能在使用中途过期：每分钟静默复查一次，过期即回到授权页而不是让每个按钮都报 401。
 useEffect(()=>{if(!state?.connected)return;const t=window.setInterval(()=>{connectionStatus().then(s=>setState(s as State)).catch(()=>{})},60_000);return()=>window.clearInterval(t)},[state?.connected]);if(error)return <div className="boot-state"><ErrorBox message={`${error}。请刷新页面；若持续失败，检查后端健康状态。`}/><button onClick={refresh}>重试</button></div>;if(!state)return <div className="boot-state" role="status">正在检查服务端连接状态…</div>;if(!state.connected)return <ConnectionGate onConnected={refresh} expired={state.expired}/>;return <AppShell environment={state.environment} expiresAt={state.expiresAt} account={state.account} onRefresh={refresh} onDisconnected={refresh}/>}
export default function App(){const [client]=useState(()=>createQueryClient());return <ErrorBoundary><QueryClientProvider client={client}><Root/><Toaster richColors position="top-center" offset={72}/></QueryClientProvider></ErrorBoundary>}
