# 第三方依赖与许可证说明

版本以 `pnpm-lock.yaml` 为准。下表列出 `package.json` 的直接依赖。

## 运行依赖

| 包 | 版本 | 许可证 | 用途 |
| --- | --- | --- | --- |
| `@base-ui/react` | 1.7.0 | MIT | 无样式交互原语 |
| `@zip.js/zip.js` | 2.9.0 | BSD-3-Clause | 浏览器本地 ZIP |
| `class-variance-authority` | 0.7.1 | Apache-2.0 | 组件变体 |
| `clsx` | 2.1.1 | MIT | 类名组合 |
| `lucide-react` | 1.31.0 | ISC | 图标 |
| `react` | 19.2.8 | MIT | 界面运行时 |
| `react-dom` | 19.2.8 | MIT | DOM 渲染 |
| `react-server-dom-webpack` | 19.2.8 | MIT | vinext / React 构建运行时 |
| `tailwind-merge` | 3.6.0 | MIT | Tailwind 类名合并 |
| `tw-animate-css` | 1.4.0 | MIT | 界面动效工具类 |
| `vinext` | 1.0.0-beta.9 | MIT | Next 兼容静态构建 |

## 开发与构建依赖

| 包 | 版本 | 许可证 |
| --- | --- | --- |
| `@tailwindcss/postcss` | 4.2.1 | MIT |
| `@types/node` | 22.19.19 | MIT |
| `@types/react` | 19.2.14 | MIT |
| `@types/react-dom` | 19.2.3 | MIT |
| `@vitejs/plugin-react` | 6.0.2 | MIT |
| `@vitejs/plugin-rsc` | 0.5.34 | MIT |
| `oxfmt` | 0.61.0 | MIT |
| `oxlint` | 1.82.0 | MIT |
| `oxlint-tsgolint` | 7.0.2001 | MIT |
| `tailwindcss` | 4.2.1 | MIT |
| `typescript` | 5.9.3 | Apache-2.0 |
| `vite` | 8.2.2 | MIT |

实际进入静态成品的包及完整许可证见 [THIRD_PARTY_LICENSES.txt](./dist/client/THIRD_PARTY_LICENSES.txt)，由构建过程按打包模块生成。开发依赖的完整许可证随其 npm 分发包提供。`@vitejs/plugin-rsc` 的 npm 包未附许可证文本，构建使用 [licenses/vite-plugin-rsc.txt](./licenses/vite-plugin-rsc.txt)，来源为其 [Vite 上游许可证](https://github.com/vitejs/vite-plugin-react/blob/main/LICENSE)。以下按 BSD-3-Clause 要求复现 zip.js 许可证。

## zip.js BSD 3-Clause License

Copyright (c) 2023, Gildas Lormeau

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS “AS IS” AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
