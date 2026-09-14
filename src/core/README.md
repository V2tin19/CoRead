# src/core/ 核心架构分层与依赖规范

本项目在重构中引入清晰的四层架构，旨在解耦应用业务逻辑与底层实现（如渲染引擎 `kookit`、本地存储 `localforage`/IndexedDB、网络传输等）。

## 1. 目录结构

```
src/core/
├── domain/        纯数据模型与纯函数（Book, Note, Bookmark, Location, ReaderMode 等）
├── ports/         接口定义契约（IRenderService, IConfigStore, INoteStore, ICollabService 等）
├── usecases/      业务用例编排（跨端口的数据流与业务流程编排）
└── adapters/      具体适配器实现
    ├── render/    渲染适配器（kookitLoader, kookitRenderAdapter, pdfjsSetup 等）
    ├── store/     存储适配器（IndexedDB / localforage 适配）
    └── collab/    共读网络适配器
```

## 2. 依赖方向硬性规则

```
UI (pages / containers / components)
      ↓ 只能向下依赖
usecases (业务流程编排)
      ↓
domain (纯数据模型与纯函数，零外部依赖)
      ↑ 依赖倒置
ports (接口定义：IRenderService / IConfigStore ...)
      ↑ 实现
adapters (kookit 适配器 / IndexedDB 适配器 / 共读适配器 ...)
```

1. **`domain/` 层零依赖**：
   - 严禁 import React、Redux、kookit、localforage、DOM 等特定运行库。
   - 只包含纯数据模型、业务校验与纯计算逻辑。
2. **UI 层不直接依赖底层实现**：
   - UI 层不许直接 import `kookit`、`indexedDB`、`WebSocket` 等。
   - 必须通过 `ports` 声明的接口与 `usecases` 进行交互。
3. **内核专属概念不得越界上行**：
   - `kookit` 内部专有概念（如 `rendition`、`tempLocation` 原始结构、内部私有 DOM 节点）必须在 `adapters/render` 内部翻译为本项目的 domain/port 类型，严禁暴露给上层。
4. **适配器隔离**：
   - 当未来更换底层引擎或存储后端时，只需实现新的 Adapter，`domain` 与 `UI` 层零改动。
