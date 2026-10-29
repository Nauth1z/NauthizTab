export async function withLock<T>(name: string, operation: () => Promise<T>): Promise<T> {
  if (!navigator.locks?.request) {
    return Promise.reject(new Error('当前环境不支持安全存储，请使用新版 Chrome 或 Edge。'));
  }
  return await navigator.locks.request(`nauthiz-tab:${name}`, operation);
}
