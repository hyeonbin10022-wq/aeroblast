// 헤더 조립: 7개 조각 HTML을 헤더 마크업 하나로 합쳐 bootstrap(화면조립).js에 내보낸다.
// 개별 조각의 이벤트 바인딩은 (공유 클로저 의존성 때문에) src/ui/events.js에 그대로 남아있다.

import logoHtml from './logo(로고)/logo(로고).html?raw';
import projectActionsHtml from './projectActions(프로젝트관리)/projectActions(프로젝트관리).html?raw';
import fileMenuHtml from './fileMenu(파일메뉴)/fileMenu(파일메뉴).html?raw';
import cloudMenuHtml from './cloudMenu(클라우드메뉴)/cloudMenu(클라우드메뉴).html?raw';
import printButtonHtml from './printButton(보고서출력버튼)/printButton(보고서출력버튼).html?raw';
import pricingHtml from './pricing(요금제)/pricing(요금제).html?raw';
import authHtml from './auth(로그인계정)/auth(로그인계정).html?raw';

export default `
    <header class="main-header">
        ${logoHtml}
        <div class="project-actions header-center-actions">
            ${projectActionsHtml}
            ${fileMenuHtml}
            ${cloudMenuHtml}
            ${printButtonHtml}
        </div>
        <div id="auth-area" class="header-right-actions" style="display: flex; align-items: center; gap: 8px; margin-left: 4px;">
            ${pricingHtml}
            ${authHtml}
        </div>
    </header>
`;
