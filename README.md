# MuMu 模拟器内存监控

一个免安装的 MuMu 模拟器内存实时监控工具(Windows)。解压即用,双击 `start.bat`,浏览器自动打开监控页面,每 1 秒刷新,支持 MuMu 多开实例自动发现。

## 快速开始

1. 下载仓库中的 **mumu-memory-monitor.zip** 并解压
2. 启动 MuMu 模拟器(要监控哪个实例就开哪个,支持多开)
3. 双击解压目录里的 **start.bat**,浏览器自动打开 `http://127.0.0.1:8765`
4. 不用了直接关掉黑色命令行窗口

不需要安装 Node.js、不需要安装 adb —— 运行时和 adb 都在包里(优先使用 MuMu 自带的 adb,避免版本冲突)。

## 功能

- **每 1 秒刷新**:已用/可用内存、缓存 + Buffers、Swap、内存使用率
- **已用内存趋势图**:最近 3 分钟折线图,鼠标悬停查看精确数值,附 1 分钟变化量
- **进程内存排行**:按 PSS(实际物理内存占用)排序的前 10 个进程
- **多实例自动发现**:MuMu 多开时每个实例一个标签页,新开的模拟器约 5 秒后自动出现,各自独立保留历史曲线
- **浅色/深色主题**切换,断连自动重连
- 纯本机运行(127.0.0.1),不联网、不上传任何数据

## 多实例端口规则

MuMu 多开实例的 adb 端口:实例 0 = `16384`,实例 1 = `16416`,实例 2 = `16448`(步长 32),另含旧版端口 `7555`。工具会自动扫描这些端口。

如果你手动改过 MuMu 的 adb 端口,用命令行启动并指定:

```bat
runtime\node.exe server.js PORTS=16384,21503
```

其他可选环境变量:`ADB_PATH`(指定 adb 路径)、`PORT`(网页服务端口,默认 8765,被占用时自动尝试 8766-8775)。

## 常见问题

- **页面显示"无实例在线"**:确认 MuMu 已启动并完全进入系统;旧版 MuMu(6 及以下)不在默认扫描范围内,需按上面的方法指定端口 7555。
- **浏览器没自动打开**:手动访问命令行窗口里显示的地址。
- **杀毒软件报毒**:不会。运行时是 Node.js 官方原版 `node.exe`,adb 是 Google 官方 platform-tools,均为未修改的官方文件。

## 从源码运行(开发者)

```bash
node server.js          # 需要本机已装 Node.js,adb 会自动探测
```

源码就三个文件:

| 文件 | 说明 |
|---|---|
| `server.js` | 后端:adb 自动定位、多实例端口扫描、`/proc/meminfo` + `dumpsys meminfo` 采集、本地 HTTP 服务(零依赖) |
| `index.html` | 前端:监控面板(原生 SVG 图表,无框架无依赖) |
| `start.bat` | 便携版启动入口 |

## 重新构建便携包

1. 下载 [Node.js win-x64 单文件 node.exe](https://nodejs.org/dist/) 放入 `runtime/`
2. 下载 [Google platform-tools](https://developer.android.com/tools/releases/platform-tools) 把 `adb.exe`、`AdbWinApi.dll`、`AdbWinUsbApi.dll` 放入 `adb/`
3. 压缩 `adb/`、`runtime/`、`index.html`、`README.txt`、`server.js`、`start.bat` 为 zip(建议用 `tar -a -cf xxx.zip ...`,保持正斜杠路径分隔)
