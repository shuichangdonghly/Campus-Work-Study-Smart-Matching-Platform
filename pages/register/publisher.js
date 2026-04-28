const { call } = require('../../utils/cloud.js');

Page({
  data: {
    workNo: '',
    unitName: '',
    remark: '',
    isResubmit: false
  },

  async onLoad() {
    try {
      const r = await call('user', { action: 'getProfile' });
      const user = r.user || {};
      const payload = user.publisherVerifyPayload || user.verifyPayload || {};
      this.setData({
        workNo: payload.workNo || '',
        unitName: payload.unitName || '',
        remark: payload.remark || '',
        isResubmit: user.verifyStatus === 'pending'
      });
    } catch (e) {
      // 加载失败不阻断填写流程
    }
  },

  onWn(e) {
    this.setData({ workNo: e.detail.value });
  },
  onUn(e) {
    this.setData({ unitName: e.detail.value });
  },
  onRm(e) {
    this.setData({ remark: e.detail.value });
  },

  async submit() {
    wx.showLoading({ title: '提交中' });
    try {
      const r = await call('user', {
        action: 'submitVerify',
        payload: {
          workNo: this.data.workNo.trim(),
          unitName: this.data.unitName.trim(),
          remark: this.data.remark.trim()
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
