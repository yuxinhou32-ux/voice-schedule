/* 表单功能专项：时长自填 / 时间节点 / 循环规则 / 重要事项 / 非法输入拦截 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const D = path.join(__dirname, '..');
const RAW = fs.readFileSync(path.join(D, 'index.html'), 'utf8');
const fc = fs.readFileSync(path.join(D, 'fullcalendar.min.js'), 'utf8');
let parser = '';
if (fs.existsSync(path.join(D, 'parser.js'))) parser = fs.readFileSync(path.join(D, 'parser.js'), 'utf8');

const EXPOSE = `<script>window.__x={
  events:()=>events, buildEventFromForm:()=>buildEventFromForm(),
  fDurMinutes, evDurMinutes, fRecurValue, clampDurInput
};</script>`;

let html = RAW.replace(/<script[^>]*\ssrc="fullcalendar\.min\.js[^"]*"[^>]*><\/script>/, () => '<script>' + fc + '</script>');
html = html.replace(/<script[^>]*\ssrc="parser\.js[^"]*"[^>]*><\/script>/, () => '<script>' + parser + '</script>');
html = html.replace('</body>', EXPOSE + '</body>');

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push('jsdomError: ' + (e.detail ? (e.detail.stack || e.detail.message) : e.message)));
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));
vc.on('warn', (...a) => { if (a[1] && a[1] instanceof Error) errors.push('warn: ' + (a[1].stack || a[1].message)); });

const dom = new JSDOM(html, {
  runScripts: 'dangerously', url: 'https://voical.test/', pretendToBeVisual: true, virtualConsole: vc,
  beforeParse(win) {
    win.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} };
    win.matchMedia = win.matchMedia || (q => ({ matches:false, media:q, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} }));
    win.URL.createObjectURL = () => 'blob:mock';
    win.URL.revokeObjectURL = () => {};
    win.SpeechRecognition = undefined; win.webkitSpeechRecognition = undefined;
    win.localStorage.setItem('voical-events', '[]');
    win.localStorage.setItem('voical-inbox', '[]');
    win.localStorage.setItem('voical-journal', '[]');
    win.localStorage.setItem('voical-pref', JSON.stringify({ ws:'mon', installedAt: Date.now() }));
    win.requestAnimationFrame = cb => setTimeout(() => cb(Date.now()), 0);
    win.cancelAnimationFrame = id => clearTimeout(id);
  }
});

const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = [];
let PASS = 0, FAIL = 0;
function ck(label, cond, detail){
  cond ? PASS++ : FAIL++;
  out.push((cond ? 'PASS ' : 'FAIL ') + label + (detail !== undefined ? '  → ' + detail : ''));
}
function info(s){ out.push('      · ' + s); }

(async () => {
  try {
    const win = dom.window;
    const document = win.document;
    await sleep(900);
    ck('0.1 页面加载无致命错误', errors.length === 0, errors.slice(0,3).join(' | '));

    const $ = id => document.getElementById(id);
    const X = () => win.__x;
    const unit = sel => document.querySelector(sel + ' button.on').dataset.du;

    ck('0.2 默认时长 60 分钟', X().fDurMinutes() === 60, X().fDurMinutes());

    // 场景 1：口述普通日程
    out.push('');
    out.push('## 场景 1：口述日程的默认值');
    $('recText').value = '明天下午三点半跟老张碰一下，大概一小时';
    $('recOk').click();
    await sleep(300);
    ck('1.1 确认面板弹出', $('confirmSheet').classList.contains('show'));
    info('fTitle=' + $('fTitle').value + ' fDur=' + $('fDur').value + ' unit=' + unit('#fDurUnitSeg'));
    ck('1.2 时长默认 60 / 单位分钟', $('fDur').value === '60' && unit('#fDurUnitSeg') === 'min');
    ck('1.3 循环默认为不循环', $('fRepeat').value === 'none');
    ck('1.4 时间节点默认关闭', !$('fNode').checked);
    ck('1.5 重要事项默认关闭', !$('fImp').checked);
    $('cfOk').click(); await sleep(300);
    const evs1 = X().events();
    ck('1.6 写入 1 条日程', evs1.length === 1, evs1.length);
    if (evs1[0]) ck('1.7 起止时间正确', evs1[0].start.indexOf('T15:30') >= 0 && evs1[0].end.indexOf('T16:30') >= 0, evs1[0].start + ' → ' + evs1[0].end);

    // 场景 2：时长自填
    out.push('');
    out.push('## 场景 2：时长自填（不限于固定档位）');
    $('recText').value = '后天上午九点拜访客户';
    $('recOk').click(); await sleep(300);
    $('fDur').value = '1.5';
    document.querySelector('#fDurUnitSeg button[data-du="hr"]').click();
    await sleep(50);
    info('fDur=1.5 unit=' + unit('#fDurUnitSeg') + ' → ' + X().fDurMinutes() + ' min');
    ck('2.1 1.5 小时 = 90 分钟', X().fDurMinutes() === 90, X().fDurMinutes());
    $('cfOk').click(); await sleep(300);
    const evs2 = X().events();
    ck('2.2 写入第 2 条', evs2.length === 2, evs2.length);
    if (evs2[1]) ck('2.3 结束时间 10:30', evs2[1].end.indexOf('T10:30') >= 0, evs2[1].end);

    $('recText').value = '大后天下午两点复盘会';
    $('recOk').click(); await sleep(300);
    $('fDur').value = '45';
    await sleep(50);
    ck('2.4 45 分钟档位外时长可读', X().fDurMinutes() === 45, X().fDurMinutes());
    $('cfOk').click(); await sleep(300);
    ck('2.5 写入第 3 条', X().events().length === 3, X().events().length);

    // 场景 3：时间节点 + 重要事项
    out.push('');
    out.push('## 场景 3：时间节点 / 重要事项开关');
    $('recText').value = '明天早上八点起床';
    $('recOk').click(); await sleep(300);
    $('fNode').checked = true;
    $('cfOk').click(); await sleep(300);
    const evs3 = X().events();
    ck('3.1 写入第 4 条', evs3.length === 4, evs3.length);
    if (evs3[3]) ck('3.2 node 标记落库', evs3[3].node === true, JSON.stringify(evs3[3].node));

    $('recText').value = '下周三上午十点参加线上日语课，一个半小时';
    $('recOk').click(); await sleep(300);
    $('fImp').checked = true;
    $('cfOk').click(); await sleep(300);
    const evs3b = X().events();
    ck('3.3 写入第 5 条', evs3b.length === 5, evs3b.length);
    if (evs3b[4]) ck('3.4 重要事项标记落库', evs3b[4].imp === true, JSON.stringify(evs3b[4].imp));
    if (evs3b[4]) ck('3.5 时长 90 分钟仍生效', evs3b[4].end.indexOf('T11:30') >= 0, evs3b[4].end);

    // 场景 4：循环规则（识别 + 手动修改）
    out.push('');
    out.push('## 场景 4：循环规则');
    $('recText').value = '每周一三五晚上七点半健身';
    $('recOk').click(); await sleep(300);
    ck('4.1 面板提示已识别循环', $('fRecurHint').style.display === 'block', $('fRecurHint').textContent);
    ck('4.2 循环选择器自动为 weekly', $('fRepeat').value === 'weekly');
    const selDays = Array.from(document.querySelectorAll('#fWeekly .wdbtn.on')).map(b=>b.textContent).join(',');
    ck('4.3 星期按钮已勾选一三五', selDays === '一,三,五', selDays);
    $('fRepeat').value = 'daily'; $('fRepeat').onchange();
    await sleep(50);
    ck('4.4 手动改成每天后星期行隐藏', $('fWeekly').style.display === 'none', $('fWeekly').style.display);
    $('cfOk').click(); await sleep(300);
    const evs4 = X().events();
    ck('4.5 写入第 6 条', evs4.length === 6, evs4.length);
    if (evs4[5]) ck('4.6 循环类型 daily 落库', evs4[5].recur && evs4[5].recur.type === 'daily', JSON.stringify(evs4[5].recur));

    // 场景 5：无循环口令时手动补每月
    out.push('');
    out.push('## 场景 5：普通口令手动改成每月 15 号');
    $('recText').value = '下个月十五号下午两点交房租';
    $('recOk').click(); await sleep(300);
    info('fRepeat=' + $('fRepeat').value + ' hint=' + $('fRecurHint').style.display);
    $('fRepeat').value = 'monthly'; $('fRepeat').onchange();
    $('fMd').value = '15';
    await sleep(50);
    ck('5.1 每月输入行显示', $('fMonthly').style.display === 'block', $('fMonthly').style.display);
    $('cfOk').click(); await sleep(300);
    const evs5 = X().events();
    ck('5.2 写入第 7 条', evs5.length === 7, evs5.length);
    if (evs5[6]) ck('5.3 monthly 且 rmd=15', evs5[6].recur && evs5[6].recur.type === 'monthly' && evs5[6].recur.rmd === 15, JSON.stringify(evs5[6].recur));

    // 场景 6：全天
    out.push('');
    out.push('## 场景 6：全天日程');
    $('recText').value = '明天一整天休息';
    $('recOk').click(); await sleep(300);
    document.querySelector('#fDurUnitSeg button[data-du="day"]').click();
    await sleep(50);
    ck('6.1 全天时读数 1440', X().fDurMinutes() === 1440, X().fDurMinutes());
    ck('6.2 全天时数字框禁用', $('fDur').disabled === true);
    $('cfOk').click(); await sleep(300);
    const evs6 = X().events();
    ck('6.3 写入第 8 条', evs6.length === 8, evs6.length);
    if (evs6[7]) ck('6.4 allDay=true', evs6[7].allDay === true);

    // 场景 7：非法输入拦截
    out.push('');
    out.push('## 场景 7：非法输入拦截（负数 / 字母 / 零）');
    const fake = document.createElement('input'); fake.value = '-30';
    X().clampDurInput(fake);
    ck('7.1 负号被过滤', fake.value === '30', JSON.stringify(fake.value));
    fake.value = '1.5.5'; X().clampDurInput(fake);
    ck('7.2 多个小数点只留第一个', fake.value === '1.55', JSON.stringify(fake.value));
    fake.value = 'abc'; X().clampDurInput(fake);
    ck('7.3 字母被清空', fake.value === '', JSON.stringify(fake.value));
    $('recText').value = '明天下午五点打电话';
    $('recOk').click(); await sleep(300);
    $('fDur').value = '0';
    const before = X().events().length;
    $('cfOk').click(); await sleep(300);
    ck('7.4 时长为 0 被拦下', X().events().length === before && $('confirmSheet').classList.contains('show'), X().events().length);

    // 场景 8：修订面板时长自填
    out.push('');
    out.push('## 场景 8：修订面板改成 2 小时 15 分钟');
    const id8 = evs1[0].id;
    win.openEvSheet(id8);
    await sleep(200);
    $('evDur').value = '2.25';
    document.querySelector('#evDurUnitSeg button[data-du="hr"]').click();
    await sleep(50);
    info('evDur=2.25 unit=' + unit('#evDurUnitSeg') + ' → ' + X().evDurMinutes() + ' min');
    ck('8.1 2.25 小时 = 135 分钟', X().evDurMinutes() === 135, X().evDurMinutes());
    $('evSave').click(); await sleep(300);
    const upd = X().events().find(e => e.id === id8);
    ck('8.2 修订后结束时间已更新', !!upd, upd && upd.end);

    out.push('');
    out.push('errors total: ' + errors.length);
    errors.slice(0, 6).forEach(e => out.push('  ! ' + e.slice(0, 300)));
  } catch (e) {
    out.push('FATAL ' + (e && e.stack || e));
  }
  out.push('');
  out.push('===== ' + PASS + ' passed, ' + FAIL + ' failed =====');
  fs.writeFileSync(path.join(D, '_features.txt'), out.join('\n'), 'utf8');
  process.stdout.write(out.join('\n') + '\n', () => process.exit(FAIL ? 1 : 0));
})();
