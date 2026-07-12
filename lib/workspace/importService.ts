/**
 * 导入执行服务。
 * Phase B 为 mock 时序（移植自设计稿 stages()/startImport），真实注入引擎在 M1 接入
 * ——保持 runImport / ImportController 接口不变，届时仅替换实现。
 */

export interface StageLabels {
  parse: string;
  preflight: string;
  body: string;
  blocks: string;
  images: string;
  final: string;
}

export interface ImportStage {
  label: string;
  dur: number;
}

/** 依据图片数与写入节奏构建阶段序列。 */
export function buildStages(labels: StageLabels, imageCount: number, fast: boolean): ImportStage[] {
  const f = fast ? 0.55 : 1;
  const stages: ImportStage[] = [
    { label: labels.parse, dur: 400 * f },
    { label: labels.preflight, dur: 450 * f },
    { label: labels.body, dur: 750 * f },
    { label: labels.blocks, dur: 650 * f },
  ];
  for (let i = 0; i < imageCount; i += 1) {
    stages.push({ label: `${labels.images} ${i + 1}/${imageCount}`, dur: 480 * f });
  }
  stages.push({ label: labels.final, dur: 380 * f });
  return stages;
}

export interface ImportHandlers {
  onProgress: (stageIdx: number, pct: number, label: string) => void;
  onDone: () => void;
}

export interface ImportController {
  cancel: () => void;
}

/** 逐阶段推进；返回可取消的控制器。 */
export function runImport(stages: ImportStage[], handlers: ImportHandlers): ImportController {
  let idx = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancelled = false;

  const step = () => {
    if (cancelled) return;
    if (idx >= stages.length) {
      handlers.onDone();
      return;
    }
    const stage = stages[idx]!;
    const pct = Math.round(((idx + 1) / stages.length) * 100);
    handlers.onProgress(idx, pct, stage.label);
    idx += 1;
    timer = setTimeout(step, stage.dur);
  };

  step();

  return {
    cancel() {
      cancelled = true;
      if (timer) clearTimeout(timer);
    },
  };
}
