/**
 * 四套界面主题 · 逐值移植自设计稿 MarkFlow v3 的 skinVars()。
 * 每套主题 = 同一张 CSS 变量表的一组取值；切主题 = 整套替换 :root 上的变量。
 * 保真优先：此处数值不得随意改动，改动即偏离设计稿。
 */

export type Skin = 'minimal' | 'console' | 'paper' | 'glass';
export type ThemeMode = 'light' | 'dark' | 'system';
export type Accent = string;

export const SKINS: Skin[] = ['minimal', 'console', 'paper', 'glass'];

/** 每套主题支持的明暗档位：控制台固定暗色、纸感固定浅色。 */
export const skinMeta: Record<Skin, Exclude<ThemeMode, 'system'>[]> = {
  minimal: ['light', 'dark'],
  console: ['dark'],
  paper: ['light'],
  glass: ['light', 'dark'],
};

/** accent 点缀色候选（仅「极简」主题生效，其余主题点缀色固定）。 */
export const ACCENTS: Accent[] = ['#1D9BF0', '#0F766E', '#D97757', '#6D5AE6'];

const FONTS = {
  sans: "'Noto Sans SC',-apple-system,'PingFang SC','Microsoft YaHei',system-ui,sans-serif",
  disp: "'Space Grotesk','Noto Sans SC',-apple-system,'PingFang SC',system-ui,sans-serif",
  serif: "'Noto Serif SC','Songti SC','STSong',serif",
  mono: "'JetBrains Mono','SFMono-Regular',Consolas,monospace",
} as const;

export type ThemeVars = Record<`--${string}`, string>;

/** 解析某套主题在当前明暗下是否为暗色。 */
export function resolveDark(skin: Skin, theme: ThemeMode): boolean {
  const modes = skinMeta[skin];
  if (modes.length === 1) return modes[0] === 'dark';
  if (theme === 'system') {
    return typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : false;
  }
  return theme === 'dark';
}

/** 计算某套主题的完整 CSS 变量表。 */
export function skinVars(skin: Skin, dark: boolean, accent: Accent): ThemeVars {
  const F = FONTS;

  if (skin === 'console') {
    return {
      '--deskBg': 'linear-gradient(rgba(91,209,255,.03) 1px,transparent 1px) 0 0/100% 24px,#0B0E11',
      '--p': '#12161B',
      '--pBorder': 'rgba(233,240,246,.12)',
      '--p2': '#181E25',
      '--ink': '#E8EEF3',
      '--ink2': '#9AA7B2',
      '--ink3': '#4E5A64',
      '--line': 'rgba(233,240,246,.10)',
      '--lsoft': 'rgba(233,240,246,.055)',
      '--acc': '#5BD1FF',
      '--accInk': '#8FE0FF',
      '--accSoft': 'rgba(91,209,255,.10)',
      '--ok': '#3DDC97',
      '--warn': '#E0B05C',
      '--dgr': '#FF7B72',
      '--fUI': F.mono,
      '--fDisp': F.mono,
      '--fMono': F.mono,
      '--rEl': '4px',
      '--blur': 'blur(0px)',
      '--btnBg': '#5BD1FF',
      '--btnFg': '#0B0E11',
      '--btnR': '5px',
      '--btnShadow': 'none',
      '--tabBar': '#5BD1FF',
    };
  }

  if (skin === 'paper') {
    return {
      '--deskBg': '#E9DFCE',
      '--p': '#FBF6EC',
      '--pBorder': 'rgba(62,50,40,.22)',
      '--p2': '#F2EADA',
      '--ink': '#2B2420',
      '--ink2': '#6D5C4A',
      '--ink3': '#A08D74',
      '--line': 'rgba(62,50,40,.16)',
      '--lsoft': 'rgba(62,50,40,.08)',
      '--acc': '#B4552D',
      '--accInk': '#9C4423',
      '--accSoft': 'rgba(180,85,45,.10)',
      '--ok': '#4A7A44',
      '--warn': '#9A7226',
      '--dgr': '#A9422E',
      '--fUI': F.serif,
      '--fDisp': F.serif,
      '--fMono': F.mono,
      '--rEl': '5px',
      '--blur': 'blur(0px)',
      '--btnBg': '#B4552D',
      '--btnFg': '#FBF6EC',
      '--btnR': '4px',
      '--btnShadow': 'none',
      '--tabBar': '#B4552D',
    };
  }

  if (skin === 'glass') {
    return dark
      ? {
          '--deskBg':
            'radial-gradient(circle at 15% 20%,#28406B 0%,transparent 55%),radial-gradient(circle at 85% 15%,#43315F 0%,transparent 50%),radial-gradient(circle at 70% 90%,#1E4A40 0%,transparent 55%),#101420',
          '--p': 'rgba(22,28,42,.66)',
          '--pBorder': 'rgba(255,255,255,.14)',
          '--p2': 'rgba(255,255,255,.07)',
          '--ink': '#E8ECF5',
          '--ink2': 'rgba(232,236,245,.62)',
          '--ink3': 'rgba(232,236,245,.4)',
          '--line': 'rgba(255,255,255,.10)',
          '--lsoft': 'rgba(255,255,255,.06)',
          '--acc': '#6FB9F7',
          '--accInk': '#9CCEFA',
          '--accSoft': 'rgba(111,185,247,.14)',
          '--ok': '#4ECB92',
          '--warn': '#E3B96E',
          '--dgr': '#E58A8A',
          '--fUI': F.sans,
          '--fDisp': F.disp,
          '--fMono': F.mono,
          '--rEl': '10px',
          '--blur': 'blur(28px)',
          '--btnBg': 'linear-gradient(135deg,#1D9BF0,#6D5AE6)',
          '--btnFg': '#fff',
          '--btnR': '99px',
          '--btnShadow': '0 8px 20px -6px rgba(80,110,235,.55)',
          '--tabBar': '#6FB9F7',
        }
      : {
          '--deskBg':
            'radial-gradient(circle at 15% 20%,#BFD9F7 0%,transparent 55%),radial-gradient(circle at 85% 15%,#D7C8F5 0%,transparent 50%),radial-gradient(circle at 70% 90%,#BEE8DC 0%,transparent 55%),#E8ECF2',
          '--p': 'rgba(255,255,255,.6)',
          '--pBorder': 'rgba(255,255,255,.85)',
          '--p2': 'rgba(255,255,255,.6)',
          '--ink': '#1C2430',
          '--ink2': 'rgba(28,36,48,.62)',
          '--ink3': 'rgba(28,36,48,.42)',
          '--line': 'rgba(28,36,48,.10)',
          '--lsoft': 'rgba(28,36,48,.055)',
          '--acc': '#1D9BF0',
          '--accInk': '#1D6FD0',
          '--accSoft': 'rgba(29,155,240,.12)',
          '--ok': '#2BB673',
          '--warn': '#A87F2A',
          '--dgr': '#D45F5F',
          '--fUI': F.sans,
          '--fDisp': F.disp,
          '--fMono': F.mono,
          '--rEl': '10px',
          '--blur': 'blur(28px)',
          '--btnBg': 'linear-gradient(135deg,#1D9BF0,#6D5AE6)',
          '--btnFg': '#fff',
          '--btnR': '99px',
          '--btnShadow': '0 8px 20px -6px rgba(80,110,235,.55)',
          '--tabBar': '#1C2430',
        };
  }

  // minimal
  return dark
    ? {
        '--deskBg': 'radial-gradient(circle,rgba(233,235,238,.05) 1px,transparent 1px) 0 0/22px 22px,#0A0B0D',
        '--p': '#15181C',
        '--pBorder': 'rgba(233,235,238,.10)',
        '--p2': '#1C2026',
        '--ink': '#E9EBEE',
        '--ink2': '#9AA1A9',
        '--ink3': '#5F666E',
        '--line': 'rgba(233,235,238,.10)',
        '--lsoft': 'rgba(233,235,238,.055)',
        '--acc': accent,
        '--accInk': `color-mix(in oklab,${accent},white 24%)`,
        '--accSoft': `color-mix(in oklab,${accent},transparent 86%)`,
        '--ok': '#3DB874',
        '--warn': '#D9A94E',
        '--dgr': '#E07070',
        '--fUI': F.sans,
        '--fDisp': F.disp,
        '--fMono': F.mono,
        '--rEl': '8px',
        '--blur': 'blur(0px)',
        '--btnBg': '#E9EBEE',
        '--btnFg': '#15181C',
        '--btnR': '99px',
        '--btnShadow': 'none',
        '--tabBar': '#E9EBEE',
      }
    : {
        '--deskBg': 'radial-gradient(circle,rgba(25,27,31,.055) 1px,transparent 1px) 0 0/22px 22px,#ECE9E2',
        '--p': '#FBFAF9',
        '--pBorder': 'rgba(25,27,31,.12)',
        '--p2': '#F2F0EB',
        '--ink': '#191B1F',
        '--ink2': '#70767E',
        '--ink3': '#A6ABB2',
        '--line': 'rgba(25,27,31,.10)',
        '--lsoft': 'rgba(25,27,31,.055)',
        '--acc': accent,
        '--accInk': `color-mix(in oklab,${accent},black 16%)`,
        '--accSoft': `color-mix(in oklab,${accent},transparent 88%)`,
        '--ok': '#1B9A50',
        '--warn': '#B07E22',
        '--dgr': '#C95454',
        '--fUI': F.sans,
        '--fDisp': F.disp,
        '--fMono': F.mono,
        '--rEl': '8px',
        '--blur': 'blur(0px)',
        '--btnBg': '#191B1F',
        '--btnFg': '#FBFAF9',
        '--btnR': '99px',
        '--btnShadow': 'none',
        '--tabBar': '#191B1F',
      };
}

/** 把一组主题变量写到 :root 上。 */
export function applyThemeVars(vars: ThemeVars): void {
  const root = document.documentElement.style;
  for (const [key, val] of Object.entries(vars)) {
    root.setProperty(key, val);
  }
}

/** 设置页主题四宫格的迷你预览色（移植自设计稿 skinSwatch）。 */
export const skinSwatch: Record<Skin, { desk: string; panel: string; pBorder: string; dot: string }> = {
  minimal: { desk: '#ECE9E2', panel: '#FBFAF9', pBorder: 'rgba(25,27,31,.16)', dot: '#1D9BF0' },
  console: { desk: '#0B0E11', panel: '#161B21', pBorder: 'rgba(233,240,246,.22)', dot: '#5BD1FF' },
  paper: { desk: '#E9DFCE', panel: '#FBF6EC', pBorder: 'rgba(62,50,40,.28)', dot: '#B4552D' },
  glass: {
    desk: 'radial-gradient(circle at 20% 25%,#BFD9F7,transparent 60%),radial-gradient(circle at 80% 75%,#D7C8F5,transparent 60%),#E8ECF2',
    panel: 'rgba(255,255,255,.72)',
    pBorder: 'rgba(255,255,255,.95)',
    dot: '#1D9BF0',
  },
};
