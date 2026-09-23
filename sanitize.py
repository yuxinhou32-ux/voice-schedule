# -*- coding: utf-8 -*-
"""
发布前脱敏：把仓库里属于「自己的部署环境」的真实取值换成占位符。

为什么需要它（不是洁癖，是成本问题）：
  app.html 是完整云端版，原本带着真实的 CLOUD_ENDPOINT 和 publishable key。
  把它连同文档里的链接一起开源，等于公开一个「谁都能注册的后端入口」——访客的
  每一次写入都记在这个应用所有者（也就是你）的资源点账上。而 GitHub Pages 会把
  仓库根目录整个当站点发布，而根目录文件名又必须叫 index.html —— 所以站点首页现在是
  无云演示版，完整版源码改名 app.html（结构守卫会盯着这一点，见第 4 节）。

本脚本处理三类文件：
  app.html        endpoint / key 换占位符；ver.json 改相对路径；界面文案不再印出部署域名
  use.html        说明书页的「打开应用」指向演示版，不再指向个人部署
  tests/sync.js   测试用的 origin 从 app.html 里现读，不再把域名写死
  index.html      生成产物（站点首页），不在这里改 —— 但第 4 节会校验它没被换回完整版

⚠️ 脚本自身也不允许出现真实取值：所有规则一律用正则匹配「形状」，不写明文。
   第一版就是把真实域名当成搜索串写进了规则里，等于换个文件又泄了一遍——
   这也是为什么最后那步全仓库扫描要扫包括本脚本在内的每一个文件。

幂等：已脱敏的文件报 SKIP，可以放心重复执行；发现残留以退出码 1 结束。
流程：从主应用同步新版本之后 → `python sanitize.py` → `python build_demo.py` → `npm test` → 提交。
"""
import os
import re
import subprocess
import sys

BASE = os.path.dirname(os.path.abspath(__file__))

# 占位符：真实部署时替换成自己的云项目地址即可
PLACEHOLDER_ENDPOINT = 'https://your-app.example.com'
PLACEHOLDER_KEY = 'wbpk_YOUR_APP_ID_YOUR_PUBLISHABLE_KEY'

log = []


def patch(path, tag, old, new, regex=False, already=None):
    """精确替换。already 用于判断「是否已脱敏」——正则替换的 new 带分组引用，不能直接当子串用。"""
    full = os.path.join(BASE, path)
    with open(full, 'r', encoding='utf-8') as f:
        s = f.read()
    marker = new.strip() if already is None else already
    if marker and marker in s:
        log.append('SKIP  %-14s %s' % (path, tag))
        return False
    hits = re.findall(old, s) if regex else [1] * s.count(old)
    if not hits:
        log.append('MISS  %-14s %s' % (path, tag))
        return False
    s = re.sub(old, new, s) if regex else s.replace(old, new)
    with open(full, 'w', encoding='utf-8', newline='') as f:
        f.write(s)
    log.append('OK    %-14s %s' % (path, tag))
    return True


# ---------- 1. app.html（完整版源码，站点首页不含它）----------
patch('app.html', '云 endpoint 占位符',
      r"const CLOUD_ENDPOINT = 'https?://[^']+';[^\n]*",
      "const CLOUD_ENDPOINT = '%s';   /* 换成你自己的云项目地址 */" % PLACEHOLDER_ENDPOINT,
      regex=True, already="const CLOUD_ENDPOINT = '%s'" % PLACEHOLDER_ENDPOINT)

patch('app.html', '云 key 占位符',
      r"const CLOUD_KEY = 'wbpk_[A-Za-z0-9_]+';[^\n]*",
      "const CLOUD_KEY = '%s';" % PLACEHOLDER_KEY,
      regex=True, already="const CLOUD_KEY = '%s'" % PLACEHOLDER_KEY)

patch('app.html', 'ver.json 改相对路径',
      r"fetch\('https?://[^']*/ver\.json\?t='", "fetch('ver.json?t='",
      regex=True, already="fetch('ver.json?t='")

patch('app.html', '清掉界面里的部署域名',
      r"'云同步请在正式地址使用：[^']+'",
      "'云同步未启用：需要把页面部署到 CLOUD_ENDPOINT 指向的域名（部署方式见 README）'",
      regex=True, already='云同步未启用：需要把页面部署到 CLOUD_ENDPOINT')

# ---------- 2. use.html ----------
patch('use.html', '封面按钮指向演示版',
      r'<a class="cta" href="https?://[^"]+">[^<]*</a>',
      '<a class="cta" href="index.html">打开演示版</a>',
      regex=True, already='<a class="cta" href="index.html">')

patch('use.html', '副标题去掉部署地址',
      r'<p class="tip">[^<]*</p>',
      '<p class="tip">无需账号 · 没有服务器 · 数据只存在你自己的浏览器里</p>\n'
      '    <p class="tip" style="margin-top:2px">本页是应用说明书；带云端同步的完整版未公开部署</p>',
      regex=True, already='无需账号 · 没有服务器')

# ---------- 3. tests/sync.js ----------
patch('tests/sync.js', '测试 origin 现读 endpoint',
      "const RAW = fs.readFileSync(path.join(D, 'app.html'), 'utf8');\n",
      "const RAW = fs.readFileSync(path.join(D, 'app.html'), 'utf8');\n"
      "/* origin 不写死：从 app.html 现读 CLOUD_ENDPOINT，换成自己的地址后测试依然成立 */\n"
      "const EP = ((RAW.match(/const CLOUD_ENDPOINT = '([^']+)'/) || [])[1]) || '%s';\n"
      % PLACEHOLDER_ENDPOINT)

patch('tests/sync.js', '测试 url 用 endpoint',
      r"url: 'https?://[^']+',(\s*)// 让 CLOUD_ONLINE === true",
      "url: EP + '/',\\1// 与 app.html 的 CLOUD_ENDPOINT 一致，让 CLOUD_ONLINE === true",
      regex=True, already="url: EP + '/'")

for x in log:
    print(x)

# ---------- 4. 结构守卫：站点首页必须是「无云演示版」 ----------
# 起因：最早 index.html 就是完整云端版，而 GitHub Pages 把仓库根目录整个当站点发布，
# 等于把一个「谁都能注册的后端入口」挂在公网。现在把结构定死：
#     index.html = 生成的演示版（站点首页，零外链、零后端）
#     app.html   = 完整版源码（配置为占位符）
# 每次发版都断言一遍，防止将来从主项目同步时又把完整版盖回首页。
DEMO = os.path.join(BASE, 'index.html')
APP = os.path.join(BASE, 'app.html')
guard_bad = 0

if not os.path.isfile(APP):
    guard_bad += 1
    print('结构  app.html 不存在（完整版源码丢了？）')

if os.path.isfile(DEMO):
    demo_src = open(DEMO, 'r', encoding='utf-8', errors='replace').read()
    for pat, label in [
        (r'workbuddy-cloud-sdk', '云 SDK 外链'),
        (r'wbpk_', '云端 key'),
        (r'CLOUD_ONLINE\s*=\s*location\.origin', '真实的 origin 判定'),
        (r'fetch\(', 'fetch 调用'),
        (r'https?://', '绝对外链'),
    ]:
        if re.search(pat, demo_src):
            guard_bad += 1
            print('结构  index.html 不像无云演示版：含 %s' % label)
else:
    guard_bad += 1
    print('结构  index.html 不存在（站点首页丢了）')

print('结构守卫: %s' % ('通过 ✓（首页=无云演示版，完整版在 app.html）' if not guard_bad else '%d 处异常' % guard_bad))

# ---------- 5. 全仓库泄漏扫描（含本脚本）----------
try:
    files = subprocess.check_output(['git', 'ls-files'], cwd=BASE).decode('utf-8', 'replace').split()
except Exception as e:                                     # 不在 git 仓库里也能跑
    print('（git ls-files 不可用：%s）' % e)
    files = [f for f in os.listdir(BASE) if os.path.isfile(os.path.join(BASE, f))]

LEAK = [
    (r'[A-Za-z0-9-]+\.app\.workbuddy\.host', '真实部署域名'),
    (r'wbpk_(?![A-Za-z0-9_]*YOUR)[A-Za-z0-9_]{16,}', '疑似真实 publishable key'),
    (r'wbapp_[A-Za-z0-9]{6,}', '云应用 ID'),
    (r'[A-Za-z]:[\\/]{1,2}Users[\\/]', '本机绝对路径'),
]
TEXT_EXT = ('.html', '.js', '.json', '.py', '.md', '.txt', '.yml', '.yaml', '')

print('---')
bad = guard_bad
for name in sorted(files):
    if not name.endswith(TEXT_EXT):
        continue
    p = os.path.join(BASE, name)
    if not os.path.isfile(p):
        continue
    s = open(p, 'r', encoding='utf-8', errors='replace').read()
    for pat, label in LEAK:
        hits = re.findall(pat, s)
        if hits:
            bad += len(hits)
            print('泄漏  %-16s %s × %d  → %s' % (name, label, len(hits), hits[0][:60]))
print('泄漏扫描: %s' % ('干净 ✓' if not bad else '%d 处待处理' % bad))
sys.exit(1 if bad else 0)
