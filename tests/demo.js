/* 演示版专项测试（index.html = 站点首页那份）：无云、有示例数据、零网络请求 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const D = path.join(__dirname, '..');
const RAW = fs.readFileSync(path.join(D, 'index.html'), 'utf8');
const fc = fs.readFileSync(path.join(D, 'fullcalendar.min.js'), 'utf8');
const parser = fs.readFileSync(path.join(D, 'parser.js'), 'utf8');

const out = [];
let PASS = 0, FAIL = 0;
function ck(label, cond, detail){
  cond ? PASS++ : FAIL++;
  out.push((cond ? 'PASS ' : 'FAIL ') + label + (detail !== undefined ? '  → ' + detail : ''));
}
function info(s){ out.push('      · ' + s); }

/* 把外链脚本内联进来，并暴露内部状态 */
function makeHtml(){
  const EXPOSE = `<script>window.__x = {
    events: () => events, inbox: () => inbox, journal: () => journal,
    cloud: () => cloud, online: () => CLOUD_ONLINE, prefs: () => PREF,
    demoTags: () => PREF.jrTags
  };</script>`;
  let h = RAW.replace(/<script[^>]*\ssrc="fullcalendar\.min\.js[^"]*"[^>]*><\/script>/, () => '<script>' + fc + '</script>');
  h = h.replace(/<script[^>]*\ssrc="parser\.js[^"]*"[^>]*><\/script>/, () => '<script>' + parser + '</script>');
  return h.replace('</body>', EXPOSE + '</body>');
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function boot(preload){
  const errors = [];
  const net = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push('jsdomError: ' + (e.detail ? (e.detail.stack || e.detail.message) : e.message)));
  vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));
  vc.on('warn', (...a) => { if (a[1] && a[1] instanceof Error) errors.push('warn: ' + (a[1].stack || a[1].message)); });

  const dom = new JSDOM(makeHtml(), {
    runScripts: 'dangerously', url: 'https://demo.test/', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} };
      win.matchMedia = win.matchMedia || (q => ({ matches:false, media:q, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} }));
      win.URL.createObjectURL = () => 'blob:mock';
      win.URL.revokeObjectURL = () => {};
      win.SpeechRecognition = undefined; win.webkitSpeechRecognition = undefined;
      win.requestAnimationFrame = cb => setTimeout(() => cb(Date.now()), 0);
      win.cancelAnimationFrame = id => clearTimeout(id);
      /* 任何网络请求都记下来 —— 演示版的断言就是「一个都没有」 */
      win.fetch = (...a) => { net.push(String(a[0])); return Promise.reject(new Error('demo should not fetch')); };
      win.XMLHttpRequest = class { open(m, u){ net.push(String(u)); } send(){} setRequestHeader(){} };
      win.navigator.sendBeacon = (...a) => { net.push(String(a[0])); return true; };
      win.WorkBuddyCloud = undefined;
      if (preload) Object.keys(preload).forEach(k => win.localStorage.setItem(k, preload[k]));
    }
  });
  return { dom, errors, net };
}

(async () => {
  try {
    /* ============ 第一次访问 ============ */
    out.push('## 场景 1：首次访问（空白浏览器）');
    const A = boot(null);
    await sleep(900);
    const win = A.dom.window, doc = win.document;
    const $ = id => doc.getElementById(id);
    const X = () => win.__x;

    ck('1.1 加载无致命错误', A.errors.length === 0, A.errors.slice(0, 3).join(' | '));
    ck('1.2 云实例为 null', X().cloud() === null, String(X().cloud()));
    ck('1.3 CLOUD_ONLINE 为 false', X().online() === false, String(X().online()));
    ck('1.4 未发起任何网络请求', A.net.length === 0, A.net.join(', '));
    ck('1.5 登录区保持隐藏', $('cloudLogin').style.display === 'none' || $('cloudLogin').style.display === '');
    ck('1.6 演示说明已替换云端卡片标题', $('cloudCard').querySelector('h3').textContent.indexOf('演示版') >= 0, $('cloudCard').querySelector('h3').textContent);
    ck('1.7 顶部演示条存在', !!$('demoBar'), $('demoBar') && $('demoBar').textContent);
    ck('1.8 版本检查未打扰（无版本提示条）', $('verTip').style.display === 'none' || $('verTip').style.display === '');

    out.push('');
    out.push('## 场景 2：示例数据');
    const evs = X().events(), ibs = X().inbox(), jrs = X().journal();
    ck('2.1 注入 6 条示例日程', evs.length === 6, evs.length);
    ck('2.2 注入 3 条示例事项', ibs.length === 3, ibs.length);
    ck('2.3 注入 1 篇示例日志', jrs.length === 1, jrs.length);
    ck('2.4 含 1 条时间节点', evs.filter(e => e.node).length === 1, evs.filter(e => e.node).length);
    ck('2.5 含 1 条重要事项', evs.filter(e => e.imp).length === 1, evs.filter(e => e.imp).length);
    ck('2.6 含每天循环 + 每周循环', evs.filter(e => e.recur && e.recur.type === 'daily').length === 1 && evs.filter(e => e.recur && e.recur.type === 'weekly').length === 1);
    ck('2.7 含 1 条倒计时', ibs.filter(i => i.kind === 'countdown').length === 1);
    ck('2.8 日志标签已补齐 daily', Array.isArray(X().demoTags()) && X().demoTags().some(t => t.key === 'daily'), JSON.stringify(X().demoTags()));
    info('示例日程：' + evs.map(e => e.title).join(' / '));

    out.push('');
    out.push('## 场景 3：日历真的画出来了');
    const dayEvents = doc.querySelectorAll('.fc-timegrid-event').length;
    ck('3.1 日视图渲染出事件块', dayEvents >= 3, dayEvents + ' 个');
    ck('3.2 FullCalendar 表格已生成', doc.querySelectorAll('.fc-timegrid').length > 0);
    const title = $('title') ? $('title').textContent : '';
    ck('3.3 标题栏有内容', title.length > 0, title);

    out.push('');
    out.push('## 场景 4：核心功能可用（口述建日程）');
    $('recText').value = '明天下午三点半跟老张碰一下，大概一小时';
    $('recOk').click();
    await sleep(300);
    ck('4.1 确认面板弹出', $('confirmSheet').classList.contains('show'));
    ck('4.2 时长默认 60 分钟', $('fDur').value === '60', $('fDur').value);
    ck('4.3 三个单位按钮都在', doc.querySelectorAll('#fDurUnitSeg button').length === 3);
    /* 切成「小时」并自填 2.5 */
    $('fDur').value = '2.5';
    doc.querySelector('#fDurUnitSeg button[data-du="hr"]').click();
    await sleep(50);
    ck('4.4 自填 2.5 小时被接受', doc.querySelector('#fDurUnitSeg button.on').dataset.du === 'hr', 'unit=' + doc.querySelector('#fDurUnitSeg button.on').dataset.du);
    $('cfOk').click();
    await sleep(300);
    ck('4.5 新日程已落库', X().events().length === 7, X().events().length);
    ck('4.6 仍无任何网络请求', A.net.length === 0, A.net.join(', '));

    out.push('');
    out.push('## 场景 5：数据持久化到本机 localStorage');
    const saved = JSON.parse(win.localStorage.getItem('voical-events') || '[]');
    ck('5.1 localStorage 里有 7 条', saved.length === 7, saved.length);
    ck('5.2 种子标记已写入', win.localStorage.getItem('voical-demo-seed') === '1');
    const keep = {};
    for (let i = 0; i < win.localStorage.length; i++){ const k = win.localStorage.key(i); keep[k] = win.localStorage.getItem(k); }
    info('localStorage keys: ' + Object.keys(keep).join(', '));

    /* ============ 第二次访问（带上上一次的数据） ============ */
    out.push('');
    out.push('## 场景 6：再次打开（示例数据不应被重新注入）');
    const B = boot(keep);
    await sleep(900);
    const win2 = B.dom.window;
    const evs2 = win2.__x.events();
    ck('6.1 条数仍是 7，没有被种子覆盖', evs2.length === 7, evs2.length);
    ck('6.2 用户新建的那条还在', !!evs2.find(e => e.title.indexOf('老张') >= 0), evs2.map(e => e.title).join(' / '));
    ck('6.3 再次打开仍然零网络请求', B.net.length === 0, B.net.join(', '));
    ck('6.4 再次打开无致命错误', B.errors.length === 0, B.errors.slice(0, 3).join(' | '));

    out.push('');
    out.push('## 场景 7：重置示例数据按钮');
    const C = boot(null);
    await sleep(900);
    const win3 = C.dom.window, doc3 = win3.document;
    win3.__x.events().length = 0;
    let resetThrew = null;
    try { doc3.getElementById('demoResetBtn').click(); } catch (e) { resetThrew = e.message; }
    await sleep(200);
    ck('7.1 点击重置不抛错', resetThrew === null, resetThrew);
    const left = ['voical-events','voical-inbox','voical-journal','voical-pref','voical-demo-seed','voical-demo-hint']
      .filter(k => win3.localStorage.getItem(k) !== null);
    ck('7.2 重置已清空本机数据键', left.length === 0, left.join(', '));

    out.push('');
    out.push('errors total: ' + (A.errors.length + B.errors.length + C.errors.length));
    (A.errors.concat(B.errors, C.errors)).slice(0, 6).forEach(e => out.push('  ! ' + e.slice(0, 300)));
  } catch (e) {
    out.push('FATAL ' + (e && e.stack || e));
  }
  out.push('');
  out.push('===== ' + PASS + ' passed, ' + FAIL + ' failed =====');
  fs.writeFileSync(path.join(D, '_demo.txt'), out.join('\n'), 'utf8');
  process.stdout.write(out.join('\n') + '\n', () => process.exit(FAIL ? 1 : 0));
})();
