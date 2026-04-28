const { call } = require('../../utils/cloud.js');

Page({
  data: {
    user: null
  },

  onShow() {
    const u = wx.getStorageSync('user');
    if (!u || !u.openid) {
      wx.reLaunch({ url: '/pages/login/login' });
      return;
    }
    this.setData({ user: u });
    this.refresh();
  },

  async refresh() {
    try {
      const r = await call('user', { action: 'getProfile' });
      wx.setStorageSync('user', r.user);
      this.setData({ user: r.user });
    } catch (e) {
      wx.showToast({
        title: (e && e.message) || '刷新失败',
        icon: 'none'
      });
    }
  },

  goRole() {
    wx.navigateTo({ url: '/pages/register/role' });
  },

  goVerify() {
    const u = this.data.user;
    if (!u) return;
    if (u.role === 'student') {
      wx.navigateTo({ url: '/pages/register/student' });
    } else if (u.role === 'publisher') {
      wx.navigateTo({ url: '/pages/register/publisher' });
    } else {
      wx.showToast({ title: '请先选择身份', icon: 'none' });
    }
  },

  goEditProfile() {
    wx.navigateTo({ url: '/pages/profile/edit' });
  },

  goJobs() {
    wx.navigateTo({ url: '/pages/student/jobs' });
  },

  goStudentMine() {
    wx.navigateTo({ url: '/pages/student/mine' });
  },

  goPubCreate() {
    wx.navigateTo({ url: '/pages/publisher/create' });
  },

  goPubJobs() {
    wx.navigateTo({ url: '/pages/publisher/jobs' });
  },

  goAdminAudit() {
    wx.navigateTo({ url: '/pages/admin/audit' });
  }
});
