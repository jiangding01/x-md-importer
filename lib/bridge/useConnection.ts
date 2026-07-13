import { useProbe } from './useProbe';

/**
 * 与 X 文章编辑页的连接状态。
 * M1 起为真探针适配层:基于共享的 <ProbeProvider> 派生,不再是 Phase A 的写死 mock。
 * 对外仍暴露同一份 ConnectionState 接口,4 处消费者(PreflightCard / Footer /
 * DraftTab / WorkspaceProvider)无需改动。
 */
export interface ConnectionState {
  connected: boolean;
  route: string;
}

export function useConnection(): ConnectionState {
  const { status, result } = useProbe();
  // 语义:真正「在文章编辑页且 Draft 可写」——探针 ready + 定位到 Draft 实例 + 拿到 articleId。
  const connected =
    status === 'ready' && result !== null && result.hasDraftNode && result.articleId !== null;
  const route = result?.articleId ? `articles/edit/${result.articleId}` : '';
  return { connected, route };
}
