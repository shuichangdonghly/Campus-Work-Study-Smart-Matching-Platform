# 校内勤工俭学智能匹配平台

基于**微信小程序 + 微信云开发**实现的校园兼职管理系统，覆盖“岗位发布 -> 报名录用 -> 签到完工 -> 结算评价 -> 纠纷处理”全流程。

## v1.2 代码一致性更新（2026-04-28）

- 管理员“订单管理”页面改为**以 `jobs` 集合为主视图**进行分类展示（保留“申诉”筛选）。
- 管理员可从订单列表进入详情；招募中且暂无工单时也可基于岗位查看详情。
- 管理员可对订单执行“取消交易”，取消后详情页按钮灰显且禁用。
- 纠纷处理页支持“押金原路返回 / 驳回 / 人工裁定”，并支持订单级押金金额展示与分配校验。
- 人工裁定采用“双方金额输入”并校验：兼职方金额 + 发布方金额 = 当前订单总押金。
- 兼职者与发布者提交申诉后，统一弹窗提示“申诉订单已上传”。

## 项目简介

本项目面向校园场景，提供三类角色协同：

- 兼职者（`student`）：浏览/推荐岗位、报名、签到、提交完工、发起申诉、评价发布者
- 发布者（`publisher`）：发布岗位、录用学生、生成签到码、确认完工、评价学生
- 管理员（`admin`）：审核用户认证、审核岗位、处理纠纷、查看订单详情

系统内以“工分”作为结算单位，采用押金与状态机约束机制保障履约与交易安全。

## 核心能力

- 微信登录与用户初始化（自动创建账号与默认角色）
- 双角色认证流（学生认证/发布者认证）+ 管理员审核
- 岗位发布、审核、上下架、列表与详情
- 报名与录用（含人数上限与重复参与拦截）
- 工单执行：签到码生成、签到、完工图文提交、结算发放
- 纠纷处理：爽约投诉、拒不支付投诉、其他争议投诉 + 管理员裁决
- 订单双向评价与信用分变更（`credit_logs`）
- 会话沟通（岗位上下文一对一聊天）
- 推荐岗位（距离/薪资/时间综合评分）与地点选择
- 前端状态统一中文映射展示（数据库保留英文状态值）

## 技术栈

- 前端：微信小程序原生（WXML / WXSS / JavaScript）
- 后端：微信云开发（Cloud Functions + Cloud Database + Cloud Storage）
- 位置能力：经纬度计算 + 可选腾讯地图距离接口
- 数据调用封装：`utils/cloud.js`
- 状态文案映射：`utils/status-text.js`

## 项目结构（当前仓库）

```text
.
├── app.js
├── app.json
├── pages/
│   ├── login/ index/ profile/
│   ├── register/ (role, student, publisher)
│   ├── student/ (jobs, recommend, job-detail, orders, contact, mine)
│   ├── publisher/ (create, jobs, job-detail, contact, mine)
│   ├── admin/ (audit, users, pending-jobs, orders, order-detail, disputes, mine)
│   ├── wallet/ (index, recharge, withdraw)
│   ├── work/submit
│   ├── chat/detail
│   └── location-picker/
├── cloudfunctions/
│   ├── login/
│   ├── user/
│   ├── job/
│   ├── generateSignCode/
│   └── signIn/
├── utils/
│   ├── cloud.js
│   └── status-text.js
├── 概要设计说明书.md
├── 详细设计说明书.md
```

## 关键业务流程

1. 登录：`login` 云函数创建/补齐用户
2. 发布：发布者创建岗位（扣押金）-> 管理员审核岗位
3. 录用：学生报名 -> 发布者录用 -> 生成工单（扣学生押金）
4. 履约：发布者生成签到码 -> 学生签到 -> 学生提交完工证明
5. 结算：发布者/管理员确认完工，系统发放工分并返还押金
6. 异常：任一方发起投诉，管理员处理后状态收敛
7. 完成：双方评价，信用分更新

## 云函数接口总览

- `login`
  - `main`：登录与用户初始化
- `user`
  - `getProfile` / `getPublicProfile`
  - `updateProfile`
  - `setRole` / `switchBackAdmin`
  - `submitVerify`
  - `adminListPendingUsers` / `adminApproveUser` / `adminRejectUser`
  - `recharge` / `withdraw` / `walletLogs`
- `job`
  - 岗位：`createJob` / `listOpenJobs` / `myPublishedJobs` / `getJob`
  - 推荐：`getRecommendedJobs`
  - 报名录用：`applyJob` / `listApplications` / `acceptApplication`
  - 工单：`myWorkOrders` / `publisherWorkOrders` / `submitWork` / `confirmWork`
  - 纠纷：`reportNoShow` / `reportMerchantNoPay` / `reportOtherDispute` / `adminResolveDispute`
  - 管理端：`adminListPendingJobs` / `adminApproveJob` / `adminRejectJob` / `adminListAllWorkOrders` / `adminGetWorkOrderDetail`
  - 聊天：`sendMessage` / `listMessages` / `listMyChats`
- `generateSignCode`
  - `main`：生成签到码
- `signIn`
  - `main`：学生签到

## 快速开始

### 1）准备环境

- 微信开发者工具（导入小程序项目）
- 可用的小程序 AppID
- 已开通云开发环境

### 2）导入项目

```bash
git clone https://github.com/shuichangdonghly/Campus-Work-Study-Smart-Matching-Platform.git
```

在微信开发者工具中导入仓库根目录。

### 3）配置云开发

在 `app.js` 中确认已初始化云开发（`wx.cloud.init`），并设置你自己的云环境 ID。

### 4）部署云函数

对 `cloudfunctions` 下每个函数目录执行“上传并部署：云端安装依赖”。

### 5）数据库集合

运行后系统会自动兜底创建核心集合（`ensureCollection`），包含：

- `users`
- `jobs`
- `applications`
- `work_orders`
- `messages`
- `credit_logs`
- `order_reports`
- `disputes`
- `wallet_logs`

## 状态说明（展示与存储）

- 存储层：数据库使用英文状态值（如 `approved`、`open`）
- 展示层：前端统一映射为中文文案（如 `已通过`、`进行中`）
- 映射实现：`utils/status-text.js`

## 项目文档

- `概要设计说明书.md`
- `详细设计说明书.md`


## 说明

- 当前充值/提现为模拟流程（`channel: mock`），未接入真实支付。
- 如用于课程答辩，建议配合录屏演示以下主链路：
  - 发布审核 -> 报名录用 -> 签到完工 -> 结算评价 -> 纠纷处理。
