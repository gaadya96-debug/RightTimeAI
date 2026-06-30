/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { MapFrame } from './components/MapFrame';
import { PlaceBottomSheet } from './components/PlaceBottomSheet';
import { PlaceDetailOverlay } from './components/PlaceDetailOverlay';
import { SearchOverlay } from './components/SearchOverlay';
import { CategoryToolbar } from './components/CategoryToolbar';
import { ReportModal } from './components/ReportModal';
import { AIAdvisorModal } from './components/AIAdvisorModal';
import { Sparkles } from 'lucide-react';
import { APIProvider } from '@vis.gl/react-google-maps';
import { MOCK_PLACES } from './utils/mockData';
import { discoverNearbyPlaces, geocodeAddress } from './services/geminiService';
import { searchNearbyGoogle } from './services/googlePlacesService';
import { DetailedPlace } from './types';
import { calculateDistance } from './utils/geo';
import { motion, AnimatePresence } from 'motion/react';
import { Zap, Layers, Users, Search as SearchIcon, Compass, LogIn, LogOut, MapPin, X, Globe, Map, List } from 'lucide-react';
import { subscribeToPlaces, submitReport, onAuthChanged, signInWithGoogle, signOut } from './services/firebaseService';
import { User } from 'firebase/auth';

const API_KEY =
  process.env.GOOGLE_MAPS_PLATFORM_KEY ||
  (import.meta as any).env?.VITE_GOOGLE_MAPS_PLATFORM_KEY ||
  (globalThis as any).GOOGLE_MAPS_PLATFORM_KEY ||
  '';
const hasValidKey = Boolean(API_KEY) && API_KEY !== 'YOUR_API_KEY';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [places, setPlaces] = useState<DetailedPlace[]>([]);
  const [selectedPlace, setSelectedPlace] = useState<DetailedPlace | null>(null);
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  const [activeCenter, setActiveCenter] = useState<[number, number] | null>(null);
  const [hasScannedNearby, setHasScannedNearby] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [locationMethod, setLocationMethod] = useState<'GPS' | 'NETWORK' | 'IP' | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [isAIAdvisorOpen, setIsAIAdvisorOpen] = useState(false);
  const [centerTrigger, setCenterTrigger] = useState(0);
  const [isAutoScanning, setIsAutoScanning] = useState(false);
  const [activeHeatmap, setActiveHeatmap] = useState<'NONE' | 'CROWD' | 'POLLUTION'>('CROWD');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<Record<string, boolean>>({});
  const [mobileTab, setMobileTab] = useState<'map' | 'list'>('map');
  
  // Custom manual city/address override support
  const [resolvedAddress, setResolvedAddress] = useState<string | null>(null);
  const [manualQuery, setManualQuery] = useState('');
  const [isManualResolving, setIsManualResolving] = useState(false);

  const geolocatedSuccessRef = useRef(false);

  const filteredPlaces = React.useMemo(() => {
    let result = places.map(p => ({ ...p, isFavorite: !!favorites[p.id] }));
    const refCenter = activeCenter || userLocation;
    if (refCenter) {
      const [uLat, uLng] = refCenter;
      // Only keep places within 100 km of active/ref center to avoid cross-country blunders from shared DB
      result = result.filter(p => {
        const dist = calculateDistance(uLat, uLng, p.coordinates.lat, p.coordinates.lng);
        return dist <= 100;
      });
      // Sort closest first for pristine, logical display order
      result.sort((a, b) => {
        const distA = calculateDistance(uLat, uLng, a.coordinates.lat, a.coordinates.lng);
        const distB = calculateDistance(uLat, uLng, b.coordinates.lat, b.coordinates.lng);
        return distA - distB;
      });
    }
    if (activeCategory) {
      result = result.filter(p => p.category === activeCategory);
    }
    return result;
  }, [places, activeCategory, favorites, activeCenter, userLocation]);

  // Comprehensive Multi-Sector Grid scan to fetch real-world facilities 
  // and load realistic procedural pollution conditions across dozen unique categories.
  const handleNearbyScan = useCallback((latitude: number, longitude: number) => {
    if (hasValidKey) {
      const keywords = [
        'restaurant', 'cafe', 'park', 'shopping mall', 
        'grocery', 'hospital', 'school', 'university', 'hotel', 
        'gym', 'gas station', 'spa', 'bank', 'atm', 'tourist attraction', 'landmark', 'museum'
      ];
      Promise.all(keywords.map(kw => searchNearbyGoogle(null, latitude, longitude, kw)))
        .then(flatResults => {
          const flattened = flatResults.flat();
          if (flattened.length > 0) {
            setPlaces(prev => {
              const merged = prev.filter(p => !p.id.startsWith('mock_') && p.id !== '1' && p.id !== '2' && p.id !== '3' && p.id !== '4' && p.id !== '5');
              flattened.forEach(np => {
                const isDuplicate = merged.some(ep => 
                  ep.id === np.id ||
                  ep.name.toLowerCase() === np.name.toLowerCase() || 
                  (Math.abs(ep.coordinates.lat - np.coordinates.lat) < 0.0001 && 
                   Math.abs(ep.coordinates.lng - np.coordinates.lng) < 0.0001)
                );
                if (!isDuplicate) merged.push(np);
              });
              return merged;
            });
          }
        })
        .catch(err => console.error("Grid layout scan failed:", err));
    } else {
      // Fallback: Gemini generated locations
      const coreCategories = ['Everything', 'Businesses', 'Public Services', 'Leisure', 'Education', 'Financial Institutions', 'Tourist Attractions and Landmarks'];
      Promise.all(coreCategories.map(cat => discoverNearbyPlaces(latitude, longitude, cat)))
        .then(results => {
          const flattened = results.flat();
          if (flattened.length > 0) {
            setPlaces(prev => {
              const merged = prev.filter(p => !p.id.startsWith('mock_') && p.id !== '1' && p.id !== '2' && p.id !== '3' && p.id !== '4' && p.id !== '5');
              flattened.forEach(np => {
                const isDuplicate = merged.some(ep => 
                  ep.name.toLowerCase() === np.name.toLowerCase() || 
                  (Math.abs(ep.coordinates.lat - np.coordinates.lat) < 0.0001 && 
                   Math.abs(ep.coordinates.lng - np.coordinates.lng) < 0.0001)
                );
                if (!isDuplicate) merged.push(np);
              });
              return merged;
            });
          }
        })
        .catch(err => console.error("Discover nearby places fallback error:", err));
    }
  }, []);

  // Fetch User Location and query nearest elements with Multi-tiered auto fallback
  const fetchLocation = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setLocationError("Geolocation is not supported by your browser.");
      return;
    }

    setIsLocating(true);
    setLocationError(null);
    geolocatedSuccessRef.current = false;

    let watchId: any = null;
    let fallbackTimer: any = null;

    // Helper to fetch IP-based coordinates from 3 redundant APIs
    const fetchIpCoords = async (): Promise<[number, number] | null> => {
      // 1. First attempt: ipapi.co
      try {
        const res = await fetch("https://ipapi.co/json/");
        if (res.ok) {
          const data = await res.json();
          if (data.latitude && data.longitude) {
            return [Number(data.latitude), Number(data.longitude)];
          }
        }
      } catch (err) {
        console.log("ipapi lookup failed:", err);
      }

      // 2. Second attempt: freeipapi.com
      try {
        const res = await fetch("https://freeipapi.com/api/json");
        if (res.ok) {
          const data = await res.json();
          if (typeof data.latitude === 'number' && typeof data.longitude === 'number') {
            return [data.latitude, data.longitude];
          }
        }
      } catch (err) {
        console.log("freeipapi lookup failed:", err);
      }

      // 3. Third attempt: ipinfo.io
      try {
        const res = await fetch("https://ipinfo.io/json");
        if (res.ok) {
          const data = await res.json();
          if (data.loc) {
            const parts = data.loc.split(',');
            if (parts.length === 2) {
              return [Number(parts[0]), Number(parts[1])];
            }
          }
        }
      } catch (err) {
        console.log("ipinfo lookup failed:", err);
      }

      return null;
    };

    const useIpFallback = async () => {
      if (geolocatedSuccessRef.current) return;
      setLocationMethod('IP');
      setIsLocating(true);
      
      const coords = await fetchIpCoords();
      if (coords) {
        const [lat, lng] = coords;
        setUserLocation([lat, lng]);
        setActiveCenter([lat, lng]);
        setIsLocating(false);
        setLocationError(null);
        if (!hasScannedNearby) {
          handleNearbyScan(lat, lng);
          setHasScannedNearby(true);
        }
      } else {
        // Absolute final default backup
        const defaultLat = 37.422;
        const defaultLng = -122.084;
        setUserLocation([defaultLat, defaultLng]);
        setActiveCenter([defaultLat, defaultLng]);
        setIsLocating(false);
        setLocationError("Precise device location is unavailable. Loaded Silicon Valley live map context.");
        if (!hasScannedNearby) {
          handleNearbyScan(defaultLat, defaultLng);
          setHasScannedNearby(true);
        }
      }
    };

    // Trigger instant background pre-load using IP coordinates to make map ready instantly
    useIpFallback();

    try {
      watchId = navigator.geolocation.watchPosition(
        (position) => {
          geolocatedSuccessRef.current = true;
          setLocationMethod('GPS');
          const { latitude, longitude } = position.coords;
          setUserLocation([latitude, longitude]);
          setActiveCenter([latitude, longitude]);
          setIsLocating(false);
          setLocationError(null);

          // Force fresh high-accuracy grid scan on GPS lock
          handleNearbyScan(latitude, longitude);
          setHasScannedNearby(true);
        },
        async (error) => {
          console.log("GPS sensor notice (using IP fallback routing):", error.message);
          // High-priority immediate IP lookup on failure
          if (!geolocatedSuccessRef.current) {
            await useIpFallback();
          }
        },
        {
          enableHighAccuracy: false, // Low accuracy connects instantly in sandboxed iframes
          timeout: 4000,
          maximumAge: 300000 // Cache position for response speed
        }
      );

    } catch (e) {
      console.warn("Geolocation watch registration bypassed:", e);
      useIpFallback();
    }

    return () => {
      if (watchId) navigator.geolocation.clearWatch(watchId);
    };
  }, [hasScannedNearby, handleNearbyScan]);

  // Handle Manual City/Sector Override via high precision geocoding
  const handleManualLocationOverride = useCallback(async (queryText: string) => {
    if (!queryText.trim()) return;
    setIsManualResolving(true);
    setLocationError(null);
    try {
      const result = await geocodeAddress(queryText);
      if (result) {
        const { lat, lng, formattedAddress } = result;
        setUserLocation([lat, lng]);
        setActiveCenter([lat, lng]);
        setResolvedAddress(formattedAddress);
        setLocationMethod('GPS'); // Mark as acquired
        setLocationError(`Map successfully centered on: ${formattedAddress}`);
        setHasScannedNearby(false); // Enable scanning at new sector
        handleNearbyScan(lat, lng);
        setCenterTrigger(prev => prev + 1); // Trigger map refitting
        setManualQuery('');
      } else {
        setLocationError(`Could not find coordinates for "${queryText}". Please check spelling or select a popular hub.`);
      }
    } catch (err) {
      console.error("Coordinate override error:", err);
      setLocationError("System offline. Please check connection and retry sector lock.");
    } finally {
      setIsManualResolving(false);
    }
  }, [handleNearbyScan]);

  // Handle Auth State
  useEffect(() => {
    const unsubscribeAuth = onAuthChanged((u) => {
      setUser(u);
      setAuthLoading(false);
    });

    let cleanupLocation: (() => void) | undefined;
    if (user) {
      cleanupLocation = fetchLocation() as any;
    }

    return () => {
      unsubscribeAuth();
      if (cleanupLocation) cleanupLocation();
    };
  }, [fetchLocation, user]);

  // Subscribe to live updates ONLY when authenticated
  useEffect(() => {
    if (!user) return;

    const unsubscribe = subscribeToPlaces((livePlaces) => {
      setPlaces(prev => {
        const merged = [...prev];
        livePlaces.forEach(lp => {
          const index = merged.findIndex(p => p.id === lp.id);
          if (index !== -1) merged[index] = { ...merged[index], ...lp };
          else merged.push(lp);
        });
        return merged;
      });
    });
    return () => unsubscribe();
  }, [user]);

  const handleSelectPlace = useCallback((place: DetailedPlace) => {
    setPlaces(prev => {
      if (prev.find(p => p.id === place.id)) return prev;
      return [...prev, place];
    });
    setSelectedPlace(place);
    setIsSearchOpen(false);
  }, []);

  const toggleFavorite = useCallback((placeId: string) => {
    setFavorites(prev => ({
      ...prev,
      [placeId]: !prev[placeId]
    }));
  }, []);

  const handleReportSubmit = async (placeId: string, level: 'LOW' | 'MODERATE' | 'HIGH', waitTime?: number) => {
    try {
      await submitReport(placeId, level, waitTime);
      setPlaces(prev => prev.map(p => {
        if (p.id === placeId) {
          const delta = level === 'LOW' ? -10 : (level === 'MODERATE' ? 5 : 20);
          return { ...p, crowdDensity: Math.min(100, Math.max(0, p.crowdDensity + delta)) };
        }
        return p;
      }));
    } catch (error) {
      console.error("Report failed:", error);
    }
  };

  const findBestPlace = () => {
    if (places.length === 0) return;
    const best = [...places].sort((a, b) => a.scores.compositeScore - b.scores.compositeScore)[0];
    handleSelectPlace(best);
  };

  const handleDiscoverMore = useCallback(async (lat: number, lng: number) => {
    setIsAutoScanning(true);
    try {
      if (hasValidKey) {
        // High-Precision authentic locations around custom coordinates
        const keywords = ['', 'restaurant', 'store', 'hospital', 'park', 'services', 'school', 'university', 'bank', 'atm', 'tourist attraction', 'landmark', 'museum'];
        const flatResults = await Promise.all(keywords.map(kw => searchNearbyGoogle(null, lat, lng, kw)));
        const flattened = flatResults.flat();
        
        if (flattened.length > 0) {
          setPlaces(prev => {
            const merged = prev.filter(p => !p.id.startsWith('mock_') && p.id !== '1' && p.id !== '2' && p.id !== '3' && p.id !== '4' && p.id !== '5');
            flattened.forEach(np => {
              const isDuplicate = merged.some(ep => 
                ep.id === np.id ||
                ep.name.toLowerCase() === np.name.toLowerCase() || 
                (Math.abs(ep.coordinates.lat - np.coordinates.lat) < 0.0001 && 
                 Math.abs(ep.coordinates.lng - np.coordinates.lng) < 0.0001)
              );
              if (!isDuplicate) {
                merged.push(np);
              }
            });
            return merged;
          });
        }
      } else {
        // Falling back to simulated/Gemini search triggers
        const categories = [
          'Commercial', 'Residential', 'Public Services', 'Leisure', 
          'Healthcare', 'Retail', 'Education', 'Transport',
          'Food & Drink', 'Nature', 'Emergency Services', 'Religious Sites'
        ];
        
        const offsets = [
          { dLat: 0, dLng: 0 },
          { dLat: 0.005, dLng: 0.005 },
          { dLat: -0.005, dLng: -0.005 },
          { dLat: 0.005, dLng: -0.005 },
          { dLat: -0.005, dLng: 0.005 },
        ];

        const allResults = await Promise.all(
          offsets.flatMap(offset => 
            categories.slice(0, 3).map(cat => discoverNearbyPlaces(lat + offset.dLat, lng + offset.dLng, cat))
          )
        );
        
        const comprehensive = await discoverNearbyPlaces(lat, lng, "Every business, service, and landmark");
        const flattened = [...allResults.flat(), ...comprehensive];
        
        if (flattened.length > 0) {
          setPlaces(prev => {
            const merged = prev.filter(p => !p.id.startsWith('mock_') && p.id !== '1' && p.id !== '2' && p.id !== '3' && p.id !== '4' && p.id !== '5');
            flattened.forEach(np => {
              const isDuplicate = merged.some(ep => 
                ep.name.toLowerCase() === np.name.toLowerCase() || 
                (Math.abs(ep.coordinates.lat - np.coordinates.lat) < 0.0001 && 
                 Math.abs(ep.coordinates.lng - np.coordinates.lng) < 0.0001)
              );
              if (!isDuplicate) merged.push(np);
            });
            return merged;
          });
        }
      }
    } catch (e) {
      console.error("Deep scan failed:", e);
    } finally {
      setIsAutoScanning(false);
    }
  }, []);

  // Debounced map movement handler
  const moveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const handleMapMove = useCallback((lat: number, lng: number) => {
    if (moveTimeoutRef.current) clearTimeout(moveTimeoutRef.current);
    moveTimeoutRef.current = setTimeout(() => {
      setActiveCenter([lat, lng]);
      handleDiscoverMore(lat, lng);
    }, 1500); // 1.5s post-movement scanning
  }, [handleDiscoverMore]);

  // MANDATORY CONSTITUTION REQUIREMENT: Render installation splash on empty or invalid key
  if (!hasValidKey) {
    return (
      <div className="w-full h-screen bg-slate-950 flex flex-col items-center justify-center p-6 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-from)_0%,_transparent_70%)] from-emerald-500/15 text-white select-text">
        <div className="max-w-xl w-full text-center space-y-8 animate-in fade-in duration-500">
          <div className="flex flex-col items-center gap-4">
            <div className="w-20 h-20 rounded-3xl bg-emerald-500 flex items-center justify-center text-white shadow-2xl shadow-emerald-500/20">
              <Zap size={40} fill="currentColor" />
            </div>
            <div className="space-y-1">
              <h1 className="text-4xl font-extrabold tracking-tight text-white">Gupta's RightTime <span className="text-emerald-500 font-extrabold">Live</span></h1>
              <p className="text-slate-400 font-bold uppercase tracking-widest text-[10px]">Google Maps Platform Integration Needed</p>
            </div>
          </div>
          
          <div className="bg-slate-900 border border-slate-800 p-8 rounded-[40px] shadow-2xl space-y-6 text-left">
            <h2 className="text-xl font-black text-white text-center">API Key Required for Local Search</h2>
            <p className="text-slate-300 font-medium text-sm leading-relaxed text-center">
              To resolve and display real, physical locations matching your exact neighborhood coordinates, please connect a Google Maps API credential.
            </p>
            
            <div className="space-y-4 border-t border-slate-800 pt-6">
              <div className="flex gap-4 items-start">
                <div className="w-6 h-6 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center text-xs font-black shrink-0 mt-0.5 animate-pulse">1</div>
                <div>
                  <p className="font-bold text-sm text-white">Generate your credential</p>
                  <p className="text-xs text-slate-400 mt-1">
                    Get an API key here: <a href="https://console.cloud.google.com/google/maps-apis/start?utm_campaign=gmp-code-assist-ais" target="_blank" rel="noopener noreferrer" className="text-emerald-400 underline hover:text-emerald-300">Google Cloud Platform Center</a>.
                  </p>
                </div>
              </div>

              <div className="flex gap-4 items-start">
                <div className="w-6 h-6 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center text-xs font-black shrink-0 mt-0.5">2</div>
                <div>
                  <p className="font-bold text-sm text-white">Save in Project Secrets</p>
                  <p className="text-xs text-slate-400 mt-1">
                    Open the <strong>Settings (⚙️ gear icon, top-right corner)</strong>, click <strong>Secrets</strong>, add a variable named <code className="bg-slate-950 px-2 py-0.5 rounded text-emerald-300">GOOGLE_MAPS_PLATFORM_KEY</code>, paste your API key, and hit Enter.
                  </p>
                </div>
              </div>

              <div className="flex gap-4 items-start">
                <div className="w-6 h-6 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center text-xs font-black shrink-0 mt-0.5">3</div>
                <div>
                  <p className="font-bold text-sm text-white">Rebuild Success</p>
                  <p className="text-xs text-slate-400 mt-1">
                    The playground will automatically compile and display the live Google Map overlay immediately.
                  </p>
                </div>
              </div>
            </div>
          </div>
          
          <p className="text-[10px] text-slate-600 font-bold uppercase tracking-widest">AI Studio Sandboxed Applet</p>
        </div>
      </div>
    );
  }

  if (authLoading) {
    return (
      <div className="w-full h-screen bg-slate-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin" />
          <p className="text-slate-500 font-bold uppercase tracking-widest text-[10px]">Establishing Secure Connection...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="w-full h-screen bg-slate-950 flex flex-col items-center justify-center p-6 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-from)_0%,_transparent_70%)] from-emerald-500/10">
        <div className="max-w-md w-full text-center space-y-8">
          <div className="flex flex-col items-center gap-4">
            <div className="w-20 h-20 rounded-3xl bg-emerald-500 flex items-center justify-center text-white shadow-2xl shadow-emerald-500/20">
              <Zap size={40} fill="currentColor" />
            </div>
            <div className="space-y-1">
              <h1 className="text-4xl font-black tracking-tight text-white">Gupta's RightTime <span className="text-emerald-500">Live</span></h1>
              <p className="text-slate-400 font-bold uppercase tracking-widest text-xs">Access Urban Intelligence Grid</p>
            </div>
          </div>
          
          <div className="bg-slate-900 border border-slate-800 p-8 rounded-[40px] shadow-2xl space-y-6">
            <p className="text-slate-300 font-medium">Authentication required to access live heatmaps and intelligence scores.</p>
            <button 
              onClick={async () => {
                setLoginLoading(true);
                setLoginError(null);
                try {
                  await signInWithGoogle();
                } catch (error: any) {
                  setLoginError(error.message || "Failed to sign in. Please try again.");
                } finally {
                  setLoginLoading(false);
                }
              }}
              disabled={loginLoading}
              className="w-full h-16 bg-white hover:bg-slate-100 text-slate-950 font-black rounded-2xl flex items-center justify-center gap-3 transition-all active:scale-[0.98] shadow-xl group disabled:opacity-50"
            >
              {loginLoading ? (
                <div className="w-5 h-5 border-2 border-slate-900/20 border-t-slate-900 rounded-full animate-spin" />
              ) : (
                <LogIn size={20} className="group-hover:translate-x-1 transition-transform" />
              )}
              {loginLoading ? 'Opening Secure Portal...' : 'Sign in with Google'}
            </button>
            
            {loginError && (
              <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-2xl flex items-center gap-3 animate-in fade-in slide-in-from-top-2">
                <div className="w-2 h-2 rounded-full bg-rose-500 animate-pulse shrink-0" />
                <p className="text-[11px] font-bold text-rose-500 text-left line-clamp-2">
                  ERROR: {loginError}
                </p>
              </div>
            )}
          </div>
          
          <p className="text-[10px] text-slate-600 font-bold uppercase tracking-widest">Secured by Firebase Enterprise</p>
        </div>
      </div>
    );
  }

  // Google Maps Providers wrappers
  return (
    <APIProvider apiKey={API_KEY} version="weekly">
      <div className="relative w-full h-screen bg-slate-950 overflow-hidden select-none flex flex-col">
        {/* Header */}
        <header className="h-18 px-6 border-b border-slate-800 bg-slate-900/95 backdrop-blur-md flex items-center justify-between z-40 shrink-0">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-emerald-500 flex items-center justify-center text-white shadow-lg shadow-emerald-500/20">
              <Zap size={22} fill="currentColor" />
            </div>
            <div>
              <h1 className="text-lg font-black tracking-tight text-white flex items-center gap-2">
                Gupta's RightTime <span className="text-emerald-500">Live</span>
              </h1>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest truncate max-w-[180px] xs:max-w-none">
                {resolvedAddress ? `Grid: ${resolvedAddress}` : 'Urban Intelligence Platform'}
              </p>
            </div>
          </div>

          {/* Precision GeoSector Override bar */}
          <div className="hidden md:flex items-center gap-2 bg-slate-950 py-1.5 px-3 rounded-2xl border border-slate-800 shadow-inner">
            <Globe size={14} className="text-emerald-500 shrink-0" />
            <span className="text-[9px] font-black uppercase text-slate-500 tracking-wider">Sector Lock:</span>
            <input 
              type="text"
              placeholder="e.g. Noida, Paris, New York..."
              value={manualQuery}
              onChange={(e) => setManualQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleManualLocationOverride(manualQuery);
              }}
              className="bg-transparent border-none outline-none text-xs font-bold text-slate-200 placeholder:text-slate-600 focus:ring-0 focus:outline-none w-48 text-left"
            />
            <button 
              onClick={() => handleManualLocationOverride(manualQuery)}
              disabled={isManualResolving || !manualQuery.trim()}
              className="px-2.5 py-1 bg-emerald-600 text-slate-950 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-600 text-[9px] font-black uppercase rounded-lg transition-transform active:scale-95"
            >
              {isManualResolving ? 'Locking...' : 'Lock Grid'}
            </button>
          </div>

          <div className="hidden md:flex items-center gap-4">
            <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-700">
              <button 
                onClick={() => setActiveHeatmap('CROWD')}
                className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${activeHeatmap === 'CROWD' ? 'bg-slate-700 text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}
              >
                Density
              </button>
              <button 
                onClick={() => setActiveHeatmap('POLLUTION')}
                className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${activeHeatmap === 'POLLUTION' ? 'bg-slate-700 text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}
              >
                Pollution
              </button>
            </div>
            <button 
              onClick={() => setIsSearchOpen(true)}
              className="w-10 h-10 bg-slate-800 rounded-xl flex items-center justify-center text-slate-300 hover:bg-slate-700 transition-colors"
            >
              <SearchIcon size={20} />
            </button>
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={() => setIsAIAdvisorOpen(true)}
              className="flex items-center gap-2 px-3.5 py-2 hover:brightness-110 active:scale-95 bg-gradient-to-r from-emerald-500 to-teal-500 text-slate-950 rounded-xl font-black text-[10px] uppercase tracking-wider shadow-md shadow-emerald-500/10 transition-all outline-none"
            >
              <Sparkles size={13} fill="currentColor" />
              <span className="hidden xs:inline">Ask AI Advisor</span>
            </button>
            <div className="hidden sm:block text-right">
              <p className="text-xs font-bold text-white leading-none truncate max-w-[100px]">{user.displayName || user.email}</p>
              <p className="text-[10px] font-medium text-emerald-500">Active Operator</p>
            </div>
            <button 
              onClick={() => signOut()}
              className="w-10 h-10 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-400 hover:text-rose-500 transition-colors"
            >
              <LogOut size={18} />
            </button>
          </div>
        </header>

        {/* Main Layout Area */}
        <div className="flex-1 flex relative">
          {/* Sidebar for Desktop */}
          <aside className="hidden lg:flex w-96 border-r border-slate-800 bg-slate-900 overflow-y-auto flex-col z-30 shadow-2xl">
            <PlaceBottomSheet 
              places={filteredPlaces} 
              userLocation={activeCenter || userLocation}
              onSelect={handleSelectPlace} 
              onOpenSearch={() => setIsSearchOpen(true)}
              compact={true}
            />
          </aside>

          {/* Map Container */}
          <main className="flex-1 relative z-0">
            {/* Show category toolbar on desktop, or on mobile only when map tab is selected */}
            {mobileTab === 'map' && (
              <CategoryToolbar 
                activeCategory={activeCategory} 
                onSelectCategory={setActiveCategory} 
              />
            )}
            <MapFrame 
              places={filteredPlaces} 
              selectedPlace={selectedPlace} 
              userLocation={userLocation}
              centerOnUserTrigger={centerTrigger}
              onSelectPlace={handleSelectPlace}
              onDiscoverMore={handleDiscoverMore}
              onMapMove={handleMapMove}
              showCrowdHeatmap={activeHeatmap === 'CROWD'}
              showPollutionHeatmap={activeHeatmap === 'POLLUTION'}
            />

            {/* Floating Controls Overlay */}
            <div className={`absolute top-6 left-6 z-20 flex flex-col gap-3 transition-all duration-300 ${mobileTab === 'list' ? 'opacity-0 scale-95 pointer-events-none' : 'opacity-100 scale-100'}`}>
              <button 
                onClick={() => setIsSearchOpen(true)}
                className="md:hidden w-12 h-12 glass-panel rounded-2xl flex items-center justify-center shadow-xl shadow-black/40 text-white"
              >
                <SearchIcon size={24} />
              </button>
              <button 
                onClick={() => setActiveHeatmap(prev => prev === 'CROWD' ? 'POLLUTION' : 'CROWD')}
                className="md:hidden w-12 h-12 glass-panel rounded-2xl flex items-center justify-center shadow-xl shadow-black/40 text-white"
              >
                <Layers size={24} />
              </button>
              <button 
                onClick={() => {
                  if (!userLocation) fetchLocation();
                  setCenterTrigger(prev => prev + 1);
                  setSelectedPlace(null);
                }}
                disabled={isLocating}
                className={`w-12 h-12 glass-panel rounded-2xl flex items-center justify-center shadow-xl shadow-black/40 text-white transition-all ${isLocating ? 'animate-pulse' : 'hover:bg-slate-700/50'}`}
              >
                {isLocating ? (
                  <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                ) : (
                  <MapPin size={24} className={userLocation ? 'text-blue-400' : 'text-white'} />
                )}
              </button>
            </div>

            {/* Location Error Banner */}
            <AnimatePresence>
              {isAutoScanning && (
                <motion.div 
                  initial={{ y: -100, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: -100, opacity: 0 }}
                  className="absolute top-6 right-6 z-[1001]"
                >
                  <div className="bg-emerald-500/90 backdrop-blur-xl text-slate-950 px-4 py-2 rounded-full shadow-2xl flex items-center gap-2 border border-emerald-400/50">
                    <div className="w-2 h-2 rounded-full bg-slate-950 animate-pulse" />
                    <p className="text-[10px] font-black uppercase tracking-[0.1em]">Tracking sector... {places.length} active tags</p>
                  </div>
                </motion.div>
              )}

              {locationError && (
                <motion.div 
                  initial={{ y: -100, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: -100, opacity: 0 }}
                  className="absolute top-24 left-1/2 -translate-x-1/2 z-50 w-full max-w-md px-4"
                >
                  <div className={`p-4 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] flex items-center gap-3 border ${
                    locationError.includes('Activating') || locationError.includes('Standard Silicon') || locationError.includes('standard Silicon') || locationError.includes('standard live') || locationError.includes('GPS timeout')
                      ? 'bg-amber-500/95 border-amber-400 text-slate-950 font-bold' 
                      : 'bg-rose-500/95 border-rose-400 text-white font-bold'
                  } backdrop-blur-xl`}>
                    <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                      locationError.includes('Activating') || locationError.includes('Standard Silicon') || locationError.includes('standard Silicon') || locationError.includes('standard live') || locationError.includes('GPS timeout')
                        ? 'bg-slate-950/10 text-slate-950' 
                        : 'bg-rose-600 text-white shadow'
                    }`}>
                      <Zap size={14} fill="currentColor" />
                    </div>
                    <div className="flex-1">
                      <p className={`text-[9px] font-black uppercase tracking-[0.1em] ${
                        locationError.includes('Activating') || locationError.includes('Standard Silicon') || locationError.includes('standard Silicon') || locationError.includes('standard live') || locationError.includes('GPS timeout')
                          ? 'text-slate-900/60'
                          : 'text-rose-200'
                      }`}>System Notice</p>
                      <p className="text-xs leading-relaxed font-black">{locationError}</p>
                    </div>
                    <button 
                      onClick={() => setLocationError(null)}
                      className={`ml-auto p-1.5 rounded-lg transition-colors ${
                        locationError.includes('Activating') || locationError.includes('Standard Silicon') || locationError.includes('standard Silicon') || locationError.includes('standard live') || locationError.includes('GPS timeout')
                          ? 'hover:bg-slate-950/10 text-slate-900'
                          : 'hover:bg-rose-600/50 text-white'
                      }`}
                    >
                      <X size={16} />
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Map Frame is clean and spacious */}
          </main>
        </div>

        {/* Floating Action Button */}
        <AnimatePresence>
          {!selectedPlace && !isSearchOpen && mobileTab === 'map' && (
            <motion.div 
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              className="absolute bottom-24 lg:bottom-6 right-6 z-30"
            >
              <button 
                onClick={findBestPlace}
                className="w-16 h-16 bg-emerald-600 rounded-3xl shadow-2xl shadow-emerald-500/40 text-white flex items-center justify-center group active:scale-90 transition-all border-4 border-slate-900"
              >
                <Compass size={32} className="group-hover:rotate-45 transition-transform" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Mobile View Toggle Pill Indicator */}
        {!selectedPlace && !isSearchOpen && (
          <div className="lg:hidden fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
            <div className="bg-slate-950/90 backdrop-blur-xl p-1.5 rounded-full border border-slate-800/80 shadow-2xl flex items-center gap-1">
              <button
                onClick={() => setMobileTab('map')}
                className={`px-5 py-2.5 rounded-full text-[10px] font-black uppercase tracking-wider flex items-center gap-2 transition-all active:scale-95 duration-200 ${
                  mobileTab === 'map' 
                    ? 'bg-emerald-500 text-slate-950 shadow-lg shadow-emerald-500/20' 
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Map size={13} />
                <span>Map view</span>
              </button>
              <button
                onClick={() => setMobileTab('list')}
                className={`px-5 py-2.5 rounded-full text-[10px] font-black uppercase tracking-wider flex items-center gap-2 transition-all active:scale-95 duration-200 ${
                  mobileTab === 'list' 
                    ? 'bg-emerald-500 text-slate-950 shadow-lg shadow-emerald-500/20' 
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <List size={13} />
                <span>List view</span>
              </button>
            </div>
          </div>
        )}

        {/* Mobile Bottom Navigation */}
        <div className="lg:hidden">
          {mobileTab === 'list' && !selectedPlace && !isSearchOpen && (
            <PlaceBottomSheet 
              places={filteredPlaces} 
              userLocation={activeCenter || userLocation}
              onSelect={(p) => {
                handleSelectPlace(p);
                // Return to map view to visually locate the tag
                setMobileTab('map');
              }} 
              onOpenSearch={() => setIsSearchOpen(true)}
            />
          )}
        </div>

        {/* Overlay Screens */}
        <PlaceDetailOverlay 
          place={selectedPlace} 
          userLocation={activeCenter || userLocation}
          onClose={() => setSelectedPlace(null)}
          onReport={() => setIsReportOpen(true)}
          onToggleFavorite={toggleFavorite}
        />

        <SearchOverlay 
          isOpen={isSearchOpen} 
          userLocation={activeCenter || userLocation}
          onClose={() => setIsSearchOpen(false)} 
          places={places}
          onSelect={handleSelectPlace}
          onGlobalResultsFound={(found) => {
            setPlaces(prev => {
              const merged = [...prev];
              found.forEach(np => {
                const isDuplicate = merged.some(p => 
                  p.id === np.id || 
                  p.name.toLowerCase() === np.name.toLowerCase() ||
                  (Math.abs(p.coordinates.lat - np.coordinates.lat) < 0.0001 &&
                   Math.abs(p.coordinates.lng - np.coordinates.lng) < 0.0001)
                );
                if (!isDuplicate) {
                  merged.push(np);
                }
              });
              return merged;
            });
          }}
        />

        {isReportOpen && (
          <ReportModal 
            place={selectedPlace} 
            onClose={() => setIsReportOpen(false)}
            onSubmit={handleReportSubmit}
          />
        )}

        <AIAdvisorModal
          isOpen={isAIAdvisorOpen}
          onClose={() => setIsAIAdvisorOpen(false)}
          currentPlaces={places}
          userLocation={userLocation}
        />
      </div>
    </APIProvider>
  );
}
