// 화면 조립: 5개 최상위 컴포넌트 HTML을 #app에 동기적으로 조립한다.
// state.js/events.js가 모듈 로드 시점에 곧바로 getElementById로 DOM을 찾기 때문에,
// 이 조립은 반드시 그 모듈들이 import되기 전에 끝나야 한다.

import headerHtml from './components/header(헤더)/header(헤더).js';
import leftSidebarHtml from './components/leftSidebar(왼쪽사이드바)/leftSidebar(왼쪽사이드바).js';
import workspaceHtml from './components/workspace(작업공간)/workspace(작업공간).js';
import rightSidebarHtml from './components/rightSidebar(오른쪽사이드바)/rightSidebar(오른쪽사이드바).js';
import printReportHtml from './components/printReport(인쇄보고서)/printReport(인쇄보고서).html?raw';

const app = document.getElementById('app');
app.innerHTML = `
    <input type="checkbox" id="left-sidebar-toggle" class="sidebar-toggle-checkbox">
    ${headerHtml}
    <main class="app-layout">
        ${leftSidebarHtml}
        ${workspaceHtml}
        ${rightSidebarHtml}
    </main>
    ${printReportHtml}
`;
