// 왼쪽 사이드바 조립: 아코디언 3개를 각자 파일에서 가져와 나머지 정적 마크업(토글/분석도구버튼/오버레이4개)과 합친다.
// 편집 도구는 더 이상 이 사이드바 소속이 아니라 독립 컴포넌트(src/components/editTools(편집도구)/)로 분리되어
// workspace(작업공간).js가 캔버스 좌하단 플로팅바로 조립한다.
// 개별 조각의 이벤트 바인딩은 (공유 클로저 의존성 때문에) src/ui/events.js에 그대로 남아있다.

import designModeHtml from './designMode(설계모드)/designMode(설계모드).html?raw';
import holeEditorHtml from './holeEditor(발파공편집)/holeEditor(발파공편집).html?raw';
import droneDataHtml from './droneData(드론데이터관리)/droneData(드론데이터관리).html?raw';
import langeforsInputHtml from './langeforsInput(랑게포스입력)/langeforsInput(랑게포스입력).html?raw';
import blastSimulationHtml from './blastSimulation(발파시뮬레이션)/blastSimulation(발파시뮬레이션).html?raw';
import vibrationHtml from './analysisTools(분석도구)/vibration(진동PPV해석)/vibration(진동PPV해석).html?raw';
import regressionHtml from './analysisTools(분석도구)/regression(계측회귀분석)/regression(계측회귀분석).html?raw';
import moctHtml from './analysisTools(분석도구)/moct(국토부비장약량)/moct(국토부비장약량).html?raw';
import kuzramHtml from './analysisTools(분석도구)/kuzram(KuzRam파쇄도)/kuzram(KuzRam파쇄도).html?raw';

// 각 분석도구 html은 "버튼 + @overlay 마커 + 오버레이" 한 파일이지만,
// 오버레이 div는 .sidebar(backdrop-filter로 인해 fixed 포지셔닝 containing block이 깨짐) 밖에 있어야 하므로
// 마커 기준으로 잘라 버튼은 grid 안에, 오버레이는 </aside> 밖에 따로 조립한다.
const splitTool = (html) => {
    const [button, overlay] = html.split('<!-- @overlay -->');
    return { button, overlay };
};
const vibration = splitTool(vibrationHtml);
const regression = splitTool(regressionHtml);
const moct = splitTool(moctHtml);
const kuzram = splitTool(kuzramHtml);

export default `
        <!-- 왼쪽 사이드바: 매개변수 설정 & 모드 -->
        <aside class="sidebar left-sidebar">

${designModeHtml}
${holeEditorHtml}
            <!-- 분석 도구: 진동(PPV) 해석 / 계측 회귀분석 / 국토부·비장약량 / Kuz-Ram 파쇄도 -->
            <section class="accordion-section" data-accordion="analysis-tools">
                <div class="accordion-header">
                    <div class="section-title">
                        <i data-lucide="flask-conical"></i> 분석 도구
                    </div>
                    <i data-lucide="chevron-down" class="accordion-chevron"></i>
                </div>
                <div class="accordion-body">
                    <div class="accordion-body-inner">
                        <div class="analysis-tool-grid">
${vibration.button}
${regression.button}
${moct.button}
${kuzram.button}
                        </div>
                    </div>
                </div>
            </section>

${droneDataHtml}
${langeforsInputHtml}
${blastSimulationHtml}
        </aside>

    ${vibration.overlay}
    ${regression.overlay}
    ${moct.overlay}
    ${kuzram.overlay}
`;
