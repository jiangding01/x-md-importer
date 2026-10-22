// splitLocalPath —— 本地图片路径安全器单测,以及 idbRun 的错误路径单测(B4-7/P2-18)。
// splitLocalPath 是纯函数;idbRun 触达 indexedDB,用下面的假 IDBDatabase/IDBTransaction
// 驱动(不依赖真实 indexedDB/fake-indexeddb 包)。saveVaultHandle/getVaultHandle 等其余
// 导出仍不在本文件测试范围(它们只是 idbRun 的薄封装,行为已被 idbRun 的用例覆盖)。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildVaultNameIndex,
  clearVaultIndexCache,
  idbRun,
  pickFromIndex,
  resolveLocalFile,
  resolveAcrossRoots,
  splitLocalPath,
  stripQueryHash,
  VAULT_INDEX_MAX_DEPTH,
} from './localVault';

describe('splitLocalPath', () => {
  describe('正常路径', () => {
    it('多级相对路径拆成各段', () => {
      expect(splitLocalPath('assets/x.png')).toEqual(['assets', 'x.png']);
    });

    it('单文件名(无目录)', () => {
      expect(splitLocalPath('x.png')).toEqual(['x.png']);
    });

    it('多级子目录', () => {
      expect(splitLocalPath('a/b/c/d.png')).toEqual(['a', 'b', 'c', 'd.png']);
    });
  });

  describe('归一化', () => {
    it('反斜杠归一为正斜杠', () => {
      expect(splitLocalPath('a\\b\\c.png')).toEqual(['a', 'b', 'c.png']);
    });

    it('%20 解码为空格', () => {
      expect(splitLocalPath('a%20b/c%20d.png')).toEqual(['a b', 'c d.png']);
    });

    it('URL 编码的中文文件名解码', () => {
      // encodeURIComponent('资产 图片.png') === '%E8%B5%84%E4%BA%A7%20%E5%9B%BE%E7%89%87.png'
      expect(splitLocalPath('assets/%E8%B5%84%E4%BA%A7%20%E5%9B%BE%E7%89%87.png')).toEqual([
        'assets',
        '资产 图片.png',
      ]);
    });

    it('`.` 段被忽略', () => {
      expect(splitLocalPath('./a/./b.png')).toEqual(['a', 'b.png']);
    });

    it('空段(连续斜杠)被忽略', () => {
      expect(splitLocalPath('a//b.png')).toEqual(['a', 'b.png']);
    });

    it('首尾空白被 trim', () => {
      expect(splitLocalPath('  a/b.png  ')).toEqual(['a', 'b.png']);
    });
  });

  describe('安全拒绝(路径逃逸闸)', () => {
    it('`../x` 相对上跳被拒', () => {
      expect(splitLocalPath('../x')).toBeNull();
    });

    it('`a/../../b` 中途 `..` 被拒', () => {
      expect(splitLocalPath('a/../../b')).toBeNull();
    });

    it('绝对路径 `/etc/passwd` 被拒', () => {
      expect(splitLocalPath('/etc/passwd')).toBeNull();
    });

    it('Windows 盘符 `C:\\x` 被拒', () => {
      expect(splitLocalPath('C:\\x')).toBeNull();
    });

    it('`%2e%2e` 编码绕过被拒(先 decode 再判 `..`)', () => {
      expect(splitLocalPath('%2e%2e/x')).toBeNull();
      expect(splitLocalPath('a/%2e%2e/b')).toBeNull();
    });

    it('编码后的绝对路径 `%2Fetc%2Fpasswd` 被拒(先 decode 再判绝对路径)', () => {
      expect(splitLocalPath('%2Fetc%2Fpasswd')).toBeNull();
    });

    it('纯 `..` 被拒', () => {
      expect(splitLocalPath('..')).toBeNull();
    });

    it('空串返回 null', () => {
      expect(splitLocalPath('')).toBeNull();
    });

    it('仅空白的字符串返回 null(trim 后为空)', () => {
      expect(splitLocalPath('   ')).toBeNull();
    });
  });

  describe('非法 URI 编码', () => {
    it('`%zz` 非法编码不抛异常,用原串继续处理', () => {
      expect(() => splitLocalPath('%zz/foo.png')).not.toThrow();
      expect(splitLocalPath('%zz/foo.png')).toEqual(['%zz', 'foo.png']);
    });
  });
});

// ---------------------------------------------------------------------------
// idbRun(B4-7/P2-18):用手写的假 IDBDatabase/IDBTransaction/IDBRequest 驱动错误路径。
// 不引入 fake-indexeddb 依赖——idbRun 的逻辑只关心几个回调触发时机与顺序,手写假件更直接、
// 也更容易钉住「同步抛必须转 reject」这类此前漏掉的分支。
// ---------------------------------------------------------------------------

type Handler = (() => void) | null;

class FakeRequest<T = unknown> {
  result?: T;
  error: Error | null = null;
  onsuccess: Handler = null;
  onerror: Handler = null;
}

/** 成功请求:下一个微任务触发 onsuccess(模拟 IndexedDB 请求的异步结算)。 */
function successRequest<T>(result: T): FakeRequest<T> {
  const rq = new FakeRequest<T>();
  rq.result = result;
  queueMicrotask(() => rq.onsuccess?.());
  return rq;
}

/** 失败请求:下一个微任务触发 onerror。 */
function errorRequest<T>(error: Error): FakeRequest<T> {
  const rq = new FakeRequest<T>();
  rq.error = error;
  queueMicrotask(() => rq.onerror?.());
  return rq;
}

/** 永不 settle 的请求:用于「请求本身没机会完成、事务却转而 abort」的场景。 */
function silentRequest<T>(): FakeRequest<T> {
  return new FakeRequest<T>();
}

class FakeTransaction {
  oncomplete: Handler = null;
  onabort: Handler = null;
  onerror: Handler = null;
  error: Error | null = null;
  constructor(
    private storeFactory: () => unknown,
    opts: { objectStoreThrows?: Error; abortAfter?: Error } = {},
  ) {
    if (!opts.abortAfter) {
      // 真实 IndexedDB 在全部请求结算后触发 tx.oncomplete——idbRun 现以 oncomplete 为
      // 「可信成功」时机(request onsuccess ≠ 已落盘),假事务同样要在请求 settle 之后
      // (两层微任务)补发 complete;abort 场景不发(真实 abort 路径也没有 complete)。
      queueMicrotask(() => queueMicrotask(() => this.oncomplete?.()));
    }
    if (opts.abortAfter) {
      const err = opts.abortAfter;
      queueMicrotask(() => {
        this.error = err;
        this.onabort?.();
      });
    }
    this.objectStoreThrows = opts.objectStoreThrows;
  }
  private objectStoreThrows?: Error;
  objectStore(_name: string): unknown {
    if (this.objectStoreThrows) throw this.objectStoreThrows;
    return this.storeFactory();
  }
}

class FakeDatabase {
  closeCalls = 0;
  constructor(
    private storeFactory: () => unknown,
    private opts: { transactionThrows?: Error; objectStoreThrows?: Error; abortAfter?: Error } = {},
  ) {}
  close(): void {
    this.closeCalls += 1;
  }
  /** openDb() 的 onupgradeneeded 固定调这个——真实 indexedDB 只在库首建/升版时触发它,
   * 假 open() 每次都触发(简化实现),这里给个 no-op 承接,不代表真的建了 store。 */
  createObjectStore(_name: string): void {
    /* no-op */
  }
  transaction(_name: string, _mode: IDBTransactionMode): unknown {
    if (this.opts.transactionThrows) throw this.opts.transactionThrows;
    return new FakeTransaction(this.storeFactory, {
      objectStoreThrows: this.opts.objectStoreThrows,
      abortAfter: this.opts.abortAfter,
    });
  }
}

/** 把假 IDBDatabase 接到假 indexedDB.open 上——onupgradeneeded/onsuccess 在下一个微任务触发,
 * 模拟真实 IDBOpenDBRequest 的异步结算时机(openDb() 是先拿到 req 对象、再挂 handler)。 */
function stubIndexedDB(db: FakeDatabase): void {
  vi.stubGlobal('indexedDB', {
    open: () => {
      const req: {
        onupgradeneeded: Handler;
        onsuccess: Handler;
        onerror: Handler;
        result?: FakeDatabase;
        error: Error | null;
      } = { onupgradeneeded: null, onsuccess: null, onerror: null, result: undefined, error: null };
      queueMicrotask(() => {
        req.result = db;
        req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('idbRun(B4-7/P2-18)', () => {
  it('正常请求成功 resolve,并在结算后关库', async () => {
    const store = { get: (key: string) => successRequest(`value-for-${key}`) };
    const db = new FakeDatabase(() => store);
    stubIndexedDB(db);

    const result = await idbRun('readonly', (s) => (s as unknown as typeof store).get('k') as unknown as IDBRequest<string>);

    expect(result).toBe('value-for-k');
    expect(db.closeCalls).toBe(1);
  });

  it('请求级 onerror → reject,并关库(此前只有这一条错误路径有人接)', async () => {
    const err = new Error('request boom');
    const store = { get: () => errorRequest(err) };
    const db = new FakeDatabase(() => store);
    stubIndexedDB(db);

    await expect(
      idbRun('readonly', (s) => (s as unknown as typeof store).get() as unknown as IDBRequest<unknown>),
    ).rejects.toThrow('request boom');
    expect(db.closeCalls).toBe(1);
  });

  it('db.transaction 同步抛(坏库状态,如 upgrade 中断后 object store 缺失)→ reject 而非永久悬挂 ' +
    '(P2-18 的核心场景:此前无 catch,「连接/清除文件夹」按钮会永久 pending)', async () => {
    const err = new Error('NotFoundError: object store not found');
    const db = new FakeDatabase(
      () => {
        throw new Error('store factory should not be reached');
      },
      { transactionThrows: err },
    );
    stubIndexedDB(db);

    await expect(
      idbRun('readonly', (s) => (s as unknown as { get: () => IDBRequest<unknown> }).get()),
    ).rejects.toThrow(/object store not found/);
    expect(db.closeCalls).toBe(1);
  });

  it('tx.objectStore(...) 同步抛 → reject,不留悬挂 Promise', async () => {
    const err = new Error('store missing');
    const db = new FakeDatabase(
      () => {
        throw new Error('store factory should not be reached');
      },
      { objectStoreThrows: err },
    );
    stubIndexedDB(db);

    await expect(
      idbRun('readonly', (s) => (s as unknown as { get: () => IDBRequest<unknown> }).get()),
    ).rejects.toThrow('store missing');
    expect(db.closeCalls).toBe(1);
  });

  it('事务级 onabort(请求本身从未 settle)→ reject 并关库(补的 tx.onabort 兜底)', async () => {
    const abortErr = new Error('transaction aborted');
    const store = { get: () => silentRequest() };
    const db = new FakeDatabase(() => store, { abortAfter: abortErr });
    stubIndexedDB(db);

    await expect(
      idbRun('readonly', (s) => (s as unknown as typeof store).get() as unknown as IDBRequest<unknown>),
    ).rejects.toThrow('transaction aborted');
    expect(db.closeCalls).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// C9:本地图查找——query/hash 剥离、未解码原串重试、文件名索引兜底(Obsidian 短链接 /
// md 在子目录时的 `./`、`../` 相对路径)。用手写的假 FileSystemDirectoryHandle 树驱动。
// ---------------------------------------------------------------------------

interface FakeFileH {
  kind: 'file';
  name: string;
  path: string;
  getFile(): Promise<File>;
}
interface FakeDirH {
  kind: 'directory';
  name: string;
  children: Map<string, FakeDirH | FakeFileH>;
  getDirectoryHandle(n: string): Promise<FakeDirH>;
  getFileHandle(n: string): Promise<FakeFileH>;
  values(): AsyncIterable<FakeDirH | FakeFileH>;
}

/** 列举计数器:断言索引「每次导入只建一次」。 */
let listCalls = 0;

function fakeDir(name: string): FakeDirH {
  const children = new Map<string, FakeDirH | FakeFileH>();
  const notFound = () => Object.assign(new Error(`NotFoundError: ${name}`), { name: 'NotFoundError' });
  return {
    kind: 'directory',
    name,
    children,
    async getDirectoryHandle(n) {
      const c = children.get(n);
      if (!c || c.kind !== 'directory') throw notFound();
      return c;
    },
    async getFileHandle(n) {
      const c = children.get(n);
      if (!c || c.kind !== 'file') throw notFound();
      return c;
    },
    values() {
      listCalls += 1;
      const list = [...children.values()];
      return (async function* gen() {
        for (const c of list) yield c;
      })();
    },
  };
}

/** 按路径列表建一棵假 vault 树;getFile() 返回带 path 标记的假 File,便于断言命中了哪一个。 */
function makeVault(rootName: string, files: string[]): FileSystemDirectoryHandle {
  const root = fakeDir(rootName);
  for (const f of files) {
    const segs = f.split('/');
    let dir = root;
    for (const seg of segs.slice(0, -1)) {
      let next = dir.children.get(seg);
      if (!next) {
        next = fakeDir(seg);
        dir.children.set(seg, next);
      }
      dir = next as FakeDirH;
    }
    const name = segs[segs.length - 1]!;
    dir.children.set(name, {
      kind: 'file',
      name,
      path: f,
      getFile: async () => ({ name, path: f }) as unknown as File,
    });
  }
  return root as unknown as FileSystemDirectoryHandle;
}

const hitPath = (f: File | null): string | null => (f ? (f as unknown as { path: string }).path : null);

describe('stripQueryHash', () => {
  it('剥掉 ?query 与 #hash', () => {
    expect(stripQueryHash('img/a.png?v=2')).toBe('img/a.png');
    expect(stripQueryHash('a.png#center')).toBe('a.png');
    expect(stripQueryHash('a.png?x=1#y')).toBe('a.png');
  });

  it('编码过的 %3F/%23 属于文件名,不剥', () => {
    expect(stripQueryHash('a%23b.png')).toBe('a%23b.png');
  });
});

describe('splitLocalPath(decode=false)', () => {
  it('不解码:字面 %xx 原样保留', () => {
    expect(splitLocalPath('img/100%25.png', false)).toEqual(['img', '100%25.png']);
  });

  it('不解码时安全闸同样生效', () => {
    expect(splitLocalPath('../x.png', false)).toBeNull();
    expect(splitLocalPath('/abs.png', false)).toBeNull();
  });
});

describe('pickFromIndex', () => {
  const index = new Map<string, string[][]>([
    ['a.png', [['notes', 'deep', 'img', 'a.png'], ['img', 'a.png'], ['x', 'y', 'a.png']]],
  ]);

  it('同名多个取路径最短者(Obsidian 规则)', () => {
    expect(pickFromIndex(index, ['a.png'])).toEqual(['img', 'a.png']);
  });

  it('多段 tail 只认以 tail 结尾的候选', () => {
    expect(pickFromIndex(index, ['y', 'a.png'])).toEqual(['x', 'y', 'a.png']);
    expect(pickFromIndex(index, ['zzz', 'a.png'])).toBeNull();
  });

  it('索引里没有该文件名 → null', () => {
    expect(pickFromIndex(index, ['b.png'])).toBeNull();
  });
});

describe('buildVaultNameIndex', () => {
  it('跳过隐藏目录与 node_modules', async () => {
    const root = makeVault('v', ['.obsidian/a.png', 'node_modules/pkg/a.png', '.trash/a.png', 'att/a.png']);
    const index = await buildVaultNameIndex(root);
    expect(index.get('a.png')).toEqual([['att', 'a.png']]);
  });

  it('超过深度上限的目录不收录', async () => {
    const deep = `${Array.from({ length: VAULT_INDEX_MAX_DEPTH }, (_, i) => `d${i}`).join('/')}/deep.png`;
    const root = makeVault('v', [deep, 'd0/shallow.png']);
    const index = await buildVaultNameIndex(root);
    expect(index.has('shallow.png')).toBe(true);
    expect(index.has('deep.png')).toBe(false);
  });
});

describe('resolveLocalFile(C9)', () => {
  beforeEach(() => {
    clearVaultIndexCache();
    listCalls = 0;
  });

  it('根 + 相对路径直读命中(不建索引)', async () => {
    const root = makeVault('v', ['assets/x.png']);
    expect(hitPath(await resolveLocalFile(root, 'assets/x.png', 'v'))).toBe('assets/x.png');
    expect(listCalls).toBe(0);
  });

  it('Obsidian 短链接(仅文件名)→ 在 attachments/ 里找到', async () => {
    const root = makeVault('v', ['attachments/x.png', 'notes/a.md']);
    expect(hitPath(await resolveLocalFile(root, 'x.png', 'v'))).toBe('attachments/x.png');
  });

  it('同名多个取路径最短者', async () => {
    const root = makeVault('v', ['a/b/c/x.png', 'att/x.png']);
    expect(hitPath(await resolveLocalFile(root, 'x.png', 'v'))).toBe('att/x.png');
  });

  it('md 在子目录时的 ./img/a.png → 在 notes/img/a.png 找到', async () => {
    const root = makeVault('v', ['notes/post.md', 'notes/img/a.png']);
    expect(hitPath(await resolveLocalFile(root, './img/a.png', 'v'))).toBe('notes/img/a.png');
  });

  it('../assets/a.png(md 在子目录)按尾部段在 vault 内匹配', async () => {
    const root = makeVault('v', ['notes/post.md', 'assets/a.png', 'other/a.png']);
    expect(hitPath(await resolveLocalFile(root, '../assets/a.png', 'v'))).toBe('assets/a.png');
  });

  it('多段且非 ./ 开头的路径不走索引(避免把错误目录的同名图误认)', async () => {
    const root = makeVault('v', ['real/a.png']);
    expect(await resolveLocalFile(root, 'wrong/a.png', 'v')).toBeNull();
    expect(listCalls).toBe(0);
  });

  it('剥 ?query / #hash 后再查', async () => {
    const root = makeVault('v', ['img/a.png']);
    expect(hitPath(await resolveLocalFile(root, 'img/a.png?v=2', 'v'))).toBe('img/a.png');
    expect(hitPath(await resolveLocalFile(root, 'img/a.png#center', 'v'))).toBe('img/a.png');
  });

  it('文件名本身含 # 时,剥离后读不到会回退原串', async () => {
    const root = makeVault('v', ['img/a#1.png']);
    expect(hitPath(await resolveLocalFile(root, 'img/a#1.png', 'v'))).toBe('img/a#1.png');
  });

  it('解码后读不到 → 用未解码原串重试(文件名含字面 %xx)', async () => {
    const root = makeVault('v', ['img/100%25.png']);
    expect(hitPath(await resolveLocalFile(root, 'img/100%25.png', 'v'))).toBe('img/100%25.png');
  });

  it('URL 编码的短链接经解码后命中索引', async () => {
    const root = makeVault('v', ['att/a b.png']);
    expect(hitPath(await resolveLocalFile(root, 'a%20b.png', 'v'))).toBe('att/a b.png');
  });

  it('首段 == 文件夹名时剥首段(原有 Obsidian vault 规则保持)', async () => {
    const root = makeVault('myvault', ['img.png']);
    expect(hitPath(await resolveLocalFile(root, 'myvault/img.png', 'myvault'))).toBe('img.png');
  });

  it('同一 cacheKey 下多次查找只建一次索引;clearVaultIndexCache 后重建', async () => {
    const root = makeVault('v', ['att/x.png', 'att/y.png']);
    await Promise.all([
      resolveLocalFile(root, 'x.png', 'v', 'active'),
      resolveLocalFile(root, 'y.png', 'v', 'active'),
    ]);
    const afterFirst = listCalls;
    expect(afterFirst).toBe(2); // 根 + att 两个目录各列举一次
    await resolveLocalFile(root, 'x.png', 'v', 'active');
    expect(listCalls).toBe(afterFirst);
    clearVaultIndexCache();
    await resolveLocalFile(root, 'x.png', 'v', 'active');
    expect(listCalls).toBe(afterFirst * 2);
  });

  it('非法路径(绝对路径)仍被拒,且不走索引', async () => {
    const root = makeVault('v', ['etc/passwd']);
    expect(await resolveLocalFile(root, '/etc/passwd', 'v')).toBeNull();
    expect(listCalls).toBe(0);
  });

  it('跨作用域两层分开:先在所有作用域直读,active 的索引模糊命中不遮蔽 persistent 的精确路径', async () => {
    const active = makeVault('a', ['att/x.png']);
    const persistent = makeVault('p', ['x.png']);
    const roots = [
      { handle: active, cacheKey: 'active' },
      { handle: persistent, cacheKey: 'persistent' },
    ];
    expect(hitPath(await resolveAcrossRoots(roots, 'x.png'))).toBe('x.png');
    // 都无精确路径时才回落索引,仍按作用域优先级(active 先)
    expect(hitPath(await resolveAcrossRoots(roots, 'att/x.png'))).toBe('att/x.png');
    expect(hitPath(await resolveAcrossRoots([roots[0]!, { handle: makeVault('q', ['z/y.png']), cacheKey: 'persistent' }], 'y.png'))).toBe('z/y.png');
  });
});
