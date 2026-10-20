# 技术参考与来源

现有项目文档记录了以下源码研究参考。这里保留项目、固定 revision 及所参考的设计主题；这份清单不是逐行来源审计，也不构成独立实现或法律净室认证。

| 项目 | 固定 revision | 记录的参考主题 |
| --- | --- | --- |
| [Kanboard](https://github.com/kanboard/kanboard) | `ec3398d0d2b31d5051e2a077f475e286b5dd1228` | 整数事务排序 |
| [Planka](https://github.com/plankanban/planka) | `627701dda3459fa25830b0fd5bb2f5668d033284` | 对象归属追溯 |
| [Trakkt](https://github.com/kyomi-ai/trakkt) | `9efb657cf4dc1b7708c99d597522463900302125` | 草稿所有权 |
| [It's a Plan](https://github.com/croffasia/itsaplan) | `9cf575e8b4cd7cb4f892c23b15c073fe402cf18c` | 权限和 revision 的设计取舍 |

运行与开发依赖的准确版本由 `Cargo.lock` 和 `frontend/package-lock.json` 记录，包括 Rust、Axum、SQLx、SQLite、Svelte、Vite、PDF.js 及各自传递依赖。它们各自的许可证和归属继续适用；这里不以项目许可替代第三方许可。PDF.js 通过 `pdfjs-dist` 提供受限 PDF 预览。

参见 [NOTICE](NOTICE)。
