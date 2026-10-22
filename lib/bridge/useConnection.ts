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
  /** 编辑器正文是否已有内容(仅 ready 时有意义,否则恒 false)。供「已有内容询问」用。 */
  hasContent: boolean;
}

export function useConnection(): ConnectionState {
  const { status, result } = useProbe();
  // 语义:真正「在文章编辑页且 Draft 可写」——探针 ready + 定位到 Draft 实例 + 文章编辑路由。
  // review #2:去掉 articleId!==null 要求——新建文章页 URL 尚无 /edit/数字,但 Draft 已可写。
  // B3:改用 isArticleEditor(`/compose/articles` 路由前缀)做闸门——推文 compose 弹窗 /
  // 私信框同样是 Draft.js,hasDraftNode 单独为 true 会把它们误判「已连接」,replace 清掉推文草稿。
  // 旧 injector(页面未刷新)不回该字段 → undefined → 按未连接处理(fail-closed)。
  const connected =
    status === 'ready' && result !== null && result.hasDraftNode && result.isArticleEditor === true;
  // route 仍按 articleId 显示(新建页无 id 则为空串)。
  const route = result?.articleId ? `articles/edit/${result.articleId}` : '';
  // 真实探针的「编辑器已有内容」判定(hasDraftNode 为 false 时 result.hasContent 恒 false)。
  const hasContent = status === 'ready' ? (result?.hasContent ?? false) : false;
  return { connected, route, hasContent };
}
