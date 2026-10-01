/**
 * ============================================================
 * GlobalSchematic – View Mode: GLOBAL_SCHEMATIC
 * ============================================================
 * Interactive world target matrix with radar node beacons,
 * telemetry cards, and category filter panel.
 *
 * API surface implemented:
 *   filterTargetMatrix(category)
 *   renderGlobalNodeOverlay()
 *   jumpToNodeView(nodeId, targetMode)
 * ============================================================
 */

'use client';

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '@/lib/store';
import { TARGET_NODES, NODE_BOUNDING_BOXES } from '@/lib/mockData';
import type { TargetCategory, TargetNode } from '@/lib/types';

/* ── World-map projected coordinates (equirectangular) ───────── */
function lngLatToPercent(lng: number, lat: number): { x: number; y: number } {
  const x = ((lng + 180) / 360) * 100;
  const y = ((90 - lat) / 180) * 100;
  return { x, y };
}

const CATEGORIES: Array<{ id: TargetCategory | 'ALL'; label: string; metric: string }> = [
  { id: 'ALL',        label: 'ALL SITES',   metric: '' },
  { id: 'TECTONIC',   label: 'TECTONIC',    metric: 'ACTIVE LOCK' },
  { id: 'CRYOSPHERE', label: 'CRYOSPHERE',  metric: '-4.2m/yr' },
  { id: 'VOLCANIC',   label: 'VOLCANIC',    metric: '+18cm INFL' },
  { id: 'BIOMASS',    label: 'BIOMASS',     metric: '-140t LOSS' },
];

const CATEGORY_COLORS: Record<string, string> = {
  TECTONIC:   'var(--crimson)',
  CRYOSPHERE: '#60a5fa',
  VOLCANIC:   '#fb923c',
  BIOMASS:    '#4ade80',
  ALL:        'var(--white)',
};

const STATUS_COLORS: Record<string, string> = {
  CRITICAL: 'var(--crimson)',
  ELEVATED: 'var(--acquiring)',
  NOMINAL:  'var(--nominal)',
};

export default function GlobalSchematic() {
  const selectedCategory = useStore(s => s.selectedTargetCategory);
  const filterTargetMatrix = useStore(s => s.filterTargetMatrix);
  const setActiveNodeId = useStore(s => s.setActiveNodeId);
  const activeNodeId = useStore(s => s.activeNodeId);
  const setViewMode = useStore(s => s.setViewMode);
  const setSpatialContext = useStore(s => s.setSpatialContext);

  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  const visibleNodes = selectedCategory === 'ALL'
    ? TARGET_NODES
    : TARGET_NODES.filter(n => n.category === selectedCategory);

  const activeNode = TARGET_NODES.find(n => n.id === activeNodeId) ?? TARGET_NODES[0];
  const hoveredNode = TARGET_NODES.find(n => n.id === hoveredNodeId);

  /** jumpToNodeView: route to 2D Radar or 3D Topo and set spatial context */
  const jumpToNodeView = useCallback((nodeId: string, targetMode: '2D' | '3D') => {
    const node = TARGET_NODES.find(n => n.id === nodeId);
    if (!node) return;
    setActiveNodeId(nodeId);
    setSpatialContext({
      targetCoords: node.coords,
      breadcrumbTrack: `${node.label} [${node.id}]`,
      bandParam: 'L-BAND 24cm λ',
    });
    setViewMode(targetMode === '2D' ? 'EVENT_RADAR_2D' : 'TOPO_CORE_3D');
  }, [setActiveNodeId, setSpatialContext, setViewMode]);

  return (
    <div className="flex h-full">
      {/* ── Left category filter panel ─────────────────────── */}
      <div className="w-[220px] flex-shrink-0 border-r border-white/10 flex flex-col">
        <div className="p-3 border-b border-white/10">
          <p className="panel-label">SAR TARGET MATRIX</p>
          <p className="font-mono text-[10px] text-white/30 mt-1 uppercase tracking-widest">{selectedCategory}</p>
        </div>

        <div className="flex-1 overflow-y-auto">
          {CATEGORIES.map(cat => {
            const isActive = selectedCategory === cat.id;
            const color = CATEGORY_COLORS[cat.id];
            return (
              <button
                key={cat.id}
                onClick={() => filterTargetMatrix(cat.id as TargetCategory | 'ALL')}
                className="w-full text-left px-4 py-3 border-b border-white/05 flex items-center justify-between transition-all cursor-pointer"
                style={{
                  background: isActive ? `rgba(239,68,68,0.06)` : 'transparent',
                  borderLeft: isActive ? `2px solid ${color}` : '2px solid transparent',
                }}
              >
                <span
                  className="font-mono text-[11px] font-600 tracking-[0.12em] uppercase"
                  style={{ color: isActive ? color : 'var(--text-muted)' }}
                >
                  [{cat.label}]
                </span>
                {isActive && cat.metric && (
                  <span className="font-mono text-[9px] text-white/40 tracking-wider">{cat.metric}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Main world map canvas ──────────────────────────── */}
      <div className="flex-1 relative overflow-hidden">
        {/* World map background (SVG-style hatched) */}
        <div
          className="absolute inset-0 fringe-bg"
          style={{
            background: 'radial-gradient(ellipse at 50% 50%, rgba(255,255,255,0.03) 0%, transparent 80%)',
          }}
        />

        {/* Equirectangular world outline (simplified SVG) */}
        <svg
          className="absolute inset-0 w-full h-full"
          viewBox="0 0 1000 500"
          preserveAspectRatio="xMidYMid meet"
          style={{ opacity: 0.15 }}
        >
          {/* Simplified continent outlines */}
          {/* North America */}
          <path d="M85,80 L180,75 L210,100 L220,140 L200,180 L180,200 L160,220 L140,240 L120,260 L90,280 L70,260 L50,230 L40,200 L55,160 L70,130 Z" fill="white" stroke="none" />
          {/* South America */}
          <path d="M160,270 L210,265 L230,300 L240,340 L230,380 L200,420 L170,440 L150,420 L135,380 L140,340 L145,300 Z" fill="white" stroke="none" />
          {/* Europe */}
          <path d="M430,65 L480,60 L510,80 L520,100 L500,120 L470,130 L440,120 L420,100 L425,80 Z" fill="white" stroke="none" />
          {/* Africa */}
          <path d="M440,140 L510,130 L540,160 L550,200 L545,250 L530,300 L510,340 L490,360 L470,340 L450,300 L440,250 L430,200 L435,160 Z" fill="white" stroke="none" />
          {/* Asia */}
          <path d="M520,60 L700,50 L780,70 L800,100 L790,140 L750,160 L700,170 L650,175 L600,165 L560,140 L540,120 L520,90 Z" fill="white" stroke="none" />
          {/* Southeast Asia */}
          <path d="M680,170 L740,160 L770,180 L760,210 L720,220 L690,205 Z" fill="white" stroke="none" />
          {/* Australia */}
          <path d="M680,290 L770,275 L810,300 L820,340 L800,380 L750,395 L700,385 L670,350 L665,310 Z" fill="white" stroke="none" />
          {/* Greenland */}
          <path d="M200,30 L270,25 L290,50 L275,75 L240,80 L210,65 Z" fill="white" stroke="none" />
          {/* Antarctica */}
          <path d="M50,460 L950,460 L950,490 L50,490 Z" fill="white" stroke="none" opacity="0.4" />
          {/* Equator */}
          <line x1="0" y1="250" x2="1000" y2="250" stroke="white" strokeWidth="0.5" strokeDasharray="4,8" opacity="0.3" />
          {/* Tropics */}
          <line x1="0" y1="195" x2="1000" y2="195" stroke="white" strokeWidth="0.3" strokeDasharray="2,10" opacity="0.15" />
          <line x1="0" y1="305" x2="1000" y2="305" stroke="white" strokeWidth="0.3" strokeDasharray="2,10" opacity="0.15" />
          {/* Prime meridian */}
          <line x1="500" y1="0" x2="500" y2="500" stroke="white" strokeWidth="0.3" strokeDasharray="2,10" opacity="0.10" />
          {/* Grid */}
          {[100, 200, 300, 400, 600, 700, 800, 900].map(x => (
            <line key={x} x1={x} y1="0" x2={x} y2="500" stroke="white" strokeWidth="0.2" opacity="0.05" />
          ))}
          {[50, 100, 150, 200, 300, 350, 400, 450].map(y => (
            <line key={y} x1="0" y1={y} x2="1000" y2={y} stroke="white" strokeWidth="0.2" opacity="0.05" />
          ))}
        </svg>

        {/* ── Node beacons (renderGlobalNodeOverlay) ─────────── */}
        {visibleNodes.map(node => {
          const pct = lngLatToPercent(node.coords[0], node.coords[1]);
          const isActive = node.id === activeNodeId;
          const isHovered = node.id === hoveredNodeId;
          const color = CATEGORY_COLORS[node.category];
          const statusColor = STATUS_COLORS[node.status];

          // Scale node size by |velocity|
          const mag = Math.min(Math.abs(node.deformationVelocity) / 100, 1);
          const size = 8 + mag * 16;

          return (
            <div
              key={node.id}
              className="world-node"
              style={{ left: `${pct.x}%`, top: `${pct.y}%` }}
              onMouseEnter={() => setHoveredNodeId(node.id)}
              onMouseLeave={() => setHoveredNodeId(null)}
              onClick={() => setActiveNodeId(node.id)}
            >
              {/* Outer pulse ring */}
              {isActive && (
                <div
                  className="absolute rounded-full lock-ring"
                  style={{
                    width: size + 16,
                    height: size + 16,
                    top: -(size + 16) / 2,
                    left: -(size + 16) / 2,
                    border: `1px solid ${statusColor}`,
                    opacity: 0.5,
                  }}
                />
              )}

              {/* Node dot */}
              <div
                style={{
                  width: size, height: size, borderRadius: '50%',
                  background: isActive ? statusColor : node.status === 'CRITICAL' ? statusColor : 'transparent',
                  border: `1.5px solid ${isActive ? statusColor : color}`,
                  boxShadow: isActive || node.status === 'CRITICAL' ? `0 0 ${size}px ${statusColor}` : undefined,
                  opacity: isActive ? 1 : 0.7,
                  transition: 'all 0.2s',
                }}
              />

              {/* Node label */}
              {(isActive || isHovered) && (
                <div
                  className="absolute pointer-events-none"
                  style={{ left: size / 2 + 6, top: -8, whiteSpace: 'nowrap' }}
                >
                  <p className="font-mono text-[9px] font-700 tracking-wider" style={{ color: statusColor }}>
                    {node.label} [{node.id}]
                  </p>
                </div>
              )}
            </div>
          );
        })}

        {/* ── Orbit track line ───────────────────────────────── */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
          <path
            d={`M -10,${90 - 98.4 * 0.3} Q 25,${50 - 15} 50,${50} Q 75,${50 + 15} 110,${90 - 98.4 * 0.3}`}
            fill="none" stroke="rgba(239,68,68,0.20)" strokeWidth="0.3" strokeDasharray="1,3"
          />
        </svg>
      </div>

      {/* ── Right: active node telemetry card ─────────────── */}
      <AnimatePresence mode="wait">
        {activeNode && (
          <motion.div
            key={activeNode.id}
            initial={{ x: 40, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 40, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="w-[240px] flex-shrink-0 border-l border-white/10 flex flex-col"
          >
            {/* Node header */}
            <div className="p-4 border-b border-white/10">
              <div className="flex items-center justify-between mb-1">
                <span className="panel-label">SYS.NODE // {activeNode.id}</span>
                <span
                  className="font-mono text-[9px] font-700 tracking-wider uppercase"
                  style={{ color: STATUS_COLORS[activeNode.status] }}
                >
                  STATUS: {activeNode.status}
                </span>
              </div>
              <h3 className="font-mono text-[16px] font-700 text-white tracking-wider mt-2 uppercase">
                {activeNode.label} FAULT
              </h3>
              <p className="font-mono text-[9px] text-white/40 uppercase tracking-wider mt-0.5">
                {activeNode.description.split('.')[0].toUpperCase()}
              </p>
              <p className="font-mono text-[8px] text-white/25 uppercase tracking-widest mt-1">
                {activeNode.locationDetail}
              </p>
            </div>

            {/* Metrics */}
            <div className="p-4 border-b border-white/10">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="panel-label mb-1">DEFORMATION VELOCITY</p>
                  <p className="font-mono text-[20px] font-700 text-white leading-none">
                    {activeNode.deformationVelocity > 0 ? '+' : ''}{activeNode.deformationVelocity.toLocaleString()}
                  </p>
                  <p className="font-mono text-[9px] text-white/40">mm/yr</p>
                </div>
                <div>
                  <p className="panel-label mb-1">InSAR COHERENCE</p>
                  <div className="flex items-baseline gap-1">
                    <p className="font-mono text-[20px] font-700 text-white leading-none">
                      {activeNode.coherence.toFixed(2)}
                    </p>
                    <p className="font-mono text-[9px] text-white/40">γ</p>
                  </div>
                </div>
              </div>
              <p className="font-mono text-[9px] text-white/30 mt-3 leading-relaxed">
                Interferometric fringe cycle: {activeNode.fringe}.
              </p>
            </div>

            {/* Jump actions */}
            <div className="p-4 grid grid-cols-2 gap-2">
              <button
                onClick={() => jumpToNodeView(activeNode.id, '2D')}
                className="tac-btn"
              >
                <span className="text-[10px]">⊕</span>
                2D RADAR
              </button>
              <button
                onClick={() => jumpToNodeView(activeNode.id, '3D')}
                className="tac-btn"
              >
                <span className="text-[10px]">△</span>
                3D TOPO CORE
              </button>
            </div>

            {/* Mini node list */}
            <div className="flex-1 overflow-y-auto border-t border-white/10">
              {visibleNodes.filter(n => n.id !== activeNode.id).slice(0, 6).map(node => (
                <button
                  key={node.id}
                  onClick={() => setActiveNodeId(node.id)}
                  className="w-full text-left px-4 py-2.5 border-b border-white/05 flex items-center justify-between cursor-pointer hover:bg-white/03 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <div
                      className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                      style={{
                        background: STATUS_COLORS[node.status],
                        boxShadow: `0 0 4px ${STATUS_COLORS[node.status]}`,
                      }}
                    />
                    <span className="font-mono text-[10px] text-white/70 uppercase tracking-wider">
                      {node.label}
                    </span>
                  </div>
                  <span className="font-mono text-[9px] text-white/30">{node.id}</span>
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
