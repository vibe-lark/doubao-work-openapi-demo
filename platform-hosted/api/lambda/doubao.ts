import { Api, Data, Post, useAnygen } from '@anygen/server';
import { eventCreateSchema, invokeInputSchema, messageListSchema, messageRetrieveSchema, sessionCreateSchema, sessionIdSchema, sessionListSchema, sessionStreamProbeSchema, sessionUpdateSchema, streamSchema, uploadInputSchema } from '@shared/schema';
import { proxyRequest, streamRequest } from './_client';

function id(value: string) { return encodeURIComponent(value); }

export const sessionsCreate = Api(Post('/sessions/create'), Data(sessionCreateSchema), async ({ data }) => proxyRequest(useAnygen(), 'POST', '/v1/sessions', data.body));
export const sessionsRetrieve = Api(Post('/sessions/retrieve'), Data(sessionIdSchema), async ({ data }) => proxyRequest(useAnygen(), 'GET', `/v1/sessions/${id(data.sessionId)}`));
export const sessionsUpdate = Api(Post('/sessions/update'), Data(sessionUpdateSchema), async ({ data }) => proxyRequest(useAnygen(), 'PATCH', `/v1/sessions/${id(data.sessionId)}`, data.body));
export const sessionsDelete = Api(Post('/sessions/delete'), Data(sessionIdSchema), async ({ data }) => proxyRequest(useAnygen(), 'DELETE', `/v1/sessions/${id(data.sessionId)}`));
export const sessionsList = Api(Post('/sessions/list'), Data(sessionListSchema), async ({ data }) => proxyRequest(useAnygen(), 'GET', '/v1/sessions', undefined, data.query));
export const eventsCreate = Api(Post('/events/create'), Data(eventCreateSchema), async ({ data }) => proxyRequest(useAnygen(), 'POST', `/v1/sessions/${id(data.sessionId)}/events`, data.body));
export const messagesList = Api(Post('/messages/list'), Data(messageListSchema), async ({ data }) => proxyRequest(useAnygen(), 'GET', `/v1/sessions/${id(data.sessionId)}/messages`, undefined, data.query));
export const messagesRetrieve = Api(Post('/messages/retrieve'), Data(messageRetrieveSchema), async ({ data }) => proxyRequest(useAnygen(), 'GET', `/v1/sessions/${id(data.sessionId)}/messages/${id(data.messageId)}`));
export const messageStream = Api(Post('/messages/stream'), Data(streamSchema), async ({ data }) => streamRequest(useAnygen(), `/v1/sessions/${id(data.sessionId)}/events/${id(data.messageId)}`, data.query, data.lastEventId, data.limitMs));
export const sessionStreamProbe = Api(Post('/sessions/stream-probe'), Data(sessionStreamProbeSchema), async ({ data }) => streamRequest(useAnygen(), `/v1/sessions/${id(data.sessionId)}/events`, undefined, undefined, data.limitMs));
export const filesUpload = Api(Post('/files/upload'), Data(uploadInputSchema), async ({ data }) => {
  const bytes = Uint8Array.from(atob(data.base64), char => char.charCodeAt(0));
  const form = new FormData(); form.set('uuid', data.uuid); form.set('filename', data.filename); form.set('file', new Blob([bytes], { type:data.contentType }), data.filename);
  return proxyRequest(useAnygen(), 'POST', '/v1/files', form);
});

// Compatibility dispatcher used by the existing console UI. Public callers should prefer the named actions above.
export const invokeDoubao = Api(Post('/doubao/invoke'), Data(invokeInputSchema), async ({ data }) => {
  const ag = useAnygen(); const sid = data.sessionId ? id(data.sessionId) : ''; const mid = data.messageId ? id(data.messageId) : '';
  if (data.operation.includes('sessions.') && !['sessions.create','sessions.list'].includes(data.operation) && !sid) return { httpStatus:0, code:'INPUT_MISSING', msg:'缺少 sessionId', data:null, durationMs:0, request:{method:'',url:'',headers:{}} };
  switch (data.operation) {
    case 'sessions.create': return proxyRequest(ag,'POST','/v1/sessions',data.body);
    case 'sessions.retrieve': return proxyRequest(ag,'GET',`/v1/sessions/${sid}`);
    case 'sessions.update': return proxyRequest(ag,'PATCH',`/v1/sessions/${sid}`,data.body);
    case 'sessions.delete': return proxyRequest(ag,'DELETE',`/v1/sessions/${sid}`);
    case 'sessions.list': return proxyRequest(ag,'GET','/v1/sessions',undefined,data.query);
    case 'events.create': return proxyRequest(ag,'POST',`/v1/sessions/${sid}/events`,data.body);
    case 'events.stream': return streamRequest(ag,`/v1/sessions/${sid}/events`,data.query,data.lastEventId,5000);
    case 'message.stream': return streamRequest(ag,`/v1/sessions/${sid}/events/${mid}`,data.query,data.lastEventId,5000);
    case 'messages.list': return proxyRequest(ag,'GET',`/v1/sessions/${sid}/messages`,undefined,data.query);
    case 'messages.retrieve': return proxyRequest(ag,'GET',`/v1/sessions/${sid}/messages/${mid}`);
    case 'files.upload': return { httpStatus:0, code:'USE_FILES_UPLOAD', msg:'请使用 filesUpload action', data:null, durationMs:0, request:{method:'POST',url:'/v1/files',headers:{}} };
  }
});
