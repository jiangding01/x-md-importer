// 第二批 I1:文件夹授权浮层按界面语言出文案。
import { describe, expect, it } from 'vitest';
import { folderOverlayText } from './folderOverlayText';
import { messageLang } from './protocol';

describe('folderOverlayText', () => {
  it('英文界面:三种场景均为英文', () => {
    expect(folderOverlayText('en', 'restore', 'Vault').title).toBe('MarkFlow · Restore access to “Vault”');
    expect(folderOverlayText('en', 'active', null).pick).toBe('Choose folder');
    expect(folderOverlayText('en', 'persistent', null).cancel).toBe('Cancel');
  });
  it('中文文案与此前硬编码一致(行为不变)', () => {
    expect(folderOverlayText('zh', 'restore', '笔记').title).toBe('MarkFlow · 恢复访问「笔记」');
    expect(folderOverlayText('zh', 'active', null).title).toBe('MarkFlow · 连接当前文章图片文件夹');
    expect(folderOverlayText('zh', 'persistent', null).pick).toBe('选择文件夹');
  });
});

describe('messageLang', () => {
  it('仅 en 认作英文;缺省 / 非法回落 zh(旧 sidepanel 兼容)', () => {
    expect(messageLang({ lang: 'en' })).toBe('en');
    expect(messageLang({ lang: 'zh' })).toBe('zh');
    expect(messageLang({})).toBe('zh');
    expect(messageLang({ lang: 'fr' })).toBe('zh');
    expect(messageLang(null)).toBe('zh');
  });
});
