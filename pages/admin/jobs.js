const { call } = require('../../utils/cloud.js');

Page({
  data: {
    list: []
  },

  onShow() {
    this.load();
  },

  async load() {
    try {
      const j = await call('job', { action: 'adminListPendingJobs' });
      this.setData({
        list: j.list || []
      });
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '无权限或加载失败', icon: 'none' });
    }
  },

  async approve(e) {
    const jobId = e.currentTarget.dataset.id;
    wx.showLoading({ title: '处理中' });
    try {
      await call('job', { action: 'adminApproveJob', jobId });
      wx.showToast({ title: '已上架', icon: 'success' });
      this.load();
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  reject(e) {
    const jobId = e.currentTarget.dataset.id;
    wx.showModal({
      title: '拒绝原因',
      editable: true,
      placeholderText: '选填',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await call('job', {
            action: 'adminRejectJob',
            jobId,
            reason: res.content || ''
          });
          wx.showToast({ title: '已拒绝', icon: 'success' });
          this.load();
        } catch (err) {
          wx.showToast({ title: (err && err.message) || '失败', icon: 'none' });
        }
      }
    });
  },

  goAudit() {
    wx.redirectTo({ url: '/pages/admin/audit' });
  },

  goOrders() {
    wx.redirectTo({ url: '/pages/admin/orders' });
  },

  goMine() {
    wx.redirectTo({ url: '/pages/admin/mine' });
  }
});
