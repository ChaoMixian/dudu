import { id } from '../../contracts';
import type { WeixinService } from '../../channels/weixin';
import type { BuiltinProvider } from '../types';
import { stringSetting } from '../types';

export function createWeixinProvider(getService: () => WeixinService | undefined): BuiltinProvider {
  return {
    id: 'weixin',
    name: '微信',
    description: '接入个人微信，收发消息。',
    descriptionEn: 'Connect a personal WeChat account.',
    category: 'message',
    connect: { kind: 'qr', credentials: ['token'] },
    fields: [
      { key: 'botId', label: '绑定 Bot', type: 'bot', required: true, help: '微信消息只触发这个 Bot；每个微信账号绑定一个 Bot。' },
    ],
    tools: [
      {
        name: 'send_text',
        description: 'Send a text message to WeChat. Use this to answer a message.weixin event or to proactively notify the bound user. It also records the sent text in the dudu timeline.',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Message text' },
            to: { type: 'string', description: 'Optional WeChat peer ID; defaults to the most recent inbound peer' },
          },
          required: ['text'],
        },
      },
      {
        name: 'status',
        description: 'Check whether this WeChat connector is logged in and which account it uses.',
        parameters: { type: 'object', properties: {} },
      },
    ],
    normalize(settings, credentials) {
      const botId = id(stringSetting(settings, 'botId', 'Bound Bot'));
      return {
        settings: { botId },
        credentials: {
          ...(credentials.token ? { token: credentials.token } : {}),
          ...(credentials.baseUrl ? { baseUrl: credentials.baseUrl } : {}),
          ...(credentials.accountId ? { accountId: credentials.accountId } : {}),
          ...(credentials.userId ? { userId: credentials.userId } : {}),
        },
      };
    },
    async disconnect(ctx) {
      const service = getService();
      if (!service) throw new Error('WeChat service is not ready');
      await service.logout(ctx.connectorId);
    },
    async test(ctx) {
      const service = getService();
      if (!service) throw new Error('WeChat service is not ready');
      return service.status(ctx.connectorId);
    },
    async call(tool, args, ctx) {
      const service = getService();
      if (!service) throw new Error('WeChat service is not ready');
      if (tool === 'status') return service.status(ctx.connectorId);
      if (tool === 'send_text') {
        const text = typeof args.text === 'string' ? args.text : '';
        if (!text.trim()) throw new Error('text is required');
        const to = typeof args.to === 'string' && args.to.trim() ? args.to.trim() : undefined;
        return service.sendText(ctx.connectorId, text, to);
      }
      throw new Error(`Unknown WeChat tool: ${tool}`);
    },
  };
}
