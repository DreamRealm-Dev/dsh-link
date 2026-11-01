/**
 * Build the two installable folders from the single source tree.
 *
 * Both targets ship byte-identical code and the same package name: the only
 * difference between "install on macOS 0.2.0 with 从文件夹导入" and "install on
 * Windows 0.1.5 as a profile bundle" is the installation procedure, not the
 * plugin. That is deliberate — it is what makes a future same-version setup a
 * pure install-procedure change with no code fork.
 *
 * usage: node tools/build-dist.mjs
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'dist')

/** Files that make up the shipped package, in copy order. */
const INCLUDE_FILES = ['package.json', 'cordis.patch.yml', 'README.md']
const INCLUDE_DIRS = ['lib', 'docs']

const TARGETS = [
  {
    dir: 'dsh-lan-bridge-0.2.0',
    readme: '安装说明-0.2.0-macOS.md',
    note: [
      '# dsh-lan-bridge — DSH 0.2.0 安装包',
      '',
      '这个文件夹就是要在 DSH 0.2.0 里安装的插件包（macOS 与 Windows 的 0.2.0 都适用）。',
      '',
      '安装步骤：见本包 `docs/INSTALL-zh.md` 第 1 节（0.2.0「从文件夹导入」的完整步骤）。',
      '',
      '- 包名：`dsh-lan-bridge`',
      '- 零运行时依赖（只用 Node 内置模块），不需要联网、不需要构建',
      '- 主机侧与浏览器侧代码都在 `lib/` 下',
      '',
      '> **升级后要做一次的事**：身份现在是持久化的，但旧安装没存过身份，所以装好后本机身份会回到默认的 **Agent 侧**。',
      '> 作为被操作的那台（Mac），请在侧边栏「连接」里选一次 **桥接侧**——之后就会记住。',
      '> 如果没选，对方会看到这台机器被置灰并写明「Agent 侧 · 未开启配对窗口」，不会出现莫名的连接超时。',
      '',
      '> 注意：安装后需要**重启 DSH**（不是刷新页面）才能加载新的主机侧代码；',
      '> 装机后新挂载的浏览器侧界面在页面重新加载后出现。',
      '',
    ].join('\n'),
  },
  {
    dir: 'dsh-lan-bridge-0.1.5',
    readme: '安装说明-0.1.5-Windows.md',
    note: [
      '# dsh-lan-bridge — DSH 0.1.5 配套包',
      '',
      '这个文件夹是给 DSH 0.1.5（社区版）用的同一份插件代码包。',
      '',
      '安装步骤：见本包 `docs/INSTALL-zh.md` 第 2 节（0.1.5 的 profile 安装方式）。',
      '',
      '- 包名：`dsh-lan-bridge`（两端必须同名，协议与身份模型完全对称）',
      '- 零运行时依赖，不需要联网、不需要构建',
      '- 0.1.5 没有「从文件夹导入插件」界面，因此用 profile 依赖 + pnpm 的方式安装',
      '- 身份只有 Agent 侧 / 桥接侧两种（原来的「双侧」已取消：任何身份都能同时连出多个设备、也能同时被多个设备连入）',
      '- 身份与「可被发现」会持久化到 `$DSH_HOME/lan-bridge/prefs.json`，重启后保持',
      '',
    ].join('\n'),
  },
]

function copyRecursive(from, to) {
  const stat = fs.statSync(from)
  if (stat.isDirectory()) {
    fs.mkdirSync(to, { recursive: true })
    for (const entry of fs.readdirSync(from)) {
      if (entry === 'node_modules' || entry === '.git') continue
      copyRecursive(path.join(from, entry), path.join(to, entry))
    }
    return
  }
  fs.mkdirSync(path.dirname(to), { recursive: true })
  fs.copyFileSync(from, to)
}

fs.mkdirSync(dist, { recursive: true })
const digests = []
for (const target of TARGETS) {
  const outDir = path.join(dist, target.dir)
  fs.rmSync(outDir, { recursive: true, force: true })
  fs.mkdirSync(outDir, { recursive: true })
  for (const file of INCLUDE_FILES) {
    const from = path.join(root, file)
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(outDir, file))
  }
  for (const dir of INCLUDE_DIRS) {
    const from = path.join(root, dir)
    if (fs.existsSync(from)) copyRecursive(from, path.join(outDir, dir))
  }
  fs.writeFileSync(path.join(outDir, target.readme), `${target.note}\n`, 'utf8')
  let files = 0
  let bytes = 0
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else {
        files += 1
        bytes += fs.statSync(full).size
      }
    }
  }
  walk(outDir)
  digests.push({ dir: target.dir, files, bytes })
  console.log(`built dist/${target.dir} — ${files} files, ${(bytes / 1024).toFixed(1)} KiB`)
}

// Prove the two targets carry the same plugin (same file set, same sizes).
const [a, b] = TARGETS.map((t) => path.join(dist, t.dir))
const listOf = (dir) => {
  const out = []
  const walk = (base) => {
    for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
      const full = path.join(base, entry.name)
      const rel = path.relative(dir, full).replaceAll('\\', '/')
      if (entry.isDirectory()) walk(full)
      else out.push(`${rel}:${fs.statSync(full).size}`)
    }
  }
  walk(dir)
  return out.filter((line) => !line.includes('安装说明')).sort()
}
const listA = listOf(a)
const listB = listOf(b)
const identical = listA.length === listB.length && listA.every((line, index) => line === listB[index])
console.log(identical ? 'OK   both targets ship an identical plugin file set' : 'FAIL targets differ')
if (!identical) {
  console.log('A only:', listA.filter((x) => !listB.includes(x)).join(', '))
  console.log('B only:', listB.filter((x) => !listA.includes(x)).join(', '))
  process.exitCode = 1
}

// Guard the packaging invariant that silently breaks the browser half: the
// bundle row must mount the bare package name, because dsh-client-modules
// mounts a package's browser half only on a row whose specifier has no "/".
const patch = fs.readFileSync(path.join(root, 'cordis.patch.yml'), 'utf8')
const nameLine = /^\s*name:\s*(\S+)\s*$/m.exec(patch)
if (nameLine === null) {
  console.log('FAIL cordis.patch.yml declares no row name')
  process.exitCode = 1
} else if (nameLine[1] !== 'dsh-lan-bridge') {
  console.log(`FAIL the row name must be the bare package name, found ${nameLine[1]}`)
  process.exitCode = 1
} else {
  console.log('OK   the bundle row mounts the bare package name (browser half will load)')
}

