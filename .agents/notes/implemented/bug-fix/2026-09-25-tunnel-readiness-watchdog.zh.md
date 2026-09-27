# Agent Note: 运行中的隧道由公网地址而非仅由进程监督

Status: implemented

## Problem

自动隧道的失败判据只覆盖两种形态：超时内没有拿到铸造的 URL，以及 cloudflared 进程退出。第三种形态两者都不覆盖：连接器失去了 Cloudflare 边缘注册，而进程（连同 metrics 端口）仍然活着。此时主机名不再解析，管理器持续报 `running`，固定域名中继继续把已配对的手机转发到那个失效地址，于是手机撞上 Cloudflare 530 / Error 1016（"Origin DNS error"），而不是中继自己的离线页。工单 #1723 在一次真实的长时运行中实测到：`GET /api/pair/status` 报 `{"tunnel":{"state":"running","url":"https://…trycloudflare.com"}}`，而同一秒的 `GET 127.0.0.1:20241/ready` 返回 `{"status":503,"readyConnections":0,…}`，铸造出的域名已是 NXDOMAIN，固定域名中继返回 530。该状态维持四小时以上且没有任何自愈路径；只有关开自动公网隧道或重启 `dsh web` 才会重铸出可用 URL。

管理器自己的注释在 spawn 决策处已经点出过这一失败形态（`readyConnections: 0 forever`，因此固定 `--protocol http2` 规避），但运行期没有任何检查。

## Decision

`TunnelManager` 监督的是就绪度，而不只是进程存活。隧道报出 URL 之后，看门狗每隔 `healthCheckIntervalMs`（默认 60 秒，`0` 关闭）探测一次该公网地址，连续 `healthCheckFailures` 次（默认 2）失败即以 "the tunnel stopped answering on its public URL" 走既有的 `fail()` 路径。该路径未做改动：停止 handle、相位转为 `failed`、按既有指数退避安排重启，于是重铸出新的隧道并再次触发 `onUrl`——这正是 `announceRelay` 把固定域名中继重新注册到新 URL 的机制。面板与 `/api/pair/status` 因此报告真实的 `failed`/`starting` 迁移，而不是陈旧的 `running`。

`probeTunnelUrl(url, timeoutMs)` 是默认探针：从宿主机 GET 隧道的公网地址，任何小于 500 的 HTTP 应答都算存活——未配对的 harness 返回 401/403 属正常往返；DNS 失败、连接被拒或挂起、以及 Cloudflare 5xx（530 "Origin DNS error"、1033）算死亡。它返回 `false` 而不抛错，因为看门狗把抛错同样读作死亡，本地探测错误绝不能反复重铸一条正常的隧道。

探针刻意选**公网地址**而不是 cloudflared 本地的 `/ready`：cloudflared 包的 handle 并不暴露该端点（metrics 端口由二进制自行选定），而公网地址正是手机真正使用的地址，一次测量即覆盖 DNS、边缘注册与源站可达性。探测间隔相对它所发现的故障足够宽裕：这是针对「悄悄死掉的隧道」的看门狗，不是负载均衡健康检查，每分钟一次探测在隧道自身的请求计数里几乎不可见。

新增的接缝——`probe`、`healthCheckIntervalMs`、`healthCheckFailures`、`probeTimeoutMs`——全部可注入，因此无需网络或真实二进制即可覆盖看门狗。

## Alternatives considered

探测 cloudflared 自己的 `/ready`（或其 metrics 的 `readyConnections`）被否决：管理器既不拥有该端口也不拥有对应客户端——cloudflared 包的 `Tunnel` handle 没有就绪面，而工单 #1445 已经在 spawn 时用 `--protocol http2` 修掉了该失败的 QUIC 变体。公网地址本身是更强的信号——它失败的时刻正是手机会失败的时刻。

把单次探测失败判为死亡被否决：宿主机上一次瞬时的 DNS 或网络抖动就会重铸一条健康隧道并让手机访问源变动，而这正是重连宽限（工单 #1547）试图避免的代价。连续两次失败配合默认 60 秒间隔，最多把真实判决推迟一分钟。

把判决交给中继（例如 Workers 侧探测后删除映射）被否决，因为它不在本仓库手里：中继无法可靠地发现源站已死——1016 页面本身就是证据——而插件必须在中继不可达时也能自愈。

同样被否决的还有把探测做成设置项：它发现的故障绝不可能是用户有意为之，默认间隔每分钟只花一次请求，而关闭看门狗恰好恢复 #1723 的行为。

## Consequences

长时运行的部署现在能自行从「悄悄死掉的隧道」中恢复：大约两个探测周期内相位离开 `running`，退避重启铸出新的 URL，中继被重新注册——手机的固定域名返回正常的 `401`，而不是 Cloudflare 1016。

看门狗同时也观测到中继离线页本来所针对的空窗：隧道处于 `failed`/`starting` 期间，插件如实报告该状态，中继在新 URL 被宣告前保留上一次映射。

代价：每条运行中的隧道每分钟一次发往其自身公网地址的请求，以及判定一条死隧道最多多花一分钟。若某条隧道的公网地址从互联网可达、却拒绝本主机的探测（例如边缘屏蔽了该部署的出口 IP），它会在循环中被反复重铸；目前没有已知案例，且该探测走的正是手机所用的同一条路径。

## Testing

`packages/dsh-remote-web-ui/tests/tunnel.spec.ts` 以注入接缝钉住看门狗：健康地址被探测且从不重启；连续两次失败以 "the tunnel stopped answering on its public URL" 让本次尝试失败、停止旧 handle，并退避重启出一个经 `onUrl` 上报的新 URL；一次成功会清零失败计数，因此瞬时抖动不会重铸隧道；`stop()` 会取消挂起的探测；而在隧道已因新目标被替换之后才返回的探测不会误判新隧道。`probeTunnelUrl` 本身用真实回环服务器覆盖——未认证的 `401` 算存活、`530` 算死亡、连接被拒解析为 `false` 而不是抛错。其中四个管理器用例在改动前（无看门狗）的管理器上失败，改动后通过。
