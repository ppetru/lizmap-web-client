import { mainLizmap, mainEventDispatcher } from '../modules/Globals.js';
import Utils from '../modules/Utils.js';
import olMap from 'ol/Map.js';
import View from 'ol/View.js';
import { transformExtent, get as getProjection } from 'ol/proj.js';
import ImageWMS from 'ol/source/ImageWMS.js';
import WMTS, {optionsFromCapabilities} from 'ol/source/WMTS.js';
import WMTSCapabilities from 'ol/format/WMTSCapabilities.js';
import WMTSTileGrid from 'ol/tilegrid/WMTS.js';
import {getWidth} from 'ol/extent.js';
import {Image as ImageLayer, Tile as TileLayer} from 'ol/layer.js';
import XYZ from 'ol/source/XYZ.js';
import BingMaps from 'ol/source/BingMaps.js';
import LayerGroup from 'ol/layer/Group.js';

import DragPan from "ol/interaction/DragPan.js";
import MouseWheelZoom from "ol/interaction/MouseWheelZoom.js";
import DoubleClickZoom from 'ol/interaction/DoubleClickZoom.js';
import { defaults as defaultInteractions } from 'ol/interaction.js';

/** Class initializing Openlayers Map. */
export default class BaseLayersMap extends olMap {

    constructor() {
        const qgisProjectProjection = mainLizmap.projection;
        const mapProjection = getProjection(qgisProjectProjection);

        super({
            controls: [], // disable default controls
            interactions: defaultInteractions({
                dragPan: false,
                mouseWheelZoom: false
            }).extend([
                new DragPan(),
                new MouseWheelZoom({ duration: 0 }),
                new DoubleClickZoom({ duration: 0 })
            ]),
            view: new View({
                resolutions: mainLizmap.lizmap3.map.resolutions ? mainLizmap.lizmap3.map.resolutions : mainLizmap.lizmap3.map.baseLayer.resolutions,
                constrainResolution: true,
                center: [mainLizmap.lizmap3.map.getCenter().lon, mainLizmap.lizmap3.map.getCenter().lat],
                projection: mapProjection,
                enableRotation: false,
                extent: mainLizmap.lizmap3.map.restrictedExtent.toArray(),
                constrainOnlyCenter: true // allow view outside the restricted extent when zooming
            }),
            target: 'baseLayersOlMap'
        });

        this._hasEmptyBaseLayer = false;
        const baseLayers = [];
        let cfgBaseLayers = [];
        if(mainLizmap.config?.baseLayers){
            cfgBaseLayers = Object.entries(mainLizmap.config.baseLayers);
        }

        for (const baseLayerCfg of mainLizmap.initialConfig.baseLayers.getBaseLayerConfigs()) {
            let baseLayer;
            if (baseLayerCfg.type === 'xyz') {
                baseLayer = new TileLayer({
                    source: new XYZ({
                        url: baseLayerCfg.url,
                        projection: baseLayerCfg.crs,
                        minZoom: 0,
                        maxZoom: baseLayerCfg.numZoomLevels,
                    })
                });
            } else if (baseLayerCfg.type === 'wms') {
                baseLayer = new ImageLayer({
                    source: new ImageWMS({
                        url: baseLayerCfg.url,
                        projection: baseLayerCfg.crs,
                        params: {
                            LAYERS: baseLayerCfg.layer,
                            FORMAT: baseLayerCfg.format
                        },
                    })
                });
            } else if (baseLayerCfg.type === 'wmts') {
                const proj3857 = getProjection('EPSG:3857');
                const maxResolution = getWidth(proj3857.getExtent()) / 256;
                const resolutions = [];
                const matrixIds = [];

                for (let i = 0; i < baseLayerCfg.numZoomLevels; i++) {
                  matrixIds[i] = i.toString();
                  resolutions[i] = maxResolution / Math.pow(2, i);
                }

                const tileGrid = new WMTSTileGrid({
                  origin: [-20037508, 20037508],
                  resolutions: resolutions,
                  matrixIds: matrixIds,
                });

                let url = baseLayerCfg.url;
                if(baseLayerCfg.key && url.includes('{key}')){
                    url = url.replaceAll('{key}', baseLayerCfg.key);
                }

                baseLayer = new TileLayer({
                    source: new WMTS({
                        url: url,
                        layer: baseLayerCfg.layer,
                        matrixSet: baseLayerCfg.matrixSet,
                        format: baseLayerCfg.format,
                        projection: baseLayerCfg.crs,
                        tileGrid: tileGrid,
                        style: baseLayerCfg.style
                    })
                });
            } else if (baseLayerCfg.type === 'bing') {
                baseLayer = new TileLayer({
                    preload: Infinity,
                    source: new BingMaps({
                        key: baseLayerCfg.key,
                        imagerySet: baseLayerCfg.imagerySet,
                    // use maxZoom 19 to see stretched tiles instead of the BingMaps
                    // "no photos at this zoom level" tiles
                    // maxZoom: 19
                    }),
                });
            } else if (baseLayerCfg.type === 'empty') {
                this._hasEmptyBaseLayer = true;
            }

            if(!baseLayer){
                continue;
            }

            const visible = mainLizmap.initialConfig.baseLayers.startupBaselayerName === baseLayerCfg.name;

            baseLayer.setProperties({
                name: baseLayerCfg.name,
                title: baseLayerCfg.title,
                visible: visible
            });

            baseLayers.push(baseLayer);

            if (visible && baseLayerCfg.crs !== qgisProjectProjection) {
                this.getView().getProjection().setExtent(mainLizmap.lizmap3.map.restrictedExtent.toArray());
            }
        }

        this._baseLayersGroup = new LayerGroup({
            layers: baseLayers
        });

        this._baseLayersGroup.on('change', () => {
            mainEventDispatcher.dispatch('baseLayers.changed');
        });

        // Array of layers and groups in overlayLayerGroup
        this._overlayLayersAndGroups = [];

        // Returns a layer or a layerGroup depending of the node type
        const createNode = (node, parentName) => {
            const layerCfg = mainLizmap.config?.layers?.[node.name];
            const parentGroupCfg = mainLizmap.config?.layers?.[parentName];

            if(node.type === 'group'){
                const layers = [];
                for (const layer of node.children.slice().reverse()) {
                    layers.push(createNode(layer, node.name));
                }
                const layerGroup = new LayerGroup({
                    layers: layers
                });

                if (node.name !== 'root') {
                    layerGroup.setVisible(layerCfg?.toggled === "True");
                    layerGroup.setProperties({
                        name: node.name,
                        parentName: parentName,
                        mutuallyExclusive: layerCfg?.mutuallyExclusive === "True",
                        groupAsLayer: layerCfg?.groupAsLayer === "True"
                    });

                    this._overlayLayersAndGroups.push(layerGroup);
                }

                return layerGroup;
            } else {
                let layer;
                // Keep only layers with a geometry
                if(layerCfg?.type !== 'layer'){
                    return;
                }
                if(["", "none", "unknown"].includes(layerCfg.geometryType)){
                    return;
                }

                let extent = layerCfg.extent;
                if(layerCfg.crs !== "" && layerCfg.crs !== mainLizmap.projection){
                    extent = transformExtent(extent, layerCfg.crs, mainLizmap.projection);
                }

                // Set min/max resolution only if different from default
                let minResolution = layerCfg.minScale === 1 ? undefined : Utils.getResolutionFromScale(layerCfg.minScale);
                let maxResolution = layerCfg.maxScale === 1000000000000 ? undefined : Utils.getResolutionFromScale(layerCfg.maxScale);

                if (layerCfg.cached === "False") {
                    layer = new ImageLayer({
                        // extent: extent,
                        minResolution: minResolution,
                        maxResolution: maxResolution,
                        source: new ImageWMS({
                            url: mainLizmap.serviceURL,
                            serverType: 'qgis',
                            params: {
                                LAYERS: layerCfg?.shortname || layerCfg.name,
                                FORMAT: layerCfg.imageFormat,
                                DPI: 96
                            },
                        })
                    });
                } else {
                    const parser = new WMTSCapabilities();
                    const result = parser.read(lizMap.wmtsCapabilities);
                    const options = optionsFromCapabilities(result, {
                        layer: layerCfg?.shortname || layerCfg.name,
                        matrixSet: layerCfg.crs,
                    });

                    layer = new TileLayer({
                        minResolution: minResolution,
                        maxResolution: maxResolution,
                        source: new WMTS(options)
                    });
                }
                
                let isVisible = layerCfg.toggled === "True";

                // If parent group is a "group as layer" all layers in it are visible
                // and the visibility is handled by group
                if (parentGroupCfg?.groupAsLayer === "True") {
                    isVisible = true;
                }

                layer.setVisible(isVisible);

                layer.setProperties({
                    name: layerCfg.name,
                    parentName: parentName
                });

                layer.on('change:visible', evt => {
                    // Set layer's group visible to `true` when layer's visible is set to `true`
                    // As in QGIS
                    const changedLayer = evt.target;
                    const parentGroup = this.getLayerOrGroupByName(changedLayer.get('parentName'));

                    if(!parentGroup){
                        return;
                    }

                    if (changedLayer.getVisible()) {
                        parentGroup?.setVisible(true);
                    }

                    // Mutually exclusive groups
                    if (changedLayer.getVisible() && parentGroup.get("mutuallyExclusive")) {
                        parentGroup.getLayers().forEach(layer => {
                            if (layer != changedLayer) {
                                layer.setVisible(false);
                            }
                        })
                    }
                });

                this._overlayLayersAndGroups.push(layer);
                return layer;
            }
        }

        this._overlayLayersGroup = new LayerGroup();

        if(mainLizmap.config.layersTree.children.length){
            this._overlayLayersGroup = createNode(mainLizmap.config.layersTree);
        }

        // Add base and overlay layers to the map's main LayerGroup
        this.setLayerGroup(new LayerGroup({
            layers: [this._baseLayersGroup, this._overlayLayersGroup]
        }));

        // Sync new OL view with OL2 view
        mainLizmap.lizmap3.map.events.on({
            move: () => {
                this.syncNewOLwithOL2View();
            }
        });

        // Init view
        this.syncNewOLwithOL2View();
    }

    get hasEmptyBaseLayer() {
        return this._hasEmptyBaseLayer;
    }

    get baseLayersGroup(){
        return this._baseLayersGroup;
    }

    get overlayLayersAndGroups(){
        return this._overlayLayersAndGroups;
    }

    // Get overlay layers (not layerGroups)
    get overlayLayers(){
        return this._overlayLayersGroup.getLayersArray();
    }

    get overlayLayersGroup(){
        return this._overlayLayersGroup;
    }

    /**
     * Synchronize new OL view with OL2 one
     * @memberof Map
     */
    syncNewOLwithOL2View(){
        this.getView().animate({
            center: mainLizmap.center,
            zoom: mainLizmap.lizmap3.map.getZoom(),
            duration: 0
        });
    }

    changeBaseLayer(name){
        let selectedBaseLayer;
        // Choosen base layer is visible, others not
        this.baseLayersGroup.getLayers().forEach( baseLayer => {
            if (baseLayer.get('name') == name) {
                selectedBaseLayer = baseLayer;
                baseLayer.set("visible", true, true);
            } else {
                baseLayer.set("visible", false, true);
            }
        });

        this._baseLayersGroup.changed();

        // If base layer projection is different from project projection
        // We must set the project extent to the View to reproject nicely
        if (selectedBaseLayer?.getSource().getProjection().getCode() !== mainLizmap.projection) {
            this.getView().getProjection().setExtent(mainLizmap.lizmap3.map.restrictedExtent.toArray());
        } else {
            this.getView().getProjection().setExtent(getProjection(mainLizmap.projection).getExtent());
        }

        // Trigger event
        lizMap.events.triggerEvent("lizmapbaselayerchanged", { 'layer': name});

        // Refresh metadatas if sub-dock is visible
        if ( document.getElementById('sub-dock').offsetParent !== null ) {
            lizMap.events.triggerEvent("lizmapswitcheritemselected", {
                'name': name, 'type': 'baselayer', 'selected': true
            });
        }
    }

    getActiveBaseLayer(){
        return this._baseLayersGroup.getLayers().getArray().find(
            layer => layer.getVisible()
        );
    }

    /**
     * Return overlay layer if `name` matches.
     * `name` is unique for every layers
     */
    getLayerByName(name){
        return this.overlayLayers.find(
            layer => layer.get('name') === name
        );
    }

    /**
     * Return overlay layer or group if `name` matches.
     * `name` is unique for every layers/groups
     */
    getLayerOrGroupByName(name){
        return this.overlayLayersAndGroups.find(
            layer => layer.get('name') === name
        );
    }

    /**
     * Return overlay layer if `typeName` matches
     */
    getLayerByTypeName(typeName){
        return this.overlayLayers.find(
            layer => layer.getSource().getParams?.()?.LAYERS === typeName
        );
    }
}
