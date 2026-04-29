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
  Tooltip, 
  useMapEvents 
} from 'react-leaflet';
import L from 'leaflet';
import { 
  Droplet, 
  Zap, 
  Waves, 
  Target, 
  Move, 
  Plus, 
  Lock, 
  RotateCcw,
  Info,
  MapPin,
  Layers,
  Undo2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Source, ActiveAction, AnalysisResult } from './types';
import { runAnalysis, getCostAt } from './analysis';

// Basemap options
type BasemapKey = 'orto' | 'standard' | 'jordart' | 'cyclosm';

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
  },
  jordart: {
    name: 'Jordart',
    url: '/sgu-wms',
    attribution: '&copy; SGU',
    type: 'wms',
    layers: 'SE.GOV.SGU.JORD.GRUNDLAGER.25K,SE.GOV.SGU.JORD.YTLAGER.25K,SE.GOV.SGU.JORD.TACKNINGSKARTA.25K'
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
    loc: [62.553345, 16.711533],
    color: '#0ea5e9', // cyan-500
    cost: 1500,
    weight: 1.0,
    nodes: [],
    enabled: true
  },
  'Vatten-VA': {
    name: 'Vatten-VA',
    loc: [62.518043, 16.759452],
    color: '#22c55e', // green-500
    cost: 1500,
    weight: 1.0,
    nodes: [],
    enabled: true
  },
  'El': {
    name: 'El',
    loc: [62.558574, 16.796531],
    color: '#ef4444', // red-500
    cost: 1500,
    weight: 1.0,
    nodes: [],
    enabled: true
  },
  'Väg': {
    name: 'Väg',
    loc: [62.525000, 16.705000],
    color: '#8b5cf6', // violet-500
    cost: 1500,
    weight: 1.0,
    nodes: [],
    enabled: true
  }
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
  onAction,
  onPlaceTest
}: { 
  activeSource: string | null; 
  activeAction: ActiveAction;
  placingTestLocation: boolean;
  onAction: (latlng: [number, number]) => void;
  onPlaceTest: (latlng: [number, number]) => void;
}) {
  useMapEvents({
    click(e) {
      if (placingTestLocation) {
        onPlaceTest([e.latlng.lat, e.latlng.lng]);
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

  const analysis = useMemo(() => runAnalysis(sources), [sources]);
  
  const testLocationCost = useMemo(() => {
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

  return (
    <div className="flex h-screen w-full bg-slate-100 text-slate-800 overflow-hidden font-sans">
      {/* Sidebar */}
      <aside className="w-80 h-full border-r border-slate-200 bg-white flex flex-col z-10 shadow-lg">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <h1 className="text-xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <Target className="w-5 h-5 text-slate-900" />
            Sweetspotfinder
          </h1>
          <button 
            onClick={() => setPlacingTestLocation(!placingTestLocation)}
            className={`p-2 rounded-lg transition-all ${
              placingTestLocation 
                ? 'bg-slate-700 text-white shadow-lg ring-2 ring-slate-200' 
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
            title="Placera provplats"
          >
            <MapPin className="w-5 h-5" />
          </button>
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
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1 uppercase font-bold tracking-tight">Kr/km</label>
                    <input 
                      type="number" 
                      value={data.cost}
                      onChange={(e) => updateSource(name, { cost: parseInt(e.target.value) || 0 })}
                      className="w-full text-xs p-1.5 border border-slate-200 rounded bg-white font-medium focus:outline-none focus:ring-1 focus:ring-slate-300"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1 uppercase font-bold tracking-tight">Vikt</label>
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

          {basemap === 'jordart' && (
            <>
              <TileLayer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution='&copy; OpenStreetMap contributors'
              />
              <WMSTileLayer
                url={BASEMAPS.jordart.url}
                layers={BASEMAPS.jordart.layers || ''}
                attribution={BASEMAPS.jordart.attribution}
                format="image/png"
                transparent={true}
                version="1.3.0"
                uppercase={true}
                opacity={0.8}
                styles=""
              />
            </>
          )}
          
          <MapClickHandler 
            activeSource={activeSource} 
            activeAction={activeAction} 
            placingTestLocation={placingTestLocation}
            onAction={handleMapAction} 
            onPlaceTest={(latlng) => {
              setTestLocation(latlng);
              setPlacingTestLocation(false);
            }}
          />

          {/* Analysis Contours */}
          {basemap !== 'orto' && analysis.contourData.map((contour, i) => (
             contour.polygons.map((ringSet, j) => (
               <Polyline
                 key={`contour-${i}-${j}`}
                 positions={ringSet as any}
                 pathOptions={{ 
                   color: contour.color, 
                   weight: i + 1, 
                   opacity: basemap === 'standard' ? 0.8 : 0.4,
                   dashArray: i === 0 ? '4, 4' : undefined
                 }}
               />
             ))
          ))}

          {/* Source Paths and Markers */}
          {(Object.entries(sources) as [string, Source][]).map(([name, data]) => {
            const path = [data.loc, ...data.nodes, analysis.bestLoc];
            return (
              <React.Fragment key={name}>
                {data.enabled && (
                  <Polyline 
                    positions={path} 
                    pathOptions={{ 
                      color: data.color, 
                      weight: 2, 
                      opacity: 0.6,
                      dashArray: '8, 4'
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
          {testLocation && (
            <>
              {(Object.entries(sources) as [string, Source][]).map(([name, data]) => {
                const path = [data.loc, ...data.nodes, testLocation];
                return data.enabled ? (
                  <Polyline 
                    key={`test-path-${name}`}
                    positions={path} 
                    pathOptions={{ 
                      color: data.color, 
                      weight: 1, 
                      opacity: 0.3,
                      dashArray: '4, 4'
                    }} 
                  />
                ) : null;
              })}
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
                    <div class="test-location-container">
                      <div class="test-location-dot"></div>
                    </div>
                  `,
                  iconSize: [24, 24],
                  iconAnchor: [12, 12]
                })}
              >
                <Tooltip permanent direction="bottom" offset={[0, 10]} className="!bg-slate-600/90 !border-none !text-white !p-1 !px-2 !rounded !text-[10px] !font-bold !shadow-none">
                  <span>Vald plats</span>
                </Tooltip>
              </Marker>
            </>
          )}

          <Marker 
            position={analysis.bestLoc}
            icon={L.divIcon({
              className: 'custom-sweetspot',
              html: `
                <div class="sweetspot-container">
                  <div class="sweetspot-ping-inner"></div>
                  <div class="sweetspot-ping-outer"></div>
                  <div class="sweetspot-dot"></div>
                </div>
              `,
              iconSize: [30, 30],
              iconAnchor: [15, 15]
            })}
          />
        </MapContainer>

        {/* Floating Legend Overlay */}
        <div className="absolute top-6 right-6 z-[1000] w-72 bg-white/95 backdrop-blur-xl p-5 rounded-[2rem] shadow-[0_20px_50px_-12px_rgba(0,0,0,0.2)] border border-white">
          <div className="space-y-4 text-sm">
             <div className="flex justify-between items-center bg-slate-900 p-3 rounded-2xl shadow-lg shadow-slate-200">
                <div className="flex items-center gap-3">
                   <div className="relative flex items-center justify-center">
                     <div className="absolute w-4 h-4 rounded-full border border-white/30 animate-ping" />
                     <div className="w-2 h-2 rounded-full bg-white ring-2 ring-white/10" />
                   </div>
                   <span className="text-white font-black tracking-tight text-[11px] uppercase">Sweet spot</span>
                </div>
                <span className="font-mono font-black text-white text-base">{Math.round(analysis.minVal).toLocaleString('sv-SE')} kr</span>
             </div>

             {testLocationCost !== null && (
               <motion.div 
                 initial={{ opacity: 0, y: 10 }}
                 animate={{ opacity: 1, y: 0 }}
                 className="flex justify-between items-center bg-slate-50 p-3 rounded-2xl border border-slate-200 shadow-sm"
               >
                  <div className="flex items-center gap-3">
                     <div className="w-2.5 h-2.5 rounded-full bg-slate-400 ring-2 ring-white" />
                     <span className="text-slate-500 font-bold text-[11px] uppercase">Vald plats</span>
                  </div>
                  <div className="text-right">
                    <div className="font-mono font-black text-slate-800">{Math.round(testLocationCost).toLocaleString('sv-SE')} kr</div>
                  </div>
               </motion.div>
             )}
             
             <div className="pt-1 space-y-2">
                {[
                  { label: 'Inre zon', color: '#ff5500', val: analysis.thresholds.inner },
                  { label: 'Mellanzon', color: '#ffaa00', val: analysis.thresholds.middle },
                  { label: 'Yttre zon', color: '#ffff00', val: analysis.thresholds.outer }
                ].map(item => (
                  <div key={item.label} className="flex justify-between items-center bg-slate-50/50 p-2 rounded-lg border border-slate-100">
                    <div className="flex items-center gap-2">
                       <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }} />
                       <span className="text-slate-600 font-medium">{item.label}</span>
                    </div>
                    <span className="font-mono font-bold text-slate-700">{Math.round(item.val).toLocaleString('sv-SE')} kr</span>
                  </div>
                ))}
             </div>
          </div>
          
          <div className="mt-4 pt-4 border-t border-slate-50">
             <p className="text-[10px] text-slate-400 italic">Resultat baserat på linjär distans och nuvarande viktning.</p>
          </div>
        </div>

        {/* Map Controls Mockup */}
        <div className="absolute bottom-8 right-8 z-[1000] flex flex-col gap-2">
          <button className="w-10 h-10 bg-white rounded-full shadow-lg flex items-center justify-center text-slate-600 font-bold hover:bg-slate-50 border border-slate-100">+</button>
          <button className="w-10 h-10 bg-white rounded-full shadow-lg flex items-center justify-center text-slate-600 font-bold hover:bg-slate-50 border border-slate-100">-</button>
        </div>
      </main>
    </div>
  );
}
