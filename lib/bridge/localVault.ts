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

const DB_NAME = 'markflow_local_assets';
const STORE = 'handles';
const KEY = 'vault_root';

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

function idbRun<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    openDb().then((db) => {
      const tx = db.transaction(STORE, mode);
      const rq = fn(tx.objectStore(STORE));
      rq.onsuccess = () => resolve(rq.result);
      rq.onerror = () => reject(rq.error);
      tx.oncomplete = () => db.close();
    }, reject);
  });
}

/** 持久化文件夹 handle(连接成功后调用)。 */
export function saveVaultHandle(handle: FileSystemDirectoryHandle): Promise<IDBValidKey> {
  return idbRun('readwrite', (s) => s.put(handle, KEY));
}

/** 取回已存的文件夹 handle;未连接返回 null。 */
export async function getVaultHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const h = await idbRun<FileSystemDirectoryHandle | undefined>('readonly', (s) => s.get(KEY));
    return h ?? null;
  } catch {
    return null;
  }
}

/** 清除已存的文件夹 handle(「清除」按钮 / 连接失效)。 */
export function clearVaultHandle(): Promise<undefined> {
  return idbRun('readwrite', (s) => s.delete(KEY));
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
