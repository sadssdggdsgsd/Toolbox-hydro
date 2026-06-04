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
  GeoJSON,
  Popup
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
  ZoomOut,
  Mountain,
  MousePointerClick
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Source, ActiveAction, AnalysisResult } from './types';
import { runAnalysis, getCostAt, getDistance } from './analysis';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip as RechartsTooltip, 
  ResponsiveContainer,
  ReferenceDot
} from 'recharts';
import { fetchElevationData, ElevationPoint } from './elevationService';

// Basemap options
type BasemapKey = 'ortofoto' | 'topowebb' | 'topowebb_nedtonad' | 'terrangskuggning';

const BASEMAPS: Record<BasemapKey, { 
  name: string; 
  url: string; 
  attribution: string;
  type: 'tile' | 'wms';
  layers?: string;
  version?: string;
  transparent?: boolean;
}> = {
  ortofoto: {
    name: 'Ortofoto',
    url: 'https://minkarta.lantmateriet.se/map/ortofoto/',
    attribution: '&copy; Lantmäteriet',
    type: 'wms',
    layers: 'Ortofoto_0.5',
    version: '1.1.1',
    transparent: false
  },
  topowebb: {
    name: 'Topowebb',
    url: 'https://minkarta.lantmateriet.se/map/topowebb/',
    attribution: '&copy; Lantmäteriet',
    type: 'wms',
    layers: 'topowebbkartan',
    version: '1.1.1',
    transparent: false
  },
  topowebb_nedtonad: {
    name: 'Nedtonad',
    url: 'https://minkarta.lantmateriet.se/map/topowebb/',
    attribution: '&copy; Lantmäteriet',
    type: 'wms',
    layers: 'topowebbkartan_nedtonad',
    version: '1.1.1',
    transparent: false
  },
  terrangskuggning: {
    name: 'Skuggning',
    url: 'https://minkarta.lantmateriet.se/map/hojdmodell/',
    attribution: '&copy; Lantmäteriet',
    type: 'wms',
    layers: 'terrangskuggning',
    version: '1.1.1',
    transparent: true
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
    card: 'border-orange-300 bg-orange-50/30',
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
    card: 'border-pink-300 bg-pink-50/30',
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
    card: 'border-emerald-300 bg-emerald-50/30',
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
    card: 'border-amber-300 bg-amber-50/30',
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
    card: 'border-fuchsia-300 bg-fuchsia-50/30',
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
    card: 'border-rose-300 bg-rose-50/30',
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
        card: 'border-cyan-300 bg-cyan-50/30',
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
        card: 'border-green-300 bg-green-50/30',
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
        card: 'border-red-300 bg-red-50/30',
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
        card: 'border-violet-300 bg-violet-50/30',
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
        card: 'border-slate-300 bg-slate-50/30',
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
  onRelocate,
  onMapClick
}: { 
  activeSource: string | null; 
  activeAction: ActiveAction;
  placingTestLocation: boolean;
  isRelocatingSweetSpot: boolean;
  onAction: (latlng: [number, number]) => void;
  onPlaceTest: (latlng: [number, number]) => void;
  onRelocate: (latlng: [number, number]) => void;
  onMapClick?: (latlng: [number, number], map: L.Map, containerPoint: L.Point) => void;
}) {
  const map = useMapEvents({
    click(e) {
      if (placingTestLocation) {
        onPlaceTest([e.latlng.lat, e.latlng.lng]);
      } else if (isRelocatingSweetSpot) {
        onRelocate([e.latlng.lat, e.latlng.lng]);
      } else if (activeSource && activeAction) {
        onAction([e.latlng.lat, e.latlng.lng]);
      } else {
        if (onMapClick) {
          onMapClick([e.latlng.lat, e.latlng.lng], map, e.containerPoint);
        }
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
  version?: string;
  attribution?: string;
  clickQueryEnabled?: boolean;
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
  
  const currentScenario = scenarios[activeScenario] || { sources: {} as Record<string, Source>, testLocation: null, showTestLocation: false };
  const sources = currentScenario.sources as Record<string, Source>;
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
  const [basemap, setBasemap] = useState<BasemapKey>('ortofoto');
  const [openTemplateMenu, setOpenTemplateMenu] = useState<string | null>(null);
  const [showLayerMenu, setShowLayerMenu] = useState(false);
  const [wmsLayers, setWmsLayers] = useState<MapLayer[]>([
    {
      id: 'jordarter-25-100',
      name: 'Jordarter 1:25k - 1:100k (SGU)',
      url: 'https://api.sgu.se/oppnadata/jordarter25k-100k/ogc/features/v1/collections/grundlager/items',
      type: 'feature',
      opacity: 0.8,
      enabled: false,
      clickQueryEnabled: false
    },
    {
      id: 'jordarter-250',
      name: 'Jordarter 1:250k (SGU)',
      url: 'https://api.sgu.se/oppnadata/jordarter250k/ogc/features/v1/collections/grundlager/items',
      type: 'feature',
      opacity: 0.8,
      enabled: false,
      clickQueryEnabled: false
    },
    {
      id: 'jordarter-1m',
      name: 'Jordarter 1:1miljon (SGU)',
      url: 'https://api.sgu.se/oppnadata/jordarter1miljon/ogc/features/v1/collections/grundlager/items',
      type: 'feature',
      opacity: 0.8,
      enabled: false,
      clickQueryEnabled: false
    },
    {
      id: 'natura2000',
      name: 'Natura 2000 (Naturvårdsverket)',
      url: 'https://geodata.naturvardsverket.se/geoserver/ows',
      type: 'wms',
      layers: 'ps-n2k:PS.ProtectedSites.Natura2000',
      format: 'image/png',
      transparent: true,
      opacity: 0.8,
      enabled: false,
      version: '1.3.0',
      clickQueryEnabled: false
    },
    {
      id: 'naturreservat',
      name: 'Naturreservat (Naturvårdsverket)',
      url: 'https://geodata.naturvardsverket.se/geoserver/ows',
      type: 'wms',
      layers: 'ps-nvr:PS.ProtectedSites.NR',
      format: 'image/png',
      transparent: true,
      opacity: 0.8,
      enabled: false,
      version: '1.3.0',
      clickQueryEnabled: false
    },
    {
      id: 'vattenskydd',
      name: 'Dricksvattenskydd (Naturvårdsverket)',
      url: 'https://geodata.naturvardsverket.se/geoserver/ows',
      type: 'wms',
      layers: 'am-restriction:AM.drinkingWaterProtectionArea',
      format: 'image/png',
      transparent: true,
      opacity: 0.8,
      enabled: false,
      version: '1.3.0',
      clickQueryEnabled: false
    },
    {
      id: 'nmd_2023',
      name: 'Nationella Marktäckedata 2023 (NMD v2.0)',
      url: 'https://geodata.naturvardsverket.se/geoserver/ows',
      type: 'wms',
      layers: 'lc-nmd:LC.LandCoverRaster.Bas_2.0',
      format: 'image/png',
      transparent: true,
      opacity: 0.8,
      enabled: false,
      version: '1.3.0',
      clickQueryEnabled: false
    },
    {
      id: 'nmd_2018',
      name: 'Nationella Marktäckedata 2018 (NMD)',
      url: 'https://geodata.naturvardsverket.se/geoserver/ows',
      type: 'wms',
      layers: 'lc-nmd:LC.LandCoverRaster.Bas.2018',
      format: 'image/png',
      transparent: true,
      opacity: 0.8,
      enabled: false,
      version: '1.3.0',
      clickQueryEnabled: false
    },
    {
      id: 'nmd_fjallskog',
      name: 'NMD Låg fjällskog 2018',
      url: 'https://geodata.naturvardsverket.se/geoserver/ows',
      type: 'wms',
      layers: 'lc-nmd:LC.LandCoverRaster.LagFjallskog.2018',
      format: 'image/png',
      transparent: true,
      opacity: 0.8,
      enabled: false,
      version: '1.3.0',
      clickQueryEnabled: false
    },
    {
      id: 'fornlamningar',
      name: 'Fornlämningar (Riksantikvarieämbetet)',
      url: 'https://pub.raa.se/visning/lamningar_v1/wms',
      type: 'wms',
      layers: 'fornlamning,ovrkulthistlamning,mojligfornlamning',
      format: 'image/png',
      transparent: true,
      opacity: 0.8,
      enabled: false,
      version: '1.3.0',
      attribution: '© Riksantikvarieämbetet (CC0)',
      clickQueryEnabled: false
    },
    {
      id: 'sgu_berggrund_50_250k',
      name: 'Berggrund 1:50k - 1:250k (SGU)',
      url: 'https://maps3.sgu.se/geoserver/berg/ows',
      type: 'wms',
      layers: 'SE.GOV.SGU.BERG.GEOLOGISK_ENHET.YTA.50K',
      format: 'image/png',
      transparent: true,
      opacity: 0.8,
      enabled: false,
      version: '1.3.0',
      attribution: '© Sveriges geologiska undersökning (SGU)',
      clickQueryEnabled: false
    },
    {
      id: 'sgu_brunnar',
      name: 'Brunnar (SGU)',
      url: 'https://maps3.sgu.se/geoserver/grundvatten/ows',
      type: 'wms',
      layers: 'SE.GOV.SGU.BRUNNAR.250K',
      format: 'image/png',
      transparent: true,
      opacity: 0.8,
      enabled: false,
      version: '1.3.0',
      attribution: '© Sveriges geologiska undersökning (SGU)',
      clickQueryEnabled: false
    },
    {
      id: 'sgu_jorddjupsmodell',
      name: 'Jorddjupsmodell (SGU)',
      url: 'https://maps3.sgu.se/geoserver/misc/ows',
      type: 'wms',
      layers: 'SE.GOV.SGU.MISC.JORDDJUPSMODELL.RASTER_INTERVALL',
      format: 'image/png',
      transparent: true,
      opacity: 0.8,
      enabled: false,
      version: '1.3.0',
      attribution: '© Sveriges geologiska undersökning (SGU)',
      clickQueryEnabled: false
    }
  ]);
  
  // Visibility states
  const [mapInstance, setMapInstance] = useState<L.Map | null>(null);
  const [showSweetSpot, setShowSweetSpot] = useState(true);
  const [isRelocatingSweetSpot, setIsRelocatingSweetSpot] = useState(false);
  const [uiScale, setUiScale] = useState(1);

  // Elevation Profile state
  const [showElevationPanel, setShowElevationPanel] = useState(false);
  const [selectedProfileSourceId, setSelectedProfileSourceId] = useState<string | null>(null);
  const [elevationProfileData, setElevationProfileData] = useState<ElevationPoint[] | null>(null);
  const [isFetchingElevation, setIsFetchingElevation] = useState(false);
  const [elevationError, setElevationError] = useState<string | null>(null);
  const [hoveredProfilePoint, setHoveredProfilePoint] = useState<ElevationPoint | null>(null);

  // Map click query states
  const [mapClickPos, setMapClickPos] = useState<[number, number] | null>(null);
  const [mapClickQueryLoading, setMapClickQueryLoading] = useState(false);
  const [mapClickQueryResults, setMapClickQueryResults] = useState<any[] | null>(null);
  const [showQueryResultsPanel, setShowQueryResultsPanel] = useState(false);

  // Target location (Sweetspot or manual test location)
  const elevationTarget = useMemo(() => {
    return (testLocation && showTestLocation) ? testLocation : analysis.bestLoc;
  }, [testLocation, showTestLocation, analysis.bestLoc]);

  // Selected source connection
  const selectedSource = useMemo(() => {
    if (!selectedProfileSourceId) return null;
    return sources[selectedProfileSourceId] || null;
  }, [sources, selectedProfileSourceId]);

  // Full coordinate path for selected source
  const pathCoords = useMemo(() => {
    if (!selectedSource || !selectedSource.enabled) return null;
    return [selectedSource.loc, ...selectedSource.nodes, elevationTarget] as [number, number][];
  }, [selectedSource, elevationTarget]);

  // Stringified path coordinates to prevent unnecessary re-fetching
  const pathCoordsStr = useMemo(() => {
    return pathCoords ? JSON.stringify(pathCoords) : '';
  }, [pathCoords]);

  // Fetch elevation data when path or eligibility changes
  useEffect(() => {
    if (!showElevationPanel || !selectedProfileSourceId || !pathCoords) {
      setElevationProfileData(null);
      return;
    }

    let isMounted = true;
    const loadElevation = async () => {
      setIsFetchingElevation(true);
      setElevationError(null);
      try {
        const data = await fetchElevationData(pathCoords);
        if (isMounted) {
          setElevationProfileData(data);
        }
      } catch (err: any) {
        if (isMounted) {
          console.error("Kunde inte hämta höjddata:", err);
          setElevationError(err.message || 'Kunde inte hämta höjddata via API');
          setElevationProfileData(null);
        }
      } finally {
        if (isMounted) {
          setIsFetchingElevation(false);
        }
      }
    };

    loadElevation();

    return () => {
      isMounted = false;
    };
  }, [showElevationPanel, selectedProfileSourceId, pathCoordsStr]);

  // Active and enabled sources
  const activeAndEnabledSources = useMemo(() => {
    return Object.entries(sources)
      .map(([id, s]) => ({ id, ...s }))
      .filter(s => s.enabled);
  }, [sources]);

  // Auto-select first active source if current selection is invalid
  useEffect(() => {
    if (activeAndEnabledSources.length > 0) {
      if (!selectedProfileSourceId || !sources[selectedProfileSourceId]?.enabled) {
        setSelectedProfileSourceId(activeAndEnabledSources[0].id);
      }
    } else {
      setSelectedProfileSourceId(null);
    }
  }, [activeAndEnabledSources, selectedProfileSourceId, sources]);

  // Stats calculated from elevationProfileData
  const elevationStats = useMemo(() => {
    if (!elevationProfileData || elevationProfileData.length === 0) return null;
    const elevations = elevationProfileData.map(p => p.elevation);
    const minElev = Math.min(...elevations);
    const maxElev = Math.max(...elevations);
    
    let gain = 0;
    let loss = 0;
    for (let i = 0; i < elevationProfileData.length - 1; i++) {
      const diff = elevationProfileData[i + 1].elevation - elevationProfileData[i].elevation;
      if (diff > 0) {
        gain += diff;
      } else {
        loss += Math.abs(diff);
      }
    }
    const totalDistance = elevationProfileData[elevationProfileData.length - 1].distance;

    return {
      min: minElev,
      max: maxElev,
      gain: Math.round(gain),
      loss: Math.round(loss),
      totalDistance
    };
  }, [elevationProfileData]);

  // Nodes in active source to show on elevation profile
  const nodeProfilePoints = useMemo(() => {
    if (!selectedSource || !selectedSource.enabled || !selectedSource.nodes.length || !elevationProfileData || elevationProfileData.length === 0) {
      return [];
    }

    const distances: { index: number; distance: number; lat: number; lon: number }[] = [];
    let cumulative = 0;
    let prev = selectedSource.loc;

    selectedSource.nodes.forEach((node, i) => {
      cumulative += getDistance(prev, node);
      distances.push({
        index: i,
        distance: cumulative,
        lat: node[0],
        lon: node[1]
      });
      prev = node;
    });

    return distances.map(nd => {
      let bestPoint = elevationProfileData[0];
      let minDiff = Math.abs(bestPoint.distance - nd.distance);

      for (const p of elevationProfileData) {
        const diff = Math.abs(p.distance - nd.distance);
        if (diff < minDiff) {
          minDiff = diff;
          bestPoint = p;
        }
      }

      return {
        ...nd,
        elevation: bestPoint.elevation
      };
    });
  }, [selectedSource, elevationProfileData]);

  // Rounded evenly distributed ticks for X axis (distance in meters)
  const xAxisTicks = useMemo(() => {
    if (!elevationStats) return [];
    const maxDist = elevationStats.totalDistance;
    if (maxDist <= 0) return [0];

    const possibleIntervals = [10, 25, 50, 100, 150, 200, 250, 300, 400, 500, 1000, 1500, 2000, 3000, 5000];
    const targetCount = 5; 
    const idealInterval = maxDist / targetCount;
    
    let interval = possibleIntervals[possibleIntervals.length - 1];
    for (const opt of possibleIntervals) {
      if (opt >= idealInterval) {
        interval = opt;
        break;
      }
    }

    const ticks: number[] = [];
    for (let current = 0; current <= maxDist; current += interval) {
      ticks.push(current);
    }
    
    if (ticks[ticks.length - 1] < maxDist && (maxDist - ticks[ticks.length - 1]) > (interval * 0.3)) {
      ticks.push(Math.round(maxDist));
    } else if (ticks[ticks.length - 1] < maxDist) {
      ticks[ticks.length - 1] = Math.round(maxDist);
    }
    return ticks;
  }, [elevationStats]);

  // Rounded evenly distributed ticks for Y axis (elevation in meters)
  const yAxisTicksAndDomain = useMemo(() => {
    if (!elevationStats) return { ticks: [], domain: [0, 100] };
    const { min, max } = elevationStats;
    
    const diff = max - min;
    const possibleIntervals = [1, 2, 5, 10, 20, 25, 30, 40, 50, 100, 150, 200];
    const targetCount = 4; 
    const idealInterval = diff / targetCount;
    let interval = possibleIntervals[possibleIntervals.length - 1];
    for (const opt of possibleIntervals) {
      if (opt >= idealInterval) {
        interval = opt;
        break;
      }
    }

    const roundedMin = Math.floor(min / interval) * interval;
    const roundedMax = Math.ceil(max / interval) * interval;

    const ticks: number[] = [];
    for (let current = roundedMin; current <= roundedMax; current += interval) {
      ticks.push(current);
    }

    return {
      ticks,
      domain: [roundedMin, roundedMax]
    };
  }, [elevationStats]);

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
      const scen = scenarios[num];
      // Use own test location if it's shown, otherwise fallback to sweetspot for comparison
      const scenLoc = (scen.testLocation && scen.showTestLocation) 
        ? scen.testLocation 
        : runAnalysis(scen.sources).bestLoc;
        
      results[num] = getCostAt(scen.sources, scenLoc);
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

  const translatePropertyKey = (key: string): string => {
    const translations: Record<string, string> = {
      // Bedrock (Berggrund)
      LITOLOGI: 'Bergart',
      HUVUDLITOLOGI: 'Huvudbergart',
      ALDER_MIN: 'Minålder (miljoner år)',
      ALDER_MAX: 'Maxålder (miljoner år)',
      ROCK_CLASS: 'Bergartsklass',
      TEKTONISK_ENHET: 'Tektonisk enhet',
      
      // Wells (Brunnar)
      BRUNNSTYP: 'Brunnstyp',
      DJUP: 'Brunnsdjup',
      JORDDJUP: 'Jorddjup till berg',
      KAPACITET: 'Vattenkapacitet',
      AVSER: 'Användningsområde',
      TEKNISK_DATA: 'Tekniska detaljer',
      ELEVATION: 'Höjd (m.öh.)',
      
      // Soil Depth Model (Jorddjupsmodell)
      GRAY_INDEX: 'Jorddjup (index)',
      PALETTE_INDEX: 'Färgindex',
      description: 'Tolkat jorddjup',

      // Soil Types (Jordarter SGU OGC/REST Features)
      jg2_tx: 'Jordart',
      JORDART_KOD: 'Jordartskod',
      jg3_tx: 'Detaljerad beskrivning',
      LERA_HALT: 'Lerahalt',
      MORAN_TYP: 'Moräntyp',

      // Protected sites (Natura 2000, Naturreservat, Vattenskydd)
      N2K_NAMN: 'Natura 2000 namn',
      N2K_KOD: 'Natura 2000 kod',
      NAMN: 'Namn',
      SKYDD_TYP: 'Skyddstyp',
      BESKRIVNING: 'Beskrivning',
      STATUS: 'Status',
      AREAL_HA: 'Areal (hektar)',
      LAGUTRULLNING: 'Beslutsunderlag / Lagrum',

      // Archaeological Remains (Fornlämningar)
      lamningtyp: 'Lämningstyp',
      antikv_betydelse: 'Antikvarisk bedömning',
      beskrivning: 'Beskrivning',
      undertyp: 'Undertyp',
      status: 'Status',
      namn: 'Lämningens namn'
    };

    const cleanKey = key.trim();
    const upperKey = cleanKey.toUpperCase();
    
    if (translations[cleanKey]) return translations[cleanKey];
    if (translations[upperKey]) return translations[upperKey];
    
    return cleanKey.replace(/_/g, ' ');
  };

  const isIgnoredProperty = (key: string): boolean => {
    const ignored = [
      'OBJECTID', 'objectid', 'SGU_ID', 'sgu_id', 'id', 'ID', 'geom', 'GEOMETRY', 'geometry', 'SHAPE', 'shape',
      'SHAPE_Length', 'SHAPE_Area', 'shape_Length', 'shape_Area', 'gml_id', 'gml_parent_id', 'gml_parent_property',
      'fid', 'FID', 'bbox', 'BBOX', 'VERSION', 'version', 'UPPDATERAD_TID', 'skapad_tid'
    ];
    return ignored.includes(key) || key.startsWith('gml:') || key.startsWith('sgu:');
  };

  const getQueryProperties = (result: any): { title: string; properties: Record<string, any> }[] => {
    if (!result || !result.data) return [];
    
    if (result.type === 'feature_json' || result.type === 'wms_json') {
      const features = result.data?.features || [];
      if (features.length === 0) return [];
      
      return features.map((f: any, idx: number) => {
        // Interpret SGU Soil Depth Model GRAY_INDEX mapping to friendly Swedish ranges if description is missing
        if (result.layerId === 'sgu_jorddjupsmodell') {
          const grayValue = f.properties?.GRAY_INDEX ?? f.properties?.value ?? f.properties?.Band_1 ?? f.properties?.palette_index;
          if (grayValue !== undefined && !f.properties?.description) {
            const valNum = parseInt(String(grayValue));
            let customDesc = '';
            if (valNum === 1) customDesc = 'Mindre än 1 meter (< 1 m)';
            else if (valNum === 2) customDesc = 'Mellan 1 och 3 meter (1 - 3 m)';
            else if (valNum === 3) customDesc = 'Mellan 3 och 5 meter (3 - 5 m)';
            else if (valNum === 4) customDesc = 'Mellan 5 och 10 meter (5 - 10 m)';
            else if (valNum === 5) customDesc = 'Mellan 10 och 20 meter (10 - 20 m)';
            else if (valNum === 6) customDesc = 'Mer än 20 meter (> 20 m)';
            else customDesc = `Index: ${valNum}`;
            
            f.properties = {
              ...f.properties,
              description: customDesc
            };
          }
        }

        let title = '';
        if (f.properties?.LITOLOGI) {
          title = String(f.properties.LITOLOGI);
        } else if (f.properties?.jg2_tx) {
          title = String(f.properties.jg2_tx);
        } else if (f.properties?.NAMN || f.properties?.namn) {
          title = String(f.properties.NAMN || f.properties.namn);
        } else if (f.properties?.BRUNNSTYP) {
          title = String(f.properties.BRUNNSTYP);
        } else if (f.properties?.lamningtyp) {
          title = String(f.properties.lamningtyp);
        } else if (result.layerId === 'sgu_jorddjupsmodell') {
          title = f.properties?.description || `Djupindex: ${f.properties?.GRAY_INDEX ?? 'Okänt'}`;
        } else {
          title = f.id ? String(f.id).split('.').pop() || String(f.id) : `Träff ${idx + 1}`;
        }
        
        const props: Record<string, any> = {};
        if (f.properties) {
          Object.entries(f.properties).forEach(([k, v]) => {
            if (!isIgnoredProperty(k) && v !== null && v !== undefined && String(v).trim() !== '') {
              props[k] = v;
            }
          });
        }
        
        return { title, properties: props };
      });
    }

    if (result.type === 'text' && typeof result.data === 'string') {
      return [{ title: 'Beskrivning', properties: { 'Information': result.data } }];
    }

    return [];
  };

  const handleMapClick = async (latlng: [number, number], map: L.Map, containerPoint: L.Point) => {
    const queryLayers = wmsLayers.filter(l => l.enabled && l.clickQueryEnabled !== false);
    if (queryLayers.length === 0) return;

    setMapClickPos(latlng);
    setMapClickQueryLoading(true);
    setShowQueryResultsPanel(true);
    setMapClickQueryResults([]);

    const [lat, lng] = latlng;

    const queryPromises = queryLayers.map(async (layer) => {
      // Feature rest-based layers
      if (layer.type === 'feature') {
        const bbox = `${lng - 0.00035},${lat - 0.00015},${lng + 0.00035},${lat + 0.00015}`;
        const fetchUrl = `${layer.url}?bbox=${bbox}&limit=5&f=json`;
        try {
          const response = await fetch(fetchUrl);
          const json = await response.json();
          return {
            layerId: layer.id,
            layerName: layer.name,
            type: 'feature_json',
            data: json
          };
        } catch (err) {
          console.error(`Error querying OGC feature layer ${layer.name}:`, err);
          return {
            layerId: layer.id,
            layerName: layer.name,
            type: 'error',
            data: String(err)
          };
        }
      } else {
        // Standard WMS GetFeatureInfo
        const size = map.getSize();
        const bounds = map.getBounds();
        const sw = bounds.getSouthWest();
        const ne = bounds.getNorthEast();
        const isV13 = layer.version === '1.3.0';

        const bboxStr = isV13
          ? `${sw.lat},${sw.lng},${ne.lat},${ne.lng}`
          : `${sw.lng},${sw.lat},${ne.lng},${ne.lat}`;

        const x = Math.round(containerPoint.x);
        const y = Math.round(containerPoint.y);

        const params: Record<string, string> = {
          SERVICE: 'WMS',
          VERSION: layer.version || '1.1.1',
          REQUEST: 'GetFeatureInfo',
          LAYERS: layer.layers || '',
          QUERY_LAYERS: layer.layers || '',
          BBOX: bboxStr,
          FEATURE_COUNT: '5',
          WIDTH: String(size.x),
          HEIGHT: String(size.y),
          INFO_FORMAT: 'application/json'
        };

        if (isV13) {
          params.CRS = 'EPSG:4326';
          params.I = String(x);
          params.J = String(y);
        } else {
          params.SRS = 'EPSG:4326';
          params.X = String(x);
          params.Y = String(y);
        }

        const urlObj = new URL(layer.url);
        Object.entries(params).forEach(([key, val]) => {
          urlObj.searchParams.set(key, val);
        });

        try {
          const response = await fetch(urlObj.toString());
          const textResult = await response.text();
          try {
            const parsed = JSON.parse(textResult);
            return {
              layerId: layer.id,
              layerName: layer.name,
              type: 'wms_json',
              data: parsed
            };
          } catch {
            if (textResult && textResult.trim().length > 0 && !textResult.includes('<?xml') && !textResult.includes('<ServiceExceptionReport')) {
              return {
                layerId: layer.id,
                layerName: layer.name,
                type: 'text',
                data: textResult.substring(0, 500)
              };
            }
            return {
              layerId: layer.id,
              layerName: layer.name,
              type: 'html_or_empty',
              data: null
            };
          }
        } catch (err) {
          console.error(`Error querying WMS layer ${layer.name}:`, err);
          return {
            layerId: layer.id,
            layerName: layer.name,
            type: 'error',
            data: String(err)
          };
        }
      }
    });

    try {
      const results = await Promise.all(queryPromises);
      setMapClickQueryResults(results.filter(r => r !== null));
    } catch (err) {
      console.error("Error running map queries:", err);
    } finally {
      setMapClickQueryLoading(false);
    }
  };

  return (
    <div className="flex h-screen w-full bg-slate-100 text-slate-800 overflow-hidden font-sans">
      {/* Sidebar */}
      <aside 
        className="h-full border-r border-slate-200 bg-white flex flex-col z-[1001] shadow-lg transition-all duration-300 overflow-visible"
        style={{ 
          width: `${320 * uiScale}px`,
          minWidth: `${320 * uiScale}px`
        }}
      >
        <div className="flex flex-col w-[320px] shrink-0" style={{ height: `${100 / uiScale}%`, transform: `scale(${uiScale})`, transformOrigin: 'top left' }}>
          <div className="p-6 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <h1 className="text-[17px] tracking-tight text-slate-900 flex items-center shrink-0 select-none">
              <span className="font-black tracking-tight text-slate-950">SWEETSPOT</span>
              <span className="font-light text-slate-500 tracking-wide">FINDER</span>
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
                            onChange={(e) => updateSource(sid, { name: e.target.value })}
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

              <div className="grid grid-cols-4 gap-1">
                {(Object.entries(BASEMAPS) as [BasemapKey, typeof BASEMAPS['ortofoto']][]).map(([key, config]) => (
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
                    initial={{ opacity: 0, x: -12, scale: 0.95 }}
                    animate={{ opacity: 1, x: 0, scale: 1 }}
                    exit={{ opacity: 0, x: -12, scale: 0.95 }}
                    className="absolute left-[calc(100%+20px)] bottom-0 w-[290px] p-4 bg-white rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.15)] border border-slate-200/85 z-[2000]"
                  >
                    <div className="flex items-center justify-between mb-3 border-b border-slate-100 pb-2">
                      <span className="text-[11px] font-bold text-slate-700">Lager</span>
                      <button onClick={() => setShowLayerMenu(false)} className="text-slate-400 hover:text-slate-600">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="space-y-3.5 max-h-[300px] overflow-y-auto pr-1 custom-scrollbar">
                      {wmsLayers.map((layer, index) => (
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
                              <span className={`text-[11px] font-semibold transition-colors ${
                                layer.enabled ? 'text-slate-900' : 'text-slate-400'
                              }`}>
                                {layer.name}
                              </span>
                            </label>
                          </div>
                          
                          {layer.enabled && (
                            <div className="pl-5 space-y-2 border-l border-slate-100 mt-1">
                              <div className="space-y-1">
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
                              <div className="flex items-center justify-between pt-1">
                                <span className="text-[9px] text-slate-450 uppercase font-bold">Info på kartan</span>
                                <label className="relative inline-flex items-center cursor-pointer">
                                  <input 
                                    type="checkbox" 
                                    className="sr-only peer"
                                    checked={!!layer.clickQueryEnabled}
                                    onChange={(e) => updateWmsLayer(layer.id, { clickQueryEnabled: e.target.checked })}
                                  />
                                  <div className="w-6 h-3.5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-2.5 peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-2.5 after:w-2.5 after:transition-all peer-checked:bg-indigo-600"></div>
                                </label>
                              </div>
                            </div>
                          )}

                          {index < wmsLayers.length - 1 && (
                            <div className="border-b border-slate-100/70 pt-2" />
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
              zIndex={1}
            />
          )}
          {BASEMAPS[basemap].type === 'wms' && (
            <WMSTileLayer
              key={basemap}
              url={BASEMAPS[basemap].url}
              layers={BASEMAPS[basemap].layers || ''}
              attribution={BASEMAPS[basemap].attribution}
              format="image/png"
              transparent={BASEMAPS[basemap].transparent !== false}
              version={BASEMAPS[basemap].version || '1.1.1'}
              zIndex={1}
            />
          )}

          {/* Map Overlays */}
          {wmsLayers.filter(l => l.enabled).map(layer => {
            if (layer.type === 'wms') {
              return (
                <WMSTileLayer
                  key={layer.id}
                  url={layer.url}
                  layers={layer.layers || '0'}
                  attribution={layer.attribution}
                  format={layer.format || 'image/png'}
                  transparent={layer.transparent !== false}
                  opacity={layer.opacity}
                  version={layer.version || '1.1.1'}
                  zIndex={100}
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
            onMapClick={handleMapClick}
          />

          {/* Temporary click query position marker */}
          {mapClickPos && showQueryResultsPanel && (
            <>
              <CircleMarker
                center={mapClickPos}
                radius={18}
                pathOptions={{
                  fillColor: '#4f46e5',
                  color: '#ffffff',
                  weight: 1.5,
                  fillOpacity: 0.15,
                  dashArray: '3 3'
                }}
              />
              <CircleMarker
                center={mapClickPos}
                radius={6}
                pathOptions={{
                  fillColor: '#4f46e5',
                  color: '#ffffff',
                  weight: 2,
                  fillOpacity: 0.95
                }}
              >
                <Tooltip permanent direction="top" offset={[0, -6]}>
                  <div className="font-sans font-bold text-[10px] text-slate-800 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-600 animate-pulse" />
                    <span>Lagerinfo-punkt</span>
                  </div>
                </Tooltip>
              </CircleMarker>
            </>
          )}

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
                            opacity: 0.5,
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
                         <div class="w-5 h-5 rounded-full border-2 border-white shadow-lg overflow-hidden" 
                              style="opacity: 0.5; background: ${num === 3 ? 'repeating-linear-gradient(45deg, #000, #000 3px, #fff 3px, #fff 6px)' : (num === 2 ? '#111' : '#fff')};">
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
                        color: '#1e3a8a', // blue-900 (mörka färgen från panelen)
                        weight: (testLocation && showTestLocation) ? 11 : 9, 
                        opacity: (testLocation && showTestLocation) ? 0.95 : 0.85,
                        dashArray: 'none'
                      }} 
                    />
                    <Polyline 
                      positions={segmentB} 
                      pathOptions={{ 
                        color: '#60a5fa', // blue-400 (ljusare matchande blå)
                        weight: (testLocation && showTestLocation) ? 4.5 : 3.5, 
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
                  <div class="sweetspot-container" style="opacity: 0.85;">
                    <div class="sweetspot-ping-inner" style="border-color: ${activeScenario === 2 ? '#000' : '#fff'}; background: ${activeScenario === 2 ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.2)'};"></div>
                    <div class="sweetspot-ping-outer" style="border-color: ${activeScenario === 2 ? '#000' : '#fff'}; opacity: 0.3;"></div>
                    <div class="sweetspot-bullseye shadow-xl" style="background: ${activeScenario === 3 ? 'repeating-linear-gradient(45deg, #000, #000 4px, #fff 4px, #fff 8px)' : (activeScenario === 2 ? '#111' : '#fff')}; border-color: ${activeScenario === 1 ? '#e2e8f0' : '#fff'};">
                      <div class="bullseye-ring" style="border-color: ${activeScenario === 1 ? '#94a3b8' : '#fff'};"></div>
                      <div class="bullseye-dot" style="background: ${activeScenario === 1 ? '#94a3b8' : '#fff'};"></div>
                    </div>
                  </div>
                `,
                iconSize: [32, 32],
                iconAnchor: [16, 16]
              })}
            />
          )}

          {/* Hovered Elevation Profile Position Marker */}
          {hoveredProfilePoint && (
            <Marker 
              key="map-hover-profile-marker"
              position={[hoveredProfilePoint.lat, hoveredProfilePoint.lon]}
              icon={L.divIcon({
                className: 'hover-profile-marker-container',
                html: `
                  <div style="position: relative; width: 0px; height: 0px; pointer-events: none;">
                    <!-- Circle/Dot on Map Line -->
                    <div style="
                      position: absolute;
                      left: -5.5px;
                      top: -5.5px;
                      width: 11px;
                      height: 11px;
                      border-radius: 50%;
                      background-color: ${selectedSource?.color || '#6366f1'};
                      border: 2px solid #ffffff;
                      box-shadow: 0 1.5px 3px rgba(0,0,0,0.3);
                    "></div>
                    
                    <!-- Integrated Elevation Label Tag, Positioned exactly above and to the right -->
                    <div style="
                      position: absolute;
                      left: 8px;
                      top: -22px;
                      background-color: #ffffff;
                      border: 1px solid ${selectedSource?.color || '#6366f1'};
                      color: #0f172a;
                      font-size: 8px;
                      font-weight: bold;
                      padding: 1px 5px;
                      border-radius: 3.5px;
                      white-space: nowrap;
                      box-shadow: 0 1px 2px rgba(0,0,0,0.1);
                      font-family: inherit;
                      line-height: normal;
                    ">
                      ${hoveredProfilePoint.elevation.toFixed(1)} m
                    </div>
                  </div>
                `,
                iconSize: [0, 0],
                iconAnchor: [0, 0]
              })}
              zIndexOffset={10000}
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
                    const scenLoc = (scen.testLocation && scen.showTestLocation) 
                      ? scen.testLocation 
                      : runAnalysis(scen.sources).bestLoc;
                    
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
                  { label: 'Inre zon', color: '#10b981', val: analysis.thresholds.inner },
                  { label: 'Mellanzon', color: '#f59e0b', val: analysis.thresholds.middle },
                  { label: 'Yttre zon', color: '#6366f1', val: analysis.thresholds.outer }
                ].map(item => (
                  <div key={item.label} className="flex justify-between items-center py-2.5 px-3 rounded-xl border border-white/10 relative overflow-hidden group bg-white/[0.03] hover:bg-white/[0.06] transition-all">
                    <div className="flex items-center gap-3 relative z-10 w-full">
                      <div 
                        className="px-2.5 py-1 rounded-md text-[9px] font-black uppercase tracking-widest shadow-sm" 
                        style={{ 
                          backgroundColor: `${item.color}20`, // 20 hex is ~12% opacity
                          color: item.color,
                          border: `1px solid ${item.color}40` // 40 hex is ~25% opacity
                        }}
                      >
                        {item.label}
                      </div>
                      <div className="flex-1" />
                      <span className="font-mono font-black text-white text-[12px] tabular-nums bg-black/40 px-2.5 py-1 rounded-lg border border-white/10 shadow-inner">
                        {Math.round(item.val).toLocaleString('sv-SE')} kr
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </div>

        {/* Map Click Query Results Panel */}
        <AnimatePresence>
          {showQueryResultsPanel && mapClickPos && (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="absolute top-6 left-[340px] bg-white/95 backdrop-blur-md rounded-2xl border border-slate-200/80 shadow-[0_20px_50px_rgba(0,0,0,0.15)] z-[1000] overflow-hidden flex flex-col pointer-events-auto shadow-slate-400/20"
              style={{
                width: `${300 * uiScale}px`,
                maxHeight: `calc(100% - ${showElevationPanel ? 250 * uiScale : 60}px)`,
                transform: `scale(${uiScale})`,
                transformOrigin: 'top left'
              }}
            >
              {/* Header */}
              <div className="flex items-center justify-between p-3.5 border-b border-slate-100 bg-slate-50/85">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-lg bg-indigo-50 flex items-center justify-center">
                    <Info className="w-3.5 h-3.5 text-indigo-600" />
                  </div>
                  <div>
                    <h3 className="text-[10px] font-black text-slate-800 uppercase tracking-wider leading-none">Information på platsen</h3>
                    <p className="text-[8.5px] font-mono text-slate-400 leading-none mt-1">
                      {mapClickPos[0].toFixed(5)}°N, {mapClickPos[1].toFixed(5)}°Ö
                    </p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowQueryResultsPanel(false)}
                  className="w-5 h-5 rounded-full hover:bg-slate-200 text-slate-400 hover:text-slate-600 flex items-center justify-center transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto p-3.5 space-y-4 custom-scrollbar max-h-[460px]">
                {mapClickQueryLoading ? (
                  <div className="flex flex-col items-center justify-center py-10 space-y-3">
                    <div className="w-7 h-7 rounded-full border-2 border-slate-200 border-t-indigo-600 animate-spin" />
                    <span className="text-[10px] font-bold text-slate-500">Hämtar GIS-information...</span>
                  </div>
                ) : mapClickQueryResults && mapClickQueryResults.length > 0 ? (
                  (() => {
                    const activeAndEnabledResults = mapClickQueryResults.filter(result => {
                      const l = wmsLayers.find(layer => layer.id === result.layerId);
                      return l?.enabled && l?.clickQueryEnabled !== false;
                    });

                    if (activeAndEnabledResults.length === 0) {
                      return (
                        <div className="flex flex-col items-center justify-center py-8 text-center text-slate-400">
                          <MousePointerClick className="w-5 h-5 mb-2 text-indigo-400 animate-pulse" />
                          <p className="text-[10px] font-black uppercase text-slate-705 tracking-wider">Inga aktiva sökbara lager</p>
                          <p className="text-[9px] max-w-[180px] mt-1 leading-normal text-slate-450">
                            Aktivera först klick-info för dina lager i lagerlistan.
                          </p>
                        </div>
                      );
                    }

                    return activeAndEnabledResults.map((result) => {
                      const parsedFeatures = getQueryProperties(result);
                      return (
                        <div key={result.layerId} className="space-y-1.5 border-b border-slate-100 pb-3 last:border-0 last:pb-0">
                          <div className="flex items-center justify-between">
                            <span className="text-[9px] font-extrabold text-indigo-600 uppercase tracking-widest bg-indigo-50/70 px-1.5 py-0.5 rounded border border-indigo-100">
                              {result.layerName}
                            </span>
                          </div>

                          {parsedFeatures.length === 0 ? (
                            <div className="text-[10px] text-slate-450 italic pl-1 py-1">
                              Ingen information hittades på denna punkt.
                            </div>
                          ) : (
                            parsedFeatures.map((fea, fIdx) => (
                              <div key={fIdx} className="bg-slate-50/50 rounded-xl p-2.5 border border-slate-150/50 space-y-1.5">
                                {fea.title && (
                                  <div className="text-[10px] font-black text-slate-800 border-b border-slate-100 pb-1">
                                    {fea.title}
                                  </div>
                                )}
                                <div className="grid grid-cols-1 gap-1">
                                  {Object.entries(fea.properties).map(([k, v]) => (
                                    <div key={k} className="flex flex-col text-[10px]">
                                      <span className="text-slate-400 font-bold text-[8.5px] uppercase tracking-wide leading-none mb-0.5">
                                        {translatePropertyKey(k)}:
                                      </span>
                                      <span className="text-slate-700 font-medium leading-normal break-words">
                                        {String(v)}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      );
                    });
                  })()
                ) : (
                  <div className="flex flex-col items-center justify-center py-8 text-center text-slate-405">
                    <MousePointerClick className="w-5 h-5 mb-2 text-indigo-400 animate-bounce" />
                    <p className="text-[10px] font-black uppercase text-slate-700 tracking-wider">Klicka på kartan!</p>
                    <p className="text-[9px] max-w-[180px] mt-1 leading-normal text-slate-450">
                      Du har klick-info aktiverat för dina lager, så klicka på kartan för att hämta mätdata på platsen.
                    </p>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

         {/* Map Controls */}
        <div 
          className="absolute right-8 z-[1000] flex items-center gap-4 transition-all duration-300 pointer-events-auto"
          style={{ 
            bottom: showElevationPanel ? `${220 * uiScale}px` : `${32 * uiScale}px`,
            transform: `scale(${uiScale})`,
            transformOrigin: 'bottom right'
          }}
        >
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

        {/* Elevation Toggle Button */}
        {!showElevationPanel && (
          <button
            onClick={() => setShowElevationPanel(true)}
            className="absolute left-8 bottom-8 z-[1000] flex items-center gap-1.5 px-3 py-1.5 rounded-lg shadow-md border border-slate-100 bg-white hover:bg-slate-50 text-[11px] font-bold text-slate-700 shadow-slate-300/30 transition-all duration-300 active:scale-95 w-auto pointer-events-auto"
            style={{
              transform: `scale(${uiScale})`,
              transformOrigin: 'bottom left'
            }}
          >
            <Mountain className="w-3.5 h-3.5 text-indigo-500 animate-pulse" />
            <span>Höjdprofil</span>
          </button>
        )}

        {/* Elevation Profile Panel */}
        <AnimatePresence>
          {showElevationPanel && (
            <motion.div
              initial={{ opacity: 0, y: 150 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 150 }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="absolute bg-white/95 backdrop-blur-md rounded-xl border border-slate-200/80 shadow-[0_15px_40px_rgba(0,0,0,0.12)] z-[1000] overflow-hidden flex flex-col pointer-events-auto shadow-slate-400/20"
              style={{
                bottom: `${24 * uiScale}px`,
                left: `${24 * uiScale}px`,
                right: `${24 * uiScale}px`,
                height: `${180 * uiScale}px`,
                padding: `${10 * uiScale}px ${16 * uiScale}px`,
              }}
            >
              {/* Header */}
              <div 
                className="flex items-center justify-between border-b border-slate-100 pb-1.5 mb-1.5"
                style={{ paddingBottom: `${6 * uiScale}px`, marginBottom: `${6 * uiScale}px` }}
              >
                <div className="flex items-center" style={{ gap: `${8 * uiScale}px` }}>
                  <button 
                    onClick={() => setShowElevationPanel(false)}
                    className="flex items-center hover:opacity-75 active:scale-95 transition-all text-left group"
                    style={{ gap: `${6 * uiScale}px` }}
                  >
                    <div 
                      className="rounded bg-indigo-50 flex items-center justify-center shrink-0 group-hover:bg-indigo-100 transition-colors"
                      style={{ width: `${20 * uiScale}px`, height: `${20 * uiScale}px` }}
                    >
                      <Mountain className="text-indigo-600" style={{ width: `${12 * uiScale}px`, height: `${12 * uiScale}px` }} />
                    </div>
                    <h3 
                      className="font-extrabold text-slate-800 leading-none group-hover:text-indigo-600 transition-colors"
                      style={{ fontSize: `${12 * uiScale}px` }}
                    >
                      Höjdprofil
                    </h3>
                  </button>
                  <span 
                    className="text-slate-400 font-medium leading-none border-l border-slate-200 shrink-0 self-center"
                    style={{ fontSize: `${9 * uiScale}px`, paddingLeft: `${6 * uiScale}px`, marginLeft: `${6 * uiScale}px` }}
                  >
                    Källa: EU-DEM (Eurostat/GISCO)
                  </span>
                </div>

                <div className="flex items-center shrink-0" style={{ gap: `${12 * uiScale}px` }}>
                  {/* Selector drop-down */}
                  <div className="flex items-center" style={{ gap: `${6 * uiScale}px` }}>
                    <span className="font-semibold text-slate-500" style={{ fontSize: `${10 * uiScale}px` }}>Välj linje:</span>
                    <select
                      value={selectedProfileSourceId || ''}
                      onChange={(e) => setSelectedProfileSourceId(e.target.value)}
                      className="bg-slate-50 hover:bg-slate-100 border border-slate-200 font-bold rounded text-slate-700 outline-none focus:ring-2 focus:ring-indigo-100 transition-all cursor-pointer"
                      style={{ fontSize: `${11 * uiScale}px`, padding: `${4 * uiScale}px ${8 * uiScale}px` }}
                    >
                      {activeAndEnabledSources.map(s => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Close button */}
                  <button
                    onClick={() => setShowElevationPanel(false)}
                    className="rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-all active:scale-90"
                    style={{ width: `${24 * uiScale}px`, height: `${24 * uiScale}px` }}
                  >
                    <X style={{ width: `${14 * uiScale}px`, height: `${14 * uiScale}px` }} />
                  </button>
                </div>
              </div>

              {/* Panel Content Grid */}
              <div className="flex-1 flex items-stretch min-h-0" style={{ gap: `${20 * uiScale}px` }}>
                {/* Main chart rendering */}
                <div className="flex-1 relative min-w-0 bg-slate-50/20 border border-slate-100 rounded-xl flex items-center justify-center">
                  

                  {isFetchingElevation && (
                    <div className="flex flex-col items-center gap-2 text-slate-400">
                      <div className="rounded-full border-2 border-slate-300 border-t-indigo-600 animate-spin" style={{ width: `${20 * uiScale}px`, height: `${20 * uiScale}px` }} />
                      <span className="font-semibold" style={{ fontSize: `${12 * uiScale}px` }}>Hämtar höjddata...</span>
                    </div>
                  )}

                  {!isFetchingElevation && elevationError && (
                    <div className="text-rose-500 font-semibold p-4 text-center" style={{ fontSize: `${12 * uiScale}px` }}>
                      {elevationError}
                    </div>
                  )}

                  {!isFetchingElevation && !elevationError && (!elevationProfileData || elevationProfileData.length === 0) && (
                    <div className="text-slate-400 font-semibold p-4 text-center" style={{ fontSize: `${12 * uiScale}px` }}>
                      Ingen data tillgänglig. Säkerställ att källan är aktiverad och har en giltig rutt.
                    </div>
                  )}

                  {!isFetchingElevation && !elevationError && elevationProfileData && elevationProfileData.length > 0 && (() => {
                    const isUsingTestLoc = !!(testLocation && showTestLocation);
                    return (
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart
                          data={elevationProfileData}
                          style={{ overflow: 'visible' }}
                          margin={{ 
                            top: 18 * uiScale, 
                            right: 15 * uiScale, 
                            left: -22 * uiScale, 
                            bottom: -8 * uiScale 
                          }}
                          onMouseMove={(state: any) => {
                            if (state && state.activePayload && state.activePayload.length > 0) {
                              setHoveredProfilePoint(state.activePayload[0].payload as ElevationPoint);
                            } else {
                              setHoveredProfilePoint(null);
                            }
                          }}
                          onMouseLeave={() => setHoveredProfilePoint(null)}
                        >
                          <defs>
                            <linearGradient id="elevationGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor={selectedSource?.color || '#6366f1'} stopOpacity={0.4}/>
                              <stop offset="95%" stopColor={selectedSource?.color || '#6366f1'} stopOpacity={0.0}/>
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                          <XAxis 
                            dataKey="distance" 
                            stroke="#94a3b8" 
                            fontSize={9 * uiScale} 
                            tickLine={false}
                            ticks={xAxisTicks}
                            type="number"
                            domain={[0, elevationStats?.totalDistance || 'auto']}
                            tickFormatter={(v) => `${Math.round(v)} m`}
                          />
                          <YAxis 
                            stroke="#94a3b8" 
                            fontSize={9 * uiScale} 
                            tickLine={false}
                            ticks={yAxisTicksAndDomain.ticks}
                            type="number"
                            domain={yAxisTicksAndDomain.domain}
                            tickFormatter={(v) => `${Math.round(v)} m`}
                          />
                          <RechartsTooltip
                            cursor={{ stroke: '#cbd5e1', strokeWidth: 1.2 * uiScale, strokeDasharray: '3 3' }}
                            content={() => <div style={{ display: 'none' }} />}
                          />
                          <Area 
                            type="monotone" 
                            dataKey="elevation" 
                            stroke={selectedSource?.color || '#6366f1'} 
                            strokeWidth={2 * uiScale}
                            fillOpacity={1} 
                            fill="url(#elevationGrad)" 
                            activeDot={(props: any) => {
                              const { cx, cy, payload } = props;
                              if (cx == null || cy == null || !payload) return null;
                              
                              const elevText = `${payload.elevation.toFixed(1)} m`;
                              const width = Math.max(45 * uiScale, (elevText.length * 4.8 + 10) * uiScale);
                              const height = 15 * uiScale;
                              
                              // Position exactly above and to the right of the hover point
                              const rectX = 8 * uiScale;
                              const rectY = -22 * uiScale;
                              const textX = rectX + width / 2;
                              const textY = rectY + height - 3.5 * uiScale;
                              
                              return (
                                <g className="pointer-events-none">
                                  <circle 
                                    cx={cx} 
                                    cy={cy} 
                                    r={5.5 * uiScale} 
                                    fill={selectedSource?.color || '#6366f1'} 
                                    stroke="#ffffff" 
                                    strokeWidth={2 * uiScale}
                                    style={{ filter: 'drop-shadow(0 1.5px 3px rgba(0,0,0,0.3))' }}
                                  />
                                  <rect 
                                    x={cx + rectX} 
                                    y={cy + rectY} 
                                    width={width} 
                                    height={height} 
                                    rx={3.5 * uiScale} 
                                    fill="#ffffff" 
                                    fillOpacity={0.95}
                                    stroke={selectedSource?.color || '#6366f1'}
                                    strokeOpacity={0.7}
                                    strokeWidth={1}
                                    style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.1))' }}
                                  />
                                  <text 
                                    x={cx + textX} 
                                    y={cy + textY} 
                                    fill="#0f172a" 
                                    fillOpacity={0.9}
                                    fontSize={8 * uiScale} 
                                    fontWeight="bold" 
                                    textAnchor="middle"
                                  >
                                    {elevText}
                                  </text>
                                </g>
                              );
                            }}
                          />

                           {/* Reference markers for START and END on the graph curve, visually aligned with map designs */}
                          <ReferenceDot 
                            key="start-dot"
                            x={0} 
                            y={elevationProfileData[0].elevation} 
                            shape={(props: any) => {
                              const { cx, cy } = props;
                              if (cx == null || cy == null) return null;
                              
                              const sourceName = selectedSource?.name || 'Källpunkt';
                              const labelText = `${sourceName}: ${elevationProfileData[0].elevation.toFixed(1)} m`;
                              const textWidth = (labelText.length * 4.8 + 10) * uiScale;
                              const height = 15 * uiScale;
                              const rectX = 8 * uiScale;
                              const rectY = -22 * uiScale;
                              const textX = rectX + textWidth / 2;
                              const textY = rectY + height - 3.5 * uiScale;
                              
                              return (
                                <g className="pointer-events-none" transform={`translate(${cx}, ${cy})`}>
                                  <circle 
                                    cx={0} 
                                    cy={0} 
                                    r={6.5 * uiScale} 
                                    fill={selectedSource?.color || '#6366f1'} 
                                    stroke="#ffffff" 
                                    strokeWidth={1.5 * uiScale} 
                                    style={{ filter: 'drop-shadow(0 1.5px 3px rgba(0,0,0,0.3))' }} 
                                  />
                                  
                                  {/* Semi-transparent label aligned neatly to the upper right, always visible */}
                                  <g>
                                    <rect 
                                      x={rectX} 
                                      y={rectY} 
                                      width={textWidth} 
                                      height={height} 
                                      rx={3.5 * uiScale} 
                                      fill="#0f172a" 
                                      fillOpacity={0.45}
                                      stroke="#ffffff"
                                      strokeOpacity={0.15}
                                      strokeWidth={1}
                                    />
                                    <text 
                                      x={textX} 
                                      y={textY} 
                                      fill="#ffffff" 
                                      fillOpacity={0.75}
                                      fontSize={8 * uiScale} 
                                      fontWeight="bold" 
                                      textAnchor="middle"
                                    >
                                      {labelText}
                                    </text>
                                  </g>
                                </g>
                              );
                            }}
                            isFront={true}
                          />
                          <ReferenceDot 
                            key="end-dot"
                            x={elevationProfileData[elevationProfileData.length - 1].distance} 
                            y={elevationProfileData[elevationProfileData.length - 1].elevation} 
                            shape={(props: any) => {
                              const { cx, cy } = props;
                              if (cx == null || cy == null) return null;
                              
                              const targetName = isUsingTestLoc ? 'Vald plats' : 'Sweetspot';
                              const labelText = `${targetName}: ${elevationProfileData[elevationProfileData.length - 1].elevation.toFixed(1)} m`;
                              const textWidth = (labelText.length * 4.8 + 10) * uiScale;
                              const height = 15 * uiScale;
                              const rectX = -textWidth - 8 * uiScale;
                              const rectY = -24 * uiScale;
                              const textX = rectX + textWidth / 2;
                              const textY = rectY + height - 3.5 * uiScale;
                              
                              const isScenario3 = activeScenario === 3;
                              const isScenario2 = activeScenario === 2;
                              const isScenario1 = activeScenario === 1;

                              const bg = isScenario3 
                                ? 'url(#stripePattern)' 
                                : (isScenario2 ? '#111111' : '#ffffff');
                              const borderCol = isScenario1 ? '#e2e8f0' : '#ffffff';
                              const ringCol = isScenario1 ? '#94a3b8' : '#ffffff';
                              const dotCol = isScenario1 ? '#94a3b8' : '#ffffff';

                              return (
                                <g className="pointer-events-none" transform={`translate(${cx}, ${cy})`}>
                                  {isScenario3 && (
                                    <defs>
                                      <pattern id="stripePattern" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                                        <rect width="3" height="6" fill="#000000" />
                                        <rect x="3" width="3" height="6" fill="#ffffff" />
                                      </pattern>
                                    </defs>
                                  )}
                                  
                                  {isUsingTestLoc ? (
                                    <g transform={`translate(${-10 * uiScale}, ${-19 * uiScale})`}>
                                      <svg width={20 * uiScale} height={20 * uiScale} viewBox="0 0 24 24" fill="none" stroke="#4778A5" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ filter: 'drop-shadow(0 1.5px 2.5px rgba(0,0,0,0.3))' }}>
                                        <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0Z"/>
                                        <circle cx="12" cy="10" r="3" fill="white"/>
                                      </svg>
                                    </g>
                                  ) : (
                                    <>
                                      <circle cx={0} cy={0} r={8.5 * uiScale} fill={bg} stroke={borderCol} strokeWidth={1.5 * uiScale} style={{ filter: 'drop-shadow(0 1.5px 3px rgba(0,0,0,0.3))' }} />
                                      <circle cx={0} cy={0} r={4.5 * uiScale} fill="none" stroke={ringCol} strokeWidth={1.2 * uiScale} />
                                      <circle cx={0} cy={0} r={1.2 * uiScale} fill={dotCol} />
                                    </>
                                  )}
                                  
                                  {/* Semi-transparent label offset to the upper left, always visible */}
                                  <g>
                                    <rect 
                                      x={rectX} 
                                      y={rectY} 
                                      width={textWidth} 
                                      height={height} 
                                      rx={3.5 * uiScale} 
                                      fill="#0f172a" 
                                      fillOpacity={0.45}
                                      stroke="#ffffff"
                                      strokeOpacity={0.15}
                                      strokeWidth={1}
                                    />
                                    <text 
                                      x={textX} 
                                      y={textY} 
                                      fill="#ffffff" 
                                      fillOpacity={0.75}
                                      fontSize={8 * uiScale} 
                                      fontWeight="bold" 
                                      textAnchor="middle"
                                    >
                                      {labelText}
                                    </text>
                                  </g>
                                </g>
                              );
                            }}
                            isFront={true}
                          />

                           {/* Intermediate custom node markers on the profile path */}
                          {nodeProfilePoints.map((nd, idx) => (
                            <ReferenceDot 
                              key={`ref-node-${idx}`}
                              x={nd.distance} 
                              y={nd.elevation} 
                              shape={(props: any) => {
                                const { cx, cy } = props;
                                if (cx == null || cy == null) return null;
                                return (
                                  <g className="pointer-events-none" transform={`translate(${cx}, ${cy})`}>
                                    <circle 
                                      cx={0} 
                                      cy={0} 
                                      r={5 * uiScale} 
                                      fill="#ffffff" 
                                      stroke="#000000" 
                                      strokeWidth={1.5 * uiScale} 
                                      style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.2))' }}
                                    />
                                    <text 
                                      y={-8 * uiScale} 
                                      textAnchor="middle" 
                                      className="font-bold fill-slate-500 font-sans pointer-events-none select-none"
                                      style={{ fontSize: `${9 * uiScale}px` }}
                                    >
                                      {nd.index + 1}
                                    </text>
                                  </g>
                                );
                              }}
                              isFront={true}
                            />
                          ))}
                        </AreaChart>
                      </ResponsiveContainer>
                    );
                  })()}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

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
                <span className="text-xs font-medium tracking-wide">Klicka på kartan för att flytta allt</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
