const { call } = require('../../utils/cloud.js');

Page({
  data: {
    list: []
  },

  onShow() {
    this.load();
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },

  async load() {
    try {
      const r = await call('job', { action: 'adminListPendingJobs' });
      this.setData({ list: r.list || [] });
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' });
    }
  },

  async approve(e) {
    const jobId = e.currentTarget.dataset.id;
    if (!jobId) return;
    wx.showModal({
      title: '通过并上架',
      content: '通过后岗位将上架，发布押金继续冻结，后续按订单结算。确认通过？',
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '处理中' });
        try {
          const r = await call('job', { action: 'adminApproveJob', jobId });
          wx.showToast({ title: (r && r.message) || '已上架', icon: 'success' });
          this.load();
        } catch (err) {
          wx.showToast({ title: (err && err.message) || '失败', icon: 'none' });
        } finally {
          wx.hideLoading();
        }
      }
    });
  },

  reject(e) {
    const jobId = e.currentTarget.dataset.id;
    if (!jobId) return;
    wx.showModal({
      title: '拒绝并退款',
      editable: true,
      placeholderText: '填写驳回原因（建议必填）',
      content: '驳回后将自动把该岗位已冻结的发布押金退回给发布方。',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          const r = await call('job', {
            action: 'adminRejectJob',
            jobId,
            reason: res.content || ''
          });
          wx.showToast({ title: (r && r.message) || '已拒绝', icon: 'success' });
          this.load();
        } catch (err) {
          wx.showToast({ title: (err && err.message) || '失败', icon: 'none' });
        }
      }
    });
  }
});
