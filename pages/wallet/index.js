const { call } = require('../../utils/cloud.js');

Page({
  data: {
    user: null
  },

  onShow() {
    this.refresh();
  },

  async refresh() {
    try {
      const r = await call('user', { action: 'getProfile' });
      wx.setStorageSync('user', r.user);
      this.setData({ user: r.user || null });
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' });
      this.setData({ user: null });
    }
  },

  goRecharge() {
    wx.navigateTo({ url: '/pages/wallet/recharge' });
  },

  goWithdraw() {
    wx.navigateTo({ url: '/pages/wallet/withdraw' });
  }
});
