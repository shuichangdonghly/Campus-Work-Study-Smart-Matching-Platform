const { call } = require('../../utils/cloud.js');

Page({
  data: {
    studentNo: '',
    realName: '',
    major: '',
    grade: '',
    isResubmit: false
  },

  async onLoad() {
    try {
      const r = await call('user', { action: 'getProfile' });
      const user = r.user || {};
      const payload = user.studentVerifyPayload || user.verifyPayload || {};
      this.setData({
        studentNo: payload.studentNo || '',
        realName: payload.realName || '',
        major: payload.major || '',
        grade: payload.grade || '',
        isResubmit: user.verifyStatus === 'pending'
      });
    } catch (e) {
      // 加载失败不阻断填写流程
    }
  },

  onSn(e) {
    this.setData({ studentNo: e.detail.value });
  },
  onName(e) {
    this.setData({ realName: e.detail.value });
  },
  onMajor(e) {
    this.setData({ major: e.detail.value });
  },
  onGrade(e) {
    this.setData({ grade: e.detail.value });
  },

  async submit() {
    wx.showLoading({ title: '提交中' });
    try {
      const r = await call('user', {
        action: 'submitVerify',
        payload: {
          studentNo: this.data.studentNo.trim(),
          realName: this.data.realName.trim(),
          major: this.data.major.trim(),
          grade: this.data.grade.trim()
        }
      });
      wx.setStorageSync('user', r.user);
      wx.showToast({ title: this.data.isResubmit ? '已更新申请' : '已提交', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 500);
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  }
});
