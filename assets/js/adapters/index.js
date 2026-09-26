/**
 * adapters/index.js — 适配器选择
 *
 * 优先级:
 *   1. 本机房间服务器(页面由 scripts/server.mjs 提供,或隧道转发过来)
 *      → 零账号即可双人真实同步,数据存在自己电脑上
 *   2. Supabase(配置了 NEXT_PUBLIC_SUPABASE_URL / ANON_KEY)
 *      → 生产模式,数据在云端,任意网络都能用
 *   3. 本地演示模式(以上都没有)
 *      → 单机可体验,内置模拟语伴
 */

import { getConfig } from '../config.js';
import { createSupabaseAdapter } from './supabase.js';
import { createLocalAdapter } from './local.js';
import { createRoomServerAdapter, probeRoomServer } from './roomserver.js';

export async function createAdapter(prefs = {}) {
  const config = getConfig();

  if (await probeRoomServer()) {
    const adapter = await createRoomServerAdapter();
    return { adapter, mode: 'server', config };
  }

  if (config.configured) {
    const adapter = await createSupabaseAdapter(config);
    return { adapter, mode: 'supabase', config };
  }

  const adapter = await createLocalAdapter(prefs);
  return { adapter, mode: 'local', config };
}

export { getConfig };
