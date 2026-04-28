const { call } = require('../../utils/cloud.js');
const UNVERIFIED_TIP = '当前未认证，请先前往我的信息去认证';
const STATUS_TEXT = {
  pending_review: '待审核',
  open: '招募中',
  approved: '招募中',
  ongoing: '进行中',
  closed: '已结束',
  rejected: '已拒绝',
  publisher_cancelled: '发布者已下架',
  admin_cancelled: '管理员取消订单'
};

Page({
  data: {
    list: [],
    user: null
  },

  onShow() {
    this.load();
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },

  async load() {
    try {
      const p = await call('user', { action: 'getProfile' });
      const user = p.user || null;
      if (!user || user.verifyStatus !== 'approved') {
        wx.showToast({ title: UNVERIFIED_TIP, icon: 'none' });
        this.setData({ user, list: [] });
        return;
      }
      const r = await call('job', { action: 'myPublishedJobs' });
      const list = (r.list || []).map((item) => ({
        ...item,
        status: item.displayStatus || item.status,
        statusText: item.displayStatusText || STATUS_TEXT[item.status] || item.status || '未知状态',
        categoryText: item.category || '其他'
      }));
      this.setData({ user, list });
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' });
    }
  },

  open(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/publisher/job-detail?id=' + id });
  },

  goPublish() {
    // 当前页
  },

  goContact() {
    wx.redirectTo({ url: '/pages/publisher/contact' });
  },

  goMine() {
    wx.redirectTo({ url: '/pages/publisher/mine' });
  },

  goCreate() {
    const u = this.data.user;
    if (!u || u.verifyStatus !== 'approved') {
      wx.showToast({ title: UNVERIFIED_TIP, icon: 'none' });
      return;
    }
    wx.navigateTo({ url: '/pages/publisher/create' });
  }
});
