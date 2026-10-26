/**
 * X 页面上「连接本地图片文件夹」授权浮层的文案(第二批 I1)。此前在 content.ts 里硬编码中文,英文界面用户
 * 看到的也是中文浮层。content 拿不到侧边栏的语言偏好,由 connect-folder 请求带上 `lang`(见 protocol
 * messageLang,缺省回落中文,兼容旧侧边栏)。中文文案与此前逐字一致。
 */
export type FolderOverlayKind = 'restore' | 'active' | 'persistent';

export interface FolderOverlayText {
  title: string;
  desc: string;
  pick: string;
  cancel: string;
}

export function folderOverlayText(lang: 'zh' | 'en', kind: FolderOverlayKind, folderName: string | null): FolderOverlayText {
  if (lang === 'en') {
    return {
      title:
        kind === 'restore'
          ? `MarkFlow · Restore access to “${folderName ?? ''}”`
          : kind === 'active'
            ? 'MarkFlow · Connect the image folder for this article'
            : 'MarkFlow · Connect the default image folder',
      desc:
        kind === 'restore'
          ? 'Read access lapsed after the browser restarted. Click below to grant read access to the same folder again (read-only, nothing is changed) — no need to pick it again.'
          : kind === 'active'
            ? "Choose the folder that holds this article's images. Relative image paths are read from it first during import (read-only, nothing is changed). You can switch to another article's folder at any time."
            : "Choose a default folder for local images. Relative image paths are read from it when the article has no folder of its own (read-only, nothing is changed). You may need to reconnect after restarting the browser.",
      pick: kind === 'restore' ? 'Restore access' : 'Choose folder',
      cancel: 'Cancel',
    };
  }
  return {
    title:
      kind === 'restore'
        ? `MarkFlow · 恢复访问「${folderName ?? ''}」`
        : kind === 'active'
          ? 'MarkFlow · 连接当前文章图片文件夹'
          : 'MarkFlow · 连接默认图片文件夹',
    desc:
      kind === 'restore'
        ? '浏览器重启后读权限已回落。点击下方按钮重新授予对上次文件夹的读取(仅读取,不修改),无需重选。'
        : kind === 'active'
          ? '选择本篇文章图片所在的文件夹,导入时优先从中读取相对路径图片(仅读取,不修改)。可随时更换为其他文章的文件夹。'
          : '选择存放本地图片的默认文件夹,当前文章未单独连接时从中读取相对路径图片(仅读取,不修改)。重开浏览器后可能需要重新连接。',
    pick: kind === 'restore' ? '恢复访问' : '选择文件夹',
    cancel: '取消',
  };
}
