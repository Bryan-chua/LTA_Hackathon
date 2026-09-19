/// <reference types="google.maps" />

"use client";

import { importLibrary, setOptions } from "@googlemaps/js-api-loader";
import {
  AttributionControl,
  LngLatBounds,
  type LngLatBoundsLike,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  type GeoJSONSource,
  type StyleSpecification,
} from "maplibre-gl";
import type { Feature, FeatureCollection, LineString } from "geojson";
import { useEffect, useRef, useState } from "react";
import type { AffectedSegment, Journey } from "@/lib/domain";

interface RouteMapProps {
  usual: Journey;
  recommended?: Journey;
  affectedSegments: AffectedSegment[];
  compact?: boolean;
}

interface GoogleRouteMapProps extends RouteMapProps {
  apiKey: string;
}

let configuredGoogleMapsKey: string | undefined;

const DEFAULT_MAP_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    openStreetMap: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [{ id: "open-street-map", type: "raster", source: "openStreetMap" }],
};

const configureGoogleMaps = (apiKey: string) => {
  if (configuredGoogleMapsKey) return;
  setOptions({ key: apiKey, v: "weekly" });
  configuredGoogleMapsKey = apiKey;
};

const toGooglePath = (journey: Journey): google.maps.LatLngLiteral[] =>
  journey.legs.flatMap((leg, index) =>
    leg.geometry.slice(index === 0 ? 0 : 1).map(({ lng, lat }) => ({ lng, lat })),
  );

const toFeature = (journey: Journey): Feature<LineString> => ({
  type: "Feature",
  properties: {},
  geometry: {
    type: "LineString",
    coordinates: journey.legs.flatMap((leg, index) =>
      leg.geometry.slice(index === 0 ? 0 : 1).map(({ lng, lat }) => [lng, lat]),
    ),
  },
});

const toAffectedFeatureCollection = (
  journey: Journey,
  affectedSegments: AffectedSegment[],
): FeatureCollection<LineString> => ({
  type: "FeatureCollection",
  features: affectedSegments.flatMap((affectedSegment) =>
    affectedSegment.geometryMatches.flatMap(({ legIndex, sectionIndexes }) => {
      const leg = journey.legs[legIndex];
      if (!leg) return [];
      const matchedSections = sectionIndexes.flatMap((sectionIndex) => {
        const section = leg.geometrySections?.[sectionIndex];
        return section ? [section] : [];
      });
      const geometries = matchedSections.length > 0
        ? matchedSections.map(({ id, geometry }) => ({ id, geometry }))
        : [{ id: leg.id, geometry: leg.geometry }];

      return geometries.map(({ id, geometry }): Feature<LineString> => ({
        type: "Feature",
        properties: { id },
        geometry: {
          type: "LineString",
          coordinates: geometry.map(({ lng, lat }) => [lng, lat]),
        },
      }));
    }),
  ),
});

function GoogleRouteMap({ apiKey, usual, recommended, affectedSegments, compact = false }: GoogleRouteMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mapReady, setMapReady] = useState(false);
  const isDisrupted = affectedSegments.length > 0;

  useEffect(() => {
    if (!containerRef.current) return;

    let disposed = false;
    const overlays: Array<google.maps.Polyline | google.maps.marker.AdvancedMarkerElement> = [];

    const initialise = async () => {
      configureGoogleMaps(apiKey);
      const [{ Map, Polyline }, { AdvancedMarkerElement }] = await Promise.all([
        importLibrary("maps"),
        importLibrary("marker"),
      ]);
      if (disposed || !containerRef.current) return;

      const map = new Map(containerRef.current, {
        center: { lat: 1.317, lng: 103.897 },
        zoom: 11,
        mapId: process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID || "DEMO_MAP_ID",
        disableDefaultUI: compact,
        zoomControl: !compact,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        clickableIcons: !compact,
        gestureHandling: compact ? "none" : "cooperative",
      });

      const addLine = (path: google.maps.LatLngLiteral[], color: string, width: number, opacity = 1) => {
        const line = new Polyline({ path, map, strokeColor: color, strokeWeight: width, strokeOpacity: opacity });
        overlays.push(line);
      };

      addLine(toGooglePath(usual), "#254a91", compact ? 5 : 6, recommended ? 0.52 : 1);

      const affectedGeometry = toAffectedFeatureCollection(usual, affectedSegments);
      affectedGeometry.features.forEach((feature) => {
        addLine(
          feature.geometry.coordinates.map(([lng, lat]) => ({ lng, lat })),
          "#cb3b46",
          compact ? 7 : 8,
        );
      });

      if (recommended) addLine(toGooglePath(recommended), "#008b95", compact ? 6 : 7);

      [usual.origin, usual.destination].forEach((point, index) => {
        const marker = document.createElement("div");
        marker.className = `map-marker google-map-marker map-marker--${index === 0 ? "start" : "end"}`;
        marker.setAttribute("aria-label", index === 0 ? "Journey start" : "Journey destination");
        overlays.push(new AdvancedMarkerElement({
          map,
          position: point.coordinate,
          content: marker,
          title: index === 0 ? "Journey start" : "Journey destination",
        }));
      });

      const coordinates = [
        ...toGooglePath(usual),
        ...(recommended ? toGooglePath(recommended) : []),
      ];
      const bounds = new google.maps.LatLngBounds();
      coordinates.forEach((coordinate) => bounds.extend(coordinate));
      map.fitBounds(bounds, compact ? 28 : 48);
      setMapReady(true);
    };

    void initialise().catch(() => setMapReady(false));

    return () => {
      disposed = true;
      overlays.forEach((overlay) => {
        if (overlay instanceof google.maps.Polyline) overlay.setMap(null);
        else overlay.map = null;
      });
    };
  }, [apiKey, usual, recommended, affectedSegments, compact]);

  return (
    <MapFrame
      compact={compact}
      containerRef={containerRef}
      mapReady={mapReady}
      usual={usual}
      recommended={recommended}
      isDisrupted={isDisrupted}
    />
  );
}

function MapLibreRouteMap({ usual, recommended, affectedSegments, compact = false }: RouteMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const isDisrupted = affectedSegments.length > 0;

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new MapLibreMap({
      container: containerRef.current,
      style: process.env.NEXT_PUBLIC_MAP_STYLE_URL || DEFAULT_MAP_STYLE,
      center: [103.897, 1.317],
      zoom: 11.2,
      attributionControl: false,
      interactive: !compact,
    });

    map.addControl(new AttributionControl({ compact: true }), "bottom-right");
    if (!compact) map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    map.once("style.load", () => setMapReady(true));

    map.on("load", () => {
      map.addSource("usual-route", { type: "geojson", data: toFeature(usual) });
      map.addLayer({
        id: "usual-route",
        type: "line",
        source: "usual-route",
        paint: {
          "line-color": "#254a91",
          "line-width": compact ? 5 : 6,
          "line-opacity": recommended ? 0.52 : 1,
        },
      });

      const affectedGeometry = toAffectedFeatureCollection(usual, affectedSegments);
      if (affectedGeometry.features.length > 0) {
        map.addSource("affected-route", { type: "geojson", data: affectedGeometry });
        map.addLayer({
          id: "affected-route",
          type: "line",
          source: "affected-route",
          paint: {
            "line-color": "#cb3b46",
            "line-width": compact ? 7 : 8,
            "line-dasharray": [1.2, 1.4],
          },
        });
      }

      if (recommended) {
        map.addSource("recommended-route", { type: "geojson", data: toFeature(recommended) });
        map.addLayer({
          id: "recommended-route",
          type: "line",
          source: "recommended-route",
          paint: { "line-color": "#008b95", "line-width": compact ? 6 : 7 },
        });
      }

      const points = [usual.origin, usual.destination];
      points.forEach((point, index) => {
        const marker = document.createElement("div");
        marker.className = `map-marker map-marker--${index === 0 ? "start" : "end"}`;
        marker.setAttribute("aria-label", index === 0 ? "Journey start" : "Journey destination");
        new Marker({ element: marker }).setLngLat(point.coordinate).addTo(map);
      });

      const allCoordinates = [
        ...usual.legs.flatMap((leg) => leg.geometry),
        ...(recommended?.legs.flatMap((leg) => leg.geometry) ?? []),
      ];
      const bounds = allCoordinates.reduce(
        (box, coordinate) => box.extend([coordinate.lng, coordinate.lat]),
        new LngLatBounds([allCoordinates[0].lng, allCoordinates[0].lat], [allCoordinates[0].lng, allCoordinates[0].lat]),
      );
      map.fitBounds(bounds as LngLatBoundsLike, { padding: compact ? 28 : 48, duration: 0 });
      setMapReady(true);
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [usual, recommended, affectedSegments, compact]);

  useEffect(() => {
    const usualSource = mapRef.current?.getSource("usual-route") as GeoJSONSource | undefined;
    usualSource?.setData(toFeature(usual));
  }, [usual]);

  return <MapFrame
    compact={compact}
    containerRef={containerRef}
    mapReady={mapReady}
    usual={usual}
    recommended={recommended}
    isDisrupted={isDisrupted}
  />;
}

interface MapFrameProps {
  compact: boolean;
  containerRef: React.RefObject<HTMLDivElement | null>;
  mapReady: boolean;
  usual: Journey;
  recommended?: Journey;
  isDisrupted: boolean;
}

function MapFrame({ compact, containerRef, mapReady, usual, recommended, isDisrupted }: MapFrameProps) {
  return (
    <div className={`map-shell ${compact ? "map-shell--compact" : ""}`}>
      <div className="map-fallback" aria-hidden="true">
        <svg viewBox="0 0 600 300" preserveAspectRatio="none">
          <g className="map-roads">
            <path d="M-20 236 C110 187 168 210 285 145 S480 90 630 112" />
            <path d="M55 -20 C88 70 140 116 227 155 S390 229 425 330" />
            <path d="M-20 95 C130 132 250 92 340 60 S520 38 625 56" />
            <path d="M180 -20 C220 72 302 110 404 132 S535 190 620 240" />
          </g>
          <path className="schematic-route schematic-route--usual" d="M68 48 L122 94 L244 148 L360 202 L475 240 L535 263" />
          {isDisrupted && <path className="schematic-route schematic-route--affected" d="M244 148 L360 202 L475 240" />}
          {recommended && <path className="schematic-route schematic-route--recommended" d="M68 48 L145 74 L228 114 L310 151 L407 205 L505 274 L535 263" />}
          <circle className="schematic-marker schematic-marker--start" cx="68" cy="48" r="10" />
          <circle className="schematic-marker schematic-marker--end" cx="535" cy="263" r="10" />
        </svg>
        <span className="fallback-attribution">Route schematic · © OpenStreetMap contributors</span>
      </div>
      <div ref={containerRef} className={`route-map ${mapReady ? "route-map--ready" : ""}`} />
      <div className="map-summary sr-only">
        The usual route runs from Tampines to Raffles Place
        {recommended ? "; the recommended route uses the Downtown Line to avoid the affected East-West Line" : ""}.
      </div>
      <div className="route-legend" aria-label="Route legend">
        {recommended && <span><i className="legend-line legend-line--recommended" />Recommended</span>}
        <span><i className={`legend-line ${isDisrupted ? "legend-line--affected" : "legend-line--usual"}`} />{isDisrupted ? "Usual · affected" : "Usual route"}</span>
      </div>
    </div>
  );
}

export function RouteMap(props: RouteMapProps) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  return apiKey ? <GoogleRouteMap {...props} apiKey={apiKey} /> : <MapLibreRouteMap {...props} />;
}
