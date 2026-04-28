const { call } = require('../../utils/cloud.js');

Page({
  async pickStudent() {
    await this.setRole('student');
  },

  async pickPublisher() {
    await this.setRole('publisher');
  },

  async setRole(role) {
    wx.showLoading({ title: '保存中' });
    try {
      const r = await call('user', { action: 'setRole', role });
      wx.setStorageSync('user', r.user);
      wx.showToast({ title: '已保存', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 500);
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  }
});
