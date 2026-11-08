/*
 * 汽水音乐 V2 云端同步：只上传脱敏监控事件至用户私有 GitHub Issue。
 * 不读取/上传 HAR、Cookie、账号信息、原始请求、广告凭证。
 * 用户需主动开启，提供仅限私有日志仓库 Issues 写入的 token。
 */
(function () {
  'use strict';
  var TAG = '[汽水云端V2] ';
  var MONITOR_KEY = 'Vixvx.QishuiRewardMonitor.v1';
  var CURSOR_KEY = 'Vixvx.QishuiRewardMonitor.gh.v2.last_id';
  var cfg = (typeof $argument === 'object' && $argument) || {};

  function finish() { $done(); }
  function log(msg) { console.log(TAG + msg); }
  function intOrNull(x, max) {
    var n = Number(x);
    return isFinite(n) && n >= 0 && n <= max && Math.floor(n) === n ? n : null;
  }
  function safeString(x, limit) {
    return typeof x === 'string' ? x.replace(/[^\u4e00-\u9fa5a-zA-Z0-9\s\/()（）:：,.，。·+\-?？]/g, '').slice(0, limit) : '';
  }
  function parse(raw) { try { return JSON.parse(raw); } catch (_) { return null; } }
  function progress(p) {
    if (!p || typeof p !== 'object') return null;
    var out = {unlocked_days:intOrNull(p.unlocked,10000),remaining_ads:intOrNull(p.remaining,1000),stages:[]};
    var order = Array.isArray(p.order) ? p.order : [];
    for (var i=0;i<order.length && out.stages.length<6;i++) {
      var label=order[i], v=p.stages && p.stages[label];
      if (!/^第\d{1,4}天$/.test(label) || !v) continue;
      out.stages.push({day:label,completed:intOrNull(v.completed,100),total:intOrNull(v.total,100),unlocked:v.done===true});
    }
    return out;
  }
  function stats(s) {
    var z=s.stats||{};
    return {ad_preparations:intOrNull(z.prepared,100000000),
      completed_responses:intOrNull(z.serverDone,100000000),
      failed_responses:intOrNull(z.serverFailed,100000000),
      confirmed_progress_increases:intOrNull(z.confirmedAds,100000000)};
  }

  if (cfg.sync_enabled !== true) { log('云端同步未启用。'); finish(); return; }
  var owner=String(cfg.github_owner||'').trim();
  var repo=String(cfg.github_repo||'').trim();
  var issue=intOrNull(cfg.github_issue,1000000000);
  var token=String(cfg.github_token||'').trim();
  if (!/^[a-zA-Z0-9-]{1,39}$/.test(owner) || !/^[a-zA-Z0-9_.-]{1,100}$/.test(repo)
      || !issue || token.length<20 || token.length>500 || /\s/.test(token)) {
    log('请在插件参数中填写 GitHub 用户名、私有仓库、Issue 编号和限权 Token；参数不会打印。');
    finish(); return;
  }
  var s=parse($persistentStore.read(MONITOR_KEY));
  if (!s || !Array.isArray(s.events)) { log('尚无监控数据。'); finish(); return; }
  var last=intOrNull($persistentStore.read(CURSOR_KEY),1000000000)||0;
  var allowed={'广告配置':true,'广告素材':true,'广告完成信息':true,'广告完成响应':true,
    '广告错误':true,'任务基线':true,'任务确认':true,'任务接口异常':true,
    '解析提醒':true,'响应解析失败':true};
  var events=[];
  for (var i=0;i<s.events.length;i++) {
    var e=s.events[i], id=e && intOrNull(e.id,1000000000);
    if (id===null || id<=last || !allowed[e.type]) continue;
    events.push({id:id,time:safeString(e.at,20),kind:e.type,detail:safeString(e.text,100)});
  }
  events.sort(function(a,b){return a.id-b.id;});
  if (events.length===0) { log('暂无新增事件。'); finish(); return; }
  events=events.slice(0,20);
  var lastInBatch=events[events.length-1].id;
  var payload={format:'qishui-monitor-safe-v2',synced_at:new Date().toISOString(),
    stats:stats(s),progress:progress(s.progress),events:events};
  var comment='### 汽水音乐 · 脱敏任务日志\n\n同步时间（UTC）：'+payload.synced_at+
    '\n\n'+JSON.stringify(payload,null,2)+'\n\n此记录不包含账号、Cookie、Token 或原始网络流量。';
  var repoEndpoint='https://api.github.com/repos/'+owner+'/'+repo;
  var endpoint=repoEndpoint+'/issues/'+issue+'/comments';
  var authHeaders={
    'Accept':'application/vnd.github+json',
    'Authorization':'Bearer '+token,
    'X-GitHub-Api-Version':'2022-11-28',
    'User-Agent':'qishui-reward-monitor'
  };
  function upload() {
    try {
      $httpClient.post({
        url:endpoint,
        insecure:false,
        timeout:12000,
        headers:{
          'Accept':authHeaders.Accept,
          'Authorization':authHeaders.Authorization,
          'Content-Type':'application/json',
          'X-GitHub-Api-Version':authHeaders['X-GitHub-Api-Version'],
          'User-Agent':authHeaders['User-Agent']
        },
        body:JSON.stringify({body:comment})
      }, function(err,res) {
        var status=res && Number(res.status);
        if (!err && status===201) {
          $persistentStore.write(String(lastInBatch),CURSOR_KEY);
          log('同步成功：'+events.length+'条；累计任务进度+'+payload.stats.confirmed_progress_increases+'次。');
        } else {
          log('同步失败，HTTP '+(isFinite(status)?status:'?')+'；记录保留供下次重试。');
        }
        finish();
      });
    } catch (_) {
      log('同步请求启动失败，记录保留供下次重试。');
      finish();
    }
  }
  // The source repo is public, but logs must NEVER be sent to any public repo.
  try {
    $httpClient.get({
      url:repoEndpoint,
      headers:authHeaders,
      insecure:false,
      timeout:8000
    }, function(err,res,body) {
      var metadata=typeof body==='string'?parse(body):null;
      if (err || !res || Number(res.status)!==200 || !metadata || metadata.private!==true) {
        log('未能确认目标仓库是私有仓库，已禁止上传，请检查参数及权限。');
        finish(); return;
      }
      upload();
    });
  } catch (_) {
    log('私有仓库检查失败，已禁止上传。');
    finish();
  }
})();
