import { useCallback, useEffect, useRef, useState } from 'react';
import { GeoPoint, GpsStatus } from '../types/parking';

interface DeviceOrientationEventWithWebkit extends DeviceOrientationEvent {
  webkitCompassHeading?: number;
}

interface DeviceOrientationStatic {
  requestPermission?: () => Promise<'granted' | 'denied'>;
}

export function useParkingSensors() {
  const [currentPosition, setCurrentPosition] = useState<GeoPoint | null>(null);
  const [gpsStatus, setGpsStatus] = useState<GpsStatus>('acquiring');
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [compassHeading, setCompassHeading] = useState<number | null>(null);
  const [needsCompassPermission, setNeedsCompassPermission] = useState(false);
  const [compassDenied, setCompassDenied] = useState(false);

  const watchIdRef = useRef<number | null>(null);
  const hasFixRef = useRef(false);

  const clearExistingWatch = () => {
    if (
      watchIdRef.current !== null &&
      typeof navigator !== 'undefined' &&
      'geolocation' in navigator
    ) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  };

  const applyPosition = useCallback((pos: GeolocationPosition) => {
    hasFixRef.current = true;
    setGpsStatus('ready');
    setGpsError(null);
    setCurrentPosition({
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
      accuracy: Math.round(pos.coords.accuracy || 0),
      heading: pos.coords.heading,
      timestamp: pos.timestamp,
    });
  }, []);

  const startGpsWatch = useCallback(() => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setGpsStatus('unavailable');
      setGpsError('Geolocation is not supported by this browser.');
      return;
    }

    clearExistingWatch();
    if (!hasFixRef.current) {
      setGpsStatus('acquiring');
    }
    setGpsError(null);

    // 1. Fast coarse/cached location lock so the map centers immediately (<1s on most devices)
    navigator.geolocation.getCurrentPosition(
      applyPosition,
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setGpsStatus('denied');
          setGpsError(
            'Location permission was denied. Enable Location in your browser/phone settings or set your area below.'
          );
          return;
        }
        if (!hasFixRef.current) {
          if (err.code === err.POSITION_UNAVAILABLE) {
            setGpsStatus('unavailable');
            setGpsError(
              'Device GPS is unavailable right now. Turn on Location/GPS or enter your current area below.'
            );
          } else {
            setGpsStatus('error');
            setGpsError(
              'Still waiting for GPS signal. Tap Use My Current Location or enter your current area below.'
            );
          }
        }
      },
      {
        enableHighAccuracy: false,
        maximumAge: 60000,
        timeout: 4500,
      }
    );

    // 2. Continuous high-accuracy watch to refine exact GPS coordinates in the background
    let fellBackToLowAccuracy = false;
    const beginWatch = (highAccuracy: boolean) => {
      clearExistingWatch();
      watchIdRef.current = navigator.geolocation.watchPosition(
        applyPosition,
        (err) => {
          if (err.code === err.PERMISSION_DENIED) {
            setGpsStatus('denied');
            setGpsError(
              'Location permission was denied. Enable Location in your browser/phone settings or set your area below.'
            );
            clearExistingWatch();
            return;
          }
          if (highAccuracy && !fellBackToLowAccuracy) {
            fellBackToLowAccuracy = true;
            beginWatch(false);
          } else if (!hasFixRef.current) {
            setGpsStatus(
              err.code === err.POSITION_UNAVAILABLE ? 'unavailable' : 'error'
            );
            setGpsError(
              'Could not read device location automatically. Turn on GPS or enter your current area below.'
            );
          }
        },
        {
          enableHighAccuracy: highAccuracy,
          maximumAge: highAccuracy ? 5000 : 30000,
          timeout: 15000,
        }
      );
    };

    beginWatch(true);
  }, [applyPosition]);

  useEffect(() => {
    startGpsWatch();
    return () => {
      clearExistingWatch();
    };
  }, [startGpsWatch]);

  // Device orientation compass listener
  const attachCompassListener = useCallback(() => {
    const handleOrientation = (event: Event) => {
      const e = event as DeviceOrientationEventWithWebkit;
      if (
        typeof e.webkitCompassHeading === 'number' &&
        !Number.isNaN(e.webkitCompassHeading)
      ) {
        setCompassHeading(e.webkitCompassHeading);
      } else if (typeof e.alpha === 'number' && !Number.isNaN(e.alpha)) {
        const heading = (360 - e.alpha) % 360;
        setCompassHeading(heading);
      }
    };

    window.addEventListener('deviceorientationabsolute', handleOrientation, true);
    window.addEventListener('deviceorientation', handleOrientation, true);

    return () => {
      window.removeEventListener(
        'deviceorientationabsolute',
        handleOrientation,
        true
      );
      window.removeEventListener('deviceorientation', handleOrientation, true);
    };
  }, []);

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      !('DeviceOrientationEvent' in window)
    ) {
      return;
    }

    const DOE =
      window.DeviceOrientationEvent as unknown as DeviceOrientationStatic;
    if (typeof DOE.requestPermission === 'function') {
      setNeedsCompassPermission(true);
      return;
    }

    const cleanup = attachCompassListener();
    return cleanup;
  }, [attachCompassListener]);

  const requestCompassPermission = useCallback(async () => {
    if (
      typeof window === 'undefined' ||
      !('DeviceOrientationEvent' in window)
    ) {
      return;
    }
    const DOE =
      window.DeviceOrientationEvent as unknown as DeviceOrientationStatic;
    if (typeof DOE.requestPermission === 'function') {
      try {
        const res = await DOE.requestPermission();
        if (res === 'granted') {
          setNeedsCompassPermission(false);
          setCompassDenied(false);
          attachCompassListener();
        } else {
          setCompassDenied(true);
        }
      } catch {
        setCompassDenied(true);
      }
    }
  }, [attachCompassListener]);

  const captureCurrentPosition = useCallback(async (): Promise<GeoPoint> => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      if (currentPosition) return currentPosition;
      throw new Error('Geolocation is unavailable on this device.');
    }

    const tryGet = (highAccuracy: boolean) =>
      new Promise<GeoPoint>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const point: GeoPoint = {
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              accuracy: Math.round(pos.coords.accuracy || 0),
              heading: pos.coords.heading,
              timestamp: Date.now(),
            };
            setCurrentPosition(point);
            setGpsStatus('ready');
            setGpsError(null);
            resolve(point);
          },
          (err) => reject(err),
          {
            enableHighAccuracy: highAccuracy,
            maximumAge: 4000,
            timeout: highAccuracy ? 8000 : 10000,
          }
        );
      });

    try {
      return await tryGet(true);
    } catch (err: unknown) {
      const code = (err as { code?: number })?.code;
      if (code === 1 && currentPosition) {
        return currentPosition;
      }
      if (code !== 1) {
        try {
          return await tryGet(false);
        } catch {
          if (currentPosition) return currentPosition;
        }
      }
      if (currentPosition) return currentPosition;
      throw new Error(
        'Could not acquire GPS fix. Allow location permission or set your area manually.'
      );
    }
  }, [currentPosition]);

  const setManualLocation = useCallback((latitude: number, longitude: number) => {
    clearExistingWatch();
    setGpsStatus('ready');
    setGpsError(null);
    setCurrentPosition({
      latitude,
      longitude,
      accuracy: 25,
      timestamp: Date.now(),
    });
  }, []);

  return {
    currentPosition,
    gpsStatus,
    gpsError,
    compassHeading,
    needsCompassPermission,
    compassDenied,
    startGpsWatch,
    requestCompassPermission,
    captureCurrentPosition,
    setManualLocation,
  };
}
