/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Source {
  name: string;
  loc: [number, number];
  color: string;
  cost: number;
  weight: number;
  nodes: [number, number][];
  enabled: boolean;
}

export type ActiveAction = 'move' | 'node' | null;

export interface CostBreakdown {
  [sourceName: string]: number;
}

export interface AnalysisResult {
  bestLoc: [number, number];
  minVal: number;
  breakdown: CostBreakdown;
  contourData: {
    level: number;
    polygons: [number, number][][][];
    color: string;
    threshold: number;
  }[];
  thresholds: {
    inner: number;
    middle: number;
    outer: number;
  };
}
