/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type RiskLevel = 'GO' | 'WAIT' | 'AVOID';

export interface Place {
  id: string;
  name: string;
  category: 'Hospital' | 'Bank' | 'Market' | 'Coaching Center' | 'Park' | 'Restaurant';
  address: string;
  coordinates: {
    lat: number;
    lng: number;
  };
  distance: string; // Formatting: "0.5 km"
}

export interface IntelligenceScore {
  compositeScore: number; // 0-100
  crowdScore: number;
  aqiScore: number;
  trendScore: number;
  timePatternScore: number;
  level: RiskLevel;
  recommendation: string;
}

export interface DetailedPlace extends Place {
  scores: IntelligenceScore;
  crowdDensity: number; // 0-100
  aqi: number;
  pm25: number;
  trend: 'INCREASING' | 'DECREASING' | 'STABLE';
  waitTime: number; // minutes
  historicalData: { hour: number; crowd: number }[];
  lastReports: CrowdReport[];
  bestTime?: string;
  alternatives?: { id: string, name: string, reason: string }[];
  isFavorite?: boolean;
}

export interface CrowdReport {
  id: string;
  placeId: string;
  timestamp: number;
  level: 'LOW' | 'MODERATE' | 'HIGH';
  waitTime?: number;
}
