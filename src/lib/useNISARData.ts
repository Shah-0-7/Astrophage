/**
 * ============================================================
 * useNISARData – Custom Hook
 * ============================================================
 * The ONLY way visual components access NISAR scenario data.
 * Abstracts the data service behind a reactive, store-aware API.
 * ============================================================
 */

'use client';

import { useMemo } from 'react';
import { useStore } from './store';
import {
  getScenarios,
  getScenarioById,
  getFilteredFeatures,
  getChartData,
  getTimelineSteps,
  getTimestampIndex,
  formatTimestamp,
} from './dataService';
import { PASS_EPOCHS } from './mockData';
import type { NISARCategory, NISARScenario } from './types';
import type { FeatureCollection } from 'geojson';

interface UseNISARDataReturn {
  scenarios: NISARScenario[];
  activeScenario: NISARScenario;
  filteredFeatures: FeatureCollection;
  chartData: { date: string; value: number; label?: string }[];
  timelineSteps: string[];
  currentStepIndex: number;
  totalSteps: number;
  formattedTimestamp: string;
  progress: number;
  currentPass: typeof PASS_EPOCHS[0] | undefined;
}

export function useNISARData(
  timeRange?: { start: string; end: string },
  category?: NISARCategory | 'all'
): UseNISARDataReturn {
  const activeScenarioId = useStore(s => s.activeScenarioId);
  const currentTimestamp = useStore(s => s.currentTimestamp);
  const currentPassIndex = useStore(s => s.currentPassIndex);

  const scenarios = useMemo(() => getScenarios(), []);

  const activeScenario = useMemo(
    () => getScenarioById(activeScenarioId) || scenarios[0],
    [activeScenarioId, scenarios]
  );

  const filteredFeatures = useMemo(
    () => getFilteredFeatures(activeScenario, currentTimestamp),
    [activeScenario, currentTimestamp]
  );

  const chartData = useMemo(
    () => getChartData(activeScenario, currentTimestamp),
    [activeScenario, currentTimestamp]
  );

  const timelineSteps = useMemo(
    () => getTimelineSteps(activeScenario),
    [activeScenario]
  );

  const currentStepIndex = useMemo(
    () => getTimestampIndex(activeScenario, currentTimestamp),
    [activeScenario, currentTimestamp]
  );

  const formattedTimestamp = useMemo(
    () => formatTimestamp(currentTimestamp),
    [currentTimestamp]
  );

  const progress = useMemo(
    () => (timelineSteps.length > 1 ? (currentStepIndex / (timelineSteps.length - 1)) * 100 : 0),
    [currentStepIndex, timelineSteps.length]
  );

  const currentPass = useMemo(() => PASS_EPOCHS[currentPassIndex], [currentPassIndex]);

  return {
    scenarios,
    activeScenario,
    filteredFeatures,
    chartData,
    timelineSteps,
    currentStepIndex,
    totalSteps: timelineSteps.length,
    formattedTimestamp,
    progress,
    currentPass,
  };
}
