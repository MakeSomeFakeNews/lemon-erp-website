# 柠檬ERP 官网

柠檬ERP 的官方网站，包含产品介绍、用户手册和开发文档，基于 [VitePress](https://vitepress.dev) 构建。

- 在线访问：https://makesomefakenews.github.io/lemon-erp-website/
- 柠檬ERP 源码：https://github.com/MakeSomeFakeNews/lemon-erp

## 本地预览

```bash
npm install
npm run dev       # http://localhost:5173/lemon-erp-website/
npm run build     # 输出到 docs/.vitepress/dist
```

## 目录

```
docs
├── index.md              首页
├── manual/<章节>/*.md     用户手册（按业务模块分章节）
├── dev/<章节>/*.md        开发文档
└── public/images         截图
```

侧边栏按目录自动生成：章节目录下的 `index.md` 为章节概览，其他页面按 frontmatter 中的 `order` 排序。

推送到 `main` 分支后，GitHub Actions 自动构建并发布到 GitHub Pages。

## 许可证

文档内容基于 [Apache-2.0](https://github.com/MakeSomeFakeNews/lemon-erp/blob/main/LICENSE) 协议发布。
