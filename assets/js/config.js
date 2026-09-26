/**
 * config.js — 由 scripts/gen-config.mjs 生成,请勿手改(改完会在下次部署被覆盖)
 * 生成时间: 2026-09-26T04:38:37.969Z
 * 配置来源: 环境变量
 */

export const BUILD_CONFIG = {
  "supabaseUrl": "https://wpfcmhlqlmovljurngti.supabase.co",
  "supabaseAnonKey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndwZmNtaGxxbG1vdmxqdXJuZ3RpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAzODY5MzUsImV4cCI6MjEwNTk2MjkzNX0.HqPinbFXzOwfEys7h1CECDP5bVZNnl3mhNUfJ-QlsrY",
  "appName": "语伴打卡"
};

function readOverride() {
  try {
    const raw = localStorage.getItem('duo.supabase.override');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.url && parsed.key) return parsed;
  } catch { /* ignore */ }
  return null;
}

export function saveOverride(url, key) {
  localStorage.setItem('duo.supabase.override', JSON.stringify({ url: String(url).trim(), key: String(key).trim() }));
}

export function clearOverride() {
  localStorage.removeItem('duo.supabase.override');
}

export function getConfig() {
  const injected = typeof window !== 'undefined' && window.__APP_CONFIG__ ? window.__APP_CONFIG__ : null;
  const override = readOverride();
  const url = (override?.url || injected?.supabaseUrl || BUILD_CONFIG.supabaseUrl || '').trim();
  const key = (override?.key || injected?.supabaseAnonKey || BUILD_CONFIG.supabaseAnonKey || '').trim();
  const isPlaceholder = !url || !key
    || url.includes('YOUR-PROJECT')
    || url.includes('your-project')
    || url === 'undefined'
    || key.includes('YOUR-ANON-KEY')
    || key === 'undefined';
  return {
    supabaseUrl: isPlaceholder ? '' : url,
    supabaseAnonKey: isPlaceholder ? '' : key,
    configured: !isPlaceholder,
    source: override ? 'local' : injected ? 'injected' : 'build',
    appName: injected?.appName || BUILD_CONFIG.appName,
  };
}
