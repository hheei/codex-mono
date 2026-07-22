---
name: vasp-helper
description: 面向 VASP 的实用工作流支持：INCAR 调参、OUTCAR/OSZICAR 诊断、vaspwave.h5 提取、重启文件复用检查、Bader 与平面平均、CHGCAR 对比、运行目录整理、VASPKIT 指导及源码实现映射。
---
# vasp-helper

最小必要上下文。

- 安装/helper 问题先读 `README.md`；含 `scripts/vasp_helper_cli.py` 子命令及保留直接入口。
- 本文件为 skill 唯一路由入口。
- 通用知识在 `references/`，项目覆盖在 `projects/`，窄范围 INCAR 标签查缓存 wiki。
- 仅需源码时用 Graphify；勿大量打开 `source/src/*` 原始文件。
- 远程运行目录：小型输入先暂存 `/tmp/vasp-helper/` 再分析。

## 路由顺序

1. 判定请求类别。
2. 仅打开对应一个 `references/` 页面。
3. 标签级追问再查缓存 wiki。
4. 实现细节：先用页面 Implementation Anchors 与 Graphify 缩小源码范围。
5. 涉及本地项目、主机环境或源码分支，再开对应 `projects/` 说明。
6. 远程输入：先复制小型文本至本地暂存，再运行 helper。

## 分类映射

- 收敛、停止条件、结构优化健康度：`references/electronic-convergence.md`
- 重启复用、`LH5`、`WAVECAR`、`CHGCAR`、`vaspwave.h5`：`references/restart-hdf5.md`
- 密度后处理、Bader、平面平均、网格差异：`references/density-postprocess.md`
- 运行环境、helper 二进制、绘图约束：`references/platform-runtime.md`
- 运行目录清理、暂存、本地卫生：`references/run-hygiene.md`
- 对称性、k 点、结构检查：`references/structure-symmetry-kpoints.md`
- 源码导航、实现问题：`references/source-navigation.md`

## 源码与路径

- Codex 经插件清单 `"skills": "./skills/"` 发现本 skill；本目录含 `SKILL.md`。
- `references/`、`projects/`、`scripts/`、`source/` 均相对 skill 根目录，非仓库根目录。
- 默认插件修改分支图：`source/graphify-out/6.6.0X/graph.json`。
- 原始基线分支图：`source/graphify-out/6.6.0/graph.json`。
- Graphify 查询在 skill 根目录运行：
  `graphify query "<问题>" --graph source/graphify-out/<分支>/graph.json`
- 关系路径用 `graphify path`，节点邻域用 `graphify explain`；均传对应分支 `--graph`。
- 图仅含源码；两分支独立生成；无需 HTML。

## 防护规则

- `scripts/outcar_analysis_cli.py` 仅用 Python 标准库；不做 ASE 成键/分子启发式判断。
- 快速查看 helper：`python3 scripts/vasp_helper_cli.py --help`；保留既有窄依赖入口。
- 远程目录优先复制 `OUTCAR`、`OSZICAR`、`INCAR`、`POSCAR`、`CONTCAR`、`KPOINTS`、`POTCAR` 至 `/tmp/vasp-helper/<host>/<job-key>/`。
- 仅传输不可用、文件过大或用户明确要求原地执行时，直接检查远程目录。
- 默认保留精度敏感设置；用户未明确要求，不改 `ENCUT`、`PREC`、`EDIFF`、`EDIFFG`、`KPOINTS`、`KSPACING`、`LREAL`、`ALGO`、`ISMEAR`、`SIGMA`、`LASPH`、`METAGGA`、`IVDW` 或重启/输出标签。
- 复用重启文件前，检查晶格、k 点网格、带数、自旋状态、cutoff 兼容性。