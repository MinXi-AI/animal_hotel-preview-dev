# 灯火小旅店开发服

此仓库只保存《灯火小旅店》通过开发质量门的编译后静态产物，不包含私有源码仓库的源文件、提交历史、私有 Source Map 或凭据。

- 在线入口：<https://minxi-ai.github.io/animal_hotel-preview-dev/>
- 发布分支：`main`
- 部署基路径：`/animal_hotel-preview-dev/`
- 当前对应私有源码：`2eeb69e99e9da8087f39fae8bab9cd5b78a3a241`
- 用途：让用户尽早体验尚未晋级正式服的开发候选

开发服可能领先正式服，不代表任务完成、里程碑验收或正式发行。正式服入口为 <https://minxi-ai.github.io/animal_hotel-preview/>。

游戏存档只保存在访问者浏览器本机的 IndexedDB 中，不会提交到此仓库。开发服使用独立的 `lantern-inn-p0a-dev` 业务库，不读写正式服存档。哈希命名的构建资源应由构建流程整体替换，不应直接编辑。

私有源码和 Source Map 只在本地／私有边界验证。此公开仓库只对
`deployment-manifest.json` 锁定的编译产物复算 SHA-256、检查公开边界与
开发服身份；校验成功后才部署 GitHub Pages。
