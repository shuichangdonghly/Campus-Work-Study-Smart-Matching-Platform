const { call } = require('../../utils/cloud.js');
const DEFAULT_AVATAR = '/assets/images/default-avatar.png';

Page({
  data: {
    user: null,
    displayName: '',
    defaultAvatar: DEFAULT_AVATAR
  },

  onShow() {
    this.refresh();
  },

  async refresh() {
    try {
      const r = await call('user', { action: 'getProfile' });
      wx.setStorageSync('user', r.user);
      this.setData({
        user: r.user,
        displayName: this.getDisplayName(r.user)
      });
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' });
    }
  },

  getDisplayName(user) {
    const nickName = (user && user.nickName ? user.nickName : '').trim();
    if (nickName) return nickName;
    return '微信用户';
  },

  onAvatarError() {
    this.setData({
      'user.avatarUrl': '',
      defaultAvatar: DEFAULT_AVATAR
    });
  },

  goAudit() {
    wx.redirectTo({ url: '/pages/admin/audit' });
  },

  goOrders() {
    wx.redirectTo({ url: '/pages/admin/orders' });
  },

  goMine() {
    // 当前页
  },

  goEditProfile() {
    wx.navigateTo({ url: '/pages/profile/edit' });
  },

  async switchToStudent() {
    wx.showLoading({ title: '切换中' });
    try {
      const r = await call('user', { action: 'setRole', role: 'student' });
      wx.setStorageSync('user', r.user);
      wx.showToast({ title: '已切换到学生身份', icon: 'success' });
      setTimeout(() => wx.reLaunch({ url: '/pages/student/jobs' }), 400);
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '切换失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  async switchToPublisher() {
    wx.showLoading({ title: '切换中' });
    try {
      const r = await call('user', { action: 'setRole', role: 'publisher' });
      wx.setStorageSync('user', r.user);
      wx.showToast({ title: '已切换到发布者身份', icon: 'success' });
      setTimeout(() => wx.reLaunch({ url: '/pages/publisher/jobs' }), 400);
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '切换失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  }
});
