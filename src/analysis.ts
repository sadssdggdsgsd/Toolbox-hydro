import * as d3 from 'd3-contour';
import { Source, AnalysisResult, CostBreakdown } from './types';

const EARTH_RADIUS = 6371000; // meters

export function getDistance(p1: [number, number], p2: [number, number]): number {
  const avgLat = (p1[0] + p2[0]) / 2;
  const radLat = avgLat * Math.PI / 180;
  // More accurate meters per degree constants
  const mLat = 111132.92 - 559.82 * Math.cos(2 * radLat) + 1.175 * Math.cos(4 * radLat);
  const mLon = 111412.84 * Math.cos(radLat) - 93.5 * Math.cos(3 * radLat);

  const dLat = (p2[0] - p1[0]) * mLat;
  const dLon = (p2[1] - p1[1]) * mLon;
  return Math.sqrt(dLat * dLat + dLon * dLon);
}

export function getCostAt(sources: Record<string, Source>, target: [number, number]): { total: number; breakdown: CostBreakdown; detailedBreakdown?: Record<string, { total: number; segments: { dist: number; cost: number; weight: number }[] }> } {
  let totalCost = 0;
  const breakdown: CostBreakdown = {};
  const detailedBreakdown: Record<string, { total: number; segments: { dist: number; cost: number; weight: number }[] }> = {};

  for (const [id, source] of Object.entries(sources)) {
    if (!source.enabled) continue;
    if (source.isSplit && source.splitNodeIndex !== undefined && source.nodes.length > source.splitNodeIndex) {
      // Segment B: Source -> ... -> SplitPoint (Dark Blue)
      let distB = 0;
      let currB = source.loc;
      for (let i = 0; i <= source.splitNodeIndex; i++) {
        distB += getDistance(currB, source.nodes[i]);
        currB = source.nodes[i];
      }
      const costB = distB * (source.splitCost ?? 0) * (source.splitWeight ?? 0);

      // Segment A: SplitPoint -> ... -> Target (Light Blue)
      let distA = 0;
      let currA = source.nodes[source.splitNodeIndex];
      for (let i = source.splitNodeIndex + 1; i < source.nodes.length; i++) {
        distA += getDistance(currA, source.nodes[i]);
        currA = source.nodes[i];
      }
      distA += getDistance(currA, target);
      const costA = distA * source.cost * source.weight;

      const totalSourceCost = costA + costB;
      totalCost += totalSourceCost;
      breakdown[id] = totalSourceCost;
      detailedBreakdown[id] = {
        total: totalSourceCost,
        segments: [
          { dist: distA, cost: source.cost, weight: source.weight },
          { dist: distB, cost: source.splitCost ?? 0, weight: source.splitWeight ?? 0 }
        ]
      };
    } else {
      let fixedDist = 0;
      let currP = source.loc;
      for (const node of source.nodes) {
        fixedDist += getDistance(currP, node);
        currP = node;
      }
      const dist = fixedDist + getDistance(currP, target);
      const sourceCost = dist * source.cost * source.weight;
      totalCost += sourceCost;
      breakdown[id] = sourceCost;
      detailedBreakdown[id] = {
        total: sourceCost,
        segments: [{ dist, cost: source.cost, weight: source.weight }]
      };
    }
  }

  return { total: totalCost, breakdown, detailedBreakdown };
}

export function runAnalysis(sources: Record<string, Source>): AnalysisResult {
  const sourceList = Object.values(sources).filter(s => s.enabled);
  
  if (sourceList.length === 0) {
    return {
      bestLoc: [62.5, 16.7], // Default to center if nothing enabled
      minVal: 0,
      breakdown: {},
      contourData: [],
      thresholds: { inner: 0, middle: 0, outer: 0 }
    };
  }

  const lats = sourceList.flatMap(s => [s.loc[0], ...s.nodes.map(n => n[0])]);
  const lons = sourceList.flatMap(s => [s.loc[1], ...s.nodes.map(n => n[1])]);

  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);

  const latSpan = maxLat - minLat;
  const lonSpan = maxLon - minLon;
  const margin = Math.max(latSpan, lonSpan, 0.1);

  const res = 250; // Higher resolution for better centering
  const gridLats = Array.from({ length: res }, (_, i) => minLat - margin + (i * 2 * margin) / (res - 1));
  const gridLons = Array.from({ length: res }, (_, i) => minLon - margin + (i * 2 * margin) / (res - 1));

  const costData = new Float64Array(res * res);
  let minCost = Infinity;
  let bestIdx = [0, 0];

  for (let r = 0; r < res; r++) {
    for (let c = 0; c < res; c++) {
      const lat = gridLats[r];
      const lon = gridLons[c];
      
      const { total: totalCost } = getCostAt(sources, [lat, lon]);

      costData[r * res + c] = totalCost;
      if (totalCost < minCost) {
        minCost = totalCost;
        bestIdx = [r, c];
      }
    }
  }

  // Refine Sweet Spot using simple center-of-mass around the minimum to avoid grid stepping
  let sumLat = 0;
  let sumLon = 0;
  let sumWeight = 0;
  for (let dr = -2; dr <= 2; dr++) {
    for (let dc = -2; dc <= 2; dc++) {
      const r = bestIdx[0] + dr;
      const c = bestIdx[1] + dc;
      if (r >= 0 && r < res && c >= 0 && c < res) {
        const val = costData[r * res + c];
        // Weight by inverse of distance from minCost (quadratic to favor center)
        const weight = Math.pow(minCost / val, 10); 
        sumLat += gridLats[r] * weight;
        sumLon += gridLons[c] * weight;
        sumWeight += weight;
      }
    }
  }

  const bestLoc: [number, number] = [sumLat / sumWeight, sumLon / sumWeight];
  
  // Calculate suitability (inverse of cost for contouring)
  const suitability = costData.map(v => -v);
  const sortedSuit = [...suitability].sort((a, b) => a - b);
  
  const p995 = sortedSuit[Math.floor(sortedSuit.length * 0.995)];
  const p9975 = sortedSuit[Math.floor(sortedSuit.length * 0.9975)];
  const p999 = sortedSuit[Math.floor(sortedSuit.length * 0.999)];

  const thresholds = [p995, p9975, p999];
  const colors = ['#6366f1', '#f59e0b', '#10b981'];

  const generator = d3.contours()
    .size([res, res])
    .thresholds(thresholds);

  const contours = generator(Array.from(suitability));

  const getLat = (idx: number) => minLat - margin + (idx * 2 * margin) / (res - 1);
  const getLon = (idx: number) => minLon - margin + (idx * 2 * margin) / (res - 1);

  const contourData = contourDataMapper(contours, colors, thresholds, getLat, getLon);

  const { total: finalMinCost, breakdown, detailedBreakdown } = getCostAt(sources, bestLoc);

  return {
    bestLoc,
    minVal: finalMinCost,
    breakdown,
    detailedBreakdown,
    contourData,
    thresholds: {
      inner: -p999,
      middle: -p9975,
      outer: -p995
    }
  };
}

function contourDataMapper(contours: any[], colors: string[], thresholds: number[], getLat: (i: number) => number, getLon: (i: number) => number) {
  return contours.map((c, i) => ({
    level: i,
    threshold: -thresholds[i],
    color: colors[i],
    polygons: c.coordinates.map((polygon: any) => 
      polygon.map((ring: any) => 
        ring.map((point: any) => [
          getLat(point[1]), 
          getLon(point[0])
        ] as [number, number])
      )
    )
  }));
}
