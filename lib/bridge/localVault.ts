/**
 * 本地图片文件夹(File System Access)—— 运行于 **content(ISOLATED world)**:
 * showDirectoryPicker 在 content 内产生页面手势时调用(见 entrypoints/content.ts),
 * 拿到的 FileSystemDirectoryHandle 持久化进本页面(x.com origin)的 IndexedDB;导入时
 * 从 handle 逐级解析相对路径读出 File。路径安全器拒绝绝对路径 / 盘符 / `..` 逃逸,并支持
 * Obsidian「路径首段 == 所选文件夹名」时剥掉首段(vault 场景)。范式照搬 xposter §7。
 *
 * 注意:handle 存在 x.com origin 的 IndexedDB,只有 content(同 origin)能读——sidepanel
 * (扩展 origin)读不到,故本模块只在 content 侧使用;UI 侧仅通过 runtime 消息触发/查询。
 */

import type { VaultScope } from './protocol';

const DB_NAME = 'markflow_local_assets';
const STORE = 'handles';
/**
 * 两级文件夹的 IndexedDB key(作用域定义见 protocol 的 VaultScope):
 *  - persistent 复用旧 key 'vault_root',兼容此前已连接的设置文件夹(升级不丢);
 *  - active 用新 key 'vault_active'。
 */
const KEYS: Record<VaultScope, string> = {
  persistent: 'vault_root', // 复用旧 key,兼容此前已连接的设置文件夹(不丢)
  active: 'vault_active',
};

/** FileSystemHandle 的权限 API(TS DOM lib 尚未覆盖,按需最小声明,不用 any)。 */
interface FsPermissionHandle {
  queryPermission(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
}

/** 打开(或建)IndexedDB;handle 可结构化克隆,直接存对象。 */
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * (P2-18)坏库状态(如 upgrade 中断后 object store 缺失)下 `db.transaction`/`objectStore`
 * 会**同步抛**,此前无 try/catch 兜底,Promise 永不 settle——设置页「连接/清除文件夹」按钮
 * 因此永久 pending。这里统一收口:
 *  - `db.transaction(...)` 与 `fn(tx.objectStore(...))` 都包 try/catch 转 reject;
 *  - 补 `tx.onabort`/`tx.onerror`(此前只挂了请求级的 onsuccess/onerror,事务级异常没人接);
 *  - 用一个 `finish()` 统一 resolve/reject **并** `db.close()`——无论成功还是任一失败路径,
 *    db 都会被关掉,不再有路径漏关(此前只有 `tx.oncomplete` 一条关库路径)。
 *
 * 导出(而非模块私有)是为了让单测能直接喂假 IDBDatabase/IDBTransaction 驱动这里的错误分支
 * ——本模块其余函数(saveVaultHandle 等)都在函数体内触达真实 indexedDB,不便单测。
 */
export function idbRun<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    openDb().then((db) => {
      // settled 防重复关库:success/error 可能来自不同事件源(rq 与 tx)在极端实现里都触发,
      // 只认第一次结果,重复调用 db.close() 本身无害但没必要。
      let settled = false;
      const finish = (ok: boolean, val: unknown) => {
        if (settled) return;
        settled = true;
        db.close();
        if (ok) resolve(val as T);
        else reject(val instanceof Error ? val : new Error(String(val)));
      };
      let tx: IDBTransaction;
      try {
        tx = db.transaction(STORE, mode);
      } catch (err) {
        finish(false, err);
        return;
      }
      tx.onabort = () => finish(false, tx.error ?? new Error('indexedDB transaction aborted'));
      tx.onerror = () => finish(false, tx.error ?? new Error('indexedDB transaction error'));
      try {
        const rq = fn(tx.objectStore(STORE));
        // 结果在 rq.onsuccess 暂存、**事务 oncomplete 才 resolve**(review 修复):IndexedDB 的
        // request onsuccess ≠ 已落盘——写事务可能在 commit 阶段才因 QuotaExceeded 中止,
        // 那时 onabort 会来,但若已在 rq.onsuccess 提前 resolve(settled=true),abort 就被
        // 吞掉,「文件夹已连接」实际什么都没存。oncomplete 之后才是可信的成功。
        let result: unknown;
        let gotResult = false;
        rq.onsuccess = () => {
          result = rq.result;
          gotResult = true;
        };
        rq.onerror = () => finish(false, rq.error ?? new Error('indexedDB request error'));
        tx.oncomplete = () =>
          gotResult
            ? finish(true, result)
            : finish(false, new Error('indexedDB transaction completed without result'));
      } catch (err) {
        // fn 本身同步抛(如 object store 名不存在)——同样转 reject,不留悬挂 Promise。
        finish(false, err);
      }
    }, reject);
  });
}

/** 持久化文件夹 handle(连接成功后调用)。scope 决定存到 active(素材板)还是 persistent(设置)。 */
export function saveVaultHandle(
  handle: FileSystemDirectoryHandle,
  scope: VaultScope,
): Promise<IDBValidKey> {
  return idbRun('readwrite', (s) => s.put(handle, KEYS[scope]));
}

/** 取回指定 scope 已存的文件夹 handle;未连接返回 null。 */
export async function getVaultHandle(
  scope: VaultScope,
): Promise<FileSystemDirectoryHandle | null> {
  try {
    const h = await idbRun<FileSystemDirectoryHandle | undefined>('readonly', (s) =>
      s.get(KEYS[scope]),
    );
    return h ?? null;
  } catch {
    return null;
  }
}

/** 清除指定 scope 已存的文件夹 handle(「清除」按钮 / 连接失效)。 */
export function clearVaultHandle(scope: VaultScope): Promise<undefined> {
  return idbRun('readwrite', (s) => s.delete(KEYS[scope]));
}

/** 已授予读权限即返回 true;prompt/denied 返回 false(requestPermission 需手势,由授权流程调用)。 */
export async function hasReadPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    const perm = await (handle as unknown as FsPermissionHandle).queryPermission({ mode: 'read' });
    return perm === 'granted';
  } catch {
    return false;
  }
}

/** 在有用户手势时申请读权限(授权流程用);返回是否已授予。 */
export async function requestReadPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    const perm = await (handle as unknown as FsPermissionHandle).requestPermission({ mode: 'read' });
    return perm === 'granted';
  } catch {
    return false;
  }
}

/**
 * 把相对路径拆成安全的路径段;非法(绝对路径 / 盘符 / `..` 逃逸 / 空)返回 null。
 * 反斜杠归一为 `/`,`%20` 等 URL 编码解码,忽略 `.` 与空段。
 * decode=false 时跳过 URL 解码(C9:文件名里本就含字面 `%xx` 时,解码后反而读不到,需用原串重试)。
 */
export function splitLocalPath(raw: string, decode = true): string[] | null {
  let p = raw.trim();
  if (decode) {
    try {
      p = decodeURIComponent(p);
    } catch {
      /* 非法编码则用原串继续 */
    }
  }
  p = p.replace(/\\/g, '/');
  if (p.startsWith('/') || /^[a-zA-Z]:/.test(p)) return null; // 绝对路径 / 盘符
  const segs = p.split('/').filter((s) => s !== '' && s !== '.');
  if (!segs.length || segs.some((s) => s === '..')) return null; // 空 / `..` 逃逸
  return segs;
}

/**
 * 剥掉路径尾部的 `?query` / `#hash`(C9):`![](img/a.png?v=2)`、`![](a.png#center)` 这类写法
 * 在 Markdown 编辑器里能显示,本地文件名里却没有这段。只剥**字面** `?`/`#`(在解码之前),
 * 编码过的 `%3F`/`%23` 属于文件名本身,不动。
 */
export function stripQueryHash(raw: string): string {
  const i = raw.search(/[?#]/);
  return i >= 0 ? raw.slice(0, i) : raw;
}

/** 从根 handle 按段逐级读文件;任一级不存在则返回 null。 */
async function readBySegments(
  root: FileSystemDirectoryHandle,
  segs: string[],
): Promise<File | null> {
  try {
    let dir = root;
    for (let i = 0; i < segs.length - 1; i += 1) {
      dir = await dir.getDirectoryHandle(segs[i]!);
    }
    const fh = await dir.getFileHandle(segs[segs.length - 1]!);
    return await fh.getFile();
  } catch {
    return null; // NotFoundError 等 → 视为「未找到」,交调用方降级
  }
}

// ── 文件名索引(C9)──
// Obsidian 短链接 `![[x.png]]` 只写文件名(附件实际在 attachments/ 或任意子目录);md 位于
// vault 子目录时 `./img/a.png` / `../assets/a.png` 是相对 md 自身的路径——两者按「根 + 相对路径」
// 直读必然 not-found。直读失败时在 vault 内按文件名查找(Obsidian 的解析规则:同名取路径最短)。

/** 索引扫描上限:目录深度(根的直接子项为第 1 层)与条目总数,防巨型文件夹拖死导入。 */
export const VAULT_INDEX_MAX_DEPTH = 6;
export const VAULT_INDEX_MAX_ENTRIES = 5000;

/** 文件名 → 该名所有文件的路径段列表(相对根)。 */
export type VaultNameIndex = Map<string, string[][]>;

/** 目录遍历所需的最小接口(TS DOM lib 的异步迭代声明随版本不一,按需最小声明)。 */
interface IterableDirHandle {
  values(): AsyncIterable<{ kind: 'file' | 'directory'; name: string }>;
}

/** 跳过的目录:隐藏目录(`.obsidian`/`.git`/`.trash` 等)与 node_modules。 */
function skipDir(name: string): boolean {
  return name.startsWith('.') || name === 'node_modules';
}

/**
 * BFS 建文件名索引。有上限(深度/条目数),超限即停——宁可少收录也不卡死;
 * 单个目录读取失败(权限/竞态删除)跳过该目录继续。
 */
export async function buildVaultNameIndex(root: FileSystemDirectoryHandle): Promise<VaultNameIndex> {
  const index: VaultNameIndex = new Map();
  let entries = 0;
  const queue: { dir: FileSystemDirectoryHandle; path: string[] }[] = [{ dir: root, path: [] }];
  while (queue.length > 0) {
    const { dir, path } = queue.shift()!;
    try {
      for await (const h of (dir as unknown as IterableDirHandle).values()) {
        entries += 1;
        if (entries > VAULT_INDEX_MAX_ENTRIES) return index;
        if (h.kind === 'file') {
          const list = index.get(h.name);
          const segs = [...path, h.name];
          if (list) list.push(segs);
          else index.set(h.name, [segs]);
        } else if (path.length + 1 < VAULT_INDEX_MAX_DEPTH && !skipDir(h.name)) {
          queue.push({ dir: h as unknown as FileSystemDirectoryHandle, path: [...path, h.name] });
        }
      }
    } catch {
      /* 该目录不可读:跳过 */
    }
  }
  return index;
}

/**
 * 索引缓存:每次导入只建一次(多图并发准备共享同一个 Promise),导入结束由 content 调
 * clearVaultIndexCache() 清掉。键是调用方给的作用域标识(active/persistent)——handle 每次从
 * IndexedDB 取出都是新对象,不能按对象身份缓存。
 */
const indexCache = new Map<string, Promise<VaultNameIndex>>();

/** 清空文件名索引缓存(导入开始/结束时调用;文件夹内容可能已变)。 */
export function clearVaultIndexCache(): void {
  indexCache.clear();
}

function getIndex(root: FileSystemDirectoryHandle, cacheKey: string | undefined): Promise<VaultNameIndex> {
  if (cacheKey === undefined) return buildVaultNameIndex(root);
  let p = indexCache.get(cacheKey);
  if (!p) {
    p = buildVaultNameIndex(root);
    indexCache.set(cacheKey, p);
  }
  return p;
}

/**
 * 原始路径的「尾部段」(用于索引匹配):归一反斜杠、去空段/`.`/`..`。`..` 在这里只是被丢弃
 * 而非放行——索引查找只在 vault 内部按文件名匹配,不存在逃逸。
 */
function tailSegments(raw: string, decode: boolean): string[] {
  let p = raw.trim();
  if (decode) {
    try {
      p = decodeURIComponent(p);
    } catch {
      /* 原串继续 */
    }
  }
  return p
    .replace(/\\/g, '/')
    .split('/')
    .filter((s) => s !== '' && s !== '.' && s !== '..');
}

/** 是否该走索引兜底:单段文件名(Obsidian 短链接),或显式相对 md 自身的 `./`、`../` 路径。 */
function wantsIndexLookup(raw: string): boolean {
  const p = raw.trim().replace(/\\/g, '/');
  if (p.startsWith('./') || p.startsWith('../')) return true;
  return !p.includes('/');
}

/**
 * 从索引里按尾部段匹配:候选路径须以 tail 结尾(`./img/a.png` 只认 `…/img/a.png`),
 * 多个命中取路径段最少者(Obsidian「最短路径」规则),同长取先入索引者(BFS 顺序 = 更浅更先)。
 */
export function pickFromIndex(index: VaultNameIndex, tail: string[]): string[] | null {
  const name = tail[tail.length - 1];
  if (!name) return null;
  const candidates = index.get(name);
  if (!candidates) return null;
  let best: string[] | null = null;
  for (const segs of candidates) {
    if (segs.length < tail.length) continue;
    const off = segs.length - tail.length;
    if (!tail.every((t, i) => segs[off + i] === t)) continue;
    if (!best || segs.length < best.length) best = segs;
  }
  return best;
}

/** 按「解码段 → 未解码原串段」两遍直读(含 Obsidian 首段 == 文件夹名的剥除)。 */
async function readDirect(
  root: FileSystemDirectoryHandle,
  path: string,
  folderName: string | null,
): Promise<File | null> {
  const tried = new Set<string>();
  for (const decode of [true, false]) {
    const segs = splitLocalPath(path, decode);
    if (!segs) continue;
    const key = segs.join('/');
    if (tried.has(key)) continue; // 无编码字符时两遍相同,不重复读
    tried.add(key);
    const direct = await readBySegments(root, segs);
    if (direct) return direct;
    if (folderName && segs.length > 1 && segs[0] === folderName) {
      const stripped = await readBySegments(root, segs.slice(1));
      if (stripped) return stripped;
    }
  }
  return null;
}

/**
 * 从文件夹 handle 解析相对路径读出 File;读不到返回 null(调用方降级为 fallbackText)。
 * 查找顺序:
 *  1. 剥 `?query`/`#hash` 后按「根 + 相对路径」直读(解码失败或解码后读不到 → 用未解码原串重试);
 *     失败且**首段 == 所选文件夹名**时剥掉首段重试(Obsidian vault:`myvault/img.png` 在选了
 *     myvault 文件夹时应解析为 `img.png`);剥后仍读不到且原串含 `?`/`#` 时再按原串试一次。
 *  2. 仍失败且路径是单段文件名或以 `./`/`../` 开头 → 文件名索引兜底(见 pickFromIndex)。
 * 安全:非法路径(绝对路径 / 盘符 / `..` 逃逸)在第 1 步被拒;第 2 步只在 vault 内按名匹配,
 * 读取的始终是索引里真实存在于 root 之下的路径。
 */
export async function resolveLocalFile(
  root: FileSystemDirectoryHandle,
  rawPath: string,
  folderName: string | null,
  indexCacheKey?: string,
): Promise<File | null> {
  return (
    (await resolveLocalFileDirect(root, rawPath, folderName)) ??
    (await resolveLocalFileByIndex(root, rawPath, indexCacheKey))
  );
}

/** resolveLocalFile 第 1 步:直读(含 query/hash 剥离回退与首段 == 文件夹名剥除)。 */
async function resolveLocalFileDirect(
  root: FileSystemDirectoryHandle,
  rawPath: string,
  folderName: string | null,
): Promise<File | null> {
  const path = stripQueryHash(rawPath);
  return (
    (await readDirect(root, path, folderName)) ??
    (path !== rawPath ? await readDirect(root, rawPath, folderName) : null)
  );
}

/** resolveLocalFile 第 2 步:文件名索引兜底(仅单段文件名或 `./`/`../` 开头的路径)。 */
async function resolveLocalFileByIndex(
  root: FileSystemDirectoryHandle,
  rawPath: string,
  indexCacheKey?: string,
): Promise<File | null> {
  const path = stripQueryHash(rawPath);
  if (!wantsIndexLookup(path)) return null;

  const index = await getIndex(root, indexCacheKey);
  const tried = new Set<string>();
  for (const decode of [true, false]) {
    const tail = tailSegments(path, decode);
    const key = tail.join('/');
    if (!tail.length || tried.has(key)) continue;
    tried.add(key);
    const hit = pickFromIndex(index, tail);
    if (hit) {
      const file = await readBySegments(root, hit);
      if (file) return file;
    }
  }
  return null;
}

/**
 * 多根(按优先级排好)两层解析(C9):**先在所有根直读**,全部失败后**再在所有根查文件名索引**——
 * 避免 active 的索引模糊命中(同名图在别的目录)遮蔽 persistent 的精确路径。导出供单测。
 */
export async function resolveAcrossRoots(
  roots: ReadonlyArray<{ handle: FileSystemDirectoryHandle; cacheKey: string }>,
  rawPath: string,
): Promise<File | null> {
  for (const { handle } of roots) {
    const file = await resolveLocalFileDirect(handle, rawPath, handle.name);
    if (file) return file;
  }
  for (const { handle, cacheKey } of roots) {
    const file = await resolveLocalFileByIndex(handle, rawPath, cacheKey);
    if (file) return file;
  }
  return null;
}

/**
 * 按作用域优先级 active(素材板「本篇」)> persistent(设置默认)**逐文件兜底**解析本地图:
 * 依次对每个「已连接且读权限有效」的文件夹尝试 resolveLocalFile,首个命中即返回 File。
 * 与「handle 级优先」的区别:active 里找不到该文件时会继续到 persistent 里找——active 只是
 * 优先来源,不会一旦连上就把 persistent 整体架空(避免「素材卡显示就绪、导入却降级」的落差)。
 * 两层拆开(C9):先在所有作用域直读,全部失败后再在所有作用域查文件名索引(见 resolveAcrossRoots)。
 * 两级都读不到返回 null(调用方降级 fallbackText)。
 */
export async function resolveLocalImageAcrossScopes(rawPath: string): Promise<File | null> {
  const roots: Array<{ handle: FileSystemDirectoryHandle; cacheKey: string }> = [];
  for (const scope of ['active', 'persistent'] as const) {
    const h = await getVaultHandle(scope);
    if (h && (await hasReadPermission(h))) roots.push({ handle: h, cacheKey: scope });
  }
  return resolveAcrossRoots(roots, rawPath);
}
