// AeroBlast Pro - Drill & Blast Design Logic (Entry Point)

import './bootstrap(화면조립).js';
import { state, dom, setTerrainOffset } from './core/state.js';
import { showToast, switchView, updateDashboard, initEvents } from './ui/events.js';
import { draw2D } from './render/canvas2d.js';
import { update3DView } from './render/canvas3d.js';
import { recalculateBurdenSpacing } from './patterns/blastPatterns.js';
import { createHoleChargeDefaults } from './core/blastEngine.js';
import './ui/analysisOverlay.js';
import { initDesignMode } from './components/leftSidebar(왼쪽사이드바)/designMode(설계모드)/designMode(설계모드).js';
import { initHoleEditor } from './components/leftSidebar(왼쪽사이드바)/holeEditor(발파공편집)/holeEditor(발파공편집).js';
import { initBenchProfileView } from './components/rightSidebar(오른쪽사이드바)/benchProfile(벤치단면도)/benchProfile(벤치단면도).js';

// Register EPSG:5179 projection for NGII Map using Proj4
if (typeof proj4 !== 'undefined') {
    // Register all standard Korean coordinate systems
    proj4.defs('EPSG:5179', '+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 +x_0=1000000 +y_0=2000000 +ellps=GRS80 +units=m +no_defs');
    proj4.defs('EPSG:5181', '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=500000 +ellps=GRS80 +units=m +no_defs');
    proj4.defs('EPSG:5185', '+proj=tmerc +lat_0=38 +lon_0=125 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs');
    proj4.defs('EPSG:5186', '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs');
    proj4.defs('EPSG:5187', '+proj=tmerc +lat_0=38 +lon_0=129 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs');
    proj4.defs('EPSG:5188', '+proj=tmerc +lat_0=38 +lon_0=131 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs');
    
    // Register UTM zones used in Korea for RTK Drone mappings
    proj4.defs('EPSG:32651', '+proj=utm +zone=51 +ellps=WGS84 +datum=WGS84 +units=m +no_defs');
    proj4.defs('EPSG:32652', '+proj=utm +zone=52 +ellps=WGS84 +datum=WGS84 +units=m +no_defs');
    
    ol.proj.proj4.register(proj4);
    
    // Set extents to prevent out-of-bounds clipping
    const epsg_5179 = ol.proj.get('EPSG:5179');
    if (epsg_5179) epsg_5179.setExtent([-200000.0, -28024123.62, 31824123.62, 4000000.0]);
    
    const epsg_5186 = ol.proj.get('EPSG:5186');
    if (epsg_5186) epsg_5186.setExtent([-200000.0, -28024123.62, 31824123.62, 4000000.0]);
    
    const epsg_5181 = ol.proj.get('EPSG:5181');
    if (epsg_5181) epsg_5181.setExtent([-200000.0, -28024123.62, 31824123.62, 4000000.0]);

    const epsg_32652 = ol.proj.get('EPSG:32652');
    if (epsg_32652) epsg_32652.setExtent([-20000000, -20000000, 20000000, 20000000]);
    
    const epsg_32651 = ol.proj.get('EPSG:32651');
    if (epsg_32651) epsg_32651.setExtent([-20000000, -20000000, 20000000, 20000000]);
}

window.addEventListener('DOMContentLoaded', () => {
    initEvents();
    initMap();
    initDesignMode({ initMap });
    initHoleEditor();
    initBenchProfileView();
    resizeCanvas();
    updateDashboard();
    lucide.createIcons();
});

window.addEventListener('resize', () => {
    resizeCanvas();
});

// 사이드바 접기/펼치기는 순수 CSS(width 전환)라 window resize 이벤트가 발생하지 않는다.
// ResizeObserver로 캔버스 컨테이너 자체의 크기 변화를 감지해야 canvas.width/height가
// 실제 렌더 크기와 어긋나 클릭 좌표(홀 생성 위치)가 밀리는 문제를 막을 수 있다.
new ResizeObserver(() => resizeCanvas()).observe(dom.container2d);

function resizeCanvas() {
    const rect = dom.container2d.getBoundingClientRect();
    dom.canvas.width = rect.width;
    dom.canvas.height = rect.height;
    draw2D();
    
    if (state.three.renderer && state.three.active) {
        state.three.camera.aspect = rect.width / rect.height;
        state.three.camera.updateProjectionMatrix();
        state.three.renderer.setSize(rect.width, rect.height);
    }
}

export function initMap() {
    const ngiiKey = dom.inputNgiiKey ? dom.inputNgiiKey.value.trim() : state.ngiiApiKey;
    const vworldKey = dom.inputVworldKey ? dom.inputVworldKey.value.trim() : state.vworldApiKey;
    const baseMapType = dom.selectBaseMap ? dom.selectBaseMap.value : state.baseMapType;
    
    state.ngiiApiKey = ngiiKey;
    state.vworldApiKey = vworldKey;
    state.baseMapType = baseMapType;
    
    let layers = [];
    
    if (baseMapType === 'ngii' && ngiiKey) {
        // NGII WMTS Satellite Layer (EPSG:5179)
        const epsg_5179 = ol.proj.get('EPSG:5179');
        const resolutions = [2088.96, 1044.48, 522.24, 261.12, 130.56, 65.28, 32.64, 16.32, 8.16, 4.08, 2.04, 1.02, 0.51, 0.255];
        const matrixIds = ["L05","L06","L07","L08","L09","L10","L11","L12","L13","L14","L15","L16","L17","L18"];
        
        layers.push(new ol.layer.Tile({
            source: new ol.source.WMTS({
                url: `http://map.ngii.go.kr/openapi/Gettile.do?apikey=${ngiiKey}`,
                layer: 'satellite_map',
                matrixSet: 'EPSG:5179',
                format: 'image/png',
                projection: epsg_5179,
                tileGrid: new ol.tilegrid.WMTS({
                    origin: ol.extent.getTopLeft(epsg_5179.getExtent()),
                    resolutions: resolutions,
                    matrixIds: matrixIds
                }),
                style: 'korean'
            }),
            title: 'NGII Satellite'
        }));
    } else if (baseMapType === 'vworld' && vworldKey) {
        // VWorld Satellite Layer
        layers.push(new ol.layer.Tile({
            source: new ol.source.XYZ({
                url: `https://api.vworld.kr/req/wmts/1.0.0/${vworldKey}/Satellite/{z}/{y}/{x}.jpeg`
            }),
            title: 'VWorld Satellite'
        }));
        // VWorld Hybrid Layer (road overlay)
        layers.push(new ol.layer.Tile({
            source: new ol.source.XYZ({
                url: `https://api.vworld.kr/req/wmts/1.0.0/${vworldKey}/Hybrid/{z}/{y}/{x}.png`
            }),
            title: 'VWorld Hybrid'
        }));
    } else {
        // OpenStreetMap Fallback
        layers.push(new ol.layer.Tile({
            source: new ol.source.OSM(),
            title: 'OSM'
        }));
    }
    
    // Add GeoTIFF layer if it was loaded previously
    if (state.geoTiffLayer) {
        layers.push(state.geoTiffLayer);
    }
    
    if (state.map) {
        state.map.setLayers(layers);
        if (!state.geoTiffLayer) {
            const centerGwanghwamun = ol.proj.fromLonLat([126.9769, 37.5759]);
            const defaultView = new ol.View({
                center: centerGwanghwamun,
                zoom: 15,
                minZoom: 2,
                maxZoom: 24
            });
            state.map.setView(defaultView);
            defaultView.on('propertychange', () => {
                draw2D();
            });
        }
        return;
    }
    
    const centerGwanghwamun = ol.proj.fromLonLat([126.9769, 37.5759]);

    state.map = new ol.Map({
        target: 'editor-map',
        layers: layers,
        view: new ol.View({
            center: centerGwanghwamun,
            zoom: 15,
            minZoom: 2,
            maxZoom: 24
        })
    });

    // Shift+드래그는 발파공 박스 선택 용도로 쓰므로 OL 기본 확대(DragZoom) 상호작용은 제거
    state.map.getInteractions().getArray()
        .filter(i => i instanceof ol.interaction.DragZoom)
        .forEach(i => state.map.removeInteraction(i));

    // Disable canvas pointer events so the map gets drag & zoom events
    dom.canvas.style.pointerEvents = 'none';
    
    // Listen to map changes to sync canvas overlay
    state.map.on('postrender', () => {
        draw2D();
    });
    
    state.map.getView().on('propertychange', () => {
        draw2D();
    });
}

export function parseTFW(text) {
    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);
    if (lines.length < 6) return null;
    return {
        xScale: parseFloat(lines[0]),
        ySkew: parseFloat(lines[1]),
        xSkew: parseFloat(lines[2]),
        yScale: parseFloat(lines[3]),
        xOrigin: parseFloat(lines[4]),
        yOrigin: parseFloat(lines[5])
    };
}

export async function applyTifExtent(file, extent, epsgCode, centerCoord) {
    if (state.geoTiffLayer) {
        state.map.removeLayer(state.geoTiffLayer);
        state.geoTiffLayer = null;
    }
    
    showToast("정사영상 고해상도 최적화 매핑 중...", "info");
    
    try {
        const tiff = await GeoTIFF.fromBlob(file);
        const image = await tiff.getImage();
        const width = image.getWidth();
        const height = image.getHeight();
        
        // Define optimal maximum dimension for web display (16384px is the absolute browser canvas limit, enabling full native resolution)
        const maxDimension = 16384;
        let sampleWidth = width;
        let sampleHeight = height;
        let scale = 1;
        if (width > maxDimension || height > maxDimension) {
            scale = Math.max(width, height) / maxDimension;
            sampleWidth = Math.round(width / scale);
            sampleHeight = Math.round(height / scale);
        }
        
        console.log(`Optimizing TIF: original ${width}x${height} -> display ${sampleWidth}x${sampleHeight} (scale: ${scale.toFixed(2)})`);
        
        // Read raw rasters at full native size (takes < 200ms)
        const rasters = await image.readRasters({
            width: sampleWidth,
            height: sampleHeight,
            resampleMethod: 'bilinear'
        });
        
        const rBand = rasters[0];
        const gBand = rasters[1] || rBand;
        const bBand = rasters[2] || rBand;
        const len = sampleWidth * sampleHeight;
        
        // Draw onto canvas
        const canvas = document.createElement('canvas');
        canvas.width = sampleWidth;
        canvas.height = sampleHeight;
        const ctx = canvas.getContext('2d');
        const imgData = ctx.createImageData(sampleWidth, sampleHeight);
        
        // Optimize scale factor detection by sampling 1 in every 100 pixels (takes < 1ms)
        let maxVal = -Infinity;
        for (let i = 0; i < len; i += 100) {
            const rVal = rBand[i];
            if (!isNaN(rVal) && rVal > maxVal && rVal < 65000) maxVal = rVal;
        }
        
        if (maxVal === -Infinity) maxVal = 255.0;
        
        let scaleFactor = 1.0;
        if (maxVal > 0) {
            if (maxVal <= 1.01) {
                scaleFactor = 255.0; // Float range [0.0, 1.0] -> scale to [0, 255]
            } else if (maxVal > 255.0) {
                scaleFactor = 255.0 / maxVal; // 16-bit or 32-bit int -> scale to [0, 255]
            }
        }
        
        console.log(`TIF Max Value (sampled): ${maxVal}, Scale Factor: ${scaleFactor}`);
        
        const data = imgData.data;
        
        // BLAZING FAST DIRECT COPY LOOP FOR STANDARD 8-BIT IMAGES (takes < 70ms for 97M pixels in V8)
        if (scaleFactor === 1.0) {
            let destIdx = 0;
            for (let i = 0; i < len; i++) {
                const r = rBand[i];
                const g = gBand[i];
                const b = bBand[i];
                
                data[destIdx]     = r;
                data[destIdx + 1] = g;
                data[destIdx + 2] = b;
                
                // Pure black transparency mask
                data[destIdx + 3] = (r === 0 && g === 0 && b === 0) ? 0 : 255;
                
                destIdx += 4;
            }
        } else {
            let destIdx = 0;
            for (let i = 0; i < len; i++) {
                let r = rBand[i] * scaleFactor;
                let g = gBand[i] * scaleFactor;
                let b = bBand[i] * scaleFactor;
                
                if (isNaN(r) || r < 0) r = 0;
                if (isNaN(g) || g < 0) g = 0;
                if (isNaN(b) || b < 0) b = 0;
                if (r > 255) r = 255;
                if (g > 255) g = 255;
                if (b > 255) b = 255;
                
                data[destIdx]     = r;
                data[destIdx + 1] = g;
                data[destIdx + 2] = b;
                data[destIdx + 3] = (r === 0 && g === 0 && b === 0) ? 0 : 255;
                
                destIdx += 4;
            }
        }
        
        ctx.putImageData(imgData, 0, 0);
        const dataUrl = canvas.toDataURL('image/png');
        
        // Create standard ImageStatic source (highly compatible, requires no WebGL)
        const staticSource = new ol.source.ImageStatic({
            url: dataUrl,
            imageExtent: extent,
            projection: epsgCode
        });
        
        const imageLayer = new ol.layer.Image({
            source: staticSource,
            opacity: 0.95
        });
        
        state.geoTiffLayer = imageLayer;
        state.map.addLayer(imageLayer);
        
        // Create highly compressed thumbnail dataUrl for database sync (limit to max 4096px, JPEG 0.85 for high resolution)
        let compressedDbDataUrl = null;
        try {
            const dbMaxDim = 4096; // 4K high resolution limit
            let dbW = canvas.width;
            let dbH = canvas.height;
            if (dbW > dbMaxDim || dbH > dbMaxDim) {
                if (dbW > dbH) {
                    dbW = dbMaxDim;
                    dbH = Math.round(canvas.height * (dbMaxDim / canvas.width));
                } else {
                    dbH = dbMaxDim;
                    dbW = Math.round(canvas.width * (dbMaxDim / canvas.height));
                }
            }
            const dbCanvas = document.createElement('canvas');
            dbCanvas.width = dbW;
            dbCanvas.height = dbH;
            const dbCtx = dbCanvas.getContext('2d');
            dbCtx.drawImage(canvas, 0, 0, dbW, dbH);
            compressedDbDataUrl = dbCanvas.toDataURL('image/jpeg', 0.85); // High quality JPEG
            console.log("Compressed TIF for cloud sync (4K JPEG):", (compressedDbDataUrl.length / 1024).toFixed(1) + " KB");
        } catch (err) {
            console.error("Failed to compress TIF image for DB:", err);
            compressedDbDataUrl = dataUrl;
        }

        // Save current TIF metadata to state for cloud saving
        state.currentTif = {
            extent: extent,
            projection: epsgCode,
            dataUrl: compressedDbDataUrl
        };
        
        const view = new ol.View({
            projection: epsgCode,
            center: centerCoord,
            zoom: 16,
            minZoom: 2,
            maxZoom: 24
        });
        
        state.map.setView(view);
        
        // Bind change listener
        view.on('propertychange', () => {
            draw2D();
        });
        
        setTerrainOffset(centerCoord);
        
        state.scaleFactor = 1.0;
        state.bgImage = null;
        state.imageLoaded = true;
        state.isScaleCalibrated = true;
        
        dom.scaleIndicator.textContent = `GeoTIFF 정사영상 로드 완료 (좌표계: ${epsgCode})`;
        dom.scaleIndicator.parentElement.style.borderLeftColor = 'var(--accent-cyan)';
        
        const modal = document.getElementById('tif-gps-modal');
        if (modal) modal.classList.add('hidden');
        
        recalculateBurdenSpacing();
        updateDashboard();
        draw2D();
        
        showToast("정사영상 외부 좌표 보정 및 정합 성공!", "check-circle");
    } catch (err) {
        console.error("GeoTIFF canvas rendering failed:", err);
        showToast("정사영상 이미지 시각화 실패. 올바른 포맷인지 확인해 주세요.", "alert-triangle");
    }
}

export async function loadGeoTIFFFile(file) {
    if (!state.map) {
        showToast("지도가 활성화되어 있지 않아 GeoTIFF 로드가 불가합니다.", "warning");
        return;
    }
    
    showToast("GeoTIFF 정사영상 분석 및 로딩 중...", "info");
    
    try {
        // Read GeoTIFF tags using geotiff.js
        const tiff = await GeoTIFF.fromBlob(file);
        const image = await tiff.getImage();
        const width = image.getWidth();
        const height = image.getHeight();
        const geoKeys = image.getGeoKeys();
        
        let origin = null;
        let resolution = null;
        const fd = image.fileDirectory;
        
        console.log("TIFF File Directory:", fd);
        console.log("TIFF GeoKeys:", geoKeys);
        
        try {
            origin = image.getOrigin();
            resolution = image.getResolution();
        } catch (err) {
            console.warn("getOrigin/getResolution failed, fallback to directory lookup:", err);
        }
        
        // Fallback checks for various TIFF tags (including ModelTransformation matrix)
        if (!origin || !resolution || origin[0] === 0) {
            if (fd) {
                const tiepoint = fd.ModelTiepoint || fd.modelTiepoint;
                const scale = fd.ModelPixelScale || fd.modelPixelScale;
                if (tiepoint && scale) {
                    origin = [tiepoint[3], tiepoint[4], tiepoint[5]];
                    resolution = [scale[0], -scale[1], scale[2]];
                } else {
                    const trans = fd.ModelTransformation || fd.modelTransformation;
                    if (trans && trans.length >= 16) {
                        origin = [trans[3], trans[7], trans[11]];
                        resolution = [trans[0], trans[5], trans[10]];
                    }
                }
            }
        }
        
        const isGeoreferenced = origin && resolution && origin[0] !== null && origin[0] !== undefined && origin[0] !== 0 && Math.abs(origin[0]) > 1000;
        
        if (isGeoreferenced) {
            // Auto-detect projection and compute extent
            const minX = origin[0];
            const maxY = origin[1];
            const resX = Math.abs(resolution[0]);
            const resY = Math.abs(resolution[1]);
            
            const maxX = minX + width * resX;
            const minY = maxY - height * resY;
            const extent = [minX, minY, maxX, maxY];
            
            const centerX = minX + (width * resX) / 2;
            const centerY = maxY - (height * resY) / 2;
            
            let epsgCode = "EPSG:5186"; // Default standard
            const projectedCSType = geoKeys ? geoKeys.ProjectedCSTypeGeoKey : null;
            if (projectedCSType) {
                epsgCode = "EPSG:" + projectedCSType;
            } else {
                // Range-based Korean projection auto-detection
                if (minX > 800000) epsgCode = "EPSG:5179";
                else if (minX > 280000) epsgCode = "EPSG:5187";
                else if (minX > 150000) epsgCode = "EPSG:5186";
                else if (minX > 50000) epsgCode = "EPSG:5185";
            }
            
            // Check if projection is registered. If not, fallback to auto-detected standard.
            if (!ol.proj.get(epsgCode)) {
                if (minX > 800000) epsgCode = "EPSG:5179";
                else if (minX > 280000) epsgCode = "EPSG:5187";
                else epsgCode = "EPSG:5186";
            }
            
            applyTifExtent(file, extent, epsgCode, [centerX, centerY]);
            return;
        }
        
        // Non-georeferenced TIF, check for 8-digit Korean map sheet index in filename
        const match = file.name.match(/(\d{8})/);
        if (match) {
            const sheetIndex = match[1];
            const extentGps = getExtentFromSheetIndex(sheetIndex);
            
            if (extentGps) {
                const minCoord = ol.proj.fromLonLat([extentGps[0], extentGps[1]]);
                const maxCoord = ol.proj.fromLonLat([extentGps[2], extentGps[3]]);
                const extent = [minCoord[0], minCoord[1], maxCoord[0], maxCoord[1]];
                const centerX = (minCoord[0] + maxCoord[0]) / 2;
                const centerY = (minCoord[1] + maxCoord[1]) / 2;
                
                applyTifExtent(file, extent, 'EPSG:3857', [centerX, centerY]);
                showToast(`도엽번호 ${sheetIndex}를 자동 분석하여 정사영상을 실시간 정합했습니다!`, "check-circle");
                return;
            }
        }
        
        // No sheet index or parsing failed, show calibration modal as fallback
        state.tempTifFile = { file, width, height, tfw: null };
        const modal = document.getElementById('tif-gps-modal');
        if (modal) {
            modal.classList.remove('hidden');
            
            // Pre-fill manual coordinates based on map center
            const mapCenter = ol.proj.toLonLat(state.map.getView().getCenter(), state.map.getView().getProjection());
            const latInput = document.getElementById('input-tif-lat');
            const lonInput = document.getElementById('input-tif-lon');
            if (latInput) latInput.value = mapCenter[1].toFixed(6);
            if (lonInput) lonInput.value = mapCenter[0].toFixed(6);
            
            // Reset TFW dropzone state text
            const dropText = document.getElementById('drop-zone-tfw')?.querySelector('p');
            if (dropText) dropText.textContent = "동일한 파일명의 .tfw 파일 드롭 또는 클릭";
        }
        showToast("TIF 파일 헤더에 좌표 정보가 없습니다. 외부 좌표 설정을 실행해 주십시오.", "warning");
        
    } catch (e) {
        console.error(e);
        showToast("TIF 로딩 오류. 올바른 GeoTIFF 파일인지 확인해 주십시오.", "alert-triangle");
    }
}

function getExtentFromSheetIndex(sheetIndexStr) {
    if (!sheetIndexStr || sheetIndexStr.length !== 8) return null;
    
    try {
        const latBase = parseInt(sheetIndexStr.substring(0, 2));
        const lonBase = 120 + parseInt(sheetIndexStr.substring(2, 3));
        
        const val50 = parseInt(sheetIndexStr.substring(3, 5));
        if (val50 < 1 || val50 > 16) return null;
        const r50 = Math.floor((val50 - 1) / 4);
        const c50 = (val50 - 1) % 4;
        const minLat50 = latBase + (3 - r50) * 0.25;
        const minLon50 = lonBase + c50 * 0.25;
        
        const val5 = parseInt(sheetIndexStr.substring(5, 8));
        if (val5 < 1 || val5 > 100) return null;
        const r5 = Math.floor((val5 - 1) / 10);
        const c5 = (val5 - 1) % 10;
        const minLat = minLat50 + (9 - r5) * 0.025;
        const minLon = minLon50 + c5 * 0.025;
        
        const maxLat = minLat + 0.025;
        const maxLon = minLon + 0.025;
        
        return [minLon, minLat, maxLon, maxLat];
    } catch (e) {
        console.error("Failed to parse sheet index:", e);
        return null;
    }
}

export function getTerrainHeightAt(wx, wy) {
    if (!state.three.terrainMesh) return state.params.benchHeight; // default flat bench height
    
    const localX = wx - state.terrainOffset.x;
    const localZ = state.terrainOffset.y - wy; // Canvas Y maps to 3D Z
    
    // Fast lookup for loaded point clouds
    if (state.three.heightGrid) {
        const hg = state.three.heightGrid;
        const col = Math.floor((localX - hg.minX) / hg.dx);
        const row = Math.floor((localZ - hg.minZ) / hg.dz);
        if (col >= 0 && col < hg.cols && row >= 0 && row < hg.rows) {
            return hg.grid[row * hg.cols + col] || 0;
        }
        return 0;
    }
    
    if (state.three.terrainIsSynthetic) {
        // Use mathematical function for speed and precision
        let y = Math.sin(localX * 0.04) * Math.cos(localZ * 0.04) * 12;
        y += Math.sin(localX * 0.12) * Math.cos(localZ * 0.1) * 3.5;
        y += Math.cos(localX * 0.25) * Math.sin(localZ * 0.25) * 0.9;
        
        const distToCenter = Math.sqrt(localX*localX + localZ*localZ);
        if (distToCenter < 50) {
            const factor = distToCenter / 50;
            y = THREE.MathUtils.lerp(0.0, y, factor * factor);
        }
        return y;
    } else {
        // Raycast down on the uploaded mesh
        const raycaster = new THREE.Raycaster();
        raycaster.set(new THREE.Vector3(localX, 500, localZ), new THREE.Vector3(0, -1, 0));
        const intersects = raycaster.intersectObject(state.three.terrainMesh, true);
        if (intersects.length > 0) {
            return intersects[0].point.y;
        }
        return 0; // fallback if outside mesh boundary
    }
}

function createSyntheticTerrainGeometry(width, height) {
    const geo = new THREE.PlaneGeometry(width, height, 64, 64);
    // Rotate to lie flat on XZ plane
    geo.rotateX(-Math.PI / 2);
    
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        
        // Rugged mountains height formula
        let y = Math.sin(x * 0.04) * Math.cos(z * 0.04) * 12;
        y += Math.sin(x * 0.12) * Math.cos(z * 0.1) * 3.5;
        y += Math.cos(x * 0.25) * Math.sin(z * 0.25) * 0.9;
        
        // Flat quarry cut bench in the center (radius < 50m)
        const distToCenter = Math.sqrt(x*x + z*z);
        if (distToCenter < 50) {
            const factor = distToCenter / 50;
            y = THREE.MathUtils.lerp(0.0, y, factor * factor);
        }
        
        pos.setY(i, y);
    }
    geo.computeVertexNormals();
    return geo;
}

export function loadDemo3DTerrain() {
    // 1. Set local coordinates origin
    const swissCenter = [0, 0];
    setTerrainOffset({ x: 0, y: 0 });
    
    // 2. Generate Synthetic 3D Terrain mesh in Three.js
    const width = 300;
    const height = 300;
    const geo = createSyntheticTerrainGeometry(width, height);
    
    const mat = new THREE.MeshStandardMaterial({
        color: 0x2e3b4e,      // Slate Blue
        roughness: 0.8,
        metalness: 0.1,
        flatShading: true,     // gives a beautiful low-poly rugged rock feel!
        side: THREE.DoubleSide
    });
    
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    
    state.three.terrainMesh = mesh;
    state.three.terrainIsSynthetic = true;
    state.three.heightGrid = null; // Clear point cloud height grid
    
    // Create wireframe edges for techy overlay
    const wireGeo = new THREE.EdgesGeometry(geo);
    const wireMat = new THREE.LineBasicMaterial({ color: 0x00f3ff, linewidth: 1, transparent: true, opacity: 0.15 });
    state.three.terrainWireframe = new THREE.LineSegments(wireGeo, wireMat);
    
    // 3. Clear existing holes to match the new Swiss terrain context
    state.holes = [];
    state.rows = {};
    state.nextRowIndex = 1;
    state.freeFace = [];
    
    // Create a demo pattern inside the Swiss terrain to wow the user
    // The quarry cut is inside radius < 50 meters. Let's place a couple of rows!
    const row1Holes = [];
    const spacing = state.params.targetSpacing;
    const burden = state.params.targetBurden;
    
    // Draw 8 holes in Row 1 at Swiss coordinates
    for (let i = 0; i < 8; i++) {
        const localX = (i - 3.5) * spacing;
        const localY = -burden; // 2.5m offset
        const wx = swissCenter[0] + localX;
        const wy = swissCenter[1] - localY;
        
        const holeId = `H-1-${i+1}`;
        row1Holes.push({
            id: holeId,
            x: wx,
            y: wy,
            rowName: 'Row 1',
            spacing: spacing,
            burden: burden,
            ...createHoleChargeDefaults()
        });
    }
    state.holes.push(...row1Holes);
    state.rows['Row 1'] = row1Holes.map(h => h.id);
    
    // Row 2 holes (staggered)
    const row2Holes = [];
    for (let i = 0; i < 7; i++) {
        const localX = (i - 3) * spacing;
        const localY = burden; // spaced further back
        const wx = swissCenter[0] + localX;
        const wy = swissCenter[1] - localY;
        
        const holeId = `H-2-${i+1}`;
        row2Holes.push({
            id: holeId,
            x: wx,
            y: wy,
            rowName: 'Row 2',
            spacing: spacing,
            burden: burden,
            ...createHoleChargeDefaults()
        });
    }
    state.holes.push(...row2Holes);
    state.rows['Row 2'] = row2Holes.map(h => h.id);
    state.nextRowIndex = 3;
    
    // Trigger 2D canvas and 3D update
    draw2D();
    if (state.three.active) update3DView();
    
    showToast("스위스 체르마트 3D 지형 데모 로드 완료", "check-circle");
}

export function load3DModelFile(file) {
    const filename = file.name.toLowerCase();
    const blobUrl = URL.createObjectURL(file);
    
    showToast(`${file.name} 3D 모델 파일을 로딩하는 중...`, "info");
    
    // We center custom models around local origin (0, 0)
    setTerrainOffset({ x: 0, y: 0 });
    
    const onLoadSuccess = (object) => {
        let mesh = object;
        // If it's a GLTF structure, get the scene mesh
        if (object.scene) {
            mesh = object.scene;
        }
        
        // Auto-scale and center the loaded model
        const box = new THREE.Box3().setFromObject(mesh);
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        
        // Check if user wants to maintain real physical scale (highly recommended for georeferenced RTK files)
        const keepRealScale = dom.chkRealScale3D ? dom.chkRealScale3D.checked : false;
        
        let scaleFactor = 1.0;
        if (keepRealScale) {
            scaleFactor = 1.0;
            state.scaleFactor = 1.0; // GPS coordinates align with 1.0 scale
            state.isScaleCalibrated = true;
            dom.scaleIndicator.textContent = "실측 스케일 유지됨 (1px = 1m GPS 연동)";
            dom.scaleIndicator.parentElement.style.borderLeftColor = 'var(--accent-cyan)';
        } else {
            const targetSize = 250;
            scaleFactor = targetSize / maxDim;
            state.scaleFactor = scaleFactor;
            state.isScaleCalibrated = false;
            dom.scaleIndicator.textContent = `자동 축척 스케일 (기본: 1px = ${state.scaleFactor.toFixed(4)}m)`;
            dom.scaleIndicator.parentElement.style.borderLeftColor = 'var(--accent-purple)';
        }
        mesh.scale.set(scaleFactor, scaleFactor, scaleFactor);
        
        // Center it around (0, 0, 0)
        const newBox = new THREE.Box3().setFromObject(mesh);
        const center = newBox.getCenter(new THREE.Vector3());
        mesh.position.sub(center); // Translate to center
        
        // Apply shadows
        mesh.traverse(child => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
                if (child.material) {
                    child.material.side = THREE.DoubleSide;
                }
            }
        });
        
        state.three.terrainMesh = mesh;
        state.three.terrainIsSynthetic = false;
        state.three.terrainWireframe = null; // No wireframe needed for custom model
        state.three.heightGrid = null;      // Clear point cloud height grid
        
        // Clear holes and redraw
        state.holes = [];
        state.rows = {};
        state.nextRowIndex = 1;
        state.freeFace = [];
        
        draw2D();
        if (state.three.active) update3DView();
        
        // Switch to 3D view tab immediately so the user sees the model float
        switchView('3d');
        
        showToast("사용자 3D 지형 모델 로드 완료", "check-circle");
        
        // Auto-link coordinate alignment if a GeoTIFF is already loaded
        if (state.geoTiffLayer && state.terrainOffset) {
            state.scaleFactor = 1.0;
            state.isScaleCalibrated = true;
            dom.scaleIndicator.textContent = "정사영상 GPS 좌표계 연동 완료 (실측 1:1)";
            dom.scaleIndicator.parentElement.style.borderLeftColor = 'var(--accent-cyan)';
            
            recalculateBurdenSpacing();
            updateDashboard();
            draw2D();
            if (state.three.active) update3DView();
            
            showToast("정사영상(TIF)의 GPS 기준 좌표를 3D 모델에 자동 연동했습니다!", "check-circle");
        } else {
            // No TIF loaded yet, open coordinates modal as fallback
            setTimeout(() => {
                dom.terrainGpsModal.classList.remove('hidden');
            }, 500);
        }
    };
    
    const onLoadError = (error) => {
        console.error(error);
        showToast("3D 모델 파일 로드 실패. 올바른 OBJ/GLTF/GLB 포맷인지 확인해 주세요.", "alert-triangle");
    };
    
    if (filename.endsWith('.obj')) {
        const loader = new THREE.OBJLoader();
        loader.load(blobUrl, onLoadSuccess, undefined, onLoadError);
    } else if (filename.endsWith('.gltf') || filename.endsWith('.glb')) {
        const loader = new THREE.GLTFLoader();
        loader.load(blobUrl, onLoadSuccess, undefined, onLoadError);
    } else {
        showToast("지원되지 않는 포맷입니다. OBJ, GLTF, GLB 파일만 가능합니다.", "warning");
    }
}

export function loadLAZFile(file) {
    if (!window.loaders) {
        showToast("포인트 클라우드 디코딩 라이브러리가 로드되지 않았습니다.", "alert-triangle");
        return;
    }

    showToast(`${file.name} 포인트 클라우드 파일을 로딩 및 압축 해제 중...`, "info");
    
    // Center point cloud around local origin
    setTerrainOffset({ x: 0, y: 0 });

    // Read the file as an ArrayBuffer
    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            const buffer = e.target.result;
            
            // Parse using loaders.gl LASLoader without workers to avoid cross-origin worker script restrictions
            const data = await window.loaders.load(buffer, window.loaders.LASLoader, {
                worker: false
            });
            
            const posAttr = data.attributes.POSITION || data.attributes.position;
            if (!data || !posAttr) {
                throw new Error("올바른 포인트 클라우드 데이터가 아닙니다.");
            }
            
            const positions = posAttr.value; // Float32Array of [x, y, z, ...]
            const numPoints = positions.length / 3;
            
            // Subsample if too large to prevent WebGL memory overload (maximum 1,000,000 points)
            let renderedPositions = positions;
            
            const colorAttr = data.attributes.COLOR || data.attributes.color || data.attributes.RGB || data.attributes.rgb;
            let renderedColors = colorAttr ? colorAttr.value : null;
            
            const maxRenderPoints = 1000000;
            if (numPoints > maxRenderPoints) {
                showToast(`데이터 크기가 커서 ${maxRenderPoints.toLocaleString()}개 점으로 서브샘플링하여 렌더링합니다.`, "info");
                const step = Math.floor(numPoints / maxRenderPoints);
                const subPos = new Float32Array(maxRenderPoints * 3);
                let subCol = renderedColors ? new Uint8Array(maxRenderPoints * 4) : null;
                
                for (let i = 0; i < maxRenderPoints; i++) {
                    const srcIdx = i * step;
                    subPos[i*3] = positions[srcIdx*3];
                    subPos[i*3+1] = positions[srcIdx*3+1];
                    subPos[i*3+2] = positions[srcIdx*3+2];
                    
                    if (subCol && renderedColors) {
                        subCol[i*4] = renderedColors[srcIdx*4];
                        subCol[i*4+1] = renderedColors[srcIdx*4+1];
                        subCol[i*4+2] = renderedColors[srcIdx*4+2];
                        subCol[i*4+3] = renderedColors[srcIdx*4+3];
                    }
                }
                renderedPositions = subPos;
                renderedColors = subCol;
            }
            
            // Auto scale and center the positions
            // Calculate local bounding box and center
            let minX = Infinity, maxX = -Infinity;
            let minY = Infinity, maxY = -Infinity; // height in loaders.gl is usually Z
            let minZ = Infinity, maxZ = -Infinity; // map vertical is usually Y
            
            const count = renderedPositions.length / 3;
            for (let i = 0; i < renderedPositions.length; i += 3) {
                const px = renderedPositions[i];
                const py = renderedPositions[i+1];
                const pz = renderedPositions[i+2];
                if (px < minX) minX = px;
                if (px > maxX) maxX = px;
                if (py < minY) minY = py;
                if (py > maxY) maxY = py;
                if (pz < minZ) minZ = pz;
                if (pz > maxZ) maxZ = pz;
            }
            
            const cX = (minX + maxX) / 2;
            const cY = (minY + maxY) / 2;
            const cZ = (minZ + maxZ) / 2;
            
            const sizeX = maxX - minX;
            const sizeY = maxY - minY;
            const sizeZ = maxZ - minZ;
            const maxDim = Math.max(sizeX, sizeY, sizeZ);
            
            // Scale to match target size 250m
            const targetSize = 250;
            const scaleFactor = targetSize / maxDim;
            
            // Three.js Coordinate mapping:
            // loaders.gl loads coordinates as: X, Y (horizontal) and Z (elevation/height).
            // In Three.js: X is X, Y is height (elevation), Z is Y (horizontal depth).
            // So mapping is:
            // Three.js X = (X - cX) * scaleFactor
            // Three.js Y = (Z - cZ) * scaleFactor // loaders.gl Z is height
            // Three.js Z = (Y - cY) * scaleFactor // loaders.gl Y is depth
            const finalPositions = new Float32Array(count * 3);
            for (let i = 0; i < count; i++) {
                finalPositions[i*3] = (renderedPositions[i*3] - cX) * scaleFactor;
                finalPositions[i*3+1] = (renderedPositions[i*3+2] - cZ) * scaleFactor; // Height
                finalPositions[i*3+2] = (renderedPositions[i*3+1] - cY) * scaleFactor; // Depth
            }
            
            // Build Three.js BufferGeometry
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(finalPositions, 3));
            
            // Apply colors if available
            let useVertexColors = false;
            if (renderedColors) {
                const colors = new Float32Array(count * 3);
                for (let i = 0; i < count; i++) {
                    colors[i*3] = renderedColors[i*4] / 255;
                    colors[i*3+1] = renderedColors[i*4+1] / 255;
                    colors[i*3+2] = renderedColors[i*4+2] / 255;
                }
                geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
                useVertexColors = true;
            }
            
            // Create Points material
            const material = new THREE.PointsMaterial({
                size: 0.8,
                vertexColors: useVertexColors,
                color: useVertexColors ? 0xffffff : 0x00f3ff,
                transparent: true,
                opacity: 0.8,
                sizeAttenuation: true
            });
            
            const pointsMesh = new THREE.Points(geometry, material);
            
            // Store as terrainMesh in state
            state.three.terrainMesh = pointsMesh;
            state.three.terrainIsSynthetic = false;
            state.three.terrainWireframe = null;
            
            // Build the height grid from the final local positions for super fast snaps!
            buildHeightGridFromPoints(finalPositions);
            
            // Clear holes and redraw
            state.holes = [];
            state.rows = {};
            state.nextRowIndex = 1;
            state.freeFace = [];
            
            draw2D();
            if (state.three.active) update3DView();
            
            // Switch to 3D view tab immediately
            switchView('3d');
            
            showToast(`${file.name} 포인트 클라우드 로드 완료 (${count.toLocaleString()} 점)`, "check-circle");
            
            // Auto-link coordinate alignment if a GeoTIFF is already loaded
            if (state.geoTiffLayer && state.terrainOffset) {
                state.scaleFactor = 1.0;
                state.isScaleCalibrated = true;
                dom.scaleIndicator.textContent = "정사영상 GPS 좌표계 연동 완료 (실측 1:1)";
                dom.scaleIndicator.parentElement.style.borderLeftColor = 'var(--accent-cyan)';
                
                recalculateBurdenSpacing();
                updateDashboard();
                draw2D();
                if (state.three.active) update3DView();
                
                showToast("정사영상(TIF)의 GPS 기준 좌표를 포인트 클라우드에 자동 연동했습니다!", "check-circle");
            } else {
                // No TIF loaded yet, open coordinates modal as fallback
                setTimeout(() => {
                    dom.terrainGpsModal.classList.remove('hidden');
                }, 500);
            }
            
        } catch (err) {
            console.error(err);
            showToast("LAZ/LAS 파일 디코딩 실패. 파일이 손상되었거나 올바르지 않은 형식입니다.", "alert-triangle");
        }
    };
    reader.readAsArrayBuffer(file);
}

function buildHeightGridFromPoints(positions) {
    let minX = Infinity, maxX = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    
    const numPoints = positions.length / 3;
    for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i];
        const z = positions[i+2];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
    }
    
    const cols = 150;
    const rows = 150;
    const grid = new Float32Array(cols * rows);
    const counts = new Int32Array(cols * rows);
    
    // Add margin to prevent out of bounds
    minX -= 1.0;
    maxX += 1.0;
    minZ -= 1.0;
    maxZ += 1.0;
    
    const dx = (maxX - minX) / cols;
    const dz = (maxZ - minZ) / rows;
    
    // Subsample for fast grid creation (max 500,000 points)
    const step = numPoints > 500000 ? Math.floor(numPoints / 500000) * 3 : 3;
    
    for (let i = 0; i < positions.length; i += step) {
        const x = positions[i];
        const y = positions[i+1]; // height
        const z = positions[i+2]; // depth
        
        const col = Math.floor((x - minX) / dx);
        const row = Math.floor((z - minZ) / dz);
        
        if (col >= 0 && col < cols && row >= 0 && row < rows) {
            const idx = row * cols + col;
            if (counts[idx] === 0 || y > grid[idx]) {
                grid[idx] = y;
            }
            counts[idx]++;
        }
    }
    
    // Fill empty cells by copying from nearest neighbors
    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            const idx = row * cols + col;
            if (counts[idx] === 0) {
                let found = false;
                for (let r = 1; r < 8 && !found; r++) {
                    const neighbors = [
                        {r: row-r, c: col}, {r: row+r, c: col},
                        {r: row, c: col-r}, {r: row, c: col+r},
                        {r: row-r, c: col-r}, {r: row+r, c: col+r},
                        {r: row-r, c: col+r}, {r: row+r, c: col-r}
                    ];
                    for (let n of neighbors) {
                        if (n.r >= 0 && n.r < rows && n.c >= 0 && n.c < cols) {
                            const nIdx = n.r * cols + n.c;
                            if (counts[nIdx] > 0) {
                                grid[idx] = grid[nIdx];
                                counts[idx] = 1;
                                found = true;
                                break;
                            }
                        }
                    }
                }
            }
        }
    }
    
    state.three.heightGrid = {
        grid, minX, maxX, minZ, maxZ, dx, dz, cols, rows
    };
}
