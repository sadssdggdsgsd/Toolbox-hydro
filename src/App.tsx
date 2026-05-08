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
  useMapEvents 
} from 'react-leaflet';
import L from 'leaflet';
import { 
  Plus, 
  Target,
  RotateCcw,
  Info,
  MapPin,
  Layers,
  Undo2,
  X,
  Move,
  MousePointer2,
  ChevronDown
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
    cost: 1500,
    weight: 1.0,
    nodes: [],
    enabled: true
  },
  'Vatten-VA': {
    name: 'Vatten-VA',
    loc: [62.520967, 16.791220],
    color: '#22c55e', // green-500
    cost: 1500,
    weight: 1.0,
    nodes: [],
    enabled: true
  },
  'El': {
    name: 'El',
    loc: [62.520967, 16.708780],
    color: '#ef4444', // red-500
    cost: 1500,
    weight: 1.0,
    nodes: [],
    enabled: true
  },
  'Väg': {
    name: 'Väg',
    loc: [62.559033, 16.708780],
    color: '#8b5cf6', // violet-500
    cost: 1500,
    weight: 1.0,
    nodes: [],
    enabled: true
  }
};

const COST_TEMPLATES: Record<string, { label: string; subLabel: string; value: number }[]> = {
  'El': [
    { label: '1 – 10 MW', subLabel: '10 - 24 kV • 1 200 kr/m', value: 1200 },
    { label: '10 – 50 MW', subLabel: '24 - 130 kV • 8 000 kr/m', value: 8000 },
    { label: '50 – 200 MW', subLabel: '130 kV • 20 000 kr/m', value: 20000 },
    { label: '200 – 1000 MW', subLabel: '130 - 400 kV • 30 000 kr/m', value: 30000 },
  ],
  'Väg': [
    { label: 'Enkel industriväg', subLabel: '6-7 m bred, asfalt • 20 000 kr/m', value: 20000 },
    { label: 'Tung industriväg', subLabel: '8 m bred, förstärkt bärighet • 50 000 kr/m', value: 50000 },
    { label: 'Logistikled', subLabel: '10-12 m bred, svängradier • 100 000 kr/m', value: 100000 },
  ],
  'Vatten-VA': [
    { label: 'Standard', subLabel: 'DN 110 – 160 mm • 5 000 kr/m', value: 5000 },
    { label: 'Utökad', subLabel: 'DN 200 – 250 mm • 10 000 kr/m', value: 10000 },
    { label: 'Huvudledning', subLabel: 'DN 315 – 450 mm • 15 000 kr/m', value: 15000 },
    { label: 'Magistral', subLabel: 'DN 500 – 800+ mm • 30 000 kr/m', value: 30000 },
  ],
  'Tekniskt vatten': [
    { label: 'Lågt behov', subLabel: '< 200 m³/dygn • 3 000 kr/m', value: 3000 },
    { label: 'Måttligt behov', subLabel: '200 – 1 000 m³/dygn • 7 000 kr/m', value: 7000 },
    { label: 'Högt behov', subLabel: '1 000 – 4 000 m³/dygn • 15 000 kr/m', value: 15000 },
    { label: 'Mycket högt behov', subLabel: '5 000 – 25 000 m³/dygn • 30 000 kr/m', value: 30000 },
  ]
};

const getSourceTheme = (name: string) => {
  switch (name) {
    case 'Tekniskt vatten':
      return {
        card: 'border-cyan-100 bg-cyan-50/30',
        title: 'text-cyan-700',
        action: 'bg-cyan-500',
        track: 'bg-cyan-200',
        btnBorder: 'border-cyan-200',
        btnText: 'text-cyan-600',
        btnHover: 'hover:bg-cyan-100'
      };
    case 'Vatten-VA':
      return {
        card: 'border-green-100 bg-green-50/30',
        title: 'text-green-700',
        action: 'bg-green-500',
        track: 'bg-green-200',
        btnBorder: 'border-green-200',
        btnText: 'text-green-600',
        btnHover: 'hover:bg-green-100'
      };
    case 'El':
      return {
        card: 'border-red-100 bg-red-50/30',
        title: 'text-red-700',
        action: 'bg-red-500',
        track: 'bg-red-200',
        btnBorder: 'border-red-200',
        btnText: 'text-red-600',
        btnHover: 'hover:bg-red-100'
      };
    case 'Väg':
      return {
        card: 'border-violet-100 bg-violet-50/30',
        title: 'text-violet-700',
        action: 'bg-violet-500',
        track: 'bg-violet-200',
        btnBorder: 'border-violet-200',
        btnText: 'text-violet-600',
        btnHover: 'hover:bg-violet-100'
      };
    default:
      return {
        card: 'border-slate-100 bg-slate-50/30',
        title: 'text-slate-700',
        action: 'bg-slate-500',
        track: 'bg-slate-200',
        btnBorder: 'border-slate-200',
        btnText: 'text-slate-600',
        btnHover: 'hover:bg-slate-100'
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

export default function App() {
  const [sources, setSources] = useState<Record<string, Source>>(INITIAL_SOURCES);
  const [activeSource, setActiveSource] = useState<string | null>(null);
  const [activeAction, setActiveAction] = useState<ActiveAction>(null);
  const [testLocation, setTestLocation] = useState<[number, number] | null>(null);
  const [placingTestLocation, setPlacingTestLocation] = useState(false);
  const [basemap, setBasemap] = useState<BasemapKey>('orto');
  const [openTemplateMenu, setOpenTemplateMenu] = useState<string | null>(null);
  
  // Visibility states
  const [showSweetSpot, setShowSweetSpot] = useState(true);
  const [showTestLocation, setShowTestLocation] = useState(true);
  const [isRelocatingSweetSpot, setIsRelocatingSweetSpot] = useState(false);

  const analysis = useMemo(() => runAnalysis(sources), [sources]);

  const sourceDistances = useMemo(() => {
    const dists: Record<string, number> = {};
    const target = testLocation || analysis.bestLoc;
    (Object.entries(sources) as [string, Source][]).forEach(([name, data]) => {
      let dist = 0;
      let curr = data.loc;
      for (const node of data.nodes) {
        dist += getDistance(curr, node);
        curr = node;
      }
      dist += getDistance(curr, target);
      dists[name] = dist;
    });
    return dists;
  }, [sources, analysis.bestLoc, testLocation]);

  const testLocationResult = useMemo(() => {
    if (!testLocation) return null;
    return getCostAt(sources, testLocation);
  }, [sources, testLocation]);

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

  const handleMapAction = (latlng: [number, number]) => {
    if (activeSource && activeAction === 'node') {
      addNode(activeSource, latlng);
    }
  };

  const handleRelocate = (latlng: [number, number]) => {
    const currentSweetSpot = analysis.bestLoc;
    const deltaLat = latlng[0] - currentSweetSpot[0];
    const deltaLon = latlng[1] - currentSweetSpot[1];

    setSources(prev => {
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
      <aside className="w-80 h-full border-r border-slate-200 bg-white flex flex-col z-10 shadow-lg">
        <div className="p-6 border-b border-slate-100">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
              Sweetspotfinder
            </h1>
            <div className="flex gap-2 p-1.5 bg-slate-50 rounded-2xl border border-slate-100 shadow-inner">
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
                title="Flytta allt (relokera hela systemet)"
              >
                <Move className={`w-5 h-5 ${isRelocatingSweetSpot ? 'animate-pulse' : ''}`} />
              </button>

              {/* Toggle Sweet Spot Button */}
              <button 
                onClick={() => setShowSweetSpot(!showSweetSpot)}
                className={`p-2 rounded-xl transition-all group relative ${
                  showSweetSpot 
                    ? 'bg-[#393F4C] text-white shadow-lg ring-2 ring-slate-200' 
                    : 'text-slate-400 hover:text-slate-600 hover:bg-white hover:shadow-sm'
                }`}
                title="Visa/dölj Sweet Spot"
              >
                <Target className="w-5 h-5" />
              </button>

              {/* Manual/Test Location Button */}
              <button 
                onClick={() => {
                  if (testLocation) {
                    setShowTestLocation(!showTestLocation);
                    setPlacingTestLocation(false);
                  } else {
                    setPlacingTestLocation(!placingTestLocation);
                  }
                  setIsRelocatingSweetSpot(false);
                }}
                className={`p-2 rounded-xl transition-all group relative ${
                  (testLocation && showTestLocation) || placingTestLocation
                    ? 'bg-[#4778A5] text-white shadow-lg ring-2 ring-blue-100' 
                    : 'text-slate-400 hover:text-slate-600 hover:bg-white hover:shadow-sm'
                }`}
                title={testLocation ? "Visa/dölj vald plats" : "Välj plats på karta"}
              >
                <MapPin className={`w-5 h-5 ${placingTestLocation ? 'animate-pulse' : ''}`} />
              </button>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
          {(Object.entries(sources) as [string, Source][]).map(([name, data]) => {
            const theme = getSourceTheme(name);
            return (
              <motion.div 
                key={name}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`p-4 rounded-xl border-2 transition-all ${theme.card} ${
                  activeSource === name ? 'ring-2 ring-offset-2 ring-slate-200' : ''
                } ${!data.enabled ? 'opacity-50 saturate-0' : ''}`}
              >
                <div className="flex items-center justify-between mb-3 border-b border-black/5 pb-2">
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => updateSource(name, { enabled: !data.enabled })}
                      className={`w-8 h-4 rounded-full relative transition-colors cursor-pointer ${data.enabled ? theme.action : 'bg-slate-300'}`}
                    >
                      <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${data.enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                    </button>
                  <h3 className={`font-bold text-sm ${theme.title}`}>{name}</h3>
                </div>
              </div>

              {/* Tools */}
                {data.enabled && (
                  <div className="flex gap-1 mb-4">
                    <button
                      onClick={() => {
                        if (activeSource === name && activeAction === 'node') {
                          setActiveSource(null);
                          setActiveAction(null);
                        } else {
                          setActiveSource(name);
                          setActiveAction('node');
                        }
                      }}
                      className={`flex-[2] py-1 text-[9px] font-bold rounded uppercase tracking-tighter transition-all ${
                        activeSource === name && activeAction === 'node'
                          ? `${theme.action} text-white shadow-sm`
                          : 'bg-white border border-slate-200 text-slate-500 hover:border-slate-300'
                      }`}
                    >
                      + Noder
                    </button>
                    <button 
                      onClick={() => undoNode(name)}
                      disabled={data.nodes.length === 0}
                      className={`flex-1 py-1 text-[9px] bg-white border rounded font-bold transition-colors disabled:opacity-30 ${theme.btnBorder} ${theme.btnText} ${theme.btnHover}`}
                    >
                      <Undo2 className="w-3 h-3 mx-auto" />
                    </button>
                    <button 
                      onClick={() => clearNodes(name)}
                      className={`flex-1 py-1 text-[9px] bg-white border border-slate-200 rounded font-bold transition-colors text-red-500 hover:bg-red-50`}
                    >
                      Rensa
                    </button>
                  </div>
                )}

                {/* Inputs */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="relative">
                    <div className="flex justify-between items-center h-7 mb-1">
                      <label className="text-[10px] text-slate-400 uppercase font-bold tracking-tight">Kr/m</label>
                      {COST_TEMPLATES[name] && (
                        <div className="relative">
                          <button 
                            onClick={() => setOpenTemplateMenu(openTemplateMenu === name ? null : name)}
                            className={`p-1 rounded-md border transition-all shadow-sm ${
                              openTemplateMenu === name 
                              ? 'bg-slate-100 border-slate-300 text-slate-900 shadow-inner' 
                              : 'bg-white border-slate-200 text-slate-400 hover:bg-slate-50 hover:border-slate-300 hover:text-slate-700'
                            }`}
                            title="Välj schablonkostnad"
                          >
                            <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${openTemplateMenu === name ? 'rotate-180' : ''}`} />
                          </button>
                          
                          <AnimatePresence>
                            {openTemplateMenu === name && (
                              <motion.div 
                                initial={{ opacity: 0, y: 5, scale: 0.95 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, y: 5, scale: 0.95 }}
                                className="absolute left-0 top-full mt-2 w-64 bg-white rounded-xl shadow-2xl border border-slate-200 z-[100] overflow-hidden p-1.5"
                              >
                                <div className="px-2 py-1.5 mb-1.5 border-b border-slate-50">
                                  <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Välj schablon</div>
                                </div>
                                {COST_TEMPLATES[name].map((tpl, i) => (
                                  <button
                                    key={i}
                                    onClick={() => {
                                      updateSource(name, { cost: tpl.value });
                                      setOpenTemplateMenu(null);
                                    }}
                                    className={`w-full text-left px-3 py-2.5 rounded-lg transition-all group ${theme.btnHover}`}
                                  >
                                    <div className="flex items-start gap-3">
                                      <div className={`w-1 h-8 rounded-full mt-0.5 shrink-0 ${theme.action} opacity-20 group-hover:opacity-100 transition-opacity`} />
                                      <div>
                                        <div className={`text-[11px] font-bold ${theme.title} transition-colors`}>{tpl.label}</div>
                                        <div className="text-[10px] text-slate-500 font-medium group-hover:text-slate-700 mt-0.5">{tpl.subLabel}</div>
                                      </div>
                                    </div>
                                  </button>
                                ))}
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      )}
                    </div>
                    <input 
                      type="number" 
                      value={data.cost}
                      step="500"
                      onChange={(e) => updateSource(name, { cost: parseInt(e.target.value) || 0 })}
                      className="w-full text-xs p-1.5 border border-slate-200 rounded bg-white font-medium focus:outline-none focus:ring-1 focus:ring-slate-300"
                    />
                  </div>
                  <div>
                    <div className="flex items-center h-7 mb-1">
                      <label className="text-[10px] text-slate-400 uppercase font-bold tracking-tight">Vikt</label>
                    </div>
                    <div className="flex items-center gap-2">
                       <input 
                        type="range" 
                        min="0.1" 
                        max="1" 
                        step="0.1"
                        value={data.weight}
                        onChange={(e) => updateSource(name, { weight: parseFloat(e.target.value) })}
                        className={`w-full h-1 my-2 rounded-lg appearance-none cursor-pointer ${theme.track}`}
                      />
                      <span className="text-[10px] font-mono font-bold text-slate-500">{data.weight.toFixed(1)}</span>
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Basemap Switcher */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 space-y-3">
          <div className="flex items-center gap-2">
            <Layers className="w-3 h-3 text-slate-400" />
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Bakgrundskarta</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {(Object.entries(BASEMAPS) as [keyof typeof BASEMAPS, typeof BASEMAPS['orto']][]).map(([key, config]) => (
              <button
                key={key}
                onClick={() => setBasemap(key)}
                className={`flex-1 py-1.5 text-[9px] font-bold rounded transition-all ${
                  basemap === key 
                    ? 'bg-slate-800 text-white shadow-md' 
                    : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-100'
                }`}
              >
                {config.name}
              </button>
            ))}
          </div>
        </div>

      </aside>

      {/* Main Map */}
      <main className="flex-1 relative bg-slate-200">
        <MapContainer 
          center={analysis.bestLoc} 
          zoom={13} 
          className="h-full w-full"
          zoomControl={false}
        >
          {/* Basemap Rendering */}
          {BASEMAPS[basemap].type === 'tile' && (
            <TileLayer
              key={basemap}
              url={BASEMAPS[basemap].url}
              attribution={BASEMAPS[basemap].attribution}
            />
          )}
          
          <MapClickHandler 
            activeSource={activeSource} 
            activeAction={activeAction} 
            placingTestLocation={placingTestLocation}
            isRelocatingSweetSpot={isRelocatingSweetSpot}
            onAction={handleMapAction} 
            onPlaceTest={(latlng) => {
              setTestLocation(latlng);
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
          {(Object.entries(sources) as [string, Source][]).map(([name, data]) => {
            const target = (testLocation && showTestLocation) ? testLocation : analysis.bestLoc;
            const path = [data.loc, ...data.nodes, target];
            return (
              <React.Fragment key={name}>
                {data.enabled && (
                  <Polyline 
                    positions={path} 
                    pathOptions={{ 
                      color: data.color, 
                      weight: (testLocation && showTestLocation) ? 4 : 2, 
                      opacity: (testLocation && showTestLocation) ? 0.8 : 0.3,
                      dashArray: (testLocation && showTestLocation) ? 'none' : '8, 4'
                    }} 
                  />
                )}
                <Marker 
                  position={data.loc}
                  draggable={true}
                  eventHandlers={{
                    dragend: (e) => {
                      const marker = e.target;
                      const position = marker.getLatLng();
                      updateSource(name, { loc: [position.lat, position.lng] });
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
                      <span>{name}</span>
                    </Tooltip>
                  )}
                </Marker>
                {data.nodes.map((node, ni) => (
                  <Marker 
                    key={`${name}-node-${ni}`}
                    position={node} 
                    draggable={true}
                    eventHandlers={{
                      dragend: (e) => {
                        const marker = e.target;
                        const position = marker.getLatLng();
                        const newNodes = [...data.nodes];
                        newNodes[ni] = [position.lat, position.lng];
                        updateSource(name, { nodes: newNodes });
                      },
                    }}
                    icon={L.divIcon({
                      className: 'node-marker',
                      html: `<div style="background-color: #fff; opacity: ${data.enabled ? 0.8 : 0.1}; width: 10px; height: 10px; border-radius: 50%; border: 1px solid #000;"></div>`,
                      iconSize: [10, 10],
                      iconAnchor: [5, 5]
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
                    <div class="sweetspot-ping-inner" style="border-color: #fff; background: rgba(255,255,255,0.3);"></div>
                    <div class="sweetspot-ping-outer" style="border-color: #fff; opacity: 0.4;"></div>
                    <div class="sweetspot-dot" style="background: #fff; box-shadow: 0 0 12px rgba(255,255,255,0.6);"></div>
                  </div>
                `,
                iconSize: [30, 30],
                iconAnchor: [15, 15]
              })}
            />
          )}
        </MapContainer>

        <div className="absolute top-6 right-6 z-[1000] w-80 max-h-[90%] flex flex-col gap-4 pointer-events-none">
          {/* Selected Location Panel */}
          {testLocationResult && showTestLocation && (
            <motion.div 
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="bg-white/95 backdrop-blur-xl p-5 rounded-[2rem] shadow-[0_20px_50px_-12px_rgba(0,0,0,0.2)] border border-white pointer-events-auto"
            >
              <div className="flex justify-between items-center mb-4 pb-4 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-[#4778A5]" fill="#4778A520" />
                  <span className="text-slate-800 font-black tracking-tight text-[11px] uppercase">Vald plats</span>
                </div>
                <div className="font-mono font-black text-slate-800 text-base">
                  {Math.round(testLocationResult.total).toLocaleString('sv-SE')} kr
                </div>
              </div>
              
              <div className="space-y-2">
                {Object.entries(testLocationResult.breakdown).map(([name, val]) => (
                  <div key={name} className="flex justify-between items-center bg-slate-50 p-2 px-3 rounded-xl border border-slate-100">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: sources[name].color }} />
                      <span className="text-[10px] font-bold text-slate-600">{name}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[9px] font-mono font-medium text-slate-400">
                        {Math.round(sourceDistances[name]).toLocaleString('sv-SE')} m
                      </span>
                      <span className="text-[10px] font-mono font-black text-slate-900">
                        {Math.round(val as number).toLocaleString('sv-SE')} kr
                      </span>
                    </div>
                  </div>
                ))}
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
              <div className="flex justify-between items-center mb-4 pb-4 border-b border-white/5">
                <div className="flex items-center gap-3">
                  <div className="relative flex items-center justify-center">
                    <div className="absolute w-4 h-4 rounded-full border border-white/30 animate-ping" />
                    <div className="w-2 h-2 rounded-full bg-white ring-2 ring-white/10" />
                  </div>
                  <span className="text-white font-black tracking-tight text-[11px] uppercase">Sweet spot</span>
                </div>
                <span className="font-mono font-black text-white text-base">{Math.round(analysis.minVal).toLocaleString('sv-SE')} kr</span>
              </div>

              <div className="space-y-1.5">
                {[
                  { label: 'Inre zon', color: '#ff5500', val: analysis.thresholds.inner },
                  { label: 'Mellanzon', color: '#ffaa00', val: analysis.thresholds.middle },
                  { label: 'Yttre zon', color: '#ffff00', val: analysis.thresholds.outer }
                ].map(item => (
                  <div key={item.label} className="flex justify-between items-center py-1.5 px-3 rounded-lg border border-white/5 relative overflow-hidden group">
                    {/* Colored Band Background */}
                    <div 
                      className="absolute inset-0 opacity-25" 
                      style={{ backgroundColor: item.color }} 
                    />
                    <div className="relative z-10">
                      <div className="text-white text-[9px] font-bold uppercase tracking-widest">{item.label}</div>
                    </div>
                    <span className="relative z-10 font-mono font-black text-white/90 text-[10px]">{Math.round(item.val).toLocaleString('sv-SE')} kr</span>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </div>

        {/* Map Controls */}
        <div className="absolute bottom-8 right-8 z-[1000] flex flex-col gap-2 items-end">
          <div className="flex flex-col gap-2">
            <button className="w-10 h-10 bg-white rounded-full shadow-lg flex items-center justify-center text-slate-600 font-bold hover:bg-slate-50 border border-slate-100">+</button>
            <button className="w-10 h-10 bg-white rounded-full shadow-lg flex items-center justify-center text-slate-600 font-bold hover:bg-slate-50 border border-slate-100">-</button>
          </div>
        </div>

        <AnimatePresence>
          {isRelocatingSweetSpot && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="absolute top-8 left-1/2 -translate-x-1/2 z-[2000] pointer-events-none"
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
