// AeroBlast Pro - 발파공 캔버스 좌표 ↔ 위경도(lon/lat) 변환 헬퍼 (순수 함수, DOM 비의존)
//
// exportImport.js의 exportProjectCSV()가 쓰는 것과 동일한 변환 로직(지도 로드 시 ol.proj.toLonLat,
// 미로드 시 terrainOffset 기준 각도 근사)을 재사용해, 진동해석 화면의 보안물건 이격거리 계산에 쓴다.

export function holeToLonLat(state, hole) {
    if (state.map && !state.canvasMode) {
        const lonLat = ol.proj.toLonLat([hole.x, hole.y], state.map.getView().getProjection());
        return { lon: lonLat[0], lat: lonLat[1] };
    }
    const latAnchor = state.terrainOffset.y;
    const lonAnchor = state.terrainOffset.x;
    const latOffsetDeg = (hole.y * state.scaleFactor) / 111111;
    const lonOffsetDeg = (hole.x * state.scaleFactor) / (111111 * Math.cos(latAnchor * Math.PI / 180));
    return { lat: latAnchor + latOffsetDeg, lon: lonAnchor + lonOffsetDeg };
}

/** 발파공 배열의 중심좌표를 위경도로 변환 (보안물건까지의 대표 이격거리 기준점). */
export function getHolesCentroidLonLat(state) {
    if (!state.holes.length) return null;
    const cx = state.holes.reduce((s, h) => s + h.x, 0) / state.holes.length;
    const cy = state.holes.reduce((s, h) => s + h.y, 0) / state.holes.length;
    return holeToLonLat(state, { x: cx, y: cy });
}

export function getDistanceMeters(lonLat1, lonLat2) {
    return ol.sphere.getDistance(lonLat1, lonLat2);
}
