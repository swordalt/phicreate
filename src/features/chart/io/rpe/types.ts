// RPE (PhiEdit) chart JSON. See https://teamflos.github.io/phira-docs/chart-standard/chart-format/rpe/root.html

export type RpeBeat = [number, number, number];

export interface RpeEvent<T = number> {
  startTime: RpeBeat;
  endTime: RpeBeat;
  start: T;
  end: T;
  easingType?: number;
  easingLeft?: number;
  easingRight?: number;
  bezier?: number | boolean;
  bezierPoints?: number[];
  linkgroup?: number;
}

export interface RpeEventLayer {
  moveXEvents?: RpeEvent[];
  moveYEvents?: RpeEvent[];
  rotateEvents?: RpeEvent[];
  alphaEvents?: RpeEvent[];
  speedEvents?: RpeEvent[];
}

export interface RpeExtended {
  scaleXEvents?: RpeEvent[];
  scaleYEvents?: RpeEvent[];
  textEvents?: RpeEvent<string>[];
  // RGB 0-255; colors the line, its text or its texture.
  colorEvents?: RpeEvent<[number, number, number]>[];
  // GIF progress 0-1.
  gifEvents?: RpeEvent[];
}

export interface RpeNote {
  type: number; // 1 tap, 2 hold, 3 flick, 4 drag
  startTime: RpeBeat;
  endTime: RpeBeat;
  positionX?: number;
  above?: number;
  isFake?: number | boolean;
  speed?: number;
  alpha?: number;
  size?: number;
  yOffset?: number;
  visibleTime?: number;
  tint?: [number, number, number];
  color?: [number, number, number];
}

export interface RpeJudgeLine {
  Name?: string;
  Group?: number;
  father?: number;
  rotateWithFather?: boolean;
  isCover?: number;
  zOrder?: number;
  anchor?: [number, number];
  attachUI?: string;
  // Image file; 'line.png' = default line.
  Texture?: string;
  isGif?: boolean | number;
  bpmfactor?: number;
  numOfNotes?: number;
  eventLayers?: (RpeEventLayer | null)[];
  extended?: RpeExtended;
  notes?: RpeNote[];
}

export interface RpeMeta {
  RPEVersion?: number;
  id?: string;
  name?: string;
  composer?: string;
  charter?: string;
  illustration?: string;
  level?: string;
  offset?: number;
  song?: string;
  background?: string;
}

// rpe-next noise area (block area): RPE units and beats, segment events per axis.
export interface RpeNoiseEvent extends RpeEvent {
  // Rotate / scale pivot.
  anchor?: { x: number; y: number };
  // Values the relative transform starts / ends from (default `start` / `end`).
  transformStart?: number;
  transformEnd?: number;
  transformStep?: boolean;
  inst?: number | boolean;
}

export interface RpeNoiseArea {
  Name?: string;
  bottomLeft?: { x: number; y: number };
  topRight?: { x: number; y: number };
  appearTime?: RpeBeat;
  disappearTime?: RpeBeat;
  // `readyFlash` in seconds (a bool in older files).
  activeIntervals?: { startTime: RpeBeat; endTime: RpeBeat; readyFlash?: number | boolean }[];
  isInvert?: boolean;
  moveXEvents?: RpeNoiseEvent[];
  moveYEvents?: RpeNoiseEvent[];
  rotateEvents?: RpeNoiseEvent[];
  scaleXEvents?: RpeNoiseEvent[];
  scaleYEvents?: RpeNoiseEvent[];
}

export interface RpeChart {
  META?: RpeMeta;
  blockAreaList?: RpeNoiseArea[];
  BlockAreaList?: RpeNoiseArea[];
  BPMList?: { bpm: number; startTime: RpeBeat }[];
  judgeLineGroup?: string[];
  judgeLineList: RpeJudgeLine[];
  timeTags?: { name: string; time: RpeBeat }[];
}

// Image file shown instead of the line, if any.
export const rpeTexture = (line: RpeJudgeLine) =>
  line.Texture && line.Texture !== 'line.png' ? line.Texture : null;

export const isRpeChart = (data: unknown): data is RpeChart =>
  !!data && Array.isArray((data as RpeChart).judgeLineList);
