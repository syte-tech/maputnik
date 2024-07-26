import React, {type JSX} from 'react'
import ReactDOM from 'react-dom'
import MapLibreGl, {LayerSpecification, LngLat, Map, MapOptions, SourceSpecification, StyleSpecification} from 'maplibre-gl'
import MaplibreInspect from '@maplibre/maplibre-gl-inspect'
import colors from '@maplibre/maplibre-gl-inspect/lib/colors'
import MapMaplibreGlLayerPopup from './MapMaplibreGlLayerPopup'
import MapMaplibreGlFeaturePropertyPopup, { InspectFeature } from './MapMaplibreGlFeaturePropertyPopup'
import Color from 'color'
import ZoomControl from '../libs/zoomcontrol'
import { HighlightedLayer, colorHighlightedLayer } from '../libs/highlight'
import 'maplibre-gl/dist/maplibre-gl.css'
import '../maplibregl.css'
import '../libs/maplibre-rtl'
//@ts-ignore
import MaplibreGeocoder from '@maplibre/maplibre-gl-geocoder';
import '@maplibre/maplibre-gl-geocoder/dist/maplibre-gl-geocoder.css';

function renderPopup(popup: JSX.Element, mountNode: ReactDOM.Container): HTMLElement {
  ReactDOM.render(popup, mountNode);
  return mountNode as HTMLElement;
}

function buildInspectStyle(originalMapStyle: StyleSpecification, coloredLayers: HighlightedLayer[], highlightedLayer?: HighlightedLayer) {
  const backgroundLayer = {
    "id": "background",
    "type": "background",
    "paint": {
      "background-color": '#1c1f24',
    }
  } as LayerSpecification

  const layer = colorHighlightedLayer(highlightedLayer)
  if(layer) {
    coloredLayers.push(layer)
  }

  const sources: {[key:string]: SourceSpecification} = {}

  Object.keys(originalMapStyle.sources).forEach(sourceId => {
    const source = originalMapStyle.sources[sourceId]
    if(source.type !== 'raster' && source.type !== 'raster-dem') {
      sources[sourceId] = source
    }
  })

  const inspectStyle = {
    ...originalMapStyle,
    sources: sources,
    layers: [backgroundLayer].concat(coloredLayers as LayerSpecification[])
  }
  return inspectStyle
}

type MapMaplibreGlProps = {
  onDataChange?(event: {map: Map | null}): unknown
  onLayerSelect(...args: unknown[]): unknown
  mapStyle: StyleSpecification
  inspectModeEnabled: boolean
  highlightedLayer?: HighlightedLayer
  options?: Partial<MapOptions> & {
    showTileBoundaries?: boolean
    showCollisionBoxes?: boolean
    showOverdrawInspector?: boolean
  }
  replaceAccessTokens(mapStyle: StyleSpecification): StyleSpecification
  onChange(value: {center: LngLat, zoom: number}): unknown
};

type MapMaplibreGlState = {
  map: Map | null
  inspect: MaplibreInspect | null
  zoom?: number
};

export default class MapMaplibreGl extends React.Component<MapMaplibreGlProps, MapMaplibreGlState> {
  static defaultProps = {
    onMapLoaded: () => {},
    onDataChange: () => {},
    onLayerSelect: () => {},
    onChange: () => {},
    options: {} as MapOptions,
  }
  container: HTMLDivElement | null = null

  constructor(props: MapMaplibreGlProps) {
    super(props)
    this.state = {
      map: null,
      inspect: null,
    }
  }


  shouldComponentUpdate(nextProps: MapMaplibreGlProps, nextState: MapMaplibreGlState) {
    let should = false;
    try {
      should = JSON.stringify(this.props) !== JSON.stringify(nextProps) || JSON.stringify(this.state) !== JSON.stringify(nextState);
    } catch(e) {
      // no biggie, carry on
    }
    return should;
  }

  componentDidUpdate() {
    const map = this.state.map;

    const styleWithTokens = this.props.replaceAccessTokens(this.props.mapStyle);
    if (map) {
      // Maplibre GL now does diffing natively so we don't need to calculate
      // the necessary operations ourselves!
      // We also need to update the style for inspect to work properly
      map.setStyle(styleWithTokens, {diff: true});
      map.showTileBoundaries = this.props.options?.showTileBoundaries!;
      map.showCollisionBoxes = this.props.options?.showCollisionBoxes!;
      map.showOverdrawInspector = this.props.options?.showOverdrawInspector!;
    }

    if(this.state.inspect && this.props.inspectModeEnabled !== this.state.inspect._showInspectMap) {
      this.state.inspect.toggleInspector()
    }
    if (this.state.inspect && this.props.inspectModeEnabled) {
      this.state.inspect.setOriginalStyle(styleWithTokens);
      // In case the sources are the same, there's a need to refresh the style
      setTimeout(() => {
        this.state.inspect!.render();
      }, 500);
    }
  }

  componentDidMount() {
    const mapOpts = {
      ...this.props.options,
      container: this.container!,
      style: this.props.mapStyle,
      hash: true,
      maxZoom: 24,
      // setting to always load glyphs of CJK fonts from server
      // https://maplibre.org/maplibre-gl-js/docs/examples/local-ideographs/
      localIdeographFontFamily: false,
      transformRequest: (url: string) => {
        if (this.shouldUseAuthAccessTokenForUrl(url)) {
          const accessToken = this.getAuthAccessToken(this.props.mapStyle);
          if (!accessToken) {
            console.error(`No access token found for URL ${url}. This URL was configured to load with an auth_access_token.`);
            return;
          } 

          return {
            url,
            headers: {
              Authorization: `Bearer ${accessToken}`
            }
          }
        }
      }
    } satisfies MapOptions;

    const map = new MapLibreGl.Map(mapOpts);

    const mapViewChange = () => {
      const center = map.getCenter();
      const zoom = map.getZoom();
      this.props.onChange({center, zoom});
    }
    mapViewChange();

    map.showTileBoundaries = mapOpts.showTileBoundaries!;
    map.showCollisionBoxes = mapOpts.showCollisionBoxes!;
    map.showOverdrawInspector = mapOpts.showOverdrawInspector!;

    this.initGeocoder(map);

    const zoomControl = new ZoomControl;
    map.addControl(zoomControl, 'top-right');

    const nav = new MapLibreGl.NavigationControl({visualizePitch:true});
    map.addControl(nav, 'top-right');

    const tmpNode = document.createElement('div');

    const inspect = new MaplibreInspect({
      popup: new MapLibreGl.Popup({
        closeOnClick: false
      }),
      showMapPopup: true,
      showMapPopupOnHover: false,
      showInspectMapPopupOnHover: true,
      showInspectButton: false,
      blockHoverPopupOnClick: true,
      assignLayerColor: (layerId: string, alpha: number) => {
        return Color(colors.brightColor(layerId, alpha)).desaturate(0.5).string()
      },
      buildInspectStyle: (originalMapStyle: StyleSpecification, coloredLayers: HighlightedLayer[]) => buildInspectStyle(originalMapStyle, coloredLayers, this.props.highlightedLayer),
      renderPopup: (features: InspectFeature[]) => {
        if(this.props.inspectModeEnabled) {
          return renderPopup(<MapMaplibreGlFeaturePropertyPopup features={features} />, tmpNode);
        } else {
          return renderPopup(<MapMaplibreGlLayerPopup features={features} onLayerSelect={this.onLayerSelectById} zoom={this.state.zoom} />, tmpNode);
        }
      }
    })
    map.addControl(inspect)

    map.on("style.load", () => {
      this.setState({
        map,
        inspect,
        zoom: map.getZoom()
      });
    })

    map.on("data", e => {
      if(e.dataType !== 'tile') return
      this.props.onDataChange!({
        map: this.state.map
      })
    })

    map.on("error", e => {
      console.log("ERROR", e);
    })

    map.on("zoom", _e => {
      this.setState({
        zoom: map.getZoom()
      });
    });

    map.on("dragend", mapViewChange);
    map.on("zoomend", mapViewChange);
  }

  onLayerSelectById = (id: string) => {
    const index = this.props.mapStyle.layers.findIndex(layer => layer.id === id);
    this.props.onLayerSelect(index);
  }

  initGeocoder(map: Map) {
    const geocoderConfig = {
      forwardGeocode: async (config:{query: string, limit: number, language: string[]}) => {
        const features = [];
        try {
          const request = `https://nominatim.openstreetmap.org/search?q=${config.query}&format=geojson&polygon_geojson=1&addressdetails=1`;
          const response = await fetch(request);
          const geojson = await response.json();
          for (const feature of geojson.features) {
            const center = [
              feature.bbox[0] +
                  (feature.bbox[2] - feature.bbox[0]) / 2,
              feature.bbox[1] +
                  (feature.bbox[3] - feature.bbox[1]) / 2
            ];
            const point = {
              type: 'Feature',
              geometry: {
                type: 'Point',
                coordinates: center
              },
              place_name: feature.properties.display_name,
              properties: feature.properties,
              text: feature.properties.display_name,
              place_type: ['place'],
              center
            };
            features.push(point);
          }
        } catch (e) {
          console.error(`Failed to forwardGeocode with error: ${e}`);
        }
        return {
          features
        };
      }
    };
    const geocoder = new MaplibreGeocoder(geocoderConfig, {maplibregl: MapLibreGl});
    map.addControl(geocoder, 'top-left');
  }

  shouldUseAuthAccessTokenForUrl(url: string) {
    const metadata = this.props.mapStyle.metadata;

    if (typeof metadata === "object" && "maputnik:auth_access_token:url_schema" in metadata!) {
      const urlSchema = metadata!["maputnik:auth_access_token:url_schema"] as string;

      if (!urlSchema) return false;

      return urlSchema.split(",").some(part => url.includes(part));
    }
    return false;
  }

  getAuthAccessToken(mapStyle: StyleSpecification): string | null {
    if (typeof mapStyle.metadata === "object" && "maputnik:auth_access_token:token" in mapStyle.metadata!) {
      return mapStyle.metadata!["maputnik:auth_access_token:token"] as string;
    }
    return null;
  }

  render() {
    return <div
      className="maputnik-map__map"
      role="region"
      aria-label="Map view"
      ref={x => this.container = x}
      data-wd-key="maplibre:map"
    ></div>
  }
}

