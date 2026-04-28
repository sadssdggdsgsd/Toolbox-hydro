/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from 'react';
import { 
  MapContainer, 
  TileLayer, 
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
  Info
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Source, ActiveAction, AnalysisResult } from './types';
import { runAnalysis } from './analysis';

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
    color: '#0ea5e9', // Changed to standard Tailwind cyan-500
    cost: 1500,
    weight: 1.0,
    nodes: []
  },
  'Vatten-VA': {
    name: 'Vatten-VA',
    loc: [62.518043, 16.759452],
    color: '#22c55e', // Changed to standard Tailwind green-500
    cost: 1500,
    weight: 1.0,
    nodes: []
  },
  'El': {
    name: 'El',
    loc: [62.558574, 16.796531],
    color: '#ef4444', // Changed to standard Tailwind red-500
    cost: 1500,
    weight: 1.0,
    nodes: []
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
  onAction 
}: { 
  activeSource: string | null; 
  activeAction: ActiveAction;
  onAction: (latlng: [number, number]) => void;
}) {
  useMapEvents({
    click(e) {
      if (activeSource && activeAction) {
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

  const analysis = useMemo(() => runAnalysis(sources), [sources]);

  const updateSource = (name: string, updates: Partial<Source>) => {
    setSources(prev => ({
      ...prev,
      [name]: { ...prev[name], ...updates }
    }));
  };

  const handleMapAction = (latlng: [number, number]) => {
    if (!activeSource || !activeAction) return;

    if (activeAction === 'move') {
      updateSource(activeSource, { loc: latlng });
    } else if (activeAction === 'node') {
      updateSource(activeSource, { 
        nodes: [...sources[activeSource].nodes, latlng] 
      });
    }
  };

  const clearNodes = (name: string) => {
    updateSource(name, { nodes: [] });
  };

  return (
    <div className="flex h-screen w-full bg-slate-100 text-slate-800 overflow-hidden font-sans">
      {/* Sidebar */}
      <aside className="w-80 h-full border-r border-slate-200 bg-white flex flex-col z-10 shadow-lg">
        <div className="p-6 border-b border-slate-100">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <Target className="w-6 h-6 text-slate-900" />
            Sweetspotfinder
          </h1>
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
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <h3 className={`font-bold text-sm ${theme.title}`}>{name}</h3>
                  <button 
                    onClick={() => clearNodes(name)}
                    className={`text-[10px] bg-white px-2 py-1 border rounded font-bold transition-colors ${theme.btnBorder} ${theme.btnText} ${theme.btnHover}`}
                  >
                    RENSA
                  </button>
                </div>

                {/* Tools */}
                <div className="flex gap-1 mb-4">
                  {(['lock', 'move', 'node'] as const).map((action) => {
                    const isActive = (action === 'lock' && activeSource !== name) || 
                                     (activeSource === name && activeAction === (action === 'lock' ? null : action));
                    
                    return (
                      <button
                        key={action}
                        onClick={() => {
                          if (action === 'lock') {
                            setActiveSource(null);
                            setActiveAction(null);
                          } else {
                            setActiveSource(name);
                            setActiveAction(action as ActiveAction);
                          }
                        }}
                        className={`flex-1 py-1.5 text-[10px] font-bold rounded uppercase tracking-tighter transition-all ${
                          isActive
                            ? `${theme.action} text-white shadow-sm scale-[1.02]`
                            : 'bg-white border border-slate-200 text-slate-500 hover:border-slate-300'
                        }`}
                      >
                        {action === 'lock' ? 'Lås' : action === 'move' ? 'Flytta' : 'Noder'}
                      </button>
                    );
                  })}
                </div>

                {/* Inputs */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1 uppercase font-bold tracking-tight">Kr/m</label>
                    <input 
                      type="number" 
                      value={data.cost}
                      onChange={(e) => updateSource(name, { cost: parseInt(e.target.value) || 0 })}
                      className="w-full text-xs p-1.5 border border-slate-200 rounded bg-white font-medium focus:outline-none focus:ring-1 focus:ring-slate-300"
                    />
                  </div>
                  <div style={{ color: data.color }}>
                    <label className="text-[10px] text-slate-400 block mb-1 uppercase font-bold tracking-tight">Vikt</label>
                    <input 
                      type="range" 
                      min="0" 
                      max="1" 
                      step="0.1"
                      value={data.weight}
                      onChange={(e) => updateSource(name, { weight: parseFloat(e.target.value) })}
                      className={`w-full h-1.5 rounded-lg appearance-none mt-2 cursor-pointer ${theme.track}`}
                      style={{ color: 'inherit' }}
                    />
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>

        <div className="p-6 bg-slate-50 border-t border-slate-200">
           <button 
             className="w-full py-3 bg-slate-900 text-white rounded-lg font-bold shadow-lg shadow-slate-200 active:scale-95 transition-transform uppercase tracking-widest text-xs"
             onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
           >
             Uppdatera Analys
           </button>
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
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
            url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          />
          <TileLayer
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            attribution='Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EBP, and the GIS User Community'
          />
          
          <MapClickHandler 
            activeSource={activeSource} 
            activeAction={activeAction} 
            onAction={handleMapAction} 
          />

          {/* Analysis Contours */}
          {analysis.contourData.map((contour, i) => (
             contour.polygons.map((ringSet, j) => (
               <Polyline
                 key={`contour-${i}-${j}`}
                 positions={ringSet as any}
                 pathOptions={{ 
                   color: contour.color, 
                   weight: i + 1, 
                   opacity: 0.8,
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
                <Polyline 
                  positions={path} 
                  pathOptions={{ 
                    color: data.color, 
                    weight: 2, 
                    opacity: 0.6,
                    dashArray: '8, 4'
                  }} 
                />
                <CircleMarker 
                  center={data.loc} 
                  pathOptions={{ 
                    fillColor: data.color, 
                    fillOpacity: 1, 
                    color: '#000', 
                    weight: 2 
                  }}
                  radius={10}
                >
                  <Tooltip permanent direction="top" offset={[0, -10]} className="!bg-black/70 !border-none !text-white !p-1 !px-2 !rounded !text-[10px] !font-bold !shadow-none">
                    <span>{name}</span>
                  </Tooltip>
                </CircleMarker>
                {data.nodes.map((node, ni) => (
                  <CircleMarker 
                    key={`${name}-node-${ni}`}
                    center={node} 
                    pathOptions={{ fillColor: '#fff', fillOpacity: 0.5, color: '#000', weight: 1 }}
                    radius={5}
                  />
                ))}
              </React.Fragment>
            );
          })}

          {/* Sweet Spot Marker */}
          <Marker 
            position={analysis.bestLoc}
            icon={L.divIcon({
              className: 'custom-sweetspot',
              html: `
                <div class="sweetspot-container">
                  <div class="sweetspot-ping"></div>
                  <div class="sweetspot-dot"></div>
                </div>
              `,
              iconSize: [30, 30],
              iconAnchor: [15, 15]
            })}
          />
        </MapContainer>

        {/* Floating Legend Overlay */}
        <div className="absolute top-6 right-6 z-[1000] w-72 bg-white/90 backdrop-blur-md p-5 rounded-2xl shadow-xl border border-white">
          <div className="space-y-3 text-sm">
             <div className="flex justify-between items-center bg-green-50/50 p-2 rounded-lg border border-green-100">
                <div className="flex items-center gap-2">
                   <div className="w-3 h-3 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]" />
                   <span className="text-slate-700 font-bold">Sweet spot</span>
                </div>
                <span className="font-mono font-bold text-green-600">{Math.round(analysis.minVal).toLocaleString('sv-SE')} kr</span>
             </div>
             
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
