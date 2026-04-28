const { call } = require('../../utils/cloud.js');
const UNVERIFIED_TIP = '当前未认证，请先认证';
const DEFAULT_AVATAR = '/assets/images/default-avatar.png';

Page({
  data: {
    user: null,
    studentVerify: null,
    displayName: '',
    defaultAvatar: DEFAULT_AVATAR,
    activeOrderCount: 0
  },

  onShow() {
    this.refresh();
  },

  async refresh() {
    try {
      const r = await call('user', { action: 'getProfile' });
      wx.setStorageSync('user', r.user);
      const p = r.user.verifyPayload || {};
      const studentVerify = {
        studentNo: p.studentNo || '',
        realName: p.realName || '',
        major: p.major || '',
        grade: p.grade || ''
      };
      if (r.user && r.user.role === 'student' && r.user.verifyStatus !== 'approved') {
        wx.showToast({ title: UNVERIFIED_TIP, icon: 'none' });
      }
      this.setData({
        user: r.user,
        studentVerify,
        displayName: this.getDisplayName(r.user, studentVerify)
      });
      if (r.user && r.user.role === 'student') {
        await this.loadActiveOrderCount();
      } else {
        this.setData({ activeOrderCount: 0 });
      }
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' });
    }
  },

  async loadActiveOrderCount() {
    try {
      const r = await call('job', { action: 'myWorkOrders' });
      const list = r.list || [];
      const activeOrderCount = list.filter((item) => ['ongoing', 'pending_settlement', 'submitted'].includes(item.status)).length;
      this.setData({ activeOrderCount });
    } catch (e) {
      this.setData({ activeOrderCount: 0 });
    }
  },

  getDisplayName(user, studentVerify) {
    const nickName = (user && user.nickName ? user.nickName : '').trim();
    if (nickName) return nickName;
    if (user && user.verifyStatus === 'approved') {
      const verify = studentVerify || {};
      const realName = (verify.realName || '').trim();
      if (realName) return realName;
    }
    return '微信用户';
  },

  onAvatarError() {
    this.setData({
      'user.avatarUrl': '',
      defaultAvatar: DEFAULT_AVATAR
    });
  },

  goOrders() {
    wx.navigateTo({ url: '/pages/student/orders' });
  },

  goWallet() {
    wx.navigateTo({ url: '/pages/wallet/index' });
  },

  goJobs() {
    wx.redirectTo({ url: '/pages/student/jobs' });
  },


  goContact() {
    wx.redirectTo({ url: '/pages/student/contact' });
  },

  goMine() {
    // 当前页
  },

  goVerify() {
    wx.navigateTo({ url: '/pages/register/student' });
  },

  goEditProfile() {
    wx.navigateTo({ url: '/pages/profile/edit' });
  },

  async switchToPublisher() {
    wx.showLoading({ title: '切换中' });
    try {
      const r = await call('user', { action: 'setRole', role: 'publisher' });
      wx.setStorageSync('user', r.user);
      wx.showToast({ title: '已切换到发布者', icon: 'success' });
      setTimeout(() => {
        wx.reLaunch({ url: '/pages/publisher/mine' });
      }, 400);
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '切换失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
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

  async switchToStudent() {
    wx.showLoading({ title: '切换中' });
    try {
      const r = await call('user', { action: 'setRole', role: 'student' });
      wx.setStorageSync('user', r.user);
      wx.showToast({ title: '已切换为兼职者身份', icon: 'success' });
      setTimeout(() => wx.reLaunch({ url: '/pages/student/mine' }), 400);
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '切换失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  }
});
