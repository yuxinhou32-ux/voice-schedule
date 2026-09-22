/* 解析器单测：时间解析 + kind 分类 + 标签预判 */
const { parseUtterance } = require('../parser.js');

const cases = [
  // [原句, 期望kind, 期望tag, 备注]
  ['明天下午三点半跟老张碰一下，大概一小时', 'event', 'work', '时间+工作'],
  ['下周三上午十点参加线上日语课，一个半小时', 'event', 'study', '课→学习'],
  ['周五晚上七点看场电影', 'event', 'fun', '电影→玩乐'],
  ['记得买牛奶', 'todo', 'personal', '买牛奶→个人'],
  ['有空找老王聊聊', 'todo', 'personal', '兜底待办'],
  ['明天提醒我吃药', 'todo', 'personal', '模糊时间→待办'],
  ['我想到一个点子，语音输入可以加个快捷短语功能', 'todo', 'work', '点子+功能→灵感已并入待办'],
  ['我觉得这个app的按钮间距可以再大一点', 'todo', 'work', '念头→灵感已并入待办'],
  ['睡前读一下设计心理学第一章', 'todo', 'study', '读→学习'],
  ['周末去爬山放松一下', 'todo', 'fun', '爬山→玩乐'],
  ['要是日视图能左右滑动切换日期就好了', 'todo', 'personal', '假设句→灵感已并入待办'],
  ['后天上午九点在中环A座拜访客户，两小时', 'event', 'work', '客户→工作'],
  // 重复类
  ['每周一三五早上八点起床', 'event', 'personal', '每周重复：一三五'],
  ['每周三晚上七点半去健身', 'event', 'personal', '每周重复：单个周三'],
  ['每天早上七点吃药', 'event', 'personal', '每天重复'],
  ['每周一到周五早上九点打卡', 'event', 'personal', '工作日区间重复'],
  ['每月3号上午十点交房租', 'event', 'personal', '每月重复'],
  ['每月3号交房租', 'todo', 'personal', '每月重复但没说钟点→待办'],
];

const today = new Date();
console.log('今天:', (today.getMonth()+1)+'/'+today.getDate(), '周'+'日一二三四五六'[today.getDay()]);
let pass = 0, fail = 0;
for (const [raw, ek, et, note] of cases){
  const p = parseUtterance(raw);
  const dt = p.date ? (p.date.getMonth()+1)+'/'+p.date.getDate() : '-';
  const time = p.h != null ? p.h+':'+String(p.mi).padStart(2,'0') : (p.allDay ? '全天' : '-');
  const okK = p.kind === ek, okT = p.tag === et;
  const ok = okK && okT;
  ok ? pass++ : fail++;
  const rc = p.recur ? (' | 重复:'+p.recur.type+(p.recur.rdays&&p.recur.rdays.length?('('+p.recur.rdays.join(',')+')'):'')+(p.recur.rmd?(' 每月'+p.recur.rmd+'号'):'')) : '';
  console.log((ok?'PASS':'FAIL')+' ['+note+'] '+raw);
  console.log('   → kind='+p.kind+(okK?'':' (期望'+ek+')')+' tag='+p.tag+(okT?'':' (期望'+et+')')+' | '+dt+' '+time+' '+p.durMin+'min | 「'+p.title+'」'+(p.location?' @'+p.location:'')+rc);
}
console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail ? 1 : 0);
