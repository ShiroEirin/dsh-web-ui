Web 插件设置卡片设计优化 - GUI 验证记录
====================================================================

日期：2026-10-01（Asia/Shanghai）
构建：工作树 pnpm build 之后的 packages/*/lib；聚合客户端
      packages/dsh-web-all/lib/client.js 已重建并按 pnpm libs:write 重新记录指纹。

方法
----
用户正在运行的桌面宿主全程不被触碰（不重启、不发送信号、不换绑端口）。验证在隔离宿主上进行：

  1. 临时 DSH_HOME（复制 web profile、软链 profiles/node_modules）：
       rm -rf /tmp/dsh-verify-ui
       mkdir -p /tmp/dsh-verify-ui/profiles
       cp -a ~/.dsh/profiles/web /tmp/dsh-verify-ui/profiles/web
       ln -sfn ~/.dsh/profiles/node_modules /tmp/dsh-verify-ui/profiles/node_modules
  2. DSH_HOME=/tmp/dsh-verify-ui dsh --profile web --port 19401 --no-open
     -> dsh web: http://127.0.0.1:19401/?token=<redacted>
     profile 中缺依赖的 @local/* 行被跳过，家族聚合行照常挂载。
     隔离宿主使用默认外观（body.dataset 只有 dshSkinCenter / dshBackdropActive，
     没有皮肤标记），因此这组截图同时是默认主题下的证据；用户桌面宿主当前启用
     orca-link 皮肤，同一改动在皮肤下的表现由会话记录中的桌面宿主截图覆盖。
  3. Playwright（chromium，1400x1000，deviceScaleFactor 2）打开带 token 的 URL；
     首次启动的 "Add an API key to get started" 弹窗点 Configure later，随后
     设置 -> Web Plugins。
  4. 截图：01-cards-collapsed.jpg（两张卡收起）、02-board-topic-list.jpg（任务看板展开）、
     03-remote-form.jpg（远程访问展开）。
  5. 结束：终止隔离宿主进程并删除 /tmp/dsh-verify-ui；用户宿主的进程从未被信号、
     重启或重新绑定端口。

观察到的 DOM（收起状态）
------------------------
设置 -> Web Plugins 的 button[aria-expanded] 序列（任务看板展开前后各一次）：

  Remote access | Phone pairing, public tunnel and device limits.   expanded=false
  Task Board    | Task orchestration, agent announcement and goal acceptance.   expanded=false

任务看板展开后新增的三张主题卡（都保持收起）：

  Enable the task board | Master switch, announcement, sleep protection and subtask depth.
  Task acceptance       | The switch, the judge model and the criteria threshold.
  GitHub Issues sync    | Synchronize GitHub Issues into board cards and write column changes back to the issue labels.

任务看板卡片底部的小字（12px，紧接主题卡列表之后）：

  Platform: darwin; protection: disabled; running sessions: 1; enabled schedules: 3
  This may use more battery. Lid close, manual sleep, hibernation, shutdown, low-battery actions, and enterprise policy are outside the guarantee; an already sleeping computer is not woken.

分区标题
--------
设置 -> Web Plugins 只渲染分区标题与家族卡片：标题下原先那行说明
（"Enable and configure the dsh-web family plugins from one place." /
"统一管理 dsh-web 全家桶插件的启用与配置。"）已删除。

已知限制
--------
- 隔离宿主与用户桌面宿主使用同一个 dsh 运行时（0.2.0-rc.2），但只挂了 web profile
  的家族插件；梁神模式等未安装的家族卡片不在截图中。
- 隔离宿主覆盖默认外观；皮肤（orca-link）下的同一界面由会话内的桌面宿主截图覆盖，
  两组截图使用同一份构建产物。
