/**
 * 纯净领域模型：阅读与渲染相关数据结构（零外部依赖）
 */

export interface RenderPosition {
  chapterIndex: number;
  progress: number;
  percentage?: number | string;
  text?: string;
  location?: any;
}

export interface Chapter {
  index: number;
  label: string;
  href: string;
  subitems?: Chapter[];
}

export interface NoteRange {
  key?: string;
  chapterIndex: number;
  range: string;
  text: string;
  color: string;
  notes?: string;
  tag?: string[];
  date?: string;
}

export interface RenderTargetOptions {
  containerId?: string;
  mode?: "slide" | "scroll";
}
