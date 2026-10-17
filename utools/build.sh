#!/bin/sh
set -eu

PLUGIN_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT_DIR=$(dirname -- "$PLUGIN_DIR")
cd "$ROOT_DIR"

command -v node >/dev/null || { echo "error: Node.js is required" >&2; exit 1; }
command -v pnpm >/dev/null || { echo "error: pnpm is required (corepack enable)" >&2; exit 1; }
# Node 的下限只写在 package.json#engines.node 一处，这里读它来卡。脚本里再抄一个数字，
# 两边迟早对不上 —— 原来这儿写的是 20，而测试用的 jsdom 30 自己要求 22.22.2+，在 Node 20
# 上过了这道门，后面所有 jsdom 环境的测试文件一加载就炸。
node -e '
const want = (require("./package.json").engines || {}).node || "";
const match = /^>=\s*(\d+)\.(\d+)\.(\d+)$/.exec(want.trim());
if (!match) {
  console.error(`error: package.json#engines.node 是「${want}」，本脚本只认 >=x.y.z 这种写法`);
  process.exit(2);
}
const need = match.slice(1).map(Number);
const have = process.versions.node.split(".").map(Number);
const diff = need.map((n, i) => have[i] - n).find((d) => d !== 0) || 0;
if (diff < 0) {
  console.error(`error: Node ${want} is required, found ${process.versions.node}`);
  process.exit(1);
}
'

pnpm install --frozen-lockfile

# CI 把 lint / typecheck / test 拆成了独立步骤（哪一步红的一眼就能看出来），
# 再在这里跑一遍就是白等一倍时间。本地直接 ./build.sh 时默认全跑：
# 一条命令就该把该查的都查完。
if [ "${SKIP_CHECKS:-0}" = "1" ]; then
  echo "SKIP_CHECKS=1: 跳过 lint / typecheck / test"
else
  pnpm lint
  pnpm typecheck
  pnpm test
fi

for file in "$PLUGIN_DIR"/*.js; do node --check "$file"; done
node -e "JSON.parse(require('fs').readFileSync('$PLUGIN_DIR/plugin.json', 'utf8'))"

# preload 旁边的模块（webdav.js）是运行时 require 进来的，Vite 不会打包它。
# 漏出 upx 的话插件装上去就是「preload 加载失败」，而本地跑 dev 完全看不出来，
# 所以这里按 preload 里的 require 反查两个工作流的文件清单。
node -e '
const fs = require("fs")
const path = require("path")
const [preloadPath, ...workflowPaths] = process.argv.slice(1)
const preload = fs.readFileSync(preloadPath, "utf8")
const required = [...preload.matchAll(/require\(.\.\/([\w.-]+).\)/g)].map(match => match[1])
const fail = message => { console.error(`error: ${message}`); process.exitCode = 1 }
for (const file of required) {
  if (!fs.existsSync(path.join(path.dirname(preloadPath), file))) fail(`preload.js require 了不存在的 ${file}`)
  // ci.yml 写的是 utools/webdav.js，release.yml 写的是 webdav.js，两种都要认。
  const pattern = new RegExp(`(^|[\\s/])${file.replace(/\./g, "\\.")}(\\s|$)`, "m")
  for (const workflowPath of workflowPaths) {
    if (!pattern.test(fs.readFileSync(workflowPath, "utf8"))) fail(`${path.basename(workflowPath)} 的文件清单里没有 ${file}`)
  }
}
' "$PLUGIN_DIR/preload.js" .github/workflows/release.yml .github/workflows/ci.yml

# 版本号散在三个地方，发版时漏改一个就会出现「商店显示 1.0.0、更新日志写着 1.1.0」。
# 面板高度同理：plugin.json 给的是初始高度，代码里 setExpandHeight 用的是另一份常量，
# 两边不一致的话插件一进来就会自己跳一下高度。
node -e '
const fs = require("fs")
const read = file => fs.readFileSync(file, "utf8")
const plugin = JSON.parse(read(process.argv[1]))
const pkg = JSON.parse(read(process.argv[2]))
const changelog = read(process.argv[3])
const panel = read(process.argv[4]).match(/^const PANEL_HEIGHT = (\d+)$/m)
const fail = message => { console.error(`error: ${message}`); process.exitCode = 1 }
if (plugin.version !== pkg.version) fail(`版本不一致: plugin.json ${plugin.version} vs package.json ${pkg.version}`)
if (!changelog.includes(`\n## ${pkg.version}\n`)) fail(`CHANGELOG.md 里没有 ${pkg.version} 这一节`)
if (!panel) fail("useFunOtp.ts 里找不到 PANEL_HEIGHT")
else if (Number(panel[1]) !== plugin.pluginSetting?.height) {
  fail(`面板高度不一致: plugin.json ${plugin.pluginSetting?.height} vs PANEL_HEIGHT ${panel[1]}`)
}
' "$PLUGIN_DIR/plugin.json" package.json CHANGELOG.md src/composables/useFunOtp.ts
rm -rf -- "$PLUGIN_DIR/dist"
pnpm build

test -f "$PLUGIN_DIR/dist/index.html"
test -f "$PLUGIN_DIR/preload.js"
test -f "$PLUGIN_DIR/webdav.js"
test -f "$PLUGIN_DIR/logo.png"
test -f "$PLUGIN_DIR/search.png"
test ! -e "$PLUGIN_DIR/.git" || { echo "error: utools/ 内不应存在 .git" >&2; exit 1; }

echo "uTools plugin ready: $PLUGIN_DIR/plugin.json"
