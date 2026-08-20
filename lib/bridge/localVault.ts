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
 */
export function splitLocalPath(raw: string): string[] | null {
  let p = raw.trim();
  try {
    p = decodeURIComponent(p);
  } catch {
    /* 非法编码则用原串继续 */
  }
  p = p.replace(/\\/g, '/');
  if (p.startsWith('/') || /^[a-zA-Z]:/.test(p)) return null; // 绝对路径 / 盘符
  const segs = p.split('/').filter((s) => s !== '' && s !== '.');
  if (!segs.length || segs.some((s) => s === '..')) return null; // 空 / `..` 逃逸
  return segs;
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

/**
 * 从文件夹 handle 解析相对路径读出 File;读不到返回 null(调用方降级为 fallbackText)。
 * 先按原路径读;失败且**首段 == 所选文件夹名**时剥掉首段重试(Obsidian vault:
 * `myvault/img.png` 在选了 myvault 文件夹时应解析为 `img.png`)。
 */
export async function resolveLocalFile(
  root: FileSystemDirectoryHandle,
  rawPath: string,
  folderName: string | null,
): Promise<File | null> {
  const segs = splitLocalPath(rawPath);
  if (!segs) return null;
  const direct = await readBySegments(root, segs);
  if (direct) return direct;
  if (folderName && segs.length > 1 && segs[0] === folderName) {
    return readBySegments(root, segs.slice(1));
  }
  return null;
}

/**
 * 按作用域优先级 active(素材板「本篇」)> persistent(设置默认)**逐文件兜底**解析本地图:
 * 依次对每个「已连接且读权限有效」的文件夹尝试 resolveLocalFile,首个命中即返回 File。
 * 与「handle 级优先」的区别:active 里找不到该文件时会继续到 persistent 里找——active 只是
 * 优先来源,不会一旦连上就把 persistent 整体架空(避免「素材卡显示就绪、导入却降级」的落差)。
 * 两级都读不到返回 null(调用方降级 fallbackText)。
 */
export async function resolveLocalImageAcrossScopes(rawPath: string): Promise<File | null> {
  for (const scope of ['active', 'persistent'] as const) {
    const h = await getVaultHandle(scope);
    if (!h || !(await hasReadPermission(h))) continue;
    const file = await resolveLocalFile(h, rawPath, h.name);
    if (file) return file;
  }
  return null;
}
