/* 云端同步引擎专项回归：针对「换设备后条数不对 / 数据被墓碑杀掉」的三处根因 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const D = path.join(__dirname, '..');
const RAW = fs.readFileSync(path.join(D, 'index.html'), 'utf8');
/* origin 不写死：从 index.html 现读 CLOUD_ENDPOINT，换成自己的地址后测试依然成立 */
const EP = ((RAW.match(/const CLOUD_ENDPOINT = '([^']+)'/) || [])[1]) || 'https://your-app.example.com';
const fc = fs.readFileSync(path.join(D, 'fullcalendar.min.js'), 'utf8');
const parser = fs.existsSync(path.join(D, 'parser.js')) ? fs.readFileSync(path.join(D, 'parser.js'), 'utf8') : '';

const iso = d => d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
const ds = iso(new Date());

/* routine.html 一键写入的 14 条：带 u，但不写 PREF.dirty —— 这正是历史 bug 的触发条件 */
const ROUTINE = [
  ['rt01','起床 · 早餐'],['rt02','午餐'],['rt03','晚餐'],['rt04','睡觉'],
  ['rt05','冥想'],['rt06','午休'],['rt07','投简历'],['rt08','投简历'],
  ['rt09','投简历'],['rt10','投简历'],['rt11','训练 · 深蹲日'],['rt12','训练 · 卧推日'],
  ['rt13','训练 · 硬拉日'],['rt14','训练 · 上肢日']
].map(([id, title], i) => ({
  id, title, start: ds + 'T10:00', end: ds + 'T11:30', tag: 'personal',
  recur: { type: 'daily' }, exdates: [], overrides: {}, u: Date.now() - 60000 + i
}));

const EXPOSE = `<script>window.__x={ events:()=>events, inbox:()=>inbox, journal:()=>journal,
  PREF:()=>PREF, findItem, rowOf, applyRemote };</script>`;

function build(seed, cloudSeed){
  let html = RAW.replace(/<script[^>]*\ssrc="fullcalendar\.min\.js[^"]*"[^>]*><\/script>/, () => '<script>' + fc + '</script>');
  html = html.replace(/<script[^>]*\ssrc="parser\.js[^"]*"[^>]*><\/script>/, () => '<script>' + parser + '</script>');
  html = html.replace('</body>', EXPOSE + '</body>');
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push('jsdomError: ' + (e.detail ? (e.detail.stack || e.detail.message) : e.message)));
  vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: EP + '/',   // 与 index.html 的 CLOUD_ENDPOINT 一致，让 CLOUD_ONLINE === true
    pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} };
      win.matchMedia = q => ({ matches:false, media:q, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} });
      win.requestAnimationFrame = cb => setTimeout(() => cb(Date.now()), 0);
      win.cancelAnimationFrame = id => clearTimeout(id);
      win.URL.createObjectURL = () => 'blob:mock';
      win.SpeechRecognition = undefined; win.webkitSpeechRecognition = undefined;

      win.localStorage.setItem('voical-events', JSON.stringify((seed && seed.events) || []));
      win.localStorage.setItem('voical-inbox',  JSON.stringify((seed && seed.inbox)  || []));
      win.localStorage.setItem('voical-journal',JSON.stringify([]));
      win.localStorage.setItem('voical-pref',   JSON.stringify(Object.assign({ ws:'mon', installedAt: Date.now() }, (seed && seed.pref) || {})));

      /* ---- 假的云端 ---- */
      const db = { rows: {}, calls: [], failAt: 0 };
      Object.keys(cloudSeed || {}).forEach(id => { db.rows[id] = Object.assign({ owner_id:'u1', kind:'event' }, cloudSeed[id]); });
      win.__db = db;
      const upsert = async (rows) => {
        db.calls.push(rows.length);
        if (db.failAt && db.calls.length === db.failAt) return { data:null, error:{ message:'mock network error' } };
        rows.forEach(r => { db.rows[r.id] = Object.assign({}, r, { owner_id:'u1' }); });
        return { data: rows, error: null };
      };
      win.WorkBuddyCloud = { createWorkBuddyCloud: () => ({
        auth: {
          getSession: async () => ({ data: { user: { id:'u1', email:'me@test.com' } } }),
          onAuthStateChange: () => {}, signOut: async () => {}
        },
        database: { from: () => ({
          upsert,
          select: () => ({ limit: async () => ({ data: Object.keys(db.rows).map(k => Object.assign({}, db.rows[k])), error: null }) })
        })}
      })};
    }
  });
  return { dom, errors };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = [];
let PASS = 0, FAIL = 0;
const ck = (label, cond, detail) => { cond ? PASS++ : FAIL++; out.push((cond?'PASS ':'FAIL ')+label+(detail!==undefined?'  → '+detail:'')); };
const info = s => out.push('      · ' + s);
const alive = db => Object.values(db.rows).filter(r => !r.deleted).length;

(async () => {
  try{
    /* ============ 场景 1：一键写入的 14 条（有 u、无 dirty）必须能上云 ============ */
    out.push('########## 场景 1：routine 一键写入的数据能否上云 ##########');
    {
      const r = build({ events: ROUTINE.slice(), pref: {} });
      const win = r.dom.window;
      await sleep(3200);                       // 等启动 → 恢复会话 → 自动全量上传 + 同步
      const db = win.__db;
      ck('1.1 云端收到 14 条存活记录', alive(db) === 14, 'alive=' + alive(db));
      ck('1.2 rt01 内容完整', !!(db.rows['rt01'] && db.rows['rt01'].payload && db.rows['rt01'].payload.title === '起床 · 早餐'),
         db.rows['rt01'] ? String(db.rows['rt01'].payload.title) : '(云端没有 rt01)');
      ck('1.3 rt07 也在（历史上它从未上云）', !!db.rows['rt07'], db.rows['rt07'] ? '有' : '缺');
      ck('1.4 本地仍是 14 条', win.__x.events().length === 14, 'events=' + win.__x.events().length);
      /* 对照：旧算法只给「没有 u」的条目补 dirty，routine 写入的都有 u → 条数 0 */
      const oldWouldPush = ROUTINE.filter(e => !e.u).length;
      info('对照：旧版「只补 !e.u」算法会推送 ' + oldWouldPush + ' 条（这就是当初云端只剩 3 条的原因）');
      ck('1.5 旧算法确实会漏（说明根因成立）', oldWouldPush === 0, 'oldWouldPush=' + oldWouldPush);
      out.push('errors: ' + r.errors.length + (r.errors.length ? ' | ' + r.errors[0] : ''));
    }

    /* ============ 场景 2：云端旧墓碑不许杀掉本地更新的数据，且要被复活 ============ */
    out.push('');
    out.push('########## 场景 2：旧墓碑 vs 本地新数据 ##########');
    {
      const u = Date.now();
      const seed = { events: [{ id:'rt05', title:'冥想（本机刚改过）', start: ds+'T13:15', end: ds+'T13:30', tag:'personal', u }] };
      const cloudSeed = { rt05: { id:'rt05', kind:'event', payload:{ id:'rt05' }, updated_at: u - 3600e3, deleted:true } };
      const r = build(seed, cloudSeed);
      const win = r.dom.window;
      await sleep(3200);
      const db = win.__db;
      ck('2.1 本地条目没有被旧墓碑删掉', win.__x.events().some(e => e.id === 'rt05'), 'events=' + win.__x.events().length);
      ck('2.2 云端墓碑被撤销（复活为存活）', db.rows['rt05'] && db.rows['rt05'].deleted === false, 'deleted=' + (db.rows['rt05'] && db.rows['rt05'].deleted));
      ck('2.3 复活后内容完整', !!(db.rows['rt05'] && db.rows['rt05'].payload && db.rows['rt05'].payload.title === '冥想（本机刚改过）'),
         db.rows['rt05'] ? String(db.rows['rt05'].payload.title) : '(无)');
      out.push('errors: ' + r.errors.length + (r.errors.length ? ' | ' + r.errors[0] : ''));
    }

    /* ============ 场景 3：真的在别处删了，删除必须仍然生效 ============ */
    out.push('');
    out.push('########## 场景 3：别处的新删除要能同步过来 ##########');
    {
      const u = Date.now();
      const seed = { events: [{ id:'rt06', title:'午休', start: ds+'T13:30', end: ds+'T14:00', tag:'personal', u: u - 3600e3 }] };
      const cloudSeed = { rt06: { id:'rt06', kind:'event', payload:{ id:'rt06' }, updated_at: u, deleted:true } };
      const r = build(seed, cloudSeed);
      const win = r.dom.window;
      await sleep(3200);
      ck('3.1 本地条目被删除（墓碑比本地新）', !win.__x.events().some(e => e.id === 'rt06'), 'events=' + win.__x.events().length);
      out.push('errors: ' + r.errors.length + (r.errors.length ? ' | ' + r.errors[0] : ''));
    }

    /* ============ 场景 4：大批量分批推送 + 失败批次保留重试 ============ */
    out.push('');
    out.push('########## 场景 4：分批推送与失败重试 ##########');
    {
      const r = build({ events: [], pref: { lastFullPush: Date.now() } });
      const win = r.dom.window;
      await sleep(2600);
      const db = win.__db;
      db.rows = {}; db.calls = [];
      win.eval(`for(let i=0;i<120;i++){ const e={id:'bulk'+i,title:'B'+i,start:'${ds}T10:00',end:'${ds}T10:30',tag:'personal',u:Date.now()+i}; events.push(e); (PREF.dirty=PREF.dirty||{})[e.id]=e.u; } persist(); persistPref();`);
      db.failAt = 2;                            // 第 2 次 upsert 调用失败
      let threw = false;
      try{ await win.pushDirty(); }catch(e){ threw = true; }
      ck('4.1 失败时抛错（不静默吞掉）', threw);
      ck('4.2 分批：首次调用推送 50 条', db.calls[0] === 50, 'calls=' + JSON.stringify(db.calls));
      const left1 = Object.keys(win.__x.PREF().dirty || {}).length;
      ck('4.3 失败后剩余 70 条仍在队列（不再整批丢）', left1 === 70, 'dirty=' + left1);
      db.failAt = 0;
      await win.pushDirty();
      const left2 = Object.keys(win.__x.PREF().dirty || {}).length;
      ck('4.4 重试后队列清空', left2 === 0, 'dirty=' + left2);
      ck('4.5 云端最终 120 条', alive(db) === 120, 'alive=' + alive(db));
      out.push('errors: ' + r.errors.length + (r.errors.length ? ' | ' + r.errors[0] : ''));
    }

  }catch(e){
    out.push('FATAL ' + (e && e.stack || e));
  }
  out.push('');
  out.push('===== ' + PASS + ' passed, ' + FAIL + ' failed =====');
  fs.writeFileSync(path.join(D, '_sync.txt'), out.join('\n'), 'utf8');
  process.stdout.write(out.join('\n') + '\n', () => process.exit(FAIL ? 1 : 0));
})();
