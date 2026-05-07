
import { getDistance } from './analysis';

export interface ElevationPoint {
  distance: number;
  elevation: number;
  lat: number;
  lon: number;
}

/**
 * Samples points along a polyline to create a smooth elevation profile
 */
export function samplePoints(path: [number, number][], numPoints: number = 30): [number, number][] {
  if (path.length < 2) return path;

  // Calculate total distance and cumulative distances
  const segmentDistances: number[] = [];
  let totalDist = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const d = getDistance(path[i], path[i + 1]);
    segmentDistances.push(d);
    totalDist += d;
  }

  const sampled: [number, number][] = [path[0]];
  const step = totalDist / (numPoints - 1);

  for (let i = 1; i < numPoints - 1; i++) {
    const targetDist = i * step;
    let accumulated = 0;
    
    for (let j = 0; j < segmentDistances.length; j++) {
      if (accumulated + segmentDistances[j] >= targetDist) {
        // Interpolate within this segment
        const segmentProgress = (targetDist - accumulated) / segmentDistances[j];
        const p1 = path[j];
        const p2 = path[j + 1];
        
        const lat = p1[0] + (p2[0] - p1[0]) * segmentProgress;
        const lon = p1[1] + (p2[1] - p1[1]) * segmentProgress;
        sampled.push([lat, lon]);
        break;
      }
      accumulated += segmentDistances[j];
    }
  }

  sampled.push(path[path.length - 1]);
  return sampled;
}

/**
 * Fetches elevation data for a list of coordinates using Open Topo Data
 */
export async function fetchElevationData(path: [number, number][]): Promise<ElevationPoint[]> {
  const sampled = samplePoints(path);
  const lats = sampled.map(p => p[0]).join(',');
  const lons = sampled.map(p => p[1]).join(',');
  
  try {
    // Adding models=best_available ensures it works above 60°N (e.g. Northern Sweden)
    const response = await fetch(`https://elevation-api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lons}&models=best_available`);
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.reason || 'Elevation API failed');
    }
    
    const data = await response.json();
    
    if (!data.elevation || !Array.isArray(data.elevation)) {
      throw new Error('Invalid data format from elevation API');
    }
    
    let cumulativeDist = 0;
    const points: ElevationPoint[] = data.elevation.map((elev: number, i: number) => {
      if (i > 0) {
        cumulativeDist += getDistance(sampled[i-1], sampled[i]);
      }
      return {
        distance: Math.round(cumulativeDist),
        elevation: elev,
        lat: sampled[i][0],
        lon: sampled[i][1]
      };
    });
    
    return points;
  } catch (err) {
    console.error('Error fetching elevation:', err);
    throw err;
  }
}
