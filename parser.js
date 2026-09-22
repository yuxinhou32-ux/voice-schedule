/* 中文口语 → 结构化 解析器（无依赖，可单测）
   输出：kind = event(带时间日程) | todo(待办事项) | countdown(有明确截止日的倒计时事)
         due  = 'YYYY-MM-DD' 截止日（仅 countdown 有）
         tag  = work | study | personal | fun （大标签预判） */
const CN = {'零':0,'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9};
const CN_CHARS = '零一二两三四五六七八九十';

function cn2num(s){
  if (s==null || s==='') return null;
  if (/^\d+$/.test(s)) return parseInt(s,10);
  if (s==='十') return 10;
  if (s.includes('十')){
    const parts = s.split('十');
    const tens = parts[0] ? (CN[parts[0]] ?? 1) : 1;
    const ones = parts[1] ? (CN[parts[1]] ?? 0) : 0;
    return tens*10 + ones;
  }
  return CN[s] ?? null;
}

function fmtYMD(d){
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}

/* ---------- 自动分类 ---------- */
// 灵感口吻：念头、假设、感觉、点子（仅用于判定，应用层不再单独成类）
const IDEA_RE = /想到|想法|点子|灵感|要是|假如|或许|也许|可以试试|值得试|突然觉得|突然发现|我发现|我感觉|我认为|我觉得|悟了|说不定|搞不好/;
// 待办口吻：明确的任务动词
const TODO_RE = /记得|别忘了|别忘|需要|必须|要(去|买|给|回|打|发|交|取|办|做|还|订|约|处理|梳理|整理|检查|确认|跟进|准备|写|看)|得(去|做|办|买|交|注意|回)|该(去|做|办|买|换|修)|帮我|帮忙|预约|缴费|续费|报销|回复|打电话|取件|寄出?|开会|有个会|吃药|复诊/;
// 截止口吻：有明确 deadline 的事 → 倒计时
const DEADLINE_RE = /截止|deadline|最迟|之前|以前|以内|之内|前完?成|前交|前搞定|前弄好|前把|前要|前得|倒计时|还剩|交表|交作业|交报告|到期|过期|ddl|DDL|前/;

/* hasTime: 有具体钟点或全天 → 日程；否则按口吻判定 */
function classifyKind(hasTime, raw){
  if (hasTime) return 'event';
  const idea = IDEA_RE.test(raw), todo = TODO_RE.test(raw), dl = DEADLINE_RE.test(raw);
  if (idea && !todo && !dl) return 'idea';   // 仍保留判定能力，但应用层不再单独成类
  return 'todo';
}
/* 是否倒计时：无钟点 + 截止口吻 + 说出了明确日期 */
function isCountdown(hasDateHint, raw){
  return !!hasDateHint && DEADLINE_RE.test(raw);
}

/* ---------- 标签预判（按优先级，命中即返回） ---------- */
const TAG_RULES = [
  ['work', /会议|评审|汇报|例会|周会|月会|上线|发布|需求|客户|老板|领导|同事|项目|代码|联调|测试|面试|招聘|培训|出差|报销|合同|方案|季度|对齐|排期|拜访|供应商|甲方|加班|工作|功能|产品|迭代|版本|PPT|报告|OKR|KPI|碰一下|碰头|同步|1:1|一对一|standup|review|app|按钮|界面|交互|UI|UX|体验/i],
  ['study', /学习|读书|看书|复习|刷题|练习|背单词|考试|考证|网课|课程|训练营|自习|上课|笔记|作业|论文|研究|教程|英语|日语|编程|读一?下|读书会|讲座|沙龙/],
  ['fun', /玩|游戏|电影|看剧|追剧|追番|动漫|球赛|篮球|羽毛球|网球|爬山|旅行|旅游|逛街|聚餐|下午茶|咖啡|奶茶|喝酒|小酌|K歌|唱歌|按摩|泡澡|打游戏|剧本杀|桌游|露营|骑行|钓鱼|拍照|摄影|散步|遛弯|午睡|睡懒觉|放松|解压|温泉|看展|演唱会|演出|livehouse|按摩/i],
  ['personal', /家人|爸妈|父母|妈妈|爸爸|孩子|老婆|老公|体检|医院|看病|复诊|牙|理发|剪头发|银行|社保|公积金|缴费|水电|房租|快递|物业|签证|护照|生日|搬家|打扫|洗衣|健身|跑步|瑜伽|冥想|买菜|做饭|买牛奶|日用品|给家里打电话|吃药|药/],
];
function guessTag(text){
  if (!text) return 'personal';
  for (const [t, re] of TAG_RULES){ if (re.test(text)) return t; }
  return 'personal';
}

/* ---------- 主解析 ---------- */
function parseUtterance(raw){
  const res = { title:'', date:null, due:null, h:null, mi:0, durMin:60, allDay:false, location:'', remind:0, kind:'todo', tag:'personal', recur:null };
  let t = (raw||'').replace(/[。！？!?；;]/g,'，');
  const now = new Date();
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let period = null;
  let dateHint = false;   // 是否说出了明确日期（判断倒计时的前提）

  // 明早 = 明天 + 早上
  if (t.includes('明早')){ base.setDate(base.getDate()+1); period='早上'; t = t.replace('明早','，'); }

  // 全天
  if (/(全天|一整天)/.test(t)){ res.allDay = true; t = t.replace(/全天|一整天/g,'，'); }

  // 相对日期
  const dayMap = [['大后天',3],['后天',2],['明天',1],['明日',1],['今天',0],['今晚',0]];
  for (const [k,d] of dayMap){
    if (t.includes(k)){ base.setDate(base.getDate()+d); if(k==='今晚') period='晚上'; t = t.replace(k,'，'); dateHint = true; break; }
  }
  // 明确月日：10月1日 / 十月一号 / 10/1 / 10-1
  const mdy = t.match(/(\d{1,2}|[一二三四五六七八九十]{1,3})\s*月\s*(\d{1,2}|[一二三四五六七八九十]{1,3})\s*[日号]/)
    || t.match(/(?:^|[^\d])(\d{1,2})\s*[\/\-]\s*(\d{1,2})(?![\d])/);
  if (mdy){
    const mo = cn2num(mdy[1]), dy = cn2num(mdy[2]);
    if (mo>=1 && mo<=12 && dy>=1 && dy<=31){
      const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const cand = new Date(now.getFullYear(), mo-1, dy);
      base.setFullYear(cand < today0 ? now.getFullYear()+1 : now.getFullYear());
      base.setMonth(mo-1); base.setDate(dy);
      t = t.replace(mdy[0],'，'); dateHint = true;
    }
  }
  // 重复：每周一三五 / 每周三 / 每周一到周五 / 每天 / 每个工作日 / 每月3号
  // 必须排在「周X」日期解析之前，否则「每周一」会被当成「这周一」
  const WDM = {'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'日':7,'天':7,'末':6};
  if (/每\s*(?:天|日)/.test(t)){
    res.recur = { type:'daily', rdays:[], rmd:null };
    t = t.replace(/每\s*(?:天|日)/,'，');
  } else if (/每\s*(?:个)?\s*工作日/.test(t)){
    res.recur = { type:'weekly', rdays:[1,2,3,4,5], rmd:null };
    t = t.replace(/每\s*(?:个)?\s*工作日/,'，');
  } else {
    const mmo = t.match(/每\s*(?:个)?\s*月\s*(\d{1,2}|[一二三四五六七八九十]{1,3})\s*[日号]/);
    if (mmo){
      const dd = cn2num(mmo[1]) || 1;
      res.recur = { type:'monthly', rdays:[], rmd: dd };
      const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const cand = new Date(now.getFullYear(), now.getMonth(), dd);
      if (cand < today0) cand.setMonth(cand.getMonth()+1);
      base.setFullYear(cand.getFullYear()); base.setMonth(cand.getMonth()); base.setDate(cand.getDate());
      t = t.replace(mmo[0],'，');
    } else {
      const mw = t.match(/每\s*(?:个)?\s*(?:周|星期)\s*([一二三四五六日天末、，,到至及和周\s]{1,24})/);
      if (mw){
        const seg = mw[1];
        let days = [];
        const rg = seg.match(/([一二三四五六日天末])\s*周?\s*(?:到|至|-|~)\s*周?\s*([一二三四五六日天末])/);
        if (rg){
          const a = WDM[rg[1]], b = WDM[rg[2]];
          if (a && b){ for (let i=a;i<=b;i++) days.push(i); }
        } else {
          days = (seg.match(/[一二三四五六日天末]/g) || []).map(c=>WDM[c]).filter(Boolean);
        }
        days = Array.from(new Set(days)).sort((x,y)=>x-y);
        if (days.length){
          res.recur = { type:'weekly', rdays:days, rmd:null };
          t = t.replace(mw[0],'，');
        }
      }
    }
  }
  // 重复日程的起始日：顺延到最近一个命中的星期
  if (res.recur && res.recur.type === 'weekly' && res.recur.rdays.length){
    const d0 = base.getDay()===0 ? 7 : base.getDay();
    if (!res.recur.rdays.includes(d0)){
      let delta = null;
      for (const d of res.recur.rdays){ const diff = (d - d0 + 7) % 7; if (delta === null || diff < delta) delta = diff; }
      if (delta) base.setDate(base.getDate()+delta);
    }
  }

  // 周X
  let m = t.match(new RegExp('(下下|下|这|本|上)?\\s*(?:周|星期)\\s*([一二三四五六日天末])'));
  if (m){
    const wdMap = {'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'日':7,'天':7,'末':6};
    const wd = wdMap[m[2]];
    const cur = base.getDay()===0 ? 7 : base.getDay();
    if (m[1]==='下') base.setDate(base.getDate() + (7-cur) + wd);
    else if (m[1]==='下下') base.setDate(base.getDate() + (7-cur) + 7 + wd);
    else if (m[1]==='上') base.setDate(base.getDate() - cur - (7-wd));
    else { let delta = wd - cur; if (delta < 0) delta += 7; base.setDate(base.getDate()+delta); }
    t = t.replace(m[0],'，'); dateHint = true;
  }

  // 提醒
  m = t.match(new RegExp('提前\\s*(半\\s*个?|(['+CN_CHARS+'\\d]{1,3}))?\\s*(分钟|小时|钟头)'));
  if (m && m[1]){
    if (m[1].includes('半')) res.remind = 30;
    else { const n = cn2num(m[2]) || 0; res.remind = /分钟/.test(m[3]) ? n : n*60; }
    t = t.replace(m[0],'，');
  }

  // 时长
  m = t.match(new RegExp('(['+CN_CHARS+'\\d]{1,3})?\\s*个?\\s*(半)?\\s*(小时|钟头)'));
  if (m && (m[1] || m[2])){
    const n = cn2num(m[1]);
    res.durMin = Math.round(((n||0) + (m[2] ? 0.5 : 0)) * 60);
    if (!n && m[2]) res.durMin = 30;
    t = t.replace(m[0],'，');
  } else {
    m = t.match(/(\d{1,3})\s*分钟/);
    if (m){ res.durMin = parseInt(m[1],10); t = t.replace(m[0],'，'); }
  }

  // 时段词
  m = t.match(/(凌晨|早上|早晨|上午|中午|下午|傍晚|晚上|今晚)/);
  if (m){ period = m[1]; }

  // 具体时间
  let h = null, mi = 0, timeStr = '';
  m = t.match(/(\d{1,2})\s*[:：]\s*(\d{1,2})/);
  if (m){ h = parseInt(m[1],10); mi = parseInt(m[2],10); timeStr = m[0]; }
  else {
    m = t.match(new RegExp('(['+CN_CHARS+']{1,3}|\\d{1,2})\\s*点\\s*((['+CN_CHARS+']{1,3}|\\d{1,2})\\s*分|半|一刻)?'));
    // 排除"再大一点/好一点"这类程度副词被误读成时间"一点"
    if (m && m[1] === '一' && !m[2] && !period){
      const around = t.slice(Math.max(0, m.index-1), m.index+2);
      if (/[再更大小多少快慢高低长短好差早晚]一?点/.test(around)){ t = t.replace(m[0],'，'); m = null; }
    }
    if (m){
      h = cn2num(m[1]); timeStr = m[0];
      if (m[2]){
        if (m[2].includes('半')) mi = 30;
        else if (m[2].includes('一刻')) mi = 15;
        else mi = cn2num(m[2].replace('分','')) || 0;
      }
    }
  }
  if (h != null){
    if (period){
      if (/下午|傍晚|晚上|今晚/.test(period) && h < 12) h += 12;
      else if (/中午/.test(period) && h < 6) h += 12;
      else if (/凌晨/.test(period) && h === 12) h = 0;
    } else if (h <= 6) h += 12;
    res.h = h; res.mi = mi;
    t = t.replace(timeStr,'，');
    if (period) t = t.replace(period,'，');
  }

  // 地点（"在X见/开/吃/聊/碰/拜…" 截取到动词前）
  m = t.match(/在\s*([^\s，]{1,10}?)(?=[，]|$|见|开|吃|聊|碰|拜)/);
  if (m && m[1] && !/点|分|小时/.test(m[1])){
    res.location = m[1];
    t = t.replace(m[0],'，');
  }

  // 标题清理
  let title = t
    .replace(/嗯+|那个|就是|然后|呃+|额+/g,'')
    .replace(/大概|大约|差不多|左右/g,'')
    .replace(/记得|提醒我|帮我|我要|我想/g,'')
    .replace(/[，,\s]+/g,' ')
    .replace(/^\s*(之前|前|最迟|截止)\s*/,'')
    .trim();
  res.title = title || '未命名';
  res.date = base;

  // 自动分类 + 标签预判（用原始语句判断，信息最全）
  const hasTime = res.h != null || res.allDay;
  res.kind = classifyKind(hasTime, raw);
  if (res.kind === 'idea') res.kind = 'todo';                 // 应用层不再单独成类
  if (res.kind === 'todo' && isCountdown(dateHint, raw)) res.kind = 'countdown';
  if (res.kind === 'countdown') res.due = fmtYMD(base);
  res.tag = guessTag(raw);
  return res;
}

if (typeof module !== 'undefined') module.exports = { parseUtterance, cn2num, guessTag, classifyKind, isCountdown, fmtYMD };
