# 部署（把《逐层电路》放到网上）

**当前线上地址：<https://layered-circuits.pages.dev/>**（Cloudflare Pages，主分支自动构建）

游戏是**纯静态前端**：没有后端、没有数据库、没有环境变量，进度存在玩家浏览器的
`localStorage` 里。任何静态托管都能跑，构建产物只有两个文件：

```
apps/studio/dist/index.html              645 KB（gzip 198 KB，JS/CSS/图形全内联）
apps/studio/dist/assets/worker-*.js      141 KB（仿真 Worker）
apps/studio/dist/_headers                缓存策略（Cloudflare Pages 读它）
```

## 0. 先在本机验证一遍（30 秒）

```bash
pnpm install --frozen-lockfile   # 与云端 CI 相同的安装方式
pnpm build                       # 产出 apps/studio/dist
pnpm preview                     # http://localhost:4173 打开看看
```

三条都过了，云端构建也会过。**注意 `--frozen-lockfile`**：CI 环境下 `pnpm install`
默认就是冻结语义，锁文件跟 `package.json` 不同步会直接构建失败（本仓库曾因为
`tools/*` 没进锁文件而失败，已修）。

---

## 1. Cloudflare Pages（推荐：免费、不用备案）

### 连 Git 仓库（push 即自动部署）

控制台 → **Workers & Pages** → Create → Pages → **Connect to Git** → 选仓库，然后填：

| 设置项 | 值 | 说明 |
|---|---|---|
| Framework preset | **None**（或选 Vite 后手动改下面两项） | 预设会写错单仓项目的路径 |
| Root directory | `/`（默认） | 在仓库根目录安装依赖 |
| Build command | `pnpm build` | 根脚本会构建 `apps/studio` |
| Build output directory | `apps/studio/dist` | |
| Node 版本 | 不用设 | 构建镜像默认 **22.16.0**，满足 Vite 7 的 `^20.19 \|\| >=22.12` |

构建镜像自带的 pnpm 默认是 10.11.1，而本仓库 `packageManager` 写的是 `pnpm@9.6.0`
（锁文件格式同为 9.0，两者都能读）。**若构建日志里出现 pnpm 版本相关报错**，在
Settings → Environment variables 里加一条 `PNPM_VERSION=9.6.0` 即可。

> 免费版额度：**500 次构建/月**、同一时间 1 个构建、单次构建 20 分钟超时；静态资源
> 请求与带宽不额外计费。个人项目完全够用。

### 或者本机直传（不连 Git）

```bash
pnpm build
npx wrangler login                       # 首次：浏览器里授权
npx wrangler pages deploy apps/studio/dist --project-name layered-circuits
# 等价于仓库里现成的脚本：
pnpm deploy:cf
```

### 绑定自定义域名

Cloudflare 走全球节点，**自定义域名不需要工信部备案**。加完域名按提示改 DNS 即可，
免费证书自动签发。

> 国内可达性请自己实测一次：手机 4G、不挂梯子打开链接。Cloudflare 在大陆一般能直连，
> 速度看当地网络（比国内节点慢，但不需要备案）。

### 让 `git push` 自动部署（GitHub Actions 直传）

仓库里的 `.github/workflows/ci.yml` 已经把这条流水线写好了：

| 触发 | 做什么 |
|---|---|
| push / PR | `pnpm install --frozen-lockfile` + `pnpm check`（typecheck + lint + 298 个测试） |
| **main 的 push**（或 Actions 页手动 Run workflow） | 先跑上面那套，**过了才** `pnpm build` + `wrangler pages deploy` |

也就是：**测试不过就不会发布**；PR 只跑检查、不动线上。之后 `git push` 就会更新
<https://layered-circuits.pages.dev/>。

一次性配置（只有你本人能做）：

1. **Cloudflare**：右上头像 → My Profile → API Tokens → **Create Custom Token**，权限加一条
   **Account → Cloudflare Pages → Edit**、账号资源选你自己的账号，创建后复制 token；
   Account ID 在 Workers & Pages 概览页的右侧栏。
2. **GitHub**：仓库 Settings → Secrets and variables → Actions → New repository secret，
   加两条，名字必须完全一致：`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`。
3. push 一次，或去 Actions 页点 **Run workflow**，看日志。

> ⚠️ Cloudflare 官方限制：**直传项目无法事后改成 Git 集成**，要换成一个 Git 集成项目就得
> 新建项目（会换域名）。所以这里的自动部署是用 Actions 直传实现的 —— 控制台里项目类型仍显示
> Direct Upload，这不影响使用。想要 PR 预览环境的话才需要走 Git 集成项目。

**排错**

- `Authentication error` / 401 → Secrets 名字不对或 token 权限不足（要能编辑 Pages）；
  现在 workflow 会先跑「检查部署密钥」这一步，缺哪个 secret 会直接在报错里点名
- 发布到了别的项目 → `--project-name` 必须与控制台里的项目名一致（现在是 `layered-circuits`）
- CI 里 `pnpm check` 失败但本地是绿的 → 先看 Node 版本（CI 固定 22）与 `--frozen-lockfile`

---

## 2. 腾讯云 EdgeOne Pages（要国内节点就得备案）

额度很好（免费版含国内 CDN），但**官方对项目域名/部署域名的访问规则**很硬
（[域名管理文档](https://edgeone.cloud.tencent.com/pages/document/175191784523485184)）：

| 加速区域 | 中国大陆访问项目域名 | 绑定自定义域名 |
|---|---|---|
| 中国大陆可用区 | 只能用系统预览链接，**3 小时有效**，过期 401 | **需工信部备案** |
| 全球可用区（含中国大陆） | 同上 | **需工信部备案** |
| 全球可用区（不含中国大陆） | **返回 401** | 不要求备案 |

也就是说：**没有备案域名时，EdgeOne 免费版给不了国内朋友一个稳定地址。** 想用它就得
先有域名并完成备案（备案免费，但要时间）。真要走这条路时的构建配置已经写在仓库的
`edgeone.json` 里（安装/构建命令、输出目录、Node 20.18.0、缓存头），控制台会自动读。

> ⚠️ 用 EdgeOne 时**不要放 `.nvmrc`**：它会按文件切 Node 版本，但不会跟着提供对应的 pnpm。

---

## 3. 零成本的临时玩法（不需要任何账号）

直接双击 `apps/studio/dist/index.html` 就能玩 —— 产物是自包含的，可以微信/网盘直接发人。
这时 Worker 加载不了，仿真会**自动回退主线程**（`runner.ts` 里的兜底），缺点是判定大电路
时页面会顿一下（参考解判定最慢约 2.2 秒，玩家手搭的电路远快于此）。

---

## 4. 部署后会踩到的三个点

**① Worker 的资源路径是构建时写死的**

| 构建方式 | 产物里的引用 | 适用 |
|---|---|---|
| 默认（`base: '/'`） | `/assets/worker-xxx.js` | 域名**根目录**（Cloudflare / EdgeOne / Netlify 默认）✅ |
| `LC_BASE=/仓库名/ pnpm build` | `/仓库名/assets/worker-xxx.js` | 子路径（GitHub Pages 项目站）✅ |
| `--base=./` | `./worker-xxx.js`（少了 `assets/`）❌ | 404 → 回退主线程 |

**② Worker 挂了不会白屏**：`runner.ts` 里 `worker.onerror` 之后所有请求自动走主线程。
排查方法：浏览器打开 `/assets/worker-*.js`，不是 200 就说明路径不对。

**③ 缓存**：`/assets/*` 一年强缓存（文件名带内容哈希），`index.html` 每次校验
（Cloudflare 读 `dist/_headers`，EdgeOne 读 `edgeone.json`），所以更新后玩家刷新即得新版。
若平台对 `_headers` 里的中文注释报错，删掉注释行即可（规则本身不依赖注释）。