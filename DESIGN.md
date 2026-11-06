---
name: Pluck
description: 管理 Claude Code CLI 用户级配置的 Windows 桌面工具
colors:
  primary: "#3866cc"
  primary-hover: "#2c54b5"
  primary-tint: "#eaf0fd"
  text: "#243046"
  secondary: "#5f6c80"
  line: "#e3e8ef"
  field-border: "#d8e0eb"
  surface: "#ffffff"
  canvas: "#f7f9fc"
  hover: "#f0f4f9"
  success: "#226e56"
  success-bg: "#ecf7f2"
  error: "#aa414a"
  error-bg: "#fff2f2"
  warning: "#80591c"
  warning-bg: "#fff8e8"
typography:
  headline:
    fontFamily: "Segoe UI Variable Text, Segoe UI, Microsoft YaHei UI, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.4px"
  title:
    fontFamily: "Segoe UI Variable Text, Segoe UI, Microsoft YaHei UI, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.5
  title-sm:
    fontFamily: "Segoe UI Variable Text, Segoe UI, Microsoft YaHei UI, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.5
  body:
    fontFamily: "Segoe UI Variable Text, Segoe UI, Microsoft YaHei UI, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Segoe UI Variable Text, Segoe UI, Microsoft YaHei UI, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.5
  caption:
    fontFamily: "Segoe UI Variable Text, Segoe UI, Microsoft YaHei UI, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
  mono:
    fontFamily: "Cascadia Code, Consolas, monospace"
    fontSize: "12px"
    fontWeight: 400
rounded:
  sm: "4px"
  md: "8px"
spacing:
  xxs: "4px"
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-primary-disabled:
    backgroundColor: "{colors.hover}"
    textColor: "{colors.secondary}"
  button-default:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
    height: "36px"
  button-default-hover:
    backgroundColor: "{colors.hover}"
  button-quiet:
    textColor: "{colors.secondary}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
    height: "36px"
  button-link:
    textColor: "{colors.primary}"
    typography: "{typography.caption}"
    padding: "0"
  segmented:
    backgroundColor: "{colors.hover}"
    rounded: "{rounded.md}"
    padding: "4px"
  segmented-option:
    textColor: "{colors.secondary}"
    typography: "{typography.caption}"
    rounded: "{rounded.sm}"
    padding: "4px 12px"
    height: "28px"
  segmented-option-active:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.label}"
  field-select:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.caption}"
    rounded: "{rounded.md}"
    padding: "8px"
    height: "36px"
  search-field:
    textColor: "{colors.text}"
    typography: "{typography.caption}"
    rounded: "{rounded.md}"
    padding: "8px"
  view-switch:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.secondary}"
    typography: "{typography.caption}"
    rounded: "{rounded.md}"
    padding: "3px"
  view-switch-active:
    backgroundColor: "{colors.primary-tint}"
    textColor: "{colors.primary}"
    typography: "{typography.label}"
  model-row:
    textColor: "{colors.text}"
    typography: "{typography.body}"
    padding: "8px"
    height: "40px"
  model-row-hover:
    backgroundColor: "{colors.canvas}"
  tag:
    backgroundColor: "{colors.hover}"
    textColor: "{colors.secondary}"
    typography: "{typography.caption}"
    rounded: "{rounded.sm}"
    padding: "1px 6px"
  tag-missing:
    backgroundColor: "{colors.warning-bg}"
    textColor: "{colors.warning}"
  notice-success:
    backgroundColor: "{colors.success-bg}"
    textColor: "{colors.success}"
    typography: "{typography.caption}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  notice-error:
    backgroundColor: "{colors.error-bg}"
    textColor: "{colors.error}"
  notice-warning:
    backgroundColor: "{colors.warning-bg}"
    textColor: "{colors.warning}"
  dialog:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "32px"
    width: "464px"
---

# Design System: Pluck

## Overview

**Creative North Star: "安静的配置台"**

Pluck 是一张白底的配置台：一个主页面、一个设置页、两类弹窗，所有东西都摊在桌面上，用细线分区，不用卡片和阴影堆层次。界面几乎全是中性的蓝灰色，只有需要用户注意或操作的地方才出现颜色：蓝色指向可以按的东西和已选中的项，绿色说明“当前生效”，橙色提醒“还没保存”，红色只给错误。信息密度偏高但不拥挤，正文 14px，控件和辅助信息统一收在 12px，靠字重而不是字号区分层级。

这份文档是对现有实现的记录，不是用户锁定的风格承诺。用户没有风格偏好，标准只有“好用、好看”；只要更好用或更好看，这里的任何部分都可以演进，演进后重新扫描更新本文件即可。

字体使用 Windows 原生的 Segoe UI Variable，让工具看起来像系统的一部分；地址、路径、模型 ID 这类要逐字核对的数据用等宽字体单独标出。整体安静、平、紧凑，交互反馈靠底色变化和 2px 蓝色焦点框，不靠动效。

**Key Characteristics:**
- 白底平面，细线（1px）分区，几乎不用阴影
- 颜色只表达状态：蓝=操作/选中，绿=生效/成功，橙=未保存/警告，红=错误
- 两档主字号：正文 14px，控件与辅助 12px
- 等宽字体只用于需要逐字核对的数据
- 统一 8px 圆角，嵌套在内部的小元素用 4px
- 键盘焦点始终可见：2px 主色描边

## Colors

一套冷调蓝灰中性色，加一个稳重的钴蓝作为唯一的操作色，再配三组“深字 + 浅底”的状态色。

### Primary
- **钴蓝 Cobalt Action** (primary)：主按钮底色、链接按钮文字、复选框与进度条的 accent、焦点描边、列表视图切换选中项的文字，以及“有可用更新”的圆点。它就是“这里可以操作 / 这一项已选中”的意思。
- **深钴蓝 Pressed Cobalt** (primary-hover)：主按钮悬停时的底色，只比主色深一档。
- **钴蓝薄雾 Cobalt Mist** (primary-tint)：列表视图切换选中项（如“菜单顺序 2”）的底色，与主色文字搭配使用。

### Neutral
- **墨蓝 Ink Navy** (text)：正文、标题、选中分段的文字。对白底约 13:1。
- **石板灰 Slate** (secondary)：次要文字、说明、计数、未选中分段、图标。它被特意调深，在悬停底色 hover 上也能达到 4.5:1 以上（实测约 4.8:1，白底约 5.3:1）。
- **雾线 Mist Line** (line)：所有分区细线：标题下沿、列表行分隔、右侧面板左边线、设置行底线、底部保存栏上沿。
- **控件描边 Control Edge** (field-border)：按钮、下拉框、搜索框、列表视图切换的 1px 描边。它在样式表里是直接写的字面值而非自定义属性，但被四类控件一致复用，所以记为 token。
- **纸白 Paper** (surface)：页面、弹窗、默认按钮和输入框的底色。
- **画布 Canvas** (canvas)：模型行悬停底色、更新说明的承载底。
- **悬停 Hover Wash** (hover)：默认按钮与导航按钮的悬停底、分段控件的槽、中性标签底、主按钮禁用态的底。

### 状态色
- **松绿 Pine** (success) 与 **松绿浅底** (success-bg)：成功提示条、当前模式旁的状态圆点、“已保存”字样。
- **砖红 Brick** (error) 与 **砖红浅底** (error-bg)：错误提示条、状态读取失败区、更新错误文字。
- **琥珀 Amber** (warning) 与 **琥珀浅底** (warning-bg)：未保存修改的圆点、外部改动冲突条、“列表外”标签、环境变量警告文字。

### Named Rules
**The State-Only Color Rule.** 颜色只表达状态：蓝=可操作或已选中，绿=当前生效或成功，橙=未保存或警告，红=错误。其余一切用蓝灰中性色。新增元素想用颜色时，先问它表达的是哪一种状态。

**The 4.5:1 Floor Rule.** 次要文字色 secondary 是为了在 hover、canvas 等浅底上保持至少 4.5:1 对比度而调深的，不要再调浅；状态色的“深字 + 浅底”组合也都在 4.5:1 以上，新增组合须同样达标。

## Typography

**Body Font:** Segoe UI Variable Text（回退 Segoe UI、Microsoft YaHei UI、system-ui、sans-serif）
**Mono Font:** Cascadia Code（回退 Consolas、monospace）

**Character:** 单一的 Windows 系统无衬线字体，配一款系统等宽字体；整体像原生设置面板，层级靠字重 600 拉开，而不是大字号。

### Hierarchy
- **Headline**（600，24px，1.25，字距 -0.4px）：页面标题，“Claude Code”“设置”，每页只有一个。
- **Title**（600，18px）：弹窗标题。
- **Title Small**（600，14px）：区块标题（模型菜单、模型用途、设置页各节）和空状态标题。
- **Body**（400，14px，1.5）：模型名称、弹窗说明段落。
- **Label**（600，12px）：按钮文字、表单字段标签、折叠区标题、设置行名称。
- **Caption**（400，12px）：说明、计数、获取时间、提示条、标签、分段选项、输入框内文字。
- **Mono**（400，12px）：地址、文件路径、模型 ID。

### Named Rules
**The Mono-for-Data Rule.** 等宽字体只用于需要逐字核对或复制的数据：地址、路径、模型 ID。界面文案、数量、版本说明一律用正文字体。

**The Two-Size Rule.** 页面内容只有两档字号：正文 14px、控件与辅助 12px。标题之外的层级靠字重和颜色（墨蓝 / 石板灰）区分，不新增中间字号。

## Layout

单窗口桌面应用，内容纵向分三段：顶部标题区（标题 + 模式分段控件 + 设置入口，下面一行是当前连接）、可滚动的主体、底部固定的保存栏。左右统一留 32px 边距；主页面主体是两栏网格：左侧模型列表自适应，右侧 256px 的“模型用途”面板，栏间距 24px，用 1px 竖线分隔。设置页是单栏，左右边距相同，各节之间 32px，设置行之间用底线分隔、上下各 16px。

间距以 4px 为基本单位，实际使用 4 / 8 / 12 / 16 / 24 / 32 六档：控件内部 8px，同组控件间距 8px，区块标题与内容之间 12px，字段之间 24px，页面边距与区块间距 32px。列表行最小高 40px，按钮与输入框最小高 36px。

响应：窗口宽度不足 900px 时，页面边距收为 24px，右侧面板缩到 216px，栏间距与字段间距收为 16px，列表行内边距收紧；窗口高度不足 600px 时，右侧面板的字段间距和下拉框高度（32px）收紧，保证三个模型用途不用滚动就能看到。

**The Hairline Structure Rule.** 区域划分用 1px 雾线（line），不用卡片、底色块或阴影。底部保存栏的上沿只在有未保存修改时出现。

## Elevation & Depth

系统是平面的。页面上的一切都在同一层，层次靠细线、留白和底色深浅表达。真正的“浮起”只发生在弹窗：弹窗出现时，背后整页盖上一层半透明墨蓝遮罩并轻微模糊（2px），弹窗本身带一层柔和的投影。唯一的另一处阴影是分段控件的选中项，用 1px 级别的贴地阴影让它看起来像被按下的白色滑块，属于控件状态而不是层级。

### Shadow Vocabulary
- **弹窗投影 Dialog Lift**（`box-shadow: 0 15px 35px #18243b33`）：只用于模态弹窗。
- **分段贴地 Segment Contact**（`box-shadow: 0 1px 3px #2430461a`）：只用于分段控件的选中项。

### Named Rules
**The Only-Dialogs-Float Rule.** 只有模态弹窗离开页面平面，并且只用一层投影；页面上的面板、列表、提示条都不加阴影。

## Shapes

统一的柔和圆角：按钮、输入框、下拉框、列表视图切换、分段控件的槽、提示条、弹窗都用 8px（rounded.md）。嵌套在这些容器里或尺寸很小的元素用 4px（rounded.sm）：分段选项、中性标签、排序箭头按钮。状态圆点为 6px 正圆。描边一律 1px；图标是 24 网格、1.7 线宽、圆头圆角的线性图标，按场景缩放为 18 / 16 / 14 / 12px，颜色跟随文字。

## Components

### Buttons
功能型、扁平、紧凑。
- **Shape:** 8px 圆角，最小高 36px，内边距 8px 12px，文字 12px / 600，可带 16px 线性图标，图文间距 8px。
- **Primary:** 钴蓝底白字，悬停转深钴蓝。每个操作区最多一个，用于“保存配置”“保存连接”这类提交动作。禁用时不降透明度，而是变成悬停灰底 + 石板灰字，保证仍可读。
- **Default:** 纸白底 + 1px 控件描边 + 墨蓝字，悬停变悬停灰底。用于“刷新列表”“检查更新”等非提交动作。
- **Quiet:** 无描边、透明底、石板灰字，用于“放弃修改”“取消”。
- **Link:** 无框的钴蓝 12px 文字，悬停加下划线，用于行内动作（编辑连接、全选、清空、打开所在文件夹）。
- **Focus:** 所有按钮键盘聚焦时 2px 钴蓝描边，外偏移 3px。其他按钮禁用时透明度 0.45。

### Segmented Mode Switch
页面右上角的“官方订阅 / CPA”切换，用来切换 CLI 的使用方式，点击即写入配置，不是页面导航。悬停灰底的槽（4px 内边距、8px 圆角）里放两个 4px 圆角的选项；选中项为白底、墨蓝字、600 字重，带分段贴地阴影，当前生效的模式前有 6px 松绿圆点。未选中项透明底、石板灰字。旁边的“设置”是无框导航按钮：石板灰 12px 文字 + 16px 图标，悬停时出现灰底、文字转墨蓝。

### Chips
- **列表视图切换:** 与输入框同高、同描边的两段切换（“全部 / 菜单顺序 N”），未选中项为石板灰 12px 字，选中项为钴蓝薄雾底 + 钴蓝字、600 字重。“菜单顺序”就是 CLI `/model` 菜单的实际顺序。
- **标签:** 4px 圆角、悬停灰底、石板灰 12px 字，用于“默认”“子代理”“自动审批”等角色，一行有多个角色时以“ · ”连成一个标签；“列表外”用琥珀浅底 + 琥珀字。

### Inputs / Fields
- **Style:** 纸白底、1px 控件描边、8px 圆角、最小高 36px、内边距 8px、12px 文字。字段标签在上方，12px / 600，与控件间距 8px，字段之间 24px。
- **Search:** 左侧 16px 石板灰放大镜图标，整个框作为一个整体获得焦点。
- **Focus:** 2px 钴蓝描边；组合输入框（搜索、密码）外偏移 2px，单一控件 3px。
- **Password:** 输入与“显示”文字按钮同在一个描边框内；已保存的 Key 在标签行右侧以松绿 12px 文字提示。

### Model List
主页面的核心组件。列表顶部和每行底部是 1px 雾线；每行最小高 40px，内边距 8px，元素间距 12px，整行可点击，悬停时底色变为画布色。行内依次是 16px 复选框（钴蓝 accent）、模型名称（14px，过长省略）、右对齐的等宽石板灰模型 ID（最多占 45% 宽度）、角色标签。键盘焦点所在的行与悬停一样使用画布底色。排序视图中，行首有右对齐的等宽数字序号，行尾有两个 24px 的上下箭头按钮（4px 圆角，悬停灰底）。列表下方一行是“全选 / 清空”链接按钮与右侧的复选框选项。

### Notices
提示条是 8px 圆角、无描边的浅底条，内边距 8px 12px，12px 文字，颜色组合取自状态色：成功为松绿浅底 + 松绿字，错误为砖红浅底 + 砖红字，外部改动冲突为琥珀浅底 + 琥珀字，冲突条内的动作是带下划线的同色文字按钮。状态读取失败区是更厚的砖红浅底块（内边距 12px），里面放默认按钮；需要注意但不是错误的状态（如“当前使用其他连接”）用同样厚度的琥珀浅底块。提示区最多 128px 高，超出滚动。

### Dialogs
最大宽 464px，32px 内边距，8px 圆角，纸白底，带弹窗投影，背后是半透明墨蓝遮罩加 2px 模糊。标题 18px / 600，标题行与内容间距 24px；底部动作右对齐，与内容间距 32px，通常是 Quiet + Primary 一对。

### Save Footer
页面底部固定的保存栏，最小高 60px，左右边距与页面一致。左侧是 6px 琥珀圆点 + 石板灰“有未保存修改”，右侧是“放弃修改”（Quiet）和“保存配置”（Primary）。没有修改时上沿细线隐藏、主按钮处于禁用态。

## Do's and Don'ts

### Do:
- **Do** 按状态选色：蓝（primary）只给可操作和已选中，绿（success）给当前生效与成功，橙（warning）给未保存与警告，红（error）只给错误。
- **Do** 次要文字统一用 secondary（#5f6c80），并保证在 hover、canvas 等浅底上至少 4.5:1。
- **Do** 地址、路径、模型 ID 用等宽字体（Cascadia Code / Consolas，12px），其余文案用正文字体。
- **Do** 按钮、输入框、提示条、弹窗用 8px 圆角，内部小元素用 4px。
- **Do** 用 1px 雾线（line）划分区域，层次靠留白与细线表达。
- **Do** 每个可聚焦元素保留 2px 钴蓝焦点描边。

### Don't:
- **Don't** 把次要文字色调浅到 #5f6c80 以下的对比度；它是为可读性专门调整过的。
- **Don't** 用颜色做装饰：没有状态含义的元素不要用蓝、绿、橙、红。
- **Don't** 给页面上的面板、列表或提示条加阴影；阴影只属于弹窗（以及分段控件选中项的贴地阴影）。
- **Don't** 用等宽字体排普通文案或数字统计。
- **Don't** 在 14px 与 12px 之间新增中间字号来制造层级；改用字重或颜色。
