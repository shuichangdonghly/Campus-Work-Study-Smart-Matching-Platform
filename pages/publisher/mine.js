const { call } = require('../../utils/cloud.js');
const UNVERIFIED_TIP = '当前未认证，请先认证';
const DEFAULT_AVATAR = '/assets/images/default-avatar.png';

Page({
  data: {
    user: null,
    publisherVerify: null,
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
      const p = r.user.verifyPayload || {};
      const publisherVerify = {
        workNo: p.workNo || '',
        unitName: p.unitName || '',
        remark: p.remark || ''
      };
      if (r.user && r.user.role === 'publisher' && r.user.verifyStatus !== 'approved') {
        wx.showToast({ title: UNVERIFIED_TIP, icon: 'none' });
      }
      this.setData({
        user: r.user,
        publisherVerify,
        displayName: this.getDisplayName(r.user, publisherVerify)
      });
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' });
    }
  },

  getDisplayName(user, publisherVerify) {
    const nickName = (user && user.nickName ? user.nickName : '').trim();
    if (nickName) return nickName;
    if (user && user.verifyStatus === 'approved') {
      const verify = publisherVerify || {};
      const unitName = (verify.unitName || '').trim();
      if (unitName) return unitName;
    }
    return '微信用户';
  },

  onAvatarError() {
    this.setData({
      'user.avatarUrl': '',
      defaultAvatar: DEFAULT_AVATAR
    });
  },

  async switchToPublisher() {
    wx.showLoading({ title: '切换中' });
    try {
      const r = await call('user', { action: 'setRole', role: 'publisher' });
      wx.setStorageSync('user', r.user);
      wx.showToast({ title: '已切换为发布者身份', icon: 'success' });
      setTimeout(() => wx.reLaunch({ url: '/pages/publisher/mine' }), 400);
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '切换失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  async switchToStudent() {
    wx.showLoading({ title: '切换中' });
    try {
      const r = await call('user', { action: 'setRole', role: 'student' });
      wx.setStorageSync('user', r.user);
      wx.showToast({ title: '已切换到兼职者', icon: 'success' });
      setTimeout(() => wx.reLaunch({ url: '/pages/student/jobs' }), 400);
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '切换失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  goCreate() {
    wx.redirectTo({ url: '/pages/publisher/jobs' });
  },

  goWallet() {
    wx.navigateTo({ url: '/pages/wallet/index' });
  },

  goMyJobs() {
    // 使用 redirectTo，避免与「发布页 → 我的信息」的 redirectTo 叠加形成 mine/jobs/mine 多级栈与重复返回
    wx.redirectTo({ url: '/pages/publisher/jobs' });
  },

  goContact() {
    wx.redirectTo({ url: '/pages/publisher/contact' });
  },

  goMine() {
    // 当前页
  },

  goAdminCenter() {
    wx.showLoading({ title: '切换中' });
    call('user', { action: 'switchBackAdmin' })
      .then((r) => {
        wx.setStorageSync('user', r.user);
        wx.showToast({ title: '已回退管理员身份', icon: 'success' });
        setTimeout(() => wx.reLaunch({ url: '/pages/admin/audit' }), 400);
      })
      .catch((e) => {
        wx.showToast({ title: (e && e.message) || '切换失败', icon: 'none' });
      })
      .finally(() => {
        wx.hideLoading();
      });
  },

  goVerify() {
    wx.navigateTo({ url: '/pages/register/publisher' });
  },

  goEditProfile() {
    wx.navigateTo({ url: '/pages/profile/edit' });
  }
});
