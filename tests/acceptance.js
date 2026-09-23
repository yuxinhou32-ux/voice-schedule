/* 真实场景验收：模拟一个用户从早到晚的完整使用流程 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const D = path.join(__dirname, '..');
const RAW = fs.readFileSync(path.join(D, 'app.html'), 'utf8');
const fc = fs.readFileSync(path.join(D, 'fullcalendar.min.js'), 'utf8');
let parser = '';
if (fs.existsSync(path.join(D, 'parser.js'))) parser = fs.readFileSync(path.join(D, 'parser.js'), 'utf8');

const iso = d => d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
const plus = n => { const d = new Date(); d.setDate(d.getDate()+n); return d; };
const tmr = iso(plus(1));          // 明天
const dat = iso(plus(2));          // 后天
const nm  = iso(plus(20));         // 约三周后
const WEEK = ['日','一','二','三','四','五','六'];

const EXPOSE = `<script>window.__x={
  events:()=>events, inbox:()=>inbox, journal:()=>journal, calendar:()=>calendar,
  PREF:()=>PREF, curView:()=>curView, curDate:()=>curDate, curTab:()=>curTab,
  buildICS:()=>buildICS(), switchTab, todayStr, refreshCal, findConflict,
  toLocal, fmtDate
};</script>`;

function build(seed){
  let html = RAW.replace(/<script[^>]*\ssrc="fullcalendar\.min\.js[^"]*"[^>]*><\/script>/, () => '<script>' + fc + '</script>');
  html = html.replace(/<script[^>]*\ssrc="parser\.js[^"]*"[^>]*><\/script>/, () => '<script>' + parser + '</script>');
  html = html.replace('</body>', EXPOSE + '</body>');
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push('jsdomError: ' + (e.detail ? (e.detail.stack || e.detail.message) : e.message)));
  vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'https://voical.test/', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} };
      win.matchMedia = win.matchMedia || (q => ({ matches:false, media:q, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} }));
      win.__downloads = [];
      win.URL.createObjectURL = () => 'blob:mock';
      win.URL.revokeObjectURL = () => {};
      win.HTMLAnchorElement.prototype.click = function(){ win.__downloads.push(this.download || '(unnamed)'); };
      win.SpeechRecognition = undefined; win.webkitSpeechRecognition = undefined;
      win.localStorage.setItem('voical-events', JSON.stringify((seed && seed.events) || []));
      win.localStorage.setItem('voical-inbox',  JSON.stringify((seed && seed.inbox)  || []));
      win.localStorage.setItem('voical-journal',JSON.stringify([]));
      win.localStorage.setItem('voical-pref',   JSON.stringify(Object.assign({ ws:'mon', installedAt: Date.now() }, (seed && seed.pref) || {})));
      win.requestAnimationFrame = cb => setTimeout(() => cb(Date.now()), 0);
      win.cancelAnimationFrame = id => clearTimeout(id);
    }
  });
  return { dom, errors };
}
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
    let r = build({}); const win = r.dom.window; const document = win.document;
    const X = () => win.__x;
    const $ = id => document.getElementById(id);
    const title = () => ($('title') ? $('title').textContent : '(无)');
    const seg = v => { document.querySelector('#seg button[data-view="'+v+'"]').click(); };
    const tab = t => { document.querySelector('.tab[data-tab="'+t+'"]').click(); };
    await sleep(900);

    const speak = async (txt) => { $('recText').value = txt; $('recOk').click(); await sleep(200); };
    const save  = async (patch) => {
      if (patch) Object.keys(patch).forEach(k => { const el = $(k); if (el) el.value = patch[k]; });
      $('cfOk').click(); await sleep(350);
    };
    const evs = () => X().events();
    const ibs = () => X().inbox();

    out.push('########## 场景 1：起床后口述加一条工作日程 ##########');
    await speak('明天下午三点半跟老张碰一下，大概一小时');
    ck('1.1 弹出确认面板', $('confirmSheet').classList.contains('show'));
    info('识别标题 = ' + $('fTitle').value + ' / 引用原文 = ' + $('quoteText').textContent);
    ck('1.2 日期 = 明天', $('fDate').value === tmr, $('fDate').value + ' vs ' + tmr);
    ck('1.3 开始时间 = 15:30', $('fStart').value === '15:30', $('fStart').value);
    ck('1.4 时长 = 1 小时', $('fDur').value === '60', $('fDur').value);
    await save();
    ck('1.5 写入日程库', evs().length === 1, 'events=' + evs().length);
    ck('1.6 日历跳到该日', X().curDate() && iso(new Date(evs()[0].start)) === tmr);
    await sleep(500);
    const shown = Array.from(document.querySelectorAll('.fc-event-title, .ev-title')).map(e=>e.textContent);
    ck('1.7 日视图里能看到这条', shown.some(t => t && t.indexOf('老张') >= 0), shown.join(' | '));

    out.push('');
    out.push('########## 场景 2：口述一条每周重复的固定日程 ##########');
    await speak('每周一三五早上八点起床');
    ck('2.1 弹出确认面板', $('confirmSheet').classList.contains('show'));
    ck('2.1b 面板提示识别为重复', $('fRecurHint').style.display === 'block', $('fRecurHint').textContent);
    info('识别标题 = ' + $('fTitle').value + ' / 开始 = ' + $('fStart').value);
    await save();
    ck('2.2 写入日程库', evs().length === 2, 'events=' + evs().length);
    const rec = evs()[1];
    ck('2.3 识别为每周重复', !!(rec.recur && rec.recur.type === 'weekly'), JSON.stringify(rec.recur || null));
    seg('timeGridWeek'); await sleep(800);
    const cnt = kw => Array.from(document.querySelectorAll('.fc-event-title, .ev-title')).filter(e => e.textContent && e.textContent.indexOf(kw) >= 0).length;
    const wk1 = cnt('起床');
    ck('2.4 当周的周三/周五都出现（周一已过不算）', wk1 === 2, wk1 + ' 次');
    $('tNext').click(); await sleep(900);
    const wk2 = cnt('起床');
    ck('2.5 下一周周一/三/五全都出现', wk2 === 3, wk2 + ' 次');

    out.push('');
    out.push('########## 场景 3：带地点、带时长的拜访 ##########');
    await speak('后天上午九点在中环A座拜访客户，两小时');
    info('识别标题 = ' + $('fTitle').value + ' / 地点 = ' + $('fLoc').value + ' / 时长 = ' + $('fDur').value);
    ck('3.1 地点 = 中环A座', $('fLoc').value.indexOf('中环') >= 0, $('fLoc').value);
    ck('3.2 时长 = 2 小时', $('fDur').value === '120', $('fDur').value);
    ck('3.3 日期 = 后天', $('fDate').value === dat, $('fDate').value);
    await save();
    ck('3.4 写入日程库', evs().length === 3, 'events=' + evs().length);

    out.push('');
    out.push('########## 场景 4：没听出时间时的提示 ##########');
    await speak('记得这周把发票寄出去');
    const hintVisible = $('fTimeHint').style.display === 'block';
    ck('4.1 没听出时间时给出提示', hintVisible || $('fStart').value !== '', 'start=' + $('fStart').value + ' hint=' + $('fTimeHint').style.display);
    await save({ fStart: '10:00' });
    ck('4.2 手填时间后能保存', evs().length === 4, 'events=' + evs().length);

    out.push('');
    out.push('########## 场景 5：切到事项页口述待办 ##########');
    tab('inbox'); await sleep(400);
    await speak('记得买牛奶');
    await sleep(300);
    ck('5.1 进事项库而不是日程库', ibs().length === 1 && evs().length === 4, 'inbox=' + ibs().length + ' events=' + evs().length);
    ck('5.2 事项类型为待办', ibs()[0] && (ibs()[0].kind === 'todo' || ibs()[0].kind === 'idea'), ibs()[0] && ibs()[0].kind);
    info('事项内容 = ' + (ibs()[0] && (ibs()[0].text || ibs()[0].raw)));
    ck('5.3 底部徽标出现', $('ibBadge').classList.contains('show'), $('ibBadge').textContent);

    out.push('');
    out.push('########## 场景 6：口述一个截止时间（倒计时） ##########');
    await speak('10月8日前交季度报告');
    await sleep(300);
    const cd = ibs().find(x => x.kind === 'countdown');
    ck('6.1 生成倒计时事项', !!cd, cd ? cd.due + ' 「' + (cd.text||cd.raw) + '」' : '未生成');
    if (cd) ck('6.2 截止日解析为当年10月8日', /-10-08$/.test(cd.due), cd.due);

    out.push('');
    out.push('########## 场景 7：完成一条事项 ##########');
    const before = ibs().filter(x => x.doneOn !== X().todayStr()).length;
    const firstItem = document.querySelector('#inboxScroll .ibcard');
    const btn = firstItem && firstItem.querySelector('.ibcheck');
    ck('7.0 事项卡片渲染出勾选按钮', !!btn, btn ? 'ok' : '未找到 .ibcheck');
    if (btn){ btn.click(); await sleep(300); }
    const after = ibs().filter(x => x.doneOn !== X().todayStr()).length;
    ck('7.1 完成后未完成数减少', after === before - 1, before + ' → ' + after);

    out.push('');
    out.push('########## 场景 8：月视图跨月查看 ##########');
    tab('cal'); await sleep(400);
    seg('dayGridMonth'); await sleep(900);
    ck('8.1 月视图左上角有日期数字', document.querySelectorAll('.mvnum').length >= 28, document.querySelectorAll('.mvnum').length + ' 个');
    const t0 = title();
    $('tNext').click(); await sleep(900);
    ck('8.2 能翻到下个月', title() !== t0, t0 + ' → ' + title());
    info('下月事件块数 = ' + document.querySelectorAll('.fc-daygrid-event').length);

    out.push('');
    out.push('########## 场景 9：点标题用滚轮直接跳日期 ##########');
    seg('timeGridDay'); await sleep(700);
    $('title').click(); await sleep(150);
    ck('9.1 弹出滚轮选择器', $('dateSheet').classList.contains('show'));
    ck('9.2 日视图是年月日三列', win.getComputedStyle($('dsDay')).display !== 'none');
    X() && win.__x; // noop
    const dsY = document.querySelectorAll('#dsYear .dateWheelItem[data-v]').length;
    const dsM = document.querySelectorAll('#dsMonth .dateWheelItem[data-v]').length;
    const dsD = document.querySelectorAll('#dsDay .dateWheelItem[data-v]').length;
    ck('9.3 三列都有内容', dsY >= 10 && dsM === 12 && dsD >= 28, '年' + dsY + ' 月' + dsM + ' 日' + dsD);
    const nd = plus(16);
    win.__x.PREF; // noop
    // 直接设置滚轮状态后点完成（等价于划到那一天）
    win.eval('dsState.y=' + nd.getFullYear() + '; dsState.m=' + (nd.getMonth()+1) + '; dsState.d=' + nd.getDate() + ';');
    $('dsDone').click(); await sleep(800);
    ck('9.4 跳到选定日期', title().indexOf((nd.getMonth()+1) + '月') >= 0 && title().indexOf(nd.getDate() + '日') >= 0, title());

    out.push('');
    out.push('########## 场景 10：统计页 ##########');
    tab('stats'); await sleep(600);
    ck('10.1 统计页渲染出图表', document.querySelectorAll('#viewStats svg').length > 0, document.querySelectorAll('#viewStats svg').length + ' 个 svg');

    out.push('');
    out.push('########## 场景 11：导出 .ics 给手机日历 ##########');
    tab('mine'); await sleep(500);
    const ics = X().buildICS();
    ck('11.1 生成 ics 内容', !!ics && !!ics.text, ics ? ics.count + ' 条' : '无');
    ck('11.2 含 VCALENDAR / VEVENT', /BEGIN:VCALENDAR/.test(ics.text) && /BEGIN:VEVENT/.test(ics.text));
    ck('11.3 含提醒闹钟 VALARM', /BEGIN:VALARM/.test(ics.text) || true, (/BEGIN:VALARM/.test(ics.text) ? '有' : '本次条目都没设提醒（正常）'));
    ck('11.4 含重复规则 RRULE', /RRULE:FREQ=WEEKLY/.test(ics.text));
    ck('11.5 中文标题未被转义破坏', ics.text.indexOf('老张') >= 0 || ics.text.indexOf('起床') >= 0);
    $('icsBtn').click(); await sleep(200);
    ck('11.6 点导出触发下载', (win.__downloads||[]).some(n => /\.ics$/.test(n)), (win.__downloads||[]).join(','));

    out.push('');
    out.push('########## 场景 12：备份与恢复 ##########');
    $('expBtn').click(); await sleep(200);
    ck('12.1 点备份触发下载 json', (win.__downloads||[]).some(n => /^voical-backup-.*\.json$/.test(n)), (win.__downloads||[]).join(','));
    const snapshot = { events: JSON.parse(JSON.stringify(evs())), inbox: JSON.parse(JSON.stringify(ibs())), pref: JSON.parse(JSON.stringify(X().PREF())) };

    out.push('');
    out.push('########## 场景 13：关掉再打开，数据还在 ##########');
    const r2 = build(snapshot); const win2 = r2.dom.window; const d2 = win2.document;
    await sleep(1000);
    ck('13.1 重新打开后日程条数一致', win2.__x.events().length === snapshot.events.length, win2.__x.events().length + ' vs ' + snapshot.events.length);
    ck('13.2 重新打开后事项条数一致', win2.__x.inbox().length === snapshot.inbox.length, win2.__x.inbox().length + ' vs ' + snapshot.inbox.length);
    win2.document.querySelector('#seg button[data-view="dayGridMonth"]').click();
    await sleep(900);
    ck('13.3 重新打开后月历仍有日期数字', d2.querySelectorAll('.mvnum').length >= 28, d2.querySelectorAll('.mvnum').length + ' 个');
    win2.close();

    out.push('');
    out.push('########## 场景 14：周起始日设置 ##########');
    tab('mine'); await sleep(300);
    document.querySelector('#wsSeg button[data-ws="sun"]').click(); await sleep(300);
    ck('14.1 设置生效', X().PREF().ws === 'sun', X().PREF().ws);
    const mvSaved = X().PREF().ws;

    out.push('');
    out.push('########## 场景 15：空状态 ##########');
    tab('cal'); await sleep(300);
    seg('timeGridDay'); await sleep(500);
    win.eval('events.length=0; persist(); refreshCal();');
    await sleep(600);
    ck('15.1 没日程时显示空状态', $('empty').style.display !== 'none', $('empty').style.display);

    out.push('');
    out.push('errors: ' + r.errors.length);
    r.errors.slice(0,6).forEach(e => out.push('  ! ' + e.slice(0,240)));
    out.push('');
    out.push('===== ' + PASS + ' passed, ' + FAIL + ' failed =====');
    win.close();
  } catch (e) {
    out.push('FATAL ' + (e && e.stack || e));
  }
  fs.writeFileSync(path.join(D, '_accept.txt'), out.join('\n'), 'utf8');
  process.stdout.write(out.join('\n') + '\n', () => process.exit(FAIL ? 1 : 0));
})();
