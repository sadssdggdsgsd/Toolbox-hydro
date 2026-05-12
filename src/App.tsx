/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from 'react';
import { 
  MapContainer, 
  TileLayer, 
  WMSTileLayer,
  Marker, 
  CircleMarker, 
  Polyline, 
  Polygon,
  Tooltip, 
  useMapEvents,
  GeoJSON
} from 'react-leaflet';
import L from 'leaflet';
import { 
  Plus, 
  Target,
  RotateCcw,
  Info,
  MapPin,
  Map,
  LandPlot,
  Minus,
  Layers,
  Undo2,
  X,
  Move,
  MousePointer2,
  ChevronDown,
  Settings2,
  Trash2,
  Lock,
  Unlock,
  Scissors,
  Split,
  ZoomIn,
  ZoomOut
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Source, ActiveAction, AnalysisResult } from './types';
import { runAnalysis, getCostAt, getDistance } from './analysis';

// Basemap options
type BasemapKey = 'orto' | 'standard' | 'cyclosm';

const BASEMAPS: Record<BasemapKey, { 
  name: string; 
  url: string; 
  attribution: string;
  type: 'tile' | 'wms';
  layers?: string;
}> = {
  orto: {
    name: 'Orto',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri',
    type: 'tile'
  },
  standard: {
    name: 'Karta',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap',
    type: 'tile'
  },
  cyclosm: {
    name: 'CyclOSM',
    url: 'https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',
    attribution: '&copy; CyclOSM',
    type: 'tile'
  }
};

// Fix for default marker icons in Leaflet + Vite
// @ts-expect-error - images are handled by vite
import icon from 'leaflet/dist/images/marker-icon.png';
// @ts-expect-error - images are handled by vite
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

const DefaultIcon = L.icon({
  iconUrl: icon,
  shadowUrl: iconShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});
L.Marker.prototype.options.icon = DefaultIcon;

const INITIAL_SOURCES: Record<string, Source> = {
    'Tekniskt vatten': {
    name: 'Tekniskt vatten',
    loc: [62.559033, 16.791220],
    color: '#0ea5e9', // cyan-500
    cost: 2000,
    weight: 1.0,
    nodes: [],
    enabled: true,
    isSplit: false,
    splitNodeIndex: 0,
    splitCost: 2000,
    splitWeight: 1.0
  },
  'Vatten-VA': {
    name: 'Vatten-VA',
    loc: [62.520967, 16.791220],
    color: '#22c55e', // green-500
    cost: 2000,
    weight: 1.0,
    nodes: [],
    enabled: true
  },
  'El': {
    name: 'El',
    loc: [62.520967, 16.708780],
    color: '#ef4444', // red-500
    cost: 2000,
    weight: 1.0,
    nodes: [],
    enabled: true
  },
  'Väg': {
    name: 'Väg',
    loc: [62.559033, 16.708780],
    color: '#8b5cf6', // violet-500
    cost: 2000,
    weight: 1.0,
    nodes: [],
    enabled: true
  }
};

const COST_TEMPLATES: Record<string, { label: string; subLabel: string; costLabel: string; value: number; hasDivider?: boolean }[]> = {
  'El': [
    { label: '1 – 10 MW', subLabel: '10 - 24 kV', costLabel: '1 200 kr/m', value: 1200 },
    { label: '10 – 50 MW', subLabel: '24 - 130 kV', costLabel: '8 000 kr/m', value: 8000 },
    { label: '50 – 200 MW', subLabel: '130 kV', costLabel: '20 000 kr/m', value: 20000 },
    { label: '200 – 1000 MW', subLabel: '130 - 400 kV', costLabel: '30 000 kr/m', value: 30000 },
  ],
  'Väg': [
    { label: 'Enkel industriväg', subLabel: '6-7 m bred, asfalt', costLabel: '20 000 kr/m', value: 20000 },
    { label: 'Tung industriväg', subLabel: '8 m bred, förstärkt bärighet', costLabel: '50 000 kr/m', value: 50000 },
    { label: 'Logistikled', subLabel: '10-12 m bred, svängradier', costLabel: '100 000 kr/m', value: 100000 },
  ],
  'Vatten-VA': [
    { label: 'Standard', subLabel: 'DN 110 – 160 mm', costLabel: '5 000 kr/m', value: 5000 },
    { label: 'Utökad', subLabel: 'DN 200 – 250 mm', costLabel: '10 000 kr/m', value: 10000 },
    { label: 'Huvudledning', subLabel: 'DN 315 – 450 mm', costLabel: '15 000 kr/m', value: 15000 },
    { label: 'Magistral', subLabel: 'DN 500 – 800+ mm', costLabel: '30 000 kr/m', value: 30000 },
  ],
  'Tekniskt vatten': [
    { label: 'Lågt behov', subLabel: '< 200 m³/dygn', costLabel: '3 000 kr/m', value: 3000 },
    { label: 'Måttligt behov', subLabel: '200 – 1 000 m³/dygn', costLabel: '7 000 kr/m', value: 7000 },
    { label: 'Högt behov', subLabel: '1 000 – 4 000 m³/dygn', costLabel: '15 000 kr/m', value: 15000 },
    { label: 'Mycket högt behov', subLabel: '5 000 – 25 000 m³/dygn', costLabel: '30 000 kr/m', value: 30000 },
    { label: 'Sjöledning', subLabel: '200 – 1 000 m³/dygn', costLabel: '5 000 kr/m', value: 5000, hasDivider: true },
  ]
};

const CUSTOM_THEMES = [
  {
    id: 'orange',
    color: '#ea580c',
    card: 'border-orange-100 bg-orange-50/30',
    title: 'text-orange-700',
    action: 'bg-orange-600',
    track: 'bg-orange-200',
    btnBorder: 'border-orange-200',
    btnText: 'text-orange-600',
    btnHover: 'hover:bg-orange-50',
    costTagBg: 'bg-orange-50',
    ring: 'focus:ring-orange-200'
  },
  {
    id: 'pink',
    color: '#db2777',
    card: 'border-pink-100 bg-pink-50/30',
    title: 'text-pink-700',
    action: 'bg-pink-600',
    track: 'bg-pink-200',
    btnBorder: 'border-pink-200',
    btnText: 'text-pink-600',
    btnHover: 'hover:bg-pink-50',
    costTagBg: 'bg-pink-50',
    ring: 'focus:ring-pink-200'
  },
  {
    id: 'emerald',
    color: '#059669',
    card: 'border-emerald-100 bg-emerald-50/30',
    title: 'text-emerald-700',
    action: 'bg-emerald-600',
    track: 'bg-emerald-200',
    btnBorder: 'border-emerald-200',
    btnText: 'text-emerald-600',
    btnHover: 'hover:bg-emerald-50',
    costTagBg: 'bg-emerald-50',
    ring: 'focus:ring-emerald-200'
  },
  {
    id: 'amber',
    color: '#d97706',
    card: 'border-amber-100 bg-amber-50/30',
    title: 'text-amber-700',
    action: 'bg-amber-600',
    track: 'bg-amber-200',
    btnBorder: 'border-amber-200',
    btnText: 'text-amber-600',
    btnHover: 'hover:bg-amber-50',
    costTagBg: 'bg-amber-50',
    ring: 'focus:ring-amber-200'
  },
  {
    id: 'fuchsia',
    color: '#c026d3',
    card: 'border-fuchsia-100 bg-fuchsia-50/30',
    title: 'text-fuchsia-700',
    action: 'bg-fuchsia-600',
    track: 'bg-fuchsia-200',
    btnBorder: 'border-fuchsia-200',
    btnText: 'text-fuchsia-600',
    btnHover: 'hover:bg-fuchsia-100',
    costTagBg: 'bg-fuchsia-50',
    ring: 'focus:ring-fuchsia-200'
  },
  {
    id: 'rose',
    color: '#e11d48',
    card: 'border-rose-100 bg-rose-50/30',
    title: 'text-rose-700',
    action: 'bg-rose-600',
    track: 'bg-rose-200',
    btnBorder: 'border-rose-200',
    btnText: 'text-rose-600',
    btnHover: 'hover:bg-rose-50',
    costTagBg: 'bg-rose-50',
    ring: 'focus:ring-rose-200'
  }
];

const getSourceTheme = (name: string, data?: Source) => {
  if (data?.isCustom) {
    // Find theme by color
    const theme = CUSTOM_THEMES.find(t => t.color === data.color) || CUSTOM_THEMES[0];
    return theme;
  }
  switch (name) {
    case 'Tekniskt vatten':
      return {
        card: 'border-cyan-100 bg-cyan-50/30',
        title: 'text-cyan-700',
        action: 'bg-cyan-500',
        track: 'bg-cyan-200',
        btnBorder: 'border-cyan-200',
        btnText: 'text-cyan-600',
        btnHover: 'hover:bg-cyan-100',
        costTagBg: 'bg-cyan-50'
      };
    case 'Vatten-VA':
      return {
        card: 'border-green-100 bg-green-50/30',
        title: 'text-green-700',
        action: 'bg-green-500',
        track: 'bg-green-200',
        btnBorder: 'border-green-200',
        btnText: 'text-green-600',
        btnHover: 'hover:bg-green-100',
        costTagBg: 'bg-green-50'
      };
    case 'El':
      return {
        card: 'border-red-100 bg-red-50/30',
        title: 'text-red-700',
        action: 'bg-red-500',
        track: 'bg-red-200',
        btnBorder: 'border-red-200',
        btnText: 'text-red-600',
        btnHover: 'hover:bg-red-100',
        costTagBg: 'bg-red-50'
      };
    case 'Väg':
      return {
        card: 'border-violet-100 bg-violet-50/30',
        title: 'text-violet-700',
        action: 'bg-violet-500',
        track: 'bg-violet-200',
        btnBorder: 'border-violet-200',
        btnText: 'text-violet-600',
        btnHover: 'hover:bg-violet-100',
        costTagBg: 'bg-violet-50'
      };
    default:
      return {
        card: 'border-slate-100 bg-slate-50/30',
        title: 'text-slate-700',
        action: 'bg-slate-500',
        track: 'bg-slate-200',
        btnBorder: 'border-slate-200',
        btnText: 'text-slate-600',
        btnHover: 'hover:bg-slate-100',
        costTagBg: 'bg-slate-50'
      };
  }
};

function MapClickHandler({ 
  activeSource, 
  activeAction, 
  placingTestLocation,
  isRelocatingSweetSpot,
  onAction,
  onPlaceTest,
  onRelocate
}: { 
  activeSource: string | null; 
  activeAction: ActiveAction;
  placingTestLocation: boolean;
  isRelocatingSweetSpot: boolean;
  onAction: (latlng: [number, number]) => void;
  onPlaceTest: (latlng: [number, number]) => void;
  onRelocate: (latlng: [number, number]) => void;
}) {
  useMapEvents({
    click(e) {
      if (placingTestLocation) {
        onPlaceTest([e.latlng.lat, e.latlng.lng]);
      } else if (isRelocatingSweetSpot) {
        onRelocate([e.latlng.lat, e.latlng.lng]);
      } else if (activeSource && activeAction) {
        onAction([e.latlng.lat, e.latlng.lng]);
      }
    },
  });
  return null;
}

interface MapLayer {
  id: string;
  name: string;
  url: string;
  type: 'wms' | 'feature';
  layers?: string;
  format?: string;
  transparent?: boolean;
  opacity: number;
  enabled: boolean;
}

const SOIL_COLORS: Record<string, string> = {
  'Morän': '#B0C4DE',
  'Berg': '#FFC0CB',
  'Lera': '#DEB887',
  'Sand': '#F0E68C',
  'Torv': '#8B4513',
  'Gyttja': '#8FBC8F',
  'Silt': '#D2B48C',
  'Grus': '#A9A9A9',
  'Isälvssediment': '#87CEEB',
  'Postglacial sand': '#EEE8AA',
  'Glacial lera': '#BC8F8F',
};

function JordarterAPILayer({ enabled, opacity, url }: { enabled: boolean; opacity: number; url: string; key?: string }) {
  const [data, setData] = useState<any>(null);
  
  const map = useMapEvents({
    moveend: () => {
      if (enabled) {
        fetchData();
      }
    }
  });

  const fetchData = async () => {
    const zoom = map.getZoom();
    // Only fetch at high zoom because the dataset is too heavy for the detailed maps
    // For 1M map we can afford slightly lower zoom
    const minZoom = url.includes('1miljon') ? 8 : 13;
    
    if (zoom < minZoom) {
      setData(null);
      return;
    }

    const bounds = map.getBounds();
    const bbox = `${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`;
    const fetchUrl = `${url}?bbox=${bbox}&limit=500&f=json`;

    try {
      const response = await fetch(fetchUrl);
      const geojson = await response.json();
      setData(geojson);
    } catch (err) {
      console.error("Error fetching Jordarter API:", err);
    }
  };

  useEffect(() => {
    if (enabled) {
      fetchData();
    } else {
      setData(null);
    }
  }, [enabled, url]);

  if (!enabled || !data) return null;

  return (
    <GeoJSON 
      key={JSON.stringify(data.features?.[0]?.id || 'empty')}
      data={data} 
      style={(feature) => {
        const text = feature?.properties?.jg2_tx || '';
        let color = '#94a3b8';
        for (const [key, val] of Object.entries(SOIL_COLORS)) {
          if (text.includes(key)) {
            color = val;
            break;
          }
        }
        return {
          fillColor: color,
          fillOpacity: opacity,
          weight: 0.5,
          color: '#64748b',
          opacity: opacity * 0.5
        };
      }}
    />
  );
}

interface ScenarioData {
  sources: Record<string, Source>;
  testLocation: [number, number] | null;
  showTestLocation: boolean;
}

export default function App() {
  const [scenarios, setScenarios] = useState<Record<number, ScenarioData>>({ 
    1: { 
      sources: INITIAL_SOURCES, 
      testLocation: null, 
      showTestLocation: false 
    } 
  });
  const [activeScenario, setActiveScenario] = useState<number>(1);
  
  const currentScenario = scenarios[activeScenario] || { sources: {}, testLocation: null, showTestLocation: false };
  const sources = currentScenario.sources;
  const testLocation = currentScenario.testLocation;
  const showTestLocation = currentScenario.showTestLocation;

  const setSources = (updater: Record<string, Source> | ((prev: Record<string, Source>) => Record<string, Source>)) => {
    setScenarios(prev => ({
      ...prev,
      [activeScenario]: {
        ...prev[activeScenario],
        sources: typeof updater === 'function' ? updater(prev[activeScenario]?.sources || {}) : updater
      }
    }));
  };

  const updateAllScenariosSources = (updater: (prev: Record<string, Source>) => Record<string, Source>) => {
    setScenarios(prev => {
      const next = { ...prev };
      Object.keys(next).forEach(numStr => {
        const num = parseInt(numStr);
        next[num] = {
          ...next[num],
          sources: updater(next[num].sources)
        };
      });
      return next;
    });
  };

  const setTestLocation = (loc: [number, number] | null) => {
    setScenarios(prev => ({
      ...prev,
      [activeScenario]: {
        ...prev[activeScenario],
        testLocation: loc
      }
    }));
  };

  const setShowTestLocation = (show: boolean) => {
    setScenarios(prev => ({
      ...prev,
      [activeScenario]: {
        ...prev[activeScenario],
        showTestLocation: show
      }
    }));
  };

  const [activeSource, setActiveSource] = useState<string | null>(null);
  const [activeAction, setActiveAction] = useState<ActiveAction>(null);

  const removeScenario = (num: number) => {
    if (num === 1) return;
    setScenarios(prev => {
      const next = { ...prev };
      delete next[num];
      // If we deleted active, move back
      if (activeScenario === num) {
        setActiveScenario(num - 1);
      }
      return next;
    });
  };

  const analysis = useMemo(() => runAnalysis(sources), [sources]);

  const addScenario = () => {
    const existingIds = Object.keys(scenarios).map(Number);
    const nextScenario = Math.max(...existingIds) + 1;
    if (nextScenario > 3) return;

    // Use current active scenario as reference, or the highest existing one if adding Alt 3
    const refScenario = scenarios[activeScenario];
    const prevSources = refScenario.sources;
    const prevBest = analysis.bestLoc;
    
    const newSources: Record<string, Source> = {};
    // Offset angle: 20 degrees counter-clockwise for changes
    const angleOffset = -20;

    (Object.entries(prevSources) as [string, Source][]).forEach(([id, source]) => {
      // Calculate bearing from sweetspot to source
      // Use simple equirectangular approximation for bearing calculation near point
      const lat1 = prevBest[0] * Math.PI / 180;
      const lon1 = prevBest[1] * Math.PI / 180;
      const lat2 = source.loc[0] * Math.PI / 180;
      const lon2 = source.loc[1] * Math.PI / 180;
      
      const y = Math.sin(lon2 - lon1) * Math.cos(lat2);
      const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1);
      const bearing = Math.atan2(y, x) * 180 / Math.PI;

      // Apply offset to displacement bearing
      const jumpBearing = bearing + angleOffset;
      
      // Calculate new location 50m away from old location
      // Using 111111 as meters per degree lat approximation
      const dLat = (50 * Math.cos(jumpBearing * Math.PI / 180)) / 111111;
      const dLon = (50 * Math.sin(jumpBearing * Math.PI / 180)) / (111111 * Math.cos(source.loc[0] * Math.PI / 180));
      
      newSources[id] = {
        ...source,
        loc: [source.loc[0] + dLat, source.loc[1] + dLon],
        nodes: [] // Reset nodes as they might not make sense in new location
      };
    });

    setScenarios(prev => ({
      ...prev,
      [nextScenario]: {
        sources: newSources,
        testLocation: testLocation, // Inherit current test location
        showTestLocation: showTestLocation
      }
    }));
    setActiveScenario(nextScenario);
  };

  const getComparisonScenario = () => {
    if (activeScenario === 1) return null;
    return activeScenario - 1;
  };

  const comparisonScenario = getComparisonScenario();
  const comparisonSources = comparisonScenario ? scenarios[comparisonScenario]?.sources : null;
  
  // Analysis for comparison scenario
  const comparisonAnalysis = useMemo(() => 
    comparisonSources ? runAnalysis(comparisonSources) : null
  , [comparisonSources]);

  const [placingTestLocation, setPlacingTestLocation] = useState(false);
  const [basemap, setBasemap] = useState<BasemapKey>('orto');
  const [openTemplateMenu, setOpenTemplateMenu] = useState<string | null>(null);
  const [showLayerMenu, setShowLayerMenu] = useState(false);
  const [wmsLayers, setWmsLayers] = useState<MapLayer[]>([
    {
      id: 'jordarter-25-100',
      name: 'Jordarter 1:25k - 1:100k (SGU)',
      url: 'https://api.sgu.se/oppnadata/jordarter25k-100k/ogc/features/v1/collections/grundlager/items',
      type: 'feature',
      opacity: 0.5,
      enabled: false
    },
    {
      id: 'jordarter-250',
      name: 'Jordarter 1:250k (SGU)',
      url: 'https://api.sgu.se/oppnadata/jordarter250k/ogc/features/v1/collections/grundlager/items',
      type: 'feature',
      opacity: 0.5,
      enabled: false
    },
    {
      id: 'jordarter-1m',
      name: 'Jordarter 1:1miljon (SGU)',
      url: 'https://api.sgu.se/oppnadata/jordarter1miljon/ogc/features/v1/collections/grundlager/items',
      type: 'feature',
      opacity: 0.5,
      enabled: false
    },
    {
      id: 'natura2000',
      name: 'Natura 2000 (Länsstyrelsen)',
      url: 'https://vic-wms.lansstyrelsen.se/arcgis/services/sk_skyddadeomraden_wms_extern/MapServer/WMSServer',
      type: 'wms',
      layers: '6,7',
      format: 'image/png',
      transparent: true,
      opacity: 0.6,
      enabled: false
    },
    {
      id: 'naturreservat',
      name: 'Naturreservat (Länsstyrelsen)',
      url: 'https://vic-wms.lansstyrelsen.se/arcgis/services/sk_skyddadeomraden_wms_extern/MapServer/WMSServer',
      type: 'wms',
      layers: '0',
      format: 'image/png',
      transparent: true,
      opacity: 0.6,
      enabled: false
    }
  ]);
  
  // Visibility states
  const [mapInstance, setMapInstance] = useState<L.Map | null>(null);
  const [showSweetSpot, setShowSweetSpot] = useState(true);
  const [isRelocatingSweetSpot, setIsRelocatingSweetSpot] = useState(false);
  const [uiScale, setUiScale] = useState(1);

  // Remove duplicate analysis declaration

  const sourceDistances = useMemo(() => {
    const dists: Record<string, number> = {};
    const target = testLocation || analysis.bestLoc;
    (Object.entries(sources) as [string, Source][]).forEach(([id, data]) => {
      let dist = 0;
      let curr = data.loc;
      for (const node of data.nodes) {
        dist += getDistance(curr, node);
        curr = node;
      }
      dist += getDistance(curr, target);
      dists[id] = dist;
    });
    return dists;
  }, [sources, analysis.bestLoc, testLocation]);

  const testLocationResult = useMemo(() => {
    if (!testLocation) return null;
    return getCostAt(sources, testLocation);
  }, [sources, testLocation]);

  const allScenariosAtTestLocation = useMemo(() => {
    if (!testLocation) return null;
    const results: Record<number, ReturnType<typeof getCostAt>> = {};
    Object.keys(scenarios).forEach(numStr => {
      const num = parseInt(numStr);
      results[num] = getCostAt(scenarios[num].sources, testLocation);
    });
    return results;
  }, [scenarios, testLocation]);

  const updateSource = (name: string, updates: Partial<Source>) => {
    setSources(prev => ({
      ...prev,
      [name]: { ...prev[name], ...updates }
    }));
  };

  const addNode = (name: string, loc: [number, number]) => {
    setSources(prev => ({
      ...prev,
      [name]: { ...prev[name], nodes: [...prev[name].nodes, loc] }
    }));
  };

  const undoNode = (name: string) => {
    setSources(prev => {
      const source = prev[name];
      if (source.nodes.length === 0) return prev;
      return {
        ...prev,
        [name]: { ...source, nodes: source.nodes.slice(0, -1) }
      };
    });
  };

  const clearNodes = (name: string) => {
    updateSource(name, { nodes: [] });
  };

  const updateWmsLayer = (id: string, updates: Partial<MapLayer>) => {
    setWmsLayers(prev => prev.map(layer => 
      layer.id === id ? { ...layer, ...updates } : layer as MapLayer
    ));
  };

  const nextTheme = useMemo(() => {
    const customSources = (Object.values(sources) as Source[]).filter(s => s.isCustom);
    const themeIndex = customSources.length % CUSTOM_THEMES.length;
    return CUSTOM_THEMES[themeIndex];
  }, [sources]);

  const addCustomSource = () => {
    const customSources = (Object.values(sources) as Source[]).filter(s => s.isCustom);
    if (customSources.length >= 3) return;

    const id = `custom-${Date.now()}`;
    const theme = nextTheme;

    // Position 3000m at 90, 180, 270 degrees from sweetspot
    const currentLat = analysis.bestLoc[0];
    const currentLon = analysis.bestLoc[1];
    
    const dLat = 3000 / 111320;
    const dLon = 3000 / (111320 * Math.cos(currentLat * Math.PI / 180));
    
    let offset: [number, number] = [0, 0];
    const count = customSources.length; // 0, 1, 2
    
    if (count === 0) { // 90 deg -> East
      offset = [0, dLon];
    } else if (count === 1) { // 180 deg -> South
      offset = [-dLat, 0];
    } else if (count === 2) { // 270 deg -> West
      offset = [0, -dLon];
    }

    const newSource: Source = {
      name: 'Ny källa',
      loc: [currentLat + offset[0], currentLon + offset[1]],
      color: theme.color,
      cost: 2000,
      weight: 1.0,
      nodes: [],
      enabled: true,
      isCustom: true
    };
    
    updateAllScenariosSources(prev => ({ ...prev, [id]: newSource }));
    setActiveSource(id);
    setActiveAction('move');
  };

  const removeSource = (id: string) => {
    updateAllScenariosSources(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    
    if (activeSource === id) {
      setActiveSource(null);
      setActiveAction(null);
    }
  };

  const handleMapAction = (latlng: [number, number]) => {
    if (activeSource && activeAction === 'node') {
      addNode(activeSource, latlng);
    }
  };

  const handleRelocate = (latlng: [number, number]) => {
    const currentSweetSpot = analysis.bestLoc;
    const deltaLat = latlng[0] - currentSweetSpot[0];
    const deltaLon = latlng[1] - currentSweetSpot[1];

    updateAllScenariosSources(prev => {
      const updatedSources: Record<string, Source> = {};
      (Object.entries(prev) as [string, Source][]).forEach(([name, source]) => {
        updatedSources[name] = {
          ...source,
          loc: [source.loc[0] + deltaLat, source.loc[1] + deltaLon],
          nodes: source.nodes.map(node => [node[0] + deltaLat, node[1] + deltaLon])
        };
      });
      return updatedSources;
    });

    if (testLocation) {
      setTestLocation([testLocation[0] + deltaLat, testLocation[1] + deltaLon]);
    }

    setIsRelocatingSweetSpot(false);
  };

  return (
    <div className="flex h-screen w-full bg-slate-100 text-slate-800 overflow-hidden font-sans">
      {/* Sidebar */}
      <aside 
        className="h-full border-r border-slate-200 bg-white flex flex-col z-[1001] shadow-lg transition-all duration-300 overflow-hidden"
        style={{ 
          width: `${320 * uiScale}px`,
          minWidth: `${320 * uiScale}px`
        }}
      >
        <div className="flex flex-col w-[320px] shrink-0" style={{ height: `${100 / uiScale}%`, transform: `scale(${uiScale})`, transformOrigin: 'top left' }}>
          <div className="p-6 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold tracking-tight text-slate-900 flex items-center gap-2 shrink-0">
              Sweetspotfinder
            </h1>
            <div className="flex-1 flex justify-center">
              <div className="flex gap-1 p-0.5">
              {/* Toggle Sweet Spot Button */}
              <button 
                onClick={() => setShowSweetSpot(!showSweetSpot)}
                className={`p-2 rounded-xl transition-all group relative ${
                  showSweetSpot 
                    ? 'bg-[#393F4C] text-white shadow-lg ring-2 ring-slate-200' 
                    : 'text-slate-400 hover:text-slate-600 hover:bg-white hover:shadow-sm'
                }`}
                title="Aktivera Sweet Spot"
              >
                <Target className="w-5 h-5" />
              </button>

              {/* Manual/Test Location Button */}
              <button 
                onClick={() => {
                  if (placingTestLocation || showTestLocation) {
                    setPlacingTestLocation(false);
                    setShowTestLocation(false);
                  } else {
                    setPlacingTestLocation(true);
                    setShowTestLocation(true);
                  }
                  setIsRelocatingSweetSpot(false);
                }}
                className={`p-2 rounded-xl transition-all group relative ${
                  (showTestLocation || placingTestLocation)
                    ? 'bg-[#4778A5] text-white shadow-lg ring-2 ring-blue-100' 
                    : 'text-slate-400 hover:text-slate-600 hover:bg-white hover:shadow-sm'
                }`}
                title="Aktivera Vald Plats"
              >
                <MapPin className={`w-5 h-5 ${placingTestLocation ? 'animate-pulse' : ''}`} />
              </button>

              {/* Relocate Everything Button */}
              <button 
                onClick={() => {
                  setIsRelocatingSweetSpot(!isRelocatingSweetSpot);
                  setPlacingTestLocation(false);
                }}
                className={`p-2 rounded-xl transition-all group relative ${
                  isRelocatingSweetSpot 
                    ? 'bg-[#6366f1] text-white shadow-lg ring-2 ring-indigo-100' 
                    : 'text-slate-400 hover:text-indigo-600 hover:bg-white hover:shadow-sm'
                }`}
                title="Flytta allt"
              >
                <Move className={`w-5 h-5 ${isRelocatingSweetSpot ? 'animate-pulse' : ''}`} />
              </button>
            </div>
          </div>
        </div>
      </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
          {/* Scenario Selection */}
          <div className="flex items-center justify-end gap-1 mb-4">
            {Object.keys(scenarios).sort().map(numStr => {
              const num = parseInt(numStr);
              return (
                <div key={num} className="relative group/scenario">
                  <button 
                    onClick={() => setActiveScenario(num)}
                    className={`w-6 h-6 rounded flex items-center justify-center text-[10px] font-black transition-all ${
                      activeScenario === num 
                      ? 'bg-slate-800 text-white shadow-sm' 
                      : 'bg-slate-200 text-slate-500 hover:bg-slate-300'
                    }`}
                  >
                    {num}
                  </button>
                  {num > 1 && (
                    <button 
                      onClick={(e) => { e.stopPropagation(); removeScenario(num); }}
                      className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover/scenario:opacity-100 transition-opacity transform hover:scale-110 z-10"
                    >
                      <X className="w-1.5 h-1.5" />
                    </button>
                  )}
                </div>
              );
            })}
            {Object.keys(scenarios).length < 3 && (
              <button 
                onClick={addScenario}
                className="w-4 h-4 rounded flex items-center justify-center bg-slate-100 text-slate-400 hover:bg-slate-200 transition-all ml-1"
                title="Lägg till alternativ"
              >
                <Plus className="w-2.5 h-2.5" />
              </button>
            )}
          </div>

          <div className="space-y-6">
            {/* Symmetric Source Rows */}
            {(Object.entries(sources) as [string, Source][]).map(([id, data]) => {
              const allScenarioNums = Object.keys(scenarios).map(n => parseInt(n)).sort();
              const activeCount = allScenarioNums.length;

              const renderSourceCard = (sid: string, sdata: Source | undefined, scenarioNum: number, isActive: boolean) => {
                if (!sdata) return (
                  <div 
                    key={`${sid}-${scenarioNum}`}
                    style={{ flex: activeCount === 1 ? 1 : (isActive ? (activeCount === 2 ? 2 : 3) : 1) }}
                    className="rounded-lg border bg-slate-100/50 opacity-20"
                  />
                );
                
                const stheme = getSourceTheme(sdata.name, sdata);
                
                // Dynamic flex weights based on active count requested: 
                // 2 scenarios -> active is 2x larger (flex 2:1)
                // 3 scenarios -> active is 200% larger (3x)
                const inactiveFlexVal = 1;
                const activeFlexVal = activeCount === 1 ? 1 : (activeCount === 2 ? 2 : 3);
                const currentFlex = isActive ? activeFlexVal : inactiveFlexVal;

                if (!isActive) {
                  return (
                    <div 
                      key={`${sid}-${scenarioNum}`}
                      style={{ flex: currentFlex }}
                      className={`rounded-lg border bg-white/30 opacity-40 transition-all min-w-0 flex flex-col overflow-hidden shadow-sm ${stheme.card}`}
                    >
                      {/* Name/Indicator Row (Header) */}
                      <div className={`h-6 w-full border-b border-black/5 flex items-center justify-center ${stheme.action} opacity-10`} />
                      
                      <div className="flex-1 flex flex-col justify-center">
                        {sdata.isSplit ? (
                          <div className="flex flex-col">
                            {/* Segment A */}
                            <div className="flex flex-col">
                              {/* A Marker - Aligned with active Segment A position */}
                              <div className="h-5 flex items-center justify-center border-b border-black/5">
                                <span className="text-[9px] font-black text-slate-500 uppercase">A</span>
                              </div>
                              <div className="h-8 flex flex-col justify-center items-center border-b border-black/5 bg-white/10">
                                <div className="text-[9px] font-black text-slate-300 uppercase leading-none">KR/M</div>
                                <div className="text-[11px] font-black font-mono text-slate-500 leading-none">{Math.round(sdata.cost)}</div>
                              </div>
                              <div className="h-8 flex flex-col justify-center items-center border-b border-black/5 bg-white/5">
                                <div className="text-[9px] font-black text-slate-300 uppercase leading-none">VIKT</div>
                                <div className="text-[11px] font-mono font-black text-slate-400 leading-none">{sdata.weight.toFixed(1)}</div>
                              </div>
                            </div>
                            {/* Segment B - Solid light gray background */}
                            <div className="flex flex-col bg-[#F1F1F1]">
                              <div className="h-5 flex items-center justify-center border-b border-black/5">
                                <span className="text-[9px] font-black text-slate-600 uppercase">B</span>
                              </div>
                              <div className="h-8 flex flex-col justify-center items-center border-b border-black/5">
                                <div className="text-[9px] font-black text-slate-300 uppercase leading-none">KR/M</div>
                                <div className="text-[11px] font-black font-mono text-slate-500 leading-none">{Math.round(sdata.splitCost ?? sdata.cost)}</div>
                              </div>
                              <div className="h-8 flex flex-col justify-center items-center">
                                <div className="text-[9px] font-black text-slate-300 uppercase leading-none">VIKT</div>
                                <div className="text-[11px] font-mono font-black text-slate-400 leading-none">{(sdata.splitWeight ?? sdata.weight).toFixed(1)}</div>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <>
                            {/* Cost Row (Top) */}
                            <div className="h-8 flex flex-col justify-center items-center px-1 border-b border-black/5 bg-white/20 space-y-0">
                              <div className="text-[9px] font-black text-slate-300 uppercase leading-tight">KR/M</div>
                              <div className="text-[11px] font-black font-mono text-slate-500 leading-none">{Math.round(sdata.cost)}</div>
                            </div>

                            {/* Weight Row (Middle) - Moved up and restructured */}
                            <div className="h-8 flex flex-col justify-center items-center px-1 bg-white/30 border-b border-black/5 space-y-0">
                              <div className="text-[9px] font-black text-slate-300 uppercase leading-tight">VIKT</div>
                              <div className="text-[11px] font-mono font-black text-slate-400 leading-none">{sdata.weight.toFixed(1)}</div>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  );
                }

                return (
                  <motion.div 
                    key={`${sid}-${scenarioNum}`}
                    style={{ flex: currentFlex }}
                    className={`p-3 rounded-xl border-2 transition-all min-w-0 shadow-md ${stheme.card} ${
                      activeSource === sid ? 'ring-2 ring-offset-2 ring-slate-200' : ''
                    } ${!sdata.enabled ? 'opacity-50 saturate-0' : ''}`}
                  >
                    <div className="flex items-center justify-between h-8 mb-2 pb-1.5 border-b border-black/5">
                      <div className="flex items-center gap-1.5 flex-1 min-w-0">
                        <button 
                          onClick={() => updateSource(sid, { enabled: !sdata.enabled })}
                          className={`w-6 h-3 rounded-full relative transition-colors shrink-0 ${sdata.enabled ? stheme.action : 'bg-slate-300'}`}
                        >
                          <div className={`absolute top-0.5 w-2 h-2 bg-white rounded-full transition-all ${sdata.enabled ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
                        </button>
                        {sdata.isCustom ? (
                          <input 
                            type="text" 
                            value={sdata.name}
                            onChange={(e) => updateSource(id, { name: e.target.value })}
                            className={`font-black text-[11px] bg-transparent border-none focus:outline-none focus:ring-1 rounded px-1 w-full ${(stheme as any).ring || 'focus:ring-slate-300'} ${stheme.title}`}
                          />
                        ) : (
                          <h3 className={`font-black text-[11px] truncate ${stheme.title}`}>{sdata.name}</h3>
                        )}
                      </div>
                      {(sdata.name === 'Tekniskt vatten' || sdata.isCustom) && (
                        <button 
                          onClick={() => updateSource(sid, { isSplit: !sdata.isSplit, splitNodeIndex: sdata.splitNodeIndex ?? Math.floor(sdata.nodes.length / 2), splitCost: sdata.splitCost ?? sdata.cost, splitWeight: sdata.splitWeight ?? sdata.weight })}
                          className={`w-6 h-6 flex items-center justify-center rounded transition-all shrink-0 ${sdata.isSplit ? `bg-blue-900 shadow-sm text-white` : 'bg-white border border-slate-200 text-slate-400 hover:text-slate-600'}`}
                          title="Split"
                        >
                          <Scissors className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {sdata.isCustom && (
                        <button 
                          onClick={() => removeSource(sid)}
                          className={`p-1 rounded-md border transition-all ${stheme.btnBorder} ${stheme.btnText} ${stheme.btnHover} hover:text-red-500`}
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                      )}
                    </div>

                    {/* Segment A (or Main) Controls */}
                     <div className={`space-y-1.5 mb-2 border-b border-black/5 -mx-3 px-3 pb-2 ${sdata.isSplit ? 'bg-cyan-50/20' : ''}`}>
                        {sdata.isSplit && (
                          <div className="flex items-center justify-between pointer-events-none">
                             <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Segment A</span>
                          </div>
                        )}
                       <div className="flex items-center justify-between relative">
                         <div className="flex items-center gap-1">
                           <label className="text-[9px] text-slate-400 uppercase font-black tracking-tighter">Kr/m</label>
                           <div>
                             {COST_TEMPLATES[sdata.name] && (
                               <button 
                                 onClick={(e) => {
                                   e.stopPropagation();
                                   setOpenTemplateMenu(openTemplateMenu === sid ? null : sid);
                                 }}
                                 className="w-4 h-4 flex items-center justify-center text-slate-500 hover:text-slate-800 transition-colors bg-slate-100 rounded-md border border-slate-200 shadow-sm"
                               >
                                 <ChevronDown className="w-3 h-3 stroke-[3]" />
                               </button>
                             )}
                             {/* Cost Template Menu */}
                             <AnimatePresence>
                               {openTemplateMenu === sid && (
                                 <motion.div 
                                   initial={{ opacity: 0, y: -5, scale: 0.95 }}
                                   animate={{ opacity: 1, y: 0, scale: 1 }}
                                   exit={{ opacity: 0, y: -5, scale: 0.95 }}
                                   className={`absolute left-0 top-full mt-1 bg-white border ${stheme.btnBorder} rounded-xl shadow-xl z-[100] p-2 space-y-1 w-44`}
                                 >
                                   {COST_TEMPLATES[sdata.name]?.map((tmpl) => (
                                     <React.Fragment key={tmpl.label}>
                                       {tmpl.hasDivider && <div className="h-px bg-slate-100 my-1 mx-1" />}
                                       <button
                                         onClick={() => {
                                           updateSource(sid, { cost: tmpl.value });
                                           setOpenTemplateMenu(null);
                                         }}
                                         className={`w-full text-left p-2 ${stheme.btnHover} rounded-lg transition-colors group`}
                                       >
                                         <div className="flex justify-between items-center">
                                           <span className="text-[10px] font-black text-slate-800">{tmpl.label}</span>
                                           <span className={`text-[9px] font-mono font-bold ${stheme.btnText}`}>{tmpl.costLabel}</span>
                                         </div>
                                         <div className="text-[8px] text-slate-400 font-medium">{tmpl.subLabel}</div>
                                       </button>
                                     </React.Fragment>
                                   ))}
                                 </motion.div>
                               )}
                             </AnimatePresence>
                           </div>
                         </div>
                         <div className="flex items-center gap-1.5">
                            <label className="text-[9px] text-slate-400 uppercase font-black tracking-tighter">VIKT</label>
                            <span className="text-[11px] font-mono font-black text-slate-700 leading-none">{sdata.weight.toFixed(1)}</span>
                         </div>
                       </div>

                       <div className="flex items-center gap-2">
                         <input 
                           type="number" 
                           step="500"
                            value={sdata.cost}
                           onChange={(e) => updateSource(sid, { cost: parseInt(e.target.value) || 0 })}
                           className="w-20 text-[12px] p-0.5 border border-slate-200 rounded font-bold focus:ring-1 focus:ring-slate-300 outline-none h-8 px-2"
                         />
                         <div className={`${activeCount === 1 ? 'flex-1' : 'w-24'} flex items-center h-5 ${activeCount > 1 ? 'scale-90 origin-right' : ''}`}>
                           <input 
                             type="range" min="0.1" max="1" step="0.1" 
                             value={sdata.weight}
                             onChange={(e) => updateSource(sid, { weight: parseFloat(e.target.value) })}
                             className={`w-full h-0.5 rounded-lg appearance-none cursor-pointer transition-all ${stheme.track}`}
                           />
                         </div>
                       </div>
                    </div>

                    {/* Segment B Controls */}
                    {sdata.isSplit && (
                      <div className="mt-2 pt-2 mb-2 border-t border-black/5 -mx-3 px-3 pb-2 bg-blue-900/10 transition-all space-y-1.5">
                         <div className="flex items-center justify-between">
                            <span className="text-[9px] font-black text-slate-600 uppercase tracking-widest">Segment B</span>
                         </div>
                         
                         {/* Segment B Cost/Weight */}
                         <div className="flex items-center justify-between relative">
                            <div className="flex items-center gap-1">
                               <label className="text-[9px] text-slate-400 uppercase font-black tracking-tighter">Kr/m</label>
                               <div>
                                 {COST_TEMPLATES[sdata.name] && (
                                   <button 
                                     onClick={(e) => {
                                       e.stopPropagation();
                                       setOpenTemplateMenu(openTemplateMenu === sid + '-B' ? null : sid + '-B');
                                     }}
                                     className="w-4 h-4 flex items-center justify-center text-blue-900/50 hover:text-blue-900 transition-colors bg-blue-100 rounded-md border border-blue-200 shadow-sm"
                                   >
                                     <ChevronDown className="w-3 h-3 stroke-[3]" />
                                   </button>
                                 )}
                                 {/* Cost Template Menu for Segment B */}
                                 <AnimatePresence>
                                   {openTemplateMenu === sid + '-B' && (
                                     <motion.div 
                                       initial={{ opacity: 0, y: -5, scale: 0.95 }}
                                       animate={{ opacity: 1, y: 0, scale: 1 }}
                                       exit={{ opacity: 0, y: -5, scale: 0.95 }}
                                       className={`absolute left-0 top-full mt-1 bg-white border border-blue-200 rounded-xl shadow-xl z-[100] p-2 space-y-1 w-44`}
                                     >
                                       {COST_TEMPLATES[sdata.name]?.map((tmpl) => (
                                         <React.Fragment key={tmpl.label}>
                                           {tmpl.hasDivider && <div className="h-px bg-slate-100 my-1 mx-1" />}
                                           <button
                                             onClick={() => {
                                               updateSource(sid, { splitCost: tmpl.value });
                                               setOpenTemplateMenu(null);
                                             }}
                                             className={`w-full text-left p-2 hover:bg-blue-50 rounded-lg transition-colors group`}
                                           >
                                             <div className="flex justify-between items-center">
                                                <span className="text-[10px] font-black text-slate-800">{tmpl.label}</span>
                                                <span className={`text-[9px] font-mono font-bold text-blue-900`}>{tmpl.costLabel}</span>
                                             </div>
                                             <div className="text-[8px] text-slate-400 font-medium">{tmpl.subLabel}</div>
                                           </button>
                                         </React.Fragment>
                                       ))}
                                     </motion.div>
                                   )}
                                 </AnimatePresence>
                               </div>
                            </div>
                            <div className="flex items-center gap-1.5">
                               <label className="text-[9px] text-slate-400 uppercase font-black tracking-tighter">VIKT</label>
                               <span className="text-[11px] font-mono font-black text-blue-950 leading-none">{sdata.splitWeight?.toFixed(1) ?? sdata.weight.toFixed(1)}</span>
                            </div>
                         </div>
                         
                         <div className="flex items-center gap-2">
                            <input 
                              type="number" 
                              step="500"
                               value={sdata.splitCost ?? sdata.cost}
                              onChange={(e) => updateSource(sid, { splitCost: parseInt(e.target.value) || 0 })}
                              className="w-20 text-[12px] p-0.5 border border-blue-200 rounded font-bold focus:ring-1 focus:ring-blue-400 outline-none h-8 px-2 bg-white"
                            />
                            <div className={`${activeCount === 1 ? 'flex-1' : 'w-24'} flex items-center h-5 ${activeCount > 1 ? 'scale-90 origin-right' : ''}`}>
                              <input 
                                type="range" min="0.1" max="1" step="0.1" 
                                value={sdata.splitWeight ?? sdata.weight}
                                onChange={(e) => updateSource(sid, { splitWeight: parseFloat(e.target.value) })}
                                className="w-full h-0.5 rounded-lg appearance-none cursor-pointer accent-blue-900 bg-blue-200"
                              />
                            </div>
                         </div>

                         {/* Node Index Slider */}
                         <div className="pt-1.5 border-t border-blue-200/30">
                            <div className="flex items-center justify-between mb-1">
                               <span className="text-[7px] font-bold text-slate-500 uppercase">Välj split-nod</span>
                            </div>
                            <div className="flex items-center gap-2">
                               <input 
                                 type="range" 
                                 min="0" 
                                 max={Math.max(0, sdata.nodes.length - 1)} 
                                 step="1"
                                 value={sdata.splitNodeIndex ?? 0}
                                 onChange={(e) => updateSource(sid, { splitNodeIndex: parseInt(e.target.value) })}
                                 className="flex-1 h-1 bg-blue-200 rounded-lg appearance-none cursor-pointer accent-blue-700"
                               />
                               <span className="text-[9px] font-mono font-black text-blue-900 bg-blue-100 px-1.5 py-0.5 rounded min-w-[20px] text-center">
                                 {sdata.splitNodeIndex + 1}
                               </span>
                            </div>
                         </div>
                      </div>
                    )}

                    {/* Node Tool Row */}
                    <div className="flex gap-1 h-8 items-center">
                      <button
                        onClick={() => {
                          if (activeSource === sid && activeAction === 'node') {
                            setActiveSource(null);
                            setActiveAction(null);
                          } else {
                            setActiveSource(sid);
                            setActiveAction('node');
                          }
                        }}
                        className={`flex-1 h-6 text-[8px] font-black uppercase rounded transition-all ${
                          activeSource === sid && activeAction === 'node' 
                          ? `${stheme.action} text-white` 
                          : 'bg-white border border-slate-200 text-slate-500'
                        }`}
                      >
                        + NODER
                      </button>
                      <button onClick={() => undoNode(sid)} disabled={sdata.nodes.length === 0} className="w-6 h-6 bg-white border border-slate-200 rounded text-slate-400 hover:text-slate-600 disabled:opacity-30 flex items-center justify-center">
                        <Undo2 className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  </motion.div>
                );
              };

              return (
                <div key={id} className="flex gap-2 items-center">
                  <div className="flex flex-1 gap-1.5 items-stretch min-w-0">
                    {allScenarioNums.map(num => renderSourceCard(id, scenarios[num].sources[id], num, num === activeScenario))}
                  </div>
                </div>
              );
            })}
            
            <div className="flex justify-start py-4">
              {Object.values(sources).filter(s => (s as Source).isCustom).length < 3 ? (
                <motion.button
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  onClick={addCustomSource}
                  className={`w-14 h-7 flex items-center justify-center rounded-lg border-2 border-dashed transition-all group relative bg-white/50 ${nextTheme.btnBorder} ${nextTheme.btnText} hover:bg-white`}
                >
                  <Plus className="w-5 h-5 opacity-40 group-hover:opacity-100 transition-opacity" />
                  <span className={`absolute -bottom-5 left-1/2 -translate-x-1/2 text-[8px] font-black uppercase ${nextTheme.btnText} opacity-100 transition-opacity whitespace-nowrap`}>Lägg till källa</span>
                </motion.button>
              ) : (
                <div className="w-14 h-7 flex items-center justify-center rounded-lg border-2 border-dashed border-slate-100 bg-slate-50 opacity-50 cursor-not-allowed">
                  <Plus className="w-5 h-5 text-slate-300" />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Map Layers Control */}
        <div className="p-4 bg-slate-50 border-t border-slate-200">
          <div className="space-y-4">
            {/* Basemap Switcher & Layer Toggle */}
            <div className="relative">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <LandPlot className="w-3.5 h-3.5 text-slate-400" />
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Bakgrund</span>
                </div>
                
                {/* Layer Menu Trigger */}
                <button 
                  onClick={() => setShowLayerMenu(!showLayerMenu)}
                  title="Lager"
                  className={`w-6 h-6 flex items-center justify-center rounded-md border transition-all ${
                    showLayerMenu 
                      ? 'bg-indigo-600 text-white border-indigo-600' 
                      : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300 hover:bg-slate-50 shadow-sm'
                  }`}
                >
                  {showLayerMenu ? <X className="w-3.5 h-3.5" /> : <Layers className="w-3.5 h-3.5" />}
                </button>
              </div>

              <div className="grid grid-cols-3 gap-1">
                {(Object.entries(BASEMAPS) as [BasemapKey, typeof BASEMAPS['orto']][]).map(([key, config]) => (
                  <button
                    key={key}
                    onClick={() => setBasemap(key)}
                    className={`flex items-center justify-center py-1.5 px-0.5 text-[9px] font-bold rounded-lg transition-all ${
                      basemap === key 
                        ? 'bg-slate-800 text-white shadow-sm ring-1 ring-slate-800' 
                        : 'bg-white border border-slate-200 text-slate-500 hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    {config.name}
                  </button>
                ))}
              </div>

              {/* Layer Menu (AnimatePresence moved here) */}
              <AnimatePresence>
                {showLayerMenu && (
                  <motion.div
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    className="absolute bottom-full left-0 right-0 mb-2 p-3 bg-white rounded-xl shadow-2xl border border-slate-200 z-[2000]"
                  >
                    <div className="flex items-center justify-between mb-3 border-b border-slate-100 pb-2">
                      <span className="text-[11px] font-bold text-slate-700">Lager</span>
                      <button onClick={() => setShowLayerMenu(false)} className="text-slate-400 hover:text-slate-600">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="space-y-4 max-h-[300px] overflow-y-auto pr-1 custom-scrollbar">
                      {wmsLayers.map(layer => (
                        <div key={layer.id} className="space-y-2">
                          <div className="flex items-center justify-between">
                            <label className="flex items-center gap-2 cursor-pointer group">
                              <div className={`w-3.5 h-3.5 rounded border transition-all flex items-center justify-center ${
                                layer.enabled ? 'bg-indigo-600 border-indigo-600' : 'border-slate-300'
                              }`}>
                                <input 
                                  type="checkbox" 
                                  className="hidden" 
                                  checked={layer.enabled}
                                  onChange={(e) => updateWmsLayer(layer.id, { enabled: e.target.checked })}
                                />
                                {layer.enabled && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
                              </div>
                              <span className={`text-[11px] font-medium transition-colors ${
                                layer.enabled ? 'text-slate-900' : 'text-slate-400'
                              }`}>
                                {layer.name}
                              </span>
                            </label>
                          </div>
                          
                          {layer.enabled && (
                            <div className="pl-5 space-y-1">
                              <div className="flex items-center justify-between">
                                <span className="text-[9px] text-slate-400 uppercase font-bold">Transparens</span>
                                <span className="text-[9px] font-mono text-slate-500">{Math.round(layer.opacity * 100)}%</span>
                              </div>
                              <input 
                                type="range" 
                                min="0" 
                                max="1" 
                                step="0.05"
                                value={layer.opacity}
                                onChange={(e) => updateWmsLayer(layer.id, { opacity: parseFloat(e.target.value) })}
                                className="w-full h-1 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                              />
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
    </aside>

      {/* Main Map */}
      <main className="flex-1 relative bg-slate-200 z-[1] overflow-hidden">
        <MapContainer 
          center={analysis.bestLoc} 
          zoom={13} 
          className="h-full w-full"
          zoomControl={false}
          ref={setMapInstance}
        >
          {/* Basemap Rendering */}
          {BASEMAPS[basemap].type === 'tile' && (
            <TileLayer
              key={basemap}
              url={BASEMAPS[basemap].url}
              attribution={BASEMAPS[basemap].attribution}
            />
          )}

          {/* Map Overlays */}
          {wmsLayers.filter(l => l.enabled).map(layer => {
            if (layer.type === 'wms') {
              return (
                <WMSTileLayer
                  key={layer.id}
                  url={layer.url}
                  layers={layer.layers}
                  format={layer.format}
                  transparent={layer.transparent}
                  opacity={layer.opacity}
                  zIndex={10}
                />
              );
            }
            if (layer.type === 'feature') {
              return <JordarterAPILayer key={layer.id} url={layer.url} enabled={layer.enabled} opacity={layer.opacity} />;
            }
            return null;
          })}
          
          <MapClickHandler 
            activeSource={activeSource} 
            activeAction={activeAction} 
            placingTestLocation={placingTestLocation}
            isRelocatingSweetSpot={isRelocatingSweetSpot}
            onAction={handleMapAction} 
            onPlaceTest={(latlng) => {
              setTestLocation(latlng);
              setShowTestLocation(true);
              setPlacingTestLocation(false);
            }}
            onRelocate={handleRelocate}
          />

          {/* Analysis Contours */}
          {showSweetSpot && analysis.contourData.map((contour, i) => (
             contour.polygons.map((ringSet, j) => {
               // i increases from outermost (0) to innermost (steps-1)
               // The user wants stronger towards center
               const fillOpacity = 0.12 + (i * 0.035);
               const strokeOpacity = 0.2 + (i * 0.04);
               
               return (
                 <React.Fragment key={`contour-group-${i}-${j}`}>
                   <Polygon
                     positions={ringSet as any}
                     pathOptions={{ 
                       color: contour.color,
                       fillColor: contour.color,
                       fillOpacity: Math.min(fillOpacity, 0.85),
                       weight: 1.5,
                       opacity: Math.min(strokeOpacity, 0.9),
                       stroke: true,
                       lineJoin: 'round'
                     }}
                   />
                 </React.Fragment>
               );
             })
          ))}

          {/* Source Paths and Markers */}
          {(Object.entries(scenarios) as [string, ScenarioData][]).map(([numStr, scenarioData]) => {
            const num = parseInt(numStr);
            if (num === activeScenario) return null;
            
            const scenarioSources = scenarioData.sources;
            const scenarioAnalysis = runAnalysis(scenarioSources);

            // Differentiation for inactive scenarios
            // 1: White, 2: Black, 3: Striped (Black/White)
            const scenarioColor = num === 1 ? '#ffffff' : '#000000';
            const isStriped = num === 3;

            return (
              <React.Fragment key={`scenario-map-${num}`}>
                {(Object.entries(scenarioSources) as [string, Source][]).map(([id, data]) => {
                  if (!data.enabled) return null;
                  const target = (scenarioData.testLocation && scenarioData.showTestLocation) 
                    ? scenarioData.testLocation 
                    : scenarioAnalysis.bestLoc;
                  const path = [data.loc, ...data.nodes, target];

                  return (
                    <React.Fragment key={`scenario-${num}-${id}`}>
                      <Polyline 
                        positions={path} 
                        pathOptions={{ 
                          color: scenarioColor,
                          weight: 3, 
                          opacity: 0.5,
                        }} 
                      />
                      {isStriped && (
                        <Polyline 
                          positions={path} 
                          pathOptions={{ 
                            color: '#ffffff',
                            weight: 3, 
                            opacity: 0.7,
                            dashArray: '8, 8'
                          }} 
                        />
                      )}
                    </React.Fragment>
                  );
                })}
                <Marker 
                  position={scenarioAnalysis.bestLoc}
                  icon={L.divIcon({
                    className: 'comparison-sweetspot',
                    html: `
                      <div class="flex items-center justify-center">
                        <div class="w-5 h-5 rounded-full border border-dashed border-slate-300 bg-white/20 flex items-center justify-center">
                          <div class="w-1 h-1 rounded-full bg-slate-300"></div>
                        </div>
                      </div>
                    `,
                    iconSize: [20, 20],
                    iconAnchor: [10, 10]
                  })}
                />
              </React.Fragment>
            );
          })}

          {(Object.entries(sources) as [string, Source][]).map(([id, data]) => {
            const target = (testLocation && showTestLocation) ? testLocation : analysis.bestLoc;
            
            // Calculate segments/path
            const renderSegments = () => {
              if (!data.enabled) return null;

              if (data.isSplit && data.splitNodeIndex !== undefined && data.nodes.length > data.splitNodeIndex) {
                const splitPoint = data.nodes[data.splitNodeIndex];
                const segmentB = [data.loc, ...data.nodes.slice(0, data.splitNodeIndex + 1)];
                const segmentA = [splitPoint, ...data.nodes.slice(data.splitNodeIndex + 1), target];
                
                return (
                  <>
                    <Polyline 
                      positions={segmentB} 
                      pathOptions={{ 
                        color: '#0369a1', // sky-700
                        weight: (testLocation && showTestLocation) ? 7 : 5, 
                        opacity: (testLocation && showTestLocation) ? 0.9 : 0.7,
                        dashArray: 'none'
                      }} 
                    />
                    <Polyline 
                      positions={segmentB} 
                      pathOptions={{ 
                        color: '#bae6fd', // sky-200 (core of double line)
                        weight: (testLocation && showTestLocation) ? 2 : 1, 
                        opacity: 1,
                        dashArray: 'none'
                      }} 
                    />
                    <Polyline 
                      positions={segmentA} 
                      pathOptions={{ 
                        color: data.color, 
                        weight: (testLocation && showTestLocation) ? 4 : 2, 
                        opacity: (testLocation && showTestLocation) ? 0.8 : 0.6,
                        dashArray: (testLocation && showTestLocation) ? 'none' : '8, 4'
                      }} 
                    />
                  </>
                );
              } else {
                const path = [data.loc, ...data.nodes, target];
                return (
                  <Polyline 
                    positions={path} 
                    pathOptions={{ 
                      color: data.color, 
                      weight: (testLocation && showTestLocation) ? 4 : 2, 
                      opacity: (testLocation && showTestLocation) ? 0.8 : 0.6,
                      dashArray: (testLocation && showTestLocation) ? 'none' : '8, 4'
                    }} 
                  />
                );
              }
            };

            return (
              <React.Fragment key={id}>
                {renderSegments()}
                <Marker 
                  position={data.loc}
                  draggable={true}
                  eventHandlers={{
                    dragend: (e) => {
                      const marker = e.target;
                      const position = marker.getLatLng();
                      updateSource(id, { loc: [position.lat, position.lng] });
                    },
                  }}
                  icon={L.divIcon({
                    className: 'source-marker',
                    html: `<div style="background-color: ${data.color}; opacity: ${data.enabled ? 1 : 0}; width: 20px; height: 20px; border-radius: 50%; border: ${data.enabled ? '2px solid #000' : 'none'}; box-shadow: ${data.enabled ? '0 0 5px rgba(0,0,0,0.2)' : 'none'}; pointer-events: ${data.enabled ? 'auto' : 'none'};"></div>`,
                    iconSize: [20, 20],
                    iconAnchor: [10, 10]
                  })}
                >
                  {data.enabled && (
                    <Tooltip permanent direction="top" offset={[0, -10]} className={`!bg-black/70 !border-none !text-white !p-1 !px-2 !rounded !text-[10px] !font-bold !shadow-none`}>
                      <span>{data.name}</span>
                    </Tooltip>
                  )}
                </Marker>
                {data.nodes.map((node, ni) => (
                  <Marker 
                    key={`${id}-node-${ni}`}
                    position={node} 
                    draggable={true}
                    eventHandlers={{
                      click: () => {
                        if (data.isSplit) {
                          updateSource(id, { splitNodeIndex: ni });
                        }
                      },
                      dragend: (e) => {
                        const marker = e.target;
                        const position = marker.getLatLng();
                        const newNodes = [...data.nodes];
                        newNodes[ni] = [position.lat, position.lng];
                        updateSource(id, { nodes: newNodes });
                      },
                    }}
                    icon={L.divIcon({
                      className: 'node-marker',
                      html: `<div style="background-color: #fff; opacity: ${data.enabled ? (data.isSplit && ni === data.splitNodeIndex ? 1 : 0.8) : 0.1}; width: ${data.isSplit && ni === data.splitNodeIndex ? '14px' : '10px'}; height: ${data.isSplit && ni === data.splitNodeIndex ? '14px' : '10px'}; border-radius: 50%; border: ${data.isSplit && ni === data.splitNodeIndex ? '3px solid #991b1b' : '1px solid #000'}; box-shadow: ${data.isSplit && ni === data.splitNodeIndex ? '0 0 8px rgba(153, 27, 27, 0.5)' : 'none'}; cursor: ${data.isSplit ? 'pointer' : 'move'};"></div>`,
                      iconSize: data.isSplit && ni === data.splitNodeIndex ? [14, 14] : [10, 10],
                      iconAnchor: data.isSplit && ni === data.splitNodeIndex ? [7, 7] : [5, 5]
                    })}
                  />
                ))}
              </React.Fragment>
            );
          })}

          {/* Test Location Marker */}
          {testLocation && showTestLocation && (
            <>
              <Marker 
                position={testLocation}
                draggable
                eventHandlers={{
                  dragend: (e) => {
                    const marker = e.target;
                    const position = marker.getLatLng();
                    setTestLocation([position.lat, position.lng]);
                  },
                }}
                icon={L.divIcon({
                  className: 'custom-test-location',
                  html: `
                    <div class="test-location-pin">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#4778A5" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.2))">
                        <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0Z"/>
                        <circle cx="12" cy="10" r="3" fill="white"/>
                      </svg>
                    </div>
                  `,
                  iconSize: [24, 24],
                  iconAnchor: [12, 24]
                })}
              >
              </Marker>
            </>
          )}

          {/* Sweet Spot Marker */}
          {showSweetSpot && (
            <Marker 
              position={analysis.bestLoc}
              icon={L.divIcon({
                className: 'custom-sweetspot',
                html: `
                  <div class="sweetspot-container" style="opacity: 0.95;">
                    <div class="sweetspot-ping-inner" style="border-color: #fff; background: rgba(255,255,255,0.2);"></div>
                    <div class="sweetspot-ping-outer" style="border-color: #fff; opacity: 0.3;"></div>
                    <div class="sweetspot-bullseye">
                      <div class="bullseye-ring"></div>
                      <div class="bullseye-dot"></div>
                    </div>
                  </div>
                `,
                iconSize: [40, 40],
                iconAnchor: [20, 20]
              })}
            />
          )}
        </MapContainer>

        <div 
          className="absolute top-6 right-6 z-[1000] w-80 flex flex-col gap-4 pointer-events-none transition-all duration-300"
          style={{ 
            maxHeight: `${92 / uiScale}%`,
            transform: `scale(${uiScale})`, 
            transformOrigin: 'top right'
          }}
        >
          {/* Selected Location Panel */}
          {testLocationResult && showTestLocation && (
            <motion.div 
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="bg-white/95 backdrop-blur-xl p-5 rounded-[2rem] shadow-[0_20px_50px_-12px_rgba(0,0,0,0.2)] border border-white pointer-events-auto"
            >
              <div className={`${Object.keys(scenarios).length === 1 ? 'flex justify-between' : 'flex flex-col items-center'} items-center gap-3 mb-6 pb-4 border-b border-slate-100`}>
                <div className="flex items-center gap-3">
                  <MapPin className="w-4 h-4 text-[#4778A5]" fill="#4778A520" />
                  <span className="text-slate-800 font-black tracking-tight text-[13px] uppercase">Vald plats</span>
                </div>
                {Object.keys(scenarios).length === 1 ? (
                  <div className="font-mono font-black text-[#4778A5] text-[15px] bg-[#4778A5]/10 px-3 py-1 rounded-lg border border-[#4778A5]/20">
                    {Math.round(allScenariosAtTestLocation?.[activeScenario]?.total || 0).toLocaleString('sv-SE')} kr
                  </div>
                ) : (
                  <div className="flex items-center justify-center gap-1.5 w-full">
                    {Object.keys(scenarios).sort().map(numStr => {
                      const num = parseInt(numStr);
                      const isActive = num === activeScenario;
                      const result = allScenariosAtTestLocation?.[num];
                      if (!result) return null;
                      
                      return (
                        <div 
                          key={num}
                          className={`font-mono font-black transition-all shrink-0 ${
                            isActive 
                            ? 'text-[#4778A5] text-[13px] bg-[#4778A5]/10 px-3 py-1.5 rounded-lg border border-[#4778A5]/20 shadow-sm' 
                            : 'text-[#4778A5]/40 text-[9px] px-2 py-1 border border-[#4778A5]/5 rounded-md'
                          }`}
                        >
                          {Math.round(result.total).toLocaleString('sv-SE')} kr
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="space-y-4">
                {Object.entries(testLocationResult.breakdown).map(([id, val]) => {
                  const source = sources[id];
                  if (!source) return null;

                  const allScenarioNums = Object.keys(scenarios).map(n => parseInt(n)).sort();
                  const activeCount = allScenarioNums.length;
                  
                  const getScenarioData = (num: number) => {
                    const scen = scenarios[num];
                    if (!scen || !scen.sources[id]) return null;
                    const scenLoc = scen.testLocation || (scen.showTestLocation ? scen.testLocation : null) || runAnalysis(scen.sources).bestLoc;
                    
                    // Use the robust analysis calculation which handles splits
                    const result = getCostAt(scen.sources, scenLoc as [number, number]);
                    const sCost = result.breakdown[id] || 0;
                    
                    // Calculate total path distance from segments
                    const sDist = result.detailedBreakdown?.[id]?.segments.reduce((acc, s) => acc + s.dist, 0) || 0;
                    
                    return { dist: sDist, cost: sCost };
                  };

                  if (activeCount === 1) {
                    const data = getScenarioData(activeScenario)!;
                    return (
                      <div key={id} className="flex items-center justify-between px-1 group">
                        <div className="flex items-center gap-2">
                          <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: source.color }} />
                          <span className="text-[10px] font-black text-slate-600 uppercase tracking-tight">{source.name}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-[10px] font-mono font-bold text-slate-400">{Math.round(data.dist).toLocaleString('sv-SE')} m</span>
                          <span className="text-[10px] font-mono font-black text-slate-800">{Math.round(data.cost).toLocaleString('sv-SE')} kr</span>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div key={id} className="space-y-1.5">
                      <div className="flex items-center justify-between px-1">
                        <div className="flex items-center gap-2">
                          <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: source.color }} />
                          <span className="text-[10px] font-black text-slate-600 uppercase tracking-tight">{source.name}</span>
                        </div>
                      </div>
                      
                      <div className="flex gap-1">
                        {allScenarioNums.map(num => {
                          const data = getScenarioData(num);
                          const isActive = num === activeScenario;
                          if (!data) return null;
                          return (
                            <div 
                              key={num} 
                              className={`p-1.5 rounded-lg border transition-all ${
                                isActive 
                                ? 'flex-[1.5] bg-slate-50 border-slate-200 shadow-sm ring-1 ring-black/5' 
                                : 'flex-1 bg-slate-50/20 border-slate-100 opacity-60'
                              }`}
                            >
                               <div className="flex flex-col gap-0.5 items-center">
                                 <div className={`${isActive ? 'text-[10px] font-black' : 'text-[8px] font-bold'} font-mono text-slate-900 leading-none truncate w-full text-center`}>
                                   {Math.round(data.cost).toLocaleString('sv-SE')} kr
                                 </div>
                                 <div className="text-[7px] font-mono font-bold text-slate-400 w-full text-center">
                                   {Math.round(data.dist).toLocaleString('sv-SE')} m
                                 </div>
                               </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          )}

          {/* Sweet Spot & Zones Panel */}
          {showSweetSpot && (
            <motion.div 
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="bg-slate-900/95 backdrop-blur-xl p-6 rounded-[2.5rem] shadow-[0_30px_60px_-12px_rgba(0,0,0,0.4)] border border-white/10 pointer-events-auto"
            >
              <div className="flex justify-between items-center mb-6 pb-4 border-b border-white/5">
                <div className="flex items-center gap-3">
                  <div className="relative flex items-center justify-center">
                    <div className="absolute w-5 h-5 rounded-full border border-white/40 animate-ping" />
                    <Target className="w-5 h-5 text-white relative z-10" />
                  </div>
                  <span className="text-white font-black tracking-tight text-[13px] uppercase">Sweet spot</span>
                </div>
                <div className="flex flex-col items-end">
                  <div className="font-mono font-black text-white text-[15px] bg-white/10 px-3 py-1 rounded-lg ring-1 ring-white/20 shadow-[0_0_15px_rgba(255,255,255,0.1)]">
                    {Math.round(analysis.minVal).toLocaleString('sv-SE')} kr
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                {[
                  { label: 'Inre zon', color: '#ff5500', val: analysis.thresholds.inner },
                  { label: 'Mellanzon', color: '#ffaa00', val: analysis.thresholds.middle },
                  { label: 'Yttre zon', color: '#ffff00', val: analysis.thresholds.outer }
                ].map(item => (
                  <div key={item.label} className="flex justify-between items-center py-2 px-3 rounded-xl border border-white/5 relative overflow-hidden group">
                    {/* Colored Band Background */}
                    <div 
                      className="absolute inset-0 opacity-25 group-hover:opacity-30 transition-opacity" 
                      style={{ backgroundColor: item.color }} 
                    />
                    <div className="relative z-10">
                      <div className="text-white text-[10px] font-bold uppercase tracking-widest">{item.label}</div>
                    </div>
                    <span className="relative z-10 font-mono font-black text-white text-[11px]">{Math.round(item.val).toLocaleString('sv-SE')} kr</span>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </div>

        {/* Map Controls */}
        <div className="absolute bottom-8 right-8 z-[1000] flex items-center gap-4">
          <div className="flex flex-col gap-2">
            <button 
              onClick={() => mapInstance?.zoomIn()}
              className="w-10 h-10 rounded-full bg-white shadow-lg flex items-center justify-center text-slate-600 hover:bg-slate-50 transition-all active:scale-90 border border-slate-100"
              title="Zooma in karta"
            >
              <Plus className="w-5 h-5" />
            </button>
            <button 
              onClick={() => mapInstance?.zoomOut()}
              className="w-10 h-10 rounded-full bg-white shadow-lg flex items-center justify-center text-slate-600 hover:bg-slate-50 transition-all active:scale-90 border border-slate-100"
              title="Zooma ut karta"
            >
              <Minus className="w-5 h-5" />
            </button>
          </div>

          <div className="w-px h-12 bg-slate-300/60 shadow-sm" />

          <div className="flex flex-col gap-2">
            <button 
              onClick={() => setUiScale(Number(Math.min(1.2, uiScale + 0.1).toFixed(1)))}
              disabled={uiScale >= 1.2}
              className={`w-10 h-10 rounded-full shadow-lg flex items-center justify-center transition-all border ${uiScale >= 1.2 ? 'opacity-20 cursor-not-allowed bg-slate-50 text-slate-400 border-slate-100' : 'bg-white text-slate-600 hover:bg-slate-50 active:scale-90 border-slate-100'}`}
              title="Större UI"
            >
              <ZoomIn className="w-5 h-5" />
            </button>
            <button 
              onClick={() => setUiScale(Number(Math.max(1, uiScale - 0.1).toFixed(1)))}
              disabled={uiScale <= 1}
              className={`w-10 h-10 rounded-full shadow-lg flex items-center justify-center transition-all border ${uiScale <= 1 ? 'opacity-20 cursor-not-allowed bg-slate-50 text-slate-400 border-slate-100' : 'bg-white text-slate-600 hover:bg-slate-50 active:scale-90 border-slate-100'}`}
              title="Mindre UI"
            >
              <ZoomOut className="w-5 h-5" />
            </button>
          </div>
        </div>

        <AnimatePresence>
          {isRelocatingSweetSpot && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="absolute top-8 left-1/2 -translate-x-1/2 z-[2000] pointer-events-none transition-all duration-300"
              style={{ transform: `scale(${uiScale}) translateX(-50%)`, transformOrigin: 'top center' }}
            >
              <div className="bg-slate-900/90 backdrop-blur-md text-white px-6 py-3 rounded-2xl shadow-2xl border border-white/10 flex items-center gap-3">
                <Move className="w-4 h-4 text-indigo-400 animate-bounce" />
                <span className="text-xs font-medium tracking-wide">Klicka på kartan för att flytta hela systemet (källor + sweetspot)</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
