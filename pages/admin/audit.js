const { call } = require('../../utils/cloud.js');

Page({
  data: {
    pendingJobCount: 0
  },

  onShow() {
    this.refresh();
  },

  async refresh() {
    await this.loadPendingJobCount();
  },

  async loadPendingJobCount() {
    try {
      const j = await call('job', { action: 'adminListPendingJobs' });
      this.setData({ pendingJobCount: (j.list || []).length });
    } catch (e) {
      this.setData({ pendingJobCount: 0 });
    }
  },

  goReviewUsers() {
    wx.navigateTo({ url: '/pages/admin/users' });
  },

  goOrders() {
    wx.redirectTo({ url: '/pages/admin/orders' });
  },

  goMine() {
    wx.redirectTo({ url: '/pages/admin/mine' });
  },

  goReviewPendingJobs() {
    wx.navigateTo({ url: '/pages/admin/pending-jobs' });
  }
});
