/**
 * 与 X 文章编辑页的连接状态。
 * Phase A 为 mock；M1 接真实 content-script 探针（页面 / 编辑器实例 / 上传通道）。
 */
export interface ConnectionState {
  connected: boolean;
  route: string;
}

export function useConnection(): ConnectionState {
  // TODO(M1): 替换为真实探针订阅
  return { connected: true, route: 'articles/edit/19…' };
}
