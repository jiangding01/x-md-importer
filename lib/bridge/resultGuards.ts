/**
 * B9:content 侧对 injector 回传结果的形状守卫。
 *
 * injector 跑在 MAIN world,经 window.postMessage 回传 probe/import/set-title 结果;页面脚本同样能
 * 看到广播里的 nonce/id,可伪造 result。content 不能信任其形状:imageFailures 非数组会在展开处抛
 * TypeError,超长字符串会被写进历史(storage 配额)。故 content 收到 result 后一律经此处:
 *  - 形状校验(布尔 / 非负整数 / 数组 / 枚举),不合规 → `{ ok:false, error:'bad-result' }`;
 *  - 字符串截断(error/detail ≤ 500、source ≤ 2000),imageFailures 条数上限 200;
 *  - 只挑白名单字段输出,不透传未知字段。
 */
import {
  BAD_RESULT_ERROR,
  truncateForReport,
  type ImageFailure,
  type ImportResponse,
  type ProbeResult,
  type SetTitleResponse,
} from './protocol';

export const MAX_ERROR_LEN = 500;
export const MAX_DETAIL_LEN = 500;
export const MAX_SOURCE_LEN = 2000;
export const MAX_REASON_LEN = 100;
export const MAX_IMAGE_FAILURES = 200;
/** X 文章 id 为数字串;给足余量,超长视为伪造。 */
const MAX_ARTICLE_ID_LEN = 64;

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const optBool = (v: unknown): boolean => v === undefined || typeof v === 'boolean';

/** 单条图片失败明细;不合规返回 null。 */
function normalizeImageFailure(raw: unknown): ImageFailure | null {
  if (!isRec(raw)) return null;
  const { index, source, stage, reason, detail } = raw;
  if (typeof index !== 'number' || !Number.isInteger(index) || index < -1) return null;
  if (typeof source !== 'string' || typeof reason !== 'string') return null;
  if (stage !== 'prepare' && stage !== 'upload') return null;
  if (detail !== undefined && typeof detail !== 'string') return null;
  const out: ImageFailure = {
    index,
    source: truncateForReport(source, MAX_SOURCE_LEN),
    stage,
    reason: truncateForReport(reason, MAX_REASON_LEN),
  };
  if (detail !== undefined) out.detail = truncateForReport(detail, MAX_DETAIL_LEN);
  return out;
}

const BAD: { ok: false; error: typeof BAD_RESULT_ERROR } = { ok: false, error: BAD_RESULT_ERROR };

/** import-result → ImportResponse(通道层形状)。 */
export function normalizeImportResult(raw: unknown): ImportResponse {
  if (!isRec(raw)) return { ...BAD };
  if (raw.ok === false) {
    if (typeof raw.error !== 'string' || !optBool(raw.committed)) return { ...BAD };
    const out: ImportResponse = { ok: false, error: truncateForReport(raw.error, MAX_ERROR_LEN) };
    if (raw.committed !== undefined) out.committed = raw.committed as boolean;
    return out;
  }
  if (raw.ok !== true) return { ...BAD };
  // ok:true 但形状不合规:正文可能已写入,标 committed 让 UI 走「先检查再重试」。
  const BAD_COMMITTED: ImportResponse = { ok: false, error: BAD_RESULT_ERROR, committed: true };
  const { blockCount, effectiveMode, imageOk, imageFail, coverSet, imageFailures } = raw;
  if (!isCount(blockCount) || !isCount(imageOk) || !isCount(imageFail)) return { ...BAD_COMMITTED };
  if (effectiveMode !== 'replace' && effectiveMode !== 'append') return { ...BAD_COMMITTED };
  if (!optBool(coverSet)) return { ...BAD_COMMITTED };
  let failures: ImageFailure[] | undefined;
  if (imageFailures !== undefined) {
    if (!Array.isArray(imageFailures)) return { ...BAD_COMMITTED };
    failures = [];
    for (const f of imageFailures.slice(0, MAX_IMAGE_FAILURES)) {
      const n = normalizeImageFailure(f);
      if (!n) return { ...BAD_COMMITTED };
      failures.push(n);
    }
  }
  const out: ImportResponse = { ok: true, blockCount, effectiveMode, imageOk, imageFail };
  if (coverSet !== undefined) out.coverSet = coverSet as boolean;
  if (failures !== undefined) out.imageFailures = failures;
  return out;
}

/** set-title-result → SetTitleResponse。 */
export function normalizeSetTitleResult(raw: unknown): SetTitleResponse {
  if (!isRec(raw)) return { ...BAD };
  if (raw.ok === true) return typeof raw.applied === 'boolean' ? { ok: true, applied: raw.applied } : { ...BAD };
  if (raw.ok === false && typeof raw.error === 'string') {
    return { ok: false, error: truncateForReport(raw.error, MAX_ERROR_LEN) };
  }
  return { ...BAD };
}

/**
 * probe-result → ProbeResult。ProbeResponse 的 ok:false 分支只承载通道错误(no-injector/timeout,
 * 由 useProbe 映射成 ProbeStatus),故不合规时沿用 ProbeResult 自带的「探针异常」约定:
 * 四灯全灭 + error='bad-result'——UI 如实显示未就绪,不会误判可写。
 * isArticleEditor 缺失保持缺失(旧 injector 兼容:classifyProbeResult 据此提示刷新页面)。
 */
export function normalizeProbeResult(raw: unknown): ProbeResult {
  const bad: ProbeResult = {
    hasEditor: false,
    hasDraftNode: false,
    hasOnFilesAdded: false,
    articleId: null,
    hasContent: false,
    isArticleEditor: false,
    error: BAD_RESULT_ERROR,
  };
  if (!isRec(raw)) return bad;
  const { hasEditor, hasDraftNode, hasOnFilesAdded, articleId, hasContent, isArticleEditor, error } = raw;
  if (typeof hasEditor !== 'boolean' || typeof hasDraftNode !== 'boolean' || typeof hasOnFilesAdded !== 'boolean') {
    return bad;
  }
  if (!optBool(hasContent) || !optBool(isArticleEditor)) return bad;
  if (articleId !== null && (typeof articleId !== 'string' || articleId.length > MAX_ARTICLE_ID_LEN)) return bad;
  if (error !== undefined && typeof error !== 'string') return bad;
  const out = {
    hasEditor,
    hasDraftNode,
    hasOnFilesAdded,
    articleId,
    hasContent: hasContent === true,
  } as ProbeResult;
  if (isArticleEditor !== undefined) out.isArticleEditor = isArticleEditor as boolean;
  if (error !== undefined) out.error = truncateForReport(error, MAX_ERROR_LEN);
  return out;
}
