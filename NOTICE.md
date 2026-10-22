# NOTICE · 第三方开源署名

## xPoster

MarkFlow 的注入引擎(`entrypoints/injector.ts`)中以下机制参考了开源项目 **xPoster**(MIT 许可)的实现思路,
分析过程见 [`docs/research/xposter-analysis.md`](./docs/research/xposter-analysis.md):

- **fiber 探针**:编辑器 DOM 定位、沿 fiber 查找 Draft 实例与上传回调的算法及层数/尺寸阈值;
- **Draft.js 直写**:在 MAIN world 经 React fiber 定位 X 文章编辑器的 Draft.js 组件实例,借页面自带的
  Immutable / Draft 构造器构造 blockMap,再通过组件的 `props.onChange(EditorState.push(…))` 写入正文;
- **图片上传**:从 fiber 上取得 X 编辑器自身的 `onFilesAdded` 上传回调,把 `File` 交给 X 原生上传管线,
  并以「marker 占位 → 上传 → 轮询新增 MEDIA entity → 归位」的事务把图片放回原位置。

依 MIT 许可的署名要求,附上原项目的版权声明与许可文本。

- 原项目:xPoster <!-- 原作者/仓库 URL -->
- 参考版本:v1.42.70

```
MIT License

Copyright (c) <!-- 年份 原作者 -->

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
