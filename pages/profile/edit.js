const { call } = require('../../utils/cloud.js');

const DEFAULT_AVATAR = '/assets/images/default-avatar.png';

Page({
  data: {
    user: null,
    nickName: '',
    profileBio: '',
    avatarPreview: '',
    avatarFilePath: '',
    defaultAvatar: DEFAULT_AVATAR
  },

  onLoad() {
    this.loadProfile();
  },

  async loadProfile() {
    try {
      const r = await call('user', { action: 'getProfile' });
      const user = r.user || {};
      this.setData({
        user,
        nickName: user.nickName || '',
        profileBio: user.profileBio || '',
        avatarPreview: user.avatarUrl || ''
      });
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' });
    }
  },

  onChooseAvatar(e) {
    const filePath = (e.detail && e.detail.avatarUrl) || '';
    if (!filePath) return;
    this.setData({
      avatarPreview: filePath,
      avatarFilePath: filePath
    });
  },

  onAvatarError() {
    this.setData({
      avatarPreview: '',
      avatarFilePath: '',
      defaultAvatar: DEFAULT_AVATAR
    });
  },

  onNickNameInput(e) {
    this.setData({ nickName: (e.detail && e.detail.value) || '' });
  },

  onProfileBioInput(e) {
    this.setData({ profileBio: (e.detail && e.detail.value) || '' });
  },

  async uploadAvatarIfNeeded() {
    const filePath = this.data.avatarFilePath;
    if (!filePath) {
      return this.data.avatarPreview || '';
    }
    const openid = (this.data.user && this.data.user.openid) || 'unknown';
    const cloudPath = `avatar/${openid}_${Date.now()}.png`;
    const res = await wx.cloud.uploadFile({
      cloudPath,
      filePath
    });
    return (res && res.fileID) || '';
  },

  async save() {
    const nickName = (this.data.nickName || '').trim();
    const profileBio = (this.data.profileBio || '').trim();
    if (!nickName) {
      wx.showToast({ title: '请输入昵称', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '保存中' });
    try {
      const avatarUrl = await this.uploadAvatarIfNeeded();
      const r = await call('user', {
        action: 'updateProfile',
        payload: {
          nickName,
          avatarUrl,
          profileBio
        }
      });
      wx.setStorageSync('user', r.user);
      wx.showToast({ title: '保存成功', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 450);
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '保存失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  }
});
