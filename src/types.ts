// Core domain types for the recipe-builder editor.

export type ToolId =
  | 'exposure'
  | 'contrast'
  | 'highlights'
  | 'shadows'
  | 'temperature'
  | 'tint'
  | 'saturation'
  | 'vibrance';

// A recipe is the set of tool values the photographer dialed in.
export type Recipe = Record<ToolId, number>;

export interface ToolDef {
  id: ToolId;
  label: string; // Hebrew label
  min: number;
  max: number;
  step: number;
  default: number;
}

export interface Photo {
  id: string;
  name: string;
  url: string; // object URL to the local file
  recipe: Recipe; // the recipe currently applied to this photo
}
