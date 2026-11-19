import type { WeixinService } from '../../channels/weixin';
import type { BuiltinProvider } from '../types';
import { barkProvider } from './bark';
import { caldavProvider } from './caldav';
import { outlookProvider } from './outlook';
import { weatherProvider } from './weather';
import { createWeixinProvider } from './weixin';

export interface BuiltinDeps { weixin: () => WeixinService | undefined }

export function createBuiltinProviders(deps: BuiltinDeps): BuiltinProvider[] {
  return [barkProvider, weatherProvider, caldavProvider, outlookProvider, createWeixinProvider(deps.weixin)];
}
