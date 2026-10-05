# 部署（把《逐层电路》放到网上）

游戏是**纯静态前端**：没有后端、没有数据库、没有环境变量，进度存在玩家浏览器的
`localStorage` 里。构建产物就是两个文件，任何静态托管都能跑。

```
apps/studio/dist/index.html              645 KB（gzip 198 KB，JS/CSS/图形全内联）
apps/studio/dist/assets/worker-*.js      141 KB（仿真 Worker）
```

## 0. 先在本机验证一遍（30 秒）

```bash
pnpm install --frozen-lockfile   # 与 CI 相同的安装方式
pnpm build                       # 产出 apps/studio/dist
pnpm preview                     # http://localhost:4173 打开看看
```

三条都过了，说明云端构建也会过。**注意 `--frozen-lockfile`**：EdgeOne 等平台的
CI 环境下 `pnpm install` 默认就是冻结语义，锁文件跟 `package.json` 不同步会直接
构建失败（本仓库曾经因为 `tools/*` 没进锁文件而失败，已修）。

## 1. 腾讯云 EdgeOne Pages

### ⚠️ 先看这条，再决定加速区域

官方对**项目域名 / 部署域名**的访问规则（[域名管理文档](https://edgeone.cloud.tencent.com/pages/document/175191784523485184)）：

| 加速区域 | 中国大陆访问项目域名 | 绑定自定义域名 |
|---|---|---|
| 中国大陆可用区 | 只能用系统预览链接，**3 小时有效**，过期 401 | **需工信部备案** |
| 全球可用区（含中国大陆） | 同上（预览链接 3 小时） | **需工信部备案** |
| 全球可用区（不含中国大陆） | **返回 401** | 不要求备案 |

也就是说：**没有备案域名时，EdgeOne 免费版的项目域名在中国大陆拿不到稳定的公开地址。**
想用它给国内的朋友玩，实际门槛是「有个域名 + 完成备案」（备案本身免费，但要时间）。
如果暂时不走备案，建议先看第 2 节的 Cloudflare Pages。

### 部署步骤

1. 控制台 → Pages → 新建项目，二选一：
   - **导入 Git 仓库**（推荐）：把仓库推到 GitHub/Gitee → 导入 → 之后 push 即自动部署
   - **直接上传**：本机 `pnpm build`，把 `apps/studio/dist` 整个文件夹传上去
     （这种方式不走云端构建，下面的构建配置可以不管）
2. 若用「导入 Git 仓库」，构建配置**已在仓库里写好**（`edgeone.json`），控制台会自动读：

   | 设置项 | 值 |
   |---|---|
   | 根目录 | `./` |
   | 安装命令 | `pnpm install --frozen-lockfile` |
   | 构建命令 | `pnpm build` |
   | 输出目录 | `apps/studio/dist` |
   | Node 版本 | `20.18.0`（平台预装版本之一） |

   > 不要放 `.nvmrc`：平台会按它切 Node 版本，但**不会**跟着提供对应的 pnpm。
3. 部署完成后访问项目域名。给国内朋友玩需要按上面的表格处理加速区域与备案。

## 2. Cloudflare Pages（不备案也能用，备用方案）

免费额度最宽（无限带宽、500 次构建/月），国内一般能直连（速度看网络）：

```bash
pnpm build
npx wrangler pages deploy apps/studio/dist --project-name layered-circuits
```

或在控制台连 Git 仓库：构建命令 `pnpm build`，输出目录 `apps/studio/dist`，
Node 版本选 20。

## 3. 零成本的临时玩法（不需要任何账号）

直接双击 `apps/studio/dist/index.html` 就能玩 —— 产物是自包含的，可以微信/网盘直接发人。
这时 Worker 加载不了，仿真会**自动回退主线程**（代码里本来就有这个兜底），
缺点是判定大电路时页面会顿一下（参考解判定最慢约 2.2 秒，玩家手搭的电路远快于此）。

## 4. 两个部署后会踩到的点

**① Worker 的资源路径是构建时写死的**

| 构建方式 | 产物里的引用 | 适用 |
|---|---|---|
| 默认（`base: '/'`） | `/assets/worker-xxx.js` | 域名**根目录**（EdgeOne / Cloudflare / Netlify 默认）✅ |
| `LC_BASE=/仓库名/ pnpm build` | `/仓库名/assets/worker-xxx.js` | 子路径（GitHub Pages 项目站）✅ |
| `--base=./` | `./worker-xxx.js`（少了 `assets/`）❌ | 404 → 回退主线程 |

**② Worker 挂了不会白屏**：`runner.ts` 里 `worker.onerror` 之后所有请求自动走主线程。
排查方法：浏览器打开 `/assets/worker-*.js`，不是 200 就说明路径不对。

**③ 缓存**：`edgeone.json` 已经把 `/assets/*` 设成一年强缓存（文件名带内容哈希），
`index.html` 设为每次校验，所以更新后玩家刷新即可拿到新版。