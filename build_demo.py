# -*- coding: utf-8 -*-
"""
把 app.html（带云同步的完整版）构建成「无云演示版」 index.html
—— 产物同时就是 GitHub Pages 的站点首页，所以文件名必须叫 index.html。

演示版与主应用的区别（全部为纯前端屏蔽，不依赖任何服务器）：
  1. 移除云 SDK 的 CDN 外链  → 页面不再下载任何第三方脚本
  2. 清空 CLOUD_ENDPOINT / CLOUD_KEY 并强制 CLOUD_ONLINE = false
     → 所有后端调用分支都进不去，零资源消耗
  3. 禁用版本检查（原本会 fetch 主应用域名的 ver.json）
  4. 「我的」页的云端卡片换成演示说明 + 重置示例数据按钮
  5. 首次访问预置一批虚构示例日程
  6. 顶部加一条演示版提示

每次主应用发版后重新跑一次本脚本即可。
注意：主项目的 index.html 同步进本仓库时要改名成 app.html —— 站点首页必须留给无云演示版。
"""
import re
import os

# 脚本所在目录即项目根目录（app.html 是源、index.html 是产物，同在此目录），
# 用相对路径，避免把本机绝对路径写进仓库。
BASE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(BASE, 'app.html')
DST = os.path.join(BASE, 'index.html')

with open(SRC, 'r', encoding='utf-8') as f:
    s = f.read()

log = []


def sub(tag, old, new, expect=1, regex=False):
    global s
    n = len(re.findall(old, s)) if regex else s.count(old)
    if n == 0:
        log.append('MISS  ' + tag)
        return
    if n != expect:
        log.append('WARN  %s (出现 %d 次, 期望 %d)' % (tag, n, expect))
    s = re.sub(old, new, s, count=0 if regex else 1) if regex else s.replace(old, new)
    log.append('OK    ' + tag)


# ---------- 1. 移除云 SDK 外链 ----------
sub('移除云 SDK 外链',
    r'[ \t]*<script[^>]*workbuddy-cloud-sdk[^>]*>\s*</script>[ \t]*\r?\n',
    '', regex=True)

# ---------- 2. 标题 ----------
sub('标题改为演示版',
    r'<title>.*?</title>',
    '<title>口述日程 · 演示版</title>', regex=True)

# ---------- 3. 顶部演示条 + 样式 ----------
sub('演示条 CSS',
    r'  #app\{display:flex;flex-direction:column;height:100dvh;\}',
    '  #app{display:flex;flex-direction:column;height:100dvh;}\n'
    '  #demoBar{flex:none;margin:0 14px 8px;padding:6px 10px;border-radius:8px;'
    'background:#FFF4E5;color:#8A5A00;font-size:11.5px;text-align:center;line-height:1.4;}',
    regex=True)

sub('插入演示条',
    r'  <div id="mvHint">',
    '  <div id="demoBar">演示版 · 数据只保存在你自己的浏览器里</div>\n  <div id="mvHint">',
    regex=True)

# ---------- 4. 云常量与初始化 ----------
# 用正则匹配「任意 endpoint + 任意 publishable key」，而不是把真实的 key 明文写进脚本，
# 这样 build_demo.py 可以安全地开源。[^\n]* 允许行尾带注释（占位符那行就是带注释的）。
sub('清空云常量',
    r"const CLOUD_ENDPOINT = 'https?://[^']+';[^\n]*\r?\n"
    r"const CLOUD_KEY = 'wbpk_[A-Za-z0-9_]+';[^\n]*\r?\n"
    r"const CLOUD_ONLINE = location\.origin === CLOUD_ENDPOINT;[^\n]*",
    "/* 演示版：不带云端同步 —— endpoint/key 清空、CLOUD_ONLINE 强制 false，\n"
    "   任何代码路径都不会发起后端请求，不消耗任何云端资源 */\n"
    "const CLOUD_ENDPOINT = '';\n"
    "const CLOUD_KEY = '';\n"
    "const CLOUD_ONLINE = false;", regex=True)

sub('云实例强制置空',
    "try{\n"
    "  if (window.WorkBuddyCloud) cloud = WorkBuddyCloud.createWorkBuddyCloud({ endpoint: CLOUD_ENDPOINT, publishableKey: CLOUD_KEY });\n"
    "}catch(e){ cloud = null; }",
    "cloud = null;   /* 演示版：永不创建云实例 */")

# ---------- 5. 整段替换版本检查（原实现里带着 ver.json 的 fetch） ----------
sub('整段移除版本检查',
    r"function checkNewVer\(\)\{[^\x00]*?\n\}",
    "function checkNewVer(){\n"
    "  return;   /* 演示版：不做版本检查，代码里不留任何外部地址 */\n"
    "}", regex=True)

# ---------- 6. 云端卡片 ----------
sub('云端卡片短路',
    "function renderCloudCard(){\n"
    "  const login = $('#cloudLogin'), info = $('#cloudInfo'), off = $('#cloudOff');\n"
    "  if (!login) return;",
    "function renderCloudCard(){\n"
    "  return;   /* 演示版：三个子块保持隐藏，展示下方演示说明 */\n"
    "  const login = $('#cloudLogin'), info = $('#cloudInfo'), off = $('#cloudOff');\n"
    "  if (!login) return;")

sub('云端卡片改演示说明',
    '    <div class="stcard" id="cloudCard">\n'
    '      <h3>云端同步</h3>\n'
    '      <div class="sub">登录后，日程与事项自动备份云端 · 换设备登录即可恢复</div>',
    '    <div class="stcard" id="cloudCard">\n'
    '      <h3>演示版 · 无云端同步</h3>\n'
    '      <div class="sub">这是「口述日程」的公开演示版：<b>没有账号，也不向任何服务器发送数据</b>。</div>\n'
    '      <div class="sub" style="margin:8px 0 0">你在这里的每一次操作都只保存在你自己的浏览器里，关掉页面不会影响任何人。</div>\n'
    '      <div class="btnrow" style="margin-top:12px"><button class="btn ghost" id="demoResetBtn">重置示例数据</button></div>')

sub('清掉云端卡片里的部署域名',
    r"'云同步未启用：[^']+'",
    "'演示版不带云端同步'", regex=True)

sub('绑定重置按钮',
    "$('#syncBtn').onclick = () => cloudSync(true);",
    "$('#syncBtn').onclick = () => cloudSync(true);\n$('#demoResetBtn').onclick = demoReset;")

# ---------- 7. 示例数据 + 重置 ----------
SEED = r'''/* ================= 演示版：示例数据 =================
   仅在首次访问时注入，全部为虚构示例，不含任何真实用户数据。
   点「重置示例数据」或清掉 localStorage 后会重新生成。 */
function demoSeed(){
  const n2 = n => { const d = new Date(); d.setDate(d.getDate()+n); return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); };
  const T = Date.now();
  const mk = o => Object.assign({ id:uid(), location:'', remind:0, tag:'personal', imp:false, node:false, recur:{type:'none',rdays:[],rmd:null}, u:T }, o);
  events.length = 0; inbox.length = 0; journal.length = 0;
  events.push(mk({ title:'产品评审会',   start:n2(0)+'T09:30', end:n2(0)+'T10:30', tag:'work', location:'会议室 A' }));
  events.push(mk({ title:'和老张吃午饭', start:n2(0)+'T12:30', end:n2(0)+'T13:30', tag:'personal' }));
  events.push(mk({ title:'牙医复诊',     start:n2(1)+'T15:00', end:n2(1)+'T15:45', tag:'personal', imp:true, location:'口腔医院' }));
  events.push(mk({ title:'起床',         start:n2(1)+'T08:00', end:n2(1)+'T08:05', tag:'personal', node:true }));
  events.push(mk({ title:'健身',         start:n2(0)+'T19:00', end:n2(0)+'T20:00', tag:'fun', recur:{type:'daily',rdays:[],rmd:null} }));
  events.push(mk({ title:'晨跑',         start:n2(0)+'T07:30', end:n2(0)+'T08:05', tag:'fun', recur:{type:'weekly',rdays:[1,3,5],rmd:null} }));
  const ib = (text, kind, o) => Object.assign({ id:uid(), kind:kind, text:text, raw:text, createdAt:T,
    date:fmtDate(new Date()), due:null, time:null, repeat:'none', rdays:[], rmd:null, tag:'personal', doneOn:null }, o || {});
  inbox.push(ib('买牛奶','todo'));
  inbox.push(ib('换洗床单','todo'));
  inbox.push(ib('交房租','countdown', { due:n2(7), date:n2(7) }));
  journal.push({ id:uid(), date:fmtDate(new Date()), kind:'daily', createdAt:T, updatedAt:T, del:false,
    text:'说一句「明天下午三点半跟老张碰一下，大概一小时」，日程就直接排好了。也可以长按麦克风说一段话写日志。' });
  persist(); persistInbox(); persistJournal();
  jrEnsureTags();
}
(function(){
  let first = false;
  try{ first = !localStorage.getItem('voical-demo-seed'); }catch(e){ first = true; }
  if (!first) return;
  demoSeed();
  try{ localStorage.setItem('voical-demo-seed','1'); }catch(e){}
})();
function demoReset(){
  try{
    ['voical-events','voical-inbox','voical-journal','voical-pref',
     'voical-demo-seed','voical-demo-hint'].forEach(k => localStorage.removeItem(k));
  }catch(e){}
  location.reload();
}

/* ================= 循环日程引擎 ================= */'''

sub('插入示例数据模块',
    '/* ================= 循环日程引擎 ================= */',
    SEED)

# ---------- 8. 首次访问提示 ----------
sub('首次访问提示',
    "if (location.hash==='#mine') switchTab('mine');\n</script>",
    "if (location.hash==='#mine') switchTab('mine');\n"
    "/* 演示版：首次访问提示一次数据存在本地 */\n"
    "try{\n"
    "  if (!localStorage.getItem('voical-demo-hint')){\n"
    "    localStorage.setItem('voical-demo-hint','1');\n"
    "    setTimeout(()=>showToast('演示版：数据只保存在你自己的浏览器里', null), 900);\n"
    "  }\n"
    "}catch(e){}\n</script>")

# ---------- 9. 版本号标注 ----------
sub('版本号标注 demo',
    "const APP_VER = '2026-09-23 t';",
    "const APP_VER = '2026-09-23 t-demo';")

with open(DST, 'w', encoding='utf-8', newline='\n') as f:   # 与 .gitattributes 的 eol=lf 保持一致
    f.write(s)

for x in log:
    print(x)

# 校验：演示版里不应再出现任何外部地址、云密钥或网络调用
bad = []
for pat, label in [
    (r'workbuddy-cloud-sdk', '云 SDK 外链'),
    (r'https?://', '绝对外链'),
    (r'wbpk_', '云端 publishable key'),
    (r'fetch\(', 'fetch 调用'),
]:
    hits = re.findall(pat, s)
    if hits:
        bad.append('%s × %d' % (label, len(hits)))

print('---')
print('输出: %s (%d 字节)' % (DST, os.path.getsize(DST)))
print('残留外部依赖: %s' % ('无 ✓' if not bad else ' / '.join(bad)))
