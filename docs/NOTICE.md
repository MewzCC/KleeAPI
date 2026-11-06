# 技术参考与运行时许可

KleeAPI 当前实现围绕平台现有接口重新编写，后端、平台适配器与共享管理页独立组织，未依赖旧仓库模块。

兼容方法参考：

- WorkBuddy：[Ianzhyh/workbuddy-to-dsh](https://github.com/Ianzhyh/workbuddy-to-dsh)，包括登录、模型、计费接口及桌面凭据格式。
- Trae：[connectedGraph/trae2api-web](https://github.com/connectedGraph/trae2api-web)，包括账号回调、SOLO 请求及事件格式。
- Qoder：设备授权、COSY 编码、额度与活动兼容协议来源及许可见 [Qoder 适配说明](../klee-api/Klee-qoder-web/NOTICE.md)。

平台参考实现的 MIT 许可和来源说明保留在对应适配器目录。本项目为独立 Vue 改造版，Git 从新的初始提交开始，不包含旧仓库历史。
便携运行时 Node.js 的许可证位于项目根目录下的 `runtime/Node-LICENSE.txt`。

前端使用 Vue、Vite、TypeScript 和 Element Plus；依赖版本固定在 frontend/package-lock.json，对应许可证保留在各 npm 包中。

## 可莉主题素材

网站采用非官方可莉同人主题；可莉、嘟嘟可及原神相关角色素材的权利归 HoYoverse 所有，不属于本项目 MIT 许可的授权范围。

- `frontend/src/assets/klee/klee-splash.png`：可莉角色展示图，来源 [Enka.Network](https://enka.network/ui/UI_Gacha_AvatarImg_Klee.png)。
- `frontend/src/assets/klee/klee-avatar.png`：可莉头像，来源 [Enka.Network](https://enka.network/ui/UI_AvatarIcon_Klee.png)。
- 两枚四叶草 SVG 沿用原项目绘制的主题装饰。
- `frontend/src/assets/klee/klee-plush.png`：使用内置图像生成工具制作的可莉与嘟嘟可毛绒玩偶二创，非官方周边商品图；角色权利仍归原权利人所有。提示词见 [主题说明](KLEE-THEME.md)。
- `frontend/src/components/KleeSticker.vue`：本项目手绘的嘟嘟可、爱心信封与四叶草饼干 SVG 贴纸，使用 CSS 实现眨眼、轻摆与漂浮。

原角色素材从原项目 `feat/klee-adventure-theme` 分支复制，新增二创素材与其一起本地打包；浏览页面不向素材站发起图片请求，未开启主题时不加载角色图片。主题不加载音频、视频、第三方脚本或字体；旅行便笺支持收起、Esc 关闭与暂停装饰动效，并遵循系统减少动态效果偏好。
