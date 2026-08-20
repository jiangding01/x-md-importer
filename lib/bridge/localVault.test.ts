// splitLocalPath —— 本地图片路径安全器单测,以及 idbRun 的错误路径单测(B4-7/P2-18)。
// splitLocalPath 是纯函数;idbRun 触达 indexedDB,用下面的假 IDBDatabase/IDBTransaction
// 驱动(不依赖真实 indexedDB/fake-indexeddb 包)。saveVaultHandle/getVaultHandle 等其余
// 导出仍不在本文件测试范围(它们只是 idbRun 的薄封装,行为已被 idbRun 的用例覆盖)。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { idbRun, splitLocalPath } from './localVault';

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
