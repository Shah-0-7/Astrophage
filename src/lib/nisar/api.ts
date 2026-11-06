/** Shape of the /api/nisar/coverage response, shared by the route and the client. */
import type { InsarFit } from './match';
import type { NisarCoverage, NisarMaturity, NisarProduct } from './types';
import type { OperaFit } from './opera';

export interface SceneBrief {
  id: string; product: NisarProduct; productName: string; maturity: NisarMaturity;
  start: number; end: number; track: number | null; frame: number | null; direction: 'A' | 'D' | null;
  pairReference: number | null; pairSecondary: number | null; pairSource: 'name' | 'metadata' | null;
  sizeMb: number | null; metadataUrl: string; dataUrl: string | null;
}
export interface InterferogramBrief extends SceneBrief { fit: InsarFit; spanDays: number }
export interface OperaInfo { fit: OperaFit; portal: string; about: string }

export type CoverageResponse =
  | { status: 'ok'; partial: boolean; coverage: NisarCoverage; latest: SceneBrief[]; interferograms: InterferogramBrief[]; interferogramTotal: number; truncated: boolean; opera: OperaInfo }
  | { status: 'unavailable'; error?: string; opera: OperaInfo }
  | { status: 'pre-mission'; archiveStart: number; opera: OperaInfo }
  | { status: 'future'; opera: OperaInfo };
