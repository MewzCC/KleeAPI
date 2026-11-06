# 可莉的软乎乎秘密基地

本主题位于 `feat/klee-adventure-theme` 分支，适配 Vue 门户、统一网关及 WorkBuddy、Trae、Qoder 工作空间。

- 默认保留原深色界面。右上角「开启可莉主题」随时切换，关闭后恢复原样。
- 浏览器保存 `klee.theme` 外观偏好；同一来源的标签页自动同步，通过门户或侧栏进入其他平台时通过 fragment 延续选择。页面初始化会清除 fragment。
- 粉色手账包含二创毛绒玩偶、手绘动态贴纸、蝴蝶结、四叶草与爱心点缀；空状态也使用玩偶展示。
- 动态贴纸使用 SVG 与 CSS 实现 GIF 类的眨眼、摇摆、呼吸和漂浮，不播放声音。旅行便笺中的「暂停装饰动效」会暂停装饰动画；系统减少动态效果设置同样生效。
- 未开启主题时不渲染装饰组件、不加载角色图片。所有素材随项目本地打包，账号、额度、签到与聊天接口不受主题开关影响。
- 使用命令仍为 `npm run build`、`npm start`。正式服务未启动时，无需为了查看或构建主题初始化账号存储。

## 素材

二创玩偶文件为 `frontend/src/assets/klee/klee-plush.png`。使用内置 `image_gen` 工具生成，透明背景，保留生成结果的透明通道；没有使用外部素材脚本或新的运行时依赖。其他素材来源及角色权利见 [NOTICE](NOTICE.md)。

完整生成提示词：

> Use case: stylized-concept. Asset type: transparent PNG decorative cutout for a cute Klee fan art local web dashboard, NOT a screenshot or UI mockup. Create a premium adorable chibi plush Klee doll from Genshin Impact, seated, with her tiny fluffy Dodoco rabbit plush nestled alongside her, both together as ONE compact silhouette. Klee has a very oversized soft round head, big sparkling ruby embroidered eyes, tiny happy mouth, rosy cheeks, blonde little pigtails, pointed elf ears, red clover beret with cream trim and little feather, red coat with creamy scalloped details, stubby plush arms and legs. She holds a pastel pink heart cushion embroidered with a small cream four-leaf clover. Dodoco is a small round warm cream bunny with floppy brown ears, simple friendly face and red bow. Materials: visibly fuzzy mohair and plush fleece, stitched seams, soft felt accessories. Style: extremely cute collectible handmade plush toy rendered in a gentle 3D toy photography style, feminine sweet pastel pink/cream/strawberry red palette, soft diffuse light, no hard shadow. A few tiny felt pink hearts and cream clover puffs closely frame the duo. Front three-quarter view, both dolls fully visible centered, generous transparent margin, isolated on actual transparent background. No room or ground plane, no text, no labels, no logo, no watermark. This is nonofficial fan art, playful wholesome toy styling, no realism of humans.
