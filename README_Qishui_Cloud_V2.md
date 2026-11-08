# 汽水音乐广告任务监控 V2（Loon + GitHub 私有日志）

**订阅地址：**

https://raw.githubusercontent.com/Vixvx/loon-plugins/main/Qishui_GitHub_Monitor_V2.plugin

### 功能

- 只读监听汽水音乐激励广告配置、完成与服务端返回。
- 根据任务页前后差异确认已计入的广告次数，不把单独的 HTTP 200 当作会员到账。
- 每分钟自动同步新增的脱敏事件到你自己的**私有 GitHub 仓库**中的一个 Issue 的评论；可手动立即同步。
- 同步默认关闭，不主动发送任何日志。
- V1 报告脚本在部分 Loon 版本中调用 `$done(undefined)` 导致的异常已修复。
- 不模拟观看广告、不自动点击、不伪造或重放领奖请求。

### 安装和启用

1. Loon → 插件 → 添加插件 → 粘贴上面的订阅地址并启用。
2. 如果安装过 V1，先**禁用 V1**，避免两个响应脚本争用相同网络请求。
3. 确认 Loon MitM 证书已经信任，并只按需要解密 `api.qishui.com` 和 `beta-luna.douyin.com`。
4. 检查之前的 `blockAds.plugin` 等广告拦截规则没有阻断汽水音乐激励广告。

### GitHub 私有日志初始化（需要你亲自操作）

1. GitHub 新建一个 **Private** 私有仓库，例如 `qishui-private-logs`。**不要使用公开的 loon-plugins 仓库存储个人日志。**
2. 确认仓库的 Issues 功能已开启，新建一个名为“汽水音乐脱敏日志”的 Issue，记下 Issue 编号，通常是 `1`。
3. GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens，新建仅授予这个私有仓库 `Issues: Read and write` 的 PAT，设置短有效期；不要给其他仓库权限。
4. 在 Loon V2 插件参数中，填写用户名、仓库名、Issue 编号和 PAT，再开启“云端同步”。
5. 正常看广告，返回会员任务页使进度刷新。正常情况下 Loon 在运行、联网且定时器执行时，每分钟最多同步20条新增日志。或者执行“汽水音乐 · 立即同步GitHub日志”。
6. 进入你自己的私有仓库 → Issues → 对应 Issue → Comments，查看自动新增的记录。

**安全提醒：** PAT 在本地 Loon 插件参数中，不会存储在公开 GitHub 代码里。导出或分享包含插件参数的 Loon 配置前，请删除 PAT。不要把 PAT、带凭据的配置、完整 HAR 上传到公开 Issue。

### 统计解释

- “广告完成响应”：广告完成接口返回 HTTP 2xx + 业务码 0。
- “服务端确认进度 +N”：从任务页中识别的某一阶段子任务 `false → true` 增量。
- 初次运行只记录任务基线，不凭空计算观看过多少次。
- 广告完成响应和任务页面成功更新并非同一事件，也不能仅凭这两者保证会员权益已最终到账。

### 已知限制

- GitHub 仓库不是可以被 Loon 直接匿名写入的实时服务器，首次使用需私有仓库、Issue 和限权 Token。
- Loon 脚本只能看到通过匹配规则并成功解密的请求。某些广告被屏蔽、URL/接口版本变化、MitM 无效，都会造成统计为 0。
- 网络失败时不会推进同步游标，下次可重试；同一发送请求在连接中断但服务端已写入的极端情况下，仍可能出现重复 Issue 评论。
- 本项目只经过离线 HAR 回放与 GitHub 文件验证，尚未经你的真机 V2 运行测试；首次安装请检查脚本日志。
- 如果 Loon 不支持插件参数的新语法，需升级到 Loon 3.5.1 (983) 或更高版本。

### 文件

- `Qishui_GitHub_Monitor_V2.plugin`：Loon 订阅入口。
- `Qishui_Reward_Monitor.js`：本地只读监控与手动报告，已升级 V1.1。
- `Qishui_GitHub_Sync.js`：可选的 GitHub Issue 评论同步。
