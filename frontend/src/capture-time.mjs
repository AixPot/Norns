/**
 * Deterministic new-task suggestion, never an automatic text mutation.
 * `now` is an injected Date, epoch milliseconds, or ISO instant with an offset.
 * Spans use JavaScript UTF-16 [start,end) offsets into the untouched input.
 * null means unsupported/ambiguous/invalid; no partial suggestion is returned.
 */
export function parseCapture(text,{now,timezone='Asia/Shanghai'}={}) {
 if(typeof text!=='string'||timezone!=='Asia/Shanghai')return null;
 if(typeof now==='string'&&!/(?:Z|[+-]\d{2}:\d{2})$/i.test(now))return null;
 if(!(now instanceof Date)&&typeof now!=='string'&&typeof now!=='number')return null;
 const instant=now instanceof Date?now:new Date(now);
 if(!Number.isFinite(instant.getTime()))return null;
 const local=new Date(instant.getTime()+8*3600000);
 if(!Number.isFinite(local.getTime()))return null;
 const matches=[...text.matchAll(/今天|明天|后天|下周[一二三四五六日天]|\d{4}-\d{2}-\d{2}|\d{4}年\d{1,2}月\d{1,2}日/g)];
 if(matches.length!==1)return null;
 const match=matches[0],start=match.index;
 let end=start+match[0].length;
 if(/^\d/.test(match[0])&&(/[A-Za-z0-9_+\/-]/.test(text[start-1]||'')||/[A-Za-z0-9_\/-]/.test(text[end]||'')))return null;
 let date;
 if(['今天','明天','后天'].includes(match[0])){
  local.setUTCDate(local.getUTCDate()+['今天','明天','后天'].indexOf(match[0]));
  date=local.toISOString().slice(0,10);
 }else if(match[0].startsWith('下周')){
  const weekday='一二三四五六日天'.indexOf(match[0].slice(-1));
  local.setUTCDate(local.getUTCDate()+7-(local.getUTCDay()+6)%7+Math.min(weekday,6));
  date=local.toISOString().slice(0,10);
 }else{
  const [y,m,d]=match[0].match(/\d+/g).map(Number);
  date=`${String(y).padStart(4,'0')}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
 }
 if(!validDate(date))return null;
 const tail=text.slice(end);
 const clock=/^\s*(?:(\d{2}):(\d{2})|(上午|下午)([0-9零〇一二两三四五六七八九十]+)点(?:(半)|([0-9零〇一二两三四五六七八九十]+)分)?)/.exec(tail);
 let time;
 if(clock){
  let hour=clock[3]?chineseNumber(clock[4]):Number(clock[1]);
  const minute=clock[5]?30:clock[6]?chineseNumber(clock[6]):Number(clock[2]||0);
  if(!Number.isInteger(hour)||!Number.isInteger(minute)||minute<0||minute>59)return null;
  if(clock[3]){
   if(hour<1||hour>12)return null;
   hour=hour%12+(clock[3]==='下午'?12:0);
  }else if(hour<0||hour>23)return null;
  end+=clock[0].length;
  if(/[A-Za-z0-9_+零〇一二两三四五六七八九十百点分半:：.]/.test(text[end]||''))return null;
  time=`${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`;
 }
 const prefix=text.slice(0,start),suffix=text.slice(end);
 // 到 is also a destination verb. Only temporal RHS tokens (including incomplete
 // ones) make it a range; never consume destination wording as part of the span.
 if(/^\s*到\s*(?:$|今天|明天|后天|(?:下?周|星期)|[上下]午|早上|早晨|晚上|中午|凌晨|傍晚|\d|[零〇一二两三四五六七八九十]+(?:点|时|月|日|年))/.test(suffix))return null;
 // Single-character modifiers need a boundary: 整理/起草/前往 are titles, not modifiers.
 // Reject modifiers/ranges and quoted date literals rather than extracting a substring.
 if(/(?:大约|大概|约|从|自|截至|截止)\s*$/.test(prefix)||/^\s*(?:之前|以后|之后|以前|(?:前|后|起)(?=\s|$|[，。！？、；：])|左右|内|至|[~～—–/\-]|的|T\d|一刻|钟|多|许|整(?=\s|$|[，。！？、；：])|早上|早晨|晚上|中午|凌晨|傍晚)/.test(suffix))return null;
 if(/[《“「『"']([^》”」』"']*)$/.test(prefix))return null;
 const remainingTitle=(prefix+suffix).trim();
 // Never salvage a date when an unparsed clock/meridiem remains anywhere.
 if(/(?:\d+\s*(?:am|pm|时)|\b(?:am|pm)\b)|上午|下午|[0-9零〇一二两三四五六七八九十]+点|\d[:：]\d/i.test(remainingTitle))return null;
 if(/(?:每(?:逢|星期|季度|工作日|[天日周月年个零一二两三四五六七八九十0-9])|每天|每隔|隔[0-9零一二两三四五六七八九十]|重复|循环|定期)|(?:[0-9零〇一二两三四五六七八九十半]+(?:个)?(?:小时|分钟|秒钟|秒|天|日|周|个月|年))/.test(remainingTitle))return null;
 if(/周末|(?:周|星期)[一二三四五六日天]|\d{4}\.\d{1,2}\.\d{1,2}|\d{1,4}[-/]\d{1,2}|\d{1,4}年|\d{1,2}月\d{1,2}日/.test(remainingTitle))return null;
 return {schedule:{start_date:date,timezone,...(time?{start_time:time}:{})},spans:[{start,end,text:text.slice(start,end)}],remainingTitle,reason:time?'date-time':'date',emptyTitle:!remainingTitle};
}
function validDate(date){
 return /^\d{4}-\d{2}-\d{2}$/.test(date)&&!date.startsWith('0000')&&
  Number.isFinite(Date.parse(date))&&new Date(date).toISOString().slice(0,10)===date;
}

function chineseNumber(value){
 if(/^\d{1,2}$/.test(value))return Number(value);
 const digit=s=>'零一二三四五六七八九'.indexOf(s.replace('〇','零').replace('两','二'));
 if(value.length===1)return digit(value);
 if(/^[零〇][一二三四五六七八九]$/.test(value))return digit(value[1]);
 if(/^([一二三四五六七八九])?十([一二三四五六七八九])?$/.test(value)){
  const [tens,ones]=value.split('十');return (tens?digit(tens):1)*10+(ones?digit(ones):0);
 }
 return NaN;
}
