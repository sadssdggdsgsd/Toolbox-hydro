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

export interface AnalysisResult {
  bestLoc: [number, number];
  minVal: number;
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
