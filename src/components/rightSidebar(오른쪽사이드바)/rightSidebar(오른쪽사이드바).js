// 오른쪽 사이드바 조립: 탭 헤더(정적) + 탭 4개(dashboard/loadingSheet/benchProfile/specTable)를 합친다.

import dashboardHtml from './dashboard(발파대시보드)/dashboard(발파대시보드).html?raw';
import loadingSheetHtml from './loadingSheet(천공장약일람표)/loadingSheet(천공장약일람표).html?raw';
import benchProfileHtml from './benchProfile(벤치단면도)/benchProfile(벤치단면도).html?raw';
import specTableHtml from './specTable(추천제원표)/specTable(추천제원표).html?raw';

export default `
        <aside class="sidebar right-sidebar">
            <div class="tab-header">
                <button id="tab-summary" class="tab-btn active">발파 대시보드</button>
                <button id="tab-loading-sheet" class="tab-btn">천공/장약 일람표</button>
                <button id="tab-bench-profile" class="tab-btn">벤치 단면도</button>
                <button id="tab-spec-table" class="tab-btn">추천 제원표</button>
            </div>

            <div class="tab-content scrollable-section">
${dashboardHtml}

${loadingSheetHtml}

${benchProfileHtml}

${specTableHtml}
            </div>
        </aside>
`;
