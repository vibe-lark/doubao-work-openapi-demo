// SSE 持久流式管道：浏览器 → Node → 豆包。
//
// 设计要点：
//   · 上游响应体直接按字节透传，text/event-stream 的 event/data/id 帧与 SSE id 原样到达浏览器；
//   · 透传 Last-Event-ID 请求头，断线重连由上游按 seq 补发；
//   · 浏览器断开时立即 abort 上游，不挂死连接；
//   · 每 15 秒发一行 SSE 注释保活心跳（": ka"，EventSource/fetch 均忽略注释帧）；
//   · 上游建连失败（非 event-stream，如 401/404 JSON）时把真实状态码与响应体转给浏览器；
//   · 流中途异常写一帧 event: error 后关闭，错误不只吞在服务端。

const HEARTBEAT_MS = 15_000;

export async function pipeSSE({ req, res, upstreamUrl, upstreamHeaders, label = 'sse' }) {
  const controller = new AbortController();
  let upstream;
  try {
    upstream = await fetch(upstreamUrl, { headers: upstreamHeaders, signal: controller.signal });
  } catch (error) {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ code: 'SSE_UPSTREAM_UNREACHABLE', msg: error instanceof Error ? error.message : '上游不可达', data: null }));
    }
    return;
  }

  const contentType = upstream.headers.get('content-type') || '';
  // 非 SSE 响应（鉴权失败、404、网关错误等）：状态码与正文原样转给浏览器，便于前端展示真实证据。
  if (!upstream.ok || !contentType.includes('text/event-stream')) {
    const text = await upstream.text().catch(() => '');
    res.writeHead(upstream.status, {
      'Content-Type': contentType || 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Sse-Upstream': 'error',
    });
    res.end(text);
    controller.abort();
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // 禁用常见反向代理缓冲
    'X-Sse-Pipeline': label,
  });

  // 立即发一帧注释，确认管道建立（也让部分代理尽快进入 flush 模式）。
  res.write(`: connected ${new Date().toISOString()}\n\n`);

  const heartbeat = setInterval(() => {
    if (res.writableEnded || res.destroyed) return;
    res.write(`: ka ${new Date().toISOString()}\n\n`);
  }, HEARTBEAT_MS);

  // 浏览器断开 → abort 上游并清理心跳。
  const onClose = () => {
    clearInterval(heartbeat);
    controller.abort();
  };
  req.on('close', onClose);
  res.on('close', onClose);

  let upstreamErrored = false;
  try {
    // 显式移除 content-encoding/length 顾虑：undici 的 res.body 已解压，直接 pipe 即可。
    for await (const chunk of upstream.body) {
      if (res.writableEnded || res.destroyed) break;
      // backpressure：res.write 返回 false 时等 drain，避免内存堆积。
      if (!res.write(chunk)) await new Promise((resolve) => res.once('drain', resolve));
    }
    if (!res.writableEnded) res.end();
  } catch (error) {
    upstreamErrored = true;
    const aborted = error?.name === 'AbortError';
    if (!aborted && !res.writableEnded && !res.destroyed) {
      const payload = JSON.stringify({ type: 'error', stage: 'proxy', message: error instanceof Error ? error.message : '流读取中断' });
      try { res.write(`event: error\ndata: ${payload}\n\n`); } catch { /* 连接已坏 */ }
      res.end();
    } else if (!res.writableEnded) {
      // 浏览器主动断开导致的 abort：直接结束。
      res.end();
    }
  } finally {
    clearInterval(heartbeat);
    try { controller.abort(); } catch { /* ignore */ }
    if (!res.writableEnded) res.end();
  }
  return upstreamErrored;
}
