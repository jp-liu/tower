export interface GridPreset {
  id: string;
  label: string;
  cols: number;
  rows: number;
  minHeight: string;
}

export const GRID_PRESETS: GridPreset[] = [
  { id: "1x1", label: "1\u00d71", cols: 1, rows: 1, minHeight: "480px" },
  { id: "2x1", label: "2\u00d71", cols: 2, rows: 1, minHeight: "480px" },
  { id: "2x2", label: "2\u00d72", cols: 2, rows: 2, minHeight: "300px" },
  { id: "3x2", label: "3\u00d72", cols: 3, rows: 2, minHeight: "300px" },
  { id: "4x2", label: "4\u00d72", cols: 4, rows: 2, minHeight: "240px" },
  { id: "3x3", label: "3\u00d73", cols: 3, rows: 3, minHeight: "240px" },
];

export const DEFAULT_PRESET_ID = "2x2";
