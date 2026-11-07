import { INK } from './charts';
import { PAGE } from './layout';

/** The report's stylesheet: A4 pages of fixed size, a system sans, hairlines, numbers in columns that line up. */
export const REPORT_CSS = `
@page { size: A4; margin: 0; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: ${PAGE.width}px; background: #fff; }
body {
  font-family: -apple-system, system-ui, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  color: ${INK.text}; font-size: 12px; line-height: 1.45;
  -webkit-font-smoothing: antialiased; -webkit-print-color-adjust: exact; print-color-adjust: exact;
  -webkit-text-size-adjust: 100%; text-size-adjust: 100%;
}
.page {
  width: ${PAGE.width}px; height: ${PAGE.height}px; padding: ${PAGE.padTop}px ${PAGE.padX}px 0;
  position: relative; overflow: hidden; break-after: page; page-break-after: always; break-inside: avoid;
}
.page:last-child { break-after: auto; page-break-after: auto; }
.b { overflow: hidden; flex: none; }
.run { height: 24px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid ${INK.grid}; font-size: 10px; color: ${INK.muted}; }
.run .brand { display: flex; align-items: center; gap: 6px; color: ${INK.text2}; }
.run .brand b { color: ${INK.text}; font-weight: 650; }
.foot { position: absolute; left: ${PAGE.padX}px; right: ${PAGE.padX}px; bottom: ${PAGE.padBottom}px; height: 16px; display: flex; align-items: center; justify-content: space-between; font-size: 9.5px; color: ${INK.muted}; }
.foot .n { font-variant-numeric: tabular-nums; color: ${INK.text2}; font-weight: 600; }

.row { display: flex; align-items: flex-start; }
.stack { display: flex; flex-direction: column; }
.muted { color: ${INK.muted}; }
.soft { color: ${INK.text2}; }
.p { color: ${INK.text2}; overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; text-wrap: pretty; }
.p.ink { color: ${INK.text}; }

.cover-top { display: flex; align-items: center; justify-content: space-between; height: 24px; }
.cover-top .brand { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 650; letter-spacing: -0.1px; }
.cover-top .made { font-size: 10.5px; color: ${INK.muted}; }
.h1 { margin-top: 26px; font-size: 30px; line-height: 36px; font-weight: 700; letter-spacing: -0.6px; text-wrap: balance; }
.who { margin-top: 4px; font-size: 13.5px; line-height: 20px; color: ${INK.text2}; }
.who b { color: ${INK.text}; font-weight: 600; }

.panel { background: #F6F5F1; border-radius: 12px; }
.facts { display: flex; height: 100%; align-items: center; padding: 0 18px; gap: 28px; }
.fact .l { font-size: 10px; color: ${INK.muted}; line-height: 14px; }
.fact .v { font-size: 13.5px; font-weight: 600; line-height: 19px; white-space: nowrap; }

.goal { padding: 14px 18px; height: 100%; }
.over { font-size: 10px; line-height: 14px; color: ${INK.muted}; font-weight: 600; letter-spacing: 0.2px; }
.goal .title { font-size: 15px; line-height: 21px; font-weight: 650; margin-top: 2px; }
.goal .words { font-size: 12px; line-height: 17px; color: ${INK.text2}; overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; margin-top: 3px; text-wrap: pretty; }
.rules { display: grid; grid-template-columns: 1fr 1fr; column-gap: 24px; margin-top: 10px; }
.rule { display: flex; justify-content: space-between; gap: 12px; height: 21px; align-items: center; border-top: 1px solid #E7E5DE; font-size: 11px; }
.rule span:first-child { color: ${INK.text2}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rule span:last-child { font-weight: 600; white-space: nowrap; font-variant-numeric: tabular-nums; }

.kpis { display: flex; gap: 10px; height: 100%; }
.kpi { flex: 1; background: #F6F5F1; border-radius: 10px; padding: 10px 12px; min-width: 0; }
.kpi .l { font-size: 10px; line-height: 13px; color: ${INK.muted}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.kpi .v { font-size: 19px; line-height: 25px; font-weight: 650; letter-spacing: -0.3px; white-space: nowrap; margin-top: 2px; }
.kpi .v small { font-size: 11px; font-weight: 500; color: ${INK.text2}; letter-spacing: 0; }
.kpi .s { font-size: 10px; line-height: 13px; color: ${INK.text2}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.sec { border-bottom: 1px solid ${INK.grid}; height: 100%; }
.sec .t { font-size: 19px; line-height: 25px; font-weight: 700; letter-spacing: -0.3px; display: flex; align-items: center; gap: 8px; }
.sec .t i { width: 4px; height: 17px; border-radius: 2px; background: ${INK.accent}; display: block; }
.sec .s { font-size: 11px; line-height: 16px; color: ${INK.text2}; margin-top: 3px; padding-left: 12px; overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; text-wrap: pretty; }
.sub { font-size: 12.5px; line-height: 18px; font-weight: 650; }

.chart .head { display: flex; justify-content: space-between; align-items: baseline; height: 18px; gap: 12px; }
.chart .head .t { font-size: 12px; font-weight: 650; white-space: nowrap; }
.chart .head .s { font-size: 10px; color: ${INK.text2}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.chart svg { display: block; margin-top: 6px; overflow: visible; }
.legend { display: flex; gap: 12px; align-items: center; font-size: 10px; color: ${INK.text2}; white-space: nowrap; height: 14px; }
.legend span { display: inline-flex; align-items: center; gap: 5px; }

.seg { display: flex; height: 26px; gap: 2px; margin-top: 6px; }
.seg div { border-radius: 4px; display: flex; align-items: center; padding: 0 8px; font-size: 10.5px; font-weight: 600; color: #fff; white-space: nowrap; overflow: hidden; }

.table { width: 100%; }
.tr { display: flex; align-items: center; border-bottom: 1px solid #F0EEE8; font-size: 11px; }
.tr.th { font-size: 9.5px; font-weight: 600; color: ${INK.muted}; border-bottom-color: #DCDAD2; align-items: flex-end; padding-bottom: 4px; }
.td { padding: 0 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: none; }
.td:first-child { padding-left: 0; }
.td:last-child { padding-right: 0; }
.td.right { text-align: right; font-variant-numeric: tabular-nums; }
.td.center { text-align: center; font-variant-numeric: tabular-nums; }
.tr.indent .td:first-child { padding-left: 14px; color: ${INK.text2}; }
.tr.day { background: #F6F5F1; background-clip: content-box; font-weight: 650; border-bottom: none; border-radius: 6px; padding-top: 8px; }
.tr.day .td:first-child { padding-left: 8px; }
.tr.day .td:last-child { padding-right: 8px; }
.tr.meal { align-items: flex-start; padding-top: 5px; }
.cell2 .a { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 15px; }
.cell2 .b2 { font-size: 10px; color: ${INK.text2}; line-height: 13px; white-space: normal; overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; }
.td .wrap { white-space: normal; overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; line-height: 15px; }
.cols { display: flex; align-items: flex-start; }
.toc { display: grid; grid-template-columns: 1fr 1fr; grid-auto-flow: column; column-gap: 28px; }
.toc div { display: flex; justify-content: space-between; height: 21px; align-items: center; border-bottom: 1px solid #F0EEE8; font-size: 11.5px; }
.toc div span:last-child { color: ${INK.text2}; font-variant-numeric: tabular-nums; }
.note { padding: 12px 16px; height: 100%; }
.note .p { font-size: 10.5px; line-height: 15px; margin-top: 3px; }
`;
