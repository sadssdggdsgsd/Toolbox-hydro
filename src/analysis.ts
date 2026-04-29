import * as d3 from 'd3-contour';
import { Source, AnalysisResult } from './types';

const EARTH_RADIUS = 6371000; // meters

export function getDistance(p1: [number, number], p2: [number, number]): number {
  const dLat = (p2[0] - p1[0]) * 111132;
  const dLon = (p2[1] - p1[1]) * 111132 * Math.cos(p1[0] * Math.PI / 180);
  return Math.sqrt(dLat * dLat + dLon * dLon);
}

export function getCostAt(sources: Record<string, Source>, target: [number, number]): number {
  const sourceList = Object.values(sources).filter(s => s.enabled);
  let totalCost = 0;

  for (const source of sourceList) {
    let fixedDist = 0;
    let currP = source.loc;
    for (const node of source.nodes) {
      fixedDist += getDistance(currP, node);
      currP = node;
    }
    totalCost += (fixedDist + getDistance(currP, target)) * source.cost * source.weight;
  }

  return totalCost;
}

export function runAnalysis(sources: Record<string, Source>): AnalysisResult {
  const sourceList = Object.values(sources).filter(s => s.enabled);
  
  if (sourceList.length === 0) {
    return {
      bestLoc: [62.5, 16.7], // Default to center if nothing enabled
      minVal: 0,
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

  const res = 200; // Increased for smoother contours
  const gridLats = Array.from({ length: res }, (_, i) => minLat - margin + (i * 2 * margin) / (res - 1));
  const gridLons = Array.from({ length: res }, (_, i) => minLon - margin + (i * 2 * margin) / (res - 1));

  const costData = new Float64Array(res * res);
  let minCost = Infinity;
  let bestIdx = [0, 0];

  for (let r = 0; r < res; r++) {
    for (let c = 0; c < res; c++) {
      const lat = gridLats[r];
      const lon = gridLons[c];
      let totalCost = 0;

      for (const source of sourceList) {
        let fixedDist = 0;
        let currP = source.loc;
        for (const node of source.nodes) {
          fixedDist += getDistance(currP, node);
          currP = node;
        }
        totalCost += (fixedDist + getDistance(currP, [lat, lon])) * source.cost * source.weight;
      }

      costData[r * res + c] = totalCost;
      if (totalCost < minCost) {
        minCost = totalCost;
        bestIdx = [r, c];
      }
    }
  }

  // Calculate suitability (inverse of cost for contouring)
  const suitability = costData.map(v => -v);
  const sortedSuit = [...suitability].sort((a, b) => a - b);
  
  const p995 = sortedSuit[Math.floor(sortedSuit.length * 0.995)];
  const p9975 = sortedSuit[Math.floor(sortedSuit.length * 0.9975)];
  const p999 = sortedSuit[Math.floor(sortedSuit.length * 0.999)];

  const thresholds = [p995, p9975, p999];
  const colors = ['#ffff00', '#ffaa00', '#ff5500'];

  const generator = d3.contours()
    .size([res, res])
    .thresholds(thresholds);

  const contours = generator(Array.from(suitability));

  const getLat = (idx: number) => minLat - margin + (idx * 2 * margin) / (res - 1);
  const getLon = (idx: number) => minLon - margin + (idx * 2 * margin) / (res - 1);

  const contourData = contours.map((c, i) => ({
    level: i,
    threshold: -thresholds[i],
    color: colors[i],
    polygons: c.coordinates.map(polygon => 
      polygon.map(ring => 
        ring.map(point => [
          getLat(point[1]), 
          getLon(point[0])
        ] as [number, number])
      )
    )
  }));

  return {
    bestLoc: [getLat(bestIdx[0]), getLon(bestIdx[1])],
    minVal: minCost,
    contourData,
    thresholds: {
      inner: -p999,
      middle: -p9975,
      outer: -p995
    }
  };
}
