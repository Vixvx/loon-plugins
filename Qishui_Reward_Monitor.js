/*
 * Qishui Reward Monitor V1.1.0 — Loon read-only HTTP response / Generic script
 * Source: actual Qishui 21.5.0 HAR sample (2026-11-08)
 * Privacy: never reads request body, headers, URL query, account IDs or tokens.
 * Safety: does not modify traffic or create any outbound requests.
 */
(function () {
  'use strict';
  var KEY = 'Vixvx.QishuiRewardMonitor.v1';
  var MAX_EVENTS = 40;
  var TAG = '[汽水监控V1] ';
  var action = typeof $argument === 'string' ? $argument : '';
  var isHttp = typeof $request !== 'undefined' && typeof $response !== 'undefined';

  function initial() {
    return {version: 1, nextEventId: 0, stats: {prepared: 0, serverDone: 0, serverFailed: 0, rewardResponses: 0, confirmedAds: 0}, lastPreparation: {}, lastDone: null, progress: null, events: []};
  }
  function load() {
    try {
      var raw = $persistentStore.read(KEY);
      var data = raw ? JSON.parse(raw) : null;
      if (data && data.version === 1 && data.stats && Array.isArray(data.events)) {
        // v1 records do not have IDs; only new events are eligible for cloud sync.
        if (typeof data.nextEventId !== 'number' || !isFinite(data.nextEventId)) {
          data.nextEventId = 0;
          for (var i = 0; i < data.events.length; i++) {
            var id = data.events[i] && data.events[i].id;
            if (typeof id === 'number' && isFinite(id) && id > data.nextEventId) data.nextEventId = id;
          }
        }
        return data;
      }
    } catch (_) { /* Do not print raw values. */ }
    return initial();
  }
  function save(s) {
    if (s.events.length > MAX_EVENTS) s.events = s.events.slice(-MAX_EVENTS);
    return $persistentStore.write(JSON.stringify(s), KEY);
  }
  function now() {
    var d = new Date();
    function pad(v) { return ('0' + v).slice(-2); }
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }
  function log(s, type, detail) {
    s.nextEventId = (typeof s.nextEventId === 'number' ? s.nextEventId : 0) + 1;
    var entry = {id: s.nextEventId, at: now(), type: type, text: String(detail).slice(0, 180)};
    s.events.push(entry);
    console.log(TAG + entry.at + ' [' + entry.type + '] ' + entry.text);
  }
  function notify(subtitle, body) {
    if (typeof $notification !== 'undefined') {
      $notification.post('汽水音乐 · 任务监控', subtitle, body);
    }
  }
  function numberOrNull(x) { return typeof x === 'number' && isFinite(x) ? x : null; }
  function safeInt(x) {
    if (typeof x !== 'number' && typeof x !== 'string') return null;
    var n = Number(x);
    return isFinite(n) && Math.floor(n) === n && n >= 0 && n < 100000000 ? n : null;
  }
  function textValue(v) { return v && typeof v === 'object' && typeof v.plain_text === 'string' ? v.plain_text : ''; }

  function readProgress(doc) {
    var sections = doc && doc.data && doc.data.sections;
    if (!Array.isArray(sections)) return null;
    var task = null;
    for (var i = 0; i < sections.length && !task; i++) {
      var group = sections[i] && sections[i].task_group;
      var tasks = group && group.tasks;
      if (!Array.isArray(tasks)) continue;
      for (var j = 0; j < tasks.length; j++) {
        var t = tasks[j];
        if (t && t.key === 'luna_rewards_ads' && t.discrepancy_data && t.discrepancy_data.reward_ads) {
          task = t; break;
        }
      }
    }
    if (!task) return null;
    var ra = task.discrepancy_data.reward_ads;
    var rows = Array.isArray(ra.progress) ? ra.progress : [];
    var view = task.view || {};
    var subtitle = view.subtitle || {};
    var duration = subtitle.countdown_text && subtitle.countdown_text.countdown;
    var unlocked = duration && duration.suffix === '天' ? safeInt(duration.duration) : null;
    var suffix = textValue(subtitle.suffix);
    var remainingMatch = /再看\s*(\d+)\s*次/.exec(suffix);
    var remaining = remainingMatch ? safeInt(remainingMatch[1]) : null;
    var stages = {};
    var order = [];
    for (var k = 0; k < rows.length && k < 40; k++) {
      var row = rows[k];
      if (!row || !Array.isArray(row.children)) continue;
      var label = textValue(row.text);
      // Only permit a short, fixed-looking day label, not arbitrary server text.
      if (!/^第\d{1,4}天$/.test(label)) continue;
      var dayKey = label;
      var children = {};
      var completed = 0;
      var total = 0;
      for (var c = 0; c < row.children.length && c < 20; c++) {
        var child = row.children[c];
        var seq = child && safeInt(child.seq);
        if (seq === null) continue;
        children[String(seq)] = child.is_completed === true;
        total++;
        if (child.is_completed === true) completed++;
      }
      stages[dayKey] = {done: row.is_completed === true, completed: completed, total: total, children: children};
      order.push(dayKey);
    }
    if (order.length === 0 && unlocked === null && remaining === null) return null;
    return {at: now(), unlocked: unlocked, remaining: remaining, stages: stages, order: order};
  }
  function summary(snap) {
    if (!snap) return '尚未获取到任务进度';
    var p = [];
    if (snap.unlocked !== null) p.push('已解锁' + snap.unlocked + '天');
    var target = null;
    for (var i = 0; i < snap.order.length; i++) {
      var key = snap.order[i];
      if (!snap.stages[key].done) { target = key; break; }
    }
    if (target) {
      var row = snap.stages[target];
      p.push(target + ' ' + row.completed + '/' + row.total);
    }
    if (snap.remaining !== null) p.push('还需' + snap.remaining + '次');
    return p.join(' · ') || '进度数据存在，但未识别出天数';
  }
  function handleProgress(s, doc) {
    var cur = readProgress(doc);
    if (!cur) { log(s, '解析提醒', '任务响应成功，但找不到已知的广告解锁进度结构'); return; }
    var old = s.progress;
    var changed = !old || JSON.stringify({u: old.unlocked, r: old.remaining, stages: old.stages}) !== JSON.stringify({u: cur.unlocked, r: cur.remaining, stages: cur.stages});
    if (!changed) return; // Deduplicate repeated task/page/v2 refreshes.
    var added = 0;
    if (old && old.stages) {
      for (var i = 0; i < cur.order.length; i++) {
        var key = cur.order[i];
        if (!Object.prototype.hasOwnProperty.call(old.stages, key)) continue;
        var prior = old.stages[key].children || {};
        var after = cur.stages[key].children || {};
        for (var childKey in after) {
          if (Object.prototype.hasOwnProperty.call(after, childKey) &&
              Object.prototype.hasOwnProperty.call(prior, childKey) && prior[childKey] === false && after[childKey] === true) {
            added++;
          }
        }
      }
    }
    var unlockedDiff = old && old.unlocked !== null && cur.unlocked !== null ? cur.unlocked - old.unlocked : 0;
    if (!old) {
      log(s, '任务基线', summary(cur));
    } else {
      if (added > 0) s.stats.confirmedAds += added;
      var detail = summary(cur);
      if (added > 0) detail = '进度新增' + added + '次 · ' + detail;
      if (unlockedDiff > 0) detail = '已解锁天数+' + unlockedDiff + ' · ' + detail;
      if (added === 0 && unlockedDiff === 0) detail = '任务进度变化 · ' + detail;
      log(s, '任务确认', detail);
      if (added > 0 || unlockedDiff > 0) notify('服务端任务进度已更新', detail);
    }
    s.progress = cur;
  }
  function handleDone(s, doc, status) {
    var httpOk = status >= 200 && status < 300;
    var bizOk = httpOk && doc && doc.status_code === 0;
    var rewardDetails = doc && doc.reward_details;
    var items = [];
    if (rewardDetails && typeof rewardDetails === 'object') {
      var keys = Object.keys(rewardDetails).slice(0, 10);
      for (var i = 0; i < keys.length; i++) {
        var r = rewardDetails[keys[i]];
        if (!r || typeof r !== 'object') continue;
        var type = safeInt(r.reward_type);
        var amount = safeInt(r.amount);
        var claim = safeInt(r.claim_status);
        items.push('类型' + (type === null ? '?' : type) + '/数量' + (amount === null ? '?' : amount) + '/领取状态' + (claim === null ? '?' : claim));
      }
    }
    var outcome = bizOk ? '成功' : '未确认成功';
    var detail = '广告完成接口' + outcome + ' (HTTP ' + status + ', 业务码' + (doc && typeof doc.status_code === 'number' ? doc.status_code : '?') + ')';
    if (items.length) detail += ' · 奖励 ' + items.join('；');
    // Time-window dedup prevents counting app retries as two completions. No tokens or IDs stored.
    var signature = String(bizOk) + ':' + items.join('|');
    if (s.lastDone && s.lastDone.signature === signature && Date.now() - s.lastDone.epoch < 8000) return;
    s.lastDone = {signature: signature, epoch: Date.now()};
    if (bizOk) { s.stats.serverDone++; if (items.length) s.stats.rewardResponses++; }
    else s.stats.serverFailed++;
    log(s, bizOk ? '广告完成响应' : '广告错误', detail);
    notify(bizOk ? '广告完成请求已被接受' : '广告完成请求异常',
      bizOk ? '已收到奖励响应；是否计入任务请以进度更新为准。' : '查看 Loon 脚本日志和任务进度。');
  }
  function handlePreparation(s, path, doc, status) {
    var ok = status >= 200 && status < 300 && doc && doc.status_code === 0;
    var kind = path.indexOf('/config') !== -1 ? '配置' : path.indexOf('/retrieve') !== -1 ? '素材' : '完成信息';
    var stamp = Date.now();
    // Collapse duplicate config/retrieve requests in an 8-second window.
    var prev = s.lastPreparation[kind] || 0;
    if (stamp - prev < 8000 && ok) return;
    s.lastPreparation[kind] = stamp;
    if (ok) s.stats.prepared++;
    log(s, '广告' + kind, ok ? '获取成功' : '请求或业务状态异常 (HTTP ' + status + ')');
  }
  function report(s) {
    var z = s.stats;
    var headline = summary(s.progress);
    var stats = '准备事件' + z.prepared + ' · 广告完成响应成功' + z.serverDone + ' · 失败' + z.serverFailed + ' · 服务端确认进度+' + z.confirmedAds + '次';
    console.log(TAG + '=== 脱敏任务报告 ===');
    console.log(TAG + headline);
    console.log(TAG + stats);
    if (!s.events.length) console.log(TAG + '暂无事件，请先打开汽水音乐任务页并观看一次真实广告。');
    var recent = s.events.slice(-15);
    for (var i = 0; i < recent.length; i++) {
      console.log(TAG + recent[i].at + ' [' + recent[i].type + '] ' + recent[i].text);
    }
    notify('当前任务概况', headline + '\n' + stats);
  }
  try {
    if (!isHttp) {
      if (action === 'reset') {
        $persistentStore.write(undefined, KEY); // Never erase other scripts' data.
        $persistentStore.write(undefined, 'Vixvx.QishuiRewardMonitor.gh.v2.last_id'); // Reset cloud cursor with local history.
        console.log(TAG + '仅当前插件的本地统计和事件已清空。');
        notify('本地记录已清空', '不会影响汽水音乐服务器上的任何任务或会员权益。');
      } else report(load());
    } else {
      var s = load();
      var url = String($request.url || '');
      // Discard all URL query parameters and never log the URL.
      var path = url.replace(/^https?:\/\/[^\/]+/i, '').split('?')[0].replace(/^\/{2}/, '/');
      var status = numberOrNull($response.status);
      status = status === null ? 0 : status;
      var body = $response.body;
      var doc = null;
      if (typeof body === 'string') {
        try { doc = JSON.parse(body); } catch (_) { /* No raw payload logs. */ }
      }
      if (!doc) {
        log(s, '响应解析失败', '已匹配的接口没有可解析的 JSON 响应 (HTTP ' + status + ')');
      } else if (/^\/luna\/treasure\/task\/page\/v2$/.test(path)) {
        if (status === 200 && doc.status_code === 0) handleProgress(s, doc);
        else log(s, '任务接口异常', 'HTTP ' + status + ' / 业务码 ' + (typeof doc.status_code === 'number' ? doc.status_code : '?'));
      } else if (/^\/luna\/advert\/incentive\/done$/.test(path)) {
        handleDone(s, doc, status);
      } else if (/^\/luna\/(?:advert\/incentive\/(?:config|retrieve)|advert\/fallback\/done\/info|ads\/(?:config|dsp\/retrieve))$/.test(path)) {
        handlePreparation(s, path, doc, status);
      }
      save(s);
    }
  } catch (_) {
    // Deliberately do not print exception objects: some runtimes attach request URLs.
    console.log(TAG + '脚本遇到异常；请在 Loon 中检查插件是否更新和 HTTPS 解密是否生效。');
  } finally {
    // Always pass through the original response unchanged; never forge reward or alter headers.
    // Loon generic scripts require no argument; passing undefined triggered e.body on some builds.
    if (isHttp) $done({});
    else $done();
  }
})();